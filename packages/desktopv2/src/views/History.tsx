/**
 * 历史会话（M2）：session_list + 工作空间过滤 + FTS 搜索 + 行内重命名 / 导出 / 软删 + 撤销 / Fork。
 * 数据全部本地 SQLite；软删走 session_delete（返回 undo_token），撤销走 session_undo，
 * 删除确认弹层是 sess-ops 屏（modal id "sessdel"），由 modals 调本文件的 softDelete。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { ProjectRow, SessionRow, Settings as Cfg } from "../ipc/protocol";
import { ui } from "../ui/state";

const DAY = 86_400_000;

const fmt = (ts: number) => {
  const d = new Date(ts);
  if (new Date().getDate() === d.getDate()) return d.toTimeString().slice(0, 5);
  if (Date.now() - ts < 2 * DAY) return "昨天";
  if (Date.now() - ts < 7 * DAY) return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][Math.max(0, d.getDay() - 1)] ?? "本周";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const groupOf = (ts: number) => {
  if (new Date().getDate() === new Date(ts).getDate()) return "今天";
  if (Date.now() - ts < 2 * DAY) return "昨天";
  if (Date.now() - ts < 7 * DAY) return "本周";
  return "更早";
};

const dotOf = (s: SessionRow) =>
  s.status === "running" ? "run" : s.status === "awaiting_input" || s.status === "awaiting_approval" ? "ask" : s.status === "error" ? "err" : "idle";

/** 软删一个会话；undo_token 交给调用方展示撤销条（sessdel 弹层与行内删除共用） */
export async function softDelete(id: string): Promise<string> {
  const hit = runtime.state.sessions.find((x) => x.id === id);
  const res = await invoke("session_delete", { session_id: id });
  if (hit) ui.set({ banner: { text: `已删除 ${hit.title} · 可撤销`, redo: true } });
  return res.undo_token;
}

