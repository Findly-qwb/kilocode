/**
 * 输入区浮层（PLAN §16 pop-* 屏）。
 * 通用列表用 .pop + .pm-item；模型用 .modelpop；权限速览用 .shieldpop + .sh-row。
 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { ui } from "../ui/state";
import type { Effective } from "../ipc/protocol";

export type Item = {
  cmd: string;
  desc?: string;
  icon?: string;
  group?: string;
  kbd?: string;
  tag?: [string, string];
  dim?: boolean;
};

export function Popover({ items, hl, onPick, foot }: { items: Item[]; hl: number; onPick: (x: Item) => void; foot?: React.ReactNode }) {
  const rows: React.ReactNode[] = [];
  let last = "";
  items.forEach((x, i) => {
    if (x.group && x.group !== last) {
      last = x.group;
      rows.push(
        <div className="pop-head" key={`g${x.group}`}>
          {x.group}
        </div>,
      );
    }
    rows.push(
      <div
        className={`pm-item${i === hl ? " hl" : ""}`}
        key={`${x.cmd}-${i}`}
        style={x.dim ? { opacity: 0.5 } : undefined}
        onClick={() => onPick(x)}
      >
        {x.icon && <Icon name={x.icon} cls="sm" />}
        <span className="cmd" style={x.cmd.length > 18 ? { minWidth: 0, fontWeight: 400 } : undefined}>
          {x.cmd}
        </span>
        <span className="desc">{x.desc}</span>
        {x.tag && <span className={`badge ${x.tag[1]}`}>{x.tag[0]}</span>}
        {x.kbd && <span className="kbd">{x.kbd}</span>}
      </div>,
    );
  });
  return (
    <div className="pop show">
      {rows.length > 0 ? rows : <div className="pm-item">无匹配项</div>}
      {foot && <div className="sh-foot">{foot}</div>}
    </div>
  );
}

/** 模式：Ask / Plan / Code */
export function ModePop({ hl }: { hl: number }) {
  const rows: Item[] = [
    { cmd: "Code", desc: "完整读写与命令执行", icon: "compass", group: "交互模式", tag: ui.get().mode === "code" ? ["当前", "brand"] : undefined },
    { cmd: "Plan", desc: "只读探索并产出计划，批准后转 Code", icon: "bulb", group: "交互模式", tag: ui.get().mode === "plan" ? ["当前", "brand"] : undefined },
    { cmd: "Ask", desc: "仅问答，不改文件", icon: "chat", group: "交互模式", tag: ui.get().mode === "ask" ? ["当前", "brand"] : undefined },
    { cmd: "Architect", desc: "已由 Plan 替代", icon: "bot", group: "已废弃", dim: true, tag: ["deprecated", "warn"] },
  ];
  return (
    <Popover
      items={rows}
      hl={hl}
      onPick={(x) => {
        if (x.cmd === "Architect") return;
        const mode = x.cmd.toLowerCase() as "ask" | "plan" | "code";
        ui.set({ mode, popover: null, toast: { title: `${x.cmd} 模式已启用` } });
        void invoke("set_mode", { session_id: runtime.state.session ?? "", mode });
      }}
    />
  );
}

/** 推理变体：端点无 variants 时由调用方隐藏 */
export function VariantPop({ hl }: { hl: number }) {
  const list = ["默认", "low", "medium", "high", "xhigh"];
  const desc = ["沿用模型默认", "更快、更省 token", "均衡", "深度推理，steps +", "最长思考，适合架构决策"];
  const rows: Item[] = list.map((v, i) => ({
    cmd: v,
    desc: desc[i],
    icon: "variant",
    group: `推理强度变体 · ${ui.get().model}`,
    tag: i > 2 ? ["成本 ↑", "warn"] : undefined,
  }));
  return (
    <Popover
      items={rows}
      hl={hl}
      onPick={(x) => {
        ui.set({ variant: x.cmd === "默认" ? "" : x.cmd, popover: null, toast: { title: `推理强度：${x.cmd}` } });
        void invoke("set_model", { session_id: runtime.state.session ?? "", model: ui.get().model, variant: x.cmd === "默认" ? undefined : x.cmd });
      }}
      foot={
        <>
          <span>模型无 variants 时该选择器自动隐藏</span>
          <span className="kbd">⇧Tab</span>
        </>
      }
    />
  );
}

