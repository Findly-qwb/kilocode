import type { Agent, Message, Part, Provider, QuestionInfo, Session } from "@kilocode/sdk/v2/types"
import { createSignal, batch } from "solid-js"
import { client, directory, onEvent } from "./client"

export type Msg = { info: Message; parts: Part[] }
export type Pending = { id: string; sessionID: string; permission: string; patterns: string[]; always: string[] }
export type Question = { id: string; sessionID: string; questions: QuestionInfo[] }

const [sessions, setSessions] = createSignal<Session[]>([])
const [current, setCurrent] = createSignal("")
const [messages, setMessages] = createSignal<Record<string, Msg[]>>({})
const [busy, setBusy] = createSignal(new Set<string>())
const [permissions, setPermissions] = createSignal<Pending[]>([])
const [questions, setQuestions] = createSignal<Question[]>([])
const [providers, setProviders] = createSignal<{ all: Provider[]; connected: string[] }>({ all: [], connected: [] })
const [model, setModel] = createSignal<{ providerID: string; modelID: string }>()
const [autoApprove, setAutoApprove] = createSignal(false)
const [error, setError] = createSignal("")
const [agents, setAgents] = createSignal<Agent[]>([])
const [agent, setAgent] = createSignal("")

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
  agents,
  agent,
  setModel,
  setAutoApprove,
  setAgent,
  open: openSession,
  newSession,
  send,
  abort,
  replyPermission,
  replyQuestion,
  removeSession,
  refresh,
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
      const props = p.properties as { sessionID?: string; error?: { data?: { message?: string } } }
      setError(props.error?.data?.message ?? "会话出错")
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
  setSessions((res.data ?? []).filter((s) => !s.parentID))}

async function loadMessages(id: string) {
  const c = client()
  if (!c) return
  const res = await c.session.messages({ sessionID: id, directory: directory() })
  setMessages((m) => ({
    ...m,
    [id]: (res.data ?? []).map((x: { info: Message; parts: Part[] }) => ({ info: x.info, parts: x.parts })),
  }))
}

async function openSession(id: string) {
  setCurrent(id)
  setError("")
  await loadMessages(id)
}

async function newSession() {
  setCurrent("")
  setMessages((m) => ({ ...m }))
  setError("")
}

async function send(text: string) {
  const c = client()
  if (!c || !text.trim()) return
  setError("")
  let id = current()
  if (!id) {
    const created = await c.session.create({ title: text.slice(0, 60), directory: directory() })
    id = created.data!.id
    setCurrent(id)
    setSessions((list) => [created.data!, ...list])
  }
  setBusy((s) => new Set(s).add(id))
  const m = model()
  void c.session
    .prompt({
      sessionID: id,
      directory: directory(),
      parts: [{ type: "text", text }],
      ...(m ? { model: m } : {}),
    })
    .catch((e: Error) => setError(e.message))
  await refreshSessions()
}

async function abort() {
  const c = client()
  const id = current()
  if (!c || !id) return
  await c.session.abort({ sessionID: id, directory: directory() }).catch(() => {})
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
  if (hit && !model()) setModel({ providerID: hit, modelID: def![hit] })
}
