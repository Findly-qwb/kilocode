import DOMPurify from "dompurify"
import { marked } from "marked"

marked.setOptions({ gfm: true, breaks: true })

export function md(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}

export function ago(t?: number) {
  if (!t) return ""
  const s = (Date.now() - t) / 1000
  if (s < 60) return "刚刚"
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(t).toLocaleDateString()
}
