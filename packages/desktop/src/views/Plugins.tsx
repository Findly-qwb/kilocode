import { createResource, createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { client, directory, ready } from "../client"

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

async function save() {
  if (!name().trim() || !directory()) return
  await invoke("write_skill", { dir: directory(), name: name().trim(), desc: desc().trim() })
  setCreating(false)
  setName("")
  setDesc("")
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
              {t === "skill" ? `技能 ${(skills() ?? []).length}` : t === "mcp" ? "MCP" : `命令行工具 ${(cmds() ?? []).length}`}
            </button>
          )}
        </For>
      </div>
      <input class="search full" placeholder="搜索…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
      <Show when={tab() === "skill"}>
        <div class="row-end">
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
        <div class="grid">
          <For each={mcp() ?? []}>
            {([n, st]) => (
              <div class="card">
                <b>{n}</b>
                <p>{(st as { status?: string }).status ?? "unknown"}</p>
              </div>
            )}
          </For>
          <Show when={!(mcp() ?? []).length}>
            <p class="empty">暂无 MCP，可在项目 .kilo/config.json 的 mcp 字段配置</p>
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
