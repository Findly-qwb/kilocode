import { createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import logo from "./assets/logo.png"
import { directory, setDirectory } from "./client"
import { store } from "./store"
import { Chat } from "./views/Chat"
import { Files } from "./views/Files"
import { Plugins } from "./views/Plugins"
import { Providers } from "./views/Providers"

export type Page = "chat" | "plugins" | "providers" | "files"

const [page, setPage] = createSignal<Page>("chat")
const [search, setSearch] = createSignal("")

async function chooseFolder() {
  const dir = await invoke<string | null>("pick_dir")
  if (dir) {
    setDirectory(dir)
    await store.refresh()
    await store.newSession()
  }
}

export function App() {
  return (
    <div class="shell">
      <aside class="side">
        <img class="brand" src={logo} alt="Kilo" />
        <button class="side-item" onClick={() => { setPage("chat"); void store.newSession() }}>
          ＋ 新对话
        </button>
        <input class="search" placeholder="搜索会话…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        <button class="side-item" classList={{ on: page() === "plugins" }} onClick={() => setPage("plugins")}>
          插件
        </button>
        <button class="side-item" classList={{ on: page() === "files" }} onClick={() => setPage("files")}>
          素材库
        </button>
        <button class="side-item" classList={{ on: page() === "providers" }} onClick={() => setPage("providers")}>
          服务商
        </button>
        <div class="label">项目</div>
        <button class="side-item dir" onClick={chooseFolder} title={directory()}>
          {directory() ? directory().split("/").at(-1) : "选择文件夹…"}
        </button>
        <div class="sessions">
          <For each={store.sessions().filter((s) => (s.title ?? "").toLowerCase().includes(search().toLowerCase()))}>
            {(s) => (
              <div class="session" classList={{ on: page() === "chat" && store.current() === s.id }}>
                <button
                  onClick={() => {
                    setPage("chat")
                    void store.open(s.id)
                  }}
                >
                  {s.title || "未命名"}
                </button>
                <button class="del" title="删除" onClick={() => void store.removeSession(s.id)}>
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </aside>
      <main>
        <Show when={page() === "chat"}>
          <Chat />
        </Show>
        <Show when={page() === "plugins"}>
          <Plugins />
        </Show>
        <Show when={page() === "files"}>
          <Files />
        </Show>
        <Show when={page() === "providers"}>
          <Providers />
        </Show>
      </main>
    </div>
  )
}
