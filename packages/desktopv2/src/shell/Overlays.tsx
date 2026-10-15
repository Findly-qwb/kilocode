/**
 * 系统级浮层（原型里的 oslayer 层）：托盘菜单、系统通知卡、更新提示、拖拽热区遮罩。
 * 通知与托盘在原生壳里由 Tauri plugin 发出；浏览器版用同样式呈现，保证 78 屏可验证。
 */
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { ui, useUi } from "../ui/state";

export function Overlays() {
  const s = useUi();
  if (!s.popover) return null;

  if (s.popover === "tray")
    return (
      <div className="oslayer">
        <div className="traymenu show">
          <div className="hd">Kilo Desktop</div>
          <button className="tm" onClick={() => ui.set({ popover: null, view: "chat", scene: "chat-stream" })}>
            <Icon name="chat" />
            打开主窗口<span className="kbd">⌘⇧D</span>
          </button>
          <button
            className="tm"
            onClick={() => {
              ui.set({ popover: null, view: "chat", scene: "chat-stream" });
              void runtime.state.session;
            }}
          >
            <Icon name="sparkle" />
            快速提问<span className="kbd">⌥Space</span>
          </button>
          <div className="hr" />
          <button className="tm" onClick={() => ui.set({ popover: null, toast: { title: "后台运行", body: "回合完成仅发系统通知" } })}>
            <Icon name="clock" />
            后台运行
          </button>
          <button className="tm" onClick={() => ui.set({ modal: { id: "shortcuts" }, popover: null })}>
            <Icon name="keyboard" />
            快捷键与手势
          </button>
          <button
            className="tm"
            onClick={() => {
              void invoke("stop_agent", { session_id: runtime.state.session ?? "" });
              ui.set({ popover: null, toast: { title: "已中断当前 Turn", body: "已生成内容保留在转录里" } });
            }}
          >
            <Icon name="pause" />
            中断当前任务
          </button>
          <div className="hr" />
          <button className="tm" onClick={() => ui.set({ popover: null, toast: { title: "退出应用", body: "子进程随 ProcessGroup 一并回收" } })}>
            <Icon name="power" />
            退出<span className="kbd">⌘Q</span>
          </button>
        </div>
      </div>
    );

  if (s.popover === "notif")
    return (
      <div className="oslayer">
        <div className="osnotif show">
          <div className="nh">
            <Icon name="shield" cls="sm" />
            Kilo Desktop · 现在
          </div>
          <div className="nt">需要你的批准</div>
          <div className="nd">
            Code 模式请求执行 <span className="mono">git commit -m "feat: sqlite store"</span>
          </div>
          <div className="na">
            <button className="btn xs primary" onClick={() => ui.set({ popover: null, scene: "perm-dock" })}>
              查看审批卡
            </button>
            <button className="btn xs" onClick={() => ui.set({ popover: null })}>
              稍后
            </button>
          </div>
        </div>
      </div>
    );

  if (s.popover === "update")
    return (
      <div className="oslayer">
        <div className="update-pill show">
          <b style={{ color: "var(--text-strong)" }}>0.2.0 已就绪</b>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-weak)" }}>签名校验通过 · 安装并重启</span>
          <button className="btn xs primary" onClick={() => ui.set({ modal: { id: "update" }, popover: null })}>
            安装
          </button>
        </div>
      </div>
    );

  if (s.popover === "dragover")
    return (
      <div className="oslayer">
        <div className="dock-card" style={{ position: "absolute", top: "40%", left: "50%", transform: "translateX(-50%)", width: 320, pointerEvents: "none" }}>
          <b style={{ color: "var(--text-strong)" }}>
            <Icon name="download" cls="sm" /> 松手即附加
          </b>
          <span style={{ fontSize: "var(--fs-11)", color: "var(--text-weak)" }}>图片走 Base64 直传视觉模型 · 非图片转 @mention · 单文件上限 20MB</span>
        </div>
      </div>
    );

  return null;
}
