/**
 * 场景事件脚本（供假宿主投递）。
 *
 * 每屏不是硬编码 JSX，而是一段真实事件序列：走的是和 Tauri 真宿主同一条 reducer。
 * 事件名与 payload 必须来自 PLAN §9.1 的 20 事件协议。
 */
import type { Events, PartType } from "./protocol";

export type Step = { at?: number } & {
  [E in keyof Events]: { ev: E; payload: Events[E] };
}[keyof Events];

const S = (ev: keyof Events, payload: unknown, at?: number): Step =>
  ({ ...(at === undefined ? {} : { at }), ev, payload } as Step);

/** 一段 assistant 文本（分块投递，模拟流式） */
const text = (sid: string, mid: string, ...chunks: string[]) =>
  chunks.map((delta, seq) => S("text_delta", { session_id: sid, message_id: mid, seq, delta }));

/** 一段思考链 */
const think = (sid: string, mid: string, ...chunks: string[]) =>
  chunks.map((delta, seq) => S("reasoning_delta", { session_id: sid, message_id: mid, seq, delta }));

/** 一次工具调用：开始 -> 输出 -> 结果 */
const tool = (
  sid: string,
  turn: number,
  name: string,
  args: Record<string, unknown>,
  out: string[],
  result: unknown,
  opts: { source?: string; error?: string; duration?: number; truncated?: boolean; id?: string } = {},
) => {
  const call = opts.id ?? `c-${name}-${turn}`;
  const steps: Step[] = [
    S("tool_call_start", {
      call_id: call,
      tool_name: name,
      source: opts.source ?? "rpi",
      args,
      session_id: sid,
      turn_index: turn,
    }),
    ...out.map((chunk, i) => S("tool_call_output_delta", { call_id: call, chunk }, i * 70)),
  ];
  if (opts.error)
    steps.push(S("tool_call_result", { call_id: call, error: opts.error, duration_ms: opts.duration ?? 33, truncated: false }));
  else
    steps.push(
      S("tool_call_result", {
        call_id: call,
        result,
        duration_ms: opts.duration ?? 620,
        truncated: Boolean(opts.truncated),
      }),
    );
  return steps;
};

/** 审批挂起：只发 human_confirm_required，等 UI 回传决策 */
const confirm = (_sid: string, turn: number, payload: Partial<Events["human_confirm_required"]>) =>
  S("human_confirm_required", {
    call_id: payload.call_id ?? `c-approve-${turn}`,
    tool_name: payload.tool_name ?? "bash",
    source: payload.source ?? "rpi",
    kind: payload.kind ?? "command",
    expires_at: Date.now() + 30 * 60 * 1000,
    ...payload,
  });

const outcome = (turn: number, tokens: Partial<Events["turn_end"]["tokens"]>, cost: number, model = "deepseek-chat") =>
  S("turn_end", {
    turn_index: turn,
    tokens: { prompt: 21400, completion: 640, reasoning: 0, cache_read: 12800, ...tokens },
    cost_estimate: cost,
    model,
  });

/** part 级覆盖：把已定稿的 part 直接落进 store（对应 message_part_upserted） */
const part = (sid: string, message_id: string, seq: number, type: PartType, content: unknown, extra: Record<string, unknown> = {}) =>
  S("message_part_upserted", { session_id: sid, part: { id: `${message_id}:${seq}`, message_id, seq, type, content, ...extra } });

const sid = "s-demo";