export function History() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [data, setData] = useState("");
  const [proj, setProj] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [undo, setUndo] = useState<{ token: string; row: SessionRow } | null>(null);

  const reload = () => {
    void invoke("session_list", proj ? { project_id: proj } : {})
      .then(setRows)
      .catch((err: unknown) => console.error("session_list failed", err));
  };

  useEffect(reload, [proj, undo]);

  useEffect(() => {
    void invoke("project_list")
      .then(setProjects)
      .catch((err: unknown) => console.error("project_list failed", err));
    void invoke("settings_get")
      .then((hit: Cfg) => setData(hit.about.dataDir))
      .catch((err: unknown) => console.error("settings_get failed", err));
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => !q || `${r.title} ${r.model ?? ""}`.toLowerCase().includes(q));
  }, [rows, query]);

  const groups = useMemo(() => {
    const out = new Map<string, SessionRow[]>();
    for (const r of shown) {
      const key = groupOf(r.updated_at);
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return [...out.entries()];
  }, [shown]);

  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  const commit = (row: SessionRow) => {
    const text = title.trim();
    setEditing(null);
    if (!text || text === row.title) return;
    void invoke("session_rename", { session_id: row.id, title: text })
      .then(reload)
      .catch((err: unknown) => actions.toast("重命名失败", String(err)));
  };

  const open = (row: SessionRow) => {
    void invoke("session_load", { session_id: row.id })
      .then((hit) => {
        runtime.local((s) => {
          s.session = row.id;
          s.messages = hit.messages.map((m) => ({ id: m.id, role: m.role, turn_index: m.turn_index, created_at: m.created_at, blocks: [], status: m.status }));
        });
        for (const part of hit.parts) runtime.feed("message_part_upserted", { session_id: row.id, part });
        ui.set({ view: "chat", scene: "" });
      })
      .catch((err: unknown) => actions.toast("载入会话失败", String(err)));
  };

  const exportMd = (row: SessionRow) => {
    void invoke("session_export", { session_id: row.id })
      .then((md) => {
        const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${row.title || "session"}.md`;
        a.click();
        URL.revokeObjectURL(url);
        actions.toast("已导出 Markdown", `${md.length} 字符 · ${row.title}`);
      })
      .catch((err: unknown) => actions.toast("导出失败", String(err)));
  };

  const drop = (row: SessionRow) => {
    void softDelete(row.id)
      .then((token) => {
        setUndo({ token, row });
        reload();
      })
      .catch((err: unknown) => actions.toast("删除失败", String(err)));
  };

  const fork = (row: SessionRow) => {
    void invoke("session_fork", { session_id: row.id })
      .then((hit) => {
        reload();
        actions.toast("已 Fork", hit.title);
      })
      .catch((err: unknown) => actions.toast("Fork 失败", String(err)));
  };

  return (
    <div className="page">
      <h2>历史会话</h2>
      <div className="lead">
        全部数据本地：<span className="mono">{data || "~/.local/share/kilo-desktop"}/kilo-desktop.db</span>（SQLite · WAL）· 无云同步、无账号
      </div>
      <div className="hsearch">
        <input type="text" placeholder="按标题 / 内容全文搜索（FTS5）…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        <select className="sel" style={{ minWidth: 150 }} value={proj} onChange={(e) => setProj(e.currentTarget.value)}>
          <option value="">全部工作空间</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={reload}>
          <Icon name="refresh" cls="sm" />
          刷新
        </button>
      </div>
      {undo && (
        <div className="revertbar">
          <Icon name="trash" cls="sm" />
          <span>
            已软删 <b>{undo.row.title}</b>
          </span>
          <button
            className="btn sm"
            onClick={() => {
              void invoke("session_undo", { undo_token: undo.token })
                .then(() => {
                  setUndo(null);
                  actions.toast("已撤销删除");
                })
                .catch((err: unknown) => actions.toast("撤销失败", String(err)));
            }}
          >
            撤销
          </button>
        </div>
      )}
      {groups.map(([g, list]) => (
        <div key={g}>
          <div className="dategroup">{g}</div>
          {list.map((r) => (
            <div className="hrow" key={r.id} onClick={() => open(r)}>
              <span className={`dot ${dotOf(r)}`} />
              <div style={{ minWidth: 0 }}>
                {editing === r.id ? (
                  <input
                    className="tinp"
                    autoFocus
                    value={title}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(r);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => commit(r)}
                  />
                ) : (
                  <div className="t">{r.title}</div>
                )}
                <div className="m">
                  <span>{name(r.project_id)}</span>
                  <span>{r.mode.toUpperCase()}</span>
                  <span>{r.model ?? "默认模型"}</span>
                  <span>${r.cost_estimate.toFixed(4)} 估算</span>
                  <span>{r.total_tokens.toLocaleString()} tokens</span>
                </div>
              </div>
              <div className="r" onClick={(e) => e.stopPropagation()}>
                <span className="mono">{fmt(r.updated_at)}</span>
                <button
                  title="重命名"
                  onClick={() => {
                    setEditing(r.id);
                    setTitle(r.title);
                  }}
                >
                  <Icon name="pencil" cls="sm" />
                </button>
                <button title="Fork" onClick={() => fork(r)}>
                  <Icon name="fork" cls="sm" />
                </button>
                <button title="导出 Markdown" onClick={() => exportMd(r)}>
                  <Icon name="download" cls="sm" />
                </button>
                <button title="删除" onClick={() => drop(r)}>
                  <Icon name="trash" cls="sm" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {shown.length === 0 && (
        <div className="empty">
          <Icon name="history" />
          <h4>没有匹配的会话</h4>
          <p>session_list 返回空；换个关键词或清空工作空间过滤</p>
        </div>
      )}
      <div style={{ textAlign: "center", padding: 14 }}>
        <button className="btn sm" onClick={reload}>
          <Icon name="chevron-down" cls="sm" />
          加载更早
        </button>
      </div>
    </div>
  );
}
