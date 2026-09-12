import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import type { SnapshotFileDiff } from "@kilocode/sdk/v2/types"
import { client, directory } from "../client"
import { store, type Module } from "../store"
import { vcs, vcsSoon } from "../vcs"
import { gitCmd, openPath } from "../host"
import { hl } from "../util"

export function RightBar() {
  const m = () => store.module()
  const ttl = () => ({ files: `文件 · ${directory() ? directory().split(/[\\/]/).at(-1) : "未选项目"}`, git: "Git", browser: "浏览器", diff: `Diff · 本会话`, usage: "用量" })[m() as string] ?? "模块"
  return (
    <aside class="rightbar">
      <div class="rb-head">
        <span class="ttl">{m() ? ttl() : "模块"}</span>
        <button class="iconbtn close" title="收起右栏" onClick={() => store.toggleRight()}>✕</button>
      </div>
      <div class="rb-body">
        <Show when={m()} fallback={<ModuleHome />}>
          {m() === "files" && <FilesPanel />}
          {m() === "git" && <GitPanel />}
          {m() === "browser" && <BrowserPanel />}
          {m() === "diff" && <DiffPanel />}
          {m() === "usage" && <UsagePanel />}
        </Show>
      </div>
    </aside>
  )
}

function ModuleHome() {
  const mods: [Module, string, string, string][] = [
    ["files", "🗂", "文件", "浏览和读取工作区文件（项目感知）"],
    ["git", "⑂", "Git", "查看仓库状态与改动、生成提交"],
    ["browser", "🌐", "浏览器", "打开 localhost 或网页地址"],
    ["diff", "👁", "Diff", "查看会话/工作区/分支改动"],
    ["usage", "📈", "用量", "Token 统计与费用估算"],
  ]
  return (
    <>
      <div class="rb-hint">
        <h3>打开一个模块</h3>
        <p>选择项目工具；固定后会在此工作区下次打开时恢复。</p>
      </div>
      <For each={mods}>
        {(x) => (
          <button class="modcard" onClick={() => store.setModule(x[0])}>
            <span class="ic">{x[1]}</span>
            <div>
              <h4>{x[2]}</h4>
              <p>{x[3]}</p>
            </div>
          </button>
        )}
      </For>
    </>
  )
}

// ---------- 文件 ----------

type FsEntry = { path: string; type: string }
const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"])
const ext = (p: string) => p.split(".").at(-1)?.toLowerCase() ?? ""

function TreeNode(props: { dir: string; depth: number }) {
  const [open, setOpen] = createSignal(false)
  const [kids, setKids] = createSignal<FsEntry[]>()
  async function load() {
    if (kids()) {
      setOpen(!open())
      return
    }
    const res = await client()
      ?.v2.fs.list({ location: { directory: directory() }, path: props.dir || "." })
      .catch(() => undefined)
    const list = (res?.data?.data ?? []) as FsEntry[]
    const dirs = list.filter((x) => x.type === "directory").slice(0, 200)
    const files = list.filter((x) => x.type !== "directory").slice(0, 300)
    setKids([...dirs, ...files])
    setOpen(true)
  }
  createEffect(() => {
    if (props.depth === 1) void loadOnce()
  })
  async function loadOnce() {
    if (kids()) return
    await load()
  }
  return (
    <>
      <For each={kids() ?? []}>
        {(k) =>
          k.type === "directory" ? (
            <>
              <div class="n" style={{ "padding-left": props.depth * 12 + "px" }} onClick={() => void load()}>
                <span class="tw">{open() ? "▾" : "▸"}</span>📂 {k.path.replace(/\/$/, "").split(/[\\/]/).at(-1)}
              </div>
              <Show when={open()}><TreeNode dir={props.dir ? `${props.dir}/${k.path.replace(/\/$/, "")}` : k.path.replace(/\/$/, "")} depth={props.depth + 1} /></Show>
            </>
          ) : (
            <div class="n" classList={{ sel: store.module() === "files" && pickPath() === (props.dir ? `${props.dir}/${k.path}` : k.path) }} style={{ "padding-left": props.depth * 12 + 10 + "px" }} onClick={() => pickFile(props.dir ? `${props.dir}/${k.path}` : k.path)}>
              📄 {k.path}
            </div>
          )
        }
      </For>
    </>
  )
}

