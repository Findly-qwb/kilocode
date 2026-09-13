import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover } from "@kobalte/core/popover"
import type { AssistantMessage, FilePartInput, Part } from "@kilocode/sdk/v2/types"
import type { LucideIcon } from "lucide-solid"
import {
  AlertTriangle, BookOpen, Brain, Box, ChevronRight, CircleHelp, Compass, Copy, FileText, GitBranch, GitFork, Globe, List, ListChecks, ThumbsDown, ThumbsUp,
  MessageSquare, Pencil, RotateCcw, Scissors, Search, Settings, Shield, SquareTerminal, TrendingUp, Wand2, Puzzle,
} from "lucide-solid"
import logo from "../assets/logo.png"
import { client, directory } from "../client"
import { store, type Msg, type Question, type ModelRef } from "../store"
import { vcs } from "../vcs"
import { permLevel } from "../perm"
import { openModal, setSettingsTab } from "../ui"
import { openUrl, openPath } from "../host"
import { md } from "../util"

type Entry = { name: string; mime: string; url: string; img: boolean }

const MIME: Record<string, string> = {
  md: "text/markdown",
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  json: "application/json",
  py: "text/x-python",
  rs: "text/rust",
  go: "text/go",
  css: "text/css",
  html: "text/html",
  yml: "text/yaml",
  sh: "text/x-sh",
  png: "image/png",
  jpg: "image/jpeg",
}

const hello = () => {
  const h = new Date().getHours()
  return h < 6 ? "凌晨好" : h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好"
}
const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n)))

