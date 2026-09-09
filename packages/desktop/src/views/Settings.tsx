import { createResource, createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { client, directory, forget, ready, recents, setDirectory } from "../client"
import { serverInfo } from "../backend"
import { store } from "../store"

const [tick, setTick] = createSignal(0)
const [info] = createResource(
  () => [ready(), tick()] as const,
  async ([r]) => {
    if (!r) return undefined
    const i = await serverInfo()
    if (!i) return undefined
    const res = await fetch(`${i.baseUrl}/global/health`, {
      headers: { Authorization: "Basic " + btoa(`kilo:${i.password}`) },
    }).catch(() => undefined)
    const body: unknown = await res?.json().catch(() => undefined)
    const version = typeof body === "object" && body !== null && "version" in body ? String(body.version) : "未知"
    return { info: i, version }
  },
)

const load = (key: string) => localStorage.getItem(key) ?? ""
const [args, setArgs] = createSignal(load("backendArgs"))
const [envs, setEnvs] = createSignal(load("backendEnvs"))

async function restart() {
  localStorage.setItem("backendArgs", args())
  localStorage.setItem("backendEnvs", envs())
  store.setPage("settings")
  const err = await invoke<string | null>("restart_backend", {
    args: args().trim() || null,
    envs: envs().trim() ? envs().split(/\n+/).filter(Boolean) : null,
  }).catch((e: Error) => e.message)
  if (err) return store.notify(`重启失败：${err}`)
  store.notify("正在重启后端…")
  await new Promise((r) => setTimeout(r, 4000))
  setTick((t) => t + 1)
  await store.refresh()
}

const models = () => store.providers().all.filter((p) => store.providers().connected.includes(p.id))
const currentModel = () => (store.model() ? `${store.model()!.providerID}/${store.model()!.modelID}` : "")

export function Settings() {
  return (
    <div class="page">
      <h1>设置</h1>
      <div class="label big">对话</div>
      <div class="form">
        <label>
          默认模型
          <select
            value={currentModel()}
            onChange={(e) => {
              const [providerID, ...rest] = e.currentTarget.value.split("/")
              store.setModel(providerID ? { providerID, modelID: rest.join("/") } : undefined)
            }}
          >
            <option value="">跟随服务商默认</option>
            <For each={models()}>
              {(p) => (
                <optgroup label={p.name}>
                  <For each={Object.values(p.models).slice(0, 40)}>
                    {(m) => <option value={`${p.id}/${m.id}`}>{m.name}</option>}
                  </For>
                </optgroup>
              )}
            </For>
          </select>
        </label>
        <label>
          默认助理
          <select value={store.agent()} onChange={(e) => store.setAgent(e.currentTarget.value)}>
            <option value="">默认（build）</option>
            <For each={store.agents()}>{(a) => <option value={a.id}>{a.id}</option>}</For>
          </select>
        </label>
        <label>
          审批模式
          <select value={store.autoApprove() ? "auto" : "ask"} onChange={(e) => store.setAutoApprove(e.currentTarget.value === "auto")}>
            <option value="ask">请求批准</option>
            <option value="auto">自动批准</option>
          </select>
        </label>
        <label>
          主题
          <select
            value={store.theme()}
            onChange={(e) => {
              const v = e.currentTarget.value
              if (v === "system" || v === "light" || v === "dark") store.setTheme(v)
            }}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>

      <div class="label big">最近项目</div>
      <Show when={recents().length} fallback={<p class="empty">暂无最近项目</p>}>
        <div class="rows">
          <For each={recents()}>
            {(r) => (
              <div class="lrow">
                <button class="side-item" classList={{ on: r === directory() }} onClick={() => { setDirectory(r); void store.refresh() }}>
                  {r}
                </button>
                <button class="del" onClick={() => forget(r)}>×</button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="label big">后端 kilo serve</div>
      <div class="rows">
        <Show when={info()} keyed>
          {(b) => (
            <>
              <div class="kv">
                <span>版本</span>
                <code>{b.version}</code>
              </div>
              <div class="kv">
                <span>地址</span>
                <code>{b.info.baseUrl}</code>
              </div>
            </>
          )}
        </Show>
        <div class="kv">
          <span>工作目录</span>
          <code>{directory() || "（未选择）"}</code>
        </div>
        <Show when={client()}>
          <div class="row">
            <button onClick={restart}>保存并重启后端</button>
          </div>
        </Show>
      </div>

      <div class="label big">启动参数（重启后生效）</div>
      <div class="form">
        <input placeholder="附加 CLI 参数，如 --pure" value={args()} onInput={(e) => setArgs(e.currentTarget.value)} />
        <textarea rows={3} placeholder={"附加环境变量，每行 KEY=VALUE\nHTTPS_PROXY=http://127.0.0.1:7890"} value={envs()} onInput={(e) => setEnvs(e.currentTarget.value)} />
      </div>
    </div>
  )
}
