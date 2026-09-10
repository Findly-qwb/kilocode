import { createSignal, For, onMount, Show } from "solid-js"
import type { FilePartInput, Part } from "@kilocode/sdk/v2/types"
import logo from "../assets/logo.png"
import { client, directory } from "../client"
import { store, type Msg, type Question } from "../store"
import { ago, md } from "../util"
import { GitPanel } from "./Git"
import { Terminal } from "./Terminal"

type Entry = { name: string; mime: string; url: string }

const textOf = (parts: Part[]) => parts.flatMap((p) => (p.type === "text" && !p.synthetic ? [p.text] : []))
const filesOf = (parts: Part[]) => parts.filter((p): p is Extract<Part, { type: "file" }> => p.type === "file")

async function toData(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${file.type || "text/plain"};base64,${btoa(bin)}`
}

export function Chat() {
  const [draft, setDraft] = createSignal("")
  const [staged, setStaged] = createSignal<Entry[]>([])
  const [renaming, setRenaming] = createSignal(false)
  const [diff, setDiff] = createSignal(false)
  const [git, setGit] = createSignal(false)
  const [term, setTerm] = createSignal(false)
  const [vcs, setVcs] = createSignal<{ branch?: string; dirty: number }>({ dirty: 0 })

  async function vcsRefresh() {
    const c = client()
    if (!c || !directory()) return
    const [i, d] = await Promise.all([
      c.vcs.get({ directory: directory() }).catch(() => undefined),
      c.vcs.diff({ directory: directory(), mode: "git" }).catch(() => undefined),
    ])
    setVcs({ branch: i?.data?.branch, dirty: (d?.data ?? []).length })
  }

  onMount(() => void vcsRefresh())
  const msgs = () => store.thread(store.current())
  const session = () => store.sessions().find((s) => s.id === store.current())
  const pending = () => store.permissions().find((p) => p.sessionID === store.current())
  const question = () => store.questions().find((q) => q.sessionID === store.current())
  const connected = () => store.providers().connected

  async function add(file: File) {
    if (file.size > 6_000_000) {
      store.notify(`文件过大（>6MB）：${file.name}`)
      return
    }
    const url = await toData(file).catch(() => "")
    if (!url) {
      store.notify(`读取失败：${file.name}`)
      return
    }
    setStaged((list) => [...list, { name: file.name, mime: file.type || "text/plain", url }])
  }

  function submit() {
    const t = draft().trim()
    const files: FilePartInput[] = staged().map((f) => ({ type: "file", mime: f.mime, filename: f.name, url: f.url }))
    if (!t && !files.length) return
    setDraft("")
    setStaged([])
    void store.send(t, files)
  }

  const MIME: Record<string, string> = {
    md: "text/markdown",
    ts: "text/typescript",
    tsx: "text/typescript",
    js: "text/javascript",
    jsx: "text/javascript",
    json: "application/json",
    py: "text/x-python",
    rs: "text/rust",
    go: "text/go",
    css: "text/css",
    html: "text/html",
    yml: "text/yaml",
    yaml: "text/yaml",
    sh: "text/x-sh",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
  }

  function addRef(path: string) {
    const name = path.split("/").at(-1) ?? path
    const mime = MIME[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "text/plain"
    setStaged((list) => [...list, { name, mime, url: `file://${path}` }])
  }

  async function edit(m: Msg) {
    if (store.busy().has(store.current())) return
    const t = textOf(m.parts).join("\n")
    await store.revertTo(m.info.id)
    setDraft(t)
  }

  async function retry(m: Msg) {
    if (store.busy().has(store.current())) return
    await store.retry(m.info.id, textOf(m.parts).join("\n"), [])
  }

  return (
    <div class="chat">
      <div class="topbar">
        <b class="title">{session()?.title || "New Chat"}</b>
        <span class="grow" />
        <Show when={connected().length === 0}>
          <button class="warn" onClick={() => store.setPage("providers")}>未连接服务商</button>
        </Show>
        <Show when={store.current()}>
          <Show when={session()?.revert}>
            <button title="恢复被回退的消息" onClick={() => void store.unrevert()}>↩ 恢复</button>
          </Show>
          <button title="重命名" onClick={() => setRenaming(true)}>✎</button>
          <button title="创建副本" onClick={() => void store.fork()}>⑂</button>
          <Show
            when={!session()?.share}
            fallback={
              <button title="取消分享" onClick={() => void store.unshare()}>
                ⊘
              </button>
            }
          >
            <button title="分享会话（复制链接）" onClick={() => void store.share()}>
              ↗
            </button>
          </Show>
          <button title="查看文件变更" onClick={() => setDiff(true)}>
            Δ {session()?.summary?.files ?? 0}
          </button>
        </Show>
        <button title="Git 面板" class="branch" onClick={() => setGit(true)}>
          ⑂ {vcs()?.branch ?? "Git"}
          <Show when={vcs().dirty}>
            <em class="dirt">{vcs().dirty}</em>
          </Show>
        </button>
        <Show when={!term()} fallback={<button title="收起终端" onClick={() => setTerm(false)}>▾ 终端</button>}>
          <button title="终端" onClick={() => setTerm(true)}>
            ▴ 终端
          </button>
        </Show>
      </div>
      <Show
        when={store.current() || msgs().length}
        fallback={
          <div class="home">
            <div class="greet">
              <img src={logo} alt="" />
              <h1>你好，想做点什么？</h1>
            </div>
            <Show when={!connected().length}>
              <div class="hintbar center">
                配置 API 服务商以开始对话
                <button class="primary" onClick={() => store.setPage("providers")}>
                  打开设置
                </button>
              </div>
            </Show>
            <Input draft={draft} setDraft={setDraft} submit={submit} staged={staged} setStaged={setStaged} add={add} addRef={addRef} />
            <div class="cards">
              <div class="card">
                <div>
                  <b>项目对话</b>
                  <p>打开项目文件夹，AI 帮你编码、调试和重构</p>
                </div>
                <span class="hint">← 左侧「项目」</span>
              </div>
              <div class="card">
                <div>
                  <b>助理</b>
                  <p>选择或新建专属助理，定制行为与提示词</p>
                </div>
                <span class="hint">← 左侧「助理」</span>
              </div>
            </div>
          </div>
        }
      >
        <TodoPanel />
        <div class="stream">
          <For each={msgs()}>{(m) => <Message msg={m} edit={edit} retry={retry} />}</For>
          <Show when={pending()} keyed>
            {(p) => (
              <div class="ask-inline">
                <b>{p.permission}</b>
                <code class="tinp">{p.patterns.slice(0, 8).join("\n")}</code>
                <div class="row">
                  <button onClick={() => void store.replyPermission(p.id, "reject")}>Deny</button>
                  <button onClick={() => void store.replyPermission(p.id, "always")}>Always allow</button>
                  <button class="primary" onClick={() => void store.replyPermission(p.id, "once")}>
                    Allow Once
                  </button>
                </div>
              </div>
            )}
          </Show>
          <Show when={question()} keyed>{(q) => <QuestionCard q={q} />}</Show>
          <Show when={store.busy().has(store.current())}>
            <div class="typing">Kilo 正在工作…</div>
          </Show>
          <Show when={store.error()}>
            <div class="err">{store.error()}</div>
          </Show>
        </div>
        <Show when={renaming() && session()}>
          <Rename title={session()!.title} onClose={() => setRenaming(false)} />
        </Show>
        <Show when={diff()}>
          <DiffModal onClose={() => setDiff(false)} />
        </Show>
        <Show when={git()}>
          <GitPanel
            onClose={() => {
              setGit(false)
              void vcsRefresh()
            }}
          />
        </Show>
        <Input draft={draft} setDraft={setDraft} submit={submit} staged={staged} setStaged={setStaged} add={add} addRef={addRef} />
        <Show when={term()}>
          <Terminal onClose={() => setTerm(false)} />
        </Show>
      </Show>
    </div>
  )
}