async function toData(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${file.type || "text/plain"};base64,${btoa(bin)}`
}

const ext = (p: string) => p.split(".").at(-1)?.toLowerCase() ?? ""

function openRef(url: string) {
  if (url.startsWith("file://")) void openPath(url.slice(7))
  else if (url.startsWith("/")) void openPath(url)
}
function retryWait(part: Extract<Part, { type: "retry" }>): number | undefined {
  const d = part.error.data
  const hdr = d.responseHeaders ? { ...d.responseHeaders } : undefined
  const ra = hdr && (hdr["retry-after"] ?? hdr["Retry-After"])
  const meta = d.metadata ? { ...d.metadata } : undefined
  const sec = Number(ra ?? meta?.["retry_after_seconds"])
  return Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : undefined
}

const bridge = { put: (_v: string) => {} }

type VoteMap = Record<string, "up" | "down">
function loadVotes(): VoteMap {
  const raw = localStorage.getItem("msgVotes")
  const out: VoteMap = {}
  if (!raw) return out
  const v: unknown = JSON.parse(raw)
  if (v && typeof v === "object") {
    const box: Record<string, unknown> = { ...v }
    for (const k of Object.keys(box)) { const d = box[k]; if (d === "up" || d === "down") out[k] = d }
  }
  return out
}
const [votes, setVotes] = createSignal(loadVotes())
function vote(id: string, dir: "up" | "down") {
  setVotes((v) => {
    const next = { ...v }
    if (next[id] === dir) delete next[id]
    else next[id] = dir
    localStorage.setItem("msgVotes", JSON.stringify(next))
    return next
  })
}

export function Chat() {
  const [ui, setUi] = createStore({
    draft: "" as string,
    menu: "" as "" | "slash" | "mention" | "model" | "shield" | "mode" | "variant",
    hl: 0,
    timeline: false,
    focused: false,
    drag: false,
    at: "",
    enhanced: "" as string,
  })
  const [staged, setStaged] = createSignal<Entry[]>([], { equals: false })
  const [hits, setHits] = createSignal<{ c: string; d: string; i: LucideIcon }[]>([])
  const [atBottom, setAtBottom] = createSignal(true)
  const [find, setFind] = createStore({ open: false, q: "", cs: false, ww: false, i: 0 })
  let stream!: HTMLDivElement
  let input!: HTMLTextAreaElement

  const msgs = () => store.thread(store.current())
  const current = () => store.current()
  const session = () => store.sessions().find((s) => s.id === store.current())
  const isBusy = () => store.busy().has(current())
  const pending = () => store.permissions().find((p) => p.sessionID === store.current())
  const question = () => store.questions().find((q) => q.sessionID === store.current())
  const queued = () => (current() ? (store.queue()[current()] ?? []) : [])
  const welcome = () => !current() && !msgs().length
  const working = () => (!isBusy() ? "" : pending() ? "等待你的批准…" : msgs().at(-1)?.parts.length ? "正在工作…" : "正在思考…")

  const key = () => current() || "new"
  bridge.put = (v: string) => putDraft(v)
  createEffect(() => {
    key()
    setUi("draft", store.drafts()[key()] ?? "")
  })
  function putDraft(v: string) {
    setUi("draft", v)
    store.setDraft(v)
  }

  let prevLen = -1
  createEffect(() => {
    const n = msgs().length
    if (n === prevLen) return
    const first = prevLen === -1
    prevLen = n
    if (first || msgs().at(-1)?.info.role === "user" || atBottom()) scroll(true)
  })
  createEffect(() => {
    const last = msgs().at(-1)?.parts.filter((p) => p.type === "text").at(-1)
    if (last && last.type === "text") last.text.length && atBottom() && scroll()
  })
  function scroll(force?: boolean) {
    requestAnimationFrame(() => {
      if (!stream) return
      if (force || atBottom()) stream.scrollTop = stream.scrollHeight
    })
  }

  function matches(): number[] {
    const q = find.q.trim()
    if (!q) return []
    const out: number[] = []
    msgs().forEach((m, i) => {
      const hay = textOf(m.parts).join("\n")
      const needle = find.cs ? q : q.toLowerCase()
      const text = find.cs ? hay : hay.toLowerCase()
      if (find.ww) {
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        if (new RegExp(`\\b${esc}\\b`, find.cs ? "" : "i").test(hay)) out.push(i)
      } else if (text.includes(needle)) out.push(i)
    })
    return out
  }
  function ranges(): { all: Range[]; cur: number } {
    const q = find.q.trim()
    const all = matches()
    if (!q || !all.length) return { all: [], cur: 0 }
    const out: Range[] = []
    const walker = document.createTreeWalker(stream, NodeFilter.SHOW_TEXT)
    const target = all[find.i] ?? all[0] ?? 0
    let msgEl: Element | null = null
    let cur = -1
    const re = new RegExp((find.ww ? "\\b" : "") + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (find.ww ? "\\b" : ""), find.cs ? "g" : "gi")
    let raw: Node | null
    while ((raw = walker.nextNode())) {
      if (!(raw instanceof Text)) continue
      const node = raw
      const msg = node.parentElement?.closest(".msg")
      if (!msg) continue
      if (msg !== msgEl) {
        msgEl = msg
        re.lastIndex = 0
      }
      const mi = [...stream.querySelectorAll(".msg")].indexOf(msg)
      if (mi < 0) continue
      let mm: RegExpExecArray | null
      while ((mm = re.exec(node.data))) {
        const r = document.createRange()
        r.setStart(node, mm.index)
        r.setEnd(node, mm.index + mm[0].length)
        out.push(r)
        if (mi === target && cur < 0) cur = out.length - 1
        if (!mm[0].length) re.lastIndex++
      }
    }
    return { all: out, cur: cur < 0 ? 0 : cur }
  }
  function applyFind() {
    if (!("highlights" in CSS)) return
    const { all, cur } = ranges()
    CSS.highlights.set("kilo-find", new Highlight(...all))
    const c = all[cur]
    CSS.highlights.set("kilo-find-cur", c ? new Highlight(c) : new Highlight())
    c?.startContainer.parentElement?.scrollIntoView({ block: "center" })
  }
  function goFind(delta: number) {
    const m = matches()
    if (!m.length) return
    setFind("i", (find.i + delta + m.length) % m.length)
  }
  createEffect(() => {
    find.q
    find.i
    find.cs
    find.ww
    msgs().length
    if (!find.open) {
      CSS.highlights?.delete("kilo-find")
      CSS.highlights?.delete("kilo-find-cur")
      return
    }
    applyFind()
  })

  async function addFile(file: File) {
    if (file.size > 6_000_000) return store.notify(`文件过大（>6MB）：${file.name}`)
    const url = await toData(file).catch(() => "")
    if (!url) return store.notify(`读取失败：${file.name}`)
    setStaged((list) => [...list, { name: file.name, mime: file.type || "text/plain", url, img: file.type.startsWith("image/") }])
  }
  function addRef(path: string) {
    setStaged((list) => [...list, { name: path.split(/[\\/]/).at(-1) ?? path, mime: MIME[ext(path)] ?? "text/plain", url: `file://${path}`, img: false }])
  }
  async function stageChanges() {
    const c = client()
    if (!c || !directory()) return store.notify("请先选择项目文件夹")
    const res = await c.vcs.diff({ directory: directory(), mode: "git" }).catch(() => undefined)
    const list = (res?.data ?? []).slice(0, 30)
    for (const f of list) if (f.file) addRef(f.file)
    store.notify(`已附加 ${list.length} 个变更文件`)
  }

  function attachText(name: string, text: string) {
    const bytes = new TextEncoder().encode(text.slice(0, 8000))
    let bin = ""
    for (const b of bytes) bin += String.fromCharCode(b)
    setStaged((list) => [...list, { name, mime: "text/plain", url: `data:text/plain;base64,${btoa(bin)}`, img: false }])
  }
  function attachTerminal() {
    for (let i = msgs().length - 1; i >= 0; i--) {
      for (let j = msgs()[i].parts.length - 1; j >= 0; j--) {
        const p = msgs()[i].parts[j]
        if (p.type === "tool" && p.tool === "bash" && p.state.status === "completed" && p.state.output) {
          attachText("terminal-output.txt", `$ ${str0(p.state.input?.command)}\n\n${p.state.output}`)
          return store.notify("已附加最近一次终端输出")
        }
      }
    }
    store.notify("本会话还没有已完成的终端命令")
  }
  const str0 = (v: unknown) => (typeof v === "string" ? v : "")
  async function attachWorktrees() {
    const list = (await client()?.worktree.list({ directory: directory() }).catch(() => undefined))?.data ?? []
    if (!list.length) return store.notify("当前项目没有 worktree")
    attachText("worktrees.txt", list.map((w) => `${w.directory}${w.managed ? "\t(managed)" : ""}`).join("\n"))
    store.notify(`已附加 ${list.length} 个 worktree 路径`)
  }

  function clear() {
    putDraft("")
    setStaged((_) => [])
    setUi({ menu: "", at: "", enhanced: "" })
    input.style.height = "auto"
  }

  function submit() {
    const text = ui.draft.trim()
    const cmd = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
    if (cmd && cmd[1] && !cmd[1].includes("@")) {
      if (runBuiltin(cmd[1], cmd[2] ?? "")) return clear()
      clear()
      void store.command(cmd[1], cmd[2] ?? "")
      return
    }
    const files: FilePartInput[] = staged().map((f) => ({ type: "file", mime: f.mime, filename: f.name, url: f.url }))
    if (!text && !files.length) return
    clear()
    void store.send(text, files)
  }

  function runBuiltin(name: string, args: string) {
    switch (name) {
      case "new":
        void store.newSession()
        return true
      case "sessions":
      case "history":
        store.setView("history")
        return true
      case "models":
        setUi("menu", "model")
        return true
      case "agents":
        setUi("menu", "mode")
        return true
      case "variant":
        cycleVariant()
        return true
      case "settings":
        store.setView("settings")
        return true
      case "export":
        void exportMd()
        return true
      case "help":
        void openUrl("https://kilo.ai/docs")
        return true
      case "goal":
        if (!args) {
          putDraft("/goal 让代理持续推进的目标")
          return true
        }
        return false
      case "compact":
        void store.compact()
        return true
      default:
        return false
    }
  }

  async function exportMd() {
    const list = msgs()
    if (!list.length) return store.notify("还没有消息可导出")
    let out = `# ${session()?.title ?? "会话"}\n\n`
    for (const m of list) {
      out += m.info.role === "user" ? "## 用户\n\n" : "## Kilo\n\n"
      for (const p of m.parts) if (p.type === "text" && p.text && !p.synthetic) out += p.text + "\n\n"
    }
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([out], { type: "text/markdown" }))
    a.download = `${(session()?.title ?? "chat").slice(0, 40).replace(/[\\/:*?"<>|]/g, "_")}.md`
    a.click()
    store.notify("已导出 Markdown")
  }

  // ---------- slash / mention ----------

  const menuItems = createMemo<{ h?: string; c?: string; d?: string; i?: LucideIcon; g?: string; pick?: () => void }[]>(() => {
    if (ui.menu === "slash") {
      const q = ui.draft.slice(1).toLowerCase()
      const acts = [
        { c: "/new", d: "清空并开新会话" },
        { c: "/sessions", d: "打开历史会话" },
        { c: "/models", d: "选择模型" },
        { c: "/agents", d: "切换代理/模式" },
        { c: "/variant", d: "切换推理强度" },
        { c: "/goal", d: "设定长期目标，代理持续推进" },
        { c: "/compact", d: "压缩当前上下文" },
        { c: "/export", d: "导出 Markdown 转录" },
        { c: "/help", d: "打开文档" },
        { c: "/settings", d: "打开设置" },
      ].filter((x) => !q || x.c.slice(1).startsWith(q))
      const cmds = store
        .commands()
        .filter((x) => !["new", "sessions", "models", "agents", "variant", "compact", "export", "help", "settings", "goal"].includes(x.name))
        .filter((x) => !q || x.name.startsWith(q))
        .map((x) => ({ c: "/" + x.name, d: x.description ?? "", g: x.source ?? "command" }))
      return [{ h: "动作" }, ...acts, ...(cmds.length ? [{ h: "命令 · 自定义 Skills / Workflows" }] : []), ...cmds]
    }
    if (ui.menu === "mention") {
      return [
        { h: "条目" },
        { c: "@git-changes", d: "附加当前项目变更", i: GitBranch, pick: stageChanges },
        { c: "@terminal", d: "附加最近一次终端输出", i: SquareTerminal, pick: attachTerminal },
        { c: "@worktrees", d: "附加 worktree 路径列表", i: GitFork, pick: () => void attachWorktrees() },
        { c: "@past-chats", d: "搜索并引用历史会话", i: MessageSquare, pick: () => store.setView("history") },
        { h: "文件" },
        ...hits().map((x) => ({ c: x.c, d: x.d, i: x.i, pick: () => useMention(x.d) })),
      ]
    }
    return []
  })

  function useMention(fullPath: string) {
    const m = /(^|\s)@([^\s@]*)$/.exec(ui.draft)
    if (!m) return
    putDraft(ui.draft.slice(0, ui.draft.length - (m[2].length + 1)) + " ")
    addRef(fullPath)
    setUi({ menu: "", at: "" })
    input.focus()
  }

  function onType(el: HTMLTextAreaElement) {
    const v = el.value
    putDraft(v)
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
    if (v.startsWith("/") && !/\s/.test(v)) return setUi({ menu: "slash", hl: 0 })
    const before = v.slice(0, el.selectionStart ?? v.length)
    const m = /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (m) {
      setUi({ menu: "mention", at: m[1], hl: 0 })
      searchFiles(m[1])
      return
    }
    if (ui.menu === "slash" || ui.menu === "mention") setUi("menu", "")
  }
  let ftimer: ReturnType<typeof setTimeout>
  function searchFiles(q: string) {
    clearTimeout(ftimer)
    ftimer = setTimeout(() => {
      void (async () => {
        if (!directory()) {
          setHits([])
          return
        }
        const res = await client()
          ?.v2.fs.find({ location: { directory: directory() }, query: q, type: "file", limit: "10" })
          .catch(() => undefined)
        setHits((res?.data?.data ?? []).map((x) => ({ c: x.path.split(/[\\/]/).slice(-2).join("/"), d: x.path.replace(/\\/g, "/"), i: FileText })))
      })()
    }, 180)
  }

  function pickMenu(item: { c?: string; pick?: () => void }) {
    if (!item.c) return
    if (item.pick) {
      item.pick()
      setUi("menu", "")
      return
    }
    if (ui.menu === "slash") {
      putDraft(item.c + " ")
      setUi("menu", "")
      const name = item.c.slice(1)
      if (["new", "sessions", "history", "models", "agents", "variant", "settings", "export", "help", "compact"].includes(name)) {
        runBuiltin(name, "")
        clear()
      } else input.focus()
    } else {
      const hit = hits().find((h) => h.c === item.c)
      useMention(hit?.d ?? item.c)
    }
  }

  function flat() {
    return menuItems().filter((x): x is { c: string; pick?: () => void } => Boolean(x.c))
  }

  function onKey(e: KeyboardEvent) {
    if (ui.menu === "slash" || ui.menu === "mention") {
      const list = flat()
      if (e.key === "ArrowDown") return e.preventDefault(), setUi("hl", (ui.hl + 1) % Math.max(1, list.length))
      if (e.key === "ArrowUp") return e.preventDefault(), setUi("hl", (ui.hl - 1 + list.length) % Math.max(1, list.length))
      if (e.key === "Enter" || e.key === "Tab") {
        const hit = list.at(ui.hl)
        if (e.key === "Tab" || (e.key === "Enter" && (ui.menu === "mention" || (ui.draft.startsWith("/") && !ui.draft.includes(" "))))) {
          if (hit) {
            e.preventDefault()
            return pickMenu(hit)
          }
        }
      }
      if (e.key === "Escape") {
        e.preventDefault()
        return setUi("menu", "")
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      return submit()
    }
    if (e.key === "Escape") {
      if (isBusy()) return void store.abort()
      setUi({ menu: "", timeline: false })
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault()
      return cycleVariant()
    }
    if (e.key === "ArrowUp" && e.currentTarget instanceof HTMLTextAreaElement && e.currentTarget.selectionStart === 0) {
      const users = msgs().filter((m) => m.info.role === "user").map((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n"))
      const last = users.at(-1)
      if (last && last !== ui.draft) {
        e.preventDefault()
        putDraft(last)
      }
    }
  }

  // ---------- 模式 / 变体 ----------

  const primaryAgents = (): { id: string; description?: string }[] => {
    const list = store.agents().filter((a) => a.mode !== "subagent").map((a) => ({ id: a.id, description: a.description }))
    return list.length ? list : [{ id: "code" }, { id: "plan" }, { id: "ask" }]
  }
  const modeName = () => store.agent() || "code"
  const curModel = (): ModelRef | undefined => {
    if (store.model()) return store.model()
    const sm = session()?.model
    return sm ? { providerID: sm.providerID, modelID: sm.id, variant: sm.variant } : undefined
  }
  const modelName = () => {
    const m = curModel()
    if (!m) return "默认模型"
    return store.providers().all.find((x) => x.id === m.providerID)?.models[m.modelID]?.name ?? m.modelID
  }
  const variants = () => {
    const m = curModel()
    if (!m) return []
    const mo = store.providers().all.find((p) => p.id === m.providerID)?.models[m.modelID]
    return Object.keys(mo?.variants ?? {})
  }
  function cycleVariant() {
    const m = curModel()
    if (!m) return store.notify("先选择模型")
    const list = ["", ...variants()].filter((x, i, a) => a.indexOf(x) === i)
    if (list.length < 2) return store.notify("当前模型无推理变体")
    const next = list[(list.indexOf(store.model()?.variant ?? "") + 1) % list.length]
    store.setModel({ ...m, variant: next || undefined })
  }
  const ctx = createMemo(() => {
    const list = msgs()
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i].info
      if (info.role === "assistant") {
        const used = info.tokens.input + (info.tokens.cache.read ?? 0) + info.tokens.output
        const mo = store.providers().all.find((p) => p.id === info.providerID)?.models[info.modelID]
        const limit = mo?.limit.context || 200_000
        return { used, limit, pct: Math.min(99, Math.round((used / limit) * 100)) }
      }
    }
    return { used: 0, limit: 200_000, pct: 0 }
  })
  function shieldRows(): [string, string][] {
    const p = store.config().permission
    return [
      ["读文件 / Glob / Grep / List", permLevel(p, "read")],
      ["编辑文件", permLevel(p, "edit")],
      ["Bash 命令", permLevel(p, "bash")],
      ["工作区外目录", permLevel(p, "external_directory")],
      ["WebSearch / WebFetch", permLevel(p, "websearch")],
      ["子代理 Task / Skill", permLevel(p, "task")],
    ]
  }

  return (
    <section classList={{ view: true, show: true, welcome: welcome() }}>
      <Show when={!welcome()}>
        <div class="taskheader">
          <div class="th-row">
            <TitleEditable title={session()?.title ?? ""} onRename={(t) => void store.rename(current(), t)} />
            <div class="th-meta">
              <span class="pill" title="本会话累计费用（按模型细分见展开时间线）">$ <b>{(session()?.cost ?? 0).toFixed(4)}</b></span>
              <span class="pill" title={`上下文占用 ${ctx().pct}%`} onClick={() => setUi("timeline", !ui.timeline)}>
                <span class="ctxbar"><i style={{ width: ctx().pct + "%" }} /></span>
                <b>{ctx().pct}%</b>
              </span>
              <button class="iconbtn" title="压缩上下文 /compact" onClick={() => void store.compact()}><Scissors size={13} strokeWidth={1.8} /></button>
              <button class="iconbtn" title="转录内搜索" onClick={() => setFind({ open: !find.open, i: 0 })}><Search size={13} strokeWidth={1.8} /></button>
              <button class="iconbtn" title="打开用量面板" onClick={() => store.setModule("usage")}><TrendingUp size={13} strokeWidth={1.8} /></button>
              <button class="iconbtn" title="展开活动/用量时间线" onClick={() => setUi("timeline", !ui.timeline)}>{ui.timeline ? "▴" : "▾"}</button>
            </div>
          </div>
          <div classList={{ timeline: true, open: ui.timeline }}>
            <div class="tl-bars" title="回合活动条">
              <For each={msgs().filter((m) => m.info.role === "assistant")}>
                {(m) => (
                  <span
                    classList={{ tool: m.parts.some((p) => p.type === "tool"), err: m.info.role === "assistant" && Boolean(m.info.error) }}
                    style={{ height: Math.min(30, 8 + m.parts.length * 3) + "px" }}
                  />
                )}
              </For>
            </div>
            <div class="ctxprog" title="已用 / 输出预留 / 剩余">
              <i style={{ width: ctx().pct + "%" }} />
              <i style={{ width: "8%" }} />
              <i style={{ width: Math.max(2, 92 - ctx().pct) + "%" }} />
            </div>
            <div class="tl-legend">
              <span>输入+缓存 <b>{fmtK(ctx().used)}</b></span>
              <span>窗口 <b>{fmtK(ctx().limit)}</b></span>
              <span style="margin-left:auto">{modelName()} · <b>${(session()?.cost ?? 0).toFixed(4)}</b></span>
              <button class="btn sm" onClick={() => store.setModule("usage")}>完整用量 →</button>
            </div>
          </div>
        </div>

        <div class="messages" ref={stream} onScroll={() => setAtBottom(stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120)}>
          <Show when={find.open}>
            <div class="findbar">
              <input placeholder="在转录中搜索…" value={find.q} autofocus onInput={(e) => setFind("q", e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") goFind(e.shiftKey ? -1 : 1); if (e.key === "Escape") setFind("open", false) }} />
              <button classList={{ on: find.cs }} title="区分大小写" onClick={() => setFind("cs", !find.cs)}>Aa</button>
              <button classList={{ on: find.ww }} title="全词匹配" onClick={() => setFind("ww", !find.ww)}>W</button>
              <span class="cnt">{matches().length ? find.i + 1 : 0}/{matches().length}</span>
              <button class="iconbtn" title="上一个" onClick={() => goFind(-1)}>↑</button>
              <button class="iconbtn" title="下一个" onClick={() => goFind(1)}>↓</button>
              <button class="iconbtn" title="关闭" onClick={() => setFind({ open: false, q: "" })}>✕</button>
            </div>
          </Show>
          <Show when={msgs().some((m) => m.info.role === "user")}>
            <div class="rail" title="PromptRail：用户消息刻度，点击跳转">
              <For each={msgs().map((m, i) => ({ m, i })).filter((x) => x.m.info.role === "user")}>
                {(x, i) => <i classList={{ cur: i() === msgs().filter((n) => n.info.role === "user").length - 1 }} onClick={() => stream.querySelectorAll(".msg.user")[x.i]?.scrollIntoView({ block: "center" })} />}
              </For>
            </div>
          </Show>
          <For each={msgs()}>{(m) => <Message msg={m} />}</For>
          <Show when={working()}>
            <div classList={{ working: true, show: true }}>
              <span class="spinner" />
              <span>{working()}</span>
            </div>
          </Show>
          <Show when={store.error()}>
            <div class="outcome bad">
              <span><AlertTriangle size={13} strokeWidth={1.8} style="vertical-align:-2px" /> 会话出错：{store.error()}</span>
              <span class="grow1" />
              <button class="btn sm" onClick={() => store.newSession()}>清除</button>
            </div>
          </Show>
          <Show when={session()?.revert}>
            <div class="revertbar">
              <span>↩ 已回退，后续消息暂不显示</span>
              <Show when={(session()?.summary?.additions ?? 0) + (session()?.summary?.deletions ?? 0) > 0}>
                <span class="stat"><span class="a">+{session()!.summary!.additions}</span><span class="d">−{session()!.summary!.deletions}</span></span>
              </Show>
              <span class="grow1" />
              <button class="btn sm" onClick={() => store.setModule("diff")}>查看文件变更</button>
              <button class="btn sm primary" onClick={() => void store.unrevert()}>Redo（撤销回退）</button>
            </div>
          </Show>
          <Show when={pending()} keyed>{(p) => <PermDock p={p} />}</Show>
          <Show when={question()} keyed>{(q) => <QDock q={q} />}</Show>
          <For each={queued()}>
            {(item, i) => (
              <div class="queued">
                <span class="qtag">排队中</span>
                <span class="txt">{item.text || "（附件）"}</span>
                <button
                  class="btn sm"
                  onClick={() => {
                    const back = store.unqueue(current(), i())
                    if (!back) return
                    putDraft(back.text)
                    setStaged(back.files.map((f) => ({ name: f.filename ?? "file", mime: f.mime, url: f.url, img: f.mime.startsWith("image/") })))
                  }}
                >
                  编辑
                </button>
                <button class="btn sm" onClick={() => store.dequeue(current(), i())}>删除</button>
              </div>
            )}
          </For>
        </div>
        <Show when={!atBottom() && isBusy()}>
          <div class="tobottom show" onClick={() => scroll(true)}>↓</div>
        </Show>
      </Show>

      <div class="inputzone">
        <div class="hero">
          <img class="hero-logo" src={logo} alt="Kilo" />
          <h2>{directory() ? `${hello()}，继续推进 ${directory().split(/[\\/]/).at(-1)}？` : `${hello()}，做点什么？`}</h2>
          <p>描述目标即可 · 支持 / 命令、@ 文件提及、图片拖拽与粘贴</p>
        </div>
        <Show when={!welcome()}>
          <div class="dockrow">
            <button class="newbtn" title="查看本会话改动" onClick={() => store.setModule("diff")} style="margin-left:auto">
              <Puzzle size={13} strokeWidth={1.8} /> Show Changes
              <Show when={(session()?.summary?.additions ?? 0) + (session()?.summary?.deletions ?? 0) > 0}>
                <span class="stat"><span class="a">+{session()!.summary!.additions}</span><span class="d">−{session()!.summary!.deletions}</span></span>
              </Show>
            </button>
            <span class="pill" title="/goal：设定长期目标让代理持续推进" onClick={() => { putDraft("/goal "); input.focus() }}>◎ Goal</span>
          </div>
        </Show>

        <div
          classList={{ promptbox: true, focus: ui.focused, dragover: ui.drag }}
          onDragOver={(e) => { e.preventDefault(); setUi("drag", true) }}
          onDragLeave={() => setUi("drag", false)}
          onDrop={(e) => {
            e.preventDefault()
            setUi("drag", false)
            for (const f of Array.from(e.dataTransfer?.files ?? [])) void addFile(f)
          }}
        >
          <Show when={ui.menu === "slash" || ui.menu === "mention"}>
            <div class="popmenu show">
              <For each={menuItems()}>
                {(x) =>
                  x.h ? (
                    <div class="pm-head">{x.h}</div>
                  ) : (
                    <button
                      class="pm-item"
                      classList={{ hl: flat().findIndex((y) => y.c === x.c) === ui.hl }}
                      onClick={() => pickMenu(x)}
                      onMouseEnter={() => setUi("hl", flat().findIndex((y) => y.c === x.c))}
                    >
                      {x.i && <span class="ic">{(() => { const Ic = x.i; return <Ic size={13} strokeWidth={1.8} /> })()}</span>}
                      <span class="cmd">{x.c}</span>
                      <span class="desc">{x.d}</span>
                      {x.g && <span class="g">{x.g}</span>}
                    </button>
                  )
                }
              </For>
            </div>
          </Show>

          <Show when={staged().length}>
            <div class="pimgs">
              <For each={staged()}>
                {(f, i) => (
                  <div class="thumb" title={f.name}>
                    <Show when={f.img} fallback={<span>{ext(f.name).toUpperCase().slice(0, 4)}</span>}>
                      <img src={f.url} alt={f.name} />
                    </Show>
                    <span class="rm" onClick={() => setStaged((list) => list.filter((_, j) => j !== i()))}>✕</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <textarea
            class="ptext"
            ref={input}
            rows={1}
            placeholder="让 Kilo 做什么…（/ 命令 · @ 提及 · 拖拽/粘贴图片）"
            value={ui.draft}
            onInput={(e) => onType(e.currentTarget)}
            onKeyDown={onKey}
            onFocus={() => setUi("focused", true)}
            onBlur={() => {
              setUi("focused", false)
              setTimeout(() => {
                if (ui.menu === "slash" || ui.menu === "mention") setUi("menu", "")
              }, 150)
            }}
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData?.files ?? [])
              if (!fs.length) return
              e.preventDefault()
              for (const f of fs) void addFile(f)
            }}
          />
          <div class="pbar">
            <label class="iconbtn" title="添加附件（文件/图片）" style="cursor:pointer">
              ＋
              <input type="file" multiple hidden onChange={(e) => { for (const f of Array.from(e.currentTarget.files ?? [])) void addFile(f); e.currentTarget.value = "" }} />
            </label>
            <Popover placement="top-start" gutter={8} open={ui.menu === "mode"} onOpenChange={(o: boolean) => setUi("menu", o ? "mode" : "")}>
              <Popover.Trigger class="selector" title="交互模式：点击选择 Agent（Mode）">
                <span class="ti"><Compass size={13} strokeWidth={1.8} /></span> <span class="v" style="text-transform:capitalize">{modeName()}</span><span class="caret">▼</span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content class="modepop">
                  <For each={primaryAgents()}>
                    {(a) => (
                      <button class="pm-item" classList={{ hl: store.agent() === a.id }} onClick={() => { store.setAgent(a.id); setUi("menu", "") }}>
                        <span class="cmd" style="text-transform:capitalize">{a.id}</span>
                        <span class="desc">{a.description ?? ""}</span>
                      </button>
                    )}
                  </For>
                </Popover.Content>
              </Popover.Portal>
            </Popover>
            <Popover placement="top-start" gutter={8} open={ui.menu === "model"} onOpenChange={(o: boolean) => setUi("menu", o ? "model" : "")}>
              <Popover.Trigger class="selector" title="模型（/models）">
                <span class="ti"><Box size={13} strokeWidth={1.8} /></span> <span class="v">{modelName()}</span><span class="caret">▼</span>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content class="modelpop"><ModelPop onPick={() => setUi("menu", "")} /></Popover.Content>
              </Popover.Portal>
            </Popover>
            <Show when={variants().length}>
              <Popover placement="top-start" gutter={8} open={ui.menu === "variant"} onOpenChange={(o: boolean) => setUi("menu", o ? "variant" : "")}>
                <Popover.Trigger class="selector" title="推理强度变体（Shift+Tab 循环）">
                  <span class="ti"><RotateCcw size={13} strokeWidth={1.8} /></span> <span class="v">{curModel()?.variant || "默认"}</span><span class="caret">▼</span>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content class="variantpop">
                    <button class="pm-item" classList={{ hl: !curModel()?.variant }} onClick={() => { const m = curModel(); if (m) store.setModel({ ...m, variant: undefined }); setUi("menu", "") }}>
                      <span class="cmd">默认</span>
                    </button>
                    <For each={variants()}>
                      {(v) => (
                        <button class="pm-item" classList={{ hl: curModel()?.variant === v }} onClick={() => { const m = curModel(); if (m) store.setModel({ ...m, variant: v }); setUi("menu", "") }}>
                          <span class="cmd">{v}</span>
                        </button>
                      )}
                    </For>
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
            </Show>
            <span class="spacer" />
            <Popover placement="top-end" gutter={8} open={ui.menu === "shield"} onOpenChange={(o: boolean) => setUi("menu", o ? "shield" : "")}>
              <Popover.Trigger class="iconbtn" title="自动批准概览"><Shield size={14} strokeWidth={1.8} /></Popover.Trigger>
              <Popover.Portal>
                <Popover.Content class="shieldpop">
                  <For each={shieldRows()}>
                    {(r) => (
                      <div class="sh-row">
                        <span class="lbl">{r[0]}</span>
                        <span classList={{ lvl: true, allow: r[1] === "allow", ask: r[1] === "ask", deny: r[1] === "deny" }}>{r[1] === "allow" ? "自动批准" : r[1] === "deny" ? "拒绝" : "询问"}</span>
                      </div>
                    )}
                  </For>
                  <div class="sh-foot">
                    <span>临时自动批准：<b>{store.autoApprove() ? "开" : "关"}</b></span>
                    <span style="display:flex;gap:8px;align-items:center">
                      <button classList={{ switch: true, on: store.autoApprove() }} onClick={() => store.setAutoApprove(!store.autoApprove())}><i /></button>
                      <button class="btn sm" onClick={() => { store.setView("settings"); setSettingsTab("approve") }}>全部规则 →</button>
                    </span>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover>
            <button
              class="iconbtn"
              title="提示词增强 · 再点一次可回滚"
              onClick={async () => {
                if (ui.enhanced) {
                  const back = ui.enhanced
                  setUi({ enhanced: "" })
                  putDraft(back)
                  return store.notify("已回滚增强")
                }
                const t = ui.draft.trim()
                if (!t) return store.notify("先写点内容，再让 Kilo 增强")
                const better = await store.enhance(t)
                if (!better || better === t) return store.notify("增强失败或无变化")
                setUi({ enhanced: ui.draft, draft: better })
                store.setDraft(better)
                store.notify("提示词已增强 · 再点魔杖可还原")
              }}
            >
              <Wand2 size={14} strokeWidth={1.8} />
            </button>
            <Show when={!isBusy()} fallback={<button class="sendbtn stop" title="停止 (Esc)" onClick={() => void store.abort()}><span class="sq" /></button>}>
              <button class="sendbtn" title="发送 (Enter)" onClick={submit} disabled={!ui.draft.trim() && !staged().length}>↑</button>
            </Show>
          </div>
        </div>
        <div class="hintline">
          <span><span class="kbd">Enter</span> 发送</span>
          <span><span class="kbd">⇧Enter</span> 换行</span>
          <span><span class="kbd">↑</span> 历史提示词</span>
          <span class="tok">≈ {Math.max(1, Math.ceil(ui.draft.length / 3.6))} tok · {fmtK(ctx().used)}/{fmtK(ctx().limit)}</span>
        </div>
        <Show when={welcome()}>
          <div class="chips" style="display:flex">
            <button onClick={() => putDraft("修复当前项目的构建错误")}>修复构建错误</button>
            <button onClick={() => putDraft("写一个 README，覆盖安装、使用与测试")}>写一份 README</button>
            <button onClick={() => putDraft(`/goal 评审 ${vcs().branch || "当前分支"} 的未提交改动`)}>评审未提交改动</button>
          </div>
        </Show>
      </div>
    </section>
  )
}

function TitleEditable(props: { title: string; onRename: (t: string) => void }) {
  let el!: HTMLSpanElement
  createEffect(() => {
    if (document.activeElement !== el) el.textContent = props.title || "New Chat"
  })
  return (
    <span
      class="th-title"
      ref={el}
      contentEditable
      title="点击重命名"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).blur()
        }
      }}
      onBlur={() => {
        const t = el.textContent?.trim()
        if (t && t !== props.title) props.onRename(t)
      }}
    />
  )
}

