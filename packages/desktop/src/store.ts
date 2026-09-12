import type {
  AgentV2Info,
  Command,
  Config,
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
export type Pending = { id: string; sessionID: string; permission: string; patterns: string[]; always: string[]; metadata?: Record<string, unknown> }
export type Question = { id: string; sessionID: string; questions: QuestionInfo[] }
export type ModelRef = { providerID: string; modelID: string; variant?: string }
export type Theme = "system" | "light" | "dark"
export type View = "chat" | "history" | "settings" | "profile"
export type Module = "" | "files" | "git" | "browser" | "diff" | "usage"
export type Queued = { text: string; files: FilePartInput[] }

function persist(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function saved<T>(key: string, def: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) return def
  try {
    const v: T = JSON.parse(raw)
    return v
  } catch {
    return def
  }
}

const savedModels = saved<Record<string, ModelRef>>("sessionModels", {})
const [sessions, setSessions] = createSignal<Session[]>([])
const [current, setCurrent] = createSignal("")
const [messages, setMessages] = createSignal<Record<string, Msg[]>>({})
const [busy, setBusy] = createSignal(new Set<string>())
const [failed, setFailed] = createSignal(new Set<string>())
const [permissions, setPermissions] = createSignal<Pending[]>([])
const [questions, setQuestions] = createSignal<Question[]>([])
const [providers, setProviders] = createSignal<{ all: Provider[]; connected: string[] }>({ all: [], connected: [] })
const [model, setModelRaw] = createSignal<ModelRef | undefined>(savedModels["*"])
const [autoApprove, setAutoApproveRaw] = createSignal(localStorage.getItem("autoApprove") === "true")
const [error, setError] = createSignal("")
const [toastMsg, setToastMsg] = createSignal("")
const [agents, setAgents] = createSignal<AgentV2Info[]>([])
const [agent, setAgentRaw] = createSignal(localStorage.getItem("agent") ?? "")
const [todos, setTodos] = createSignal<Record<string, Todo[]>>({})
const [commands, setCommands] = createSignal<Command[]>([])
const [theme, setThemeRaw] = createSignal<Theme>(
  ((t) => (t === "light" || t === "dark" ? t : "system"))(localStorage.getItem("theme")),
)
const [view, setViewRaw] = createSignal<View>("chat")
const [leftFold, setLeftFoldRaw] = createSignal(localStorage.getItem("leftFold") === "true")
const [rightFold, setRightFoldRaw] = createSignal(localStorage.getItem("rightFold") !== "false")
const [module, setModuleRaw] = createSignal<Module>((saved("module", "") || "") as Module)
const [drafts, setDraftsRaw] = createSignal<Record<string, string>>(saved("drafts", {}))
const [queue, setQueue] = createSignal<Record<string, Queued[]>>({})
const [favorites, setFavoritesRaw] = createSignal<string[]>(saved("favModels", []))
const [config, setConfig] = createSignal<Config>({})
const [profile, setProfile] = createSignal<{ loggedIn?: boolean; email?: string; name?: string; balance?: number; tier?: string; orgs?: { id: string; name: string; role: string }[] }>()

const dark = matchMedia("(prefers-color-scheme: dark)")
function applyTheme() {
  const want = theme() === "system" ? (dark.matches ? "dark" : "light") : theme()
  document.documentElement.dataset.theme = want
}
dark.addEventListener("change", applyTheme)
applyTheme()

let toastTimer: ReturnType<typeof setTimeout> | undefined
function notify(text: string) {
  setToastMsg(text)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setToastMsg(""), 2600)
}

export const store = {
  sessions,
  current,
  messages,
  busy,
  failed,
  permissions,
  questions,
  providers,
  model,
  autoApprove,
  error,
  toast: toastMsg,
  agents,
  agent,
  todos,
  commands,
  theme,
  view,
  leftFold,
  rightFold,
  module,
  drafts,
  queue,
  favorites,
  config,
  profile,
  thread,
  setModel,
  setAutoApprove,
  setAgent,
  setTheme,
  setView,
  toggleLeft,
  toggleRight,
  setModule,
  setDraft,
  setFavorites,
  unqueue,
  dequeue,
  open: openSession,
  newSession,
  send,
  command,
  enhance,
  compact,
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
  refresh: bootstrap,
  reload: bootstrap,
  statusOf,
  costOf,
  notify,
}

