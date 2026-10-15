/**
 * IPC 协议（PLAN §9）。这里是前端的唯一协议来源，Rust 侧 `ipc.rs` 与之对齐，
 * 由 ts-rs 生成类型覆盖本文件的 payload 定义（M6-16）。
 *
 * 事件带 (session_id, turn_index, seq) 三元组：乱序丢弃并请求 resync（PLAN §5.3）。
 */

export type Mode = "ask" | "plan" | "code";
export type Policy = "deny" | "require_approval" | "auto";
export type ToolSource = "rpi" | "kilo" | "mcp";
export type PartType = "text" | "reasoning" | "tool" | "question" | "approval" | "compact" | "error";
export type Activity = "idle" | "running" | "awaiting_input" | "awaiting_approval" | "error";

export type Ready = { app_version: string; runtime_version: string; schema_version: number };
export type TextDelta = { session_id: string; message_id: string; seq: number; delta: string };
export type ReasoningDelta = TextDelta;
export type Part = {
  id: string;
  message_id: string;
  seq: number;
  type: PartType;
  tool_name?: string;
  tool_source?: ToolSource;
  call_id?: string;
  state?: "pending" | "running" | "ok" | "err" | "awaiting_approval" | "denied";
  content: unknown;
};
export type PartUpserted = { session_id: string; part: Part };
export type ToolCallStart = {
  call_id: string;
  tool_name: string;
  source: ToolSource;
  args: Record<string, unknown>;
  session_id: string;
  turn_index: number;
};
export type ToolCallOutputDelta = { call_id: string; chunk: string };
export type ToolCallResult = {
  call_id: string;
  result?: unknown;
  error?: string;
  duration_ms: number;
  truncated: boolean;
};
export type ConfirmKind = "command" | "paths" | "diff";
export type HumanConfirmRequired = {
  call_id: string;
  tool_name: string;
  source: ToolSource;
  kind: ConfirmKind;
  command?: string;
  paths?: string[];
  diff?: string;
  matched_rule?: { scope: string; policy: Policy; matcher?: string };
  homoglyph?: boolean;
  expires_at: number;
};
export type QuestionRequired = {
  question_id: string;
  session_id: string;
  questions: { q: string; options: string[]; allow_custom: boolean }[];
};
export type TurnEnd = {
  turn_index: number;
  tokens: { prompt: number; completion: number; reasoning: number; cache_read: number };
  cost_estimate: number;
  model: string;
};
export type ContextUsage = {
  used: number;
  reserved: number;
  window: number;
  auto_compact_at: number;
  hit_rate: number;
};
export type AgentEnd = { reason: "done" | "stopped" | "limit" | "error" | "panic"; summary?: string };
export type AgentError = {
  level: "warn" | "error";
  code:
    | "no_endpoint"
    | "unauthorized"
    | "rate_limited"
    | "unreachable"
    | "provider"
    | "tool_timeout"
    | "sqlite_io"
    | "panic"
    | "loop_breaker";
  message: string;
  retryable: boolean;
  retry_in_ms?: number;
  attempt?: number;
  fatal?: boolean;
};
export type CompactDone = { from_turn: number; tokens_before: number; tokens_after: number };
export type FileChanged = { paths: string[]; session_id?: string };
export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  files: { path: string; status: "M" | "A" | "D" | "?" | "R"; added: number; deleted: number }[];
};
export type ScanProgress = { project: string; scanned: number; total: number; phase: "walk" | "ignore" | "done" };
export type McpStatus = {
  server: string;
  status: "connecting" | "connected" | "needs_auth" | "failed" | "disabled";
  tools: number;
  error?: string;
};
export type SessionUpdated = { session_id: string; title?: string; updated_at: number; activity: Activity };
export type QueueState = {
  main: { id: string; text: string }[];
  steering: { id: string; text: string }[];
  follow_up: { id: string; text: string }[];
};

