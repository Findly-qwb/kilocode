/**
 * 命令面板 ⌘K（M0-13）：会话 / 命令 / 面板 / 皮肤 四类条目统一入口。
 * 数据全部来自真实来源：session_list、SCREENS、ui.panel、skins/loader。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { SessionRow } from "../ipc/protocol";
import { apply, list } from "../skins/loader";
import { SCREENS } from "../screens";
import { goto } from "../ui/nav";
import { ui, useUi } from "../ui/state";

type Row = { group: string; label: string; sub?: string; icon: string; run: () => void };

const PANELS: { label: string; id: "picker" | "tree" | "terminal" | "review" | "tasks" }[] = [
  { label: "文件树", id: "tree" },
  { label: "变更审查", id: "review" },
  { label: "后台任务", id: "tasks" },
  { label: "终端", id: "terminal" },
  { label: "能力入口", id: "picker" },
];

export function Palette() {
  const s = useUi();
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[]>(runtime.state.sessions);

  useEffect(() => {
    if (s.popover !== "palette") return;
    setQ("");
    setHl(0);
    void invoke("session_list", {}).then((rows) => setSessions(rows as SessionRow[]));
  }, [s.popover]);

  const rows = useMemo<Row[]>(() => {
    const cmds: Row[] = SCREENS.filter((x) => x.pri === "P0").map((x) => ({
      group: "命令",
      label: x.name,
      sub: `${x.id} · ${x.desc}`,
      icon: "arrow-up",
      run: () => void goto(x.id),
    }));
    const out: Row[] = [
      ...sessions.slice(0, 6).map((x) => ({
        group: "会话",
        label: x.title,
        sub: `${x.status} · ${new Date(x.updated_at).toLocaleDateString("zh-CN")}`,
        icon: "chat",
        run: () => {
          runtime.local((st) => {
            st.session = x.id;
          });
          void goto("chat-stream");
        },
      })),
      ...cmds,
      ...PANELS.map((p) => ({
        group: "面板",
        label: `打开${p.label}`,
        icon: "layout",
        run: () => ui.set({ panel: p.id, right: false, popover: null }),
      })),
      ...list().map((k) => ({
        group: "皮肤",
        label: `切换到 ${k.name}`,
        sub: k.mode,
        icon: "palette",
        run: () => {
          apply(k.id);
          ui.set({ popover: null, toast: { title: `皮肤：${k.name}` } });
        },
      })),
    ];
    const needle = q.trim().toLowerCase();
    return needle ? out.filter((r) => `${r.label}${r.sub ?? ""}`.toLowerCase().includes(needle)) : out;
  }, [q, sessions]);

  if (s.popover !== "palette") return null;

  const pick = (r: Row) => {
    ui.set({ popover: null });
    r.run();
  };

  return (
    <div className="palette show" role="dialog" aria-label="命令面板">
      <input
        autoFocus
        placeholder="搜会话 / 命令 / 面板 / 皮肤…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHl(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHl(Math.min(rows.length - 1, hl + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHl(Math.max(0, hl - 1));
          }
          if (e.key === "Enter" && rows[hl]) {
            e.preventDefault();
            pick(rows[hl]);
          }
        }}
      />
      <div className="plist">
        {rows.map((r, i) => (
          <div key={`${r.group}-${r.label}-${i}`} className={`pitem ${i === hl ? "hl" : ""}`} onClick={() => pick(r)}>
            <Icon name={r.icon} cls="sm" />
            <span>{r.label}</span>
            {r.sub ? <span className="g">{r.sub}</span> : null}
          </div>
        ))}
        {!rows.length ? <div className="pitem">无匹配项</div> : null}
      </div>
      <div className="pfoot">
        ↑↓ 选择 · Enter 执行 · Esc 关闭 · 共 {rows.length} 条
      </div>
    </div>
  );
}
