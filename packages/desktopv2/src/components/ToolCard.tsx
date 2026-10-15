/**
 * 工具卡全家（PLAN §16 tool-* 屏）。
 *
 * 数据来自 store 的 ToolPart。part 级落库时 toBlock 只保留 args/output/result 等固定字段，
 * 场景里的 diff / items / steps / hits 这类扩展内容在这里按 call_id 旁路取回
 * （不改 runtime reducer）。
 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke, listen } from "../ipc/bridge";
import { runtime, type ToolPart } from "../ipc/runtime";
import type { QuestionRequired } from "../ipc/protocol";
import { ui } from "../ui/state";
import { ApprovalCard, Code } from "./ApprovalCard";
import { DiffView, Stat, ReviewLink, tally } from "./DiffView";
import { QuestionCard } from "./QuestionCard";

type Extra = Record<string, unknown>;
const parts = new Map<string, Extra>();
let seen = ui.get().scene;

/** 模块加载即挂钩：App → Chat → MessageList → 本文件，早于 boot() 投递任何事件 */
listen("message_part_upserted", (p) => {
  const c = p.part.content;
  if (c && typeof c === "object") parts.set(p.part.call_id ?? p.part.id, c as Extra);
});
ui.sub(() => {
  if (ui.get().scene === seen) return;
  seen = ui.get().scene;
  parts.clear();
});

export const extra = (id: string): Extra => parts.get(id) ?? {};

/** 折叠态记忆（组件内，切屏不丢） */
const opens = new Map<string, boolean>();

const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
const dur = (v: unknown) => (typeof v === "number" && v > 0 ? secs(v) : "");
const arr = (v: unknown) => (Array.isArray(v) ? (v as Extra[]) : []);

/** 工具名：part 级落库时真实名字在 content.tool */
const named = (t: ToolPart) => String(extra(t.call_id).tool ?? t.tool_name ?? "tool");

type Kind = "read" | "bash" | "edit" | "todo" | "ask" | "task" | "mcp" | "web" | "skill" | "other";

const kind = (n: string): Kind => {
  const k = n.toLowerCase();
  if (/^(read|list|glob|grep|ls|find)$/.test(k)) return "read";
  if (/^(bash|shell|exec|run_command)$/.test(k)) return "bash";
  if (/^(write|edit|apply_patch|patch|notebookedit)$/.test(k)) return "edit";
  if (/^(todo|todowrite|todo_write)$/.test(k)) return "todo";
  if (/^(ask_user|question|askuser|ask)$/.test(k)) return "ask";
  if (/^task/.test(k) || k.includes("子任务")) return "task";
  if (/^(websearch|webfetch|search_web|fetch)/.test(k)) return "web";
  if (k.includes("resolve-library") || k.includes("get-library") || k.includes("query-docs")) return "web";
  if (k.startsWith("mcp:") || k.includes("mcp")) return "mcp";
  if (k === "skill") return "skill";
  return "other";
};

const glyph = (k: Kind, n: string) => {
  if (k === "bash") return "terminal";
  if (k === "edit") return n.toLowerCase() === "write" ? "file" : "diff";
  if (k === "todo") return "list-checks";
  if (k === "ask") return "alert-circle";
  if (k === "task") return "bot";
  if (k === "mcp") return "zap";
  if (k === "web") return n.toLowerCase().includes("fetch") ? "download" : "globe";
  if (k === "skill") return "sparkle";
  if (/^(glob|grep)$/i.test(n)) return "search";
  if (/^list$/i.test(n)) return "folder-open";
  return "file";
};

const caption = (n: string) => n.replace(/^mcp:([a-z0-9.-]+)[:.-]([a-z0-9_-]+)$/i, "mcp:$1 · $2").replace(/^([a-z])/, (c) => c.toUpperCase());

const sub = (t: ToolPart, x: Extra, k: Kind) => {
  const a = t.args as Extra;
  if (k === "bash") return String(a.command ?? "");
  if (k === "edit") return String(a.path ?? a.file ?? (Array.isArray(x.files) ? `${(x.files as string[]).length} 个文件` : ""));
  if (k === "task") return String(x.label ?? a.description ?? "");
  if (k === "skill") return String(a.name ?? x.skill ?? "");
  if (k === "todo") return String(x.note ?? "");
  return String(a.path ?? a.pattern ?? a.query ?? a.topic ?? a.name ?? x.label ?? "");
};

const needs = (x: Extra) => String(x.state ?? "") === "needs_auth" || String(x.error ?? "") === "needs_auth";

