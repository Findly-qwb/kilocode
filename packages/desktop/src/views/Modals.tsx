import { Show, createSignal, For } from "solid-js"
import { client, directory } from "../client"
import { saveConfig, store } from "../store"
import { modal, openModal, closeModal, type ModalArg } from "../ui"
import { openUrl, writeAgent } from "../host"

export function Modals() {
  return (
    <Show when={modal()} keyed>
      {(m) => (
        <div class="overlay show" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div classList={{ sheet: true, wide: m.name === "custom" || m.name === "market" }}>
            {m.name === "provider" && <ProviderModal arg={m.arg} />}
            {m.name === "custom" && <CustomModal arg={m.arg} />}
            {m.name === "mcp" && <McpModal arg={m.arg} />}
            {m.name === "market" && <MarketModal />}
            {m.name === "install" && <InstallModal arg={m.arg} />}
            {m.name === "cloudimport" && <CloudImportModal />}
            {m.name === "feedback" && <FeedbackModal />}
            {m.name === "agent" && <AgentModal arg={m.arg} />}
          </div>
        </div>
      )}
    </Show>
  )
}

function Head(props: { title: string }) {
  return (
    <div class="mhead">
      <h3>{props.title}</h3>
      <button class="x" onClick={closeModal}>✕</button>
    </div>
  )
}

// ---------- 连接供应商 ----------

function ProviderModal(props: { arg?: ModalArg }) {
  const pid = () => props.arg?.provider ?? "anthropic"
  const p = () => store.providers().all.find((x) => x.id === pid())
  const [view, setView] = createSignal<"list" | "apikey" | "oauth">("list")
  const [key, setKey] = createSignal("")
  const [baseUrl, setBaseUrl] = createSignal("")
  const [status, setStatus] = createSignal("")
  const methods = () => p()?.env ?? []
  const hasOauth = true
  async function saveKey() {
    const c = client()
    if (!c) return
    setStatus("保存中…")
    const err = await c.auth
      .set({ providerID: pid(), auth: { type: "api", key: key().trim() } })
      .then(() => "")
      .catch((e: Error) => e.message)
    if (err) {
      setStatus("失败：" + err)
      return
    }
    if (baseUrl().trim()) await saveConfig({ provider: { [pid()]: { options: { baseURL: baseUrl().trim() } } } })
    closeModal()
    setStatus("")
    await store.refresh()
    store.notify(`${p()?.name ?? pid()} 已连接`)
  }
  async function oauth() {
    const c = client()
    if (!c) return
    setStatus("正在打开授权页面…")
    const res = await c.provider.oauth
      .authorize({ providerID: pid(), method: 0 })
      .then((r) => r.data)
      .catch((e: Error) => {
        setStatus("失败：" + e.message)
      })
    if (!res) return
    await openUrl(res.url)
    setStatus(res.instructions || "请在浏览器完成授权…")
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const d = await c.provider.list({ directory: directory() }).then((r) => r.data).catch(() => undefined)
      if (d?.connected.includes(pid())) break
    }
    setStatus("")
    closeModal()
    await store.refresh()
  }
  return (
    <>
      <Head title={`连接 ${p()?.name ?? pid()}`} />
      <div class="mbody">
        <Show when={view() === "list"}>
          <button class="auth-method" onClick={() => setView("apikey")}>
            <span class="ic">🔑</span>
            <div><b>API Key</b><br /><span>粘贴 {p()?.name ?? pid()} 密钥，保存在本地配置</span></div>
          </button>
          <Show when={hasOauth}>
            <button class="auth-method" onClick={() => setView("oauth")}>
              <span class="ic">🛰️</span>
              <div><b>OAuth</b><br /><span>打开浏览器完成授权（订阅账号）</span></div>
            </button>
          </Show>
          <Show when={methods().length}><div class="hint" style="font-size:11px;color:var(--muted);margin-top:6px">支持环境变量：{methods().join(", ")} · 填 {"{env:VAR}"} 语法读取</div></Show>
        </Show>
        <Show when={view() === "apikey"}>
          <div class="field">
            <label>API Key</label>
            <input type="password" placeholder="sk-…" value={key()} onInput={(e) => setKey(e.currentTarget.value)} />
            <div class="hint">支持 {"{env:ANTHROPIC_API_KEY}"} 环境变量语法 · 本地 provider（Ollama 等）可留空</div>
          </div>
          <div class="field">
            <label>Base URL <span class="opt">可选（代理/网关）</span></label>
            <input placeholder="https://…" value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} />
          </div>
          <Show when={status()}><div class="notice info">{status()}</div></Show>
        </Show>
        <Show when={view() === "oauth"}>
          <div class="devauth">
            <div class="step">已打开浏览器 · 确认后自动完成</div>
            <div class="wait"><span class="spinner" /><span style="margin-left:8px">{status() || "等待回调…"}</span><button class="btn sm" style="margin-left:auto" onClick={() => setView("list")}>取消</button></div>
          </div>
        </Show>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <Show when={view() === "apikey"}><button class="btn primary" disabled={!key().trim()} onClick={() => void saveKey()}>连接</button></Show>
        <Show when={view() === "oauth"}><button class="btn primary" onClick={() => void oauth()}>完成授权</button></Show>
      </div>
    </>
  )
}