export const SCENES: Record<string, Step[]> = {
  "chat-stream": [
    ...text(sid, "u-1", "帮我看看 SQLite 写入为什么会出现 SQLITE_BUSY"),
    ...think(sid, "a-1", "先定位写入路径，", "再看是否多个 task 并发写。"),
    ...text(sid, "a-1", "我先看当前的写入实现。"),
    ...tool(sid, 0, "read", { path: "src-tauri/src/store.rs" }, ["pub fn write(", "  sql: &str", ") -> Result<()> {\n"], "128 行"),
    ...tool(sid, 0, "bash", { command: "rg -n 'conn.write' src-tauri/src" }, ["store.rs:44:    conn.write()", "store.rs:91:    conn.write()\n"], "2 处命中"),
    ...text(sid, "a-1", "两处写入在不同 task 上并发，SQLite 单写者模型下必然抢锁。建议把写收敛到一个 writer task。"),
    outcome(0, { completion: 412, reasoning: 96 }, 0.0198),
    S("context_usage", { used: 24200, reserved: 4096, window: 64000, auto_compact_at: 54400, hit_rate: 0.62 }),
    S("agent_end", { reason: "done", summary: "1 turn · 2 tools" }),
  ],

  "tool-read": [
    ...tool(sid, 0, "read", { path: "src/ipc/runtime.ts" }, [], "96 行 · 3.1 KB", { duration: 12 }),
    ...tool(sid, 0, "list", { path: "src/ipc" }, [], "4 个文件"),
    ...tool(sid, 1, "glob", { pattern: "src/**/*.tsx" }, [], "18 个匹配"),
    ...tool(
      sid,
      1,
      "grep",
      { pattern: "ExternalStoreRuntime", path: "src" },
      ["src/ipc/runtime.ts:4: * 语义对齐 assistant-ui 的 ExternalStore", "src/ipc/runtime.ts:66:export class Runtime {"],
      undefined,
      { error: "rg: regex parse error: unclosed group", duration: 9 },
    ),
    ...tool(
      sid,
      2,
      "read",
      { path: "packages/kilo-vscode/src/extension.ts" },
      ["// 输出被截断的示例：", "…前 256 KB "],
      "内容超出注入上限",
      { truncated: true, duration: 41 },
    ),
    outcome(2, {}, 0.0071),
  ],

  "tool-bash": [
    ...tool(
      sid,
      0,
      "bash",
      { command: "cargo test -p kilo-host -- --nocapture" },
      ["   Compiling kilo-host v0.1.0\n", "    Finished test [unoptimized] profile\n", "running 14 tests\n", "test perms::layered ... ok\n"],
      "14 passed; 0 failed",
      { duration: 8210 },
    ),
    ...tool(
      sid,
      1,
      "bash",
      { command: "find / -name '*.rs' 2>/dev/null" },
      ["扫描中……\n", "/Users/findly/.cargo/registry/src/…\n"],
      undefined,
      { error: "超时 120s，进程已 kill", duration: 120000 },
    ),
    outcome(1, {}, 0.0042),
  ],

  "tool-edit": [
    ...tool(sid, 0, "write", { path: "src/skins/loader.ts" }, [], "新建 148 行", { source: "kilo" }),
    part(sid, `${sid}:0`, 3, "tool", {
      args: { path: "src/ipc/runtime.ts" },
      diff:
        "diff --git a/src/ipc/runtime.ts b/src/ipc/runtime.ts\n@@ -12,7 +12,9 @@\n-  private subs = new Set()\n+  /** 事件按 (session,turn,seq) 去重排序 */\n+  private subs = new Set<Listener>()\n+  private onResync?: (since: number) => void\n",
      added: 14,
      deleted: 3,
      output: "已应用",
    }),
    part(sid, `${sid}:0`, 4, "tool", {
      args: { patch: "*** Begin Patch\n*** Update File: store.rs\n*** End Patch" },
      added: 64,
      deleted: 12,
      files: ["store.rs", "perms.rs", "ipc.rs"],
      output: "apply_patch 通过",
    }),
    S("file_changed", { paths: ["src/ipc/runtime.ts", "src/skins/loader.ts"], session_id: sid }),
    outcome(0, {}, 0.0121),
  ],

  "tool-web": [
    part(sid, `${sid}:0`, 1, "tool", {
      tool: "mcp:context7:resolve-library-id",
      args: { name: "rusqlite" },
      output: "rusqlite · 0.3 万星 · 文档 214 页",
    }),
    part(sid, `${sid}:0`, 2, "tool", {
      tool: "mcp:context7:get-library-docs",
      args: { topic: "WAL busy_timeout" },
      hits: [
        { title: "PRAGMA busy_timeout", src: "rusqlite.rs · 2026-04-11", body: "设置锁等待毫秒数，覆盖绝大多数瞬时写冲突。" },
        { title: "WAL 模式的单写多读", src: "docs.rs/rusqlite", body: "WAL 只允许一个写事务，跨线程需独占连接。" },
      ],
      output: "抓取 2 段正文",
    }),
    outcome(0, {}, 0.0032),
  ],

  "tool-todo": [
    part(sid, `${sid}:0`, 1, "tool", {
      tool: "todo",
      items: [
        { text: "抽取皮肤 token bundle", state: "done", ms: 42000 },
        { text: "写 IPC 协议类型", state: "done", ms: 88000 },
        { text: "接入 before_tool_call 权限拦截", state: "cur", ms: 61000 },
        { text: "审批卡改参数后执行", state: "todo" },
        { text: "checkpoint 快照与 Revert", state: "todo" },
      ],
      output: "2/5 · 分段耗时可见",
    }),
    outcome(0, {}, 0.0021),
  ],

  "tool-question": [
    S("question_required", {
      question_id: "q-1",
      session_id: sid,
      questions: [
        { q: "写入收敛到哪一层？", options: ["单一 writer task + mpsc", "连接池 + busy_timeout", "两者都要"], allow_custom: true },
        { q: "迁移失败时怎么处理？", options: ["回滚并备份原库", "只报警"], allow_custom: false },
      ],
    }),
  ],

  "tool-task": [
    part(sid, `${sid}:0`, 1, "tool", {
      tool: "task",
      label: "子任务：盘点 sidecar 启动路径",
      skill: "sqlite-doc",
      steps: [
        { text: "grep 启动入口", state: "done", ms: 3100 },
        { text: "读 host.ts 进程管理", state: "done", ms: 7400 },
        { text: "整理成文档段落", state: "cur" },
      ],
      output: "已后台化 · 可切回前台查看",
    }),
    outcome(0, {}, 0.0064),
  ],

  "tool-mcp": [
    part(sid, `${sid}:0`, 1, "tool", {
      tool: "mcp:context7:get-library-docs",
      source: "mcp",
      args: { topic: "tokio broadcast receiver lagged" },
      output: "返回 3 段文档，共 1.8 KB",
    }),
    S("mcp_status", { server: "linear", status: "needs_auth", tools: 0, error: "401 unauthorized" }),
    part(sid, `${sid}:0`, 2, "tool", {
      tool: "mcp:linear:create_issue",
      source: "mcp",
      state: "needs_auth",
      output: "需要授权：linear 返回 401",
      error: "needs_auth",
    }),
    outcome(0, {}, 0.0018),
  ],

  "outcome-done": [
    ...text(sid, "a-9", "改动已落地：写入收敛到单 writer task，迁移前后各备份一次。"),
    outcome(4, { prompt: 38200, completion: 2140, reasoning: 512, cache_read: 21000 }, 0.0842),
    S("context_usage", { used: 41200, reserved: 4096, window: 64000, auto_compact_at: 54400, hit_rate: 0.71 }),
    S("agent_end", { reason: "done", summary: "4 turns · 11 tools · 2 个文件" }),
  ],

  "outcome-stop": [
    ...text(sid, "a-10", "我正在整理提交历史，准备按文件粒度打"),
    S("agent_end", { reason: "stopped", summary: "已中断 · 已生成内容保留" }),
  ],

  "outcome-error": [
    ...tool(sid, 2, "bash", { command: "git add -A" }, [], undefined, { error: "SQLITE_IOERR: disk I/O error", duration: 15 }),
    S("agent_error", { level: "error", code: "sqlite_io", message: "数据库写入失败：SQLITE_IOERR（磁盘 I/O）", retryable: true, retry_in_ms: 4000, attempt: 1 }),
    S("agent_end", { reason: "error" }),
  ],

  "outcome-limit": [
    ...text(sid, "a-11", "本轮工具较多，继续下去会超出你设的估算上限。"),
    S("agent_end", { reason: "limit", summary: "达花费上限 ¥2.00，已暂停等你确认" }),
  ],

  "err-set": [
    S("agent_error", { level: "error", code: "no_endpoint", message: "还没有可用端点：请填 base_url 与模型列表", retryable: false }),
    S("agent_error", { level: "error", code: "unauthorized", message: "端点 DeepSeek 返回 401：API Key 无效或已过期", retryable: false }),
    S("agent_error", { level: "error", code: "rate_limited", message: "429 Too Many Requests · 正在等待重试", retryable: true, retry_in_ms: 8000, attempt: 2 }),
    S("agent_error", { level: "error", code: "unreachable", message: "连不上 http://localhost:11434：Ollama 没起来？", retryable: true, retry_in_ms: 3000, attempt: 1 }),
    S("agent_error", { level: "warn", code: "loop_breaker", message: "同一工具连续 3 次同参数调用，已熔断询问", retryable: false }),
  ],

  "perm-dock": [
    confirm(sid, 3, {
      call_id: "c-cmd-3",
      tool_name: "bash",
      kind: "command",
      command: 'git commit -m "feat(desktopv2): wire skin bundles" && git push origin HEAD',
      matched_rule: { scope: "mode:code", policy: "require_approval" },
    }),
  ],

  "perm-edit": [
    confirm(sid, 4, {
      call_id: "c-file-4",
      tool_name: "write",
      kind: "paths",
      paths: ["packages/desktopv2/src/ipc/runtime.ts", "packages/desktopv2/src/skins/loader.ts"],
      matched_rule: { scope: "session", policy: "require_approval" },
    }),
    confirm(sid, 4, {
      call_id: "c-diff-4",
      tool_name: "edit",
      kind: "diff",
      diff:
        "--- a/src/skins/loader.ts\n+++ b/src/skins/loader.ts\n@@ -40,6 +40,8 @@\n export function apply(id: string) {\n+  const hit = resolve(id)\n+  if (hit.bad) return { ok: false, problems: [hit.bad] }\n   inject(hit.bundle)\n",
      matched_rule: { scope: "global", policy: "require_approval" },
    }),
    confirm(sid, 5, {
      call_id: "c-host-5",
      tool_name: "mcp:linear:create_issue",
      source: "mcp",
      kind: "command",
      command: "POST https://xpunycode.linear.app/issues · title=皮肤门禁",
      homoglyph: true,
      matched_rule: { scope: "global", policy: "require_approval" },
    }),
  ],

  "q-dock": [
    S("question_required", {
      question_id: "q-2",
      session_id: sid,
      questions: [
        { q: "皮肤对比度不达标时？", options: ["阻止保存并给自动提亮", "只警告"], allow_custom: true },
        { q: "内置皮肤保留几套？", options: ["三套", "两套"], allow_custom: false },
        { q: "是否默认跟随系统深浅色？", options: ["跟随", "固定 graphite-dark"], allow_custom: true },
      ],
    }),
  ],

  queued: [
    S("queue_state", {
      main: [],
      steering: [{ id: "q-1", text: "先别提交，我想再看一眼 diff" }],
      follow_up: [
        { id: "q-2", text: "把 writer task 的注释补上" },
        { id: "q-3", text: "顺手更新 TODOS.md 状态" },
      ],
    }),
  ],

  revert: [
    ...tool(sid, 2, "edit", { path: "src/ipc/runtime.ts" }, [], "+14 −3", { source: "kilo" }),
    outcome(2, {}, 0.0102),
    part(sid, `${sid}:0`, 6, "compact", { note: "revert 横幅" }),
    S("file_changed", { paths: ["src/ipc/runtime.ts"], session_id: sid }),
  ],

  compact: [
    S("context_usage", { used: 58900, reserved: 4096, window: 64000, auto_compact_at: 54400, hit_rate: 0.44 }),
    S("compact_done", { from_turn: 3, tokens_before: 58900, tokens_after: 9800 }),
  ],

  attach: [
    part(sid, "u-attach", 0, "text", {
      text: "看下这张截图里的排版问题",
      attachments: [
        { id: "at-1", kind: "image", name: "review-panel.png", mime: "image/png", bytes: 184320, data: "data:image/png;base64,iVBORw0KGgo=" },
        { id: "at-2", kind: "image", name: "skin-manager.png", mime: "image/png", bytes: 96200, data: "data:image/png;base64,iVBORw0KGgo=" },
        { id: "at-3", kind: "file", name: "PLAN.md", mime: "text/markdown", bytes: 38934 },
      ],
    }),
  ],

  reload: [
    S("mcp_status", { server: "context7", status: "connected", tools: 4 }),
    S("mcp_status", { server: "linear", status: "failed", tools: 0, error: "子进程退出 code 1" }),
    ...text(sid, "a-12", "已重载：Skills 6 个（+1），MCP 3 台（context7 工具数 2 → 4）。"),
  ],
};

export const sceneIds = () => Object.keys(SCENES);
