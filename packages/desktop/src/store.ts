import type {
  AgentV2Info,
  FilePartInput,
  Message,
  Part,
  Provider,
  QuestionInfo,
  Session,
  SnapshotFileDiff,
  Todo,
} from "@kilocode/sdk/v2/types"
import { createSignal, batch } from "solid-js"
import { client, directory, onEvent } from "./client"

export type Msg = { info: Message; parts: Part[] }
export type Pending = { id: string; sessionID: string; permission: string; patterns: string[]; always: string[] }
export type Question = { id: string; sessionID: string; questions: QuestionInfo[] }
export type Model = { providerID: string; modelID: string; variant?: string }
export type Theme = "system" | "light" | "dark"
export type Page = "chat" | "plugins" | "providers" | "files" | "settings"

function persist(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function saved(key: string): unknown {
  const raw = localStorage.getItem(key)
  if (!raw) return undefined
  return JSON.parse(raw) as unknown
}

const stored = saved("model")
const initial: Model | undefined = (() => {
  if (typeof stored !== "object" || stored === null) return undefined
  if (!("providerID" in stored) || !("modelID" in stored)) return undefined
  if (typeof stored.providerID !== "string" || typeof stored.modelID !== "string") return undefined
  const v = "variant" in stored && typeof stored.variant === "string" ? stored.variant : undefined
  return { providerID: stored.providerID, modelID: stored.modelID, ...(v ? { variant: v } : {}) }
})()

const [sessions, setSessions] = createSignal<Session[]>([])
const [current, setCurrent] = createSignal("")
const [messages, setMessages] = createSignal<Record<string, Msg[]>>({})
const [busy, setBusy] = createSignal(new Set<string>())
const [permissions, setPermissions] = createSignal<Pending[]>([])
const [questions, setQuestions] = createSignal<Question[]>([])
const [providers, setProviders] = createSignal<{ all: Provider[]; connected: string[] }>({ all: [], connected: [] })
const [model, setModelRaw] = createSignal(initial)
const [autoApprove, setAutoApproveRaw] = createSignal(localStorage.getItem("autoApprove") === "true")
const [error, setError] = createSignal("")
const [toast, setToast] = createSignal("")
const [agents, setAgents] = createSignal<AgentV2Info[]>([])
const [agent, setAgentRaw] = createSignal(localStorage.getItem("agent") ?? "")
const [todos, setTodos] = createSignal<Record<string, Todo[]>>({})
const [theme, setThemeRaw] = createSignal<Theme>((() => {
  const t = localStorage.getItem("theme")
  return t === "light" || t === "dark" ? t : "system"
})())
const [page, setPage] = createSignal<Page>("chat")

const dark = matchMedia("(prefers-color-scheme: dark)")
function applyTheme() {
  const want = theme() === "system" ? (dark.matches ? "dark" : "light") : theme()
  document.documentElement.dataset.theme = want
}
dark.addEventListener("change", applyTheme)
applyTheme()

let toastTimer: ReturnType<typeof setTimeout> | undefined
function notify(text: string) {
  setToast(text)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setToast(""), 3000)
}

export const store = {
  sessions,
  current,
  messages,
  busy,
  permissions,
  questions,
  providers,
  model,
  autoApprove,
  error,
  toast,
  agents,
  agent,
  todos,
  theme,
  page,
  thread,
  setModel,
  setAutoApprove,
  setAgent,
  setTheme,
  setPage,
  open: openSession,
  newSession,
  send,
  retry,
  abort,
  rename,
  fork,
  share,
  unshare,
  revertTo,
  unrevert,
  diff,
  replyPermission,
  replyQuestion,
  rejectQuestion,
  removeSession,
  refresh,
  notify,
}

function setModel(next?: Model) {
  setModelRaw(next)
  persist("model", next ?? null)
}

function setAutoApprove(on: boolean) {
  setAutoApproveRaw(on)
  persist("autoApprove", on)
}

function setAgent(name: string) {
  setAgentRaw(name)
  persist("agent", name || null)
}

function setTheme(t: Theme) {
  setThemeRaw(t)
  persist("theme", t)
  applyTheme()
}

// reverted 之后的消息不展示；服务端 messages API 仍会返回全量
function thread(id: string): Msg[] {
  const list = messages()[id] ?? []
  const rev = sessions().find((s) => s.id === id)?.revert
  if (!rev) return list
  return list.filter((m) => m.info.id < rev.messageID)
}

