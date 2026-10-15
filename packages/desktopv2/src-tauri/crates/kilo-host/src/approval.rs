//! Human approval round-trip (PLAN §6.6, §3.3; TODOS M3-3).
//!
//! This is the async seam the permission engine hangs on: `before_tool_call` returns a
//! boxed future, so the host can await a `oneshot` and genuinely block the tool until a
//! human answers — while `tokio::time::timeout` guarantees the block is bounded.
//!
//! Why `oneshot` and a 30-minute deadline (§3.3): the agent Turn runs in-process, so a
//! approval that never resolves would park a task forever. Timeout is a **deny**, never
//! an allow, and the pending entry is removed by a drop guard so a cancelled Turn cannot
//! leave a stale card in the UI.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::oneshot;

use crate::error::{HostError, Result};
use crate::ipc::{self, ApproveToolCallArgs, Decision, HumanConfirmRequired};

/// PLAN §3.3: 30 minutes, then auto-deny.
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
	pub call_id: String,
	pub decision: Decision,
	/// Present when the human chose "run with edited args" (M3-5).
	pub args: Option<serde_json::Value>,
	/// Why the decision happened: `None` for a human click, `Some("timeout")` etc.
	/// The auto-deny path must be distinguishable in the transcript.
	pub reason: Option<String>,
}

impl Outcome {
	pub fn allowed(&self) -> bool {
		matches!(self.decision, Decision::Allow | Decision::AllowAlways)
	}
}

struct Entry {
	tx: oneshot::Sender<Outcome>,
	expires_at: i64,
}

#[derive(Default)]
struct Inner {
	pending: HashMap<String, Entry>,
}

pub struct Broker {
	inner: Arc<Mutex<Inner>>,
	timeout: Duration,
}

impl Default for Broker {
	fn default() -> Self {
		Broker::new(APPROVAL_TIMEOUT)
	}
}

impl Broker {
	pub fn new(timeout: Duration) -> Broker {
		Broker { inner: Arc::new(Mutex::new(Inner::default())), timeout }
	}

	pub fn timeout(&self) -> Duration {
		self.timeout
	}

	/// Register a pending approval and return the event to emit plus a `Ticket` that
	/// resolves it. The caller must hold the ticket for as long as it waits.
	pub fn ask(&self, ev: HumanConfirmRequired) -> (HumanConfirmRequired, Ticket) {
		let (tx, rx) = oneshot::channel();
		let expires_at = ipc::now_ms() + self.timeout.as_millis() as i64;
		let call_id = ev.call_id.clone();
		{
			let mut guard = self.lock();
			// Re-asking the same call_id replaces the old waiter rather than deadlocking
			// on a duplicated card; the old receiver observes a closed channel.
			guard.pending.insert(call_id.clone(), Entry { tx, expires_at });
		}
		let ev = HumanConfirmRequired { expires_at, ..ev };
		let inner = Arc::clone(&self.inner);
		let ticket = Ticket {
			call_id: call_id.clone(),
			expires_at,
			rx: Some(rx),
			_cleanup: Some(Cleanup { inner, call_id }),
		};
		(ev, ticket)
	}

	/// Resolve from the `approve_tool_call` command. `false` means the call is already
	/// gone (timed out, cancelled, or never asked) — the UI must not treat that as an
	/// error, only as "card expired".
	pub fn decide(&self, args: ApproveToolCallArgs) -> Result<bool> {
		let entry = self.lock().pending.remove(&args.call_id);
		let Some(entry) = entry else {
			return Ok(false);
		};
		let outcome = Outcome {
			call_id: args.call_id.clone(),
			decision: args.decision,
			args: args.modified_args,
			reason: args.reason,
		};
		// A closed receiver means the Turn already stopped waiting. Reported, not hidden.
		if entry.tx.send(outcome).is_err() {
			return Ok(false);
		}
		Ok(true)
	}

	pub fn waiting(&self) -> usize {
		self.lock().pending.len()
	}

	/// Expiry sweep, for the diagnostic panel (TODOS M0-17) and to guarantee that even
	/// without a waiter the card is dropped.
	pub fn expire(&self, now: i64) -> Vec<String> {
		let mut guard = self.lock();
		let stale: Vec<String> =
			guard.pending.iter().filter(|(_, e)| e.expires_at <= now).map(|(id, _)| id.clone()).collect();
		for id in &stale {
			if let Some(entry) = guard.pending.remove(id) {
				// Dropping the sender closes the receiver: the waiter maps that to a deny.
				drop(entry.tx);
			}
		}
		stale
	}

	fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
		self.inner.lock().unwrap_or_else(PoisonError::into_inner)
	}
}

/// Removes the pending entry when the waiter goes away, so a cancelled Turn cannot
/// leave an orphan card that the user could still click.
struct Cleanup {
	inner: Arc<Mutex<Inner>>,
	call_id: String,
}

impl Drop for Cleanup {
	fn drop(&mut self) {
		let mut guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
		if let Some(entry) = guard.pending.remove(&self.call_id) {
			drop(entry.tx);
		}
	}
}

pub struct Ticket {
	call_id: String,
	expires_at: i64,
	rx: Option<oneshot::Receiver<Outcome>>,
	_cleanup: Option<Cleanup>,
}

impl Ticket {
	pub fn call_id(&self) -> &str {
		&self.call_id
	}

	pub fn expires_at(&self) -> i64 {
		self.expires_at
	}

	/// Await the human. Bounded by the broker timeout; every non-answer path yields a
	/// `Deny`, because approving by accident is the one failure mode we cannot take back.
	pub async fn wait(mut self, timeout: Duration) -> Outcome {
		let rx = self.rx.take().unwrap_or_else(|| {
			let (_tx, dead) = oneshot::channel();
			dead
		});
		match tokio::time::timeout(timeout, rx).await {
			// A human answered.
			Ok(Ok(outcome)) => outcome,
			// Deadline passed: auto-deny and say so.
			Err(_elapsed) => Outcome {
				call_id: self.call_id.clone(),
				decision: Decision::Deny,
				args: None,
				reason: Some("approval timeout".into()),
			},
			// Sender dropped — the entry expired or the broker went away.
			Ok(Err(_closed)) => Outcome {
				call_id: self.call_id.clone(),
				decision: Decision::Deny,
				args: None,
				reason: Some("approval channel closed".into()),
			},
		}
	}

	/// Cancelled Turn: hand back the cleanup guard so the caller can drop the card
	/// explicitly instead of relying on scope exit.
	pub fn abandon(&mut self) {
		self._cleanup.take();
	}
}

/// Error used by the app crate when a Turn was denied.
pub fn denied(outcome: &Outcome) -> HostError {
	HostError::Perms(format!(
		"tool {} denied{}",
		outcome.call_id,
		outcome.reason.as_deref().map(|r| format!(" ({r})")).unwrap_or_default()
	))
}

/// Result of an approval round-trip as the tool seam needs it.
pub enum Resolution {
	Run(Option<serde_json::Value>),
	Block(String),
}

pub fn resolve(outcome: Outcome) -> Resolution {
	if outcome.allowed() {
		return Resolution::Run(outcome.args);
	}
	Resolution::Block(format!(
		"{}: {}",
		outcome.call_id,
		outcome.reason.unwrap_or_else(|| "user denied".into())
	))
}
