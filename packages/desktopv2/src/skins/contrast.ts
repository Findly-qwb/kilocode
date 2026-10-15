/**
 * WCAG 相对亮度与对比度，算法与原型 applySkin() 一致（prototype-v2.html:2742-2748），
 * 差别是这里把「自动提亮」做成可执行修复，而不是只给提示。
 */

/** 阈值来自 PLAN §4：正文 4.5:1、次要 3:1；weaker 原型实测用 2.2:1 */
export const GATE = [
  { key: "--text-strong", label: "正文 text-strong", min: 4.5 },
  { key: "--text-weak", label: "次要 text-weak", min: 3 },
  { key: "--text-weaker", label: "弱化 text-weaker", min: 2.2 },
] as const;

export type Failure = { label: string; key: string; actual: number; min: number };

export function lum(hex: string) {
  const m = hex.trim().match(/^#([0-9a-f]{3,6})$/i);
  if (!m) return 0;
  let s = m[1];
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.5;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 只支持 #rgb/#rrggbb：皮肤 bundle 里的前景色都是 hex，rgba 语义色不参与门禁 */
export function check(tokens: Record<string, string>) {
  const bg = tokens["--surface-base"];
  if (!bg) return GATE.map((g) => ({ label: g.label, key: g.key, actual: 0, min: g.min }));
  return GATE.map((g) => ({
    label: g.label,
    key: g.key,
    min: g.min,
    actual: ratio(tokens[g.key] ?? "#000000", bg),
  })).filter((r) => r.actual < r.min);
}

export function hex2rgb(hex: string) {
  const m = hex.trim().match(/^#([0-9a-f]{3,6})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

function rgb2hsl([r, g, b]: number[]) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function hsl2hex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * Math.min(1, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * 自动提亮：朝「与背景对比度更高」的方向推亮度，最多 40 步。
 * 深色皮肤前景通常要提亮，浅色皮肤反过来要压暗，方向由背景亮度决定。
 */
export function brighten(fg: string, bg: string, min: number) {
  const rgb = hex2rgb(fg);
  const base = hex2rgb(bg);
  if (!rgb || !base) return fg;
  const [h, s, l0] = rgb2hsl(rgb);
  const up = lum(bg) < 0.5;
  let l = l0;
  for (let i = 0; i < 40; i++) {
    l = Math.min(0.97, Math.max(0.03, l + (up ? 0.02 : -0.02)));
    const next = hsl2hex(h, s, l);
    if (ratio(next, bg) >= min) return next;
  }
  return l === l0 ? fg : hsl2hex(h, s, l);
}

/** 返回修好的 token 补丁；调用方据此覆盖原值 */
export function repair(tokens: Record<string, string>) {
  const bg = tokens["--surface-base"];
  const patch: Record<string, string> = {};
  if (!bg) return patch;
  for (const g of GATE) {
    const fg = tokens[g.key];
    if (!fg) continue;
    if (ratio(fg, bg) >= g.min) continue;
    patch[g.key] = brighten(fg, bg, g.min);
  }
  return patch;
}
