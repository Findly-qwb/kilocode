import { createSignal, For, Show, onMount } from "solid-js"
import type { Session } from "@kilocode/sdk/v2/types"
import logo from "./assets/logo.png"
import { client, directory, info, ready, recents, setDirectory } from "./client"
import { store } from "./store"
import { vcs, vcsRefresh } from "./vcs"
import { openModal } from "./ui"
import { pickDir, winClose, winMax, winMin } from "./host"
import { ago } from "./util"
import { Chat } from "./views/Chat"
import { History } from "./views/History"
import { Profile } from "./views/Profile"
import { Settings } from "./views/Settings"
import { RightBar } from "./right/modules"
import { Modals } from "./views/Modals"

const BUILTIN = ["code", "build", "plan", "ask", "explore", "general"]

const [grpProject, setGrpProject] = createSignal(true)
const [grpAgent, setGrpAgent] = createSignal(true)
const [renaming, setRenaming] = createSignal("")
const [renameVal, setRenameVal] = createSignal("")

const nameOf = (dir: string) => dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir

async function newProject() {
  const dir = await pickDir()
  if (!dir) return
  await switchProject(dir)
  await store.newSession()
  store.notify(`新项目：${nameOf(dir)}`)
}

async function switchProject(dir: string) {
  if (dir !== directory()) {
    setDirectory(dir)
    await store.refresh()
    void vcsRefresh()
  }
  store.setView("chat")
}

function startRename(s: Session) {
  setRenaming(s.id)
  setRenameVal(s.title)
}

async function commitRename() {
  const id = renaming()
  if (id && renameVal().trim()) await store.rename(id, renameVal())
  setRenaming("")
}

function sessionGroups() {
  const at = (s: Session) => s.time.updated ?? s.time.created
  const rows = store.sessions().map((s) => ({ s, t: at(s) }))
  const now = Date.now()
  const day = 86_400_000
  const same = (x: number) => new Date(x).toDateString() === new Date(now).toDateString()
  const yest = (x: number) => new Date(x).toDateString() === new Date(now - day).toDateString()
  const buckets: { label: string; list: { s: Session; t: number }[] }[] = []
  const add = (label: string, pred: (x: number) => boolean) => {
    const list = rows.filter((x) => pred(x.t))
    if (list.length) buckets.push({ label, list })
  }
  add("今天", same)
  add("昨天", yest)
  add("本周", (x) => !same(x) && !yest(x) && now - x < 7 * day)
  add("更早", (x) => !same(x) && !yest(x) && now - x >= 7 * day)
  return buckets
}