// ---------- 自定义供应商 ----------

type Card = { id: string; name: string; reasoning: boolean; image: boolean }

function toCards(v: unknown): Card[] {
  const rec = (v as Record<string, { name?: string }> | undefined) ?? {}
  const list = Object.entries(rec).map(([k, m]) => ({ id: k, name: m?.name ?? k, reasoning: false, image: false }))
  return list.length ? list : [{ id: "", name: "", reasoning: false, image: false }]
}

function CustomModal(props: { arg?: ModalArg }) {
  const existing = props.arg?.provider ? (((store.config().provider as unknown as Record<string, Record<string, unknown>> | undefined)?.[props.arg.provider]) ?? {}) : {}
  const str = (v: unknown, def = "") => (typeof v === "string" ? v : def)
  const opts = (existing.options as Record<string, unknown> | undefined) ?? {}
  const [id, setId] = createSignal(str(existing.id) || props.arg?.provider || "")
  const [name, setName] = createSignal(str(existing.name))
  const [sdk, setSdk] = createSignal(str(existing.npm) || "@ai-sdk/openai-compatible")
  const [base, setBase] = createSignal(str(opts.baseURL))
  const [key, setKey] = createSignal(str(opts.apiKey))
  const [cards, setCards] = createSignal<Card[]>(toCards(existing.models))
  async function save() {
    if (!id().trim() || !/^[a-z0-9._-]+$/.test(id().trim())) return store.notify("Provider ID 需为小写字母/数字/连字符")
    const cfg: Record<string, unknown> = { npm: sdk() }
    if (name().trim()) cfg.name = name().trim()
    const options: Record<string, string> = {}
    if (base().trim()) options.baseURL = base().trim()
    if (key().trim()) options.apiKey = key().trim()
    if (Object.keys(options).length) cfg.options = options
    const models = Object.fromEntries(cards().filter((c) => c.id.trim()).map((c) => [c.id.trim(), { name: c.name || c.id, ...(c.reasoning ? { options: { reasoning: true } } : {}) }]))
    if (Object.keys(models).length) cfg.models = models
    const ok = await saveConfig({ provider: { [id().trim()]: cfg } })
    if (ok) {
      closeModal()
      await store.refresh()
      store.notify("自定义供应商已保存 · 请在选择器中确认模型")
    }
  }
  return (
    <>
      <Head title={props.arg?.provider ? `编辑自定义供应商 ${props.arg.provider}` : "添加自定义供应商"} />
      <div class="mbody">
        <div class="grid2">
          <div class="field"><label>Provider ID</label><input placeholder="my-provider" value={id()} onInput={(e) => setId(e.currentTarget.value)} disabled={Boolean(props.arg?.provider)} /><div class="hint">小写字母/数字/连字符；编辑时不可修改</div></div>
          <div class="field"><label>显示名称</label><input placeholder="My Provider" value={name()} onInput={(e) => setName(e.currentTarget.value)} /></div>
        </div>
        <div class="grid2">
          <div class="field"><label>SDK 包（协议）</label>
            <select value={sdk()} onChange={(e) => setSdk(e.currentTarget.value)}>
              <option value="@ai-sdk/openai-compatible">@ai-sdk/openai-compatible（OpenAI Compatible）</option>
              <option value="@ai-sdk/openai">@ai-sdk/openai（OpenAI Responses）</option>
              <option value="@ai-sdk/anthropic">@ai-sdk/anthropic（Anthropic Messages）</option>
            </select>
          </div>
          <div class="field"><label>Base URL</label><input placeholder="https://api.example.com/v1" value={base()} onInput={(e) => setBase(e.currentTarget.value)} /><div class="hint">需 http(s):// 前缀</div></div>
        </div>
        <div class="field"><label>API Key</label><input type="password" placeholder="留空 = 无需密钥（本地模型）" value={key()} onInput={(e) => setKey(e.currentTarget.value)} /></div>
        <div style="display:flex;align-items:center;margin:16px 0 8px"><b style="font-size:12.5px">模型</b><button class="btn sm" style="margin-left:auto" onClick={() => setCards((list) => [...list, { id: "", name: "", reasoning: false, image: false }])}>＋ 添加模型</button></div>
        <For each={cards()}>
          {(c, i) => (
            <div class="mcard">
              <div class="mc-grid">
                <div><label>Model ID</label><input value={c.id} onInput={(e) => setCard(i(), "id", e.currentTarget.value)} /></div>
                <div><label>显示名称</label><input value={c.name} onInput={(e) => setCard(i(), "name", e.currentTarget.value)} /></div>
                <div class="cbs"><label><input type="checkbox" checked={c.reasoning} onChange={(e) => setCard(i(), "reasoning", e.currentTarget.checked)} /> 支持推理</label></div>
                <div class="cbs"><label><input type="checkbox" checked={c.image} onChange={(e) => setCard(i(), "image", e.currentTarget.checked)} /> 支持图片</label><button class="btn sm" onClick={() => setCards((list) => list.filter((_, j) => j !== i()))}>✕</button></div>
              </div>
            </div>
          )}
        </For>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button class="btn sm" onClick={() => setCards((list) => list.map((x) => ({ ...x, reasoning: true })))}>全部支持推理</button>
          <button class="btn sm" onClick={() => setCards((list) => list.map((x) => ({ ...x, image: true })))}>全部支持图片</button>
        </div>
        <div class="field"><label>API Key 环境变量引用 <span class="opt">可选</span></label><input placeholder='{"{env:MY_KEY}"}' /></div>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <button class="btn" onClick={() => void openProjectConfig()}>高级：直接编辑配置</button>
        <button class="btn primary" onClick={() => void save()}>保存</button>
      </div>
    </>
  )
  function setCard(i: number, k: keyof Card, v: string | boolean) {
    setCards((list) => list.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
  }
  async function openProjectConfig() {
    const { openPath } = await import("../host")
    await openPath(directory() + "/.kilo/config.json")
  }
}

// ---------- MCP ----------

function McpModal(props: { arg?: ModalArg }) {
  const isEdit = Boolean(props.arg?.mcp)
  const [name, setName] = createSignal(props.arg?.mcp ?? "")
  const [transport, setTransport] = createSignal<"http" | "sse" | "stdio">("http")
  const [url, setUrl] = createSignal("https://")
  const [cmd, setCmd] = createSignal("npx")
  const [args, setArgs] = createSignal("-y\n@upstash/context7-mcp")
  async function save() {
    const c = client()
    if (!c || !directory()) return store.notify("先选择项目")
    if (!name().trim()) return store.notify("请填写名称")
    const config = transport() === "stdio" ? { type: "local" as const, command: [cmd().trim(), ...args().split(/\n+/).filter(Boolean)] } : { type: "remote" as const, url: url().trim() }
    const err = await c.mcp.add({ name: name().trim(), config, directory: directory() }).then(() => "").catch((e: Error) => e.message)
    closeModal()
    if (err) return store.notify("保存失败：" + err)
    store.notify("MCP 配置已保存 · 正在重连…")
  }
  async function del() {
    try {
      await (await import("../host")).removeMcp(directory(), name())
      closeModal()
      store.notify("已删除（二次确认）")
    } catch (e) {
      store.notify("删除失败：" + String(e))
    }
  }
  return (
    <>
      <Head title={isEdit ? `编辑 MCP Server：${name()}` : "添加 MCP Server"} />
      <div class="mbody">
        <div class="field"><label>名称</label><input value={name()} disabled={isEdit} placeholder="context7" onInput={(e) => setName(e.currentTarget.value)} /></div>
        <div class="field">
          <label>传输类型</label>
          <select value={transport()} onChange={(e) => setTransport(e.currentTarget.value as unknown as "http" | "sse" | "stdio")}>
            <option value="http">http（远程 URL）</option><option value="sse">sse（远程 URL）</option><option value="stdio">stdio（本地命令）</option>
          </select>
          <div class="hint">也可直接编辑 <code class="inline">.kilo/config.json</code> 的 mcp 段，或从市场安装</div>
        </div>
        <Show when={transport() !== "stdio"} fallback={
          <>
            <div class="field"><label>Command</label><input style="font-family:var(--mono);font-size:11.5px" value={cmd()} onInput={(e) => setCmd(e.currentTarget.value)} /></div>
            <div class="field"><label>Args <span class="opt">（每行一个）</span></label><textarea value={args()} onInput={(e) => setArgs(e.currentTarget.value)} /></div>
          </>
        }>
          <div class="field"><label>URL</label><input style="font-family:var(--mono);font-size:11.5px" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} /></div>
        </Show>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <Show when={isEdit}><button class="btn danger" onClick={() => void del()}>删除</button></Show>
        <button class="btn primary" onClick={() => void save()}>保存</button>
      </div>
    </>
  )
}

