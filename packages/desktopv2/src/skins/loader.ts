/**
 * 皮肤加载器（PLAN §4）。
 *
 * 皮肤不是「一套 CSS」而是数据 bundle：skin.json 的 tokens 即 L2 语义变量，
 * 运行时注入 <style id="skin-vars">，切换只改变量、不重建 WebView。
 * 组件层（base.css）只允许引用 L2/L3，禁止硬编码色值 —— 因此缺 token 的皮肤必须拒绝。
 */
import { builtin } from "./builtin";
import { check, repair } from "./contrast";
import { REQUIRED } from "./required";
import type { Bundle } from "./types";

export type { Bundle };

export type Problem =
  | { kind: "missing"; tokens: string[] }
  | { kind: "contrast"; failures: ReturnType<typeof check> }
  | { kind: "cycle"; chain: string[] }
  | { kind: "parent"; parent: string };

export const DEFAULT_SKIN = "graphite-dark";
const KEY = "kilo.skin";
const IMPORTS = "kilo.skins.imported";
const STYLE_ID = "skin-vars";

const store = new Map<string, Bundle>();
let current = DEFAULT_SKIN;

/** 内置 + 已导入皮肤合并进注册表 */
export function boot(skins: Bundle[] = []) {
  store.clear();
  for (const b of [...builtin, ...skins]) store.set(b.id, b);
  for (const b of imported()) store.set(b.id, b);
  return list();
}

export function list() {
  return [...store.values()].map((b) => ({
    id: b.id,
    name: b.name,
    mode: b.mode,
    imported: isImported(b.id),
  }));
}

function isImported(id: string) {
  return imported().some((b) => b.id === id);
}

function imported(): Bundle[] {
  try {
    return JSON.parse(localStorage.getItem(IMPORTS) ?? "[]") as Bundle[];
  } catch {
    return [];
  }
}

function persist(list: Bundle[]) {
  try {
    localStorage.setItem(IMPORTS, JSON.stringify(list));
  } catch {
    /* file:// 或隐私模式下写不了本地存储；皮肤只在本次会话生效 */
  }
}

/** 直接入注册表：供热重载与测试绕过校验使用（校验由 apply/adopt 把关） */
export function seed(bundle: Bundle) {
  store.set(bundle.id, bundle);
  return bundle.id;
}

/** 沿 extends 链自根向下合并；出现环或缺父判定不合法 */
export function resolve(id: string): { bundle?: Bundle; chain: string[]; bad?: Problem } {
  const root = store.get(id);
  if (!root) return { chain: [] };
  const chain: string[] = [];
  const stack: Bundle[] = [];
  const seen = new Set<string>();
  let cursor: Bundle | undefined = root;
  while (cursor) {
    if (seen.has(cursor.id)) return { chain: [...chain, cursor.id], bad: { kind: "cycle", chain } };
    seen.add(cursor.id);
    stack.unshift(cursor);
    chain.unshift(cursor.id);
    if (!cursor.extends) break;
    const parent = store.get(cursor.extends);
    if (!parent) return { chain, bad: { kind: "parent", parent: cursor.extends } };
    cursor = parent;
  }
  const tokens: Record<string, string> = {};
  for (const b of stack) Object.assign(tokens, b.tokens, b.syntax ?? {});
  return { bundle: { ...root, tokens }, chain };
}

export function validate(bundle: Bundle): Problem[] {
  const out: Problem[] = [];
  const hit = resolve(bundle.id);
  if (hit.bad) out.push(hit.bad);
  const probe = hit.bundle?.tokens ?? bundle.tokens;
  const missing = REQUIRED.filter((t) => !(t in probe));
  if (missing.length) out.push({ kind: "missing", tokens: missing });
  const failures = check(probe);
  if (failures.length) out.push({ kind: "contrast", failures });
  return out;
}

