/**
 * 消息 store（PLAN §5.3）。语义对齐 assistant-ui 的 ExternalStoreRuntime：
 * 前端不自己造消息状态机，只吃 Rust 事件流并派生 part 级状态。
 *
 * 事件按 (session_id, turn_index, seq) 去重排序；乱序即丢弃并请求 resync（§5.3 末段）。
 */
import type {
  AgentEnd,
  AgentError,
  ContextUsage,
  Events,
  FileChanged,
  GitStatus,
  HumanConfirmRequired,
  McpStatus,
  Part,
  QuestionRequired,
  QueueState,
  ScanProgress,
  SessionRow,
  SessionUpdated,
  TurnEnd,
} from "./protocol";

export type ToolPart = {
  kind: "tool";
  call_id: string;
  tool_name: string;
  source: string;
  args: Record<string, unknown>;
  turn_index: number;
  state: "running" | "ok" | "err" | "awaiting_approval" | "denied";
  output: string;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  truncated?: boolean;
  confirm?: HumanConfirmRequired;
};

export type Block =
  | { kind: "text"; id: string; text: string; streaming?: boolean }
  | { kind: "reasoning"; id: string; text: string; streaming?: boolean; ms?: number }
  | { kind: "compact"; id: string; from_turn: number; before: number; after: number }
  | { kind: "error"; id: string; err: AgentError }
  | { kind: "outcome"; id: string; end: AgentEnd; turn?: TurnEnd }
  | { kind: "question"; id: string; q: QuestionRequired; answered?: boolean }
  | (ToolPart & { kind: "tool" });

export type Message = {
  id: string;
  role: "user" | "assistant";
  turn_index?: number;
  created_at: number;
  text?: string;
  attachments?: { id: string; kind: string; name: string; mime?: string; bytes?: number; data?: string }[];
  context_refs?: string[];
  blocks: Block[];
  status: "streaming" | "complete" | "stopped" | "error";
};

export type State = {
  session?: string;
  messages: Message[];
  activity: SessionRow["status"];
  queue: QueueState;
  usage?: ContextUsage;
  git?: GitStatus;
  files: FileChanged[];
  scan?: ScanProgress;
  mcp: Record<string, McpStatus>;
  sessions: SessionRow[];
  lastSeq: Record<string, number>;
  caps: { turns: number; cost: number };
};

export const empty = (): State => ({
  messages: [],
  files: [],
  activity: "idle",
  queue: { main: [], steering: [], follow_up: [] },
  mcp: {},
  sessions: [],
  lastSeq: {},
  caps: { turns: 10, cost: 0 },
});

type Listener = () => void;

export class Runtime {
  state: State = empty();
  private subs = new Set<Listener>();
  private hook?: (since: number) => void;

  subscribe(fn: Listener) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** 事件断流后的补齐回调由 bridge 注入 */
  onResync(fn: (since: number) => void) {
    this.hook = fn;
  }

  emit() {
    for (const fn of this.subs) fn();
  }

  reset(next: Partial<State> = {}) {
    this.state = { ...empty(), ...next };
    this.emit();
  }

  private msg(id: string, role: Message["role"] = "assistant") {
    const hit = this.state.messages.find((m) => m.id === id);
    if (hit) return hit;
    const fresh: Message = { id, role, created_at: Date.now(), blocks: [], status: "streaming" };
    this.state.messages = [...this.state.messages, fresh];
    return fresh;
  }

  /** 单调 seq：相等即重复投递直接忽略，回退投递丢弃并请求 resync（PLAN §5.3） */
  private seqOk(scope: string, seq?: number) {
    if (seq === undefined) return true;
    const prev = this.state.lastSeq[scope] ?? -1;
    if (seq <= prev) {
      if (seq < prev) this.hook?.(prev);
      return false;
    }
    this.state.lastSeq[scope] = seq;
    return true;
  }

  private pushBlock(mid: string, block: Block) {
    const m = this.msg(mid);
    m.blocks = [...m.blocks, block];
  }

  private findTool(call_id: string) {
    for (const m of this.state.messages) {
      const i = m.blocks.findIndex((b) => b.kind === "tool" && b.call_id === call_id);
      if (i >= 0) return { m, i, t: m.blocks[i] as ToolPart };
    }
    return null;
  }

  private patchTool(call_id: string, patch: Partial<ToolPart>) {
    const hit = this.findTool(call_id);
    if (!hit) return;
    hit.m.blocks = hit.m.blocks.map((b, i) => (i === hit.i ? { ...(b as ToolPart), ...patch } : b));
  }

