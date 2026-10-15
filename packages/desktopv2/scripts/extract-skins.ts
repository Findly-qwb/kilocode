/**
 * 从已验证的原型里抽取皮肤 bundle 与基础样式，避免手抄 1000+ 行 token 造成漂移。
 *
 * 输入：design/kilo-desktop/prototype-v2.html（78 屏逐屏实测通过，见 prototype-verification.md）
 * 输出：
 *   src/skins/<id>/skin.json   三套内置皮肤（PLAN §4 的 bundle 规范）
 *   src/skins/required.ts      L2 必需 token 清单（由 base.css 的实际引用推导）
 *   src/styles/base.css        L1 结构令牌 + 组件层（已剔除皮肤值）
 *
 * 跑法：bun scripts/extract-skins.ts
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const protoPath = resolve(root, "../../design/kilo-desktop/prototype-v2.html");

type Bundle = {
  id: string;
  name: string;
  mode: "dark" | "light";
  tokens: Record<string, string>;
};

function style(css: string) {
  const m = css.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("原型里没有 <style> 块");
  return m[1];
}

// 皮肤块形如 `:root,[data-skin="x"]{...}` 或 `[data-skin="x"]{...}`，块内只有声明、没有嵌套花括号。
const SKIN_BLOCK = /(?:^|\n)(:root,)?\[data-skin="([\w-]+)"\]\s*\{([^}]*)\}/g;

function declarations(body: string) {
  const out: Record<string, string> = {};
  for (const raw of body.split(";")) {
    const line = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const prop = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (prop.startsWith("--")) out[prop] = val;
  }
  return out;
}

function names(html: string) {
  const m = html.match(/const SKINS=\[([\s\S]*?)\];/);
  if (!m) throw new Error("原型里没有 SKINS 注册表");
  const out: Record<string, { name: string; mode: string }> = {};
  for (const row of m[1].split("\n")) {
    const r = row.match(/id:\s*'([\w-]+)'[^}]*name:\s*'([^']+)'[^}]*mode:\s*'(\w+)'/);
    if (r) out[r[1]] = { name: r[2], mode: r[3] };
  }
  return out;
}

async function emit(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

const html = await readFile(protoPath, "utf8");
if (!existsSync(protoPath)) throw new Error(`找不到原型：${protoPath}`);

const css = style(html);
const meta = names(html);
const found: Record<string, Bundle> = {};
const blocks: string[] = [];

// 收集顺序即层叠顺序：后出现的同 token 覆盖前面的（1c 补充令牌覆盖 1b）。
for (const m of css.matchAll(SKIN_BLOCK)) {
  const [, , id, body] = m;
  const info = meta[id];
  if (!info) throw new Error(`皮肤 ${id} 在 SKINS 注册表里没有名字`);
  const cur = (found[id] ??= { id, name: info.name, mode: info.mode as never, tokens: {} });
  Object.assign(cur.tokens, declarations(body));
  blocks.push(m[0]);
}

// 剔除皮肤块后还要清掉原型里遗留的孤儿片段（重复的间距声明 + 野花括号）。
let base = css;
for (const b of blocks) base = base.replace(b, "");
base = base.replace(/\/\* 间距节奏（4\/8） \*\/[\s\S]*?\n\}\n/, "");
// html[data-theme] 已废弃，v2 用 data-skin
base = base.replace(/html\[data-theme[^\]]*\][^{]*\{[^}]*\}/g, "");

const opens = (base.match(/\{/g) ?? []).length;
const closes = (base.match(/\}/g) ?? []).length;
if (opens !== closes) throw new Error(`base.css 花括号不配平：{=${opens} }=${closes}`);

// L1 结构令牌仍留在 base.css 的 :root 里；其余被组件引用的变量必须由皮肤提供 → 即 L2 必需集。
const l1 = new Set(
  [...(base.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
);
const used = new Set([...base.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const required = [...used].filter((t) => !l1.has(t)).sort();

const missing = Object.values(found).flatMap((s) =>
  required.filter((t) => !(t in s.tokens)).map((t) => `${s.id} 缺 ${t}`),
);
if (missing.length) throw new Error(`内置皮肤不完整：\n  ${missing.join("\n  ")}`);

for (const skin of Object.values(found)) {
  const at = join(root, "src", "skins", skin.id, "skin.json");
  await emit(at, JSON.stringify(skin, null, 2) + "\n");
}

await emit(
  join(root, "src", "skins", "required.ts"),
  `/** 由 scripts/extract-skins.ts 从组件层实际引用推导，勿手改。 */\nexport const REQUIRED = [\n${required.map((t) => `  "${t}",`).join("\n")}\n];\n`,
);

await emit(
  join(root, "src", "styles", "base.css"),
  `/* 由 scripts/extract-skins.ts 从 design/kilo-desktop/prototype-v2.html 抽取。\n   L1 结构令牌 + L3 组件层在此；L2 皮肤值由 src/skins/loader.ts 运行时注入。 */\n${base}\n`,
);

console.log(
  `皮肤 ${Object.keys(found).length} 套 · L2 必需 token ${required.length} 个 · base.css ${base.split("\n").length} 行`,
);
