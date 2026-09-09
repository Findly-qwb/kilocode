import { createResource, createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { client, directory, ready } from "../client"
import { store } from "../store"

type Tab = "skill" | "mcp" | "command"
const [tab, setTab] = createSignal<Tab>("skill")
const [search, setSearch] = createSignal("")
const [tick, setTick] = createSignal(0)
const reload = () => setTick((t) => t + 1)

const src = () => (ready() ? [tick(), directory()] : undefined)
const [skills] = createResource(
  src,
  async () => (await client()?.v2.skill.list({ location: { directory: directory() } }))?.data?.data ?? [],
)
const [mcp] = createResource(src, async () => Object.entries((await client()?.mcp.status({ directory: directory() }))?.data ?? {}))
const [cmds] = createResource(src, async () => (await client()?.command.list({ directory: directory() }))?.data ?? [])

const [creating, setCreating] = createSignal(false)
const [name, setName] = createSignal("")
const [desc, setDesc] = createSignal("")

const [adding, setAdding] = createSignal(false)
const [mname, setMName] = createSignal("")
const [mremote, setMRemote] = createSignal(false)
const [mvalue, setMValue] = createSignal("")

const open = (url: string) => invoke("open_url", { url })

async function save() {
  if (!name().trim() || !directory()) return
  await invoke("write_skill", { dir: directory(), name: name().trim(), desc: desc().trim() })
  setCreating(false)
  setName("")
  setDesc("")
  reload()
}

async function addMcp() {
  const c = client()
  if (!c || !mname().trim() || !mvalue().trim()) return
  const config = mremote()
    ? { type: "remote" as const, url: mvalue().trim() }
    : { type: "local" as const, command: mvalue().trim().split(/\s+/) }
  const err = await c.mcp.add({ name: mname().trim(), config, directory: directory() }).then(() => "").catch((e: Error) => e.message)
  if (err) return store.notify(`添加失败：${err}`)
  const done = mname().trim()
  setAdding(false)
  setMName("")
  setMValue("")
  reload()
  store.notify(`MCP「${done}」已添加`)
}

async function toggleMcp(name: string, on: boolean) {
  const c = client()
  if (!c) return
  const req = { name, directory: directory() }
  const err = await (on ? c.mcp.disconnect(req) : c.mcp.connect(req)).then(() => "").catch((e: Error) => e.message)
  if (err) store.notify(`操作失败：${err}`)
  reload()
}

async function rmMcp(name: string) {
  const e = await invoke<void>("remove_mcp", { dir: directory(), name }).catch((x: unknown) =>
    x instanceof Error ? x.message : String(x),
  )
  if (e) {
    store.notify(`删除失败：${e}`)
    return
  }
  store.notify("已删除；若仍在列表中，到设置页重启后端生效")
  reload()
}

const filter = <T extends { name?: string; id?: string }>(list: T[]) =>
  list.filter((x) => (x.name ?? x.id ?? "").toLowerCase().includes(search().toLowerCase()))

export function Plugins() {
  return (
    <div class="page">
      <div class="tabs">
        <For each={["skill", "mcp", "command"] as Tab[]}>
          {(t) => (
            <button classList={{ on: tab() === t }} onClick={() => setTab(t)}>
              {t === "skill" ? `技能 ${(skills() ?? []).length}` : t === "mcp" ? `MCP ${(mcp() ?? []).length}` : `命令行工具 ${(cmds() ?? []).length}`}
            </button>
          )}
        </For>
      </div>
      <input class="search full" placeholder="搜索…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
      <Show when={tab() === "skill"}>
        <div class="row-end">
          <button onClick={() => void open("https://github.com/Kilo-Org/kilo-marketplace")}>技能市场</button>
          <button class="primary" onClick={() => setCreating(true)}>
            ＋ 新建技能
          </button>
        </div>
        <Show when={creating()}>
          <div class="panel">
            <input placeholder="技能名（英文）" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            <input placeholder="一句话描述" value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} />
            <div class="row">
              <button onClick={() => setCreating(false)}>取消</button>
              <button class="primary" onClick={save}>
                保存到 .kilo/skills
              </button>
            </div>
          </div>
        </Show>
        <div class="grid">
          <For each={filter((skills() ?? []) as { name: string; description?: string }[])}>
            {(s) => (
              <div class="card">
                <b>/{s.name}</b>
                <p>{s.description ?? ""}</p>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={tab() === "mcp"}>
        <div class="row-end">
          <button class="primary" onClick={() => setAdding((v) => !v)}>
            ＋ 添加 MCP
          </button>
        </div>
        <Show when={adding()}>
          <div class="panel">
            <div class="tabs small">
              <button classList={{ on: !mremote() }} onClick={() => setMRemote(false)}>本地命令</button>
              <button classList={{ on: mremote() }} onClick={() => setMRemote(true)}>远程 URL</button>
            </div>
            <input placeholder="名称" value={mname()} onInput={(e) => setMName(e.currentTarget.value)} />
            <input
              placeholder={mremote() ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem …"}
              value={mvalue()}
              onInput={(e) => setMValue(e.currentTarget.value)}
            />
            <div class="row">
              <button onClick={() => setAdding(false)}>取消</button>
              <button class="primary" disabled={!mname().trim() || !mvalue().trim()} onClick={addMcp}>
                添加并写入配置
              </button>
            </div>
          </div>
        </Show>
        <div class="grid">
          <For each={mcp() ?? []}>
            {([n, st]) => {
              const status = (st as { status?: string }).status ?? "unknown"
              const on = status === "connected"
              return (
                <div class="card mcp">
                  <b>{n}</b>
                  <p>{status}</p>
                  <div class="row">
                    <button onClick={() => void rmMcp(n)}>删除</button>
                    <Show when={!on}>
                      <button class="primary" disabled={!directory()} onClick={() => void toggleMcp(n, false)}>
                        {status === "needs_auth" ? "鉴权" : "连接"}
                      </button>
                    </Show>
                    <Show when={on}>
                      <button onClick={() => void toggleMcp(n, true)}>断开</button>
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
          <Show when={!(mcp() ?? []).length}>
            <p class="empty">暂无 MCP。可点上方「添加 MCP」，或在项目 .kilo/config.json 的 mcp 字段配置</p>
          </Show>
        </div>
      </Show>
      <Show when={tab() === "command"}>
        <div class="grid">
          <For each={filter(cmds() ?? [])}>
            {(c) => (
              <div class="card">
                <b>/{c.name}</b>
                <p>{c.description ?? ""}</p>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
