/**
 * 审批卡（PLAN §3.3 oneshot + 超时自动 deny / §16 perm-* 屏）。
 *
 * 渲染位置有两处：工具卡内（state === "awaiting_approval"，数据来自 store 的 confirm 字段）
 * 与转录末尾（human_confirm_required 找不到对应工具块时）。后者在原型里就是 dock-card 直接
 * 落在 #messages 末尾，因此这里在组件内维护一份 confirm 旁路表（不改 runtime reducer）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon, actions } from "../App";
import { invoke, listen } from "../ipc/bridge";
import { cut } from "../ipc/highlight";
import { runtime } from "../ipc/runtime";
import { ui } from "../ui/state";
import type { HumanConfirmRequired, Policy } from "../ipc/protocol";
import { DiffView } from "./DiffView";

const subs = new Set<() => void>();
const confs = new Map<string, HumanConfirmRequired>();
let cache: HumanConfirmRequired[] = [];
let scene = ui.get().scene;

function refresh() {
  cache = [...confs.values()];
  for (const fn of subs) fn();
}

/** 旁路表只在模块加载时挂钩：App → Chat → MessageList → 本文件，早于 boot() 投递事件 */
listen("human_confirm_required", (p) => {
  confs.set(p.call_id, p);
  refresh();
});
listen("tool_call_result", (p) => {
  if (confs.delete(p.call_id)) refresh();
});
listen("agent_end", () => {
  if (confs.size) {
    confs.clear();
    refresh();
  }
});
ui.sub(() => {
  if (ui.get().scene === scene) return;
  scene = ui.get().scene;
  if (!confs.size) return;
  confs.clear();
  refresh();
});

export function useConfirms() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => cache,
  );
}

/** 没有对应工具块的审批（dock 卡直接挂在转录末尾） */
export function orphans(list: HumanConfirmRequired[]) {
  const owned = new Set<string>();
  for (const m of runtime.state.messages) for (const b of m.blocks) if (b.kind === "tool") owned.add(b.call_id);
  return list.filter((c) => !owned.has(c.call_id));
}

const fmt = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** 高亮代码块（工具卡与审批卡共用；shell 提示符走 pre.cmd .p） */
export function Code({ src, lang = "text", cmd = false }: { src: string; lang?: string; cmd?: boolean }) {
  return (
    <pre className={cmd ? "cmd" : undefined}>
      {cut(src, lang).map((t, i) => (t.c ? <span className={t.c} key={i}>{t.v}</span> : <span key={i}>{t.v}</span>))}
    </pre>
  );
}

const PUNY = /(?:xn--)[a-z0-9-]+/i;
const homoglyph = (c: HumanConfirmRequired) => Boolean(c.homoglyph) || PUNY.test(c.command ?? "");

function defaults(c: HumanConfirmRequired, args?: Record<string, unknown>) {
  if (args) return args;
  if (c.kind === "paths") return { paths: c.paths ?? [] };
  if (c.kind === "diff") return { diff: c.diff ?? "" };
  return { command: c.command ?? "" };
}

