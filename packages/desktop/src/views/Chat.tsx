import { createSignal, For, Show } from "solid-js"
import type { Part } from "@kilocode/sdk/v2/types"
import logo from "../assets/logo.png"
import { store, type Msg } from "../store"
import { ago, md } from "../util"

const textOf = (parts: Part[]) => parts.flatMap((p) => (p.type === "text" && !p.synthetic ? [p.text] : []))

export function Chat() {
  const [draft, setDraft] = createSignal("")
  const msgs = () => store.messages()[store.current()] ?? []
  const pending = () => store.permissions().find((p) => p.sessionID === store.current())
  const question = () => store.questions().find((q) => q.sessionID === store.current())

  function submit() {
    const t = draft().trim()
    if (!t) return
    setDraft("")
    void store.send(t)
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
            <Input draft={draft} setDraft={setDraft} submit={submit} />
            <div class="cards">
              <div class="card">
                <div>
                  <b>项目对话</b>
                  <p>打开项目文件夹，AI 帮你编码、调试和重构</p>
                </div>
                <span class="hint">← 左侧选择文件夹</span>
              </div>
              <div class="card">
                <div>
                  <b>服务商</b>
                  <p>配置 API Key 或订阅账号后开始对话</p>
                </div>
                <span class="hint">← 侧栏「服务商」</span>
              </div>
            </div>
          </div>
        }
      >
        <div class="stream">
          <For each={msgs()}>{(m) => <Message msg={m} />}</For>
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
        <Show when={question()} keyed>
          {(q) => (
            <div class="modal">
              <div class="ask">
                <For each={q.questions}>
                  {(one) => (
                    <>
                      <b>{one.question}</b>
                      <div class="row">
                        <For each={one.options}>
                          {(o) => (
                            <button class="primary" onClick={() => void store.replyQuestion(q.id, [[o.label]])}>
                              {o.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>
        <Input draft={draft} setDraft={setDraft} submit={submit} />
      </Show>
    </div>
  )
}

function Input(props: { draft: () => string; setDraft: (v: string) => void; submit: () => void }) {
  return (
    <div class="input">
      <textarea
        rows={2}
        placeholder="让 Kilo 做什么…"
        value={props.draft()}
        onInput={(e) => props.setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            props.submit()
          }
        }}
      />
      <div class="bar">
        <ModelPicker />
        <label class="auto">
          <input type="checkbox" checked={store.autoApprove()} onChange={(e) => store.setAutoApprove(e.currentTarget.checked)} />
          自动批准
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
          <button class="send" onClick={props.submit} disabled={!props.draft().trim()}>
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
        store.setModel({ providerID, modelID: rest.join("/") })
      }}
    >
      <option value="">默认模型</option>
      <For each={connected()}>
        {(p) => (
          <optgroup label={p.name}>
            <For each={Object.values(p.models).slice(0, 40)}>
              {(m) => <option value={`${p.id}/${m.id}`}>{m.name}</option>}
            </For>
          </optgroup>
        )}
      </For>
    </select>
  )
}

function Message(props: { msg: Msg }) {
  const isUser = () => props.msg.info.role === "user"
  return (
    <div classList={{ msg: true, user: isUser() }}>
      <Show when={isUser()}>
        <div class="bubble user-bubble" innerHTML={md(textOf(props.msg.parts).join("\n"))} />
      </Show>
      <Show when={!isUser()}>
        <div class="assistant">
          <For each={props.msg.parts}>{(p) => <PartView part={p} />}</For>
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
