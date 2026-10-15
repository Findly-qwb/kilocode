/** 入口总览：四张能力卡片；折叠态与子视图按项目记忆（localStorage）。 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { runtime } from "../ipc/runtime";
import { ui, useUi, type Panel } from "../ui/state";
import { t } from "../i18n";
import { memory, useProject, useSettings } from "./common";

const CARDS: { id: Panel; icon: string }[] = [
  { id: "terminal", icon: "terminal" },
  { id: "tree", icon: "folder" },
  { id: "review", icon: "diff" },
  { id: "tasks", icon: "list-checks" },
];

export function Picker() {
  const s = useUi();
  const st = runtime.state;
  const cfg = useSettings();
  const { name } = useProject();
  const [last, setLast] = useState<Panel>("picker");

  // 回到入口时记录当前折叠态；子视图记忆在 open() 时写入
  useEffect(() => {
    const hit = memory.load(name);
    if (hit) setLast(hit.panel);
    memory.save(name, { panel: hit?.panel ?? "picker", right: ui.get().right });
  }, [name]);

  const open = (p: Panel) => {
    memory.save(name, { panel: p, right: ui.get().right });
    actions.panel(p);
  };

  const termOn = cfg?.experimentalTerminal ?? false;
  const added = (st.git?.files ?? []).reduce((n, f) => n + f.added, 0);
  const removed = (st.git?.files ?? []).reduce((n, f) => n + f.deleted, 0);
  const jobs = (st.scan && st.scan.phase !== "done" ? 1 : 0) + Object.keys(st.mcp).length + 1;

  const meta = (id: Panel) => {
    if (id === "tree") return t("picker.meta.files", { n: st.scan?.total ?? st.scan?.scanned ?? 0 });
    if (id === "terminal") return termOn ? t("picker.meta.ready") : t("picker.meta.off");
    if (id === "review") return st.git ? t("picker.meta.diff", { a: added, d: removed }) : "git —";
    return t("picker.meta.jobs", { n: jobs });
  };

  const click = (id: Panel) => {
    if (id === "terminal" && cfg && !termOn) {
      ui.set({ toast: { title: t("picker.expOn"), body: t("picker.toSettings") } });
      actions.settings("experimental");
      return;
    }
    open(id);
  };

  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: "var(--fs-14)", color: "var(--text-strong)" }}>{t("picker.title")}</h3>
        <p style={{ fontSize: "var(--fs-11)", color: "var(--text-weak)", marginTop: 3 }}>{t("picker.sub")}</p>
        {last !== "picker" && last !== s.panel && (
          <button className="btn xs" style={{ marginTop: 7 }} onClick={() => open(last)}>
            <Icon name="history" cls="sm" />
            {t("picker.resume", { p: t(`picker.${last}.t`) })}
          </button>
        )}
      </div>
      {CARDS.map((c) => {
        const off = c.id === "terminal" && cfg && !termOn;
        return (
          <div
            key={c.id}
            className="modcard"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && click(c.id)}
            onClick={() => click(c.id)}
            style={off ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
          >
            <span className="ic">
              <Icon name={off ? "lock" : c.icon} cls="md" />
            </span>
            <div>
              <h4>{t(`picker.${c.id}.t`)}</h4>
              <p>{off ? t("picker.expOn") : t(`picker.${c.id}.d`)}</p>
            </div>
            <span className="meta">{meta(c.id)}</span>
          </div>
        );
      })}
    </div>
  );
}
