/** 左栏：全局导航 + 工作空间分组 + 最近会话（时间分桶 + 活动状态点，PLAN §5.1） */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { ProjectRow, SessionRow } from "../ipc/protocol";
import { useUi, ui } from "../ui/state";

const DAY = 864e5;

function bucket(ts: number) {
  const age = Date.now() - ts;
  if (age < DAY) return "今天";
  if (age < 2 * DAY) return "昨天";
  if (age < 7 * DAY) return "本周";
  return "更早";
}

/** 活动点用 .dot 的四种态，语义色必须同时带文字（PLAN §4 门禁） */
const dot = (s: SessionRow["status"]) =>
  s === "running" ? "run" : s === "error" ? "err" : s === "awaiting_approval" || s === "awaiting_input" ? "ask" : "idle";

export function Rail() {
  const s = useUi();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const st = runtime.state;

  useEffect(() => {
    void invoke("project_list").then(setProjects);
  }, []);

  const groups = new Map<string, SessionRow[]>();
  for (const row of [...st.sessions].sort((a, b) => b.updated_at - a.updated_at)) {
    const k = bucket(row.updated_at);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }

  return (
    <aside className="rail" id="rail">
      <div className="rail-top">
        <div className="omni" onClick={() => ui3("palette")}>
          <Icon name="search" />
          搜索会话 / 命令<span className="kbd">⌘K</span>
        </div>
      </div>
      <nav className="nav" id="nav">
        <button
          className={`item ${s.view === "chat" && !s.scene ? "active" : ""}`}
          onClick={() => {
            void invoke("session_create", { project_id: "p-opencode" }).then((row) => {
              runtime.local((x) => {
                x.session = (row as SessionRow).id;
                x.messages = [];
              });
              actions.openScreen("chat-welcome");
            });
          }}
        >
          <Icon name="plus" />
          新对话
        </button>
        <button className={`item ${s.view === "skills" ? "active" : ""}`} onClick={() => ui.set({ view: "skills" })}>
          <Icon name="slash" />
          Skills<span className="badge gray">斜杠命令</span>
        </button>
        <button className={`item ${s.view === "mcp" ? "active" : ""}`} onClick={() => ui.set({ view: "mcp" })}>
          <Icon name="zap" />
          MCP<span className="badge ok">{Object.values(st.mcp).filter((m) => m.status === "connected").length}/{Object.keys(st.mcp).length || 3}</span>
        </button>
      </nav>
      <div className="grp">
        工作空间 <Icon name="chevron-down" cls="sm" />
        <span className="act">
          <button className="iconbtn sm" onClick={() => actions.openScreen("project-new")}>
            <Icon name="plus" cls="sm" />
          </button>
        </span>
      </div>
      <div className="nav" id="projList" style={{ flex: "none" }}>
        {projects.map((p) => (
          <button key={p.id} className={`item ${p.id === "p-opencode" ? "active" : ""}`} onClick={() => actions.toast(`切换工作空间：${p.name}`)}>
            <Icon name={p.id === "p-opencode" ? "folder-open" : "folder"} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <span className="badge gray">{p.sessions}</span>
          </button>
        ))}
        <button className="item" style={{ color: "var(--text-weaker)" }} onClick={() => actions.openScreen("project-new")}>
          <Icon name="plus" />
          打开其他目录…
        </button>
      </div>
      <div className="grp">
        最近会话{" "}
        <span className="act">
          <button className="iconbtn sm" onClick={() => ui.set({ view: "history" })} title="全部历史">
            <Icon name="list" cls="sm" />
          </button>
        </span>
      </div>
      <div className="sesslist" id="sessList">
        {[...groups].map(([label, rows]) => (
          <div key={label}>
            <div className="dategroup">{label}</div>
            {rows.map((r) => (
              <button
                key={r.id}
                className={`sess ${r.id === st.session ? "active" : ""}`}
                onClick={() => {
                  runtime.local((x) => {
                    x.session = r.id;
                  });
                  actions.openScreen("chat-stream");
                }}
              >
                <span className={`dot ${dot(r.status)}`} title={r.status} />
                <span className="t">{r.title}</span>
                <span className="time">{new Date(r.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="act">
                  <button title="重命名" onClick={(e) => e.stopPropagation()}>
                    <Icon name="pencil" cls="sm" />
                  </button>
                  <button
                    title="导出 Markdown"
                    onClick={(e) => {
                      e.stopPropagation();
                      void invoke("session_export", { session_id: r.id }).then((md) => actions.toast("已导出", `${String(md).length} 字符`));
                    }}
                  >
                    <Icon name="download" cls="sm" />
                  </button>
                  <button
                    title="删除（软删，可撤销）"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.modal("sessdel");
                    }}
                  >
                    <Icon name="trash" cls="sm" />
                  </button>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="rail-foot">
        <button className="acct" onClick={() => actions.modal("runtime")} title="运行时诊断">
          <span className={`dot ${st.activity === "running" ? "run" : st.activity === "error" ? "err" : "idle"}`} style={{ margin: "0 6px 0 3px" }} />
          <span style={{ minWidth: 0 }}>
            <span className="nm">Agent Runtime</span>
            <span className="sub">Rust · 同进程 · rpi 0.3.24</span>
          </span>
          <span className="bal">{st.activity}</span>
        </button>
        <button className={`item ${s.view === "settings" ? "active" : ""}`} onClick={() => ui.set({ view: "settings" })}>
          <Icon name="sliders" />
          设置
        </button>
      </div>
    </aside>
  );
}

function ui3(what: "palette") {
  ui.set({ popover: ui.get().popover === what ? null : what });
}
