import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js"
import type { Config, Path, PermissionAction } from "@kilocode/sdk/v2/types"
import { Puzzle, Trash2, BookOpen } from "lucide-solid"
import { client, directory, forget, info, ready, recents, setDirectory } from "../client"
import { health } from "../backend"
import { saveConfig, store, type ModelRef } from "../store"
import { openModal, setTabFromExternal } from "../ui"
import { openPath, openUrl, pickDir, removeMcp, restartBackend } from "../host"
import { permLevel, permPatterns, withLevel, withPattern, withoutPattern, type PermKey } from "../perm"

type Tab = "models" | "providers" | "behaviour" | "approve" | "browser" | "checkpoints" | "display" | "context" | "commit" | "indexing" | "experimental" | "sandbox" | "language" | "about"

const TABS: [Tab, string][] = [
  ["models", "模型"], ["providers", "供应商"], ["behaviour", "代理行为"], ["approve", "自动批准"], ["browser", "浏览器 / Web"], ["checkpoints", "检查点"], ["display", "显示"], ["context", "上下文"], ["commit", "提交信息"], ["indexing", "索引"], ["experimental", "实验性"], ["sandbox", "沙箱"], ["language", "语言"], ["about", "关于"],
]

// ---------- 桌面 UI 态（localStorage） ----------

function ui(key: string, def: string) {
  const [v, set] = createSignal(localStorage.getItem("ui." + key) ?? def)
  return {
    get: v,
    set(next: string) {
      set(next)
      localStorage.setItem("ui." + key, next)
    },
  }
}

// ---------- 后端 Config 读写（点分路径，运行时守卫，深合并顶层键） ----------

function at(o: unknown, k: string): unknown {
  if (!o || typeof o !== "object") return undefined
  const box: Record<string, unknown> = { ...o }
  return box[k]
}
function getCfg(path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => at(o, k), store.config())
}
function cfgBool(path: string, def = false) { const v = getCfg(path); return typeof v === "boolean" ? v : def }
function cfgStr(path: string, def = "") { const v = getCfg(path); return typeof v === "string" ? v : def }
function cfgNum(path: string, def = 0) { const v = getCfg(path); return typeof v === "number" ? v : def }
function cfgStrs(path: string) { const v = getCfg(path); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [] }
function cfgFlags(path: string) {
  const v = getCfg(path)
  const out: Record<string, boolean> = {}
  if (v && typeof v === "object") {
    const box: Record<string, unknown> = { ...v }
    for (const k of Object.keys(box)) { const b = box[k]; if (typeof b === "boolean") out[k] = b }
  }
  return out
}
function setPath(path: string[], value: unknown, base: Record<string, unknown>): Record<string, unknown> {
  const [head, ...rest] = path
  if (!head) return base
  if (!rest.length) return { ...base, [head]: value }
  const child = base[head]
  return { ...base, [head]: setPath(rest, value, child && typeof child === "object" ? { ...child } : {}) }
}
async function saveCfg(path: string, value: unknown) {
  const keys = path.split(".")
  const root = keys[0]
  if (keys.length === 1) return saveConfig({ [root]: value })
  const cur = at(store.config(), root)
  const base = cur && typeof cur === "object" ? { ...cur } : {}
  return saveConfig({ [root]: setPath(keys.slice(1), value, base) })
}

const [tab, setTab] = createSignal<Tab>("models")
setTabFromExternal((t) => {
  const hit = TABS.find(([id]) => id === t)
  if (hit) setTab(hit[0])
})

export function Settings() {
  return (
    <section class="view show">
      <div class="settings">
        <div class="set-nav">
          <For each={TABS}>{([t, name]) => <button classList={{ active: tab() === t }} onClick={() => setTab(t)}>{name}</button>}</For>
          <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px">
            <button class="btn sm" style="width:100%;margin-bottom:6px" onClick={() => void openProjectConfig()}>项目配置</button>
            <button class="btn sm" style="width:100%" onClick={() => void reloadInstance()}>⟳ 重载</button>
          </div>
        </div>
        <div class="set-body">
          {tab() === "models" && <ModelsTab />}
          {tab() === "providers" && <ProvidersTab />}
          {tab() === "behaviour" && <BehaviourTab />}
          {tab() === "approve" && <ApproveTab />}
          {tab() === "browser" && <BrowserTab />}
          {tab() === "checkpoints" && <CheckpointsTab />}
          {tab() === "display" && <DisplayTab />}
          {tab() === "context" && <ContextTab />}
          {tab() === "commit" && <CommitTab />}
          {tab() === "indexing" && <IndexingTab />}
          {tab() === "experimental" && <ExperimentalTab />}
          {tab() === "sandbox" && <SandboxTab />}
          {tab() === "language" && <LanguageTab />}
          {tab() === "about" && <AboutTab />}
        </div>
      </div>
    </section>
  )
}

async function openProjectConfig() {
  if (!directory()) return store.notify("请先选择项目")
  await openPath(directory() + "/.kilo/config.json")
}

async function reloadInstance() {
  const c = client()
  if (!c) return
  await c.instance.reload({ directory: directory() }).catch(() => undefined)
  await store.refresh()
  store.notify("已重载配置 / Skills / Agents / Commands")
}

// ---------- 小控件 ----------

function Sw(props: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button classList={{ switch: true, on: props.on }} style={props.disabled ? "opacity:.45" : undefined} onClick={() => !props.disabled && props.onChange(!props.on)}>
      <i />
    </button>
  )
}

function CfgSw(props: { path: string; disabled?: boolean; fallback?: boolean }) {
  return <Sw disabled={props.disabled} on={cfgBool(props.path, props.fallback ?? false)} onChange={(v) => void saveCfg(props.path, v)} />
}

function CfgSel(props: { path: string; options: { v: string; label?: string }[]; fallback?: string }) {
  const cur = () => cfgStr(props.path, props.fallback ?? props.options[0].v)
  return (
    <select class="sel" value={cur()} onChange={(e) => void saveCfg(props.path, e.currentTarget.value)}>
      <For each={props.options}>{(o) => <option value={o.v}>{o.label ?? o.v}</option>}</For>
    </select>
  )
}

function Row(props: { n: string; d?: string; children?: JSX.Element }) {
  return (
    <div class="srow">
      <div class="l">
        <div class="n">{props.n}</div>
        <Show when={props.d}><div class="d">{props.d}</div></Show>
      </div>
      <div class="c">{props.children}</div>
    </div>
  )
}

function Group(props: { name?: string; children?: JSX.Element }) {
  return (
    <div class="sgroup">
      {props.name && <div class="gh">{props.name}</div>}
      {props.children}
    </div>
  )
}

