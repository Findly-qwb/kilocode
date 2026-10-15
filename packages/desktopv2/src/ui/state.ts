/** UI 态（视图 / 弹层 / 折叠 / 面板子视图）。会话数据在 ipc/runtime，两者不混。 */
import { useSyncExternalStore } from "react";
import type { Mode } from "../ipc/protocol";

export type View = "chat" | "history" | "settings" | "skills" | "mcp" | "onboard";
export type Panel = "picker" | "tree" | "terminal" | "review" | "tasks";
export type Popover = "palette" | "search" | "slash" | "mention" | "model" | "mode" | "variant" | "shield" | "tray" | "update" | "notif" | "dragover" | "enhance" | "attach" | null;

export type Ui = {
  view: View;
  tab: string;
  panel: Panel;
  modal: { id: string; arg?: Record<string, string> } | null;
  popover: Popover;
  screenmap: boolean;
  left: boolean;
  right: boolean;
  scene: string;
  draft: string;
  mode: Mode;
  model: string;
  variant: string;
  cost: number;
  turns: number;
  files: string[];
  picked: string[];
  toast: { title: string; body?: string } | null;
  banner: { text: string; redo?: boolean } | null;
};

const initial: Ui = {
  view: "chat",
  tab: "display",
  panel: "picker",
  modal: null,
  popover: null,
  screenmap: false,
  left: false,
  right: false,
  scene: "",
  draft: "",
  mode: "code",
  model: "deepseek-chat",
  variant: "",
  cost: 0.0198,
  turns: 1,
  files: [],
  picked: [],
  toast: null,
  banner: null,
};

let state: Ui = { ...initial };
const subs = new Set<() => void>();

/**
 * 折叠态 / 面板子视图 / 当前 tab 按项目记忆（PLAN §5.1，落到 Rust 的 ui_state 表）。
 * 浏览器里没有原生壳，退回 localStorage 同名语义，保证「重开还原布局」可验证。
 */
const MEMO = "kilo.ui.p-opencode";
const KEYS: (keyof Ui)[] = ["left", "right", "panel", "tab", "view", "mode", "model", "variant"];

function memo(patch: Partial<Ui>) {
  if (!KEYS.some((k) => k in patch)) return;
  const snap: Record<string, unknown> = {};
  for (const k of KEYS) snap[k] = state[k];
  try {
    localStorage.setItem(MEMO, JSON.stringify(snap));
  } catch {
    /* file:// 或隐私模式：记忆只在本次会话有效 */
  }
  // 原生壳里由 Rust 写 ui_state 表（M2 的 settings/命令接线）；这里只保证浏览器可验证
}

export const ui = {
  get: () => state,
  set(patch: Partial<Ui>) {
    state = { ...state, ...patch };
    memo(patch);
    for (const fn of subs) fn();
  },
  sub(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export function hydrate() {
  try {
    const hit = JSON.parse(localStorage.getItem(MEMO) ?? "{}") as Partial<Ui>;
    state = { ...state, ...hit };
  } catch {
    /* 没有记忆就用默认布局 */
  }
  return state;
}

export function useUi() {
  return useSyncExternalStore(ui.sub, ui.get);
}

/** 原型用 .shell.nol/.nor 表达折叠；这里保持同一 class 语义便于对照验证 */
export function shellClass(s: Ui) {
  return ["shell", s.left ? "nol" : "", s.right ? "nor" : "", s.popover === "attach" ? "dragover" : ""].filter(Boolean).join(" ");
}