// ---------- 市场 ----------

type Preset = { id: string; name: string; desc: string; url?: string; command?: string[] }
const MARKET = {
  mcp: [
    { id: "context7", name: "Context7", desc: "最新库文档检索 · by upstash", url: "https://mcp.context7.com/mcp" },
    { id: "playwright", name: "Playwright MCP", desc: "微软官方 · 浏览器自动化 · by microsoft", command: ["npx", "@playwright/mcp@latest"] },
    { id: "filesystem", name: "Filesystem", desc: "官方文件系统工具 · by modelcontextprotocol", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."] },
    { id: "github", name: "GitHub", desc: "仓库/Issue/PR · 需 OAuth", url: "https://api.githubcopilot.com/mcp/" },
  ] as Preset[],
  agent: [{ id: "security-reviewer", name: "security-reviewer", desc: "安全审查子代理 · 分类: 质量 · by kilo" }],
  skill: [{ id: "godot", name: "godot-gdscript-patterns", desc: "Godot 4 GDScript 模式 · by community" }],
}
const [skillInstalled] = createSignal(savedSkills())
function savedSkills() {
  return JSON.parse(localStorage.getItem("market.skills") ?? "[]") as unknown as string[]
}

function MarketModal() {
  const [q, setQ] = createSignal("")
  const [type, setType] = createSignal<"mcp" | "agent" | "skill">("mcp")
  return (
    <>
      <Head title="市场 · MCP / Agent / Skill" />
      <div class="mbody">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          <input class="tinp" style="flex:1;min-width:160px;width:auto" placeholder="搜索市场…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <For each={["mcp", "agent", "skill"] as const}>
            {(t) => <button class="btn sm" classList={{ primary: false }} style={t === type() ? "background:#e7efff;border-color:#cddcfb" : undefined} onClick={() => setType(t)}>{t === "mcp" ? "MCP" : t === "agent" ? "Agent" : "Skill"}</button>}
          </For>
          <label style="font-size:11.5px;color:var(--muted)"><input type="checkbox" checked /> 与当前项目相关</label>
        </div>
        <Show when={type() === "mcp"}>
          <For each={MARKET.mcp.filter((x) => !q() || x.name.toLowerCase().includes(q().toLowerCase()))}>
            {(x) => (
              <div class="market-card">
                <span class="picon">🧩</span>
                <div class="inf"><b>{x.name}</b> <span class="badge gray">mcp</span><div class="d">{x.desc}</div></div>
                <button class="btn sm primary" onClick={() => openModal("install", { item: x.id })}>安装</button>
              </div>
            )}
          </For>
        </Show>
        <Show when={type() === "agent"}>
          <For each={MARKET.agent}>
            {(x) => (
              <div class="market-card">
                <span class="picon">🕵</span>
                <div class="inf"><b>{x.name}</b> <span class="badge gray">agent</span><div class="d">{x.desc}</div></div>
                <button class="btn sm" onClick={() => void installAgent(x.id, x.desc)}>安装</button>
              </div>
            )}
          </For>
        </Show>
        <Show when={type() === "skill"}>
          <For each={MARKET.skill}>
            {(x) => (
              <div class="market-card">
                <span class="picon">📘</span>
                <div class="inf"><b>{x.name}</b> <span class="badge gray">skill</span><Show when={skillInstalled().includes(x.id)}><span class="badge ok">已安装 · global</span></Show><div class="d">{x.desc}</div></div>
                <Show when={skillInstalled().includes(x.id)} fallback={<button class="btn sm" onClick={() => void openUrl("https://github.com/Kilo-Org/kilo-marketplace")}>安装</button>}>
                  <button class="btn sm danger" onClick={() => store.notify("已确认卸载（global 作用域）· P2 后端支持")}>移除</button>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <div class="faint-note">想贡献条目？→ github.com/Kilo-Org/kilo-marketplace</div>
      </div>
    </>
  )
  async function installAgent(id: string, desc: string) {
    if (!directory()) return store.notify("先选择项目")
    await writeAgent(directory(), id, desc.split(" · ")[0] ?? "", `你是 ${id}。` + desc)
    store.notify(`已安装到项目 .kilo/agent/${id}.md`)
    await store.refresh()
  }
}

function InstallModal(props: { arg?: ModalArg }) {
  const item = () => MARKET.mcp.find((x) => x.id === props.arg?.item) ?? MARKET.mcp[0]
  const [scope, setScope] = createSignal<"project" | "global">("project")
  const [method, setMethod] = createSignal<"npx" | "docker">("npx")
  async function install() {
    const c = client()
    if (!c || !directory()) return store.notify("先选择项目")
    const x = item()
    const config = x.url ? { type: "remote" as const, url: x.url } : { type: "local" as const, command: [...(x.command ?? [])] }
    const err = await c.mcp.add({ name: x.id, config, directory: directory() }).then(() => "").catch((e: Error) => e.message)
    closeModal()
    if (err) return store.notify("安装失败：" + err)
    localStorage.setItem("market.skills", JSON.stringify([...savedSkills(), x.id]))
    store.notify("安装成功 → .kilo/config.json · 已自动连接（绿点）")
  }
  return (
    <>
      <Head title={`安装 ${item().name}`} />
      <div class="mbody">
        <div class="field">
          <label>安装作用域</label>
          <div style="display:flex;gap:8px">
            <button classList={{ btn: true, sm: true, primary: scope() === "project" }} onClick={() => setScope("project")}>项目（当前工作区）</button>
            <button classList={{ btn: true, sm: true }} onClick={() => setScope("global")}>全局</button>
          </div>
          <div class="hint">写入目标：<code class="inline">.kilo/config.json → mcp.{item().id}</code>（全局为 ~/.config/kilo/kilo.json）</div>
        </div>
        <div class="field">
          <label>安装方式</label>
          <select value={method()} onChange={(e) => setMethod(e.currentTarget.value as unknown as "npx" | "docker")}>
            {item().command ? (
              <>
                <option value="npx">{item().command!.join(" ")}（推荐）</option>
                <option value="docker">docker run mcp/{item().id}</option>
              </>
            ) : (
              <option value="npx">{item().url}</option>
            )}
          </select>
        </div>
        <div class="notice warn">⚠ MCP server 以你的用户权限运行外部进程，安装前请确认来源可信。</div>
        <b style="font-size:12px">前置条件</b>
        <ul style="font-size:11.5px;color:var(--muted);margin:6px 0 12px 18px"><li>Node.js ≥ 18</li></ul>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <button class="btn primary" onClick={() => void install()}>安装</button>
      </div>
    </>
  )
}

// ---------- 云端导入 ----------

function CloudImportModal() {
  const [raw, setRaw] = createSignal("")
  const id = () => {
    const m = /(ses_[\w-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw())
    return m?.[1]
  }
  const isLegacy = () => (id()?.length ?? 0) === 36 && !id()!.startsWith("ses_")
  async function importSession() {
    const c = client()
    if (!c || !id()) return store.notify("粘贴 kilo.ai 链接或会话 ID")
    const res = await c.kilo.cloud.session.import({ sessionId: id()!, directory: directory() }).catch((e: Error) => {
      store.notify("导入失败：" + e.message)
    })
    if (!res) return
    closeModal()
    await store.refresh()
    store.notify("已导入为新会话（含完整消息与附件）")
  }
  return (
    <>
      <Head title="导入云端会话" />
      <div class="mbody">
        <div class="field">
          <label>粘贴会话链接或 ID</label>
          <textarea placeholder="https://kilo.ai/s/ses_abc123… 或 ses_abc123 / UUID" value={raw()} onInput={(e) => setRaw(e.currentTarget.value)} />
          <div class="hint">自动提取 ses_* / UUID；{isLegacy() ? "旧版 UUID 云端会话不支持导入" : "识别到：" + (id() ?? "—")}</div>
        </div>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <button class="btn primary" disabled={!id() || isLegacy()} onClick={() => void importSession()}>导入</button>
      </div>
    </>
  )
}

// ---------- 反馈 ----------

function FeedbackModal() {
  return (
    <>
      <Head title="反馈" />
      <div class="mbody" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn" style="justify-content:center;padding:12px" onClick={() => void openUrl("https://github.com/Kilo-Org/kilocode/issues")}>🐙 提交 GitHub Issue</button>
        <button class="btn" style="justify-content:center;padding:12px" onClick={() => void openUrl("https://discord.gg/kilo")}>💬 Discord 社区</button>
        <button class="btn" style="justify-content:center;padding:12px" onClick={() => void openUrl("https://kilo.ai/support")}>🛟 联系支持</button>
      </div>
    </>
  )
}

// ---------- 助理编辑 ----------

function AgentModal(props: { arg?: ModalArg }) {
  const name = () => props.arg?.name ?? ""
  const [handle, setHandle] = createSignal(name())
  const [desc, setDesc] = createSignal("")
  const [body, setBody] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  if (name()) void loadAgent(name()).then((a) => { setDesc(a.desc); setBody(a.body) })
  async function save() {
    const id = handle().trim()
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return store.notify("名称仅支持字母数字与 -_.")
    if (!directory()) return store.notify("请先选择项目文件夹")
    setBusy(true)
    const err = await writeAgent(directory(), id, desc(), body()).catch((x: unknown) => String(x))
    setBusy(false)
    if (err) return store.notify("保存失败：" + err)
    closeModal()
    await store.refresh()
    store.notify(`助理「${id}」已保存到 .kilo/agent`)
  }
  return (
    <>
      <Head title={name() ? `编辑助理 ${name()}` : "新建助理"} />
      <div class="mbody">
        <Show when={!name()}>
          <div class="field"><label>英文标识（同名覆盖）</label><input value={handle()} onInput={(e) => setHandle(e.currentTarget.value)} /></div>
        </Show>
        <div class="field"><label>一句话描述</label><input value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} /></div>
        <div class="field"><label>系统提示词</label><textarea rows={8} placeholder="行为、约束、风格…" value={body()} onInput={(e) => setBody(e.currentTarget.value)} /></div>
      </div>
      <div class="mfoot">
        <button class="btn" onClick={closeModal}>取消</button>
        <button class="btn primary" disabled={busy()} onClick={() => void save()}>保存到 .kilo/agent</button>
      </div>
    </>
  )
}

async function loadAgent(name: string) {
  const c = client()
  if (!c) return { desc: "", body: "" }
  const res = await c.v2.fs.read({ location: { directory: directory() }, path: `.kilo/agent/${name}.md` }).catch(() => undefined)
  const raw = res?.data instanceof Blob ? await res.data.text() : ""
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw)
  return {
    desc: fm?.[1]?.match(/description:\s*(.+)/)?.[1]?.trim() ?? "",
    body: fm ? raw.slice(fm[0].length + 1) : raw,
  }
}