function modelOpts() {
  const out: { v: string; label: string }[] = [{ v: "", label: "跟随供应商默认" }]
  for (const p of store.providers().all) {
    if (!store.providers().connected.includes(p.id)) continue
    for (const m of Object.values(p.models)) out.push({ v: `${p.id}/${m.id}`, label: `${m.name}（${p.name}）` })
  }
  return out
}

// ---------- 模型 ----------

function ModelsTab() {
  const cur = () => (store.model() ? `${store.model()!.providerID}/${store.model()!.modelID}` : "")
  const [small, setSmall] = createSignal(store.config().small_model ?? "")
  return (
    <>
      <h3>模型</h3>
      <div class="slead">默认模型与各角色模型覆盖；供应商密钥在「供应商」页管理</div>
      <Group name="角色模型">
        <Row n="默认对话模型" d="聊天输入框未显式选择时使用（写入全局 kilo.json model）">
          <select class="sel" value={cur()} onChange={(e) => {
            const v = e.currentTarget.value
            const m: ModelRef | undefined = v ? { providerID: v.split("/")[0], modelID: v.split("/").slice(1).join("/") } : undefined
            store.setModel(m, false)
            void saveConfig({ model: v || undefined })
          }}>
            <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label}</option>}</For>
          </select>
        </Row>
        <Row n="小模型" d="标题生成/摘要等轻任务">
          <select class="sel" value={small()} onChange={(e) => { setSmall(e.currentTarget.value); void saveConfig({ small_model: e.currentTarget.value || undefined }) }}>
            <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label || "默认"}</option>}</For>
          </select>
        </Row>
        <Row n="子代理模型" d="Task 派生子代理使用（写入 subagent_model）">
          <select class="sel" value={cfgStr("subagent_model")} onChange={(e) => void saveCfg("subagent_model", e.currentTarget.value || undefined)}>
            <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label || "（沿用对话模型）"}</option>}</For>
          </select>
        </Row>
        <Row n="子代理推理变体">
          <select class="sel" value={cfgStr("subagent_variant")} onChange={(e) => void saveCfg("subagent_variant", e.currentTarget.value || undefined)}>
            <option value="">默认</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
          </select>
        </Row>
        <Show when={cur()}>
          <Row n="推理变体" d="默认对话模型的档位">
            <VariantSelect model={() => store.model()} />
          </Row>
        </Show>
      </Group>
      <Group name="辅助模型">
        <Row n="自动补全模型" d="Ghost text 行内补全（桌面 UI 态）">
          <select class="sel" value={ui("completionModel", "").get()} onChange={(e) => ui("completionModel", "").set(e.currentTarget.value)}>
            <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label || "（不启用）"}</option>}</For>
          </select>
        </Row>
        <Row n="语音转文字模型" d="push-to-talk 使用，需登录 Kilo（experimental.speech_to_text_model）">
          <input class="tinp" placeholder="whisper-1" value={cfgStr("experimental.speech_to_text_model")} onInput={(e) => void saveCfg("experimental.speech_to_text_model", e.currentTarget.value || undefined)} />
        </Row>
        <Row n="隐藏 prompt-training 模型" d="不在选择器展示训练用途模型（hide_prompt_training_models）"><CfgSw path="hide_prompt_training_models" fallback={false} /></Row>
      </Group>
      <Group name="按模式（Code/Plan/Ask）的模型覆盖">
        <For each={["code", "plan", "ask"]}>
          {(mode) => <ModeModelRow mode={mode} />}
        </For>
      </Group>
    </>
  )
}

function VariantSelect(props: { model: () => ModelRef | undefined }) {
  const opts = () => {
    const m = props.model()
    if (!m) return []
    return Object.keys(store.providers().all.find((p) => p.id === m.providerID)?.models[m.modelID]?.variants ?? {})
  }
  return (
    <Show when={opts().length} fallback={<span class="tag">默认</span>}>
      <select class="sel" onChange={(e) => {
        const m = props.model()
        if (!m) return
        store.setModel({ ...m, variant: e.currentTarget.value || undefined }, false)
      }}>
        <option value="">默认</option>
        <For each={opts()}>{(v) => <option value={v}>{v}</option>}</For>
      </select>
    </Show>
  )
}

function ModeModelRow(props: { mode: string }) {
  const key = "modeModel." + props.mode
  const initial = store.config().agent?.[props.mode]?.model ?? ""
  const [v, setV] = createSignal(localStorage.getItem("ui." + key) ?? initial)
  return (
    <Row n={`${props.mode} 模式模型`} d="覆盖该模式默认模型（写入 kilo.json agent 段）">
      <select class="sel" value={v()} onChange={(e) => {
        setV(e.currentTarget.value)
        localStorage.setItem("ui." + key, e.currentTarget.value)
        void saveConfig({ agent: { [props.mode]: { model: e.currentTarget.value || undefined } } })      }}>
        <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label || "默认"}</option>}</For>
      </select>
    </Row>
  )
}

// ---------- 供应商 ----------

