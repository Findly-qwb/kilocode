/**
 * 后台任务面板（M6-9）：目录扫描 / 上下文压缩 / MCP 重连。
 * 状态来自 runtime 的真实事件（scan_progress、mcp_status），动作打回命令层。
 */
import { useEffect, useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { useProject, fail } from "./common";
import { ui, useUi } from "../ui/state";
import { t } from "../i18n";

type Task = { id: string; title: string; detail: string; state: "run" | "ok" | "err" | "wait"; pct?: number; cancel?: boolean; retry?: boolean };

export function Tasks() {
  const st = runtime.state;
  const s = useUi();
  const proj = useProject();
  const [compacting, setCompacting] = useState(false);

  useEffect(() => {
    if (!compacting) return;
    const hit = st.messages.flatMap((m) => m.blocks).some((b) => b.kind === "compact");
    if (hit) setCompacting(false);
  }, [st.messages, compacting]);

  const rows: Task[] = [];

  if (st.scan)
    rows.push({
      id: "scan",
      title: `扫描 ${st.scan.project || proj.name}`,
      detail: `${st.scan.scanned.toLocaleString()} / ${st.scan.total.toLocaleString()} · ${st.scan.phase}`,
      state: st.scan.phase === "done" ? "ok" : "run",
      pct: Math.min(100, Math.round((st.scan.scanned / Math.max(1, st.scan.total)) * 100)),
      cancel: st.scan.phase !== "done",
    });

  rows.push({
    id: "compact",
    title: "上下文压缩",
    detail: compacting ? "生成摘要中…（压缩点之后的历史已折叠）" : `阈值 ${(st.usage ? Math.round((st.usage.used / st.usage.window) * 100) : 0)}% / 自动 85%`,
    state: compacting ? "run" : st.messages.flatMap((m) => m.blocks).some((b) => b.kind === "compact") ? "ok" : "wait",
  });

  for (const [name, m] of Object.entries(st.mcp))
    rows.push({
      id: `mcp-${name}`,
      title: `MCP ${name}`,
      detail: m.error ? `${m.status} · ${m.error}` : `${m.status} · ${m.tools} 工具`,
      state: m.status === "connected" ? "ok" : m.status === "failed" || m.status === "needs_auth" ? "err" : "run",
      retry: m.status === "failed" || m.status === "needs_auth",
    });

  if (st.files.length)
    rows.push({
      id: "files",
      title: "文件变更跟踪",
      detail: `${st.files.length} 次 file_changed · 最近 ${st.files.at(-1)?.paths.join(", ").slice(0, 40)}`,
      state: "ok",
    });

  const run = (x: Task) => {
    if (x.id === "scan" && x.cancel) {
      void invoke("fs_scan", { project: proj.name, cancel: true }).catch((e) => fail("取消扫描失败", e));
      ui.set({ toast: { title: "已请求取消扫描" } });
      return;
    }
    if (x.id === "compact") {
      setCompacting(true);
      void invoke("compact_now", { session_id: st.session ?? "" }).catch((e) => fail("压缩请求失败", e));
      return;
    }
    if (x.retry && x.id.startsWith("mcp-")) {
      const name = x.id.slice(4);
      const hit = (st.mcp[name] ?? {}) as { server?: string };
      void invoke("mcp_retry", { id: String(hit.server ?? name) }).catch((e) => fail("重连失败", e));
      ui.set({ toast: { title: `正在重连 ${name}` } });
    }
  };

  return (
    <>
      <div className="dockrow">
        <span className="stat">
          <Icon name="activity" cls="sm" />
          {rows.length} 项
        </span>
        <span className="sp" style={{ flex: 1 }} />
        <button className="btn xs" onClick={() => void invoke("fs_scan", { project: proj.name }).catch((e) => fail("扫描启动失败", e))}>
          <Icon name="refresh" cls="sm" />
          重跑扫描
        </button>
      </div>
      {rows.map((x) => (
        <div className="dock-card" key={x.id} style={x.state === "wait" ? { borderColor: "var(--border-base)", background: "none" } : undefined}>
          <div className="grow">
            <span className={`dot ${x.state === "run" ? "run" : x.state === "err" ? "err" : x.state === "ok" ? "ok" : "idle"}`} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ color: "var(--text-strong)" }}>{x.title}</b>
              <span className="d" style={{ display: "block", fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
                {x.detail}
              </span>
            </span>
            {x.pct !== undefined ? <span className="mono">{x.pct}%</span> : null}
            {x.cancel ? (
              <button className="btn xs" onClick={() => run(x)}>
                <Icon name="x" cls="sm" />
                {t("common.cancel")}
              </button>
            ) : null}
            {x.retry ? (
              <button className="btn xs" onClick={() => run(x)}>
                <Icon name="refresh" cls="sm" />
                重试
              </button>
            ) : null}
            {x.id === "compact" && !compacting ? (
              <button className="btn xs" onClick={() => run(x)}>
                <Icon name="layers" cls="sm" />
                立即压缩
              </button>
            ) : null}
          </div>
          {x.pct !== undefined ? (
            <span className="segbar" style={{ display: "block", height: 3, background: "var(--track)", marginTop: 6 }}>
              <i style={{ display: "block", height: "100%", width: `${x.pct}%`, background: "var(--track-fill)" }} />
            </span>
          ) : null}
        </div>
      ))}
      {!rows.length ? <div className="d">{t("tasks.empty")} · 当前会话：{s.scene || "空态"}</div> : null}
    </>
  );
}
