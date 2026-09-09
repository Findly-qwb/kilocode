import { createResource, createSignal, For, Show, onCleanup } from "solid-js"
import { client, directory } from "../client"
import { store } from "../store"

type Entry = { path: string; type: string }
type Opened = { path: string; content: string; image?: string }

const TEXT = new Set(["md", "txt", "json", "jsonc", "yaml", "yml", "toml", "ts", "tsx", "js", "jsx", "mjs", "py", "sh", "rs", "go", "css", "html", "gd", "env", "lock", "sql", "xml"])
const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"])
const ext = (p: string) => p.split(".").at(-1)?.toLowerCase() ?? ""
const icon = (e: Entry) =>
  e.type === "directory" ? "📁" : IMG.has(ext(e.path)) ? "🖼" : TEXT.has(ext(e.path)) ? "📄" : e.path.endsWith(".md") ? "📝" : "📦"
const isImg = (p: string) => IMG.has(ext(p))

function Thumb(props: { path: string }) {
  const [url, setUrl] = createSignal("")
  let objectUrl: string | undefined
  void client()
    ?.v2.fs.read({ location: { directory: directory() }, path: props.path })
    .then((r) => {
      if (!(r?.data instanceof Blob)) return
      objectUrl = URL.createObjectURL(r.data)
      setUrl(objectUrl)
    })
    .catch(() => {})
  onCleanup(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  })
  return <img src={url()} loading="lazy" alt="" />
}

export function Files() {
  const [stack, setStack] = createSignal<string[]>([])
  const [opened, setOpened] = createSignal<Opened>()
  const [artifacts, setArtifacts] = createSignal(false)
  const [thumb, setThumb] = createSignal(localStorage.getItem("thumb") === "true")
  const [changed, setChanged] = createSignal<Awaited<ReturnType<typeof store.diff>>>()
  let objectUrl: string | undefined

  const abs = () => directory() + stack().map((s) => "/" + s.replace(/\/$/, "")).join("")
  const rel = () => stack().join("/")
  const relOf = (p: string) => /^[A-Za-z]:[\\/]|^\//.test(p) ? p : rel() ? `${rel()}/${p}` : p

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

  async function show(path: string) {
    const c = client()
    if (!c) return
    const full = relOf(path)
    const e = ext(full)
    const read = c.v2.fs.read({ location: { directory: directory() }, path: full }).catch(() => undefined)
    if (IMG.has(e)) {
      const res = await read
      const blob = res?.data instanceof Blob ? res.data : undefined
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = blob ? URL.createObjectURL(blob) : undefined
      setOpened({ path: full, content: "", image: objectUrl })
      return
    }
    if (!TEXT.has(e)) {
      setOpened({ path: full, content: `（非文本文件 .${e}，不预览）` })
      return
    }
    const text = await read
      .then(async (r) => (r?.data instanceof Blob ? await r.data.text() : ""))
      .catch((e: Error) => `读取失败：${e.message}`)
    setOpened({ path: full, content: text.slice(0, 200_000) })
  }

  async function toggle() {
    const next = !artifacts()
    setArtifacts(next)
    if (next && !changed()) setChanged(await store.diff())
  }

  function mode() {
    const next = !thumb()
    setThumb(next)
    localStorage.setItem("thumb", String(next))
  }

  const pick = (e: Entry) => (e.type === "directory" ? void setStack([...stack(), e.path]) : void show(e.path))

  return (
    <div class="page">
      <h1>素材库</h1>
      <div class="row-end">
        <Show when={!artifacts()}>
          <button title="切换缩略图/列表" onClick={mode}>
            {thumb() ? "☰ 列表" : "▦ 缩略图"}
          </button>
        </Show>
        <Show when={store.current()}>
          <button classList={{ primary: artifacts() }} onClick={toggle}>
            本会话产物
          </button>
        </Show>
      </div>
      <Show
        when={artifacts()}
        fallback={
          <>
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
              <Show
                when={thumb()}
                fallback={
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
                          onClick={() => pick(e)}
                        >
                          {icon(e)} {e.path.replace(/\/$/, "")}
                        </button>
                      )}
                    </For>
                  </div>
                }
              >
                <div class="tgrid">
                  <For each={(entries() ?? []).slice(0, 120)}>
                    {(e) => (
                      <button
                        class="tcell"
                        classList={{ on: opened()?.path === e.path }}
                        onClick={() => pick(e)}
                        title={e.path.replace(/\/$/, "")}
                      >
                        <Show when={isImg(e.path)} fallback={<span class="big">{icon(e)}</span>}>
                          <Thumb path={relOf(e.path)} />
                        </Show>
                        <span class="tn">{e.path.replace(/\/$/, "")}</span>
                      </button>
                    )}
                  </For>
                  <Show when={(entries() ?? []).length > 120}>
                    <div class="empty">仅显示前 120 项，切回列表查看全部</div>
                  </Show>
                </div>
              </Show>
              <Show when={opened()} keyed>
                {(f) => (
                  <div class="fview">
                    <b>{f.path}</b>
                    <Show when={f.image} fallback={<pre>{f.content}</pre>}>
                      <img class="preview" src={f.image} alt={f.path} />
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </>
        }
      >
        <div class="files">
          <div class="flist">
            <Show when={changed()} fallback={<div class="fentry">加载…</div>}>
              <For each={changed()}>
                {(f) => (
                  <button class="fentry" onClick={() => void show(f.file ?? "")}>
                    {icon({ path: f.file ?? "", type: "file" })} {(f.file ?? "").split(/[\\/]/).at(-1)}{" "}
                    <span class="cost">+{f.additions} -{f.deletions}</span>
                  </button>
                )}
              </For>
              <Show when={!changed()!.length}>
                <div class="fentry empty">该会话暂无文件产物</div>
              </Show>
            </Show>
          </div>
          <Show when={opened()} keyed>
            {(f) => (
              <div class="fview">
                <b>{f.path}</b>
                <Show when={f.image} fallback={<pre>{f.content}</pre>}>
                  <img class="preview" src={f.image} alt={f.path} />
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
