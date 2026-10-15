/** 右栏 = 本地能力面板（PLAN §5.1）：入口卡片 + 子视图，不做 SSH / 内网穿透 */
import { Icon, actions } from "../App";
import { ui, useUi } from "../ui/state";
import { Picker, Review, Tasks, Terminal, Tree } from "../panels";
import type { Panel } from "../ui/state";

const TABS: { id: Panel; name: string; icon: string }[] = [
  { id: "tree", name: "文件树", icon: "folder" },
  { id: "terminal", name: "终端", icon: "terminal" },
  { id: "review", name: "变更审查", icon: "diff" },
  { id: "tasks", name: "后台任务", icon: "activity" },
];

export function Dock() {
  const s = useUi();
  const Body = { picker: Picker, tree: Tree, terminal: Terminal, review: Review, tasks: Tasks }[s.panel];

  return (
    <aside className="dock" id="dock">
      <div className="dock-head">
        <span className="ttl">
          <Icon name="layout" />
          {s.panel === "picker" ? "模块" : TABS.find((t) => t.id === s.panel)?.name}
        </span>
        <button className="iconbtn sm" style={{ marginLeft: "auto" }} onClick={() => actions.openScreen("panel-picker")} title="关闭右栏 ⌥]">
          <Icon name="x" cls="sm" />
        </button>
      </div>
      <div className="dock-tabs" style={{ display: s.panel === "picker" ? "none" : "flex" }}>
        {TABS.map((t) => (
          <button key={t.id} className={t.id === s.panel ? "on" : ""} onClick={() => ui.set({ panel: t.id })}>
            <Icon name={t.icon} cls="sm" />
            {t.name}
          </button>
        ))}
      </div>
      <div className="dock-body" id="dockBody">
        <Body />
      </div>
    </aside>
  );
}