function ProvidersTab() {
  const all = () => store.providers()
  const conn = () => new Set(all().connected)
  const disabled = () => cfgStrs("disabled_providers")
  const prof = () => store.profile()
  const srcLabel = (s: string) => (s === "custom" ? "自定义" : s === "oauth" ? "OAuth" : s === "local" ? "本地" : "API Key")
  const POPULAR = ["kilo", "anthropic", "deepseek", "openai", "google", "openrouter", "vercel"]
  const popular = () => {
    const free = all().all.filter((x) => !conn().has(x.id) && !disabled().includes(x.id))
    const top = POPULAR.map((id) => free.find((x) => x.id === id)).filter((x): x is (typeof free)[number] => Boolean(x))
    return [...top, ...free.filter((x) => !POPULAR.includes(x.id)).slice(0, 8)]
  }
  return (
    <>
      <h3>供应商</h3>
      <div class="slead">Kilo Gateway 统一路由，或直连任意供应商（BYOK）</div>
      <Group name="Kilo Gateway">
        <Row n={prof()?.loggedIn ? `已登录 · ${prof()!.email ?? "Kilo"}` : "未登录 Kilo Gateway"} d={prof()?.loggedIn ? `${prof()!.tier ?? "Personal"} 组织 · 余额 ${prof()!.balance != null ? "$" + prof()!.balance!.toFixed(2) : "—"}` : "登录以使用统一路由 / 云端会话同步；本地 BYOK 不依赖登录"}>
          <span classList={{ badge: true, ok: Boolean(prof()?.loggedIn), gray: !prof()?.loggedIn }}>{prof()?.loggedIn ? "✓ 已连接 · 统一路由/用量统计" : "未连接"}</span>
          <Show when={!prof()?.loggedIn}><button class="btn sm" onClick={() => store.setView("profile")}>登录</button></Show>
        </Row>
      </Group>
      <Group name="已连接">
        <For each={all().all.filter((x) => conn().has(x.id))}>
          {(x) => (
            <Row n={x.name} d={`${srcLabel(x.source)} 直连 · ${Object.keys(x.models).length} 模型`}>
              <span class="badge gray">{x.source}</span>
              <Show when={x.source === "custom"}><button class="btn sm" onClick={() => openModal("custom", { provider: x.id })}>编辑</button></Show>
              <button class="btn sm danger" onClick={() => void disconnect(x.id)}>断开</button>
            </Row>
          )}
        </For>
        <Show when={!all().all.filter((x) => conn().has(x.id)).length}><div class="empty">未连接供应商</div></Show>
      </Group>
      <Group name="热门">
        <For each={popular()}>
          {(x) => (
            <Row n={x.name} d={x.env.length ? `可用环境变量 ${x.env.join(", ")}` : "API 密钥 / OAuth"}>
              <button class="btn sm primary" onClick={() => openModal("provider", { provider: x.id })}>连接</button>
            </Row>
          )}
        </For>
        <Row n="＋ 添加自定义供应商" d="OpenAI Compatible / Responses / Anthropic Messages 协议；保存后自动拉取 /models">
          <button class="btn sm" onClick={() => openModal("custom")}>添加</button>
        </Row>
      </Group>
      <Group name="已禁用供应商">
        <Row n="禁用列表" d="禁用后不出现在选择器与热门（disabled_providers）">
          <div class="taglist">
            <Show when={disabled().length} fallback={<span style="color:var(--faint);font-size:11px">无</span>}>
              <For each={disabled()}>{(d, i) => <span class="tag">{d} <span class="x" title="启用（移出禁用）" onClick={() => void saveCfg("disabled_providers", disabled().filter((_, j) => j !== i()))}>启用</span></span>}</For>
            </Show>
            <select class="tri" value="" onChange={(e) => { const v = e.currentTarget.value; if (v) void saveCfg("disabled_providers", [...disabled(), v]) }}>
              <option value="">＋ 禁用…</option>
              <For each={all().all.filter((x) => !conn().has(x.id) && !disabled().includes(x.id))}>{(x) => <option value={x.id}>{x.name}</option>}</For>
            </select>
          </div>
        </Row>
      </Group>
    </>
  )
  async function disconnect(id: string) {
    const c = client()
    if (!c) return
    await c.auth.remove({ providerID: id }).catch((e: Error) => store.notify("断开失败：" + e.message))
    await store.refresh()
    store.notify(`${id} 已断开（密钥已清除）`)
  }
}

// ---------- 代理行为 ----------

