//! Subprocess supervision (PLAN §3.3 crash domain, §6.4 truncation).
//!
//! Two lessons from the VS Code extension side are enforced structurally here:
//!
//!  * **Every child is registered.** `Registry` holds the live pids; the exec path takes
//!    a guard that deregisters on exit, and `reap_all()` is what `stop_agent` and app
//!    shutdown call. A leaked child is not recoverable from the UI, so this is the only
//!    place pids may be born.
//!  * **Shell calls are bounded.** Default 120 s (PLAN §6.4), then the whole *process
//!    group* is killed — killing only the `sh -c` parent leaves grandchildren holding the
//!    terminal. Output is capped so `find /` cannot OOM the WebView.
//!
//! Nothing here depends on Tauri, so timeout and kill behaviour is unit-tested against
//! real processes rather than mocks.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::sync::CancellationToken;

use crate::error::{HostError, Result};

/// PLAN §6.4: shell timeout default.
pub const SHELL_TIMEOUT: Duration = Duration::from_secs(120);

/// PLAN §6.4: per-stream output cap.
pub const MAX_OUTPUT: usize = 256 * 1024;

#[derive(Default)]
struct Live {
	pids: Vec<u32>,
}

/// Keeps track of every spawned child so nothing can escape reaping.
#[derive(Clone, Default)]
pub struct Registry {
	inner: Arc<Mutex<Live>>,
}

impl Registry {
	pub fn new() -> Registry {
		Registry::default()
	}

	fn add(&self, pid: u32) {
		self.lock().pids.push(pid);
	}

	fn remove(&self, pid: u32) {
		self.lock().pids.retain(|p| *p != pid);
	}

	/// Live pids — the runtime diagnostic panel reads this (TODOS M0-17).
	pub fn alive(&self) -> Vec<u32> {
		self.lock().pids.clone()
	}

	pub fn count(&self) -> usize {
		self.lock().pids.len()
	}

	/// Kill everything still registered (`stop_agent`, app exit). Returns what it
	/// signalled so the caller can log it.
	pub fn reap_all(&self) -> Vec<u32> {
		let pids = self.alive();
		for pid in &pids {
			kill_group(*pid);
		}
		self.lock().pids.clear();
		pids
	}

	fn lock(&self) -> std::sync::MutexGuard<'_, Live> {
		// A panic while holding this only loses pid bookkeeping; recovering the guard is
		// deliberate and must not be silent.
		let guard = self.inner.lock();
		if guard.is_err() {
			eprintln!("kilo-host proc: registry mutex poisoned, recovering");
		}
		guard.unwrap_or_else(PoisonError::into_inner)
	}
}

#[derive(Debug, Clone, PartialEq)]
pub struct Exec {
	pub code: Option<i32>,
	pub stdout: String,
	pub stderr: String,
	pub timed_out: bool,
	/// Either stream hit `MAX_OUTPUT`; the tool card shows the truncation marker.
	pub truncated: bool,
}

impl Exec {
	pub fn ok(&self) -> bool {
		!self.timed_out && self.code == Some(0)
	}
}

/// Run `program args…` under a timeout, a cancellation token and an output cap.
pub async fn run<S: AsRef<OsStr>>(
	reg: &Registry,
	program: &OsStr,
	args: &[S],
	cwd: Option<&Path>,
	timeout: Duration,
	cancel: CancellationToken,
) -> Result<Exec> {
	run_env(reg, program, args, cwd, &[], timeout, cancel).await
}

