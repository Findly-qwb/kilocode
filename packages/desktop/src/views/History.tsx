import { createSignal, For, Show } from "solid-js"
import type { Session } from "@kilocode/sdk/v2/types"
import { store } from "../store"
import { ago } from "../util"
import { client, directory } from "../client"
import { openModal } from "../ui"

type Tab = "local" | "cloud" | "wt"

function dotClass(st: "" | "run" | "warn" | "err") {
  return { dot: true, g: st === "run", y: st === "warn", r: st === "err", gr: !st }
}

export function History() {
  const [tab, setTab] = createSignal<Tab>("local")
  const [q, setQ] = createSignal("")
  const [onlyRepo, setOnlyRepo] = createSignal(true)
  const [renaming, setRenaming] = createSignal("")
  const [renameVal, setRenameVal] = createSignal("")
  const [cloud, setCloud] = createSignal<Session[]>()

  const rows = () => {
    const src = tab() === "local" ? store.sessions() : cloud() ?? []
    const s = q().toLowerCase()
    return src.filter((x) => !s || (x.title ?? "").toLowerCase().includes(s))
  }

  async function switchTab(t: Tab) {
    setTab(t)
    if (t !== "cloud" || cloud()) return
    const c = client()
    if (!c) return
    const res = await c.kilo.cloudSessions({ directory: directory() }).catch(() => undefined)
    const rows = (res?.data ?? []).filter((x): x is { id: string; title?: string; time?: { updated?: number; created?: number } } => typeof x === "object" && x !== null && "id" in x)
    setCloud(
      rows.map((x) => ({
        id: x.id,
        slug: x.id,
        projectID: "cloud",
        directory: "",
        version: "",
        title: x.title ?? "云端会话",
        time: { created: x.time?.created ?? Date.now(), updated: x.time?.updated ?? Date.now() },
      })),
    )
  }

  return (
    <section class="view show">
      <div class="page">
        <h2>历史会话</h2>
        <div class="lead">本地持久化（CLI 引擎自带 kilo.db · WAL） · 支持云端同步与 Worktree 会话</div>
        <div class="htabs">
          <For each={["local", "cloud", "wt"] as const}>{(t) => <button classList={{ htab: true, active: tab() === t }} onClick={() => void switchTab(t)}>{{ local: "本地", cloud: "云端", wt: "Worktree" }[t]}</button>}</For>
        </div>
        <div class="hsearch">
          <input type="text" placeholder="按标题搜索…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <label><input type="checkbox" checked={onlyRepo()} onChange={(e) => setOnlyRepo(e.currentTarget.checked)} /> 仅当前仓库</label>
          <button class="btn" onClick={() => openModal("cloudimport")}>⤓ 导入云端会话</button>
        </div>
        <Show when={tab() !== "wt"} fallback={<WtList />}>
          <Show when={rows().length} fallback={<div class="empty">{tab() === "cloud" ? "云端会话需要登录 Kilo Gateway（设置 → 供应商）" : "没有匹配的会话"}</div>}>
            <For each={rows()}>
              {(s) => (
                <>
                  <Show when={renaming() === s.id} fallback={
                    <button class="hrow" onClick={() => void store.open(s.id)}>
                      <span classList={dotClass(tab() === "local" ? store.statusOf(s.id) : "")} />
                      <div class="col">
                        <div class="t">{s.title || "未命名"}</div>
                        <div class="m">
                          <span>{s.model?.id ?? store.model()?.modelID ?? "默认"}</span>
                          <Show when={s.summary}><span>{s.summary!.files} files</span></Show>
                          <span>${(s.cost ?? 0).toFixed(4)}</span>
                        </div>
                      </div>
                      <div class="wr">
                        <span>{ago(s.time.updated ?? s.time.created)}</span>
                        <button title="重命名" onClick={(e) => { e.stopPropagation(); setRenaming(s.id); setRenameVal(s.title) }}>✎</button>
                        <button title="删除" onClick={(e) => { e.stopPropagation(); void store.removeSession(s.id) }}>🗑</button>
                      </div>
                    </button>
                  }>
                    <div class="hrow">
                      <input class="rn" value={renameVal()} autofocus onInput={(e) => setRenameVal(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") void commit() }} />
                      <div class="wr"><button class="btn sm" onClick={() => void commit()}>保存</button><button class="btn sm" onClick={() => setRenaming("")}>取消</button></div>
                    </div>
                  </Show>
                </>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </section>
  )

  async function commit() {
    const id = renaming()
    if (id && renameVal().trim()) await store.rename(id, renameVal())
    setRenaming("")
  }
}

function WtList() {
  const [list, setList] = createSignal<{ directory: string; managed: boolean }[]>()
  void client()
    ?.worktree.list({ directory: directory() })
    .then((r) => setList(r?.data ?? []))
    .catch(() => setList([]))
  return (
    <Show when={list()} fallback={<div class="empty">读取中…</div>}>
      <For each={list()}>
        {(w) => (
          <div class="hrow">
            <span class="dot gr" />
            <div class="col">
              <div class="t">{w.directory.split(/[\\/]/).at(-1)}</div>
              <div class="m"><span>{w.directory}</span></div>
            </div>
          </div>
        )}
      </For>
      <Show when={!list()!.length}><div class="empty">当前项目没有 Worktree 会话；在聊天里用 ⌥ 新建</div></Show>
    </Show>
  )
}
