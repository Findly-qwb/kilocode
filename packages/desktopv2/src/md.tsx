/**
 * Markdown 渲染：marked → 自带高亮 / 文件链接 → DOMPurify。
 * LLM 输出不可信，**必须**过 sanitize（PLAN §14 安全默认）。
 */
import { useMemo, type ReactNode } from "react";
import { Marked, type Tokens, type TokenizerAndRendererExtension } from "marked";
import DOMPurify from "dompurify";
import { esc, html } from "./ipc/highlight";
import { ui } from "./ui/state";

/** 文件路径（含 .md）识别为 .filelink：带目录前缀，或以已知扩展名结尾 */
const PATH =
  /(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@+-]+\.[A-Za-z0-9]{1,6}\b|[A-Za-z0-9_.@+-]+\.(?:ts|tsx|js|jsx|mjs|rs|py|go|java|kt|c|h|cpp|md|mdx|json|ya?ml|toml|lock|css|scss|html|sql|sh|bash|txt|log|csv|patch)\b/;

const filelink: TokenizerAndRendererExtension = {
  name: "filelink",
  level: "inline",
  start: (src) => src.search(new RegExp(PATH.source, "g")),
  tokenizer: (src) => {
    const m = PATH.exec(src);
    if (!m || m.index !== 0) return undefined;
    return { type: "filelink", raw: m[0], text: m[0] };
  },
  renderer: (token) => `<span class="filelink">${esc(String(token.text ?? ""))}</span>`,
};

const code = (token: Tokens.Code) => {
  const src = (token.text ?? "").replace(/\n+$/, "");
  const lang = token.lang ?? "text";
  return (
    `<div class="codeblock"><div class="cbhead"><span class="lang">${esc(lang)}</span>` +
    `<span class="cp"><button data-act="copy"><svg class="i sm" aria-hidden="true"><use href="#i-copy"/></svg>复制</button>` +
    `<button data-act="paste"><svg class="i sm" aria-hidden="true"><use href="#i-plus"/></svg>插入</button></span></div>` +
    `<pre data-lang="${esc(lang)}">${html(src, lang)}</pre></div>`
  );
};

const mk = new Marked({ gfm: true, breaks: true, silent: true });
mk.use({
  extensions: [filelink],
  renderer: {
    code,
    codespan: (token: Tokens.Codespan) => `<code class="inline">${esc(token.text)}</code>`,
  },
});

const KEEP = [
  "a", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "del",
  "code", "pre", "span", "div", "button", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "mark",
];

export function render(src: string) {
  const out = mk.parse(src) as string;
  return DOMPurify.sanitize(out, {
    ALLOWED_TAGS: KEEP,
    ALLOWED_ATTR: ["class", "href", "title", "data-act", "data-lang"],
    ALLOW_DATA_ATTR: true,
  });
}

export function Md({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const out = useMemo(() => render(text), [text]);
  const act = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest?.("[data-act]") as HTMLElement | null;
    if (!btn) return;
    const code = btn.closest(".codeblock")?.querySelector("pre")?.textContent ?? "";
    if (btn.dataset.act === "copy") {
      void navigator.clipboard?.writeText(code);
      ui.set({ toast: { title: "已复制代码" } });
      return;
    }
    const draft = ui.get().draft;
    ui.set({ draft: draft ? `${draft}\n${code}` : code, toast: { title: "已插入输入框" } });
  };
  return (
    <div
      className="md"
      onClick={act}
      dangerouslySetInnerHTML={{ __html: out + (streaming ? '<span class="cursor"></span>' : "") }}
    />
  );
}

const glyph = (name: string) => (
  <svg className="i sm" aria-hidden="true">
    <use href={`#i-${name}`} />
  </svg>
);

/** 用户气泡里的路径识别成 .chip（原型 userMsg 的写法） */
export function chips(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(PATH.source);
  let rest = text;
  let n = 0;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    out.push(
      <span className="chip" key={`c${n++}`} title="在编辑器打开">
        {glyph("file")}
        {m[0]}
      </span>,
    );
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
