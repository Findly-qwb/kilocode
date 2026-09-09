import { createResource, createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { client, directory, ready } from "../client"
import { store } from "../store"

const [tick, setTick] = createSignal(0)
const src = () => (ready() ? [tick(), directory()] : undefined)
const [methods] = createResource(src, async () => (await client()?.provider.auth())?.data ?? {})
const data = () => store.providers()

const [picked, setPicked] = createSignal<string>()
const [key, setKey] = createSignal("")
const [status, setStatus] = createSignal("")

const connected = () => new Set(data().connected)

function groups() {
  const all = data().all
  const m = methods() ?? {}
  const oauth = all.filter((p) => (m[p.id] ?? []).some((x) => x.type === "oauth"))
  const rest = all.filter((p) => !oauth.includes(p))
  return [
    { label: "授权登录", list: oauth },
    { label: "官方 API", list: rest },
  ]
}

async function saveKey() {
  const p = picked()!
  setStatus("保存中…")
  const err = await client()!.auth
    .set({ providerID: p, auth: { type: "api", key: key().trim() } })
    .then(() => "")
    .catch((e: Error) => e.message)
  if (err) {
    setStatus(`失败：${err}`)
    return
  }
  setPicked(undefined)
  setKey("")
  setStatus("")
  setTick((t) => t + 1)
  await store.refresh()
}

async function oauth(p: string) {
  setStatus("正在打开授权页面…")
  const idx = (methods() ?? {})[p]?.findIndex((x) => x.type === "oauth") ?? -1
  const res = await client()!
    .provider.oauth.authorize({ providerID: p, method: idx })
    .then((r) => r.data)
    .catch((e: Error) => {
      setStatus(`失败：${e.message}`)
    })
  if (!res) return
  await invoke("open_url", { url: res.url })
  setStatus(res.instructions || "请在浏览器完成授权，窗口关闭后自动刷新")
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const d = await client()!.provider.list({ directory: directory() }).then((r) => r.data)
    if (d?.connected.includes(p)) break
  }
  setStatus("")
  setTick((t) => t + 1)
  await store.refresh()
}

export function Providers() {
  return (
    <div class="page">
      <h1>添加服务</h1>
      <p class="sub">通过订阅 / API Key / 本地模型 接入新服务</p>
      <Show when={status()}>
        <div class="hintbar">{status()}</div>
      </Show>
      <For each={groups()}>
        {(g) => (
          <>
            <div class="label big">{g.label}</div>
            <div class="grid">
              <For each={g.list}>
                {(p) => (
                  <button
                    class="pcard"
                    onClick={() => {
                      setPicked(p.id)
                      setKey("")
                      setStatus("")
                    }}
                  >
                    <b>{p.name}</b>
                    <span>{connected().has(p.id) ? "已连接" : p.env.length ? `环境变量 ${p.env.join(", ")}` : "未配置"}</span>
                  </button>
                )}
              </For>
            </div>
          </>
        )}
      </For>
      <Show when={picked()} keyed>
        {(id) => {
          const hasOauth = (methods() ?? {})[id]?.some((x) => x.type === "oauth")
          return (
            <div class="modal" onClick={(e) => e.target === e.currentTarget && setPicked(undefined)}>
              <div class="panel">
                    <b>{data().all.find((x) => x.id === id)?.name ?? id}</b>
                <input type="password" placeholder="API Key" value={key()} onInput={(e) => setKey(e.currentTarget.value)} />
                <div class="row">
                  <button onClick={() => setPicked(undefined)}>取消</button>
                  <Show when={hasOauth}>
                    <button onClick={() => void oauth(id)}>浏览器授权</button>
                  </Show>
                  <button class="primary" disabled={!key().trim()} onClick={saveKey}>
                    保存
                  </button>
                </div>
              </div>
            </div>
          )
        }}
      </Show>
    </div>
  )
}