// ---------- 消息 ----------

function textOf(parts: Part[]) {
  return parts.flatMap((p) => (p.type === "text" && !p.synthetic ? [p.text] : []))
}

function Message(props: { msg: Msg }) {
  const info = () => props.msg.info
  return (
    <>
      <Show when={info().role === "user"} fallback={<Assistant msg={props.msg} />}>
        <div class="msg user">
          <div class="meta">
            <span class="badge gray">{(info() as { agent?: string }).agent ?? "Code"}</span>
            <span>{new Date(info().time.created).toTimeString().slice(0, 5)}</span>
          </div>
          <div class="bubble">{textOf(props.msg.parts).join("\n") || (props.msg.parts.some((p) => p.type === "file") ? "" : "（附件）")}</div>
          <Show when={props.msg.parts.some((p) => p.type === "file")}>
            <div class="attach">
              <For each={props.msg.parts.filter((p): p is Extract<Part, { type: "file" }> => p.type === "file")}>
                {(f) =>
                  f.mime.startsWith("image/") && f.url.startsWith("data:") ? (
                    <div class="thumb"><img src={f.url} alt={f.filename ?? ""} /></div>
                  ) : (
                    <span class="chip file" title={f.url} onClick={() => openRef(f.url)}>{f.filename ?? "file"}</span>
                  )
                }
              </For>
            </div>
          </Show>
          <div class="hoveract">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => void navigator.clipboard.writeText(textOf(props.msg.parts).join("\n"))}>复制</button>
            <button title="回填编辑，revert 后重发" onClick={() => { bridge.put(textOf(props.msg.parts).join("\n")); void store.revertTo(info().id) }}>编辑</button>
            <button title="从此处 Fork 新会话" onClick={() => void store.fork(info().sessionID)}>Fork</button>
            <button title="回退到此处（checkpoint 恢复文件快照）" onClick={() => void store.revertTo(info().id)}>Revert</button>
          </div>
        </div>
      </Show>
    </>
  )
}

