import { createResource, createSignal, For, Show } from "solid-js"
import { client, directory } from "../client"

type Entry = { path: string; type: string }

const TEXT = new Set(["md", "txt", "json", "jsonc", "yaml", "yml", "toml", "ts", "tsx", "js", "jsx", "mjs", "py", "sh", "rs", "go", "css", "html", "gd", "env", "lock", "sql", "xml"])
const ext = (p: string) => p.split(".").at(-1)?.toLowerCase() ?? ""

export function Files() {
  const [stack, setStack] = createSignal<string[]>([])
  const [opened, setOpened] = createSignal<{ path: string; content: string }>()

  const abs = () => directory() + stack().map((s) => "/" + s.replace(/\/$/, "")).join("")
  const rel = () => stack().join("/")

  const [entries] = createResource(stack, async () => {
    setOpened(undefined)
    const c = client()
    if (!c || !directory()) return []
    const res = await c.v2.fs.list({ location: { directory: directory() }, path: abs() }).catch(() => undefined)
    const list: Entry[] = res?.data?.data ?? []
    return [...list.filter((x) => x.type === "directory"), ...list.filter((x) => x.type !== "directory")].sort((a, b) =>
      a.path.localeCompare(b.path),
    )
  })

  async function open(path: string) {
    const c = client()
    if (!c) return
    const full = rel() ? `${rel()}/${path}` : path
    if (!TEXT.has(ext(path))) {
      setOpened({ path, content: "（非文本文件，不预览）" })
      return
    }
    const text = await c.v2.fs
      .read({ location: { directory: directory() }, path: full })
      .then(async (r) => (r.data instanceof Blob ? await r.data.text() : ""))
      .catch((e: Error) => `读取失败：${e.message}`)
    setOpened({ path, content: text.slice(0, 200_000) })
  }

  return (
    <div class="page">
      <h1>素材库</h1>
      <div class="crumb">
        <button onClick={() => setStack([])}>项目根</button>
        <For each={stack()}>
          {(s, i) => (
            <>
              <span>/</span>
              <button onClick={() => setStack(stack().slice(0, i() + 1))}>{s.replace(/\/$/, "")}</button>
            </>
          )}
        </For>
      </div>
      <div class="files">
        <div class="flist">
          <Show when={stack().length}>
            <button class="fentry" onClick={() => setStack(stack().slice(0, -1))}>
              ⬑ ..
            </button>
          </Show>
          <For each={entries() ?? []}>
            {(e) => (
              <button
                class="fentry"
                classList={{ dir: e.type === "directory", on: opened()?.path === e.path }}
                onClick={() => (e.type === "directory" ? setStack([...stack(), e.path]) : void open(e.path))}
              >
                {e.type === "directory" ? "📁" : "📄"} {e.path.replace(/\/$/, "")}
              </button>
            )}
          </For>
        </div>
        <Show when={opened()} keyed>
          {(f) => (
            <div class="fview">
              <b>{f.path}</b>
              <pre>{f.content}</pre>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