onEvent((e) => {
  const p = e.payload
  switch (p.type) {
    case "session.created":
    case "session.updated": {
      const s = p.properties.info
      batch(() => {
        setSessions((list) => [s, ...list.filter((x) => x.id !== s.id)])
        if (p.type === "session.updated" && messages()[s.id]) void loadMessages(s.id)
      })
      return
    }
    case "message.updated": {
      const { sessionID, info } = p.properties
      mutate(sessionID, (list) => {
        const i = list.findIndex((m) => m.info.id === info.id)
        if (i === -1) list.push({ info, parts: [] })
        else list[i] = { ...list[i], info }
      })
      return
    }
    case "message.part.updated": {
      const { sessionID, part } = p.properties
      mutate(sessionID, (list) => {
        const msg = list.find((m) => m.info.id === part.messageID)
        if (!msg) return
        const i = msg.parts.findIndex((x) => x.id === part.id)
        if (i === -1) msg.parts.push(part)
        else msg.parts[i] = part
      })
      return
    }
    case "message.part.delta": {
      const d = p.properties
      if (d.field !== "text") return
      mutate(d.sessionID, (list) => {
        const msg = list.find((m) => m.info.id === d.messageID)
        const part = msg?.parts.find((x) => x.id === d.partID)
        if (part && part.type === "text") part.text += d.delta
      })
      return
    }
    case "session.idle": {
      setBusy((s) => {
        const next = new Set(s)
        next.delete(p.properties.sessionID)
        return next
      })
      void refreshSessions()
      return
    }
    case "todo.updated": {
      const { sessionID, todos: list } = p.properties
      setTodos((all) => ({ ...all, [sessionID]: list }))
      return
    }
    case "permission.asked": {
      const req = p.properties
      if (autoApprove()) {
        void replyPermission(req.id, "once")
        return
      }
      setPermissions((list) => [...list, req])
      return
    }
    case "permission.replied": {
      setPermissions((list) => list.filter((x) => x.id !== p.properties.requestID))
      return
    }
    case "question.asked": {
      setQuestions((list) => [...list, p.properties])
      return
    }
    case "question.replied":
    case "question.rejected": {
      setQuestions((list) => list.filter((x) => x.id !== p.properties.requestID))
      return
    }
    case "session.error": {
      const props = p.properties
      const data: { message?: unknown } | undefined = props.error?.data
      setError(typeof data?.message === "string" ? data.message : "会话出错")
      setBusy((s) => {
        const next = new Set(s)
        next.delete(props.sessionID ?? "")
        return next
      })
      return
    }
  }
})

// 粗粒度触发：mutate 后浅拷贝外层 map，组件按 session 读取时重渲染
function mutate(sessionID: string, fn: (list: Msg[]) => void) {
  const all = messages()
  const list = all[sessionID]
  if (!list) return
  fn(list)
  if (sessionID === current()) setMessages({ ...all, [sessionID]: [...list] })
}

async function refreshSessions() {
  const c = client()
  if (!c) return
  const res = await c.session.list({ directory: directory(), limit: 50 })
  setSessions((res.data ?? []).filter((s) => !s.parentID))
}

async function loadMessages(id: string) {
  const c = client()
  if (!c) return
  const res = await c.session.messages({ sessionID: id, directory: directory() })
  setMessages((m) => ({
    ...m,
    [id]: (res.data ?? []).map((x: { info: Message; parts: Part[] }) => ({ info: x.info, parts: x.parts })),
  }))
}

async function loadTodos(id: string) {
  const c = client()
  if (!c) return
  const res = await c.session.todo({ sessionID: id, directory: directory() }).catch(() => undefined)
  if (res) setTodos((all) => ({ ...all, [id]: res.data ?? [] }))
}

async function openSession(id: string) {
  setCurrent(id)
  setError("")
  await Promise.all([loadMessages(id), loadTodos(id)])
}

async function newSession() {
  setCurrent("")
  setMessages((m) => ({ ...m }))
  setError("")
}