function Assistant(props: { msg: Msg }) {
  const info = () => {
    const i = props.msg.info
    return i.role === "assistant" ? i : undefined
  }
  return (
    <div class="msg ai">
      <div class="role">
        <span class="logo"><img src={logo} alt="K" /></span>
        Kilo · <span class="badge gray">{info()?.agent || "Code"}</span> · {info()?.modelID}{info()?.variant ? ` · ${info()!.variant}` : ""}
      </div>
      <For each={props.msg.parts}>{(p) => <PartView part={p} />}</For>
      <Show when={info()?.error}>{(err) => <ErrorCard e={err()} provider={info()!.providerID} />}</Show>
      <Show when={info()?.time.completed}>
        <div class="turnact">
          <button title="复制回复" onClick={() => void navigator.clipboard.writeText(textOf(props.msg.parts).join("\n"))}><Copy size={13} strokeWidth={1.8} /></button>
          <button title="有帮助" classList={{ on: votes()[info()!.id] === "up" }} onClick={() => vote(info()!.id, "up")}><ThumbsUp size={13} strokeWidth={1.8} /></button>
          <button title="需改进" classList={{ on: votes()[info()!.id] === "down" }} onClick={() => vote(info()!.id, "down")}><ThumbsDown size={13} strokeWidth={1.8} /></button>
          <button title="从此回合 Fork 新会话" onClick={() => void store.fork(info()!.sessionID)}><GitFork size={13} strokeWidth={1.8} /></button>
          <span class="when">{new Date(info()!.time.completed!).toTimeString().slice(0, 5)}</span>
        </div>
      </Show>
    </div>
  )
}

