/**
 * 浏览器里的假宿主。
 *
 * 目的有两个：其一，让 78 屏在没有原生壳时也能逐屏打开验证（与原型同样的验收通路）；
 * 其二，把「事件流 → store → UI」这条链路跑成真事件，而不是硬编码 JSX ——
 * 审批往返、队列、resync 这些行为必须在浏览器里也真的发生一次。
 *
 * 注意：这是 dev-only 的替身，`bridge.ts` 只在检测不到 __TAURI_INTERNALS__ 时加载它。
 */
import { SCENES, type Step } from "./scenes";
import { runtime } from "./runtime";
import { dispatch } from "./bridge";
import type { CommandName, Effective, Mode, Part, Policy, SessionRow } from "./protocol";

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => Date.now();

type Row = Record<string, unknown>;
const tables = {
  projects: [
    { id: "p-opencode", path: "~/src/opencode", name: "opencode", is_git: true, last_opened: now() - 6e5, sessions: 12 },
    { id: "p-billing", path: "~/work/cloud-billing", name: "cloud-billing", is_git: true, last_opened: now() - 8.6e7, sessions: 4 },
    { id: "p-notes", path: "~/notes", name: "notes", is_git: false, last_opened: now() - 1.7e8, sessions: 1 },
  ] as Row[],
  sessions: [] as SessionRow[],
  providers: [
    { id: "v-deep", name: "DeepSeek", base_url: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], has_key: true, key_ref: "keychain://kilo-desktop/deep" },
    { id: "v-ollama", name: "Ollama（本地）", base_url: "http://localhost:11434/v1", models: ["qwen3:14b", "qwen3:30b"], has_key: false },
  ] as Row[],
  skills: [
    { id: "s1", command: "review", name: "代码审查", description: "逐文件审查改动并给结论", scope: "builtin", enabled: true },
    { id: "s2", command: "sqlite-doc", name: "写入存储文档", scope: "project", enabled: true, path: ".kilo/skills/sqlite-doc/SKILL.md" },
  ] as Row[],
  mcp: [
    { id: "m1", name: "context7", transport: "stdio", enabled: true, status: "connected", tools: 2 },
    { id: "m2", name: "linear", transport: "http", enabled: true, status: "needs_auth", tools: 0, last_error: "401 unauthorized" },
    { id: "m3", name: "puppeteer", transport: "stdio", enabled: false, status: "disabled", tools: 6 },
  ] as Row[],
  permissions: [
    { tool: "bash", policy: "require_approval", scope: "global", from: "global" },
    { tool: "write", policy: "require_approval", scope: "global", from: "global" },
    { tool: "read", policy: "auto", scope: "global", from: "global" },
  ] as Row[],
  drafts: {} as Record<string, { text: string; attachments: unknown[] }>,
  checkpoints: {} as Record<string, { queue_state: unknown; last_turn: number }>,
  ui: {} as Record<string, string>,
  settings: {
    skin: "graphite-dark",
    fontScale: 13,
    density: "comfortable",
    collapseLeft: false,
    collapseRight: false,
    lang: "zh",
    mode: "code",
    model: "deepseek-chat",
    variant: "",
    maxTurns: 10,
    shellTimeout: 120,
    costCap: 2,
    repeatBreaker: 3,
    autoCompactAt: 0.85,
    injectLimitKb: 256,
    ignorePatterns: "node_modules, dist, .git",
    gitBackend: "cli",
    commitPolicy: "require_approval",
    pushPolicy: "require_approval",
    snapshotKeep: 200,
    scanDepth: 8,
    scanFiles: 200000,
    attachMaxMb: 20,
    notifyTurnEnd: true,
    notifyApproval: true,
    notifyError: true,
    notifySound: false,
    quietHours: "22:00-08:00",
    experimentalTerminal: false,
    experimentalSandbox: false,
    experimentalIndex: false,
    about: { app: "0.1.0", runtime: "rpi 0.3.24", schema: 1, dataDir: "~/.local/share/kilo-desktop" },
  },
};

/** 待审批队列：call_id -> resolver，对应 PLAN §3.3 的 oneshot + 超时自动 deny */
const pending = new Map<string, (d: "allow" | "deny" | "allow_always") => void>();

function modeDefaults(mode: Mode): Effective[] {
  const map: Record<Policy, number> = { deny: 0, require_approval: 1, auto: 2 };
  const base: Record<string, Effective> = {};
  for (const tool of ["read", "list", "glob", "grep", "write", "edit", "apply_patch", "bash", "todo", "ask_user"]) {
    const ro = ["read", "list", "glob", "grep", "todo"].includes(tool);
    let policy: Policy;
    if (mode === "ask") policy = ro ? "auto" : "deny";
    else if (mode === "plan") policy = ro ? "auto" : tool === "bash" ? "auto" : "deny";
    else policy = ro ? "auto" : "require_approval";
    base[tool] = { tool, policy, from: `mode:${mode}` };
  }
  for (const row of tables.permissions as Effective[]) {
    const hit = base[row.tool];
    if (!hit || map[row.policy] < map[hit.policy]) base[row.tool] = { ...row, from: row.from ?? "global" };
  }
  return Object.values(base);
}