/** 权限速览：真实数据走 permission_effective */
export function ShieldPop({ cap }: { cap: number }) {
  const [rows, setRows] = useState<Effective[]>([]);
  useEffect(() => {
    let stop = false;
    void invoke("permission_effective", { session_id: runtime.state.session ?? "" }).then((r) => {
      if (!stop) setRows(r);
    });
    return () => {
      stop = true;
    };
  }, []);
  const lvl = (p: string) => (p === "auto" ? "allow" : p === "deny" ? "deny" : "ask");
  const txt = (p: string) => (p === "auto" ? "auto" : p === "deny" ? "拒绝" : "询问");
  return (
    <div className="shieldpop show">
      {rows.map((r) => (
        <div className="sh-row" key={r.tool}>
          <span className="lbl">
            {r.tool}
            {r.matcher && <span className="mono" style={{ marginLeft: 6, fontSize: 11 }}>{r.matcher}</span>}
          </span>
          <span className={`lvl ${lvl(r.policy)}`}>{txt(r.policy)}</span>
          {r.policy === "require_approval" && (
            <button className="btn xs" onClick={() => actions.settings("approve")} title="为该工具建立例外 matcher">
              例外 +
            </button>
          )}
        </div>
      ))}
      {rows.length === 0 && <div className="sh-row">暂无生效策略</div>}
      <div className="sh-foot">
        <span>
          花费熔断（估算）<b>${cap.toFixed(2)}</b>
        </span>
        <button className="btn sm" onClick={() => actions.settings("approve")}>
          全部规则 →
        </button>
      </div>
    </div>
  );
}

/** 模型选择：候选来自端点连通性检测（provider_test 返回 models） */
export function ModelPop({ hl }: { hl: number }) {
  const [list, setList] = useState<string[]>([]);
  const [err, setErr] = useState<string>("");
  const [star, setStar] = useState<string[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    let stop = false;
    void invoke("provider_test", { base_url: "" })
      .then((r) => {
        if (stop) return;
        setList(r.models);
        setErr(r.error ?? "");
      })
      .catch((e) => setErr(String(e)));
    return () => {
      stop = true;
    };
  }, []);
  const hit = list.filter((m) => m.toLowerCase().includes(q.toLowerCase()));
  const cur = ui.get().model;
  const pick = (m: string) => {
    ui.set({ model: m, popover: null, toast: { title: `已切换模型：${m}`, body: "按会话记忆选择" } });
    void invoke("set_model", { session_id: runtime.state.session ?? "", model: m, variant: ui.get().variant || undefined });
  };
  return (
    <div className="modelpop show">
      <div className="mp-left">
        <div className="mp-search">
          <Icon name="search" />
          <input placeholder="搜索模型、能力、供应商…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="mp-list">
          <div className="mp-group">{star.length > 0 ? <Icon name="star" cls="sm" /> : null}当前端点</div>
          {hit.map((m, i) => (
            <div className={`mp-row${m === cur ? " sel" : ""}${i === hl ? " sel" : ""}`} key={m} onClick={() => pick(m)}>
              <span className="mono" style={{ color: "var(--text-weaker)", fontSize: 11 }}>
                {m.slice(0, 1)}
              </span>
              <span>{m}</span>
              <span className="tags">
                <span className="price">—</span>
                <span
                  className={`star${star.includes(m) ? " on" : ""}`}
                  title="收藏"
                  onClick={(e) => {
                    e.stopPropagation();
                    setStar(star.includes(m) ? star.filter((x) => x !== m) : [...star, m]);
                  }}
                >
                  <Icon name="star" cls="sm" />
                </span>
              </span>
            </div>
          ))}
          {hit.length === 0 && <div className="mp-row">端点未返回模型列表：{err || "填 base_url 后重试"}</div>}
        </div>
      </div>
      <div className="mp-right">
        <h4>
          {cur}
          <span className={`star${star.includes(cur) ? " on" : ""}`}>
            <Icon name="star" cls="sm" />
          </span>
        </h4>
        <div className="prov">settings.model</div>
        <div className="pr">
          <span>输入</span>
          <b>—</b>
        </div>
        <div className="pr">
          <span>输出</span>
          <b>—</b>
        </div>
        <div className="kv">
          <span>上下文</span>
          <b>—</b>
        </div>
        <div className="cap">
          <span className="badge ok">tool call</span>
          {ui.get().variant && <span className="badge purple">{ui.get().variant}</span>}
        </div>
        <div className="desc">价格与上下文需端点提供，未提供时留空；费用一律为本地估算。</div>
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          <button className="btn sm" onClick={() => actions.modal("endpoint")}>
            添加端点
          </button>
          <button className="btn sm" onClick={() => actions.openScreen("endpoints")}>
            <Icon name="external" cls="sm" />端点列表
          </button>
        </div>
      </div>
    </div>
  );
}
