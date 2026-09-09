import { createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import type { Session } from "@kilocode/sdk/v2/types"
import logo from "./assets/logo.png"
import { client, directory, recents, setDirectory } from "./client"
import { store } from "./store"
import { ago } from "./util"
import { Chat } from "./views/Chat"
import { Files } from "./views/Files"
import { Plugins } from "./views/Plugins"
import { Providers } from "./views/Providers"
import { Settings } from "./views/Settings"

const [search, setSearch] = createSignal("")
const [fold, setFold] = createSignal<Record<string, boolean>>({})
const open = (id: string) => !fold()[id]
const toggle = (id: string) => setFold((f) => ({ ...f, [id]: !f[id] }))

async function chooseFolder() {
  const dir = await invoke<string | null>("pick_dir")
  if (dir) await use(dir)
}

async function use(dir: string) {
  store.setPage("chat")
  if (dir === directory()) return
  setDirectory(dir)
  await store.refresh()
  await store.newSession()
}

const nameOf = (dir: string) => dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir

function groups() {
  const at = (s: Session) => s.time.updated ?? s.time.created
  const rows = store
    .sessions()
    .filter((s) => (s.title ?? "").toLowerCase().includes(search().toLowerCase()))
    .map((s) => ({ s, t: at(s) }))
  const now = Date.now()
  const day = 86_400_000
  const same = (t: number) => new Date(t).toDateString() === new Date(now).toDateString()
  const yest = (t: number) => new Date(t).toDateString() === new Date(now - day).toDateString()
  const buckets: { label: string; list: typeof rows }[] = []
  const add = (label: string, pred: (t: number) => boolean) => {
    const list = rows.filter((x) => pred(x.t))
    if (list.length) buckets.push({ label, list })
  }
  add("今天", same)
  add("昨天", yest)
  add("本周", (t) => !same(t) && !yest(t) && now - t < 7 * day)
  add("更早", (t) => !same(t) && !yest(t) && now - t >= 7 * day)
  return buckets
}

export function App() {
  return (
    <div class="shell">
      <aside class="side">
        <img class="brand" src={logo} alt="Kilo" />
        <button
          class="side-item"
          onClick={() => {
            store.setPage("chat")
            void store.newSession()
          }}
        >
          ＋ 新对话
        </button>
        <input class="search" placeholder="搜索会话…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        <button class="side-item" classList={{ on: store.page() === "plugins" }} onClick={() => store.setPage("plugins")}>
          插件
        </button>
        <button class="side-item" classList={{ on: store.page() === "files" }} onClick={() => store.setPage("files")}>
          素材库
        </button>
        <button class="side-item" classList={{ on: store.page() === "providers" }} onClick={() => store.setPage("providers")}>
          服务商
        </button>
        <div class="sect">
          <button class="label" onClick={() => toggle("project")}>
            {open("project") ? "▾" : "▸"} 项目
          </button>
          <Show when={open("project")}>
            <button class="side-item" onClick={chooseFolder}>＋ 新建项目</button>
            <For each={recents()}>
              {(r) => (
                <button class="side-item dir" classList={{ on: r === directory() }} onClick={() => use(r)} title={r}>
                  {nameOf(r)}
                </button>
              )}
            </For>
            <Show when={!directory() && !recents().length}>
              <div class="hint pad">选择项目文件夹开始</div>
            </Show>
          </Show>
        </div>
        <div class="sect">
          <button class="label" onClick={() => toggle("agent")}>
            {open("agent") ? "▾" : "▸"} 助理
          </button>
          <Show when={open("agent")}>
            <For each={store.agents()}>
              {(a) => (
                <div class="session" classList={{ on: store.agent() === a.id }}>
                  <button title={a.description ?? ""} onClick={() => store.setAgent(store.agent() === a.id ? "" : a.id)}>
                    {a.id}
                  </button>
                  <button class="del" title="编辑" onClick={() => setEditing({ name: a.id })}>
                    ✎
                  </button>
                </div>
              )}
            </For>
            <button class="side-item" onClick={() => setEditing({ name: "" })}>＋ 新建助理</button>
          </Show>
        </div>
        <div class="label">会话</div>
        <div class="sessions">
          <For each={groups()}>
            {(g) => (
              <>
                <div class="group">{g.label}</div>
                <For each={g.list}>
                  {(x) => (
                    <div class="session" classList={{ on: store.page() === "chat" && store.current() === x.s.id }}>
                      <button
                        onClick={() => {
                          store.setPage("chat")
                          void store.open(x.s.id)
                        }}
                      >
                        {x.s.title || "未命名"}
                      </button>
                      <span class="when">{ago(x.t)}</span>
                      <button class="del" title="删除" onClick={() => void store.removeSession(x.s.id)}>
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
        <button class="side-item" classList={{ on: store.page() === "settings" }} onClick={() => store.setPage("settings")}>
          ⚙ 设置
        </button>
      </aside>
      <main>
        <Show when={store.page() === "chat"}>
          <Chat />
        </Show>
        <Show when={store.page() === "plugins"}>
          <Plugins />
        </Show>
        <Show when={store.page() === "files"}>
          <Files />
        </Show>
        <Show when={store.page() === "providers"}>
          <Providers />
        </Show>
        <Show when={store.page() === "settings"}>
          <Settings />
        </Show>
      </main>
      <Show when={editing()} keyed>
        {(e) => <AgentEdit name={e.name} onClose={() => setEditing(undefined)} />}
      </Show>
      <Show when={store.toast()}>
        <div class="toast">{store.toast()}</div>
      </Show>
    </div>
  )
}

const [editing, setEditing] = createSignal<{ name: string }>()

function AgentEdit(props: { name: string; onClose: () => void }) {
  const [handle, setHandle] = createSignal(props.name)
  const [desc, setDesc] = createSignal("")
  const [body, setBody] = createSignal("")
  const [err, setErr] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  if (props.name) {
    void loadAgent(props.name).then((a) => {
      setDesc(a.desc)
      setBody(a.body)
    })
  }

  async function save() {
    const id = handle().trim()
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
      setErr("名称仅支持字母数字与 -_.")
      return
    }
    if (!directory()) {
      setErr("请先在左侧选择项目文件夹")
      return
    }
    setBusy(true)
    const e = await invoke("write_agent", { dir: directory(), name: id, desc: desc(), body: body() }).catch((x: unknown) => {
      setErr(x instanceof Error ? x.message : String(x))
    })
    setBusy(false)
    if (e) return
    props.onClose()
    await store.refresh()
    store.notify(`助理「${id}」已保存到 .kilo/agent`)
  }

  return (
    <div class="modal" onClick={(x) => x.target === x.currentTarget && props.onClose()}>
      <div class="panel">
        <b>{props.name ? `编辑助理 ${props.name}` : "新建助理"}</b>
        <Show when={!props.name}>
          <input placeholder="英文标识（同名覆盖）" value={handle()} onInput={(e) => setHandle(e.currentTarget.value)} />
        </Show>
        <input placeholder="一句话描述" value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} />
        <textarea rows={8} placeholder="系统提示词（行为、约束、风格）" value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
        <Show when={err()}>
          <div class="err">{err()}</div>
        </Show>
        <div class="row">
          <button onClick={props.onClose}>取消</button>
          <button class="primary" disabled={busy()} onClick={save}>
            保存到 .kilo/agent
          </button>
        </div>
      </div>
    </div>
  )
}

async function loadAgent(name: string) {
  const c = client()
  if (!c) return { desc: "", body: "" }
  const res = await c.v2.fs
    .read({ location: { directory: directory() }, path: `.kilo/agent/${name}.md` })
    .catch(() => undefined)
  const raw = res?.data instanceof Blob ? await res.data.text() : ""
  const fm = raw.match(/^---\n([\s\S]*?)\n---/)
  return {
    desc: fm?.[1]?.match(/description:\s*(.+)/)?.[1]?.trim() ?? "",
    body: fm ? raw.slice(fm[0].length + 1) : raw,
  }
}