const [picked, setPicked] = createSignal<{ path: string; html: string; image?: string }>()
const pickPath = () => picked()?.path
async function pickFile(path: string) {
  const c = client()
  if (!c) return
  const res = await c.v2.fs.read({ location: { directory: directory() }, path }).catch(() => undefined)
  if (!res) return
  if (res.data instanceof Blob) {
    if (IMG.has(ext(path))) {
      const url = URL.createObjectURL(res.data)
      setPicked((prev) => {
        if (prev?.image) URL.revokeObjectURL(prev.image)
        return { path, html: "", image: url }
      })
    } else setPicked({ path, html: `（非文本文件 .${ext(path)}）` })
    return
  }
  const text = await res.data.text().catch(() => "")
  setPicked({ path, html: hl(text.slice(0, 400_000), ext(path)) })
}

function FilesPanel() {
  const [root] = createSignal(directory())
  onCleanup(() => {
    const p = picked()
    if (p?.image) URL.revokeObjectURL(p.image)
  })
  return (
    <>
      <div class="tree">
        <div class="n"><span class="tw">▾</span>📂 {root()?.split(/[\\/]/).at(-1) ?? "未选项目"}</div>
        <Show when={root()}>
          <div class="ind">
            <TreeNode dir="" depth={1} />
          </div>
        </Show>
      </div>
      <Show when={picked()} keyed>
        {(f) => (
          <div class="fileview">
            <div class="fvh">
              <b>{f.path.split(/[\\/]/).at(-1)}</b>
              <span class="sp" />
              <button class="btn sm" onClick={() => void openPath(`${directory()}/${f.path}`)}>↗ 打开</button>
            </div>
            <Show when={f.image} fallback={<pre innerHTML={f.html} />}>
              <div style="padding:10px;text-align:center"><img src={f.image} alt="" style="max-width:100%;max-height:300px" /></div>
            </Show>
          </div>
        )}
      </Show>
    </>
  )
}

// ---------- Git ----------