// ---------- 选择/持久化 ----------

function setModel(next?: ModelRef, sessionScoped = true) {
  setModelRaw(next)
  persist("model", next ?? null)
  if (sessionScoped && current()) {
    savedModels[current()] = next!
    persist("sessionModels", savedModels)
  }
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

function setView(v: View) {
  setViewRaw(v)
}

function toggleLeft() {
  setLeftFoldRaw((f) => {
    persist("leftFold", !f)
    return !f
  })
}

function toggleRight() {
  setRightFoldRaw((f) => {
    persist("rightFold", !f)
    return !f
  })
}

function setModule(m: Module) {
  setModuleRaw(m)
  persist("module", m)
  if (m) setRightFoldPersist(false)
}

function setRightFoldPersist(v: boolean) {
  setRightFoldRaw(v)
  persist("rightFold", v)
}

function draftKey() {
  return current() || "new"
}

function setDraft(text: string) {
  setDraftsRaw((d) => {
    const next = { ...d, [draftKey()]: text }
    persist("drafts", next)
    return next
  })
}

function setFavorites(list: string[]) {
  setFavoritesRaw(list)
  persist("favModels", list)
}

function statusOf(id: string): "run" | "warn" | "err" | "" {
  if (busy().has(id)) return "run"
  if (permissions().some((p) => p.sessionID === id) || questions().some((q) => q.sessionID === id)) return "warn"
  if (failed().has(id)) return "err"
  return ""
}

function costOf(id: string) {
  return sessions().find((s) => s.id === id)?.cost ?? 0
}

// 被 revert 之后的消息不展示；服务端 messages API 仍会返回全量
function thread(id: string): Msg[] {
  const list = messages()[id] ?? []
  const rev = sessions().find((s) => s.id === id)?.revert
  if (!rev) return list
  return list.filter((m) => m.info.id < rev.messageID)
}

// ---------- 事件流 ----------

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
      const id = p.properties.sessionID
      setBusy((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      void refreshSessions()
      flushQueue(id)
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
      setPermissions((list) => [...list, req as Pending])
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
      setError(typeof data?.message === "string" ? data.message : "对话出错")
      const id = props.sessionID ?? ""
      setBusy((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      if (id) setFailed((s) => new Set(s).add(id))
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

// ---------- 会话 ----------

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
    [id]: res.data ?? [],
  }))
}

async function loadTodos(id: string) {
  const c = client()
  if (!c) return
  const res = await c.session.todo({ sessionID: id, directory: directory() }).catch(() => undefined)
  if (res) setTodos((all) => ({ ...all, [id]: res.data ?? [] }))
}

async function openSession(id: string) {
  setView("chat")
  setCurrent(id)
  setError("")
  setFailed((s) => {
    const next = new Set(s)
    next.delete(id)
    return next
  })
  const m = savedModels[id]
  if (m) setModelRaw(m)
  await Promise.all([loadMessages(id), loadTodos(id)])
}

async function newSession() {
  setView("chat")
  setCurrent("")
  setError("")
  const g = savedModels["*"]
  setModelRaw(g)
}

async function send(text: string, files: FilePartInput[] = []) {
  const c = client()
  if (!c || (!text.trim() && !files.length)) return
  const id = current() || (await createSession(text))
  if (busy().has(id)) {
    setQueue((q) => ({ ...q, [id]: [...(q[id] ?? []), { text, files }] }))
    notify("运行中：已排队，回合结束后自动发送")
    return
  }
  await prompt(id, text, files)
}

async function createSession(text: string) {
  const c = client()!
  const created = await c.session.create({ title: text.slice(0, 60), directory: directory() })
  const id = created.data!.id
  setCurrent(id)
  setSessions((list) => [created.data!, ...list])
  setMessages((m) => ({ ...m, [id]: [] }))
  return id
}

async function prompt(id: string, text: string, files: FilePartInput[]) {
  const c = client()!
  setBusy((s) => new Set(s).add(id))
  const m = model()
  const a = agent()
  await c.session
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
      setFailed((s) => new Set(s).add(id))
    })
  await refreshSessions()
}

