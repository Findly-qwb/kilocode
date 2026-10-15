//! Crate-wide error type.
//!
//! Per repo style (`AGENTS.md`: no stringly-typed errors) every failure domain gets
//! a variant; `thiserror` supplies `Display`, and the IPC layer turns a `HostError`
//! into an `agent_error` event using `code()` for the stable wire tag.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, HostError>;

#[derive(Debug, Error)]
pub enum HostError {
	#[error("io {path}: {source}")]
	Io {
		path: String,
		#[source]
		source: std::io::Error,
	},

	#[error("sqlite: {0}")]
	Store(String),

	#[error("migration {from} -> {to} failed: {why}")]
	Migrate { from: i64, to: i64, why: String },

	#[error("schema too new: db={found} app={supported}")]
	SchemaVersion { found: i64, supported: i64 },

	#[error("git executable not found — install git, git features degrade to file snapshots only")]
	GitMissing,

	#[error("git {args:?} exited with {code}: {stderr}")]
	Git {
		args: Vec<String>,
		code: Option<i32>,
		stderr: String,
	},

	#[error("not a git repository: {path}")]
	NotRepo { path: String },

	#[error("checkpoint {id} not found in shadow repo {gitdir}")]
	CheckpointMissing { id: String, gitdir: String },

	#[error("permission engine: {0}")]
	Perms(String),

	#[error("approval channel closed before a decision arrived")]
	ApprovalClosed,

	#[error("session {0} not found")]
	SessionNotFound(String),

	#[error("scan aborted by budget or cancellation")]
	ScanAborted,

	#[error("preview too large: {bytes} bytes (limit {limit})")]
	TooLarge { bytes: u64, limit: u64 },

	#[error("process timed out after {secs}s and was killed")]
	TimedOut { secs: u64 },

	#[error("process failed: {0}")]
	Process(String),

	#[error("turn task panicked: {0}")]
	Panicked(String),

	#[error("task cancelled")]
	Cancelled,

	#[error("invalid input: {0}")]
	Invalid(String),

	#[error("feature not implemented in this milestone: {0}")]
	Unimplemented(String),
}

impl HostError {
	/// Stable `agent_error.code` tag (PLAN §9.1). Never derived from the message text,
	/// so the frontend can branch on it.
	pub fn code(&self) -> crate::ipc::ErrorCode {
		match self {
			HostError::Io { .. } => crate::ipc::ErrorCode::Io,
			HostError::Store(_) | HostError::ApprovalClosed => crate::ipc::ErrorCode::Storage,
			HostError::Migrate { .. } | HostError::SchemaVersion { .. } => crate::ipc::ErrorCode::Storage,
			HostError::GitMissing => crate::ipc::ErrorCode::GitMissing,
			HostError::Git { .. } | HostError::NotRepo { .. } | HostError::CheckpointMissing { .. } => {
				crate::ipc::ErrorCode::Git
			}
			HostError::Perms(_) => crate::ipc::ErrorCode::Config,
			HostError::SessionNotFound(_) | HostError::Invalid(_) => crate::ipc::ErrorCode::Config,
			HostError::ScanAborted => crate::ipc::ErrorCode::Cancelled,
			HostError::TooLarge { .. } => crate::ipc::ErrorCode::Budget,
			HostError::TimedOut { .. } => crate::ipc::ErrorCode::Timeout,
			HostError::Process(_) => crate::ipc::ErrorCode::Io,
			HostError::Panicked(_) => crate::ipc::ErrorCode::Panic,
			HostError::Cancelled => crate::ipc::ErrorCode::Cancelled,
			HostError::Unimplemented(_) => crate::ipc::ErrorCode::Config,
		}
	}

	/// Sanitised message for the wire / logs (PLAN §6.6: "日志与错误信息脱敏").
	pub fn safe(&self) -> String {
		crate::secret::redact(&self.to_string())
	}

	pub fn retryable(&self) -> bool {
		matches!(self, HostError::TimedOut { .. } | HostError::Process(_))
	}
}

impl From<std::io::Error> for HostError {
	fn from(err: std::io::Error) -> Self {
		HostError::Io { path: String::new(), source: err }
	}
}

impl From<rusqlite::Error> for HostError {
	fn from(err: rusqlite::Error) -> Self {
		HostError::Store(err.to_string())
	}
}