  feed<E extends keyof Events>(name: E, payload: Events[E]) {
    const s = this.state;
    switch (name) {
      case "text_delta": {
        const p = payload as Events["text_delta"];
        if (!this.seqOk(`${p.message_id}`, p.seq)) return;
        const m = this.msg(p.message_id);
        const i = m.blocks.findIndex((b) => b.kind === "text" && b.id === p.message_id);
        if (i < 0) m.blocks = [...m.blocks, { kind: "text", id: p.message_id, text: p.delta, streaming: true }];
        else
          m.blocks = m.blocks.map((b, n) =>
            n === i && b.kind === "text" ? { ...b, text: b.text + p.delta } : b,
          );
        break;
      }
      case "reasoning_delta": {
        const p = payload as Events["reasoning_delta"];
        if (!this.seqOk(`${p.message_id}:r`, p.seq)) return;
        const m = this.msg(p.message_id);
        const key = `${p.message_id}:r`;
        const i = m.blocks.findIndex((b) => b.kind === "reasoning" && b.id === key);
        if (i < 0) m.blocks = [...m.blocks, { kind: "reasoning", id: key, text: p.delta, streaming: true }];
        else
          m.blocks = m.blocks.map((b, n) =>
            n === i && b.kind === "reasoning" ? { ...b, text: b.text + p.delta } : b,
          );
        break;
      }
      case "message_part_upserted": {
        const p = payload as Events["message_part_upserted"];
        this.applyPart(p.part);
        break;
      }
      case "tool_call_start": {
        const p = payload as Events["tool_call_start"];
        const m = this.msg(`${p.session_id}:${p.turn_index}`);
        m.blocks = [
          ...m.blocks,
          { kind: "tool", call_id: p.call_id, tool_name: p.tool_name, source: p.source, args: p.args, turn_index: p.turn_index, state: "running", output: "" },
        ];
        break;
      }
      case "tool_call_output_delta": {
        const p = payload as Events["tool_call_output_delta"];
        const hit = this.findTool(p.call_id);
        if (hit) this.patchTool(p.call_id, { output: hit.t.output + p.chunk });
        break;
      }
      case "tool_call_result": {
        const p = payload as Events["tool_call_result"];
        this.patchTool(p.call_id, {
          state: p.error ? "err" : "ok",
          result: p.result,
          error: p.error,
          duration_ms: p.duration_ms,
          truncated: p.truncated,
        });
        break;
      }
      case "human_confirm_required": {
        const p = payload as Events["human_confirm_required"];
        this.patchTool(p.call_id, { state: "awaiting_approval", confirm: p });
        s.activity = "awaiting_approval";
        break;
      }
      case "question_required": {
        const p = payload as Events["question_required"];
        this.pushBlock(`${p.session_id}:q`, { kind: "question", id: p.question_id, q: p });
        s.activity = "awaiting_input";
        break;
      }
      case "turn_end": {
        const p = payload as Events["turn_end"];
        for (const m of s.messages)
          m.blocks = m.blocks.map((b) =>
            b.kind === "text" || b.kind === "reasoning" ? { ...b, streaming: false } : b,
          );
        this.pushBlock(`${p.turn_index}:outcome`, { kind: "outcome", id: `${p.turn_index}:o`, end: { reason: "done" }, turn: p });
        s.caps = { turns: Math.max(s.caps.turns, p.turn_index + 1), cost: s.caps.cost };
        break;
      }
      case "context_usage":
        s.usage = payload as Events["context_usage"];
        break;
      case "agent_end": {
        const p = payload as Events["agent_end"];
        // PLAN §10 的会话状态机：limit 是「暂停等用户确认继续」，不是错误
        s.activity = p.reason === "error" || p.reason === "panic" ? "error" : p.reason === "limit" ? "awaiting_input" : "idle";
        const tail = s.messages.at(-1);
        if (tail)
          tail.status =
            p.reason === "stopped" || p.reason === "limit" ? "stopped" : p.reason === "error" || p.reason === "panic" ? "error" : "complete";
        this.pushBlock("agent:outcome", { kind: "outcome", id: `agent:${Date.now()}`, end: p });
        break;
      }
      case "agent_error": {
        const p = payload as Events["agent_error"];
        if (p.fatal) s.activity = "error";
        this.pushBlock("agent:error", { kind: "error", id: `err:${Date.now()}`, err: p });
        break;
      }
      case "compact_done": {
        const p = payload as Events["compact_done"];
        this.pushBlock("agent:compact", {
          kind: "compact",
          id: `cmp:${p.from_turn}`,
          from_turn: p.from_turn,
          before: p.tokens_before,
          after: p.tokens_after,
        });
        break;
      }
      case "file_changed":
        s.files = [...s.files.slice(-40), payload as Events["file_changed"]];
        break;
      case "git_status_changed":
        s.git = payload as Events["git_status_changed"];
        break;
      case "scan_progress":
        s.scan = payload as Events["scan_progress"];
        break;
      case "mcp_status": {
        const p = payload as Events["mcp_status"];
        s.mcp = { ...s.mcp, [p.server]: p };
        break;
      }
      case "session_updated": {
        const p = payload as Events["session_updated"];
        s.sessions = mergeSession(s.sessions, p);
        if (p.session_id === s.session) s.activity = p.activity;
        break;
      }
      case "queue_state":
        s.queue = payload as Events["queue_state"];
        break;
      case "ready":
        break;
    }
    this.emit();
  }