export function ApprovalCard({ confirm, args }: { confirm: HumanConfirmRequired; args?: Record<string, unknown> }) {
  const [edit, setEdit] = useState(false);
  const [raw, setRaw] = useState(() => JSON.stringify(defaults(confirm, args), null, 2));
  const [bad, setBad] = useState("");
  const [always, setAlways] = useState(false);
  const left = useRef(confirm.expires_at - Date.now());
  const [tick, setTick] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      left.current = confirm.expires_at - Date.now();
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [confirm.expires_at]);

  const send = (decision: "allow" | "deny" | "allow_always", patch?: Record<string, unknown>) => {
    confs.delete(confirm.call_id);
    refresh();
    void invoke("approve_tool_call", {
      call_id: confirm.call_id,
      decision,
      modified_args: patch,
      reason: decision === "deny" ? "用户拒绝" : undefined,
    });
    if (decision === "deny") actions.toast("已拒绝", "代理收到 deny，回合终止（可在权限页改为拒绝后继续）");
  };

  useEffect(() => {
    if (left.current > 0 || fired.current) return;
    fired.current = true;
    send("deny");
    actions.toast("审批超时", "已按默认策略自动拒绝");
  }, [tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = ui.get();
      if (s.modal || s.popover) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        send("allow");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        send("deny");
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const host = PUNY.exec(confirm.command ?? "")?.[0];
  const rule = confirm.matched_rule;
  const setPolicy = (policy: Policy) =>
    void invoke("permission_set", {
      scope: "session",
      scope_ref: runtime.state.session,
      tool: confirm.tool_name,
      policy,
      matcher: rule?.matcher,
    });

  return (
    <div className="dock-card">
      <div className="dc-head">
        <Icon name="alert" cls="md" />
        <span>{confirm.kind === "command" ? "请求执行命令" : confirm.kind === "paths" ? `请求修改 ${confirm.paths?.length ?? 0} 个文件` : "请求写入 diff"}</span>
        <span className="src">
          {confirm.tool_name} · {confirm.source} · 命中 {rule ? `${rule.scope} ${rule.policy}` : "require_approval"}
        </span>
      </div>
      <div className="dc-hint">该操作会改动你的环境。允许一次，或为同类操作放行；超时后自动拒绝。</div>

      {homoglyph(confirm) && (
        <div className="notice warn">
          <Icon name="alert" cls="sm" />
          <div>
            <b>同形 / punycode 域名命中</b>：{host ?? "命令内容"} 与常见主机名形似，可能是伪装站点。请核对后再允许。
          </div>
        </div>
      )}

      {confirm.kind === "command" && (
        <div style={{ position: "relative" }}>
          <Code src={confirm.command ?? ""} lang="sh" cmd />
          <button
            className="btn xs"
            style={{ position: "absolute", top: 6, right: 6 }}
            title="复制命令"
            onClick={() => {
              void navigator.clipboard?.writeText(confirm.command ?? "");
              actions.toast("已复制命令");
            }}
          >
            <Icon name="copy" cls="sm" />复制
          </button>
        </div>
      )}

      {confirm.kind === "paths" && (
        <div>
          {(confirm.paths ?? []).map((p) => (
            <div className="grow" key={p}>
              <Icon name="file" cls="sm" />
              <span style={{ flex: 1 }}>{p}</span>
              <button className="btn xs" title="在审查面板预览" onClick={() => actions.panel("review")}>
                <Icon name="eye" cls="sm" />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirm.kind === "diff" && <DiffView diff={confirm.diff} />}

      <div className="rules">
        <div className="rh">
          <Icon name="shield" cls="sm" />
          权限例外
          <span style={{ fontWeight: 400, color: "var(--text-weaker)" }}>（本次及以后的匹配规则）</span>
        </div>
        <label>
          <span className={`switch sm${always ? " on" : ""}`} onClick={() => setAlways(!always)}>
            <i />
          </span>
          <code className="mono">{rule?.matcher ?? `${confirm.tool_name} *`}</code> 同类操作 {always ? <span className="badge ok">allow</span> : <span className="badge warn">询问</span>}
        </label>
        <label>
          <span className="switch sm on" onClick={() => setPolicy("deny")}>
            <i />
          </span>
          <code className="mono">rm -rf *</code> 危险删除 <span className="badge err">deny</span>
        </label>
        <label>
          <span className="switch sm on">
            <i />
          </span>
          punycode 同形域名检测 <span className="badge warn">pending</span>
        </label>
      </div>

      {edit && (
        <div className="field">
          <label>
            修改参数后执行 <span className="opt">（JSON，随 approve_tool_call 一起回传）</span>
          </label>
          <textarea className="commitbox" value={raw} onChange={(e) => setRaw(e.target.value)} rows={6} />
          {bad && (
            <div className="err">
              <Icon name="alert-circle" cls="sm" />
              {bad}
            </div>
          )}
        </div>
      )}

      <div className="dc-actions">
        <button className="btn primary" onClick={() => send("allow")}>
          <Icon name="check" cls="sm" />同意
        </button>
        <button className="btn danger" onClick={() => send("deny")}>
          <Icon name="x" cls="sm" />拒绝
        </button>
        <button className="btn" onClick={() => setEdit(!edit)}>
          <Icon name="pencil" cls="sm" />改参数后执行
        </button>
        {edit && (
          <button
            className="btn primary"
            onClick={() => {
              let patch: Record<string, unknown>;
              try {
                patch = JSON.parse(raw) as Record<string, unknown>;
              } catch (err) {
                setBad(`参数不是合法 JSON：${String(err)}`);
                return;
              }
              setBad("");
              send("allow", patch);
              actions.toast("已按修改后的参数执行");
            }}
          >
            <Icon name="play" cls="sm" />执行
          </button>
        )}
        <button
          className="btn"
          title="为该工具建立 auto 策略（allow_always）"
          onClick={() => {
            setPolicy("auto");
            send("allow_always");
            actions.toast("已始终允许此类", `permission_set → ${confirm.tool_name} auto`);
          }}
        >
          始终允许此类
        </button>
        <span className="push">
          <span className="kbd">↵</span>允许<span className="kbd">esc</span>拒绝
          <span className="countdown" title="审批有效期">剩余 {fmt(left.current)}</span>
        </span>
      </div>
    </div>
  );
}