export function App() {
  onMount(() => {
    void vcsRefresh()
  })
  const crumb = () => {
    const s = store.sessions().find((x) => x.id === store.current())
    const proj = directory() ? nameOf(directory()) : "未选项目"
    if (store.view() === "chat") return `${s?.title || "New Chat"} · ${proj}`
    const labels: Partial<Record<string, string>> = { history: "历史会话", settings: "设置", profile: "账户" }
    return labels[store.view()] ?? "Kilo"
  }
  return (
    <div class="window">
      <div class="titlebar">
        <div class="drag" data-tauri-drag-region />
        <div class="lights">
          <i style="background:#ff5f57" title="关闭" onClick={winClose} />
          <i style="background:#febc2e" title="最小化" onClick={winMin} />
          <i style="background:#28c840" title="最大化" onClick={winMax} />
        </div>
        <img src={logo} alt="" style="width:18px;height:18px;object-fit:contain" />
        <span class="tt">Kilo</span>
        <span class="sub">{crumb()}</span>
        <div class="right">
          <Show when={vcs().branch}>
            <span>
              ⑂ {vcs().branch}
              <Show when={vcs().dirty}> · {vcs().dirty}</Show>
            </span>
          </Show>
          <span class="dot" classList={{ g: ready(), gr: !ready() }} title={info() ? `CLI 服务器已连接 :${info()!.port}` : "CLI 服务器启动中…"} />
          <button class="iconbtn" title="收起/展开左栏" onClick={store.toggleLeft}>
            ◧
          </button>
          <button class="iconbtn" title="收起/展开右栏" onClick={store.toggleRight}>
            ◨
          </button>
        </div>
      </div>

      <div classList={{ shell: true, "no-left": store.leftFold(), "no-right": store.rightFold() || !store.module() }}>
        <aside class="sidebar">
          <div class="side-search" onClick={() => store.setView("history")}>
            🔍 搜索会话… <span class="kbd">⌘K</span>
          </div>
          <nav class="nav">
            <button class="item" classList={{ active: store.view() === "chat" && !store.current() }} onClick={() => void store.newSession()}>
              <span class="ic">💬</span>新对话
            </button>
            <button class="item" onClick={() => openModal("market")}>
              <span class="ic">🧩</span>插件 / 市场
            </button>
          </nav>
          <div class="grp" onClick={() => setGrpProject((v) => !v)}>
            {grpProject() ? "▾" : "▸"} 项目
            <span class="edit" title="新建项目" onClick={(e) => { e.stopPropagation(); void newProject() }}>＋</span>
          </div>
          <Show when={grpProject()}>
            <nav class="nav">
              <For each={recents()}>
                {(r) => (
                  <button class="item" style={r === directory() ? "font-weight:600" : undefined} title={r} onClick={() => void switchProject(r)}>
                    <span class="ic">{r === directory() ? "📂" : "📁"}</span>
                    {nameOf(r)}
                  </button>
                )}
              </For>
              <Show when={!recents().length}>
                <button class="item" onClick={() => void newProject()}>
                  <span class="ic">📁</span>打开项目文件夹…
                </button>
              </Show>
            </nav>
            <div class="sesslist">
              <For each={sessionGroups()}>
                {(g) => (
                  <>
                    <div class="dategroup">{g.label}</div>
                    <For each={g.list}>
                      {(x) => (
                        <>
                          <Show when={renaming() === x.s.id} fallback={
                            <div class="sess" classList={{ active: store.view() === "chat" && store.current() === x.s.id }}>
                              <span
                                class="dot"
                                classList={{ g: store.statusOf(x.s.id) === "run", y: store.statusOf(x.s.id) === "warn", r: store.statusOf(x.s.id) === "err", gr: !store.statusOf(x.s.id) }}
                              />
                              <button class="t" title={x.s.title} onClick={() => void store.open(x.s.id)}>
                                {x.s.title || "未命名"}
                              </button>
                              <span class="time">{ago(x.t)}</span>
                              <span class="act">
                                <button title="重命名" onClick={() => startRename(x.s)}>✎</button>
                                <button title="导出 Markdown" onClick={() => void exportSession(x.s.id)}>⤓</button>
                                <button title="删除" onClick={() => void store.removeSession(x.s.id)}>🗑</button>
                              </span>
                            </div>
                          }>
                            <div class="sess">
                              <input
                                class="rn"
                                style="width:100%"
                                value={renameVal()}
                                autofocus
                                onInput={(e) => setRenameVal(e.currentTarget.value)}
                                onBlur={() => void commitRename()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void commitRename()
                                  if (e.key === "Escape") setRenaming("")
                                }}
                              />
                            </div>
                          </Show>
                        </>
                      )}
                    </For>
                  </>
                )}
              </For>
              <Show when={directory() && !store.sessions().length}>
                <div class="dategroup">该项目暂无会话</div>
              </Show>
            </div>
          </Show>
          <div class="grp" onClick={() => setGrpAgent((v) => !v)}>
            {grpAgent() ? "▾" : "▸"} 助理
            <span class="edit" title="新建助理" onClick={(e) => { e.stopPropagation(); openModal("agent", { name: "" }) }}>＋</span>
          </div>
          <Show when={grpAgent()}>
            <div class="sesslist" style="flex:none;max-height:110px">
              <For each={store.agents().slice(0, 8)}>
                {(a) => (
                  <div class="sess" classList={{ active: store.agent() === a.id }}>
                    <span class="dot" classList={{ g: store.agent() === a.id, gr: store.agent() !== a.id }} />
                    <button class="t" title={a.description ?? ""} onClick={() => store.setAgent(store.agent() === a.id ? "" : a.id)}>
                      {a.id} <span style="color:var(--faint)">{a.mode === "subagent" ? "（子代理）" : BUILTIN.includes(a.id) ? "" : "（自定义）"}</span>
                    </button>
                    <button class="act time" style="opacity:1" title="编辑" onClick={() => openModal("agent", { name: a.id })}>
                      ✎
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="side-foot">
            <button class="acct" onClick={() => store.setView("profile")}>
              <span class="avatar">{(store.profile()?.name ?? store.profile()?.email ?? "K").slice(0, 1).toUpperCase()}</span>
              <div>
                <div class="nm">{store.profile()?.name || store.profile()?.email || "未登录"}</div>
                <div class="lv">{store.profile()?.loggedIn ? `Kilo Gateway · ${store.profile()?.tier || "Personal"}` : "本地 · 未连接网关"}</div>
              </div>
              <Show when={store.profile()?.loggedIn}>
                <span class="bal">{store.profile()?.balance != null ? `$${store.profile()!.balance!.toFixed(2)}` : store.profile()?.tier || "Pro"}</span>
              </Show>
            </button>
            <button class="foot-item" classList={{ active: store.view() === "settings" }} onClick={() => store.setView("settings")}>
              <span class="ic" style="width:16px;text-align:center;color:var(--muted)">⚙️</span>设置
            </button>
          </div>
        </aside>

        <main class="center">
          <div class="viewwrap">
            <Show when={store.view() === "chat"}>
              <div class="view show">
                <Chat />
              </div>
            </Show>
            <Show when={store.view() === "history"}>
              <History />
            </Show>
            <Show when={store.view() === "settings"}>
              <Settings />
            </Show>
            <Show when={store.view() === "profile"}>
              <Profile />
            </Show>
          </div>
        </main>

        <Show when={!store.rightFold() && store.module()}>
          <RightBar />
        </Show>
      </div>

      <Modals />
      <Show when={store.toast()}>
        <div class="toast show">{store.toast()}</div>
      </Show>
    </div>
  )
}

async function exportSession(id: string) {
  const c = client()
  if (!c) return
  const res = await c.session.messages({ sessionID: id, directory: directory() }).catch(() => undefined)
  const list = res?.data ?? []
  const title = store.sessions().find((x) => x.id === id)?.title ?? "会话"
  let out = `# ${title}\n\n`
  for (const m of list) {
    out += m.info.role === "user" ? "## 👤 用户\n\n" : `## 🤖 Kilo\n\n`
    for (const p of m.parts) if (p.type === "text" && !p.synthetic && p.text) out += p.text + "\n\n"
  }
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([out], { type: "text/markdown" }))
  a.download = `${title.slice(0, 40).replace(/[\\/:*?"<>|]/g, "_")}.md`
  a.click()
  URL.revokeObjectURL(a.href)
  store.notify("已导出 Markdown")
}
