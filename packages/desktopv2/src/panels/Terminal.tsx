/** 终端：experimentalTerminal 特性开关（默认关闭）。开启时提供 PTY 会话占位与「输出加入上下文」。 */
import { useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import { ui } from "../ui/state";
import { t } from "../i18n";
import { fail, useProject, useSettings } from "./common";

type Sess = { id: string; log: string[] };

export function Terminal() {
  const cfg = useSettings();
  const { name } = useProject();
  const [sess, setSess] = useState<Sess[]>([]);

  if (cfg && !cfg.experimentalTerminal) {
    return (
      <div>
        <div className="notice warn">
          <Icon name="alert" cls="sm" />
          <div>
            <b>{t("term.offTitle")}</b>
            <br />
            {t("term.off")}
          </div>
        </div>
        <button className="btn sm primary" onClick={() => actions.settings("experimental")}>
          <Icon name="sliders" cls="sm" />
          {t("term.openSettings")}
        </button>
      </div>
    );
  }

  const open = () => {
    void invoke("terminal_open", { project: name, cols: 80, rows: 24 })
      .then((r) => setSess((xs) => [...xs, { id: r.id, log: [t("term.started", { id: r.id })] }]))
      .catch((err) => fail(t("term.openFail"), err));
  };

  const kill = (id: string) => {
    void invoke("terminal_close", { id })
      .then(() => {
        setSess((xs) => xs.filter((x) => x.id !== id));
        ui.set({ toast: { title: t("term.killed") } });
      })
      .catch((err) => fail(t("term.killFail"), err));
  };

  const send = (id: string, text: string) => {
    if (!text.trim()) return;
    void invoke("terminal_write", { id, data: `${text}\n` })
      .then(() => setSess((xs) => xs.map((x) => (x.id === id ? { ...x, log: [...x.log, `$ ${text}`] } : x))))
      .catch((err) => fail(t("term.writeFail"), err));
  };

  const inject = (log: string[]) => {
    const block = `@terminal\n${log.join("\n")}`;
    const draft = ui.get().draft;
    ui.set({ draft: draft ? `${draft}\n${block}` : block, toast: { title: t("term.injected") } });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button className="btn sm primary" onClick={open}>
          <Icon name="plus" cls="sm" />
          {t("term.new")}
        </button>
      </div>

      {sess.length === 0 && (
        <div className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
          {t("term.idle")}
        </div>
      )}

      {sess.map((x) => (
        <Pane key={x.id} sess={x} onSend={send} onKill={kill} onInject={inject} />
      ))}

      <div className="notice info" style={{ marginTop: 10 }}>
        <Icon name="info" cls="sm" />
        <div>{t("term.note")}</div>
      </div>
    </div>
  );
}

function Pane({
  sess,
  onSend,
  onKill,
  onInject,
}: {
  sess: Sess;
  onSend: (id: string, text: string) => void;
  onKill: (id: string) => void;
  onInject: (log: string[]) => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    onSend(sess.id, text);
    setText("");
  };
  return (
    <div className="ucard" style={{ padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot run" />
        <b style={{ color: "var(--text-strong)", fontSize: "var(--fs-12)" }}>{sess.id}</b>
        <span className="mono" style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button className="btn xs" onClick={() => onInject(sess.log)}>
            <Icon name="arrow-up" cls="sm" />
            {t("term.ctx")}
          </button>
          <button className="btn xs" title={t("term.kill")} onClick={() => onKill(sess.id)}>
            <Icon name="stop" cls="sm" />
          </button>
        </span>
      </div>
      <pre
        className="mono"
        style={{
          margin: "7px 0",
          fontSize: "var(--fs-11)",
          background: "var(--surface-inset-base)",
          color: "var(--code-text)",
          borderRadius: "var(--r-md)",
          padding: "8px 10px",
          overflow: "auto",
          maxHeight: 160,
          whiteSpace: "pre-wrap",
        }}
      >
        {sess.log.join("\n")}
      </pre>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="sel"
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t("term.ph")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn sm" onClick={submit}>
          {t("term.send")}
        </button>
      </div>
    </div>
  );
}