function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export function ToolCard({ t }: { t: ToolPart }) {
  const x = extra(t.call_id);
  const n = named(t);
  const k = kind(n);
  const running = t.state === "running";
  const diff = String(x.diff ?? (/^@@|diff --git/m.test(t.output) ? t.output : ""));
  const patch = String(x.patch ?? (t.args as Extra).patch ?? "");
  const files = Array.isArray(x.files) ? (x.files as string[]) : undefined;
  const items = arr(x.items);
  const steps = arr(x.steps);
  const hits = arr(x.hits);
  const questions = arr(x.questions) as QuestionRequired["questions"];
  const auth = needs(x);
  const [since] = useState(() => Date.now());
  useTick(running);

  const auto = running || k === "bash" || k === "edit" || k === "todo" || k === "task" || k === "ask" || Boolean(t.error) || Boolean(diff) || hits.length > 0;
  const [open, setOpen] = useState(opens.get(t.call_id) ?? auto);
  const fold = () => {
    const next = !open;
    opens.set(t.call_id, next);
    setOpen(next);
  };

  const stat = tally(diff || patch);
  const added = Number(x.added ?? stat.added);
  const deleted = Number(x.deleted ?? stat.deleted);
  const badge = auth ? (
    <span className="badge warn">需要鉴权</span>
  ) : t.state === "err" ? (
    <span className="badge err">失败</span>
  ) : t.state === "denied" ? (
    <span className="badge err">已拒绝</span>
  ) : t.state === "awaiting_approval" ? (
    <span className="badge warn">待审批</span>
  ) : running ? (
    <span className="badge run">运行中</span>
  ) : (
    <span className="badge ok">{k === "edit" && patch && !diff ? "已应用" : "完成"}</span>
  );
  const empty = !t.output && !diff && !patch && !items.length && !steps.length && !hits.length && !files && !questions.length;

  const authorize = () => {
    const server = n.split(":").at(1) ?? "";
    void invoke("mcp_list", undefined)
      .then((rows) => {
        const hit = rows.find((r) => r.name === server);
        if (hit) void invoke("mcp_retry", { id: hit.id });
        actions.openScreen("mcp");
        actions.toast(hit ? `已重连 ${server}` : "未找到该 MCP 服务", "在 MCP 页完成 Sign in 授权");
      })
      .catch((err) => actions.toast("打开授权页失败", String(err)));
  };

  return (
    <div className={`tool${running ? " running" : ""}${t.state === "err" || auth ? " err" : ""}`}>
      <div className="thead" onClick={fold}>
        <span className="ti">
          <Icon name={glyph(k, n)} cls="sm" />
        </span>
        <span className="tname">{caption(n)}</span>
        <span className="tsub">{sub(t, x, k)}</span>
        <span className="tstat">
          {k === "edit" && <Stat added={added} deleted={deleted} />}
          {k === "todo" && items.length > 0 && <span>{items.filter((i) => i.state === "done").length}/{items.length}</span>}
          {badge}
          {dur(t.duration_ms)}
          {running && <span>{secs(Date.now() - since)}</span>}
          {t.truncated && <span className="badge warn">已截断</span>}
          {k === "edit" && (diff || patch) && <ReviewLink />}
          {k === "task" && (
            <button
              className="btn xs"
              title="后台化：移入右栏后台任务"
              onClick={(e) => {
                e.stopPropagation();
                actions.panel("tasks");
              }}
            >
              <Icon name="pause" cls="sm" />后台化
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="tbody">
          {k === "bash" && <Code src={String((t.args as Extra).command ?? "")} lang="sh" cmd />}

          {(diff || patch || files) && <DiffView diff={diff} patch={patch} files={files} />}

          {items.length > 0 && (
            <ul className="todo">
              {items.map((it, i) => (
                <li key={i} className={String(it.state ?? "")}>
                  <span className="cb">{it.state === "done" ? <Icon name="check" cls="sm" /> : null}</span>
                  {String(it.text ?? "")}
                  <span className="pct">{it.state === "cur" ? "进行中" : dur(it.ms) || "待办"}</span>
                </li>
              ))}
            </ul>
          )}

          {steps.length > 0 && (
            <div className="sub-flow">
              {steps.map((s, i) => (
                <div className={`tool${s.state === "cur" ? " running" : ""}`} key={i}>
                  <div className="thead">
                    <span className="ti">
                      <Icon name={String(s.icon ?? "search")} cls="sm" />
                    </span>
                    <span className="tname">{String(s.tool ?? "Step")}</span>
                    <span className="tsub">{String(s.text ?? "")}</span>
                    <span className="tstat">
                      {s.state === "done" ? (
                        <span className="badge ok">完成</span>
                      ) : s.state === "cur" ? (
                        <span className="badge run">运行中</span>
                      ) : (
                        <span className="badge gray">待办</span>
                      )}
                      {dur(s.ms)}
                    </span>
                  </div>
                </div>
              ))}
              {Boolean(x.skill) && (
                <div className="pm-item">
                  <Icon name="sparkle" cls="sm" />
                  <span className="cmd" style={{ minWidth: 0 }}>
                    Skill
                  </span>
                  <span className="desc">已注入 {String(x.skill)}</span>
                </div>
              )}
            </div>
          )}

          {questions.length > 0 && (
            <QuestionCard
              q={{ question_id: t.call_id, session_id: runtime.state.session ?? "", questions }}
              answered={t.state !== "running" && t.state !== "awaiting_approval"}
              inline
            />
          )}

          {hits.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {hits.map((h, i) => (
                <div className="grow" key={i} style={{ alignItems: "flex-start" }}>
                  <Icon name={k === "mcp" ? "book" : "globe"} cls="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--f-ui)", color: "var(--text-strong)", fontWeight: 500 }}>{String(h.title ?? "")}</div>
                    <div style={{ fontSize: 11, color: "var(--text-weaker)", fontFamily: "var(--f-mono)" }}>
                      {String(h.src ?? "")}
                      {h.body ? ` · ${String(h.body)}` : ""}
                      {h.relevance ? ` · relevance ${String(h.relevance)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {auth && (
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ flex: 1 }}>该 MCP 未完成 OAuth 授权，无法调用写操作。</span>
              <button className="btn sm primary" onClick={authorize}>
                <Icon name="key" cls="sm" />打开授权页
              </button>
            </div>
          )}

          {t.output && !auth && !diff && !patch && !hits.length && <Code src={t.output} lang={k === "mcp" ? "json" : "text"} />}

          {running && Boolean(t.output) && <span className="cursor" />}

          {t.error && (
            <div className="notice err">
              <Icon name="alert" cls="sm" />
              <div>{t.error}</div>
            </div>
          )}

          {empty && <div className="dc-hint">该工具无输出内容</div>}
        </div>
      )}

      {t.state === "awaiting_approval" && t.confirm && <ApprovalCard confirm={t.confirm} args={t.args} />}
    </div>
  );
}