function Rename(props: { title: string; onClose: () => void }) {
  const [val, setVal] = createSignal(props.title)
  return (
    <div class="modal" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel">
        <b>重命名会话</b>
        <input value={val()} autofocus onInput={(e) => setVal(e.currentTarget.value)} />
        <div class="row">
          <button onClick={props.onClose}>取消</button>
          <button
            class="primary"
            disabled={!val().trim()}
            onClick={() => {
              void store.rename(store.current(), val())
              props.onClose()
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function DiffModal(props: { onClose: () => void }) {
  const [files, setFiles] = createSignal<Awaited<ReturnType<typeof store.diff>>>()
  void store.diff().then(setFiles)
  return (
    <div class="modal" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide">
        <b>变更文件（{files()?.length ?? "…"}）</b>
        <div class="difflist">
          <For each={files() ?? []}>
            {(f) => (
              <details class="diff">
                <summary>
                  <code>{f.file}</code>
                  <span class="add">+{f.additions}</span> <span class="del">-{f.deletions}</span>
                  <Show when={f.status}>
                    <em>{f.status}</em>
                  </Show>
                </summary>
                <pre>{f.patch ?? ""}</pre>
              </details>
            )}
          </For>
          <Show when={files() && !files()!.length}>
            <p class="empty">该会话暂无文件变更</p>
          </Show>
        </div>
        <div class="row">
          <button onClick={props.onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

function TodoPanel() {
  const list = () => store.todos()[store.current()] ?? []
  const icon = (s: string) => (s === "completed" ? "✓" : s === "in_progress" ? "▶" : s === "cancelled" ? "⊘" : "○")
  return (
    <Show when={list().length}>
      <details class="todo" open>
        <summary>
          任务 {list().filter((t) => t.status === "completed").length}/{list().length}
        </summary>
        <For each={list()}>
          {(t) => (
            <div classList={{ trow: true, done: t.status === "completed", doing: t.status === "in_progress" }}>
              <span>{icon(t.status)}</span>
              {t.content}
            </div>
          )}
        </For>
      </details>
    </Show>
  )
}

function QuestionCard(props: { q: Question }) {
  const [picked, setPicked] = createSignal(props.q.questions.map((): string[] => []))
  const [free, setFree] = createSignal(props.q.questions.map(() => ""))

  function pick(i: number, label: string, multi?: boolean) {
    setPicked((cur) => {
      const next = cur.map((x) => x.slice())
      const row = next[i]
      if (!multi) {
        next[i] = row[0] === label ? [] : [label]
        return next
      }
      const at = row.indexOf(label)
      if (at === -1) row.push(label)
      else row.splice(at, 1)
      return next
    })
  }

  const ready = () =>
    props.q.questions.some((_, i) => (picked()[i]?.length ?? 0) > 0 || (free()[i] ?? "").trim().length > 0)

  function done() {
    const answers = props.q.questions.map((_, i) => {
      const txt = (free()[i] ?? "").trim()
      return txt ? [...(picked()[i] ?? []), txt] : (picked()[i] ?? [])
    })
    void store.replyQuestion(props.q.id, answers)
  }

  return (
    <div class="ask-inline">
      <For each={props.q.questions}>
          {(one, i) => (
            <>
              <b>{one.question}</b>
              <div class="opts">
                <For each={one.options ?? []}>
                  {(o) => (
                    <button
                      class="opt"
                      classList={{ on: picked()[i()]?.includes(o.label) }}
                      onClick={() => pick(i(), o.label, one.multiple)}
                    >
                      {one.multiple ? (picked()[i()]?.includes(o.label) ? "☑" : "☐") : "◉"} {o.label}
                      <Show when={o.description}>
                        <small>{o.description}</small>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
              <input
                placeholder="回复补充或直接输入答案…"
                value={free()[i()]}
                onInput={(e) => setFree((cur) => cur.map((x, j) => (j === i() ? e.currentTarget.value : x)))}
              />
            </>
          )}
        </For>
      <div class="row">
        <button onClick={() => void store.rejectQuestion(props.q.id)}>拒答</button>
        <button class="primary" disabled={!ready()} onClick={done}>
          提交
        </button>
      </div>
    </div>
  )
}

function Input(props: {
  draft: () => string
  setDraft: (v: string) => void
  submit: () => void
  staged: () => Entry[]
  setStaged: (fn: (list: Entry[]) => Entry[]) => void
  add: (file: File) => Promise<void>
  addRef: (path: string) => void
}) {
  const [mention, setMention] = createSignal<{ q: string; at: number } | null>(null)
  const [hits, setHits] = createSignal<string[]>([])
  const [pick, setPick] = createSignal(0)
  let timer: ReturnType<typeof setTimeout>

  function scan(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    const m = /(?:^|\s)@([^\s@]*)$/.exec(before)
    if (!m || !directory()) {
      setMention(null)
      return
    }
    setMention({ q: m[1], at: before.lastIndexOf("@") })
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const res = await client()
        ?.v2.fs.find({ location: { directory: directory() }, query: m[1], type: "file", limit: "12" })
        .catch(() => undefined)
      setHits((res?.data?.data ?? []).map((x) => x.path))
      setPick(0)
    }, 150)
  }

  function choose(path: string) {
    const me = mention()
    if (!me) return
    const v = props.draft()
    props.setDraft(v.slice(0, me.at) + v.slice(me.at + me.q.length + 1))
    props.addRef(path)
    setMention(null)
  }

  return (
    <div class="input">
      <Show when={mention() && hits().length}>
        <div class="mention">
          <For each={hits()}>
            {(h, i) => (
              <button classList={{ on: i() === pick() }} onMouseEnter={() => setPick(i())} onClick={() => choose(h)}>
                {h.split("/").slice(-2).join("/")}
                <small>{h}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.staged().length}>
        <div class="chips">
          <For each={props.staged()}>
            {(f, i) => (
              <span class="chip">
                {f.name}
                <button onClick={() => props.setStaged((list) => list.filter((_, j) => j !== i()))}>×</button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <textarea
        rows={2}
        placeholder="让 Kilo 做什么…（Enter 发送，Shift+Enter 换行，@ 引用文件，可粘贴图片/文件）"
        value={props.draft()}
        onInput={(e) => {
          props.setDraft(e.currentTarget.value)
          scan(e.currentTarget)
        }}
        onPaste={(e) => {
          const files = e.clipboardData?.files
          if (!files || !files.length) return
          e.preventDefault()
          for (const f of files) void props.add(f)
        }}
        onKeyDown={(e) => {
          if (mention()) {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setPick((p) => (p + 1) % hits().length)
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setPick((p) => (p - 1 + hits().length) % hits().length)
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              const h = hits().at(pick())
              if (h) choose(h)
              return
            }
            if (e.key === "Escape") {
              setMention(null)
              return
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            props.submit()
          }
        }}
      />
      <div class="bar">
        <ModelPicker />
        <VariantPicker />
        <AgentPicker />
        <select
          value={store.autoApprove() ? "auto" : "ask"}
          onChange={(e) => store.setAutoApprove(e.currentTarget.value === "auto")}
        >
          <option value="ask">请求批准</option>
          <option value="auto">自动批准</option>
        </select>
        <label class="clip" title="添加文件/图片">
          <span>📎</span>
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              for (const f of e.currentTarget.files ?? []) void props.add(f)
              e.currentTarget.value = ""
            }}
          />
        </label>
        <span class="grow" />
        <Usage />
        <Show
          when={!store.busy().has(store.current())}
          fallback={
            <button class="stop" onClick={() => void store.abort()} title="停止">
              ■
            </button>
          }
        >
          <button class="send" onClick={props.submit} disabled={!props.draft().trim() && !props.staged().length}>
            ↑
          </button>
        </Show>
      </div>
    </div>
  )
}

function Usage() {
  const n = () => {
    const list = store.thread(store.current())
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i].info
      if (info.role === "assistant") return info.tokens.input + (info.tokens.cache.read ?? 0)
    }
    return 0
  }
  return (
    <Show when={n() > 0}>
      <span class="usage">{n() >= 1000 ? `${(n() / 1000).toFixed(1)}K` : n()}</span>
    </Show>
  )
}

function ModelPicker() {
  const connected = () => store.providers().all.filter((p) => store.providers().connected.includes(p.id))
  return (
    <select
      value={store.model() ? `${store.model()!.providerID}/${store.model()!.modelID}` : ""}
      onChange={(e) => {
        const [providerID, ...rest] = e.currentTarget.value.split("/")
        store.setModel(providerID ? { providerID, modelID: rest.join("/") } : undefined)
      }}
    >
      <option value="">默认模型</option>
      <For each={connected()}>
        {(p) => (
          <optgroup label={p.name}>
            <For each={Object.values(p.models).slice(0, 40)}>
              {(m) => (
                <option value={`${p.id}/${m.id}`}>
                  {m.name} · {Math.round(m.limit.context / 1000)}k
                </option>
              )}
            </For>
          </optgroup>
        )}
      </For>
    </select>
  )
}

function VariantPicker() {
  const model = () => {
    const m = store.model()
    if (!m) return undefined
    return store.providers().all.find((p) => p.id === m.providerID)?.models[m.modelID]
  }
  const opts = () => Object.keys(model()?.variants ?? {})
  return (
    <Show when={opts().length > 1}>
      <select
        value={store.model()?.variant ?? ""}
        onChange={(e) => {
          const m = store.model()
          if (!m) return
          store.setModel({ ...m, variant: e.currentTarget.value || undefined })
        }}
      >
        <option value="">默认档</option>
        <For each={opts()}>{(v) => <option value={v}>{v}</option>}</For>
      </select>
    </Show>
  )
}

function AgentPicker() {
  return (
    <select value={store.agent()} onChange={(e) => store.setAgent(e.currentTarget.value)}>
      <option value="">默认助理</option>
      <For each={store.agents()}>{(a) => <option value={a.id}>{a.id}</option>}</For>
    </select>
  )
}

function Message(props: { msg: Msg; edit: (m: Msg) => Promise<void>; retry: (m: Msg) => Promise<void> }) {
  const isUser = () => props.msg.info.role === "user"
  const err = () => {
    const info = props.msg.info
    if (info.role !== "assistant" || !info.error) return ""
    const data: { message?: unknown } | undefined = info.error.data
    return typeof data?.message === "string" ? data.message : "模型返回错误"
  }
  return (
    <div classList={{ msg: true, user: isUser() }}>
      <Show when={isUser()}>
        <div class="umsg">
          <div class="actions">
            <button title="编辑重发" onClick={() => void props.edit(props.msg)}>
              ✎
            </button>
            <button title="从此处重试" onClick={() => void props.retry(props.msg)}>
              ↻
            </button>
          </div>
          <div class="bubble user-bubble">
            <Show when={textOf(props.msg.parts).length}>
              <div innerHTML={md(textOf(props.msg.parts).join("\n"))} />
            </Show>
            <For each={filesOf(props.msg.parts)}>{(f) => <span class="chip file">{f.filename}</span>}</For>
          </div>
        </div>
      </Show>
      <Show when={!isUser()}>
        <div class="assistant">
          <For each={props.msg.parts}>{(p) => <PartView part={p} />}</For>
          <Show when={err()}>
            <div class="err">{err()}</div>
          </Show>
          {props.msg.info.role === "assistant" && props.msg.info.time.completed && (
            <span class="cost">${(props.msg.info.cost ?? 0).toFixed(4)} · {ago(props.msg.info.time.created)}</span>
          )}
        </div>
      </Show>
    </div>
  )
}

const TOOL_ICON: Record<string, string> = {
  bash: ">_",
  shell: ">_",
  read: "≡",
  edit: "✎",
  write: "▤",
  multiedit: "✎",
  glob: "⌕",
  grep: "⌕",
  webfetch: "🌐",
  websearch: "🌐",
  task: "⧉",
  todowrite: "☑",
}

function ToolCard(props: { part: Extract<Part, { type: "tool" }> }) {
  const [open, setOpen] = createSignal(false)
  const s = () => props.part.state
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "")
  const summary = () => {
    const st = s()
    if ("title" in st && st.title) return st.title
    const i = st.input as Record<string, unknown>
    return str(i.command) || str(i.path) || str(i.filePath) || str(i.pattern) || str(i.url) || props.part.tool
  }
  const icon = () => TOOL_ICON[props.part.tool] ?? "⚙"
  const status = () => {
    const st = s()
    if (st.status === "error") return <span class="tst bad">✗</span>
    if (st.status === "completed") return <span class="tst ok">✓</span>
    return <span class="tst run">◌</span>
  }
  const inputText = () => {
    const i = s().input as Record<string, unknown>
    if (typeof i.command === "string") return `$ ${i.command}`
    return Object.entries(i)
      .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      .map(([k, v]) => `${k}: ${str(v)}`)
      .join("\n")
  }
  const output = () => {
    const st = s()
    if (st.status === "completed") return st.output ?? ""
    if (st.status === "error") return st.error
    return ""
  }
  return (
    <div class="tcard">
      <button class="trow" onClick={() => setOpen((v) => !v)} title={summary()}>
        <span class="tic">{icon()}</span>
        <span class="tcmd">{summary()}</span>
        {status()}
      </button>
      <Show when={open()}>
        <Show when={inputText()}>
          <pre class="tinp">{inputText()}</pre>
        </Show>
        <Show when={output()}>
          <pre class="tout">{output().slice(0, 20000)}</pre>
        </Show>
      </Show>
    </div>
  )
}

function PartView(props: { part: Part }) {
  return (
    <>
      {props.part.type === "text" && !props.part.synthetic && <div class="bubble md" innerHTML={md(props.part.text)} />}
      {props.part.type === "reasoning" && (
        <details class="reason">
          <summary>思考过程</summary>
          <div innerHTML={md(props.part.text)} />
        </details>
      )}
      {props.part.type === "file" && <span class="chip file">{props.part.filename}</span>}
      {props.part.type === "step-finish" && (
        <div class="step">
          {props.part.time ? `运行状态已更新。 | ${Math.round((props.part.time.end - props.part.time.start) / 1000)}s` : "运行状态已更新。"}
        </div>
      )}
      {props.part.type === "tool" && <ToolCard part={props.part} />}
    </>
  )
}