function GitPanel() {
  const [files, setFiles] = createSignal<SnapshotFileDiff[]>([])
  const [msg, setMsg] = createSignal("")
  const [status, setStatus] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [open, setOpen] = createSignal<string>()
  let objectUrl: string | undefined
  async function load() {
    const c = client()
    if (!c || !directory()) return
    const res = await c.vcs.diff({ directory: directory(), mode: "git" }).catch(() => undefined)
    setFiles(res?.data ?? [])
  }
  void load()
  onCleanup(() => objectUrl && URL.revokeObjectURL(objectUrl))
  async function gen() {
    setBusy(true)
    setStatus("AI 生成提交信息…")
    const res = await client()
      ?.commitMessage.generate({ directory: directory(), path: directory(), selectedFiles: files().flatMap((f) => (f.file ? [f.file] : [])) })
      .catch((e: Error) => (setStatus("生成失败：" + e.message), undefined))
    setBusy(false)
    if (!res?.data) return
    setStatus("")
    setMsg(res.data.message)
  }
  async function run(args: string[], ok: string) {
    setBusy(true)
    setStatus("")
    const err = await gitCmd(directory(), args).then(() => "").catch((e: unknown) => String(e))
    setBusy(false)
    setStatus(err ? `失败：${err}` : ok)
    if (!err) {
      if (ok === "已提交") setMsg("")
      vcsSoon()
      void load()
    }
  }
  async function commit() {
    const c = msg()
    setBusy(true)
    setStatus("")
    const err = await gitCmd(directory(), ["add", "-A"]).then(() => gitCmd(directory(), ["commit", "-m", c])).then(() => "").catch((e: unknown) => String(e))
    setBusy(false)
    setStatus(err ? `失败：${err}` : "已提交")
    if (!err) {
      setMsg("")
      vcsSoon()
      void load()
    }
  }
  return (
    <>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:12px">
        <span class="badge gray">⑂ {vcs().branch || "非仓库"}</span>
        <span style="color:var(--muted)">· {files().length} 处变更</span>
        <button class="btn sm" style="margin-left:auto" onClick={() => void load()}>↻</button>
      </div>
      <Show when={files().length} fallback={<div class="empty">工作区干净 / 无 git 仓库</div>}>
        <div class="rbl">更改 · {files().length}</div>
        <For each={files()}>
          {(f) => (
            <>
              <div class="grow" onClick={() => setOpen(open() === f.file ? undefined : f.file)} title={f.file}>
                <span classList={{ gbadge: true, M: f.status === "modified", A: f.status === "added", D: f.status === "deleted" }}>{f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"}</span>
                <span class="fg">{f.file}</span>
                <span class="stat"><span class="a">+{f.additions}</span><span class="d">−{f.deletions}</span></span>
              </div>
              <Show when={open() === f.file}>
                <div class="diff" style="margin:2px 0 8px 6px;max-height:200px">
                  <For each={(f.patch ?? "").split("\n").slice(0, 300)}>{(l) => <span class={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hh" : "ctx"}>{l || " "}</span>}</For>
                </div>
              </Show>
            </>
          )}
        </For>
      </Show>
      <textarea class="commitbox" placeholder="提交信息…（🪄 用 AI 生成）" value={msg()} onInput={(e) => setMsg(e.currentTarget.value)} />
      <Show when={status()}><div class="rbl">{status()}</div></Show>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn sm primary" disabled={busy() || !msg().trim()} onClick={() => void commit()}>✓ 提交</button>
        <button class="btn sm" disabled={busy()} onClick={() => void run(["push"], "已推送")}>↑ 推送</button>
        <button class="btn sm" disabled={busy()} onClick={gen}>🪄 AI</button>
        <button class="btn sm danger" disabled={busy() || !open()} title="放弃该文件的改动" onClick={() => void run(["checkout", "--", open() ?? ""], "已放弃")}>✕ 放弃</button>
      </div>
    </>
  )
}

// ---------- 浏览器 ----------

function BrowserPanel() {
  const [url, setUrl] = createSignal(localStorage.getItem("browser-url") ?? "http://localhost:3000")
  const [src, setSrc] = createSignal("")
  return (
    <>
      <div class="urlbar">
        <input value={url()} onInput={(e) => setUrl(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="localhost 或网页地址" />
        <button class="btn sm" onClick={go}>→</button>
      </div>
      <Show when={src()} fallback={
        <div class="fakepage" style="height:200px">
          <span style="font-size:26px">🖥</span>
          <div>输入地址后回车</div>
          <div style="font-size:11px;color:var(--muted)">站点若禁止内嵌，请用外部打开</div>
        </div>
      }>
        <div class="browserframe">
          <iframe src={src()} title="browser" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        </div>
      </Show>
      <div class="rbl" style="margin-top:8px;align-items:center">
        <button class="btn sm" onClick={() => void import("../host").then((h) => h.openUrl(src() || url()))}>↗ 外部打开</button>
        <span style="color:var(--faint)">iframe 可访问 http/https；跨域站点可能被 X-Frame-Options 拦截</span>
      </div>
    </>
  )
  function go() {
    const u = /^[a-z]+:/i.test(url()) ? url() : "http://" + url()
    localStorage.setItem("browser-url", u)
    setSrc(u)
  }
}

// ---------- Diff ----------

type Source = "session" | "workspace" | "branch"

function DiffPanel() {
  const [src, setSrc] = createSignal<Source>("session")
  const [list, setList] = createSignal<SnapshotFileDiff[]>()
  const [sel, setSel] = createSignal<string>()
  const [side, setSide] = createSignal<"inline" | "split">("inline")
  async function load() {
    setList(undefined)
    const c = client()
    if (!c || !directory()) {
      setList([])
      return
    }
    if (src() === "session") {
      setList(await store.diff())
      return
    }
    if (src() === "workspace") {
      const res = await c.vcs.diff({ directory: directory(), mode: "git" }).catch(() => undefined)
      setList(res?.data ?? [])
      return
    }
    try {
      const out = await gitCmd(directory(), ["diff", "main...HEAD", "--name-status"])
      const patches = await Promise.all(
        out.trim().split("\n").filter(Boolean).map(async (line) => {
          const file = line.split("\t").at(-1) ?? ""
          const patch = await gitCmd(directory(), ["diff", "main...HEAD", "--", file]).catch(() => "")
          const adds = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length
          const dels = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length
          return { file, additions: adds, deletions: dels, status: "modified", patch } as SnapshotFileDiff
        }),
      )
      setList(patches)
    } catch (e) {
      setList([])
      store.notify("分支对比失败：" + String(e))
    }
  }
  void load()
  const cur = () => list()?.find((f) => f.file === sel()) ?? list()?.[0]
  return (
    <>
      <div style="display:flex;gap:6px;margin-bottom:8px;font-size:11.5px;align-items:center">
        <select class="sel" style="min-width:120px;padding:3px 8px;width:auto" value={src()} onChange={(e) => { setSrc(e.currentTarget.value as unknown as Source); void load() }}>
          <option value="session">本会话改动</option>
          <option value="workspace">工作区 vs HEAD</option>
          <option value="branch">分支 vs main</option>
        </select>
        <Show when={list()?.length}>
          <span class="stat">
            <span class="a">+{list()!.reduce((a, b) => a + (b.additions ?? 0), 0)}</span>
            <span class="d">−{list()!.reduce((a, b) => a + (b.deletions ?? 0), 0)}</span>
          </span>
        </Show>
        <button class="btn sm" style="margin-left:auto" onClick={() => void load()}>↻</button>
      </div>
      <For each={list() ?? []}>
        {(f) => (
          <div class="grow" classList={{ sel: cur()?.file === f.file }} style={cur()?.file === f.file ? "background:var(--surface)" : undefined} onClick={() => setSel(f.file)} title={f.file}>
            <span classList={{ gbadge: true, M: !f.status || f.status === "modified", A: f.status === "added", D: f.status === "deleted" }}>{f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"}</span>
            <span class="fg">{f.file?.split(/[\\/]/).at(-1)}</span>
            <span class="stat"><span class="a">+{f.additions}</span><span class="d">−{f.deletions}</span></span>
          </div>
        )}
      </For>
      <Show when={list()?.length === 0}><div class="empty">无改动</div></Show>
      <Show when={cur()} keyed>
        {(f) => (
          <div class="fileview" style="margin-top:6px">
            <div class="fvh">
              <b>{f.file}</b>
              <span class="sp" />
              <button class="btn sm" onClick={() => setSide(side() === "inline" ? "split" : "inline")}>{side() === "inline" ? "并排" : "内联"}</button>
            </div>
            <div class="diff" style="padding:8px">
              <For each={(f.patch ?? "").split("\n").slice(0, 800)}>{(l) => <span class={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hh" : "ctx"}>{l || " "}</span>}</For>
            </div>
          </div>
        )}
      </Show>
      <Show when={src() === "workspace" && cur()}>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn sm" onClick={() => void restore(cur()!.file!)}>还原文件</button>
        </div>
      </Show>
    </>
  )
  async function restore(file: string) {
    try {
      await gitCmd(directory(), ["checkout", "--", file])
      store.notify("已还原 " + file)
      void load()
      vcsSoon()
    } catch (e) {
      store.notify("还原失败：" + String(e))
    }
  }
}

// ---------- 用量 ----------

function UsagePanel() {
  const msgs = () => store.thread(store.current())
  const rows = createMemo(() => {
    const by = new Map<string, { inn: number; cache: number; out: number; reason: number; cost: number; n: number }>()
    for (const m of msgs()) {
      if (m.info.role !== "assistant") continue
      const k = m.info.modelID
      const cur = by.get(k) ?? { inn: 0, cache: 0, out: 0, reason: 0, cost: 0, n: 0 }
      cur.inn += m.info.tokens.input
      cur.cache += m.info.tokens.cache.read ?? 0
      cur.out += m.info.tokens.output
      cur.reason += m.info.tokens.reasoning ?? 0
      cur.cost += m.info.cost ?? 0
      cur.n += 1
      by.set(k, cur)
    }
    return [...by].sort((a, b) => b[1].cost - a[1].cost)
  })
  const session = () => store.sessions().find((s) => s.id === store.current())
  const total = createMemo(() => msgs().filter((m) => m.info.role === "assistant").length)
  const rate = createMemo(() => {
    const list = msgs().filter((m) => m.info.role === "assistant" && (m.info as { time: { completed?: number } }).time.completed)
    if (!list.length) return 0
    const last = list.at(-1)!
    const time = last.info.time as unknown as { created: number; completed: number }
    const secs = (time.completed - time.created) / 1000
    return secs > 0 && last.info.role === "assistant" ? Math.round(last.info.tokens.output / secs) : 0
  })
  const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n))
  const pct = createMemo(() => {
    const t = session()?.tokens
    if (!t) return 0
    return Math.min(100, Math.round(((t.input + t.cache.read + t.output) / 200000) * 100))
  })
  return (
    <>
      <div class="ucard">
        <h5>本会话</h5>
        <div class="big">${(session()?.cost ?? 0).toFixed(4)}</div>
        <div class="sub">{msgs().length} messages · {total()} steps · {store.current() ? "当前会话" : "无会话"}</div>
      </div>
      <div class="ucard">
        <h5>上下文</h5>
        <div class="meter"><i style={{ width: pct() + "%" }} /></div>
        <div class="sub">{pct()}%（估算，按 200K 窗口）· 阈值内自动压缩</div>
      </div>
      <Show when={rows().length} fallback={<div class="empty">本会话还没有用量数据</div>}>
        <div class="ucard">
          <h5>Token 细分（本会话）</h5>
          <table class="usage-table">
            <tr><th></th><th>输入</th><th>缓存读</th><th>输出</th><th>推理</th><th>费用</th></tr>
            <For each={rows()}>
              {([id, r]) => (
                <tr>
                  <td>{id}</td>
                  <td>{fmtK(r.inn)}</td>
                  <td>{fmtK(r.cache)}</td>
                  <td>{fmtK(r.out)}</td>
                  <td>{r.reason ? fmtK(r.reason) : "—"}</td>
                  <td>${r.cost.toFixed(4)}</td>
                </tr>
              )}
            </For>
          </table>
        </div>
      </Show>
      <Show when={session()?.tokens}>
        <div class="ucard">
          <h5>会话累计</h5>
          <div class="sub">
            in {fmtK(session()!.tokens!.input)} · cache {fmtK(session()!.tokens!.cache.read)} · out {fmtK(session()!.tokens!.output)}
            <Show when={session()!.tokens!.reasoning}> · reasoning {fmtK(session()!.tokens!.reasoning)}</Show>
          </div>
        </div>
      </Show>
      <Show when={rate()}>
        <div class="ucard">
          <h5>吞吐</h5>
          <div class="sub">最近回合 ≈ <b>{rate()}</b> tok/s（output/秒）</div>
        </div>
      </Show>
    </>
  )
}