function BehaviourTab() {
  const subs = ["Agents", "MCP Servers", "Rules", "Workflows", "Skills"] as const
  const [cur, setCur] = createSignal<(typeof subs)[number]>("Agents")
  const [tick, setTick] = createSignal(0)
  const src = () => (ready() ? [tick(), directory()] : undefined)
  const [skills] = createResource(src, async () => (await client()!.v2.skill.list({ location: { directory: directory() } }))?.data?.data ?? [])
  const [mcp] = createResource(src, async () => Object.entries((await client()!.mcp.status({ directory: directory() }))?.data ?? {}))
  const [cmds] = createResource(src, async () => (await client()!.command.list({ directory: directory() }))?.data ?? [])
  const [sources] = createResource(src, async () => ((await client()!.config.sources({ directory: directory() }))?.data?.sources ?? []).map((s) => s.path ?? s.label))
  return (
    <>
      <h3>代理行为</h3>
      <div class="slead">Agents / MCP Servers / Rules / Workflows / Skills 五个子页</div>
      <div class="subtabs">
        <For each={subs}>{(t) => <button classList={{ subtab: true, active: cur() === t }} onClick={() => setCur(t)}>{t}</button>}</For>
      </div>
      {cur() === "Agents" && (
        <Group name="Agents">
          <Row n="默认代理" d="新会话使用的模式（写入 default_agent）">
            <select class="sel" value={cfgStr("default_agent")} onChange={(e) => void saveCfg("default_agent", e.currentTarget.value || undefined)}>
              <option value="">自动</option>
              <For each={store.agents().filter((a) => a.mode !== "subagent")}>{(a) => <option value={a.id}>{a.id}</option>}</For>
            </select>
          </Row>
          <div class="srow">
            <div class="c" style="width:100%">
              <button class="btn sm" onClick={importMode}>⤒ 导入 Mode</button>
              <button class="btn sm" onClick={() => openModal("market")}><Puzzle size={12} strokeWidth={1.8} style="vertical-align:-2px;margin-right:4px" />浏览市场</button>
              <button class="btn sm primary" onClick={() => openModal("agent", { name: "" })}>＋ 新建模式</button>
            </div>
          </div>
          <For each={store.agents()}>
            {(a) => (
              <div class="srow">
                <div class="l">
                  <div class="n">
                    {a.id}{" "}
                    <span classList={{ badge: true, gray: a.builtIn && a.mode !== "subagent", run: a.mode === "subagent", ok: !a.builtIn }}>
                      {a.builtIn ? (a.mode === "subagent" ? "内置 · 子代理" : "内置 · 主代理") : "自定义 · 主代理"}
                    </span>
                  </div>
                  <div class="d">{a.description ?? ""}</div>
                </div>
                <div class="c">
                  <button class="btn sm" onClick={() => openModal("agent", { name: a.id })}>编辑</button>
                  <button class="btn sm" title={`导出 ${a.id}.agent.json`} onClick={() => void exportAgent(a.id)}>⤓</button>
                  <Show when={!a.builtIn}><button class="btn sm danger" onClick={() => void rmAgent(a.id)}>🗑</button></Show>
                </div>
              </div>
            )}
          </For>
        </Group>
      )}
      {cur() === "MCP Servers" && (
        <>
          <div class="sgroup">
            <div class="gh">MCP Servers
              <button class="btn sm primary" style="margin-left:auto" onClick={() => openModal("market")}><Puzzle size={12} strokeWidth={1.8} style="vertical-align:-2px;margin-right:4px" />市场安装</button>
              <button class="btn sm" onClick={() => openModal("mcp", {})}>＋ 手动添加</button>
            </div>
            <For each={mcp() ?? []}>
              {([name, st]) => {
                const status = st.status
                const dot = status === "connected" ? "g" : status === "failed" ? "r" : status === "needs_auth" ? "o" : "gr"
                return (
                  <div class="srow">
                    <span class="dot" classList={{ g: dot === "g", r: dot === "r", o: dot === "o", gr: dot === "gr" }} title={status} />
                    <div class="l">
                      <div class="n">{name}</div>
                      <div class="d" style="font-family:var(--mono)">{"error" in st ? st.error : status}</div>
                    </div>
                    <div class="c">
                      <Show when={status === "needs_auth"}><button class="btn sm" onClick={() => void connectMcp(name)}>Sign in</button></Show>
                      <Sw on={status !== "disabled"} onChange={(v) => void toggleMcp(name, v)} />
                      <button class="btn sm" onClick={() => openModal("mcp", { mcp: name })}>编辑</button>
                      <button class="btn sm danger" onClick={() => void rm(name)}><Trash2 size={12} strokeWidth={1.8} /></button>
                    </div>
                  </div>
                )
              }}
            </For>
            <Show when={!mcp()?.length}>
              <div class="empty">暂无 MCP。stdio 用 command/args/env；http 与 sse 用 url（+headers）</div>
            </Show>
          </div>
        </>
      )}
      {cur() === "Rules" && (
        <Group name="Rules · 指令文件">
          <Row n="已加载指令" d="每次请求注入系统提示">
            <div class="taglist">
              <Show when={(sources() ?? []).length} fallback={<span style="color:var(--faint);font-size:11px">无</span>}>
                <For each={sources() ?? []}>{(s) => <span class="tag" style="cursor:pointer" onClick={() => void openPath(s)}>{s.split(/[\\/]/).at(-1)} ✎</span>}</For>
              </Show>
            </div>
          </Row>
          <Row n="添加指令文件" d="支持 glob 与 URL（AGENTS.md / .kilo/rules/*.md / CLAUDE.md 兼容）">
            <button class="btn sm" onClick={() => void (directory() ? openPath(directory()) : store.notify("先选项目"))}>＋ 添加</button>
          </Row>
          <Row n="Claude Code 兼容" d="读写 .claude/ 规则目录"><Sw on={ui("claudeCompat", "0").get() === "1"} onChange={(v) => ui("claudeCompat", "0").set(v ? "1" : "0")} /></Row>
        </Group>
      )}
      {cur() === "Workflows" && (
        <Group name="Workflows · 自定义命令">
          <For each={cmds() ?? []}>
            {(c) => (
              <Row n={"/" + c.name} d={c.description ?? ""}>
                <span class="badge gray">{c.source ?? "command"}</span>
                <button class="btn sm" onClick={() => store.notify("模板编辑：.kilo/command/*.md")}>模板</button>
              </Row>
            )}
          </For>
          <Show when={!cmds()?.length}><div class="empty">命令文件放 .kilo/command/*.md（项目）或 ~/.kilo/command/（全局）</div></Show>
        </Group>
      )}
      {cur() === "Skills" && (
        <>
          <div class="sgroup">
            <div class="gh">Skills <button class="btn sm" style="margin-left:auto" onClick={() => void import("../host").then((h) => h.openUrl("https://github.com/Kilo-Org/kilo-marketplace"))}><Puzzle size={12} strokeWidth={1.8} style="vertical-align:-2px;margin-right:4px" />浏览市场</button></div>
            <For each={skills() ?? []}>
              {(s) => (
                <div class="srow">
                  <span class="picon"><BookOpen size={14} strokeWidth={1.8} /></span>
                  <div class="l">
                    <div class="n">{s.name.replace(/\.md$/, "")} <span class="badge gray">{s.location.includes("/.kilo") || s.location.includes("\\.kilo") ? "project" : "global"}</span> <span class="badge gray">skill</span></div>
                    <div class="d">{s.description} · {s.location}</div>
                  </div>
                  <div class="c">
                    <Show when={s.location.includes("/.kilo") || s.location.includes("\\.kilo")}>
                      <button class="btn sm" onClick={() => void disable(s.location)}>停用</button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
          <Group name="Skill 加载路径">
            <Row n="Skill Paths" d="项目/全局技能目录"><div class="taglist"><span class="tag">.kilo/skills/</span><span class="tag">~/.kilo/skills/</span></div></Row>
            <Row n="Skill URLs" d="远程技能（git / http）"><div class="taglist"><button class="btn sm">＋添加</button></div></Row>
          </Group>
        </>
      )}
    </>
  )
  async function toggleMcp(name: string, on: boolean) {
    const c = client()
    if (!c || !directory()) return
    const req = { name, directory: directory() }
    await (on ? c.mcp.disconnect(req) : c.mcp.connect(req)).catch((e: Error) => store.notify("操作失败：" + e.message))
    setTick((t) => t + 1)
  }
  async function connectMcp(name: string) {
    await client()?.mcp.connect({ name, directory: directory() }).catch((e: Error) => store.notify("失败：" + e.message))
  }
  async function rm(name: string) {
    try {
      await removeMcp(directory(), name)
      store.notify("已删除（二次确认）")
      setTick((t) => t + 1)
    } catch (e) {
      store.notify("删除失败：" + String(e))
    }
  }
  async function disable(location: string) {
    const { toggleSkill } = await import("../host")
    await toggleSkill(location, false).catch((e: unknown) => store.notify("停用失败：" + String(e)))
    setTick((t) => t + 1)
  }
  async function exportAgent(name: string) {
    const list = (await client()?.app.agents({ directory: directory() }).catch(() => undefined))?.data ?? []
    const a = list.find((x) => x.name === name)
    if (!a) return store.notify("导出失败：未找到该代理")
    const el = document.createElement("a")
    el.href = URL.createObjectURL(new Blob([JSON.stringify(a, null, 2)], { type: "application/json" }))
    el.download = `${name}.agent.json`
    el.click()
    store.notify(`已导出 ${name}.agent.json`)
  }
  function importMode() {
    const el = document.createElement("input")
    el.type = "file"
    el.accept = ".json"
    el.onchange = () => {
      void (async () => {
        const f = el.files?.[0]
        if (!f) return
        if (f.size > 1_000_000) return store.notify("导入失败：文件超过 1MB")
        const v: { name?: string; description?: string; mode?: string; prompt?: string } = JSON.parse(await f.text())
        if (!v.name) return store.notify("导入失败：缺少 name 字段")
        const { writeAgent } = await import("../host")
        await writeAgent(directory(), v.name, v.description ?? "", v.prompt ?? "", v.mode)
        await store.refresh()
        store.notify(`已导入模式 ${v.name}`)
      })().catch(() => store.notify("导入失败：JSON 解析错误"))
    }
    el.click()
  }
  async function rmAgent(name: string) {
    const { removeAgent } = await import("../host")
    const err = await removeAgent(directory(), name).then(() => "").catch((e: unknown) => String(e))
    store.notify(err ? `删除失败：${err}` : `已删除模式 ${name}`)
    if (!err) await store.refresh()
  }
}

// ---------- 自动批准 ----------

const TOOLS: [PermKey, string, "path" | "cmd" | ""][] = [
  ["external_directory", "访问工作区之外的路径", "path"],
  ["bash", "执行 shell 命令", "cmd"],
  ["read", "读文件 read 工具", "path"],
  ["edit", "编辑文件 edit / write / apply_patch", "path"],
  ["glob", "目录与内容检索", ""],
  ["grep", "内容检索", ""],
  ["list", "列目录", ""],
  ["task", "派生子代理 Task", ""],
  ["skill", "加载技能", ""],
  ["websearch", "联网检索", ""],
  ["webfetch", "网页抓取", ""],
  ["doom_loop", "检测到死循环时", ""],
]

function ApproveTab() {
  const [perm, setPerm] = createSignal(store.config().permission)
  const initial = JSON.stringify(store.config().permission ?? null)
  const dirty = () => JSON.stringify(perm() ?? null) !== initial
  const lvl = (tool: PermKey) => permLevel(perm(), tool)
  const exc = (tool: PermKey) => permPatterns(perm(), tool)
  const act = (v: string): PermissionAction => (v === "deny" ? "deny" : v === "ask" ? "ask" : "allow")
  async function save() {
    if (await saveConfig({ permission: perm() })) setPerm(store.config().permission)
  }
  return (
    <>
      <h3>自动批准</h3>
      <div class="slead">细粒度工具权限：allow（自动批准）/ ask（询问）/ deny（拒绝），支持通配例外（保存写入全局 kilo.json）</div>
      <Group name="临时会话">
        <Row n="临时全批" d="开启后所有审批自动「允许一次」（不落盘）">
          <Sw on={store.autoApprove()} onChange={(v) => store.setAutoApprove(v)} />
        </Row>
      </Group>
      <div class="sgroup">
        <div class="gh">工具权限</div>
        <For each={TOOLS}>
          {([tool, desc, kind]) => (
            <>
              <div class="perm-rule">
                <div class="pl"><div class="n">{tool}</div><div class="d">{desc}</div></div>
                <select class="tri" value={lvl(tool)} onChange={(e) => setPerm(withLevel(perm(), tool, act(e.currentTarget.value)))}>
                  <option value="allow">allow 自动批准</option><option value="ask">ask 询问</option><option value="deny">deny 拒绝</option>
                </select>
              </div>
              <Show when={kind}>
                <div class="exc">
                  <b style="font-size:11px">{kind === "cmd" ? "命令例外" : "路径例外"}</b>
                  <For each={exc(tool)}>{(ex) => (
                    <div class="er">
                      <span>•</span>
                      <input class="pat" style="background:none;border:none;outline:none;color:inherit;font-family:var(--mono);min-width:0" value={ex.pattern} onInput={(e) => setPerm(withPattern(withoutPattern(perm(), tool, ex.pattern), tool, e.currentTarget.value, ex.action))} />
                      <select class="tri" value={ex.action} onChange={(e) => setPerm(withPattern(perm(), tool, ex.pattern, act(e.currentTarget.value)))}>
                        <option value="allow">allow</option><option value="ask">ask</option><option value="deny">deny</option>
                      </select>
                      <span class="x" style="cursor:pointer;color:var(--faint)" onClick={() => setPerm(withoutPattern(perm(), tool, ex.pattern))}>✕</span>
                    </div>
                  )}</For>
                  <div class="er" style="color:var(--blue);cursor:pointer" onClick={() => setPerm(withPattern(perm(), tool, kind === "cmd" ? "git *" : "new-path/**", lvl(tool) === "allow" ? "deny" : "allow"))}>＋ 添加{kind === "cmd" ? "命令" : "路径"}</div>
                </div>
              </Show>
            </>
          )}
        </For>
      </div>
      <Show when={dirty()}>
        <div class="savebar" style="left:0;position:sticky">
          <span>● 有未保存更改</span>
          <span class="sp" />
          <button class="btn" onClick={() => setPerm(store.config().permission)}>放弃</button>
          <button class="btn primary" onClick={() => void save()}>保存到 kilo.json</button>
        </div>
      </Show>
    </>
  )
}

// ---------- 其余页 ----------

function BrowserTab() {
  return (
    <>
      <h3>浏览器 / Web 工具</h3>
      <div class="slead">Web 搜索与浏览器自动化</div>
      <Group>
        <Row n="Web Search" d="启用联网检索（写入 web_search）">
          <CfgSw path="web_search" fallback={true} />
        </Row>
        <Row n="使用系统 Chrome" d="用本机 Chrome 而非内置 Chromium">
          <Sw on={ui("sysChrome", "1").get() === "1"} onChange={(v) => ui("sysChrome", "1").set(v ? "1" : "0")} />
        </Row>
        <Row n="Headless" d="无头模式（固定开启）"><Sw disabled on={true} onChange={() => {}} /></Row>
        <Row n="浏览器自动化总开关" d="代理操作右栏浏览器模块（在实验性页也可控制）"><Sw on={ui("browserAuto", "0").get() === "1"} onChange={(v) => ui("browserAuto", "0").set(v ? "1" : "0")} /></Row>
      </Group>
    </>
  )
}

function CheckpointsTab() {
  return (
    <>
      <h3>检查点</h3>
      <div class="slead">每次修改前记录文件快照，支持逐消息 Revert/Redo（依赖后端，默认开启）</div>
      <Group><Row n="启用检查点/快照"><Sw on={ui("checkpoints", "1").get() === "1"} onChange={(v) => ui("checkpoints", "1").set(v ? "1" : "0")} /></Row></Group>
    </>
  )
}

function DisplayTab() {
  const font = ui("fontsize", "13.5")
  createEffect(() => {
    document.body.style.fontSize = font.get() + "px"
  })
  return (
    <>
      <h3>显示</h3>
      <div class="slead">外观与转录渲染（桌面 UI 态，存本地）</div>
      <Group>
        <Row n="用户名" d="显示在历史与遥测中（username）"><input class="tinp" value={cfgStr("username")} onInput={(e) => void saveCfg("username", e.currentTarget.value || undefined)} /></Row>
        <Row n="字号" d="10–24px">
          <input class="rng" type="range" min={10} max={24} step={0.5} value={font.get()} onInput={(e) => { font.set(e.currentTarget.value); document.body.style.fontSize = e.currentTarget.value + "px" }} />
          <span style="font-size:11px;color:var(--muted)">{font.get()}px</span>
        </Row>
        <Row n="推理消息自动折叠" d="思考块完成后自动收起（写入 auto_collapse_reasoning）"><CfgSw path="auto_collapse_reasoning" fallback={true} /></Row>
        <Row n="Shift+Tab 循环变体"><Sw on={ui("shiftTab", "1").get() === "1"} onChange={(v) => ui("shiftTab", "1").set(v ? "1" : "0")} /></Row>
        <Row n="Token 吞吐显示"><Sw on={ui("tps", "1").get() === "1"} onChange={(v) => ui("tps", "1").set(v ? "1" : "0")} /></Row>
        <Row n="显示自动批准原因"><Sw on={ui("permWhy", "0").get() === "1"} onChange={(v) => ui("permWhy", "0").set(v ? "1" : "0")} /></Row>
        <Row n="桌面通知" d="回合完成 / 待批准 / 代理提问时发送系统通知（仅窗口未聚焦时）">
          <Sw on={ui("osNotify", "1").get() === "1"} onChange={(v) => ui("osNotify", "1").set(v ? "1" : "0")} />
          <button class="btn sm" onClick={() => void import("../host").then((h) => h.notifyOS("Kilo · 测试", "这是一条桌面通知"))}>测试</button>
        </Row>
        <Row n="主题" d="浅/深/跟随系统">
          <select class="sel" value={store.theme()} onChange={(e) => {
            const v = e.currentTarget.value
            if (v === "light" || v === "dark" || v === "system") store.setTheme(v)
          }}>
            <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
          </select>
        </Row>
        <Row n="终端命令展示" d="写入 terminal_command_display"><CfgSel path="terminal_command_display" options={[{ v: "expanded", label: "展开" }, { v: "collapsed", label: "折叠" }]} fallback="expanded" /></Row>
        <Row n="代码编辑展示" d="写入 code_edit_display"><CfgSel path="code_edit_display" options={[{ v: "expanded", label: "展开" }, { v: "collapsed", label: "折叠" }]} fallback="expanded" /></Row>
        <Row n="MCP 工具展示" d="写入 mcp_tool_display"><CfgSel path="mcp_tool_display" options={[{ v: "expanded", label: "展开" }, { v: "collapsed", label: "折叠" }]} fallback="collapsed" /></Row>
      </Group>
      <RecentsList />
    </>
  )
}

function ContextTab() {
  return (
    <>
      <h3>上下文</h3>
      <div class="slead">自动压缩与文件监听（部分写入全局 kilo.json）</div>
      <Group name="项目记忆（/memory）">
        <Row n="启用" d="跨会话长期记忆（桌面侧开关；后端 memory 键未暴露）"><Sw on={ui("memory", "1").get() === "1"} onChange={(v) => ui("memory", "1").set(v ? "1" : "0")} /></Row>
        <Row n="自动固化" d="会话结束后台整理记忆"><Sw on={ui("memoryAuto", "1").get() === "1"} onChange={(v) => ui("memoryAuto", "1").set(v ? "1" : "0")} /></Row>
        <Row n="存储路径"><div class="taglist" style="align-items:center"><span class="tag">~/.kilo/memory/</span><button class="btn sm" onClick={() => void (directory() ? openPath(directory()) : store.notify("先选项目"))}>Inspect</button></div></Row>
      </Group>
      <Group name="压缩">
        <Row n="自动压缩" d="接近上限时生成摘要分割线（compaction.auto）"><CfgSw path="compaction.auto" fallback={true} /></Row>
        <Row n="压缩模型" d="默认跟随聊天模型（桌面 UI 态）">
          <select class="sel" value={ui("compactModel", "").get()} onChange={(e) => ui("compactModel", "").set(e.currentTarget.value)}>
            <For each={modelOpts()}>{(o) => <option value={o.v}>{o.label || "（跟随聊天模型）"}</option>}</For>
          </select>
        </Row>
        <Row n="触发阈值 %" d="compaction.threshold_percent">
          <input class="tinp" style="width:90px" value={String(cfgNum("compaction.threshold_percent", 92))} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) void saveCfg("compaction.threshold_percent", n) }} />
        </Row>
        <Row n="修剪旧内容" d="压缩时丢弃陈旧工具输出（compaction.prune）"><CfgSw path="compaction.prune" fallback={false} /></Row>
      </Group>
      <Group name="Watcher 忽略模式">
        <IgnoreTags />
      </Group>
    </>
  )
}

function IgnoreTags() {
  const init = store.config().watcher?.ignore ?? ["node_modules/**", "dist/**", ".git/**"]
  const [tags, setTags] = createSignal(init.slice())
  function save(list: string[]) {
    setTags(list)
    void saveConfig({ watcher: { ignore: list } })
  }
  return (
    <Row n="监听文件变更时忽略的路径" d="glob 模式">
      <div class="taglist">
        <For each={tags()}>{(t, i) => <span class="tag">{t} <span class="x" onClick={() => save(tags().filter((_, j) => j !== i()))}>✕</span></span>}</For>
        <button class="btn sm" onClick={() => save([...tags().slice(0, -1), (tags().at(-1) ?? "x") + "/new-*"])}>＋ 添加</button>
      </div>
    </Row>
  )
}

function CommitTab() {
  const lang = ui("commitLang", "跟随界面")
  const [cover, setCover] = createSignal(cfgStr("commit_message.prompt") !== "")
  return (
    <>
      <h3>提交信息</h3>
      <div class="slead">Git 模块的 AI 提交信息生成</div>
      <Group>
        <Row n="提交信息语言" d="语言切换后右栏点 AI 重新生成">
          <select class="sel" value={lang.get()} onChange={(e) => lang.set(e.currentTarget.value)}>
            <option>跟随界面</option><option>English</option><option>日本語</option>
          </select>
        </Row>
        <Row n="覆盖默认提示词" d="写入 commit_message.prompt"><Sw on={cover()} onChange={(v) => { setCover(v); if (!v) void saveCfg("commit_message.prompt", undefined) }} /></Row>
        <Show when={cover()}>
          <Row n="自定义 prompt">
            <textarea class="tinp" style="height:56px;width:340px;max-width:60vw" value={cfgStr("commit_message.prompt")} onInput={(e) => void saveCfg("commit_message.prompt", e.currentTarget.value)} />
          </Row>
        </Show>
      </Group>
    </>
  )
}

function IndexingTab() {
  const [status] = createResource(() => ready(), async (r) => {
    if (!r) return undefined
    const res = await client()?.indexing.status({ directory: directory() }).catch(() => undefined)
    return res?.data
  })
  return (
    <>
      <h3>索引</h3>
      <div class="slead">语义代码索引（embedding + 向量库），供 @ 搜索与代码问答</div>
      <Group name="状态">
        <Row n="当前项目" d={directory().split(/[\\/]/).at(-1) ?? "未选择"}>
          <span classList={{ badge: true, ok: Boolean(status()), gray: !status() }}>{status() ? "● 就绪" : "○ 未启用"}</span>
        </Row>
      </Group>
      <Group name="配置（Global / 项目 两级作用域）">
        <Row n="本机同意" d="首次启用需确认（机器本地）">
          <Sw on={ui("indexConsent", "1").get() === "1"} onChange={(v) => { ui("indexConsent", "1").set(v ? "1" : "0"); void client()?.indexing.consent({ directory: directory(), enabled: v }).catch(() => {}) }} />
        </Row>
        <Row n="启用索引" d="写入 indexing.enabled"><CfgSw path="indexing.enabled" fallback={true} /></Row>
        <Row n="禁用时仍显示输入框按钮" d="索引关闭时 @ 搜索按钮仍出现"><Sw on={ui("indexBtn", "0").get() === "1"} onChange={(v) => ui("indexBtn", "0").set(v ? "1" : "0")} /></Row>
        <Row n="Embedding Provider" d="Kilo / OpenAI / Ollama / Compatible / Gemini / Mistral / Bedrock / OpenRouter / Voyage"><CfgSel path="indexing.provider" options={[{ v: "kilo" }, { v: "openai" }, { v: "ollama" }, { v: "openai-compatible" }, { v: "gemini" }, { v: "mistral" }, { v: "bedrock" }, { v: "openrouter" }, { v: "voyage" }]} fallback="kilo" /></Row>
        <Row n="Embedding 模型" d="indexing.model"><input class="tinp" placeholder="kilo-embed-v2" value={cfgStr("indexing.model")} onInput={(e) => void saveCfg("indexing.model", e.currentTarget.value || null)} /></Row>
        <Row n="向量维度" d="Kilo 时自动（indexing.dimension）"><input class="tinp" style="width:90px" value={String(cfgNum("indexing.dimension", 0) || "")} onInput={(e) => { const n = Number(e.currentTarget.value); void saveCfg("indexing.dimension", Number.isFinite(n) && n > 0 ? n : null) }} /></Row>
        <Row n="向量库" d="写入 indexing.vectorStore"><CfgSel path="indexing.vectorStore" options={[{ v: "lancedb" }, { v: "qdrant" }]} fallback="lancedb" /></Row>
        <Row n="LanceDB 目录"><span class="tag">{cfgStr("indexing.lancedb.directory") || "~/.kilo/index/"}</span></Row>
        <Row n="文件扩展名" d="逗号分隔（indexing.fileExtensions）"><input class="tinp" value={cfgStrs("indexing.fileExtensions").join(",")} onInput={(e) => void saveCfg("indexing.fileExtensions", e.currentTarget.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Row>
        <Row n="Search Min Score" d="indexing.searchMinScore"><input class="tinp" style="width:90px" value={String(cfgNum("indexing.searchMinScore", 0.35))} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) void saveCfg("indexing.searchMinScore", n) }} /></Row>
        <Row n="Search Max Results" d="indexing.searchMaxResults"><input class="tinp" style="width:90px" value={String(cfgNum("indexing.searchMaxResults", 20))} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) void saveCfg("indexing.searchMaxResults", n) }} /></Row>
        <Row n="Embedding Batch Size" d="indexing.embeddingBatchSize"><input class="tinp" style="width:90px" value={String(cfgNum("indexing.embeddingBatchSize", 64))} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) void saveCfg("indexing.embeddingBatchSize", n) }} /></Row>
      </Group>
    </>
  )
}

function ExperimentalTab() {
  const toggles: [string, string, string, boolean][] = [
    ["批量工具 batch", "一次调用多工具", "experimental.batch_tool", false],
    ["图像生成", "generate_image 工具", "experimental.image_generation", false],
    ["共享代理看板", "SwarmBoard 多代理留言", "experimental.shared_agent_board", false],
    ["原生 Notebook 工具", "启用 notebook 编辑工具", "experimental.native_notebook_tools", false],
    ["拒绝后继续循环", "deny 后不中断回合", "experimental.continue_loop_on_deny", false],
    ["任务模型选择", "Task 子代理允许选模型", "experimental.task_model_selection", true],
    ["禁用粘贴摘要", "粘贴长文本不自动生成摘要", "experimental.disable_paste_summary", false],
    ["隐私模式", "不上传遥测内容", "privacy_mode", false],
    ["远程控制", "允许 app.kilo.ai 远程接管（需后端 --advertise）", "remote_control", false],
    ["自动更新", "检查并安装更新", "autoupdate", true],
  ]
  return (
    <>
      <h3>实验性</h3>
      <div class="slead">功能开关与工具 kill-switch（写入 experimental / 顶层 config 键）</div>
      <Group>
        <For each={toggles}>{([t, d, path, def]) => <Row n={t} d={d}><CfgSw path={path} fallback={def} /></Row>}</For>
        <Show when={cfgBool("experimental.image_generation")}><Row n="图像生成模型" d="experimental.image_generation_model"><input class="tinp" placeholder="agnes-image-2" value={cfgStr("experimental.image_generation_model")} onInput={(e) => void saveCfg("experimental.image_generation_model", e.currentTarget.value || undefined)} /></Row></Show>
        <Row n="会话分享" d="manual / auto / disabled（写入 share）"><CfgSel path="share" options={[{ v: "manual" }, { v: "auto" }, { v: "disabled" }]} fallback="manual" /></Row>
        <Row n="MCP 超时 ms" d="experimental.mcp_timeout"><input class="tinp" style="width:90px" value={String(cfgNum("experimental.mcp_timeout", 60000))} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isFinite(n)) void saveCfg("experimental.mcp_timeout", n) }} /></Row>
        <Row n="工具开关" d="逐个工具启用/禁用（写入 tools map）">
          <div class="taglist">
            <For each={["read", "edit", "bash", "websearch", "browser", "task", "skill"]}>{(t) => {
              const on = () => cfgFlags("tools")[t] ?? true
              return (
                <span class="tag" style="align-items:center">
                  {t}
                  <button classList={{ switch: true, sm: true, on: on() }} onClick={() => void saveCfg(`tools.${t}`, !on())}><i /></button>
                </span>
              )
            }}</For>
          </div>
        </Row>
      </Group>
    </>
  )
}

function SandboxTab() {
  const [support] = createResource(() => ready(), async (r) => (r ? ((await client()?.sandbox.support({ directory: directory() }))?.data as unknown) : undefined))
  const list = (path: string) => cfgStrs(path).join("\n")
  return (
    <>
      <h3>沙箱</h3>
      <div class="slead">命令执行隔离（macOS Seatbelt / Linux bubblewrap / Windows 受限令牌），写入 sandbox 段</div>
      <Group>
        <Row n="启用沙箱" d="命令在受限环境中执行"><CfgSw path="sandbox.enabled" fallback={false} /></Row>
        <Row n="阻止网络访问" d="deny（默认）/ allow"><CfgSel path="sandbox.network" options={[{ v: "deny", label: "deny 阻止" }, { v: "allow", label: "allow 放行" }]} fallback="deny" /></Row>
        <Row n="可写路径" d="sandbox.writable_paths，每行一个">
          <textarea class="tinp" style="height:56px;width:340px;max-width:60vw;font-family:var(--mono)" value={list("sandbox.writable_paths")} onInput={(e) => void saveCfg("sandbox.writable_paths", e.currentTarget.value.split(/\n+/).filter(Boolean))} />
        </Row>
        <Row n="允许主机" d="sandbox.allowed_hosts，每行一个">
          <textarea class="tinp" style="height:56px;width:340px;max-width:60vw;font-family:var(--mono)" value={list("sandbox.allowed_hosts")} onInput={(e) => void saveCfg("sandbox.allowed_hosts", e.currentTarget.value.split(/\n+/).filter(Boolean))} />
        </Row>
        <Row n="平台支持检测"><span classList={{ badge: true, ok: Boolean(support()), gray: !support() }}>{support() ? "当前平台支持" : "未检测到支持"}</span></Row>
      </Group>
    </>
  )
}

function LanguageTab() {
  const lang = ui("lang", "zh")
  return (
    <>
      <h3>语言</h3>
      <div class="slead">界面语言（中文为原型基准）</div>
      <Group>
        <Row n="界面语言" d="auto 跟随系统">
          <select class="sel" value={lang.get()} onChange={(e) => { lang.set(e.currentTarget.value); store.notify("完整 i18n：P2 排期中") }}>
            <option value="auto">auto</option><option value="zh">简体中文（zh）</option><option value="en">English（即将提供）</option>
          </select>
        </Row>
      </Group>
    </>
  )
}

function AboutTab() {
  const [ver, setVer] = createSignal("")
  const [paths, setPaths] = createSignal<Path>()
  createEffect(() => {
    const i = info()
    if (i) void health(i).then((h) => setVer(h.version)).catch(() => setVer("—"))
    void client()
      ?.path.get({ directory: directory() })
      .then((r) => setPaths(r?.data))
      .catch(() => {})
  })
  async function exportSettings() {
    const blob = new Blob([JSON.stringify(store.config(), null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "kilo-config.json"
    a.click()
    store.notify("已导出设置 JSON")
  }
  function importSettings() {
    const el = document.createElement("input")
    el.type = "file"
    el.accept = ".json"
    el.onchange = () => {
      void (async () => {
        const f = el.files?.[0]
        if (!f) return
        try {
          const v: Config = JSON.parse(await f.text())
          await saveConfig(v)
        } catch {
          store.notify("导入失败")
        }
      })()
    }
    el.click()
  }
  return (
    <>
      <h3>关于</h3>
      <div class="slead">版本、连接诊断与配置管理</div>
      <Group>
        <Row n="版本" d="Kilo Desktop（Tauri 2 + kilo CLI sidecar）"><span class="tag">{ver() || "…"}</span><button class="btn sm" onClick={() => void navigator.clipboard.writeText(ver())}>复制</button></Row>
        <Row n="CLI 服务器" d="本地引擎子进程"><span class="tag">● {info()?.baseUrl ?? "启动中"}</span></Row>
        <Row n="社区">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm" onClick={() => void openUrl("https://github.com/Kilo-Org/kilocode")}>GitHub</button>
            <button class="btn sm" onClick={() => void openUrl("https://reddit.com/r/kilocode")}>Reddit</button>
            <button class="btn sm" onClick={() => void openUrl("https://discord.gg/GT4Q3Xm8Y2")}>Discord</button>
            <button class="btn sm" onClick={() => openModal("feedback")}>支持</button>
          </div>
        </Row>
        <Row n="导出设置" d="JSON"><button class="btn sm" onClick={() => void exportSettings()}>导出…</button></Row>
        <Row n="导入设置"><button class="btn sm" onClick={importSettings}>导入…</button></Row>
        <Row n="从 Roo Code 导入" d="迁移历史会话与规则"><button class="btn sm" onClick={() => store.notify("迁移向导：P2 排期中")}>开始迁移向导</button></Row>
        <Row n="重置全部设置" d="危险操作：仅清桌面 UI 态"><button class="btn sm danger" onClick={() => { Object.keys(localStorage).filter((k) => k.startsWith("ui.")).forEach((k) => localStorage.removeItem(k)); location.reload() }}>重置</button></Row>
        <Row n="后端管理" d="自定义 kilo serve 启动参数与环境变量"><button class="btn sm" onClick={() => void restartWith()}>重启后端</button></Row>
        <Row n="数据存储" d="会话/消息持久化于 CLI 引擎数据库（kilo.db · WAL · 与 CLI/扩展同库）">
          <span class="tag">{paths()?.state ?? "~/.local/share/kilo"}</span>
        </Row>
      </Group>
      <RecentsList />
    </>
  )
  async function restartWith() {
    await restartBackend("", []).catch((e: unknown) => store.notify("失败：" + String(e)))
    store.notify("后端重启中…")
    await new Promise((r) => setTimeout(r, 3000))
    await store.reload()
  }
}

function RecentsList() {
  return (
    <Group name="最近项目">
      <For each={recents()}>
        {(r) => (
          <Row n={r}>
            <span classList={{ badge: true, ok: r === directory(), gray: r !== directory() }}>{r === directory() ? "当前" : ""}</span>
            <button class="btn sm" onClick={() => { setDirectory(r); void store.refresh(); void store.newSession() }}>切换</button>
            <button class="btn sm" onClick={async () => { forget(r); await new Promise((x) => setTimeout(x, 1000)) }} style="opacity:.7">× 移除</button>
          </Row>
        )}
      </For>
      <Row n="＋ 新建项目" d="选择目录 → 初始化 kilo.json">
        <button class="btn sm" onClick={() => void (async () => { const d = await pickDir(); if (d) { setDirectory(d); await store.refresh(); await store.newSession() } })()}>选择目录…</button>
      </Row>
    </Group>
  )
}