  /** part 级落库后的权威覆盖：工具块按 call_id 全局定位（它可能在别的合成消息上） */
  private applyPart(part: Part) {
    const block = toBlock(part);
    if (block.kind === "tool") {
      const hit = this.findTool(block.call_id);
      if (hit) {
        hit.m.blocks = hit.m.blocks.map((b, i) => (i === hit.i ? { ...block, turn_index: (b as ToolPart).turn_index } : b));
        this.emit();
        return;
      }
    }
    const m = this.msg(part.message_id);
    const same = (b: Block) =>
      b.kind === "tool" && block.kind === "tool" ? b.call_id === block.call_id : b.kind === block.kind && "id" in b && "id" in block && b.id === block.id;
    const i = m.blocks.findIndex(same);
    m.blocks = i < 0 ? [...m.blocks, block] : m.blocks.map((b, n) => (n === i ? block : b));
  }

  /** 前端动作直写 store 的场景（mock 桥与乐观更新用） */
  local(fn: (s: State) => void) {
    fn(this.state);
    this.emit();
  }

  approve(call_id: string, decision: "allow" | "deny" | "allow_always") {
    this.patchTool(call_id, {
      state: decision === "allow" ? "running" : "denied",
      confirm: undefined,
    });
  }

  answer(question_id: string) {
    const m = this.state.messages.find((x) => x.blocks.some((b) => b.kind === "question" && b.id === question_id));
    if (!m) return;
    m.blocks = m.blocks.map((b) => (b.kind === "question" && b.id === question_id ? { ...b, answered: true } as Block : b));
    this.emit();
  }
}

function mergeSession(rows: SessionRow[], p: SessionUpdated): SessionRow[] {
  const i = rows.findIndex((r) => r.id === p.session_id);
  if (i < 0) return rows;
  const hit = rows[i];
  const next: SessionRow = { ...hit, title: p.title ?? hit.title, updated_at: p.updated_at, status: p.activity };
  return rows.map((r, n) => (n === i ? next : r));
}

function toBlock(part: Part): Block {
  const c = (part.content ?? {}) as Record<string, unknown>;
  if (part.type === "tool")
    return {
      kind: "tool",
      call_id: part.call_id ?? part.id,
      tool_name: part.tool_name ?? "tool",
      source: part.tool_source ?? "rpi",
      args: (c.args as Record<string, unknown>) ?? {},
      turn_index: 0,
      state: (part.state as ToolPart["state"]) ?? "ok",
      output: String(c.output ?? ""),
      result: c.result,
      error: c.error as string | undefined,
      duration_ms: c.duration_ms as number | undefined,
      truncated: Boolean(c.truncated),
    };
  if (part.type === "reasoning") return { kind: "reasoning", id: part.id, text: String(c.text ?? "") };
  if (part.type === "compact")
    return {
      kind: "compact",
      id: part.id,
      from_turn: Number(c.from_turn ?? 0),
      before: Number(c.tokens_before ?? 0),
      after: Number(c.tokens_after ?? 0),
    };
  if (part.type === "error") return { kind: "error", id: part.id, err: c as unknown as AgentError };
  if (part.type === "question") return { kind: "question", id: part.id, q: c as unknown as QuestionRequired };
  return { kind: "text", id: part.id, text: String(c.text ?? "") };
}

export const runtime = new Runtime();
