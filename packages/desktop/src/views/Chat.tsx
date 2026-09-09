import { createSignal, For, Show } from "solid-js"
import type { FilePartInput, Part } from "@kilocode/sdk/v2/types"
import logo from "../assets/logo.png"
import { store, type Msg, type Question } from "../store"
import { ago, md } from "../util"

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
            <Input draft={draft} setDraft={setDraft} submit={submit} staged={staged} setStaged={setStaged} add={add} />
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
        <div class="topbar">
          <b class="title" onClick={() => setRenaming(true)}>
            {session()?.title || "新对话"}
          </b>
          <span class="grow" />
          <Show when={connected().length === 0}>
            <button class="warn" onClick={() => store.setPage("providers")}>未连接服务商</button>
          </Show>
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
        </div>
        <TodoPanel />
        <div class="stream">
          <For each={msgs()}>{(m) => <Message msg={m} edit={edit} retry={retry} />}</For>
          <Show when={store.busy().has(store.current())}>
            <div class="typing">Kilo 正在工作…</div>
          </Show>
          <Show when={store.error()}>
            <div class="err">{store.error()}</div>
          </Show>
        </div>
        <Show when={pending()} keyed>
          {(p) => (
            <div class="modal">
              <div class="ask">
                <b>请求批准：{p.permission}</b>
                <code>{p.patterns.slice(0, 6).join("\n")}</code>
                <div class="row">
                  <button onClick={() => void store.replyPermission(p.id, "reject")}>拒绝</button>
                  <button onClick={() => void store.replyPermission(p.id, "always")}>总是允许</button>
                  <button class="primary" onClick={() => void store.replyPermission(p.id, "once")}>
                    本次允许
                  </button>
                </div>
              </div>
            </div>
          )}
        </Show>
        <Show when={question()} keyed>{(q) => <QuestionCard q={q} />}</Show>
        <Show when={renaming() && session()}>
          <Rename title={session()!.title} onClose={() => setRenaming(false)} />
        </Show>
        <Show when={diff()}>
          <DiffModal onClose={() => setDiff(false)} />
        </Show>
        <Input draft={draft} setDraft={setDraft} submit={submit} staged={staged} setStaged={setStaged} add={add} />
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
    <div class="modal">
      <div class="ask wide">
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
}) {
  return (
    <div class="input">
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
        placeholder="让 Kilo 做什么…（Enter 发送，Shift+Enter 换行，可粘贴图片/文件）"
        value={props.draft()}
        onInput={(e) => props.setDraft(e.currentTarget.value)}
        onPaste={(e) => {
          const files = e.clipboardData?.files
          if (!files || !files.length) return
          e.preventDefault()
          for (const f of files) void props.add(f)
        }}
        onKeyDown={(e) => {
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
          📎
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
      {props.part.type === "tool" && (
        <div classList={{ tool: true, [props.part.state.status]: true }}>
          <span class="name">{props.part.tool}</span>
          <span class="tstate">{"title" in props.part.state ? (props.part.state.title ?? props.part.state.status) : props.part.state.status}</span>
          {props.part.state.status === "error" && <pre class="terr">{props.part.state.error}</pre>}
        </div>
      )}
    </>
  )
}