/** PLAN §9.1 的 20 个事件，键名即 Tauri event 名 */
export type Events = {
  ready: Ready;
  text_delta: TextDelta;
  reasoning_delta: ReasoningDelta;
  message_part_upserted: PartUpserted;
  tool_call_start: ToolCallStart;
  tool_call_output_delta: ToolCallOutputDelta;
  tool_call_result: ToolCallResult;
  human_confirm_required: HumanConfirmRequired;
  question_required: QuestionRequired;
  turn_end: TurnEnd;
  context_usage: ContextUsage;
  agent_end: AgentEnd;
  agent_error: AgentError;
  compact_done: CompactDone;
  file_changed: FileChanged;
  git_status_changed: GitStatus;
  scan_progress: ScanProgress;
  mcp_status: McpStatus;
  session_updated: SessionUpdated;
  queue_state: QueueState;
};

export type EventName = keyof Events;

export const EVENT_NAMES: EventName[] = [
  "ready",
  "text_delta",
  "reasoning_delta",
  "message_part_upserted",
  "tool_call_start",
  "tool_call_output_delta",
  "tool_call_result",
  "human_confirm_required",
  "question_required",
  "turn_end",
  "context_usage",
  "agent_end",
  "agent_error",
  "compact_done",
  "file_changed",
  "git_status_changed",
  "scan_progress",
  "mcp_status",
  "session_updated",
  "queue_state",
];

export type Attachment = { id: string; kind: "image" | "file" | "context_ref"; name: string; mime?: string; bytes?: number; path?: string; data?: string };

/** PLAN §9.2 的命令表：入参 -> 返回 */
export type Commands = {
  submit_message: [{ session_id: string; text: string; attachments?: Attachment[]; context_refs?: string[]; mode: Mode; model: string }, { turn_index: number }];
  submit_steering: [{ session_id: string; text: string }, void];
  queue_action: [{ id: string; op: "edit" | "delete" | "promote"; text?: string }, void];
  approve_tool_call: [
    { call_id: string; decision: "allow" | "deny" | "allow_always"; modified_args?: Record<string, unknown>; reason?: string },
    void,
  ];
  answer_question: [{ question_id: string; answers: string[] }, void];
  submit_frontend_result: [{ call_id: string; result: unknown }, void];
  stop_agent: [{ session_id: string }, void];
  session_list: [{ project_id?: string; query?: string }, SessionRow[]];
  session_create: [{ project_id: string; title?: string }, SessionRow];
  session_rename: [{ session_id: string; title: string }, void];
  session_delete: [{ session_id: string }, { undo_token: string }];
  session_undo: [{ undo_token: string }, void];
  session_fork: [{ session_id: string; message_id?: string }, SessionRow];
  session_export: [{ session_id: string }, string];
  session_load: [{ session_id: string; before?: number; limit?: number }, { messages: MessageRow[]; parts: Part[]; has_more: boolean }];
  revert_to_message: [{ session_id: string; message_id: string }, { files: string[] }];
  redo_step: [{ session_id: string; message_id: string }, { files: string[] }];
  permission_set: [
    { scope: "global" | "project" | "session" | "mode"; scope_ref?: string; tool: string; policy: Policy; matcher?: string; exceptions?: { matcher: string; policy: Policy }[] },
    Effective[],
  ];
  permission_effective: [{ session_id: string }, Effective[]];
  mcp_upsert: [{ id?: string; name: string; transport: "stdio" | "sse" | "http"; config: Record<string, unknown>; enabled: boolean }, void];
  mcp_delete: [{ id: string }, void];
  mcp_toggle: [{ id: string; enabled: boolean }, void];
  mcp_retry: [{ id: string }, void];
  mcp_list: [void, McpRow[]];
  skill_upsert: [{ id?: string; command: string; name?: string; description?: string; system_prompt: string; model?: string; variant?: string; scope: "global" | "project" | "builtin"; path?: string; enabled: boolean }, void];
  skill_delete: [{ id: string }, void];
  skill_toggle: [{ id: string; enabled: boolean }, void];
  skill_list: [{ project?: string }, SkillRow[]];
  provider_upsert: [{ id?: string; name: string; base_url: string; api_key?: string; key_ref?: string; models?: string[] }, ProviderRow];
  provider_delete: [{ id: string }, void];
  provider_test: [{ id?: string; base_url: string; api_key?: string }, { ok: boolean; models: string[]; error?: string }];
  fs_scan: [{ project: string; cancel?: boolean }, void];
  fs_tree: [{ project: string; path?: string }, FsNode[]];
  fs_preview: [{ path: string; limit?: number }, { text?: string; image?: string; truncated: boolean; bytes: number }];
  fs_search: [{ project: string; query: string }, FsNode[]];
  git_status: [{ project: string }, GitStatus];
  git_diff: [{ project: string; path?: string; staged?: boolean }, string];
  git_stage: [{ project: string; paths: string[] }, void];
  git_unstage: [{ project: string; paths: string[] }, void];
  git_commit: [{ project: string; message: string; all?: boolean }, { oid: string }];
  git_push: [{ project: string }, void];
  git_generate_message: [{ project: string }, { message: string }];
  terminal_open: [{ project: string; cols: number; rows: number }, { id: string }];
  terminal_write: [{ id: string; data: string }, void];
  terminal_resize: [{ id: string; cols: number; rows: number }, void];
  terminal_close: [{ id: string }, void];
  compact_now: [{ session_id: string }, void];
  set_mode: [{ session_id: string; mode: Mode }, void];
  set_model: [{ session_id: string; model: string; variant?: string }, void];
  settings_get: [void, Settings];
  settings_set: [{ patch: Partial<Settings> }, Settings];
  skin_list: [void, { id: string; name: string; mode: string; imported: boolean }[]];
  skin_apply: [{ id: string }, { ok: boolean; error?: string }];
  skin_import: [{ text: string }, { ok: boolean; error?: string }];
  project_open: [{ path: string }, { id: string; name: string; is_git: boolean }];
  project_list: [void, ProjectRow[]];
  resync: [{ session_id: string; since_seq: number }, Part[]];
};

