/**
 * 屏目导航：把 screens.ts 的声明式指令落到 UI 态 / 皮肤 / 事件脚本上。
 *
 * 每屏都从「干净状态」开始（reset → 顺序执行指令），这样逐屏验证的结果可复现，
 * 不会出现原型里那种「依赖上一屏遗留状态」的导航缺陷（shell-nol 就是这样）。
 */
import { invoke, play } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { CommandName, Mode } from "../ipc/protocol";
import { SCREENS, find, type Directive } from "../screens";
import * as skin from "../skins/loader";
import { hydrate, ui, type Popover } from "./state";

async function apply(d: Directive) {
  switch (d.do) {
    case "view":
      ui.set({ view: d.view, popover: null });
      return;
    case "scene":
      if (!d.id) {
        runtime.reset({ session: runtime.state.session });
        ui.set({ scene: "" });
        return;
      }
      ui.set({ scene: d.id });
      await play(d.id);
      return;
    case "skin":
      skin.apply(d.id);
      return;
    case "modal":
      ui.set({ modal: { id: d.id, arg: d.arg } });
      return;
    case "tab":
      ui.set({ view: "settings", tab: d.id });
      return;
    case "panel":
      ui.set({ panel: d.id, right: false });
      return;
    case "open":
      ui.set({ popover: d.what as Popover });
      return;
    case "collapse":
      ui.set({ left: d.side === "left" || d.side === "both", right: d.side === "right" || d.side === "both" });
      return;
    case "draft":
      ui.set({ draft: d.text });
      return;
    case "scale":
      skin.setScale(d.px);
      return;
    case "cmd":
      await invoke(d.name as CommandName, { ...(d.args ?? {}), session_id: runtime.state.session ?? "", mode: ui.get().mode as Mode });
      return;
  }
}

/** 打开一屏：清场 → 指令 → 写 hash */
export async function goto(id: string) {
  const s = find(id);
  ui.set({ modal: null, popover: null, screenmap: false, left: false, right: false });
  runtime.reset({ session: runtime.state.session });
  if (!s) {
    ui.set({ toast: { title: `未知屏：${id}` } });
    return false;
  }
  for (const d of s.run) await apply(d);
  history.replaceState(null, "", `#s=${id}`);
  ui.set({ toast: { title: `${s.name}`, body: `${s.sec} · ${s.pri} · ${s.desc}` } });
  return true;
}

export function fromHash() {
  const m = location.hash.match(/s=([\w-]+)/);
  return m?.[1];
}

/** 全局快捷键（PLAN §11 M0 命令面板 / 折叠 / 屏目索引） */
export function bindKeys() {
  addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "k" && !e.shiftKey) {
      e.preventDefault();
      ui.set({ popover: ui.get().popover === "palette" ? null : "palette" });
      return;
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      ui.set({ screenmap: !ui.get().screenmap });
      return;
    }
    if (e.altKey && (e.key === "[" || e.key === "]")) {
      e.preventDefault();
      ui.set(e.key === "[" ? { left: !ui.get().left } : { right: !ui.get().right });
      return;
    }
    if (e.key === "Escape") {
      const s = ui.get();
      if (s.modal) ui.set({ modal: null });
      else if (s.popover) ui.set({ popover: null });
      else if (s.screenmap) ui.set({ screenmap: false });
    }
  });
}

export async function boot() {
  skin.boot();
  skin.restore();
  skin.setScale(skin.scaleNow());
  hydrate();
  runtime.local((s) => {
    s.session = "s-demo";
  });
  const rows = await invoke("session_list", {}).catch(() => []);
  runtime.local((s) => {
    s.sessions = rows;
  });
  bindKeys();
  const hit = fromHash();
  // 带 hash 时按屏目指令重建状态；冷启动没有 hash 就沿用按项目记忆的布局
  if (hit && find(hit)) return goto(hit);
  ui.set({ view: "chat", scene: "chat-stream" });
  await play("chat-stream");
  return true;
}

/** 验证通路：dev 下把导航暴露给控制台/自动化脚本，逐屏断言用 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__nav = { goto, fromHash, screens: SCREENS, ui, runtime, skin, play };
}
