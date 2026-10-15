/**
 * 回合结果条四态（PLAN §16 outcome-*）。
 * 所有费用位置必须标注「仅为估算，非实际账单」（PLAN §14）。
 */
import { Icon, actions } from "../App";
import { invoke, runTurn } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { ui } from "../ui/state";
import type { AgentEnd, TurnEnd } from "../ipc/protocol";

const money = (n: number) => `$${n.toFixed(4)}`;

const kb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function OutcomeBar({ end, turn, ms }: { end: AgentEnd; turn?: TurnEnd; ms?: number }) {
  const busy = runtime.state.activity === "running";
  const state = end.reason === "panic" ? "error" : end.reason;
  const cls = state === "error" ? " err" : state === "stopped" ? " stop" : state === "limit" ? " limit" : "";
  const head =
    state === "error"
      ? "失败"
      : state === "stopped"
        ? "已中断（Esc）"
        : state === "limit"
          ? "已达会话花费上限"
          : "完成";
  const icon = state === "error" ? "alert" : state === "stopped" ? "stop" : state === "limit" ? "alert-circle" : "check";
  const rate = turn && ms && ms > 400 ? `${Math.round((turn.tokens.completion / ms) * 1000)} tok/s` : "";
  const cost = turn?.cost_estimate ?? 0;

  const retry = () => {
    if (busy) return actions.toast("代理仍在运行", "先 Esc 中断再重试");
    void runTurn("重试上一步", ui.get().mode);
  };

  return (
    <div className={`outcome${cls}`}>
      <Icon name={icon} cls="sm" />
      <span>
        <b>{head}</b>
        {end.summary ? ` · ${end.summary}` : ""}
        {turn ? ` · ${turn.turn_index + 1} turns · ${turn.model}` : ""}
        {cost > 0 ? ` · ${money(cost)}` : ""}
        {rate ? ` · ${rate}` : ""}
      </span>
      {cost > 0 && <span className="badge gray">仅为估算，非实际账单</span>}
      {turn && (
        <span className="mono" style={{ color: "var(--text-weaker)" }} title="token 细分">
          输入 {kb(turn.tokens.prompt)} · 输出 {kb(turn.tokens.completion)} · 推理 {kb(turn.tokens.reasoning)} · 缓存读 {kb(turn.tokens.cache_read)}
        </span>
      )}
      <span className="push" />
      {state === "done" && (
        <>
          <button className="btn sm" onClick={() => actions.panel("review")}>
            <Icon name="diff" cls="sm" />查看改动
          </button>
          <button
            className="btn sm"
            onClick={() =>
              void invoke("session_export", { session_id: runtime.state.session ?? "" })
                .then(() => actions.toast("已导出 markdown 转录"))
                .catch((err) => actions.toast("导出失败", String(err)))
            }
          >
            <Icon name="download" cls="sm" />导出
          </button>
          <button className="btn sm" onClick={() => actions.toast("感谢反馈")}>
            <Icon name="check" cls="sm" />有用
          </button>
          <button className="btn sm" onClick={() => actions.toast("已记录")}>
            <Icon name="x" cls="sm" />没用
          </button>
        </>
      )}
      {state === "stopped" && (
        <>
          <button className="btn sm" onClick={() => actions.panel("review")} title="检查点与已改动文件">
            <Icon name="redo" cls="sm" />Revert
          </button>
          <button className="btn sm primary" onClick={retry}>
            继续
          </button>
        </>
      )}
      {state === "error" && (
        <>
          <button
            className="btn sm"
            onClick={() => {
              void navigator.clipboard?.writeText(`${end.reason} · ${end.summary ?? ""}`);
              actions.toast("已复制错误详情");
            }}
          >
            <Icon name="copy" cls="sm" />详情
          </button>
          <button className="btn sm primary" onClick={retry}>
            重试
          </button>
        </>
      )}
      {state === "limit" && (
        <>
          <button
            className="btn sm"
            onClick={() =>
              void invoke("settings_get", undefined)
                .then((s) => {
                  const cap = s.costCap + 5;
                  void invoke("settings_set", { patch: { costCap: cap } });
                  actions.toast(`估算上限 → ${money(cap)}`, "仅为估算，非实际账单");
                })
                .catch((err) => actions.toast("读取上限失败", String(err)))
            }
          >
            上限 +$5
          </button>
          <button className="btn sm primary" onClick={retry}>
            批准继续
          </button>
        </>
      )}
    </div>
  );
}
