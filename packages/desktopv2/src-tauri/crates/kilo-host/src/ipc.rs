//! IPC protocol — THE single source of truth (PLAN §9, §15, TODOS M6-16).
//!
//! Everything the WebView may send or receive is declared here and nowhere else.
//! TypeScript types are *generated* from this file (`cargo run -p kilo-host --bin
//! gen-ts` -> `crates/kilo-host/bindings/`), so the frontend cannot drift.
//!
//! Shape of the wire:
//!   * Rust -> frontend: a Tauri event channel named by [`Channel`] carrying
//!     [`Envelope`]; the concrete payload is [`Envelope::payload`]. Ordering/dedup
//!     uses `envelope.seq` (PLAN §5.3).
//!   * Frontend -> Rust: `invoke(name, args)` with one of the `*Args` structs
//!     (§9.2). [`Cmd`] enumerates them so the host can assert coverage.
//!
//! Field names follow PLAN §9.1/§9.2 verbatim (`snake_case`), matching the SQLite
//! columns in `store.rs` so a payload row maps 1:1 onto a table row.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The 20 Rust -> frontend event channels of PLAN §9.1. Keep in table order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Channel {
	Ready,
	TextDelta,
	ReasoningDelta,
	MessagePartUpserted,
	ToolCallStart,
	ToolCallOutputDelta,
	ToolCallResult,
	HumanConfirmRequired,
	QuestionRequired,
	TurnEnd,
	ContextUsage,
	AgentEnd,
	AgentError,
	CompactDone,
	FileChanged,
	GitStatusChanged,
	ScanProgress,
	McpStatus,
	SessionUpdated,
	QueueState,
}

impl Channel {
	/// Event-name string used as the Tauri channel.
	pub fn as_str(self) -> &'static str {
		match self {
			Channel::Ready => "ready",
			Channel::TextDelta => "text_delta",
			Channel::ReasoningDelta => "reasoning_delta",
			Channel::MessagePartUpserted => "message_part_upserted",
			Channel::ToolCallStart => "tool_call_start",
			Channel::ToolCallOutputDelta => "tool_call_output_delta",
			Channel::ToolCallResult => "tool_call_result",
			Channel::HumanConfirmRequired => "human_confirm_required",
			Channel::QuestionRequired => "question_required",
			Channel::TurnEnd => "turn_end",
			Channel::ContextUsage => "context_usage",
			Channel::AgentEnd => "agent_end",
			Channel::AgentError => "agent_error",
			Channel::CompactDone => "compact_done",
			Channel::FileChanged => "file_changed",
			Channel::GitStatusChanged => "git_status_changed",
			Channel::ScanProgress => "scan_progress",
			Channel::McpStatus => "mcp_status",
			Channel::SessionUpdated => "session_updated",
			Channel::QueueState => "queue_state",
		}
	}

	pub fn all() -> [Channel; 20] {
		[
			Channel::Ready,
			Channel::TextDelta,
			Channel::ReasoningDelta,
			Channel::MessagePartUpserted,
			Channel::ToolCallStart,
			Channel::ToolCallOutputDelta,
			Channel::ToolCallResult,
			Channel::HumanConfirmRequired,
			Channel::QuestionRequired,
			Channel::TurnEnd,
			Channel::ContextUsage,
			Channel::AgentEnd,
			Channel::AgentError,
			Channel::CompactDone,
			Channel::FileChanged,
			Channel::GitStatusChanged,
			Channel::ScanProgress,
			Channel::McpStatus,
			Channel::SessionUpdated,
			Channel::QueueState,
		]
	}
}

/// A payload that may travel on a channel. `CHANNEL` is what makes the protocol
/// exhaustive-checkable: `adapt` must be able to produce every one of the 20.
pub trait Payload: Serialize + TS {
	const CHANNEL: Channel;
}

/// Envelope every emitted event is wrapped in (PLAN §5.3: session_id + turn_index +
/// seq, so the frontend can dedup, sort and request `resync`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Envelope {
	pub session_id: String,
	pub turn_index: i64,
	pub seq: i64,
	/// Unix ms.
	pub ts: i64,
	pub channel: Channel,
	/// Serialised [`Payload`]. The concrete TS type is keyed by `channel`; see the
	/// generated `channel-map.ts`.
	pub payload: serde_json::Value,
}

