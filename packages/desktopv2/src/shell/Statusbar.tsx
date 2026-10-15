/**
 * IDE 式状态栏（PLAN §5.1：右栏折叠时状态栏保留能力入口）。
 * 注意：原型状态栏里那个「语义索引」入口指向不存在的屏（indexing），v2 明确不做索引，这里不实现。
 */
import { Icon, actions } from "../App";
import { ui } from "../ui/state";
import type { Activity, ContextUsage, GitStatus, McpStatus } from "../ipc/protocol";

const pct = (u?: ContextUsage) => (u ? Math.round((u.used / u.window) * 100) : 0);

export function Statusbar({
  activity,
  git,
  usage,
  mcp,
}: {
  activity: Activity;
  git?: GitStatus;
  usage?: ContextUsage;
  mcp: Record<string, McpStatus>;
}) {
  const cost = 0.0421;
  const waiting = activity === "awaiting_approval" ? 1 : 0;
  const on = Object.values(mcp).filter((m) => m.status === "connected").length;
  const total = Object.keys(mcp).length || 5;

  return (
    <footer className="statusbar">
      <span className="sb" onClick={() => actions.modal("runtime")} title="Rust runtime（同进程）">
        <span className={`dot ${activity === "running" ? "run" : activity === "error" ? "err" : "idle"}`} />
        agent-runtime · rust · 同进程
      </span>
      <span className="sb" onClick={() => actions.panel("review")} title="git 状态">
        <Icon name="branch" cls="sm" />
        {git ? `${git.branch} ↑${git.ahead} ↓${git.behind} · ${git.files.length} 变更` : "读取 git 状态…"}
      </span>
      <span className="sb" onClick={() => actions.modal("usage")} title="本会话费用与上下文（估算）">
        <Icon name="activity" cls="sm" />$
        {cost.toFixed(4)} · ctx {pct(usage)}%
      </span>
      <span className="sb" onClick={() => actions.openScreen("perm-dock")} title="待审批">
        <Icon name="shield" cls="sm" />
        权限 require_approval · {waiting} 待审批
      </span>
      <span className="sb push" onClick={() => actions.openScreen("panel-tree")} title="文件感知">
        <Icon name="folder" cls="sm" />
        文件 12,480 · .gitignore 生效
      </span>
      <span className="sb" onClick={() => ui3("mcp")} title="MCP 连接">
        <Icon name="zap" cls="sm" />
        MCP {on}/{total}
      </span>
      <span className="sb" onClick={() => actions.modal("shortcuts")} title="快捷键">
        <Icon name="keyboard" cls="sm" />
        ⌘K / ⌥[ / ⌥]
      </span>
    </footer>
  );
}

function ui3(view: "mcp") {
  ui.set({ view });
}