let sessionSeq = 0;
function newSession(projectId = "p-opencode", title = "新对话"): SessionRow {
  const row: SessionRow = {
    id: uid("s"),
    project_id: projectId,
    title,
    mode: tables.settings.mode as Mode,
    model: tables.settings.model,
    status: "idle",
    total_tokens: 0,
    cost_estimate: 0,
    pinned: false,
    updated_at: now(),
    created_at: now(),
  };
  tables.sessions.unshift(row);
  sessionSeq++;
  return row;
}

for (const [title, ago, status] of [
  ["SQLite 并发写：busy_timeout 取值", 4e5, "idle"],
  ["把 Agent Manager 的 worktree 隔离画清楚", 9e5, "running"],
  ["皮肤系统：对比度门禁要不要阻止保存", 1.7e6, "awaiting_approval"],
  ["重构 sidecar 启动路径", 8.7e7, "idle"],
  ["Tauri IPC 事件乱序怎么补齐", 1.2e8, "error"],
  ["费用估算与服务端账单差多少", 2.4e8, "idle"],
] as const) {
  tables.sessions.push({
    id: uid("s"),
    project_id: title.includes("worktree") ? "p-billing" : "p-opencode",
    title,
    mode: "code",
    model: "deepseek-chat",
    status: status as SessionRow["status"],
    total_tokens: 1200 + sessionSeq * 3400,
    cost_estimate: 0.02 + sessionSeq * 0.11,
    pinned: false,
    updated_at: now() - ago,
    created_at: now() - ago - 3.6e6,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 一步事件投递 */
function fire(step: Step) {
  dispatch(step.ev, step.payload as never);
}

export const host = {
  /** 打开一屏：清场后按脚本投递事件，UI 与真实链路走同一条 reducer */
  async play(id: string, extra: Step[] = []) {
    runtime.reset({ session: runtime.state.session });
    const steps = [...(SCENES[id] ?? []), ...extra];
    for (const s of steps) {
      if (s.at) await sleep(s.at);
      fire(s);
    }
    return steps.length;
  },

  /** 真审批往返：submit 后卡在 human_confirm_required，直到 approve 回来才继续 */
  async runTurn(text: string, mode: Mode = "code") {
    const session = runtime.state.session ?? newSession().id;
    runtime.local((s) => {
      s.session = session;
      s.activity = "running";
    });
    const mid = uid("u");
    runtime.local((s) => {
      s.messages = [
        ...s.messages,
        { id: mid, role: "user", created_at: now(), text, blocks: [{ kind: "text", id: mid, text }], status: "complete" },
      ];
    });
    dispatch("session_updated", { session_id: session, activity: "running", updated_at: now() });
    const aid = uid("a");
    let seq = 0;
    for (const chunk of ["我来分析这个改动，", "先看现有实现。"]) dispatch("text_delta", { session_id: session, message_id: aid, seq: seq++, delta: chunk });
    const call = uid("c");
    dispatch("tool_call_start", { call_id: call, tool_name: "bash", source: "rpi", args: { command: "git status --porcelain=v2" }, session_id: session, turn_index: 0 });
    const expires = now() + 30 * 60 * 1000;
    dispatch("human_confirm_required", {
      call_id: call,
      tool_name: "bash",
      source: "rpi",
      kind: "command",
      command: "git status --porcelain=v2",
      matched_rule: { scope: `mode:${mode}`, policy: "require_approval" },
      expires_at: expires,
    });
    const decision = await new Promise<"allow" | "deny" | "allow_always">((res) => {
      pending.set(call, res);
      // 30 分钟超时自动 deny（这里用同一常量，真实实现由 Rust 侧把关）
      setTimeout(() => pending.get(call)?.("deny"), 30 * 60 * 1000);
    });
    if (decision === "deny") {
      dispatch("tool_call_result", { call_id: call, error: "用户拒绝", duration_ms: 0, truncated: false });
      dispatch("agent_end", { reason: "stopped" });
      return;
    }
    if (decision === "allow_always")
      tables.permissions = tables.permissions.filter((p) => p.tool !== "bash").concat({ tool: "bash", policy: "auto", scope: "session", from: "session:allow_always" });
    for (const line of ["M packages/desktopv2/src/ipc/runtime.ts\n", "?? packages/desktopv2/TODOS.md\n"]) {
      await sleep(90);
      dispatch("tool_call_output_delta", { call_id: call, chunk: line });
    }
    dispatch("tool_call_result", { call_id: call, result: "ok", duration_ms: 412, truncated: false });
    dispatch("file_changed", { paths: ["src/ipc/runtime.ts"], session_id: session });
    const bid = uid("a");
    let n = 0;
    for (const chunk of ["工作区有 1 个已修改文件与 1 个未跟踪文件。", "是否需要我继续提交？"])
      dispatch("text_delta", { session_id: session, message_id: bid, seq: n++, delta: chunk });
    dispatch("turn_end", { turn_index: 0, tokens: { prompt: 2140, completion: 186, reasoning: 0, cache_read: 1280 }, cost_estimate: 0.0142, model: "deepseek-chat" });
    dispatch("context_usage", { used: 21400, reserved: 4096, window: 64000, auto_compact_at: 54400, hit_rate: 0.62 });
    dispatch("agent_end", { reason: "done", summary: "1 turn · 1 tool" });
  },

  async invoke(cmd: CommandName, args?: unknown): Promise<unknown> {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "submit_message":
        void host.runTurn(String(a.text ?? ""), (a.mode as Mode) ?? "code");
        return { turn_index: 0 };
      case "submit_steering":
        runtime.local((s) => {
          s.queue = { ...s.queue, steering: [...s.queue.steering, { id: uid("q"), text: String(a.text) }] };
        });
        dispatch("queue_state", runtime.state.queue);
        return undefined;
      case "queue_action": {
        const strip = (xs: { id: string; text: string }[]) => xs.filter((x) => x.id !== a.id);
        runtime.local((s) => {
          const q = { main: strip(s.queue.main), steering: strip(s.queue.steering), follow_up: strip(s.queue.follow_up) };
          if (a.op === "promote") q.main.unshift({ id: String(a.id), text: String(a.text ?? "") });
          if (a.op === "edit") q.steering.push({ id: String(a.id), text: String(a.text ?? "") });
          s.queue = q;
        });
        dispatch("queue_state", runtime.state.queue);
        return undefined;
      }
      case "approve_tool_call": {
        const res = pending.get(String(a.call_id));
        pending.delete(String(a.call_id));
        runtime.approve(String(a.call_id), a.decision as "allow" | "deny" | "allow_always");
        res?.(a.decision as "allow" | "deny" | "allow_always");
        return undefined;
      }
      case "answer_question":
        runtime.answer(String(a.question_id));
        return undefined;
      case "stop_agent":
        dispatch("agent_end", { reason: "stopped" });
        return undefined;
      case "session_list":
        return tables.sessions.filter((s) => !a.project_id || s.project_id === a.project_id);
      case "session_create":
        return newSession(String(a.project_id ?? "p-opencode"), String(a.title ?? "新对话"));
      case "session_rename": {
        tables.sessions = tables.sessions.map((s) => (s.id === a.session_id ? { ...s, title: String(a.title), updated_at: now() } : s));
        return undefined;
      }
      case "session_delete": {
        const hit = tables.sessions.find((s) => s.id === a.session_id);
        tables.sessions = tables.sessions.filter((s) => s.id !== a.session_id);
        return { undo_token: hit ? uid("undo") : "" };
      }
      case "session_export":
        return `# ${tables.sessions.find((s) => s.id === a.session_id)?.title ?? "session"}\n\n导出为 Markdown（mock）`;
      case "session_load":
        return { messages: [], parts: [] as Part[], has_more: false };
      case "permission_effective":
      case "permission_set":
        if (cmd === "permission_set")
          tables.permissions = tables.permissions
            .filter((p) => p.tool !== a.tool)
            .concat({ tool: String(a.tool), policy: String(a.policy) as Policy, scope: String(a.scope), from: String(a.scope), matcher: a.matcher as string });
        return modeDefaults((tables.settings.mode as Mode) ?? "code");
      case "provider_upsert":
        tables.providers = tables.providers.concat({ ...a, id: (a.id as string) ?? uid("v"), has_key: Boolean(a.api_key) });
        return tables.providers.at(-1);
      case "provider_delete":
        tables.providers = tables.providers.filter((p) => p.id !== a.id);
        return undefined;
      case "provider_test":
        return String(a.base_url ?? "").startsWith("http")
          ? { ok: true, models: ["gpt-4o-mini", "deepseek-chat"] }
          : { ok: false, models: [], error: "base_url 需 http(s):// 前缀，本地可留空 key" };
      case "mcp_list":
        return tables.mcp;
      case "mcp_upsert":
        tables.mcp = tables.mcp.concat({ ...a, id: (a.id as string) ?? uid("m"), status: "connecting", tools: 0 });
        setTimeout(() => {
          const row = tables.mcp.at(-1) as { name: string };
          tables.mcp[tables.mcp.length - 1] = { ...row, status: "connected", tools: 4 };
          dispatch("mcp_status", { server: row.name, status: "connected", tools: 4 });
        }, 700);
        return undefined;
      case "mcp_toggle":
      case "mcp_retry": {
        const i = tables.mcp.findIndex((m) => m.id === a.id);
        if (i >= 0) {
          const hit = tables.mcp[i] as { name: string; tools: number };
          const row = { ...hit, status: cmd === "mcp_toggle" && !a.enabled ? "disabled" : "connected" };
          tables.mcp[i] = row;
          dispatch("mcp_status", { server: hit.name, status: row.status as never, tools: Number(hit.tools ?? 0) });
        }
        return undefined;
      }
      case "mcp_delete":
        tables.mcp = tables.mcp.filter((m) => m.id !== a.id);
        return undefined;
      case "skill_list":
        return tables.skills;
      case "skill_upsert":
        tables.skills = tables.skills.concat({ ...a, id: (a.id as string) ?? uid("s") });
        return undefined;
      case "skill_toggle":
      case "skill_delete":
        tables.skills =
          cmd === "skill_delete"
            ? tables.skills.filter((s) => s.id !== a.id)
            : tables.skills.map((s) => (s.id === a.id ? { ...s, enabled: Boolean(a.enabled) } : s));
        return undefined;
      case "fs_tree":
        return [
          { path: "src", name: "src", dir: true },
          { path: "src/ipc/runtime.ts", name: "runtime.ts", dir: false, size: 9210 },
          { path: "src-tauri/src/store.rs", name: "store.rs", dir: false, size: 7431 },
        ];
      case "fs_preview":
        return { text: "// mock 预览\nexport const ok = true;\n", truncated: false, bytes: 42 };
      case "fs_scan":
        dispatch("scan_progress", { project: String(a.project ?? "opencode"), scanned: 12800, total: 20000, phase: "walk" });
        return undefined;
      case "git_status":
        dispatch("git_status_changed", {
          branch: "main",
          ahead: 1,
          behind: 0,
          files: [
            { path: "packages/desktopv2/src/ipc/runtime.ts", status: "M", added: 64, deleted: 12 },
            { path: "packages/desktopv2/TODOS.md", status: "?", added: 210, deleted: 0 },
          ],
        });
        return runtime.state.git;
      case "git_diff":
        return "--- a/src/ipc/runtime.ts\n+++ b/src/ipc/runtime.ts\n@@ -1,3 +1,4 @@\n-export const x = 1\n+export const x = 2\n+// 新增一行\n";
      case "git_stage":
      case "git_unstage":
      case "git_push":
        return undefined;
      case "git_commit":
        return { oid: uid("commit") };
      case "git_generate_message":
        return { message: "feat(desktopv2): 落地皮肤系统与 IPC store" };
      case "settings_get":
        return tables.settings;
      case "settings_set":
        Object.assign(tables.settings, a.patch ?? {});
        return tables.settings;
      case "skin_list":
        return [];
      case "skin_apply":
      case "skin_import":
        return { ok: true };
      case "project_list":
        return tables.projects;
      case "project_open":
        return { id: uid("p"), name: String(a.path ?? "").split("/").pop() ?? "project", is_git: true };
      case "compact_now":
        dispatch("compact_done", { from_turn: 2, tokens_before: 52000, tokens_after: 9800 });
        return undefined;
      case "set_mode":
        tables.settings.mode = String(a.mode) as Mode;
        return undefined;
      case "set_model":
        tables.settings.model = String(a.model);
        return undefined;
      case "resync":
        return [] as Part[];
      case "session_fork":
        return newSession("p-opencode", "分叉会话");
      case "session_undo":
        return undefined;
      case "revert_to_message":
        return { files: ["src/ipc/runtime.ts", "src/skins/loader.ts"] };
      case "redo_step":
        return { files: ["src/ipc/runtime.ts"] };
      case "submit_frontend_result":
        return undefined;
      case "terminal_open":
        return { id: uid("t") };
      case "terminal_write":
      case "terminal_resize":
      case "terminal_close":
        return undefined;
      case "fs_search":
        return [];
    }
  },

  draft(sessionId: string, text: string, attachments: unknown[] = []) {
    tables.drafts[sessionId] = { text, attachments };
  },

  getDraft(sessionId: string) {
    return tables.drafts[sessionId];
  },

  checkpoint(sessionId: string, lastTurn: number, queue_state: unknown) {
    tables.checkpoints[sessionId] = { last_turn: lastTurn, queue_state };
    return tables.checkpoints[sessionId];
  },

  ui(key: string, value?: string) {
    if (value === undefined) return tables.ui[key];
    tables.ui[key] = value;
    return value;
  },
};