/// Same as [`run`] with extra environment entries. Needed by `checkpoint.rs`, which
/// steers git with `GIT_INDEX_FILE` so no shared index is ever reused.
pub async fn run_env<S: AsRef<OsStr>>(
	reg: &Registry,
	program: &OsStr,
	args: &[S],
	cwd: Option<&Path>,
	env: &[(&str, &str)],
	timeout: Duration,
	cancel: CancellationToken,
) -> Result<Exec> {
	let mut std_cmd = std::process::Command::new(program);
	std_cmd.args(args.iter().map(|a| a.as_ref()));
	for (key, value) in env {
		std_cmd.env(key, value);
	}
	std_cmd.stdin(std::process::Stdio::null());
	std_cmd.stdout(std::process::Stdio::piped());
	std_cmd.stderr(std::process::Stdio::piped());
	if let Some(dir) = cwd {
		std_cmd.current_dir(dir);
	}
	// Own process group, so one signal reaches the shell's children too. `process_group(0)`
	// makes the child's pid the group id.
	#[cfg(unix)]
	{
		use std::os::unix::process::CommandExt;
		std_cmd.process_group(0);
	}
	let mut child = tokio::process::Command::from_std(std_cmd)
		.spawn()
		.map_err(|source| HostError::Io { path: program.to_string_lossy().to_string(), source })?;
	let pid = child.id().ok_or_else(|| HostError::Process("child exited before its pid was read".into()))?;
	reg.add(pid);
	// No path out of this function may skip the deregistration.
	let _guard = Guard { reg: reg.clone(), pid };

	// Drain the pipes on their own tasks: holding `&mut child.stdout` while also awaiting
	// `child.wait()` would both fail to borrow-check and deadlock on a full 64 KB buffer.
	let out = child
		.stdout
		.take()
		.map(|mut reader| tokio::spawn(async move { drain(&mut reader, MAX_OUTPUT).await }));
	let err = child
		.stderr
		.take()
		.map(|mut reader| tokio::spawn(async move { drain(&mut reader, MAX_OUTPUT).await }));

	enum End {
		Done(std::process::ExitStatus),
		TimedOut,
		Cancelled,
	}
	let end = tokio::select! {
		status = child.wait() => status.map_or_else(|err| return Err(HostError::Process(err.to_string())), End::Done),
		_ = tokio::time::sleep(timeout) => {
			kill_group(pid);
			let _ = child.wait().await;
			End::TimedOut
		},
		_ = cancel.cancelled() => {
			kill_group(pid);
			let _ = child.wait().await;
			End::Cancelled
		},
	};

	// Await the readers *after* the child is gone: the pipes close on exit, which is what
	// terminates `drain`.
	let (out, cut_out) = match stdout {
		Some(task) => task.await.map_err(|err| HostError::Process(format!("stdout reader panicked: {err}")))?,
		None => (Vec::new(), false),
	};
	let (err, cut_err) = match stderr {
		Some(task) => task.await.map_err(|err| HostError::Process(format!("stderr reader panicked: {err}")))?,
		None => (Vec::new(), false),
	};

	let truncated = cut_out || cut_err;
	let stdout = String::from_utf8_lossy(&out).to_string();
	let stderr = String::from_utf8_lossy(&err).to_string();
	match end {
		End::Cancelled => Err(HostError::Cancelled),
		End::TimedOut => {
			// PLAN §6.4 wants the timeout *and* the kill reported; the partial output is
			// still useful in the tool card, so surface it on a dedicated field.
			Ok(Exec { code: None, stdout, stderr, timed_out: true, truncated })
		}
		End::Done(status) => Ok(Exec { code: status.code(), stdout, stderr, timed_out: false, truncated }),
	}
}

/// `sh -c <command>` with the PLAN §6.4 default timeout. Windows uses `cmd /C`.
pub async fn shell(reg: &Registry, command: &str, cwd: Option<&Path>, cancel: CancellationToken) -> Result<Exec> {
	shell_with(reg, command, cwd, SHELL_TIMEOUT, cancel).await
}

pub async fn shell_with(
	reg: &Registry,
	command: &str,
	cwd: Option<&Path>,
	timeout: Duration,
	cancel: CancellationToken,
) -> Result<Exec> {
	#[cfg(unix)]
	let (program, wrapper): (&str, [&str; 2]) = ("/bin/sh", ["-c", command]);
	#[cfg(windows)]
	let (program, wrapper): (&str, [&str; 2]) = ("cmd", ["/C", command]);
	run(reg, OsStr::new(program), &wrapper, cwd, timeout, cancel).await
}

/// Read a stream to EOF with a hard byte cap. Returns bytes plus whether it overflowed.
async fn drain<R: AsyncRead + Unpin>(reader: &mut R, cap: usize) -> (Vec<u8>, bool) {
	let mut buf = Vec::new();
	let mut chunk = [0u8; 8192];
	let mut overflow = false;
	loop {
		match reader.read(&mut chunk).await {
			Ok(0) => break,
			Ok(n) => {
				let room = cap.saturating_sub(buf.len());
				if n <= room {
					buf.extend_from_slice(&chunk[..n]);
				} else {
					buf.extend_from_slice(&chunk[..room]);
					overflow = true;
				}
			}
			Err(err) => {
				// A read error ends capture but must be reported in-band, never swallowed.
				eprintln!("kilo-host proc: stream read error: {err}");
				break;
			}
		}
	}
	(buf, overflow)
}

struct Guard {
	reg: Registry,
	pid: u32,
}

impl Drop for Guard {
	fn drop(&mut self) {
		self.reg.remove(self.pid);
	}
}

/// Signal the process group. Best effort: an already-dead group means our work is done,
/// but a failure to signal at all is logged.
fn kill_group(pid: u32) {
	#[cfg(unix)]
	{
		// Negative pid = process group. `/bin/kill` exists on macOS and Linux; if the
		// group kill fails we still try the direct child so nothing is left running.
		if signal(&format!("-{pid}")) {
			return;
		}
		eprintln!("kilo-host proc: group kill failed for pid {pid}, falling back to the direct child");
		let _ = signal(&pid.to_string());
	}
	#[cfg(not(unix))]
	{
		let _ = pid;
	}
}

#[cfg(unix)]
fn signal(target: &str) -> bool {
	std::process::Command::new("/bin/kill")
		.args(["-KILL", target])
		.stdout(std::process::Stdio::null())
		.stderr(std::process::Stdio::null())
		.status()
		.map(|s| s.success())
		.unwrap_or(false)
}