export type CommandName = keyof Commands;

export type SessionRow = {
  id: string;
  project_id: string;
  title: string;
  mode: Mode;
  model?: string;
  variant?: string;
  status: Activity;
  total_tokens: number;
  cost_estimate: number;
  pinned: boolean;
  updated_at: number;
  created_at: number;
};

export type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  turn_index?: number;
  status: "streaming" | "complete" | "stopped" | "error";
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cost_estimate?: number;
  model?: string;
  created_at: number;
};

export type Effective = { tool: string; policy: Policy; from: string; matcher?: string; note?: string };
export type McpRow = { id: string; name: string; transport: string; enabled: boolean; status: string; tools: number; last_error?: string };
export type SkillRow = { id: string; command: string; name?: string; description?: string; scope: string; enabled: boolean; path?: string };
export type ProviderRow = { id: string; name: string; base_url: string; models: string[]; key_ref?: string; has_key: boolean; last_check?: number };
export type FsNode = { path: string; name: string; dir: boolean; size?: number; ignored?: boolean };
export type ProjectRow = { id: string; path: string; name: string; is_git: boolean; last_opened?: number; sessions?: number };

export type Settings = {
  skin: string;
  fontScale: number;
  density: "comfortable" | "compact";
  collapseLeft: boolean;
  collapseRight: boolean;
  lang: "zh" | "en";
  mode: Mode;
  model?: string;
  variant?: string;
  maxTurns: number;
  shellTimeout: number;
  costCap: number;
  repeatBreaker: number;
  autoCompactAt: number;
  injectLimitKb: number;
  ignorePatterns: string;
  gitBackend: "cli" | "none";
  commitPolicy: Policy;
  pushPolicy: Policy;
  snapshotKeep: number;
  scanDepth: number;
  scanFiles: number;
  attachMaxMb: number;
  notifyTurnEnd: boolean;
  notifyApproval: boolean;
  notifyError: boolean;
  notifySound: boolean;
  quietHours: string;
  experimentalTerminal: boolean;
  experimentalSandbox: boolean;
  experimentalIndex: boolean;
  about: { app: string; runtime: string; schema: number; dataDir: string };
};
