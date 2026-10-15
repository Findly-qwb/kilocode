/** 标题栏（Tauri 自绘）：品牌、面包屑、runtime/分支入口、皮肤、面板开关、屏目索引 */
import { Icon, actions } from "../App";
import { runtime } from "../ipc/runtime";
import { ui, useUi } from "../ui/state";
import { apply, list } from "../skins/loader";

export function Titlebar() {
  const s = useUi();
  const st = runtime.state;
  const hit = st.sessions.find((x) => x.id === st.session);
  const skins = list();
  const next = skins[(skins.findIndex((k) => k.id === document.documentElement.dataset.skin) + 1) % skins.length];

  return (
    <header className="titlebar">
      <div className="lights" title="macOS 红绿灯">
        <i style={{ background: "#ff5f57" }} />
        <i style={{ background: "#febc2e" }} />
        <i style={{ background: "#28c840" }} />
      </div>
      <div className="tb-brand">
        <span className="mark">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 21V9a7 7 0 0 1 14 0v12l-3.5-2.5L12 21l-3.5-2.5z" stroke="var(--icon-strong)" strokeWidth="1.4" />
            <path d="M9.4 10.6h1.6M13 10.6h1.6" stroke="var(--surface-info-strong)" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="tb-title">Kilo</span>
      </div>
      <div className="tb-crumb">
        <b>{hit?.title ?? "新对话"}</b>
        <span>·</span>
        <span className="mono">opencode</span>
      </div>
      <div className="tb-right">
        <button className="pill" onClick={() => actions.modal("runtime")} title="Rust Agent Runtime（同进程，无侧车）">
          <span className="dot run" />
          <span className="mono">runtime · 同进程</span>
        </button>
        {st.git && (
          <button className="pill" onClick={() => actions.panel("review")} title="分支 / 变更 / 检查点">
            <Icon name="branch" cls="sm" />
            <span className="mono">{st.git.branch}</span>
            <span className="badge gray">{st.git.files.length}</span>
          </button>
        )}
        <span className="tb-sep" />
        <button
          className="iconbtn"
          onClick={() => {
            const hit = apply(next.id);
            actions.toast(`皮肤：${next.name}`, hit.ok ? "切换即时生效，不重建 WebView" : `加载被拒绝：${JSON.stringify(hit.problems)}`);
          }}
          title="皮肤与主题"
        >
          <Icon name="palette" />
        </button>
        <button
          className="iconbtn"
          onClick={() => ui.set({ popover: s.popover === "palette" ? null : "palette" })}
          title="命令面板 ⌘K"
        >
          <Icon name="search" />
        </button>
        <button className={`iconbtn ${s.left ? "on" : ""}`} onClick={() => ui.set({ left: !s.left })} title="收起/展开左栏 ⌥[">
          <Icon name="panel-left" />
        </button>
        <button className={`iconbtn ${s.right ? "on" : ""}`} onClick={() => ui.set({ right: !s.right })} title="收起/展开右栏 ⌥]">
          <Icon name="panel-right" />
        </button>
        <button className="iconbtn" onClick={() => ui.set({ screenmap: !s.screenmap })} title="屏目索引 ⌘⇧S">
          <Icon name="layout" />
        </button>
      </div>
    </header>
  );
}