async function send(text: string, files: FilePartInput[] = []) {
  const c = client()
  if (!c || (!text.trim() && !files.length)) return
  setError("")
  let id = current()
  if (!id) {
    const created = await c.session.create({ title: text.slice(0, 60), directory: directory() })
    id = created.data!.id
    setCurrent(id)
    setSessions((list) => [created.data!, ...list])
    // 必须先建空列表，否则随后的 message 事件在 mutate 里被丢弃
    setMessages((m) => ({ ...m, [id]: [] }))
  }
  setBusy((s) => new Set(s).add(id))
  const m = model()
  const a = agent()
  void c.session
    .prompt({
      sessionID: id,
      directory: directory(),
      parts: [{ type: "text", text }, ...files],
      ...(m ? { model: { providerID: m.providerID, modelID: m.modelID }, ...(m.variant ? { variant: m.variant } : {}) } : {}),
      ...(a ? { agent: a } : {}),
    })
    .catch((e: Error) => {
      setError(e.message)
      setBusy((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  await refreshSessions()
}

// 重发上一轮：revert 到该用户消息再带新内容重发
async function retry(messageID: string, text: string, files: FilePartInput[]) {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.revert({ sessionID: id, messageID, directory: directory() }).catch((e: Error) => setError(e.message))
  await send(text, files)
}

async function abort() {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.abort({ sessionID: id, directory: directory() }).catch(() => {})
}

async function rename(id: string, title: string) {
  const c = client()
  if (!c || !title.trim()) return
  await c.session.update({ sessionID: id, title: title.trim(), directory: directory() }).catch(() => {})
  await refreshSessions()
}

async function fork(id?: string) {
  const c = client()
  const sid = id || current()
  if (!c || !sid) return
  const res = await c.session.fork({ sessionID: sid, directory: directory() }).catch((e: Error) => {
    setError(e.message)
  })
  if (!res?.data) return
  await refreshSessions()
  await openSession(res.data.id)
}

async function share(id?: string) {
  const c = client()
  const sid = id || current()
  if (!c || !sid) return
  const res = await c.session.share({ sessionID: sid, directory: directory() }).catch((e: Error) => {
    setError(e.message)
  })
  const url = res?.data?.share?.url
  if (url) {
    await navigator.clipboard.writeText(url).catch(() => {})
    notify("分享链接已复制")
  }
  await refreshSessions()
}

async function unshare(id?: string) {
  const c = client()
  const sid = id || current()
  if (!c || !sid) return
  await c.session.unshare({ sessionID: sid, directory: directory() }).catch(() => {})
  await refreshSessions()
}

async function revertTo(messageID: string) {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.revert({ sessionID: id, messageID, directory: directory() }).catch((e: Error) => {
    setError(e.message)
  })
}

async function unrevert() {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.unrevert({ sessionID: id, directory: directory() }).catch(() => {})
  await Promise.all([refreshSessions(), loadMessages(id)])
}

async function diff(id?: string): Promise<SnapshotFileDiff[]> {
  const c = client()
  const sid = id || current()
  if (!c || !sid) return []
  const res = await c.session
    .diff({ sessionID: sid, directory: directory() })
    .catch((e: Error) => (notify(`读取变更失败：${e.message}`), undefined))
  return res?.data ?? []
}

async function replyPermission(requestID: string, reply: "once" | "always" | "reject") {
  const c = client()
  if (!c) return
  setPermissions((list) => list.filter((x) => x.id !== requestID))
  await c.permission.reply({ requestID, reply, directory: directory() }).catch(() => {})
}

async function replyQuestion(requestID: string, answers: string[][]) {
  const c = client()
  if (!c) return
  setQuestions((list) => list.filter((x) => x.id !== requestID))
  await c.question.reply({ requestID, answers, directory: directory() }).catch(() => {})
}

async function rejectQuestion(requestID: string) {
  const c = client()
  if (!c) return
  setQuestions((list) => list.filter((x) => x.id !== requestID))
  await c.question.reject({ requestID, directory: directory() }).catch(() => {})
}

async function removeSession(id: string) {
  const c = client()
  if (!c) return
  await c.session.delete({ sessionID: id, directory: directory() }).catch(() => {})
  setSessions((list) => list.filter((x) => x.id !== id))
  if (current() === id) void newSession()
}

async function refresh() {
  const c = client()
  if (!c) return
  await refreshSessions()
  const res = await c.provider.list({ directory: directory() })
  setProviders({ all: res.data?.all ?? [], connected: res.data?.connected ?? [] })
  const cfg = await c.config.providers({ directory: directory() })
  const def = cfg.data?.default
  const hit = (res.data?.connected ?? []).find((p) => def?.[p])
  if (hit && !model()) setModelRaw({ providerID: hit, modelID: def![hit] })
  const ag = await c.v2.agent.list({ location: { directory: directory() } }).catch(() => undefined)
  setAgents((ag?.data?.data ?? []).filter((a) => a.mode !== "subagent" && !a.hidden))
}
