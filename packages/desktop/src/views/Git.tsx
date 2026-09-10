import { createResource, createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { client, directory, ready } from "../client"

const LETTER = { added: "A", deleted: "D", modified: "M" } as const

export function GitPanel(props: { onClose: () => void }) {
  const [tick, setTick] = createSignal(0)
  const src = () => (ready() && directory() ? [tick(), directory()] : undefined)
  const [info] = createResource(src, async () => (await client()!.vcs.get({ directory: directory() }))?.data)
  const [files] = createResource(
    src,
    async () => (await client()!.vcs.diff({ directory: directory(), mode: "git" }))?.data ?? [],
  )
  const [msg, setMsg] = createSignal("")
  const [status, setStatus] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [open, setOpen] = createSignal<string>()

  async function run(args: string[], ok: string) {
    setBusy(true)
    setStatus("")
    const err = await invoke<string>("git_cmd", { dir: directory(), args }).catch((e: unknown) => String(e))
    setBusy(false)
    if (err) {
      setStatus(`失败：${err}`)
      return
    }
    setStatus(ok)
    setMsg("")
    setTick((t) => t + 1)
  }

  async function commitAll() {
    setBusy(true)
    setStatus("")
    const m = msg().trim()
    const err = await invoke<string>("git_cmd", { dir: directory(), args: ["add", "-A"] })
      .then(() => invoke<string>("git_cmd", { dir: directory(), args: ["commit", "-m", m] }))
      .catch((e: unknown) => String(e))
    setBusy(false)
    if (err) {
      setStatus(`失败：${err}`)
      return
    }
    setStatus("已提交")
    setMsg("")
    setTick((t) => t + 1)
  }

  return (
    <div class="sheet">
      <div class="shead">
        <b>⎇ {info()?.branch || "非仓库"}</b>
        <Show when={files() && files()!.length}>
          <span class="dirty">{files()!.length} 处变更</span>
        </Show>
        <span class="grow" />
        <button title="刷新" onClick={() => setTick((t) => t + 1)}>
          ⟳
        </button>
        <button title="关闭" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="sbody">
        <Show when={(files() ?? []).length} fallback={<p class="empty">{info()?.branch ? "工作区干净" : "当前项目不是 git 仓库"}</p>}>
          <For each={files()}>
            {(f) => (
              <div class="gfile">
                <button
                  class="growrow"
                  onClick={() => setOpen(open() === f.file ? undefined : f.file)}
                  title={f.file}
                >
                  <em classList={{ st: true, [f.status ?? "modified"]: true }}>{LETTER[f.status ?? "modified"]}</em>
                  <code>{f.file}</code>
                  <span class="add">+{f.additions}</span>
                  <span class="del">-{f.deletions}</span>
                </button>
                <Show when={open() === f.file}>
                  <pre class="tout">{f.patch ?? "（无 patch 内容）"}</pre>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="sfoot">
        <Show when={status()}>
          <div class="gstat">{status()}</div>
        </Show>
        <textarea rows={2} placeholder="Commit message…" value={msg()} onInput={(e) => setMsg(e.currentTarget.value)} />
        <div class="row">
          <button disabled={busy()} onClick={() => void run(["push"], "已推送")}>
            Push
          </button>
          <button
            class="primary"
            disabled={busy() || !msg().trim()}
            onClick={commitAll}
          >
            Commit
          </button>
        </div>
      </div>
    </div>
  )
}
