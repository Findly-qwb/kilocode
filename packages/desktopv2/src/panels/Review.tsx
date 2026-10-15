/** 变更审查：git 状态 / diff（内联+并排）/ 暂存 / 审批语义的提交与推送 / 检查点区。 */
import { useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { ui } from "../ui/state";
import { t } from "../i18n";
import { fail, useProject } from "./common";

type Row = { kind: string; line: string };
type Snap = { id: string; n: number; model: string; cost: number };

const cls = (l: string) =>
  l.startsWith("@@") ? "hh" : l.startsWith("---") || l.startsWith("+++") ? "gh" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx";

const head = (p: string) => p.split("/").pop() ?? p;

const gclass = (s: string) => (s === "M" ? "M" : s === "A" ? "A" : s === "D" ? "D" : "U");

export function Review() {
  const { name } = useProject();
  const st = runtime.state;
  const git = st.git;
  const [diff, setDiff] = useState<{ path: string; text?: string; err?: string } | null>(null);
  const [side, setSide] = useState(false);
  const [msg, setMsg] = useState("");
  const [gate, setGate] = useState("");
  const [armed, setArmed] = useState("");
  const [gen, setGen] = useState(false);

  const snaps: Snap[] = [];
  for (const m of st.messages) {
    for (const b of m.blocks) {
      if (b.kind === "outcome" && b.turn) snaps.push({ id: m.id, n: b.turn.turn_index, model: b.turn.model, cost: b.turn.cost_estimate });
    }
  }
  snaps.sort((a, b) => a.n - b.n);

  const reload = () => {
    void invoke("git_status", { project: name })
      .then(() => ui.set({ toast: { title: t("review.refreshed") } }))
      .catch((err) => fail(t("review.opFail"), err));
  };

  const showDiff = (path: string) => {
    setDiff({ path });
    void invoke("git_diff", { project: name, path })
      .then((text) => setDiff({ path, text }))
      .catch((err) => setDiff({ path, err: String(err) }));
  };

  const move = (paths: string[], on: boolean) => {
    void invoke(on ? "git_stage" : "git_unstage", { project: name, paths })
      .then(() => invoke("git_status", { project: name }))
      .catch((err) => fail(t("review.opFail"), err));
  };

  /** commit / push 一律走审批语义：提示后交给后端，UI 不假装已执行 */
  const commit = () => {
    if (!msg.trim()) {
      ui.set({ toast: { title: t("review.commitNeedMsg") } });
      return;
    }
    setGate(t("review.approval"));
    void invoke("git_commit", { project: name, message: msg })
      .then((r) => ui.set({ toast: { title: t("review.committed", { oid: r.oid }) } }))
      .catch((err) => fail(t("review.opFail"), err));
  };

  const push = () => {
    setGate(t("review.approval"));
    void invoke("git_push", { project: name })
      .then(() => ui.set({ toast: { title: t("review.pushed") } }))
      .catch((err) => fail(t("review.opFail"), err));
  };

  const ai = () => {
    setGen(true);
    void invoke("git_generate_message", { project: name })
      .then((r) => setMsg(r.message))
      .catch((err) => fail(t("review.aiFail"), err))
      .finally(() => setGen(false));
  };

  const revertTo = (messageId: string, label: string) => {
    void invoke(label === "redo" ? "redo_step" : "revert_to_message", { session_id: st.session ?? "", message_id: messageId })
      .then((r) => ui.set({ toast: { title: t(label === "redo" ? "review.redoed" : "review.reverted", { n: r.files.length }) } }))
      .catch((err) => fail(t("review.revertFail"), err));
  };

  /** 单文件还原走检查点：定位最近一次快照回滚，如实汇报影响文件数 */
  const restore = (path: string) => {
    if (armed !== path) {
      setArmed(path);
      return;
    }
    setArmed("");
    const hit = snaps.at(-1);
    if (!hit || !st.session) {
      ui.set({ toast: { title: t("review.noSnap") } });
      return;
    }
    revertTo(hit.id, "revert");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
        <span className="pill">
          <Icon name="branch" cls="sm" />
          <b>{git?.branch ?? "—"}</b>
        </span>
        <span className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
          ↑{git?.ahead ?? 0} ↓{git?.behind ?? 0}
        </span>
        <button className="btn xs" style={{ marginLeft: "auto" }} onClick={reload}>
          <Icon name="refresh" cls="sm" />
          {t("common.refresh")}
        </button>
      </div>

      {!git && (
        <div className="notice info">
          <Icon name="info" cls="sm" />
          <div>{t("review.load")}</div>
        </div>
      )}

      {git && (
        <>
          <div className="grp" style={{ margin: "0 0 4px" }}>
            {t("review.uncommitted", { n: git.files.length })}
            {git.files.length > 0 && (
              <span className="act" style={{ opacity: 1 }}>
                <button className="btn xs" onClick={() => move(git.files.map((f) => f.path), true)}>
                  {t("review.stageAll")}
                </button>
              </span>
            )}
          </div>
          {git.files.length === 0 && <div className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>{t("review.clean")}</div>}
          {git.files.map((f) => (
            <div className="grow" key={f.path} title={f.path}>
              <span className={`gbadge ${gclass(f.status)}`}>{f.status}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{head(f.path)}</span>
              <span className="stat">
                <span className="a">+{f.added}</span>
                <span className="d">−{f.deleted}</span>
              </span>
              <button className="iconbtn sm" title={t("review.diffBtn")} onClick={() => showDiff(f.path)}>
                <Icon name="eye" cls="sm" />
              </button>
              <button className="iconbtn sm" title={t("review.stage")} onClick={() => move([f.path], true)}>
                <Icon name="plus" cls="sm" />
              </button>
              <button className="iconbtn sm" title={t("review.unstage")} onClick={() => move([f.path], false)}>
                <Icon name="x" cls="sm" />
              </button>
              {armed === f.path ? (
                <>
                  <button className="btn xs primary" onClick={() => restore(f.path)}>
                    {t("review.revertGo")}
                  </button>
                  <button className="btn xs" onClick={() => setArmed("")}>
                    {t("common.cancel")}
                  </button>
                </>
              ) : (
                <button className="iconbtn sm" title={t("review.revertFile")} onClick={() => restore(f.path)}>
                  <Icon name="redo" cls="sm" />
                </button>
              )}
            </div>
          ))}
          {armed && (
            <div className="notice warn" style={{ marginTop: 6 }}>
              <Icon name="alert" cls="sm" />
              <div>{t("review.revertAsk", { path: armed })}</div>
            </div>
          )}

          {diff && (
            <div className="fileview">
              <div className="fvh">
                <Icon name="diff" cls="sm" />
                <b>{head(diff.path)}</b>
                <span className="mono" style={{ marginLeft: "auto", fontSize: "var(--fs-10)", color: "var(--text-weaker)" }}>
                  {t("review.diffOf", { path: diff.path })}
                </span>
                <button className="btn xs" onClick={() => setDiff(null)}>
                  <Icon name="x" cls="sm" />
                  {t("common.close")}
                </button>
              </div>
              <div className="segbar" style={{ margin: "8px 10px" }}>
                <span className={`seg${side ? "" : " active"}`} onClick={() => setSide(false)}>
                  {t("review.inline")}
                </span>
                <span className={`seg${side ? " active" : ""}`} onClick={() => setSide(true)}>
                  {t("review.split")}
                </span>
              </div>
              {diff.err && (
                <div className="notice err" style={{ margin: "0 10px 10px" }}>
                  <Icon name="alert" cls="sm" />
                  <div>{t("review.diffFail")}：{diff.err}</div>
                </div>
              )}
              {diff.text !== undefined && (diff.text.trim() ? <Diff rows={parse(diff.text)} side={side} /> : <div className="mono" style={{ padding: "0 10px 10px", fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>{t("review.diffEmpty")}</div>)}
            </div>
          )}

          <div className="field" style={{ marginTop: 11 }}>
            <label>{t("review.commitMsg")}</label>
            <textarea className="commitbox" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn sm" style={{ marginTop: 6 }} onClick={ai} disabled={gen}>
              <Icon name="sparkle" cls="sm" />
              {t("review.ai")}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary sm" style={{ flex: 1 }} onClick={commit}>
              <Icon name="check" cls="sm" />
              {t("review.commit")}
            </button>
            <button className="btn sm" onClick={push}>
              <Icon name="upload" cls="sm" />
              {t("review.push")}
            </button>
          </div>
          {gate && (
            <div className="notice warn" style={{ marginTop: 8 }}>
              <Icon name="shield" cls="sm" />
              <div>{gate}</div>
            </div>
          )}
        </>
      )}

      <div className="grp" style={{ margin: "14px 0 4px" }}>
        {t("review.ckpt")}
      </div>
      {snaps.length === 0 && (
        <div className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
          {t("review.noSnap")}
        </div>
      )}
      {snaps.map((sp, i) => (
        <div className="grow" key={sp.id} style={{ borderBottom: "1px solid var(--border-weak)" }}>
          <Icon name="history" cls="sm" />
          <span style={{ flex: 1, minWidth: 80 }}>{i === 0 ? t("review.base") : t("review.turn", { n: sp.n, model: sp.model })}</span>
          <span className="mono" style={{ fontSize: "var(--fs-10)", color: "var(--text-weaker)" }}>
            ${sp.cost.toFixed(4)} · {st.files.length}f
          </span>
          <button className="btn xs" onClick={() => revertTo(sp.id, "revert")}>
            {t("review.revert")}
          </button>
          {i === snaps.length - 1 && snaps.length > 1 && (
            <button className="btn xs" onClick={() => revertTo(sp.id, "redo")}>
              {t("review.redo")}
            </button>
          )}
        </div>
      ))}
      <div className="mono" style={{ fontSize: "var(--fs-10)", color: "var(--text-weaker)", margin: "5px 0 8px" }}>
        {t("review.snapNote")}
      </div>
      <div className="notice info">
        <Icon name="lock" cls="sm" />
        <div>{t("review.lockNote")}</div>
      </div>
    </div>
  );
}

function parse(text: string): Row[] {
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => ({ line, kind: cls(line) }));
}

function Diff({ rows, side }: { rows: Row[]; side: boolean }) {
  if (!side) {
    return (
      <div className="diff" style={{ padding: "0 10px 10px" }}>
        {rows.map((r, i) => (
          <span key={i} className={r.kind}>
            {r.line}
          </span>
        ))}
      </div>
    );
  }
  const L: Row[] = [];
  const R: Row[] = [];
  for (const r of rows) {
    if (r.kind === "del") {
      L.push(r);
      R.push({ line: "", kind: "ctx" });
      continue;
    }
    if (r.kind === "add") {
      L.push({ line: "", kind: "ctx" });
      R.push(r);
      continue;
    }
    L.push(r);
    R.push(r);
  }
  return (
    <div style={{ display: "flex", gap: 6, padding: "0 10px 10px" }}>
      <div className="diff" style={{ flex: 1, minWidth: 0 }}>
        {L.map((r, i) => (
          <span key={i} className={r.kind}>
            {r.line || " "}
          </span>
        ))}
      </div>
      <div className="diff" style={{ flex: 1, minWidth: 0 }}>
        {R.map((r, i) => (
          <span key={i} className={r.kind}>
            {r.line || " "}
          </span>
        ))}
      </div>
    </div>
  );
}
