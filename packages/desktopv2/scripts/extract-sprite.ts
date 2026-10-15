const raw = await Bun.file("/tmp/sprite-raw.xml").text();
const body = raw
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/defs>\s*<\/svg>\s*$/, "")
  .replace(/^<defs>/, "")
  .trim();
const count = (body.match(/<symbol /g) ?? []).length;
if (!count) throw new Error("没抓到 symbol");
const doc = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${body}</defs></svg>`;
const out = `/** 图标精灵：从 design/kilo-desktop/prototype-v2.html:1071-1158 抽取（Tabler 线性风格，${count} 个 symbol）。\n *  用法：<svg className="i"><use href="#i-search"/></svg>，sprite 由 App 挂载一次。\n *  重新生成：bun scripts/extract-sprite.ts\n */\nexport const sprite = ${JSON.stringify(doc)};\n`;
await Bun.write(new URL("../src/assets/sprite.ts", import.meta.url), out);
console.log(`sprite.ts ${out.length} bytes · ${count} symbols`);