function ErrorCard(props: { e: NonNullable<AssistantMessage["error"]>; provider: string }) {
  const e = () => props.e
  const msg = (): string => {
    const d: unknown = e().data
    if (!d || typeof d !== "object") return ""
    const box: Record<string, unknown> = { ...d }
    return typeof box.message === "string" ? box.message : ""
  }
  const status = () => {
    const d: unknown = e().data
    if (!d || typeof d !== "object") return undefined
    const box: Record<string, unknown> = { ...d }
    return typeof box.statusCode === "number" ? box.statusCode : undefined
  }
  const authed = () => e().name === "ProviderAuthError"
  const limited = () => e().name === "APIError" && status() === 429
  const length = () => e().name === "MessageOutputLengthError"
  const aborted = () => e().name === "MessageAbortedError"
  return (
    <div class="outcome bad">
      <span class="ec-ic">
        {aborted() ? "■" : authed() ? "🔑" : limited() ? "🕙" : length() ? "✂" : <AlertTriangle size={13} strokeWidth={1.8} style="vertical-align:-2px" />}
      </span>
      <span class="ec-txt">
        {aborted() ? "已中断（Esc）· 保留已生成内容" : authed() ? `未授权：${props.provider}` : limited() ? "触发速率限制" : length() ? "输出达到模型长度上限" : msg() || e().name}
      </span>
      <span class="grow1" />
      <Show when={authed()} fallback={
        <>
          <Show when={limited()}><span class="ec-hint">稍后将自动重试</span></Show>
          <Show when={length()}><button class="btn sm" onClick={() => void store.send("继续")}>继续</button></Show>
        </>
      }>
        <button class="btn sm" onClick={() => { store.setView("settings"); setSettingsTab("providers"); openModal("provider", { provider: props.provider }) }}>✨ 升级</button>
        <button class="btn sm primary" onClick={() => openModal("provider", { provider: props.provider })}>Sign in</button>
      </Show>
    </div>
  )
}

