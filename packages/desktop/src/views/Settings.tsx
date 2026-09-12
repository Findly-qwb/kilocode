import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js"
import type { Config, Path, PermissionAction } from "@kilocode/sdk/v2/types"
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
        <Show when={cur()}>
          <Row n="推理变体" d="默认对话模型的档位">
            <VariantSelect model={() => store.model()} />
          </Row>
        </Show>
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
  return (
    <>
      <h3>供应商</h3>
      <div class="slead">Kilo Gateway 统一路由，或直连任意供应商（BYOK）</div>
      <Group name="已连接">
        <For each={all().all.filter((p) => conn().has(p.id))}>
          {(p) => (
            <Row n={p.name} d={`${p.source} · ${Object.keys(p.models).length} 模型`}>
              <span class="badge gray">{p.source}</span>
              <Show when={p.source === "custom"}><button class="btn sm" onClick={() => openModal("custom", { provider: p.id })}>编辑</button></Show>
              <button class="btn sm danger" onClick={() => void disconnect(p.id)}>断开</button>
            </Row>
          )}
        </For>
        <Show when={!all().all.filter((p) => conn().has(p.id)).length}><div class="empty">未连接供应商</div></Show>
      </Group>
      <Group name="热门">
        <For each={all().all.filter((p) => !conn().has(p.id)).slice(0, 25)}>
          {(p) => (
            <Row n={p.name} d={p.env.length ? `可用环境变量 ${p.env.join(", ")}` : "API 密钥 / OAuth"}>
              <button class="btn sm primary" onClick={() => openModal("provider", { provider: p.id })}>连接</button>
            </Row>
          )}
        </For>
        <Row n="＋ 添加自定义供应商" d="OpenAI Compatible / Responses / Anthropic Messages 协议">
          <button class="btn sm" onClick={() => openModal("custom")}>添加</button>
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
          <div class="srow">
            <div class="c" style="width:100%">
              <button class="btn sm" onClick={() => void import("../host").then((h) => h.openUrl("https://github.com/Kilo-Org/kilo-marketplace"))}>⤒ 导入 .agent.json</button>
              <button class="btn sm" onClick={() => openModal("market")}>🧩 浏览市场</button>
              <button class="btn sm primary" onClick={() => openModal("agent", { name: "" })}>＋ 新建助理</button>
            </div>
          </div>
          <For each={store.agents()}>
            {(a) => (
              <Row n={a.id} d={a.description ?? ""}>
                <span class="badge gray">{a.mode === "subagent" ? "sub" : "primary"}</span>
                <button class="btn sm" onClick={() => openModal("agent", { name: a.id })}>编辑</button>
                <button class="btn sm" onClick={() => { store.setAgent(a.id); store.notify("默认助理设为 " + a.id) }}>设默认</button>
              </Row>
            )}
          </For>
        </Group>
      )}
      {cur() === "MCP Servers" && (
        <>
          <div class="sgroup">
            <div class="gh">MCP Servers
              <button class="btn sm primary" style="margin-left:auto" onClick={() => openModal("market")}>🧩 市场安装</button>
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
                      <button class="btn sm danger" onClick={() => void rm(name)}>🗑</button>
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
          <Show when={(sources() ?? []).length} fallback={<div class="empty">未检测到指令文件</div>}>
            <For each={sources() ?? []}>
              {(s) => (
                <Row n={s} d="每次请求注入系统提示">
                  <button class="btn sm" onClick={() => void openPath(s)}>✎ 打开</button>
                </Row>
              )}
            </For>
          </Show>
          <Row n="添加指令文件" d="AGENTS.md / .kilo/rules/*.md / CLAUDE.md 兼容">
            <button class="btn sm" onClick={() => void (directory() ? openPath(directory()) : store.notify("先选项目"))}>＋ 添加</button>
          </Row>
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
            <div class="gh">Skills <button class="btn sm" style="margin-left:auto" onClick={() => void import("../host").then((h) => h.openUrl("https://github.com/Kilo-Org/kilo-marketplace"))}>🧩 浏览市场</button></div>
            <For each={skills() ?? []}>
              {(s) => (
                <div class="srow">
                  <span class="picon">📘</span>
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
                      <input class="pat" style="background:none;border:none;outline:none;color:inherit;font-family:var(--mono);min-width:0" value={ex.pattern} onInput={(e) => setPerm(withoutPattern(withPattern(perm(), tool, ex.pattern), e.currentTarget.value, ex.action))} />
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
        <Row n="Web Search" d="启用联网检索（关闭即在自动批准页 deny）">
          <Sw on={ui("websearch", "1").get() === "1"} onChange={(v) => ui("websearch", "1").set(v ? "1" : "0")} />
        </Row>
        <Row n="使用系统 Chrome" d="用本机 Chrome 而非内置 Chromium">
          <Sw on={ui("sysChrome", "1").get() === "1"} onChange={(v) => ui("sysChrome", "1").set(v ? "1" : "0")} />
        </Row>
        <Row n="Headless" d="无头模式（固定开启）"><Sw disabled on={true} onChange={() => {}} /></Row>
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
        <Row n="字号" d="10–24px">
          <input class="rng" type="range" min={10} max={24} step={0.5} value={font.get()} onInput={(e) => { font.set(e.currentTarget.value); document.body.style.fontSize = e.currentTarget.value + "px" }} />
          <span style="font-size:11px;color:var(--muted)">{font.get()}px</span>
        </Row>
        <Row n="推理消息自动折叠"><Sw on={ui("foldThink", "1").get() === "1"} onChange={(v) => ui("foldThink", "1").set(v ? "1" : "0")} /></Row>
        <Row n="Shift+Tab 循环变体"><Sw on={ui("shiftTab", "1").get() === "1"} onChange={(v) => ui("shiftTab", "1").set(v ? "1" : "0")} /></Row>
        <Row n="Token 吞吐显示"><Sw on={ui("tps", "1").get() === "1"} onChange={(v) => ui("tps", "1").set(v ? "1" : "0")} /></Row>
        <Row n="显示自动批准原因"><Sw on={ui("permWhy", "0").get() === "1"} onChange={(v) => ui("permWhy", "0").set(v ? "1" : "0")} /></Row>
        <Row n="主题" d="浅/深/跟随系统">
          <select class="sel" value={store.theme()} onChange={(e) => {
            const v = e.currentTarget.value
            if (v === "light" || v === "dark" || v === "system") store.setTheme(v)
          }}>
            <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
          </select>
        </Row>
        <Row n="终端命令展示"><select class="sel" value={ui("bashOpen", "折叠").get()} onChange={(e) => ui("bashOpen", "折叠").set(e.currentTarget.value)}><option>展开</option><option>折叠</option></select></Row>
        <Row n="代码编辑展示"><select class="sel" value={ui("editOpen", "折叠").get()} onChange={(e) => ui("editOpen", "折叠").set(e.currentTarget.value)}><option>折叠</option><option>展开</option></select></Row>
        <Row n="MCP 工具展示"><select class="sel" value={ui("mcpOpen", "折叠").get()} onChange={(e) => ui("mcpOpen", "折叠").set(e.currentTarget.value)}><option>折叠</option><option>展开</option></select></Row>
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
      <Group name="压缩">
        <Row n="自动压缩" d="接近上限时生成摘要分割线">
          <Sw on={ui("autocompact", "1").get() === "1"} onChange={(v) => { ui("autocompact", "1").set(v ? "1" : "0"); void saveConfig({ autocompact: v }) }} />
        </Row>
        <Row n="修剪旧内容" d="压缩时丢弃陈旧工具输出"><Sw on={ui("trimOld", "0").get() === "1"} onChange={(v) => ui("trimOld", "0").set(v ? "1" : "0")} /></Row>
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
  const cover = ui("commitOverride", "0")
  const prompty = ui("commitPrompt", "用 conventional commits 格式，中文，≤72 字符主题行")
  return (
    <>
      <h3>提交信息</h3>
      <div class="slead">Git 模块的 AI 提交信息生成（桌面 UI 态）</div>
      <Group>
        <Row n="提交信息语言">
          <select class="sel" value={lang.get()} onChange={(e) => lang.set(e.currentTarget.value)}>
            <option>跟随界面</option><option>English</option><option>日本語</option>
          </select>
        </Row>
        <Row n="覆盖默认提示词"><Sw on={cover.get() === "1"} onChange={(v) => cover.set(v ? "1" : "0")} /></Row>
        <Show when={cover.get() === "1"}>
          <Row n="自定义 prompt">
            <textarea class="tinp" style="height:56px;width:340px;max-width:60vw" value={prompty.get()} onInput={(e) => prompty.set(e.currentTarget.value)} />
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
      <Group name="配置（Global）">
        <Row n="启用索引"><Sw on={ui("index", "1").get() === "1"} onChange={(v) => ui("index", "1").set(v ? "1" : "0")} /></Row>
        <Row n="Embedding Provider" d="Kilo / OpenAI / Ollama / Compatible / Gemini"><select class="sel"><option>Kilo</option><option>OpenAI</option><option>Ollama</option><option>Voyage</option></select></Row>
        <Row n="向量库"><select class="sel"><option>LanceDB</option><option>Qdrant</option></select></Row>
        <Row n="LanceDB 目录"><span class="tag">~/.kilo/index/</span></Row>
        <Row n="文件扩展名"><input class="tinp" value={ui("indexExt", ".ts,.tsx,.js,.go,.py").get()} onInput={(e) => ui("indexExt", ".ts,.tsx,.js,.go,.py").set(e.currentTarget.value)} /></Row>
      </Group>
    </>
  )
}

function ExperimentalTab() {
  const toggles: [string, string, boolean][] = [
    ["代码格式化", "编辑后自动跑 formatter", false],
    ["LSP", "启用语言服务协议诊断", true],
    ["批量工具 batch", "一次调用多工具", false],
    ["图像生成", "generate_image 工具", false],
    ["共享代理看板", "SwarmBoard 多代理留言", false],
    ["原生 Notebook 工具", "", false],
    ["拒绝后继续循环", "deny 后不中断回合", false],
    ["任务模型选择", "Task 子代理允许选模型", true],
  ]
  return (
    <>
      <h3>实验性</h3>
      <div class="slead">功能开关与工具 kill-switch（多为桌面 UI 态；生效范围随版本推进）</div>
      <Group>
        <For each={toggles}>{([t, d, def]) => <Row n={t} d={d}><Sw on={ui("exp." + t, def ? "1" : "0").get() === "1"} onChange={(v) => ui("exp." + t, def ? "1" : "0").set(v ? "1" : "0")} /></Row>}</For>
        <Row n="会话分享">
          <select class="sel" value={ui("share", "manual").get()} onChange={(e) => ui("share", "manual").set(e.currentTarget.value)}><option>manual</option><option>auto</option><option>disabled</option></select>
        </Row>
        <Row n="MCP 超时 ms"><input class="tinp" style="width:90px" value={ui("mcpTimeout", "60000").get()} onInput={(e) => ui("mcpTimeout", "60000").set(e.currentTarget.value)} /></Row>
        <Row n="工具开关" d="逐个工具启用/禁用">
          <div class="taglist">
            <For each={["read", "edit", "bash", "websearch", "browser", "chart", "image", "mcp:context7"]}>{(t) => (
              <>
                <span class="tag" style="align-items:center">
                  {t}
                  <button classList={{ switch: true, sm: true, on: ui("tool." + t, "1").get() === "1" }} onClick={() => ui("tool." + t, "1").set(ui("tool." + t, "1").get() === "1" ? "0" : "1")}><i /></button>
                </span>
              </>
            )}</For>
          </div>
        </Row>
      </Group>
    </>
  )
}

function SandboxTab() {
  const [support] = createResource(() => ready(), async (r) => (r ? ((await client()?.sandbox.support({ directory: directory() }))?.data as unknown) : undefined))
  return (
    <>
      <h3>沙箱</h3>
      <div class="slead">命令执行隔离（macOS Seatbelt / Linux bubblewrap / Windows 受限令牌）</div>
      <Group>
        <Row n="启用沙箱" d="命令在受限环境中执行（需后端 sandbox 支持）"><Sw on={ui("sandbox", "0").get() === "1"} onChange={(v) => ui("sandbox", "0").set(v ? "1" : "0")} /></Row>
        <Row n="阻止网络访问" d="deny（默认）/ allow"><Sw on={ui("sbNet", "1").get() === "1"} onChange={(v) => ui("sbNet", "1").set(v ? "1" : "0")} /></Row>
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
          const obj: unknown = JSON.parse(await f.text())
          if (typeof obj !== "object" || obj === null) return store.notify("导入失败：非法 JSON")
          await saveConfig(obj as unknown as Record<string, unknown>)
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
        <Row n="数据存储" d="会话/消息持久化于 CLI 引擎数据库（<state>/kilo.db，WAL，与 CLI/扩展同库）">
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