function flushQueue(id: string) {
  const list = queue()[id]
  if (!list?.length) return
  const [first, ...rest] = list
  setQueue((q) => ({ ...q, [id]: rest }))
  void prompt(id, first.text, first.files)
}

function dequeue(id: string, index: number) {
  setQueue((q) => ({ ...q, [id]: (q[id] ?? []).filter((_, i) => i !== index) }))
}

function unqueue(id: string, index: number): Queued | undefined {
  const item = queue()[id]?.[index]
  if (item) {
    dequeue(id, index)
  }
  return item
}

// 斜杠命令：走后端 /command（自定义命令带参数）
async function command(name: string, args: string) {
  const c = client()
  const id = current()
  if (!c || !id) return false
  setBusy((s) => new Set(s).add(id))
  const m = model()
  await c.session
    .command({
      sessionID: id,
      directory: directory(),
      command: name,
      arguments: args,
      ...(m ? { model: `${m.providerID}/${m.modelID}`, ...(m.variant ? { variant: m.variant } : {}) } : {}),
      ...(agent() ? { agent: agent() } : {}),
    })
    .catch((e: Error) => {
      setError(e.message)
      setBusy((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    })
  return true
}

async function enhance(text: string): Promise<string> {
  const c = client()
  if (!c) return text
  const res = await c.enhancePrompt
    .enhance({ directory: directory(), text })
    .catch((e: Error) => (notify(`增强失败：${e.message}`), undefined))
  return res?.data?.text ?? text
}

async function compact() {
  const c = client()
  const id = current()
  if (!c || !id) return
  await command("compact", "")
  notify("已插入压缩分割线，后续对话基于摘要继续")
}

// 重发上一轮：revert 到该用户消息再带新内容重发
async function retry(messageID: string, text: string, files: FilePartInput[]) {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.revert({ sessionID: id, messageID, directory: directory() }).catch((e: Error) => setError(e.message))
  await prompt(id, text, files)
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
    notify("分享链接已复制到剪贴板")
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

// ---------- 引导加载 ----------

async function bootstrap() {
  const c = client()
  if (!c) return
  await Promise.all([refreshSessions(), loadProviders(), loadCommands(), loadConfig(), loadProfile()])
  const ag = await c.v2.agent.list({ location: { directory: directory() } }).catch(() => undefined)
  setAgents((ag?.data?.data ?? []).filter((a) => a.mode !== "subagent" && !a.hidden))
}

async function loadProviders() {
  const c = client()
  if (!c) return
  const res = await c.provider.list({ directory: directory() })
  setProviders({ all: res.data?.all ?? [], connected: res.data?.connected ?? [] })
  const cfg = await c.config.providers({ directory: directory() })
  const def = cfg.data?.default
  const hit = (res.data?.connected ?? []).find((x) => def?.[x])
  const m = hit ? def?.[hit] : undefined
  if (hit && m && !model()) setModelRaw({ providerID: hit, modelID: m })
}

async function loadCommands() {
  const c = client()
  if (!c) return
  const res = await c.command.list({ directory: directory() }).catch(() => undefined)
  setCommands(res?.data ?? [])
}

async function loadConfig() {
  const c = client()
  if (!c) return
  const res = await c.config.get({ directory: directory() }).catch(() => undefined)
  setConfig(res?.data ?? {})
}

async function loadProfile() {
  const c = client()
  if (!c) return
  const res = await c.kilo.profile({ directory: directory() }).catch(() => undefined)
  const d = res?.data
  if (!d) {
    setProfile({ loggedIn: false })
    return
  }
  setProfile({
    loggedIn: true,
    email: d.profile.email,
    name: d.profile.name,
    balance: d.balance?.balance,
    tier: d.kiloPass ? "Pro" : undefined,
    orgs: d.profile.organizations,
  })
}

export async function saveConfig(patch: Config) {
  const c = client()
  if (!c) return false
  const ok = await c.config.update({ directory: directory(), config: patch }).then(
    () => true,
    () => false,
  )
  if (ok) {
    setConfig((cur) => ({ ...cur, ...patch }))
    notify("已保存到 kilo.json")
  }
  return ok
}
