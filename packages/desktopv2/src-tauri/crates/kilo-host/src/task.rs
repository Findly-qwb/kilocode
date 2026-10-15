//! Turn task isolation (PLAN §3.3, TODOS M0-16).
//!
//! Running rpi in-process means a panic inside a Turn would otherwise take the window
//! down with it. The contract: **a panic kills the Turn, never the app.** Two ways to
//! break that contract exist and both are blocked here:
//!
//!   * a synchronous panic in the Turn body -> `catch_unwind` (sync path),
//!   * a panic inside a spawned async Turn task -> the `JoinHandle` error carries the
//!     panic payload (async path, the one rpi actually needs since its loop is `async`).
//!
//! Either way the caller gets a `Panic` variant and maps it to
//! `agent_error { fatal: true }` plus `agent_end { reason: panic }`, which is what the UI
//! renders as "task aborted — retry / rollback to checkpoint".
//!
//! Note we do not install a global panic hook: the default hook already writes the panic
//! to stderr, and this crate must stay free of process-wide side effects.

use std::any::Any;
use std::panic;
use std::future::Future;

use crate::error::HostError;

/// What a Turn can end as. `Panicked` is the crash-domain boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Panic {
	/// `panic!("...")` / `unwrap()` with a message.
	Message(String),
	/// A non-string payload (including `panic_any`).
	Opaque,
}

impl Panic {
	pub fn describe(&self) -> String {
		match self {
			Panic::Message(text) => text.clone(),
			Panic::Opaque => "panic with a non-string payload".into(),
		}
	}
}

/// Extract the panic message from a `catch_unwind` payload.
pub fn payload(err: Box<dyn Any + Send + 'static>) -> Panic {
	if let Some(s) = err.downcast_ref::<&'static str>() {
		return Panic::Message((*s).to_string());
	}
	if let Some(s) = err.downcast_ref::<String>() {
		return Panic::Message(s.clone());
	}
	Panic::Opaque
}

/// Run a blocking Turn body, converting a panic into `Err(Panic)`.
pub fn unwind<T>(body: impl FnOnce() -> T) -> std::result::Result<T, Panic> {
	match panic::catch_unwind(panic::AssertUnwindSafe(body)) {
		Ok(value) => Ok(value),
		Err(err) => Err(payload(err)),
	}
}

/// Run an async Turn as its own task so a panic is contained by the `JoinHandle`.
///
/// The task is *not* cancelled when the returned future is dropped — dropping the handle
/// is exactly how a Turn gets abandoned — so `stop_agent` must use `kill_turn` instead.
pub async fn join<T>(body: impl Future<Output = T> + Send + 'static) -> std::result::Result<T, Panic>
where
	T: Send + 'static,
{
	let task = tokio::spawn(body);
	task.await.map_err(|err| {
		if err.is_panic() {
			// `JoinError` stringifies the payload for us; no need to reach into `Any`.
			Panic::Message(err.to_string())
		} else {
			Panic::Message("turn task cancelled".into())
		}
	})
}

/// The two events a panicked Turn must emit, built here so no call site can forget one.
pub fn fatal_events(session_id: &str, turn_index: i64, panic: &Panic) -> (crate::ipc::AgentError, crate::ipc::AgentEnd) {
	let text = panic.describe();
	(
		crate::ipc::AgentError {
			level: crate::ipc::Level::Error,
			code: crate::ipc::ErrorCode::Panic,
			message: crate::secret::redact(&text),
			retryable: true,
			retry_in_ms: None,
			attempt: None,
			fatal: Some(true),
		},
		crate::ipc::AgentEnd { reason: crate::ipc::AgentEndReason::Panic, summary: Some(text) },
	)
}

/// Convenience for command handlers: a panic becomes a `HostError::Panicked` so it can
/// travel through the normal `Result` path instead of unwinding into Tauri's IPC layer.
pub fn into_error(panic: Panic) -> HostError {
	HostError::Panicked(panic.describe())
}
