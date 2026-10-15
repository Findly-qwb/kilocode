/**
 * 轻量代码高亮（PLAN §7：不引 shiki/prism 之类重依赖）。
 *
 * token 只用皮肤变量上色：--tk-key / --tk-str / --tk-num / --tk-cmt / --tk-fn /
 * --tk-typ / --tk-prop / --tk-pun（三套内置皮肤都有值，切皮肤自动跟随）。
 * shell 额外产出 `p`（提示符）与 `fl`（参数），对应 base.css 里 pre.cmd 的两条规则。
 */

export type Tok = { v: string; c?: string };

const base =
  "const let var function return if else import export from new class async await type interface extends implements switch case break continue throw try catch for of in while null undefined true false self def None True False fn mut pub struct impl enum match trait use crate mod loop move package func import";
const sql =
  "select from where order group by limit insert into values update set delete create table primary key not null default unique index references begin commit rollback pragma with as on conflict replace integer real text blob boolean join left right inner outer foreign constraint alter drop desc asc";
const cmd = "and or not if else for foreach while do in echo cat grep rg sed awk curl npm npx bun cargo git docker make python node sh bash zexit";

const words = (lang: string) => {
  const l = (lang || "").toLowerCase();
  if (/^(sql|ddl|migration)$/.test(l)) return sql;
  if (/^(bash|sh|shell|zsh|ps|cmd|console)$/.test(l)) return cmd;
  return base;
};

type Rule = { re: RegExp; tok: (m: RegExpExecArray) => Tok[] };

const g = (src: string) => new RegExp(src, "gy");

const one = (c: string): Rule["tok"] => (m) => [{ v: m[0], c }];

const rules = (lang: string): Rule[] => {
  const l = (lang || "").toLowerCase();
  const shell = /^(bash|sh|shell|zsh|ps|cmd|console|text)$/.test(l);
  const out: Rule[] = [
    { re: g("[ \\t\\r\\n]+"), tok: (m) => [{ v: m[0] }] },
    { re: g("(?:/\\*[\\s\\S]*?(?:\\*/|$)|//[^\\n]*|#[^\\n]*|--[^\\n]*)"), tok: one("tk-cmt") },
    {
      re: g("(?:\"(?:[^\"\\\\\\n]|\\\\.)*\"?|'(?:[^'\\\\\\n]|\\\\.)*'?|`(?:[^`\\\\]|\\\\.)*`?)"),
      tok: one("tk-str"),
    },
    { re: g("\\b\\d[\\d_]*(?:[._]\\d+)?%?\\b"), tok: one("tk-num") },
    { re: g(`\\b(?:${words(l).split(" ").join("|")})\\b`), tok: one("tk-key") },
    { re: g("\\b[A-Z][A-Za-z0-9_]{2,}\\b"), tok: one("tk-typ") },
    { re: g("[A-Za-z_$][\\w$]*(?=\\s*\\()"), tok: one("tk-fn") },
    { re: g("\\.[A-Za-z_$][\\w$]*"), tok: (m) => [{ v: ".", c: "tk-pun" }, { v: m[0].slice(1), c: "tk-prop" }] },
    { re: g("[{}()\\[\\];,.:=<>+*/%!&|^~?@#\\\\]"), tok: one("tk-pun") },
  ];
  if (!shell) return out;
  // shell：行首提示符与 -/-- 参数单独成 token，其余按通用规则
  return [
    {
      re: new RegExp("(?:^[ \\t]*(?:[$#]>?)[ \\t]+|^[a-zA-Z0-9_/.-]+:[0-9]+:)", "gym"),
      tok: (m) => [{ v: m[0].trimEnd(), c: "p" }],
    },
    { re: g("--?[A-Za-z][\\w-]*"), tok: one("fl") },
    ...out,
  ];
};

/** 切成 token 序列（React 侧直接渲染 span，避免把不可信文本塞进 innerHTML） */
export function cut(src: string, lang = "text"): Tok[] {
  const set = rules(lang);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    let hit = false;
    for (const r of set) {
      r.re.lastIndex = i;
      const m = r.re.exec(src);
      if (!m) continue;
      for (const t of r.tok(m)) {
        const last = out.at(-1);
        if (last && last.c === t.c) last.v += t.v;
        else out.push({ ...t });
      }
      i += m[0].length;
      hit = true;
      break;
    }
    if (hit) continue;
    const last = out.at(-1);
    if (last && !last.c) last.v += src[i];
    else out.push({ v: src[i] });
    i += 1;
  }
  return out;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** markdown 代码块用：产出转义后的 span HTML（随后仍会过 DOMPurify） */
export function html(src: string, lang?: string) {
  return cut(src, lang)
    .map((t) => (t.c ? `<span class="${t.c}">${esc(t.v)}</span>` : esc(t.v)))
    .join("");
}