impl Envelope {
	pub fn new(session_id: impl Into<String>, turn_index: i64, seq: i64, payload: &dyn Payloadish) -> Self {
		Self {
			session_id: session_id.into(),
			turn_index,
			seq,
			ts: now_ms(),
			channel: payload.channel(),
			payload: payload.to_value(),
		}
	}
}

/// Object-safe counterpart of [`Payload`] so the hub can hold `&dyn`.
pub trait Payloadish: Serialize {
	fn channel(&self) -> Channel;
	fn to_value(&self) -> serde_json::Value {
		serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
	}
}

macro_rules! payload {
	($t:ty => $c:ident) => {
		impl Payload for $t {
			const CHANNEL: Channel = Channel::$c;
		}
		impl Payloadish for $t {
			fn channel(&self) -> Channel {
				Channel::$c
			}
		}
	};
}

pub fn now_ms() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

/* ------------------------------------------------------------------ *
 * §9.1 events
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct Ready {
	pub app_version: String,
	pub runtime_version: String,
	pub schema_version: i64,
}
payload!(Ready => Ready);

/// Text/thought stream position. `seq` is repeated inside the payload on purpose:
/// PLAN §9.1 lists it there, and `text_delta` is the one event the frontend may want
/// to coalesce without unwrapping the envelope. Ordering authority is `Envelope::seq`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct TextDelta {
	pub session_id: String,
	pub message_id: String,
	pub seq: i64,
	pub delta: String,
}
payload!(TextDelta => TextDelta);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ReasoningDelta {
	pub session_id: String,
	pub message_id: String,
	pub seq: i64,
	pub delta: String,
}
payload!(ReasoningDelta => ReasoningDelta);

/// Mirrors the `parts` table (PLAN §10) so a part upsert needs no translation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct Part {
	pub id: String,
	pub message_id: String,
	pub seq: i64,
	/// text | reasoning | tool | question | approval | compact | error
	pub r#type: PartKind,
	pub tool_name: Option<String>,
	pub tool_source: Option<String>,
	pub call_id: Option<String>,
	pub state: Option<String>,
	/// JSON blob, schema depends on `type`.
	pub content: serde_json::Value,
	pub created_at: i64,
	pub updated_at: i64,
}
payload!(Part => MessagePartUpserted);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum PartKind {
	Text,
	Reasoning,
	Tool,
	Question,
	Approval,
	Compact,
	Error,
}

impl PartKind {
	/// `parts.type` column value (PLAN §10 comment: text|reasoning|tool|question|approval|compact|error).
	pub fn as_str(self) -> &'static str {
		match self {
			PartKind::Text => "text",
			PartKind::Reasoning => "reasoning",
			PartKind::Tool => "tool",
			PartKind::Question => "question",
			PartKind::Approval => "approval",
			PartKind::Compact => "compact",
			PartKind::Error => "error",
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ToolCallStart {
	pub call_id: String,
	pub tool_name: String,
	/// rpi | desktop | mcp — drives the tool-card variant.
	pub source: String,
	pub args: serde_json::Value,
	pub session_id: String,
	pub turn_index: i64,
}
payload!(ToolCallStart => ToolCallStart);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ToolCallOutputDelta {
	pub call_id: String,
	pub chunk: String,
}
payload!(ToolCallOutputDelta => ToolCallOutputDelta);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ToolCallResult {
	pub call_id: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub result: Option<serde_json::Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	pub duration_ms: i64,
	pub truncated: bool,
}
payload!(ToolCallResult => ToolCallResult);

/// What the approval card should render. PLAN §9.1: `kind: command|paths|diff`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ConfirmKind {
	Command,
	Paths,
	Diff,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct HumanConfirmRequired {
	pub call_id: String,
	pub tool_name: String,
	pub source: String,
	pub kind: ConfirmKind,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub paths: Option<Vec<String>>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub diff: Option<String>,
	/// Human-readable description of the rule that produced this approval request,
	/// resolved by the engine — never hardcoded in the card (TODOS M3-4).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matched_rule: Option<String>,
	/// Unix ms of the 30-minute deadline; past it the host auto-denies (§3.3).
	pub expires_at: i64,
}
payload!(HumanConfirmRequired => HumanConfirmRequired);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct Question {
	pub q: String,
	pub options: Vec<String>,
	pub allow_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct QuestionRequired {
	pub question_id: String,
	pub session_id: String,
	pub questions: Vec<Question>,
}
payload!(QuestionRequired => QuestionRequired);

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct Tokens {
	pub prompt: i64,
	pub completion: i64,
	pub reasoning: i64,
	pub cache_read: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct TurnEnd {
	pub turn_index: i64,
	pub tokens: Tokens,
	/// Estimate only — the UI must label it as such (PLAN §14).
	pub cost_estimate: f64,
	pub model: String,
}
payload!(TurnEnd => TurnEnd);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ContextUsage {
	pub used: i64,
	pub reserved: i64,
	pub window: i64,
	pub auto_compact_at: i64,
	/// Prompt-cache hit rate, 0..=1.
	pub hit_rate: f64,
}
payload!(ContextUsage => ContextUsage);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum AgentEndReason {
	Done,
	Stopped,
	Limit,
	Error,
	Panic,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct AgentEnd {
	pub reason: AgentEndReason,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub summary: Option<String>,
}
payload!(AgentEnd => AgentEnd);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Level {
	Info,
	Warn,
	Error,
}

/// Stable error tags. The frontend error cards (TODOS M1-25) branch on these, so the
/// set is part of the protocol — extend deliberately, never rename.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ErrorCode {
	NotConfigured,
	Unauthorized,
	RateLimited,
	Unreachable,
	Provider,
	Timeout,
	Budget,
	LoopDetected,
	Cancelled,
	Panic,
	Config,
	Storage,
	Git,
	GitMissing,
	Io,
	Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct AgentError {
	pub level: Level,
	pub code: ErrorCode,
	/// Already redacted (PLAN §6.6); never contains keys or tokens.
	pub message: String,
	pub retryable: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub retry_in_ms: Option<i64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub attempt: Option<i64>,
	/// Terminates the Turn; UI shows "retry / rollback to checkpoint" (PLAN §3.3).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub fatal: Option<bool>,
}
payload!(AgentError => AgentError);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct CompactDone {
	pub from_turn: i64,
	pub tokens_before: i64,
	pub tokens_after: i64,
}
payload!(CompactDone => CompactDone);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct FileChanged {
	pub paths: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub session_id: Option<String>,
}
payload!(FileChanged => FileChanged);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct GitFile {
	pub path: String,
	/// porcelain=v2 XY shorthand, e.g. "M", "A", "??", "R".
	pub status: String,
	pub added: i64,
	pub deleted: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct GitStatusChanged {
	pub branch: String,
	pub ahead: i64,
	pub behind: i64,
	pub files: Vec<GitFile>,
}
payload!(GitStatusChanged => GitStatusChanged);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ScanProgress {
	pub project: String,
	pub scanned: i64,
	/// 0 while unknown (the walker cannot know the total up front for a live tree).
	pub total: i64,
	/// walk | gitignore | cache | done | cancelled
	pub phase: String,
}
payload!(ScanProgress => ScanProgress);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum McpState {
	Connecting,
	Connected,
	NeedsAuth,
	Failed,
	Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct McpStatus {
	pub server: String,
	pub status: McpState,
	pub tools: i64,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}
payload!(McpStatus => McpStatus);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Activity {
	Idle,
	Running,
	AwaitingInput,
	AwaitingApproval,
	Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionUpdated {
	pub session_id: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub title: Option<String>,
	pub updated_at: i64,
	pub activity: Activity,
}
payload!(SessionUpdated => SessionUpdated);

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct QueueItem {
	pub id: String,
	pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct QueueState {
	pub main: Vec<QueueItem>,
	pub steering: Vec<QueueItem>,
	pub follow_up: Vec<QueueItem>,
}
payload!(QueueState => QueueState);

/* ------------------------------------------------------------------ *
 * §9.2 commands
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Mode {
	Ask,
	Plan,
	Code,
}

impl Mode {
	pub fn as_str(self) -> &'static str {
		match self {
			Mode::Ask => "ask",
			Mode::Plan => "plan",
			Mode::Code => "code",
		}
	}

	pub fn parse(raw: &str) -> Option<Mode> {
		match raw {
			"ask" => Some(Mode::Ask),
			"plan" => Some(Mode::Plan),
			"code" => Some(Mode::Code),
			other => {
				let _ = other;
				None
			}
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Decision {
	Allow,
	Deny,
	/// Writes a session-scoped rule (TODOS M3-5).
	AllowAlways,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum QueueOp {
	Edit,
	Delete,
	Promote,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub struct ContextRef {
	pub path: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub anchor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub struct Attachment {
	pub id: String,
	/// image | file | context_ref
	pub kind: String,
	pub name: String,
	pub mime: Option<String>,
	pub bytes: Option<i64>,
	pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SubmitMessageArgs {
	pub session_id: String,
	pub text: String,
	#[serde(default)]
	pub attachments: Vec<Attachment>,
	#[serde(default)]
	pub context_refs: Vec<ContextRef>,
	pub mode: Mode,
	pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SubmitSteeringArgs {
	pub session_id: String,
	pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct QueueActionArgs {
	pub id: String,
	pub op: QueueOp,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ApproveToolCallArgs {
	pub call_id: String,
	pub decision: Decision,
	/// "Run with edited args" — the host executes these instead (§6.6, M3-5).
	#[serde(skip_serializing_if = "Option::is_none")]
	pub modified_args: Option<serde_json::Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct AnswerQuestionArgs {
	pub question_id: String,
	pub answers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SubmitFrontendResultArgs {
	pub call_id: String,
	pub result: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct StopAgentArgs {
	pub session_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionListArgs {
	pub project_id: Option<String>,
	pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionCreateArgs {
	pub project_id: String,
	pub title: String,
	pub mode: Mode,
	pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionIdArgs {
	pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionRenameArgs {
	pub session_id: String,
	pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionDeleteArgs {
	pub session_id: String,
	/// Soft delete; `undo_window_ms` gives the snackbar its lifetime (M2-3).
	pub undo_window_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionForkArgs {
	pub session_id: String,
	/// Fork point; defaults to the tail.
	pub at_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SessionLoadArgs {
	pub session_id: String,
	/// Exclusive upper bound (message id or timestamp) for reverse paging.
	pub before: Option<String>,
	pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct RevertArgs {
	pub session_id: String,
	pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct PermissionSetArgs {
	/// One of the four PLAN §6.6 layers; `perms::Scope` is the only definition of them.
	pub scope: crate::perms::Scope,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub scope_ref: Option<String>,
	pub tool: String,
	pub policy: crate::perms::Policy,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub matcher: Option<crate::perms::Matcher>,
	#[serde(default)]
	pub exceptions: Vec<crate::perms::Exception>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct ResyncArgs {
	pub session_id: String,
	pub since_seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct GitPathArgs {
	pub project_path: String,
	#[serde(default)]
	pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct GitCommitArgs {
	pub project_path: String,
	pub message: String,
	#[serde(default)]
	pub stage_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SetModeArgs {
	pub session_id: String,
	pub mode: Mode,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "protocol/")]
pub struct SetModelArgs {
	pub session_id: String,
	pub model: String,
	pub variant: Option<String>,
}

/// §9.2 command names, grouped exactly as the table rows. `Cmd` is what the app crate
/// registers, and `names()` lets a test assert the table is fully covered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmd {
	SubmitMessage,
	SubmitSteering,
	QueueAction,
	ApproveToolCall,
	AnswerQuestion,
	SubmitFrontendResult,
	StopAgent,
	SessionList,
	SessionCreate,
	SessionRename,
	SessionDelete,
	SessionFork,
	SessionExport,
	SessionLoad,
	RevertToMessage,
	RedoStep,
	PermissionSet,
	McpUpsert,
	McpDelete,
	McpToggle,
	McpRetry,
	SkillUpsert,
	SkillDelete,
	SkillToggle,
	ProviderUpsert,
	ProviderDelete,
	ProviderTest,
	FsScan,
	FsTree,
	FsPreview,
	FsSearch,
	GitStatus,
	GitDiff,
	GitStage,
	GitUnstage,
	GitCommit,
	GitPush,
	GitGenerateMessage,
	TerminalOpen,
	TerminalWrite,
	TerminalResize,
	TerminalClose,
	CompactNow,
	SetMode,
	SetModel,
	SettingsGet,
	SettingsSet,
	SkinList,
	SkinApply,
	SkinImport,
	Resync,
}

impl Cmd {
	pub fn all() -> Vec<Cmd> {
		vec![
			Cmd::SubmitMessage,
			Cmd::SubmitSteering,
			Cmd::QueueAction,
			Cmd::ApproveToolCall,
			Cmd::AnswerQuestion,
			Cmd::SubmitFrontendResult,
			Cmd::StopAgent,
			Cmd::SessionList,
			Cmd::SessionCreate,
			Cmd::SessionRename,
			Cmd::SessionDelete,
			Cmd::SessionFork,
			Cmd::SessionExport,
			Cmd::SessionLoad,
			Cmd::RevertToMessage,
			Cmd::RedoStep,
			Cmd::PermissionSet,
			Cmd::McpUpsert,
			Cmd::McpDelete,
			Cmd::McpToggle,
			Cmd::McpRetry,
			Cmd::SkillUpsert,
			Cmd::SkillDelete,
			Cmd::SkillToggle,
			Cmd::ProviderUpsert,
			Cmd::ProviderDelete,
			Cmd::ProviderTest,
			Cmd::FsScan,
			Cmd::FsTree,
			Cmd::FsPreview,
			Cmd::FsSearch,
			Cmd::GitStatus,
			Cmd::GitDiff,
			Cmd::GitStage,
			Cmd::GitUnstage,
			Cmd::GitCommit,
			Cmd::GitPush,
			Cmd::GitGenerateMessage,
			Cmd::TerminalOpen,
			Cmd::TerminalWrite,
			Cmd::TerminalResize,
			Cmd::TerminalClose,
			Cmd::CompactNow,
			Cmd::SetMode,
			Cmd::SetModel,
			Cmd::SettingsGet,
			Cmd::SettingsSet,
			Cmd::SkinList,
			Cmd::SkinApply,
			Cmd::SkinImport,
			Cmd::Resync,
		]
	}

	/// Tauri `invoke` name — identical to the §9.2 table.
	pub fn name(self) -> &'static str {
		match self {
			Cmd::SubmitMessage => "submit_message",
			Cmd::SubmitSteering => "submit_steering",
			Cmd::QueueAction => "queue_action",
			Cmd::ApproveToolCall => "approve_tool_call",
			Cmd::AnswerQuestion => "answer_question",
			Cmd::SubmitFrontendResult => "submit_frontend_result",
			Cmd::StopAgent => "stop_agent",
			Cmd::SessionList => "session_list",
			Cmd::SessionCreate => "session_create",
			Cmd::SessionRename => "session_rename",
			Cmd::SessionDelete => "session_delete",
			Cmd::SessionFork => "session_fork",
			Cmd::SessionExport => "session_export",
			Cmd::SessionLoad => "session_load",
			Cmd::RevertToMessage => "revert_to_message",
			Cmd::RedoStep => "redo_step",
			Cmd::PermissionSet => "permission_set",
			Cmd::McpUpsert => "mcp_upsert",
			Cmd::McpDelete => "mcp_delete",
			Cmd::McpToggle => "mcp_toggle",
			Cmd::McpRetry => "mcp_retry",
			Cmd::SkillUpsert => "skill_upsert",
			Cmd::SkillDelete => "skill_delete",
			Cmd::SkillToggle => "skill_toggle",
			Cmd::ProviderUpsert => "provider_upsert",
			Cmd::ProviderDelete => "provider_delete",
			Cmd::ProviderTest => "provider_test",
			Cmd::FsScan => "fs_scan",
			Cmd::FsTree => "fs_tree",
			Cmd::FsPreview => "fs_preview",
			Cmd::FsSearch => "fs_search",
			Cmd::GitStatus => "git_status",
			Cmd::GitDiff => "git_diff",
			Cmd::GitStage => "git_stage",
			Cmd::GitUnstage => "git_unstage",
			Cmd::GitCommit => "git_commit",
			Cmd::GitPush => "git_push",
			Cmd::GitGenerateMessage => "git_generate_message",
			Cmd::TerminalOpen => "terminal_open",
			Cmd::TerminalWrite => "terminal_write",
			Cmd::TerminalResize => "terminal_resize",
			Cmd::TerminalClose => "terminal_close",
			Cmd::CompactNow => "compact_now",
			Cmd::SetMode => "set_mode",
			Cmd::SetModel => "set_model",
			Cmd::SettingsGet => "settings_get",
			Cmd::SettingsSet => "settings_set",
			Cmd::SkinList => "skin_list",
			Cmd::SkinApply => "skin_apply",
			Cmd::SkinImport => "skin_import",
			Cmd::Resync => "resync",
		}
	}

	/// Feature-gated: the terminal is opt-in (PLAN §13), default off.
	pub fn gated(self) -> bool {
		matches!(self, Cmd::TerminalOpen | Cmd::TerminalWrite | Cmd::TerminalResize | Cmd::TerminalClose)
	}
}
