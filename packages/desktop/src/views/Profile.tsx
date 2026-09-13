import { For, Show, createSignal } from "solid-js"
import { LayoutDashboard, CreditCard } from "lucide-solid"
import { store } from "../store"
import { client, directory, info } from "../client"
import { openModal } from "../ui"
import { openUrl } from "../host"

export function Profile() {
  const c = () => store.profile()
  const connected = () => store.providers().all.filter((p) => store.providers().connected.includes(p.id))
  const [authing, setAuthing] = createSignal(false)
  const [hint, setHint] = createSignal("")
  async function login() {
    const cli = client()
    if (!cli) return
    setAuthing(true)
    setHint("正在发起授权（浏览器将自动打开）…")
    const res = await cli.provider.oauth.authorize({ providerID: "kilo", method: 0, directory: directory() }).then((r) => r.data).catch((e: Error) => {
      setHint("失败：" + e.message)
    })
    if (!res) {
      setAuthing(false)
      return
    }
    setHint(res.instructions || "请在浏览器完成授权…")
    const done = await cli.provider.oauth.callback({ providerID: "kilo", method: 0, directory: directory() }).then(() => true).catch(() => false)
    setAuthing(false)
    setHint("")
    await store.reload()
    store.notify(done && store.profile()?.loggedIn ? "Kilo Gateway 已登录" : "登录未完成")
  }
  return (
    <section class="view show">
      <div class="page">
        <h2>账户</h2>
        <div class="lead">Kilo Gateway · 组织 / 余额 / 配额用量</div>
        <div class="pcard">
          <div style="display:flex;align-items:center;gap:12px">
            <span class="avatar" style="width:40px;height:40px;font-size:16px">{(c()?.name ?? c()?.email ?? "K").slice(0, 1).toUpperCase()}</span>
            <div>
              <div style="font-weight:700">{c()?.name || "本地用户"}</div>
              <div style="font-size:11.5px;color:var(--muted)">
                {c()?.loggedIn ? `${c()!.email ?? "Kilo Gateway"} · 已登录` : "未登录 · 本地 BYOK 模式可用"}
              </div>
            </div>
            <Show when={c()?.loggedIn}>
              <span class="badge gray" style="margin-left:auto">{c()!.tier ?? "Personal"}</span>
            </Show>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap">
            <button class="btn" onClick={() => void openUrl("https://app.kilo.ai/")}><LayoutDashboard size={13} strokeWidth={1.8} style="vertical-align:-2px;margin-right:4px" />Dashboard</button>
            <button class="btn primary" onClick={() => void openUrl("https://app.kilo.ai/credits")}><CreditCard size={13} strokeWidth={1.8} style="vertical-align:-2px;margin-right:4px" />充值</button>
            <button class="btn" onClick={() => { store.setView("settings"); store.notify("在「供应商」页断开各连接即退出本地凭证") }}>退出</button>
            <span style="margin-left:auto;font-size:12px;color:var(--muted)">
              余额 <b style="color:var(--green);font-family:var(--mono)">{c()?.balance != null ? "$" + c()!.balance!.toFixed(2) : "—"}</b>{" "}
              <button class="btn sm" onClick={() => void store.reload()}>↻</button>
            </span>
          </div>
        </div>
        <Show when={c()?.loggedIn}>
          <div class="pcard">
            <h4>Kilo Pass</h4>
            <div class="meter"><i style={{ width: "60%" }} /></div>
            <div class="sub"><span>周期额度见 Dashboard</span><span>app.kilo.ai/billing</span></div>
          </div>
        </Show>
        <div class="pcard">
          <h4>供应商配额 <button class="btn sm" style={{ float: "right" }} onClick={() => void store.refresh()}>↻</button></h4>
          <For each={connected()}>
            {(p, i) => (
              <div style={{ margin: i() ? "14px 0 0" : "0 0 0" }}>
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
                  <span class="picon" style={{ width: "20px", height: "20px", "font-size": "10px" }}>{(p.name ?? "?")[0]}</span>
                  <b style="font-size:12px">{p.name}</b>
                  <span class="badge gray">{p.source}</span>
                </div>
                <div class="meter"><i style={{ width: `${15 + i() * 20}%` }} /></div>
                <div class="sub"><span>本周窗口 · 明细在 Dashboard</span><span>—</span></div>
              </div>
            )}
          </For>
          <Show when={!connected().length}><div class="empty">尚未连接任何服务商，去「设置 → 供应商」连接</div></Show>
        </div>
        <div class="pcard">
          <h4>Kilo Gateway 登录</h4>
          <Show when={!authing()} fallback={
            <div class="devauth">
              <div class="step">已打开浏览器 · 完成授权后自动检测</div>
              <div class="wait"><span class="spinner" /><span style="margin-left:8px">{hint()}</span><button class="btn sm" style="margin-left:auto" onClick={() => setAuthing(false)}>取消</button></div>
            </div>
          }>
            <div class="slead" style="margin-bottom:10px">登录后可使用统一路由、云端会话同步与用量统计；本地 BYOK 不依赖登录。</div>
            <button class="btn primary" onClick={() => void login()}>✨ 浏览器授权登录</button>
          </Show>
        </div>
        <div class="pcard">
          <h4>后端 · CLI 引擎</h4>
          <div class="sub" style="margin-bottom:6px"><span style="font-family:var(--mono)">{info()?.baseUrl ?? "启动中…"}</span><span style="color:var(--green)">● connected</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn sm" onClick={() => void openUrl("https://github.com/Kilo-Org/kilocode")}>GitHub</button>
            <button class="btn sm" onClick={() => void openUrl("https://kilo.ai/docs")}>文档</button>
            <button class="btn sm" onClick={() => openModal("feedback")}>反馈</button>
          </div>
        </div>
      </div>
    </section>
  )
}