function inject(bundle: Bundle) {
  const el =
    (document.getElementById(STYLE_ID) as HTMLStyleElement | null) ??
    (() => {
      const n = document.createElement("style");
      n.id = STYLE_ID;
      document.head.appendChild(n);
      return n;
    })();
  const body = Object.entries(bundle.tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  el.textContent = `:root{${body};color-scheme:${bundle.mode}}`;
  document.documentElement.dataset.skin = bundle.id;
  document.documentElement.dataset.mode = bundle.mode;
}

/** 应用皮肤；缺必需 token 时拒绝并保持当前皮肤（PLAN §4「拒绝加载并提示」） */
export function apply(id: string): { ok: boolean; problems?: Problem[]; name?: string } {
  const hit = resolve(id);
  if (!hit.bundle || hit.bad) {
    return { ok: false, problems: [hit.bad ?? { kind: "missing", tokens: [`${id} 不在注册表`] }] };
  }
  const missing = REQUIRED.filter((t) => !(t in hit.bundle!.tokens));
  if (missing.length) return { ok: false, problems: [{ kind: "missing", tokens: missing }], name: hit.bundle.name };
  inject(hit.bundle);
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 同上 */
  }
  return { ok: true, name: hit.bundle.name };
}

export function active() {
  return current;
}

export function restore() {
  const saved = (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  })();
  const prefersLight = matchMedia("(prefers-color-scheme: light)").matches;
  // 默认跟随系统（PLAN §4），但只在内建皮肤范围内选
  const pick = saved ?? (prefersLight ? "paper-light" : DEFAULT_SKIN);
  return apply(list().some((s) => s.id === pick) ? pick : DEFAULT_SKIN);
}

/** 导入 skin.json 文本；校验不过直接返回问题清单，UI 据此给「自动提亮」动作 */
export function adopt(text: string): { ok: boolean; bundle?: Bundle; problems?: Problem[] } {
  let raw: Bundle;
  try {
    raw = JSON.parse(text) as Bundle;
  } catch (e) {
    return { ok: false, problems: [{ kind: "missing", tokens: [`JSON 解析失败：${String(e)}`] }] };
  }
  if (!raw?.id || !raw?.tokens) return { ok: false, problems: [{ kind: "missing", tokens: ["id / tokens 必填"] }] };
  const prev = store.get(raw.id);
  store.set(raw.id, raw);
  const problems = validate(raw);
  if (problems.some((p) => p.kind === "missing" || p.kind === "cycle" || p.kind === "parent")) {
    if (prev) store.set(raw.id, prev);
    else store.delete(raw.id);
    return { ok: false, problems };
  }
  persist([...imported().filter((b) => b.id !== raw.id), raw]);
  return { ok: true, bundle: raw, problems: problems.length ? problems : undefined };
}

/** 对比度不过时的修复：把提亮结果写回 bundle 再重新入库 */
export function fix(id: string) {
  const b = store.get(id);
  if (!b) return null;
  const merged = { ...b.tokens, ...(resolve(id).bundle?.tokens ?? {}) };
  const patch = repair(merged);
  const next: Bundle = { ...b, tokens: { ...b.tokens, ...patch } };
  store.set(id, next);
  persist([...imported().filter((x) => x.id !== id), next]);
  apply(id);
  return patch;
}

/** 一键回落默认皮肤（PLAN §14 风险对策） */
export function fallback() {
  return apply(DEFAULT_SKIN);
}

/** 字号：--fscale 由 L1 的 calc() 消费，改一个变量即全站缩放（原型 setScale） */
export function setScale(px: number) {
  document.documentElement.style.setProperty("--fscale", (px / 13).toFixed(3));
  try {
    localStorage.setItem("kilo.scale", String(px));
  } catch {
    /* 忽略 */
  }
}

export function scaleNow() {
  try {
    return Number(localStorage.getItem("kilo.scale") ?? 13);
  } catch {
    return 13;
  }
}