function PartView(props: { part: Part }) {
  return (
    <>
      {props.part.type === "text" && !props.part.synthetic && <div class="md" innerHTML={md(props.part.text)} />}
      {props.part.type === "reasoning" && props.part.text.trim() && (
        <details class="think">
          <summary><Brain size={13} strokeWidth={1.8} /> 思考过程 <span class="chev"><ChevronRight size={12} strokeWidth={2} /></span></summary>
          <div class="body" innerHTML={md(props.part.text)} />
        </details>
      )}
      {props.part.type === "file" && <span class="chip file" style="margin:0 6px 6px;cursor:pointer" title="打开" onClick={openRef.bind(null, props.part.url)}>{props.part.filename ?? "file"}</span>}
      {props.part.type === "compaction" && <div class="outcome"><Scissors size={13} strokeWidth={1.8} style="vertical-align:-2px" /> 上下文已压缩{props.part.auto ? "（自动）" : ""}，后续消息基于摘要继续</div>}
      {props.part.type === "retry" && (
        <div class="working show" style="max-width:760px">
          <span class="spinner" />
          <span>API 重试中 · 第 {props.part.attempt} 次…</span>
          <code class="tinp">{props.part.error.data.message.slice(0, 120)}</code>
          <Show when={retryWait(props.part)}>{(w) => <span class="ec-hint">约 {w()}s 后重试</span>}</Show>
          <button class="btn sm danger" style="margin-left:auto" onClick={() => void store.abort()}>取消重试</button>
        </div>
      )}
      {props.part.type === "patch" && (
        <div class="tool">
          <div class="thead">
            <span class="ti"><Scissors size={13} strokeWidth={1.8} /></span><span class="tname">Patch</span><span class="tsub">{props.part.files.length} 个文件</span>
          </div>
        </div>
      )}
      {props.part.type === "tool" && <ToolCard part={props.part} />}
    </>
  )
}

const TOOL_META: Record<string, [LucideIcon, string]> = {
  read: [FileText, "Read"], list: [List, "List"], glob: [Search, "Glob"], grep: [Search, "Grep"],
  bash: [SquareTerminal, "Running Command"], edit: [Pencil, "Edit"], write: [Pencil, "Write"], multiedit: [Pencil, "MultiEdit"],
  apply_patch: [Scissors, "Apply Patch"], task: [GitBranch, "Task"], todowrite: [ListChecks, "To-dos"], todoread: [ListChecks, "To-dos"],
  websearch: [Search, "Web Search"], webfetch: [Globe, "Web Fetch"], skill: [BookOpen, "Skill"], question: [CircleHelp, "Question"],
  lsp: [Settings, "LSP"], patch: [Scissors, "Patch"], invalid: [AlertTriangle, "Invalid"],
}

