/**
 * 外壳（PLAN §5.1）：自绘标题栏 + 三栏 shell + 状态栏 + 浮层。
 * class 名与 prototype-v2.html 保持一致，便于逐屏对照验证。
 */
import { useEffect } from "react";
import { sprite } from "./assets/sprite";
import { invoke } from "./ipc/bridge";
import { runtime } from "./ipc/runtime";
import { boot, goto } from "./ui/nav";
import { shellClass, ui, useUi } from "./ui/state";
import { Titlebar } from "./shell/Titlebar";
import { Rail } from "./shell/Rail";
import { Dock } from "./shell/Dock";
import { Statusbar } from "./shell/Statusbar";
import { ScreenMap } from "./shell/ScreenMap";
import { Chat } from "./views/Chat";
import { Settings } from "./views/Settings";
import { History } from "./views/History";
import { Skills } from "./views/Skills";
import { Mcp } from "./views/Mcp";
import { Onboard } from "./views/Onboard";
import { Modals } from "./modals";
import { Palette } from "./shell/Palette";
import { Overlays } from "./shell/Overlays";

export function App() {
  const s = useUi();
  const st = runtime.state;

  useEffect(() => {
    void boot();
    const off = runtime.subscribe(() => ui.set({}));
    const onHash = () => {
      const id = location.hash.match(/s=([\w-]+)/)?.[1];
      if (id) void goto(id);
    };
    addEventListener("hashchange", onHash);
    return () => {
      off();
      removeEventListener("hashchange", onHash);
    };
  }, []);

  const closeRight = () => ui.set({ right: true });

  const view = (node: React.ReactNode, name: string) => (
    <section className={`view ${s.view === name ? "show" : ""} ${name === "chat" && !s.scene ? "welcome" : ""}`} id={`v-${name}`}>
      {node}
    </section>
  );

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: sprite }} />
      <div className="window">
        <Titlebar />
        <div className={shellClass(s)} id="shell">
          <Rail />
          <main className="center">
            <button className="edge-toggle l" title="展开左栏" onClick={() => ui.set({ left: false })}>
              <Icon name="chevron-right" cls="sm" />
            </button>
            <button className="edge-toggle r" title="展开右栏" onClick={closeRight}>
              <Icon name="chevron-right" cls="sm" rot />
            </button>
            <div className="viewwrap">
              {view(<Chat />, "chat")}
              {view(<History />, "history")}
              {view(<Settings />, "settings")}
              {view(<Onboard />, "onboard")}
              {view(<Skills />, "skills")}
              {view(<Mcp />, "mcp")}
            </div>
          </main>
          <Dock />
        </div>
        <Statusbar activity={st.activity} git={st.git} usage={st.usage} mcp={st.mcp} />
      </div>
      <ScreenMap />
      <Palette />
      {/* 弹层：.scrim 负责居中与遮罩，.modal 由 modals/index.tsx 提供 */}
      <div
        className={`scrim ${s.modal ? "show" : ""}`}
        id="modalHost"
        onClick={(e) => {
          if (e.target === e.currentTarget) ui.set({ modal: null });
        }}
      >
        {s.modal ? <Modals /> : null}
      </div>
      <Overlays />
      <div className={`toast ${s.toast ? "show" : ""}`} id="toast">
        {s.toast?.title}
        {s.toast?.body ? <em>{s.toast.body}</em> : null}
      </div>
    </>
  );
}

export function Icon({ name, cls = "", rot = false }: { name: string; cls?: string; rot?: boolean }) {
  return (
    <svg className={`i ${cls}`} style={rot ? { transform: "rotate(180deg)" } : undefined} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** 状态栏与标题栏都要用到的轻量动作 */
export const actions = {
  openScreen: (id: string) => void goto(id),
  settings: (tab: string) => ui.set({ view: "settings", tab }),
  panel: (p: "picker" | "tree" | "terminal" | "review" | "tasks") => ui.set({ panel: p, right: false }),
  modal: (id: string, arg?: Record<string, string>) => ui.set({ modal: { id, arg } }),
  toast: (title: string, body?: string) => ui.set({ toast: { title, body } }),
  invoke,
};
