import { For, Show } from "solid-js"
import { store } from "../store"
import { info } from "../client"
import { openModal } from "../ui"
import { openUrl } from "../host"

export function Profile() {
  const c = () => store.profile()
  const connected = () => store.providers().all.filter((p) => store.providers().connected.includes(p.id))
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
            <button class="btn" onClick={() => void openUrl("https://app.kilo.ai/")}>📊 Dashboard</button>
            <button class="btn primary" onClick={() => void openUrl("https://app.kilo.ai/credits")}>💳 充值</button>
            <button class="btn" onClick={() => { store.setView("settings"); store.notify("在「供应商」页断开各连接即退出本地凭证") }}>退出</button>
            <span style="margin-left:auto;font-size:12px;color:var(--muted)">
              余额 <b style="color:var(--green);font-family:var(--mono)">{c()?.balance != null ? "$" + c()!.balance!.toFixed(2) : "—"}</b>{" "}
              <button class="btn sm" onClick={() => void store.refresh()}>↻</button>
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
          <h4>设备授权登录（新机器）</h4>
          <div class="devauth">
            <div class="step">STEP 1 · 在浏览器打开</div>
            <div class="url">
              <span class="u">https://app.kilo.ai/devices</span>
              <button class="btn sm" onClick={() => void navigator.clipboard.writeText("https://app.kilo.ai/devices")}>⧉</button>
              <button class="btn sm" onClick={() => void openUrl("https://app.kilo.ai/devices")}>打开</button>
            </div>
            <div class="step">STEP 2 · 输入 8 位确认码</div>
            <div class="code" title="在网页端生成后输入" onClick={() => store.notify("确认码在 app.kilo.ai/devices 页面生成")}>────····</div>
            <div class="wait">
              <span class="spinner" />
              <span style="margin-left:8px">等待授权… 登录成功后可同步云端会话</span>
              <button class="btn sm" style="margin-left:auto" onClick={() => void store.refresh()}>检查状态</button>
            </div>
          </div>
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
