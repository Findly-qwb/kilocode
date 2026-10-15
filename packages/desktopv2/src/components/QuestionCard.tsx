/**
 * 提问卡（ask_user / question_required，PLAN §16 q-dock、tool-question）。
 * 多题翻页 + 选项 + 自定义答案 + 跳过，答案统一走 answer_question。
 */
import { useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import type { QuestionRequired } from "../ipc/protocol";

export function QuestionCard({ q, answered = false, inline = false }: { q: QuestionRequired; answered?: boolean; inline?: boolean }) {
  const [at, setAt] = useState(0);
  const [picks, setPicks] = useState<(number | null)[]>(() => q.questions.map(() => null));
  const [own, setOwn] = useState<string[]>(() => q.questions.map(() => ""));
  const [sent, setSent] = useState<string[] | null>(null);

  const cur = q.questions[at] ?? q.questions[0];
  const total = q.questions.length;
  const choose = (i: number | null) => setPicks(picks.map((p, n) => (n === at ? i : p)));
  const custom = (v: string) => {
    setOwn(own.map((o, n) => (n === at ? v : o)));
    setPicks(picks.map((p, n) => (n === at ? -1 : p)));
  };

  const answerOf = (i: number) => {
    const hit = q.questions[i];
    if (!hit) return "";
    if (own[i]) return own[i];
    const p = picks[i];
    if (p !== null && p >= 0) return hit.options[p] ?? "";
    return "跳过";
  };

  const submit = () => {
    const answers = q.questions.map((_, i) => answerOf(i));
    setSent(answers);
    void invoke("answer_question", { question_id: q.question_id, answers });
    actions.toast("已提交回答", answers.join(" · "));
  };

  const skip = () => {
    const answers = q.questions.map((_, i) => (i === at ? "跳过" : answerOf(i)));
    setSent(answers);
    void invoke("answer_question", { question_id: q.question_id, answers });
    actions.toast("已跳过并继续");
  };

  const done = sent ?? (answered ? q.questions.map(() => "已回答") : null);
  if (done) {
    return (
      <div className={inline ? undefined : "dock-card q"}>
        <div className="dc-head">
          <Icon name="check" cls="md" />
          <span>已回答 {total} 个问题</span>
          <span className="src">ask_user</span>
        </div>
        {q.questions.map((item, i) => (
          <div className="pullrow" key={item.q}>
            <Icon name="chat" cls="sm" />
            <span style={{ flex: 1 }}>{item.q}</span>
            <span className="m">{done[i] || "跳过"}</span>
          </div>
        ))}
      </div>
    );
  }

  const body = (
    <>
      <div className="dc-head">
        <Icon name="alert-circle" cls="md" />
        <span>
          问题 {at + 1}/{total}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button className="iconbtn sm" title="上一题" disabled={at === 0} onClick={() => setAt(Math.max(0, at - 1))}>
            <Icon name="chevron-up" cls="sm" />
          </button>
          <button className="iconbtn sm" title="下一题" disabled={at >= total - 1} onClick={() => setAt(Math.min(total - 1, at + 1))}>
            <Icon name="chevron-down" cls="sm" />
          </button>
        </span>
      </div>
      <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>
        Q{at + 1} · {cur?.q}
      </div>

      {(cur?.options ?? []).map((o, i) => (
        <div className={`qopt${picks[at] === i ? " sel" : ""}`} key={o} onClick={() => choose(picks[at] === i ? null : i)}>
          <span className="mk" />
          <div>
            <div className="t">{o}</div>
          </div>
          <span className="num">{i + 1}</span>
        </div>
      ))}

      {cur?.allow_custom && (
        <div className={`qopt${picks[at] === -1 ? " sel" : ""}`} onClick={() => choose(-1)}>
          <span className="mk" />
          <div style={{ flex: 1 }}>
            <div className="t">{own[at] || "输入自定义答案…"}</div>
            <input
              className="tinp"
              style={{ width: "100%", marginTop: 6 }}
              placeholder="Type your own answer"
              value={own[at]}
              onChange={(e) => custom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <span className="num">✎</span>
        </div>
      )}

      <div className="dc-actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={skip}>
          跳过
        </button>
        <button className="btn" disabled={at === 0} onClick={() => setAt(at - 1)}>
          上一题
        </button>
        {at < total - 1 ? (
          <button className="btn" onClick={() => setAt(at + 1)}>
            下一题
          </button>
        ) : (
          <button className="btn primary" onClick={submit}>
            提交
          </button>
        )}
        <span className="push">
          <span className="kbd">⌘↵</span>提交
        </span>
      </div>
    </>
  );

  if (inline) return <div>{body}</div>;
  return <div className="dock-card q">{body}</div>;
}
