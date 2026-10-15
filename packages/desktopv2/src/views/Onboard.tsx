/**
 * 首启引导（M0 / onboard 屏）：无账号、无登录。
 * 填一个 OpenAI 兼容端点（或本地模型）→ provider_test 连通性通过后进入对话。
 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import type { Mode, ProjectRow, ProviderRow, Settings as Cfg } from "../ipc/protocol";
import * as skin from "../skins/loader";
import { ui } from "../ui/state";
import { providerCache } from "./cache";

export function Onboard() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [picked, setPicked] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setRows(providerCache.list());
    void invoke("settings_get")
      .then(setCfg)
      .catch((err: unknown) => console.error("settings_get failed", err));
    void invoke("project_list")
      .then(setProjects)
      .catch((err: unknown) => console.error("project_list failed", err));
  }, []);

  const test = (row?: ProviderRow) => {
    const hit = row ?? rows.find((x) => x.id === picked);
    if (!hit) {
      actions.toast("先选择一个端点", "或添加自定义 OpenAI 兼容端点");
      return;
    }
    void invoke("provider_test", { base_url: hit.base_url })
      .then((res) => {
        setOk(res.ok);
        if (!res.ok) {
          actions.toast("连通性测试失败", res.error ?? "检查 base_url 与网络");
          return;
        }
        providerCache.touch({ ...hit, models: res.models });
        setRows(providerCache.list());
        actions.toast(`已连通 · ${res.models.length} 个模型`, "费用均为估算，非实际账单");
      })
      .catch((err: unknown) => actions.toast("测试失败", String(err)));
  };

  const start = () => {
    if (!ok) {
      test();
      return;
    }
    ui.set({ view: "chat", scene: "" });
    actions.toast("开始使用", "数据全部留在本机 · 无遥测上报");
  };

  return (
    <div className="page" style={{ display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(600px,100%)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span className="mark" style={{ width: 64, height: 64, margin: "0 auto 10px", display: "grid", placeItems: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 34, height: 34 }} aria-hidden="true">
              <path d="M5 21V9a7 7 0 0 1 14 0v12l-3.5-2.5L12 21l-3.5-2.5z" stroke="var(--text-strong)" strokeWidth="1.6" />
              <path d="M9.4 10.6h1.6M13 10.6h1.6" stroke="var(--text-accent)" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <h2 style={{ fontSize: 22, margin: "10px 0 4px", color: "var(--text-strong)" }}>配置你的模型端点</h2>
          <p style={{ color: "var(--text-weak)", fontSize: 13 }}>无账号、无登录。填一个 OpenAI 兼容端点即可开始，也可以完全离线跑本地模型。</p>
        </div>
        <div className="pcard">
          <h4>
            <Icon name="key" cls="md" />
            模型端点
          </h4>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {rows.map((e) => (
              <button key={e.id} className={`btn sm${picked === e.id ? " primary" : ""}`} onClick={() => setPicked(e.id)}>
                <Icon name="cpu" cls="sm" />
                {e.name}
              </button>
            ))}
            <button className="btn sm" onClick={() => actions.modal("endpoint")}>
              <Icon name="plus" cls="sm" />
              自定义
            </button>
          </div>
          <div className="hint" style={{ fontSize: 11, color: "var(--text-weaker)", marginTop: 9 }}>
            本地示例：<code className="mono">http://localhost:11434/v1</code>（Ollama）· 密钥可留空 · 支持 <code className="mono">{"{env:VAR}"}</code>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button className="btn sm primary" onClick={() => test()}>
              <Icon name="play" cls="sm" />
              连通性测试
            </button>
            <span className="mono" style={{ fontSize: 11, color: ok ? "var(--surface-success-strong)" : "var(--text-weaker)", alignSelf: "center" }}>
              {ok ? "已连通 · 模型数已合并" : "未测试"}
            </span>
          </div>
        </div>
        <div className="pcard">
          <h4>
            <Icon name="palette" cls="md" />
            外观与语言
          </h4>
          <div className="srow">
            <div className="l">
              <div className="n">皮肤</div>
              <div className="d">内置三套 · 可扩展 skin.json（L2 令牌 + 对比度门禁）</div>
            </div>
            <div className="c">
              <select
                className="sel"
                value={cfg?.skin ?? skin.active()}
                onChange={(e) => {
                  const hit = skin.apply(e.currentTarget.value);
                  if (!hit.ok) actions.toast("皮肤被拒绝", "缺 L2 必需 token");
                  if (cfg) void invoke("settings_set", { patch: { skin: e.currentTarget.value } as Partial<Cfg> });
                }}
              >
                {skin.list().map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="srow">
            <div className="l">
              <div className="n">界面语言</div>
            </div>
            <div className="c">
              <select
                className="sel"
                value={cfg?.lang ?? "zh"}
                onChange={(e) => {
                  const lang = e.currentTarget.value as Cfg["lang"];
                  setCfg((c) => (c ? { ...c, lang } : c));
                  void invoke("settings_set", { patch: { lang } });
                }}
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="srow">
            <div className="l">
              <div className="n">默认模式</div>
              <div className="d">Ask 最安全；Code 需要审批写操作</div>
            </div>
            <div className="c">
              <select
                className="sel"
                value={cfg?.mode ?? "ask"}
                onChange={(e) => {
                  const mode = e.currentTarget.value as Mode;
                  setCfg((c) => (c ? { ...c, mode } : c));
                  ui.set({ mode });
                  void invoke("settings_set", { patch: { mode } });
                }}
              >
                <option value="ask">Ask</option>
                <option value="plan">Plan</option>
                <option value="code">Code</option>
              </select>
            </div>
          </div>
        </div>
        <div className="pcard">
          <h4>
            <Icon name="folder" cls="md" />
            选择工作空间
          </h4>
          <div className="srow">
            <div className="l">
              <div className="n">最近</div>
              <div className="d mono">{projects.map((p) => p.name).join(" · ") || "暂无记录"}</div>
            </div>
            <div className="c">
              <button className="btn sm" onClick={() => actions.modal("projectnew")}>
                <Icon name="folder-open" cls="sm" />
                打开
              </button>
            </div>
          </div>
          <div className="srow">
            <div className="l">
              <div className="n">导入既有本地数据</div>
              <div className="d">从其他客户端迁移会话/规则（只读源目录）</div>
            </div>
            <div className="c">
              <span className="badge gray">待宿主上报</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <button className="btn primary" style={{ padding: "9px 22px" }} onClick={start}>
            <Icon name="check" cls="sm" />
            {ok ? "开始使用" : "测试并继续"}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-weaker)", marginTop: 9 }}>数据全部留在本机 · 无遥测上报 · 日志脱敏</div>
        </div>
      </div>
    </div>
  );
}
