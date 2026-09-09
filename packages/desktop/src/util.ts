import DOMPurify from "dompurify"
import { marked } from "marked"

marked.setOptions({ gfm: true, breaks: true })

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const un = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")

const clike =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(const|let|var|function|fn|def|class|struct|enum|type|interface|import|export|from|return|if|else|elif|for|while|loop|switch|case|match|break|continue|new|await|async|yield|use|pub|try|catch|finally|throw|raise|in|of|typeof|instanceof|null|undefined|true|false|none|void|static|readonly|extends|implements|package|require)\b/g
const hash =
  /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?)\b|\b(def|class|import|from|return|if|elif|else|for|while|break|continue|try|except|finally|raise|with|as|lambda|yield|pass|and|or|not|in|is|None|True|False|async|await|echo|then|fi|do|done|esac|local|export|function|set|end)\b/g

const FAM: Record<string, RegExp> = {
  ts: clike,
  tsx: clike,
  js: clike,
  jsx: clike,
  mjs: clike,
  cjs: clike,
  json: clike,
  jsonc: clike,
  rs: clike,
  go: clike,
  java: clike,
  kt: clike,
  swift: clike,
  c: clike,
  h: clike,
  cpp: clike,
  cs: clike,
  scala: clike,
  dart: clike,
  php: clike,
  css: clike,
  py: hash,
  sh: hash,
  bash: hash,
  zsh: hash,
  yaml: hash,
  yml: hash,
  toml: hash,
  env: hash,
  dockerfile: hash,
  gitignore: hash,
}

function hl(code: string, lang: string) {
  const re = FAM[lang]
  if (!re) return esc(code)
  let out = ""
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(code); m; m = re.exec(code)) {
    out += esc(code.slice(last, m.index))
    const cls = m[1] ? "com" : m[2] ? "str" : m[3] ? "num" : "key"
    out += `<span class="${cls}">${esc(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + esc(code.slice(last))
}

// marked 输出的 <code> 内容是 HTML 转义后的；解码后按语言着色再转义回去
const CODE =
  /<code class="language-([\w+-]*)">([\s\S]*?)<\/code>/g

export function md(text: string) {
  const html = marked
    .parse(text, { async: false })
    .replace(CODE, (_, lang: string, body: string) => `<code class="language-${lang}">${hl(un(body), lang.toLowerCase())}</code>`)
  return DOMPurify.sanitize(html)
}

export function ago(t?: number) {
  if (!t) return ""
  const s = (Date.now() - t) / 1000
  if (s < 60) return "刚刚"
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(t).toLocaleDateString()
}