function ToolCard(props: { part: Extract<Part, { type: "tool" }> }) {
  const [open, setOpen] = createSignal(false)
  const st = () => props.part.state
  const meta = (): [LucideIcon, string] => TOOL_META[props.part.tool] ?? [Settings, props.part.tool.slice(0, 18)]
  const inp = () => st().input
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const md = () => {
    const s = st()
    return s.status === "pending" ? undefined : s.metadata
  }
  const sub = () => {
    const s = st()
    if (s.status === "running" && s.title) return s.title
    const i = inp()
    return str(i.filePath) || str(i.path) || str(i.pattern) || str(i.command) || str(i.url) || str(i.agent) || str(i.notebookPath) || props.part.tool
  }
  const diffText = () => {
    const patch = str(md()?.diff) || str(md()?.patch)
    if (patch) return patch
    const i = inp()
    if ((props.part.tool === "edit" || props.part.tool === "multiedit") && typeof i.oldString === "string") {
      const minus = (str(i.oldString) || "").split("\n").map((x) => "-" + x).join("\n")
      const plus = (str(i.newString) || "").split("\n").map((x) => "+" + x).join("\n")
      return `@@\n${minus}${plus ? "\n" + plus : ""}`
    }
    if (props.part.tool === "write") {
      const plus = (str(i.content) || "").split("\n").map((x) => "+" + x).join("\n")
      return `@@ -0,0\n${plus}`
    }
    return ""
  }
  const stats = () => {
    const adds = Number(md()?.adds ?? md()?.additions ?? 0)
    const dels = Number(md()?.dels ?? md()?.deletions ?? 0)
    if (adds || dels) return <span class="stat"><span class="a">+{adds}</span>{dels ? <span class="d">−{dels}</span> : null}</span>
    const d = diffText()
    if (!d) return null
    let a = 0
    let b = 0
    for (const line of d.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) a++
      else if (line.startsWith("-") && !line.startsWith("---")) b++
    }
    return a || b ? <span class="stat"><span class="a">+{a}</span>{b ? <span class="d">−{b}</span> : null}</span> : null
  }
  const body = () => {
    const s = st()
    if (s.status === "completed") return s.output ?? ""
    if (s.status === "error") return s.error ?? "执行失败"
    return ""
  }
  const isBash = () => props.part.tool === "bash"
  return (
    <div class="tool">
      <button class="thead" onClick={() => setOpen(!open())} title={`${props.part.tool} ${sub()}`}>
        <span class="ti">{(() => { const Ic = meta()[0]; return <Ic size={14} strokeWidth={1.8} /> })()}</span>
        <span class="tname">{meta()[1]}</span>
        <span class="tsub">{sub()}</span>
        <span class="tstat">
          {stats()}
          <span classList={{ badge: true, ok: st().status === "completed", err: st().status === "error", run: st().status === "running" }}>
            {st().status === "completed" ? "完成" : st().status === "error" ? "失败" : st().status === "running" ? "进行中" : "等待"}
          </span>
          <span class="chev" classList={{ open: open() }}><ChevronRight size={12} strokeWidth={2} /></span>
        </span>
      </button>
      <Show when={open()}>
        <div class="tbody">
          <Show when={diffText()} fallback={
            <Show when={body()} fallback={<pre>{JSON.stringify(inp(), null, 1)}</pre>}>
              <Show when={isBash()} fallback={<pre>{body().slice(0, 30_000)}</pre>}>
                <pre class="cmd">$ {str(inp().command)}</pre>
                <pre style="margin-top:6px">{body().slice(0, 30_000)}</pre>
              </Show>
            </Show>
          }>
            <div class="diff">
              <For each={diffText().split("\n")}>{(l) => <span class={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hh" : "ctx"}>{l || " "}</span>}</For>
            </div>
          </Show>
          <Show when={props.part.tool === "task" && props.part.sessionID}>
            <SubtaskView parent={props.part.sessionID} />
          </Show>
        </div>
      </Show>
    </div>
  )
}

function SubtaskView(props: { parent: string }) {
  const [kids, setKids] = createSignal<{ id: string; title?: string }[]>([])
  const [open, setOpen] = createSignal("")
  const [msgs, setMsgs] = createSignal<Record<string, Msg[]>>({})
  async function load() {
    const list = (await store.children(props.parent)) ?? []
    setKids(list.map((s) => ({ id: s.id, title: s.title })))
  }
  void load()
  async function toggle(id: string) {
    if (open() === id) {
      setOpen("")
      return
    }
    setOpen(id)
    if (msgs()[id]) return
    const c = client()
    const res = await c?.session.messages({ sessionID: id, directory: directory() }).catch(() => undefined)
    setMsgs((m) => ({ ...m, [id]: (res?.data ?? []) as Msg[] }))
  }
  return (
    <div class="subtasks">
      <div class="sth">⧉ 子代理会话 · {kids().length}</div>
      <Show when={kids().length} fallback={<div class="ss-hint">{kids().length === 0 ? "加载子会话…" : ""}</div>}>
        <For each={kids()}>{(k) => (
          <>
            <button class="ss-row" onClick={() => void toggle(k.id)}>
              <span class="tw">{open() === k.id ? "▾" : "▸"}</span>
              <span>{k.title || k.id}</span>
            </button>
            <Show when={open() === k.id}>
              <div class="ss-body">
                <For each={msgs()[k.id] ?? []}>{(m) => (
                  <div class="ss-msg">
                    <b>{m.info.role === "user" ? "→" : ""}</b>
                    <span>{m.parts.flatMap((p) => (p.type === "text" ? [p.text] : p.type === "tool" ? [`[${p.tool}]`] : [])).join(" ").slice(0, 600) || "…"}</span>
                  </div>
                )}</For>
              </div>
            </Show>
          </>
        )}</For>
      </Show>
    </div>
  )
}

// ---------- 审批 / 问题 ----------

function PermDock(props: { p: { id: string; permission: string; patterns?: string[]; metadata?: Record<string, unknown>; always?: string[] } }) {
  const p = () => props.p
  const cmd = () => {
    const md = p().metadata
    if (md && typeof md.command === "string") return md.command
    return ""
  }
  const [rulesOn, setRulesOn] = createSignal<Record<string, boolean>>({})
  const always = p().always ?? []
  const list = p().patterns ?? []
  const patterns: string[] = always.length ? always : list.slice(0, 4)
  return (
    <div class="permdock">
      <div class="ph">
        <span class="ic"><AlertTriangle size={14} strokeWidth={1.8} /></span>请求执行 {cmd() ? "命令" : "操作"}
        <span class="src">{p().permission}</span>
      </div>
      <div class="hint">该操作将修改外部状态。允许一次，或为同类操作开启自动批准。</div>
      <Show when={cmd()} fallback={
        <Show when={list.length}><div class="paths">{list.slice(0, 20).join("\n")}</div></Show>
      }>
        <pre class="cmdout">$ {cmd()}</pre>
      </Show>
      <Show when={patterns.length}>
        <div class="rules">
          <div class="rh">管理自动批准 <span>（本次及以后的匹配规则 · 只影响后续回合）</span></div>
          <For each={patterns}>{(pat) => (
            <label>
              <button classList={{ switch: true, sm: true, on: rulesOn()[pat] ?? false }} onClick={() => setRulesOn((r) => ({ ...r, [pat]: !(r[pat] ?? false) }))}><i /></button>
              <code class="inline">{pat}</code>
            </label>
          )}</For>
        </div>
      </Show>
      <div class="pactions">
        <button class="btn primary" onClick={() => void store.replyPermission(p().id, "once")}>允许一次</button>
        <button class="btn danger" onClick={() => void store.replyPermission(p().id, "reject")}>拒绝</button>
        <button class="btn" onClick={() => void store.replyPermission(p().id, "always")}>总是允许</button>
        <span class="keys"><span class="kbd">Enter</span> 允许 · <span class="kbd">Esc</span> 拒绝</span>
      </div>
    </div>
  )
}

function QDock(props: { q: Question }) {
  const [idx, setIdx] = createSignal(0)
  const [picks, setPicks] = createSignal<Record<number, string[]>>({})
  const [free, setFree] = createSignal<Record<number, string>>({})
  const q = () => props.q
  const cur = () => q().questions[idx()]
  const answered = () => q().questions.length && q().questions.every((_, i) => (picks()[i]?.length ?? 0) > 0 || (free()[i] ?? "").trim())
  function submit() {
    const answers = q().questions.map((_, i) => {
      const row = [...(picks()[i] ?? [])]
      const f = (free()[i] ?? "").trim()
      if (f) row.push(f)
      return row
    })
    void store.replyQuestion(q().id, answers)
  }
  return (
    <div class="qdock">
      <div class="qh">
        <b>问题 {idx() + 1}/{q().questions.length}</b>
        <button class="iconbtn" disabled={idx() === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
        <button class="iconbtn" disabled={idx() >= q().questions.length - 1} onClick={() => setIdx((i) => Math.min(q().questions.length - 1, i + 1))}>›</button>
      </div>
      <Show when={cur()} keyed>
        {(one) => (
          <>
            <div class="q">{one.question}</div>
            <For each={one.options ?? []}>
              {(o) => {
                const on = () => (picks()[idx()] ?? []).includes(o.label)
                return (
                  <button class="qopt" classList={{ sel: on() }} onClick={() => setPicks((p) => { const row = p[idx()] ?? []; const next = on() ? row.filter((x) => x !== o.label) : one.multiple ? [...row, o.label] : [o.label]; return { ...p, [idx()]: next } })}>
                    <span class="mk" />
                    <div><div>{o.label}</div>{o.description && <div class="d">{o.description}</div>}</div>
                  </button>
                )
              }}
            </For>
            <input class="free" placeholder="输入自定义答案…" value={free()[idx()] ?? ""} onInput={(e) => setFree((f) => ({ ...f, [idx()]: e.currentTarget.value }))} />
          </>
        )}
      </Show>
      <div class="qfoot">
        <button class="btn sm" onClick={() => void store.rejectQuestion(q().id)}>跳过</button>
        <span class="grow" />
        <button class="btn sm primary" disabled={!answered()} onClick={submit}>提交 (⌘↵)</button>
      </div>
    </div>
  )
}

// ---------- 模型弹层 ----------

function ModelPop(props: { onPick: () => void }) {
  const [q, setQ] = createSignal("")
  const [hover, setHover] = createSignal("")
  type Row = { id: string; name: string; prov: string; free: boolean; in: number; out: number; cache: number; ctx: number; desc: string; caps: string[]; star: boolean; group: string; variants: string[]; tb?: { overallScore: number; avgAttemptCostUsd: number } }
  const rows = createMemo<Row[]>(() => {
    const out: Row[] = []
    for (const p of store.providers().all) {
      if (!store.providers().connected.includes(p.id)) continue
      for (const m of Object.values(p.models)) {
        out.push({
          id: `${p.id}/${m.id}`,
          name: m.name ?? m.id,
          prov: p.name ?? p.id,
          free: (m.cost?.input ?? 0) === 0 && (m.cost?.output ?? 0) === 0,
          in: m.cost?.input ?? 0,
          out: m.cost?.output ?? 0,
          cache: m.cost?.cache?.read ?? 0,
          ctx: m.limit?.context ?? 0,
          desc: p.description ?? "",
          caps: [...(m.capabilities?.reasoning ? ["reasoning"] : []), ...(m.capabilities?.toolcall ? ["tools"] : []), ...(m.capabilities?.input?.image ? ["vision"] : []), ...(m.capabilities?.input?.pdf ? ["pdf"] : [])],
          star: store.favorites().includes(`${p.id}/${m.id}`),
          group: p.name ?? p.id,
          variants: Object.keys(m.variants ?? {}),
          tb: m.terminalBench,
        })
      }
    }
    return out
  })
  const groups = () => {
    const list = rows().filter((r) => !q() || (r.name + " " + r.id).toLowerCase().includes(q().toLowerCase()))
    const fav = list.filter((r) => r.star)
    const rest = new Map<string, Row[]>()
    for (const r of list.filter((x) => !x.star)) rest.set(r.group, [...(rest.get(r.group) ?? []), r])
    return [{ g: "★ 收藏", items: fav }, ...[...rest].map(([g, items]) => ({ g, items }))].filter((x) => x.items.length)
  }
  const selId = () => { const m = store.model(); return m ? `${m.providerID}/${m.modelID}` : "" }
  const preview = () => rows().find((r) => r.id === (hover() || selId()))
  const money = (n: number) => (n ? "$" + n.toFixed(2).replace(/\.?0+$/, "") : "—")
  function toggleStar(id: string) {
    const f = store.favorites()
    store.setFavorites(f.includes(id) ? f.filter((x) => x !== id) : [...f, id])
  }
  function pick(m: ModelRef | undefined) {
    store.setModel(m)
    props.onPick()
  }
  return (
    <>
      <div class="mp-left">
        <div class="mp-search"><input placeholder="搜索模型…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} /></div>
        <div class="mp-list">
          <For each={groups()}>
            {(g) => (
              <>
                <div class="mp-group">{g.g}</div>
                <For each={g.items}>
                  {(m) => (
                    <div classList={{ "mp-row": true, sel: selId() === m.id }} onMouseEnter={() => setHover(m.id)} onClick={() => pick({ providerID: m.id.split("/")[0], modelID: m.id.slice(m.id.indexOf("/") + 1) })}>
                      <span class="picon" style="width:20px;height:20px;font-size:10px">{m.prov.slice(0, 1)}</span>
                      <span class="nm">{m.name}</span>
                      <span class="tags">
                        <Show when={m.free}><span class="free">free</span></Show>
                        <span class="price">{money(m.in)}/{money(m.out)}</span>
                      </span>
                      <span class="star" classList={{ on: m.star }} onClick={(e) => { e.stopPropagation(); toggleStar(m.id) }}>★</span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
          <Show when={!groups().length}><div class="mp-empty">无匹配模型 · 去「设置 → 供应商」连接更多</div></Show>
        </div>
      </div>
      <div class="mp-right">
        <Show when={preview()} keyed>
          {(m) => (
            <>
              <h4><span class="nm4">{m.name}</span><span class="star" classList={{ on: m.star }} onClick={() => toggleStar(m.id)}>★</span></h4>
              <div class="prov">{m.prov}</div>
              <div class="pr"><span>输入</span><b>{money(m.in)}/M</b></div>
              <div class="pr"><span>输出</span><b>{money(m.out)}/M</b></div>
              <div class="pr"><span>缓存读</span><b>{m.free ? "—" : money(m.cache || 0.3) + "/M"}</b></div>
              <div class="pr"><span>缓存写</span><b>{m.free ? "—" : "$0.375/M"}</b></div>
              <div class="kv">上下文窗口 <b>{m.ctx ? fmtK(m.ctx) : "—"}</b></div>
              <Show when={m.tb}><div class="kv">Terminal-Bench <b>{Math.round((m.tb?.overallScore ?? 0) * 100)}%</b> · 均次 <b>${(m.tb?.avgAttemptCostUsd ?? 0).toFixed(2)}</b></div></Show>
              <div class="cap"><For each={m.caps}>{(c) => <span class="badge gray">{c}</span>}</For></div>
              {m.variants.length > 0 && <div class="kv">推理变体 <b>{m.variants.slice(0, 4).join(" / ")}</b></div>}
              <div class="desc">{m.desc}</div>
              <div style="display:flex;gap:6px;margin-top:10px">
                <button class="btn sm primary" style="flex:1" onClick={() => { const [pid, ...rest] = m.id.split("/"); pick({ providerID: pid, modelID: rest.join("/") }) }}>使用此模型</button>
                <Show when={store.model()?.providerID === m.id.split("/")[0] && store.model()?.modelID === m.id.slice(m.id.indexOf("/") + 1)}>
                  <button class="btn sm" onClick={() => pick(undefined)}>用默认</button>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </>
  )
}
