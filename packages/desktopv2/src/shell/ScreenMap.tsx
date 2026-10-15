/**
 * 屏目索引 ⌘⇧S（PLAN §16）：78 屏按 M0–M6 分组，点击直达并写 hash。
 * 这一屏也是逐屏自动化验证的入口 —— 原型就是这么被验证的。
 */
import { Icon } from "../App";
import { SCREENS } from "../screens";
import { goto } from "../ui/nav";
import { useUi, ui } from "../ui/state";

export function ScreenMap() {
  const s = useUi();
  const secs = [...new Set(SCREENS.map((x) => x.sec))];
  const skins = ["graphite-dark", "paper-light", "nocturne-amber"];

  return (
    <div className={`screenmap ${s.screenmap ? "show" : ""}`} id="screenmap">
      <div className="sm-head">
        <h2>屏目索引</h2>
        <p>
          Kilo Desktop v2 · Rust Agent Runtime（rpi 0.3.24）+ React + 皮肤系统 · 共 <b className="mono">{SCREENS.length}</b> 屏 · 点击直达（hash 可分享）
        </p>
        <button className="btn iconbtn x" style={{ marginLeft: "auto" }} onClick={() => ui.set({ screenmap: false })}>
          <Icon name="x" cls="md" />
        </button>
      </div>
      <div className="sm-legend">
        <span>
          <Icon name="info" cls="sm" />⌘K 命令面板 · ⌥[ / ⌥] 折叠 · ⌘⇧S 本索引 · esc 关闭浮层
        </span>
        <span>P0 首版必须 · P1 首版应有 · P2 延后</span>
        <span>
          <Icon name="palette" cls="sm" />
          皮肤：
          {skins.map((id, i) => (
            <span key={id}>
              {i > 0 ? " / " : ""}
              <b style={{ cursor: "pointer", color: "var(--text-accent)" }} onClick={() => goto(`skin-${id === "graphite-dark" ? "graphite" : id === "paper-light" ? "paper" : "amber"}`)}>
                {id}
              </b>
            </span>
          ))}
        </span>
      </div>
      {secs.map((sec) => {
        const items = SCREENS.filter((x) => x.sec === sec);
        return (
          <div className="sm-sec" key={sec}>
            <h3>
              {sec}
              <span className="cnt">{items.length} 屏</span>
            </h3>
            <div className="sm-grid">
              {items.map((x) => (
                <button
                  key={x.id}
                  className={`sm-item ${decodeURIComponent(location.hash).slice(3) === x.id ? "on" : ""}`}
                  data-id={x.id}
                  onClick={() => void goto(x.id)}
                >
                  <span className="id mono">{x.id.slice(0, 5)}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{x.name}</span>
                    <span className="ds">{x.desc}</span>
                  </span>
                  <span className={`pri ${x.pri.toLowerCase()}`}>{x.pri}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
