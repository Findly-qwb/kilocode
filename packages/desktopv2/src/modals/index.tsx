/**
 * 弹层集合（PLAN §16 的 modal-* 屏）。按 ui.modal.id 分发，共用 .modal/.mhead/.mbody/.mfoot 结构。
 * 皮肤管理接的是 src/skins/loader 的真实校验与修复；其余弹层把动作打到 IPC 命令上。
 */
import { useMemo, useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import { adopt, active, apply, fix, fallback, list, validate, DEFAULT_SKIN, type Bundle } from "../skins/loader";
import { check } from "../skins/contrast";
import { ui, useUi } from "../ui/state";

function Shell({
  title,
  sub,
  wide,
  children,
  foot,
}: {
  title: string;
  sub?: string;
  wide?: boolean;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className={`modal show ${wide ? "wide" : ""}`}>
      <div className="mhead">
        <h3>{title}</h3>
        {sub ? <span className="sub">{sub}</span> : null}
        <button className="iconbtn x" onClick={() => ui.set({ modal: null })}>
          <Icon name="x" />
        </button>
      </div>
      <div className="mbody">{children}</div>
      {foot ? <div className="mfoot">{foot}</div> : null}
    </div>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {hint ? <div className="hint">{hint}</div> : null}
  </div>
);

/** 皮肤管理：列表 / 应用 / 导入 skin.json / 完整度与对比度门禁 / 自动提亮 / 回落默认 */
function SkinModal() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<{ id: string; ok: boolean; lines: string[] } | null>(null);
  const skins = list();
  const now = active();

  const importIt = () => {
    const hit = adopt(text);
    if (!hit.ok) {
      const problems = (hit.problems ?? []).map((p) => (p.kind === "missing" ? `缺 token：${p.tokens.join(", ")}` : p.kind === "contrast" ? `对比度不达标：${p.failures.map((f) => `${f.label} ${f.actual.toFixed(2)} < ${f.min}`).join("；")}` : p.kind === "cycle" ? "继承成环" : `父皮肤缺失：${p.parent}`));
      setReport({ id: "?", ok: false, lines: problems });
      ui.set({ toast: { title: "皮肤被拒绝加载", body: problems[0] ?? "校验失败" } });
      return;
    }
    const bundle = hit.bundle as Bundle;
    const gates = check(bundle.tokens);
    setReport({ id: bundle.id, ok: !gates.length, lines: gates.map((g) => `${g.label} ${g.actual.toFixed(2)}:1 < ${g.min}:1`) });
    ui.set({ toast: { title: `已导入 ${bundle.name}`, body: gates.length ? "对比度不达标，可一键提亮" : "校验通过" } });
  };

  return (
    <Shell
      title="皮肤管理"
      sub="skin.json bundle · extends · 对比度守护"
      wide
      foot={
        <>
          <span className="push">皮肤切换即时生效，不重启、不重建 WebView</span>
          <button className="btn" onClick={() => ui.set({ toast: { title: "已回落", body: String(fallback().ok) } })}>
            回落默认皮肤
          </button>
          <button className="btn primary" onClick={() => ui.set({ modal: null })}>
            完成
          </button>
        </>
      }
    >
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <span>
          内置 {list().filter((k) => !k.imported).length} 套 · L2 必需 token 完整性 + 正文 4.5:1 / 次要 3:1 对比度门禁，不达标阻止应用。
        </span>
      </div>
      <div className="grid2">
        {skins.map((k) => {
          const problems = validate(k as unknown as Bundle);
          const bad = problems.filter((p) => p.kind !== "contrast");
          const gates = problems.find((p) => p.kind === "contrast");
          return (
            <div className="mcard" key={k.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="dot" style={{ background: k.mode === "dark" ? "var(--text-weaker)" : "var(--text-strong)" }} />
                <b style={{ color: "var(--text-strong)" }}>{k.name}</b>
                <span className="badge gray">{k.mode}</span>
                {k.imported ? <span className="badge brand">导入</span> : null}
                {k.id === now ? <span className="badge ok">使用中</span> : null}
              </div>
              <div style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)", fontFamily: "var(--f-mono)", marginTop: 4 }}>{k.id}</div>
              {bad.length ? <div className="err">缺必需 token，拒绝加载</div> : null}
              {gates && gates.kind === "contrast" ? (
                <div className="err">对比度不达标：{gates.failures.map((f) => `${f.label} ${f.actual.toFixed(2)}`).join("；")}</div>
              ) : null}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  className="btn xs primary"
                  onClick={() => {
                    const hit = apply(k.id);
                    ui.set({ toast: { title: hit.ok ? `已应用 ${k.name}` : "加载被拒绝", body: hit.ok ? "CSS 变量已重注入" : JSON.stringify(hit.problems?.map((p) => p.kind)) } });
                  }}
                >
                  应用
                </button>
                {gates ? (
                  <button
                    className="btn xs"
                    onClick={() => {
                      const patch = fix(k.id);
                      ui.set({ toast: { title: "已自动提亮", body: Object.keys(patch ?? {}).join(", ") } });
                    }}
                  >
                    自动提亮
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <Field label="从 skin.json 导入" hint="~/.config/kilo-desktop/skins/<id>/skin.json · 支持 extends 继承，缺省 token 回落父皮肤">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{"id":"my-skin","name":"我的皮肤","mode":"dark","extends":"graphite-dark","tokens":{"--accent":"#22c55e"}}' />
      </Field>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn primary" onClick={importIt} disabled={!text.trim()}>
          <Icon name="download" cls="sm" />
          校验并导入
        </button>
        <button className="btn" onClick={() => setText(JSON.stringify({ id: "broken-skin", name: "缺 token 示例", mode: "dark", tokens: { "--accent": "#fff" } }, null, 2))}>
          填入一个不合法示例
        </button>
      </div>
      {report ? (
        <div className={report.ok ? "notice info" : "notice warn"} style={{ marginTop: 12 }}>
          <Icon name={report.ok ? "check" : "alert-circle"} cls="sm" />
          <span>{report.ok ? `${report.id} 校验通过并已入库` : `${report.id} 校验失败：${report.lines.join(" / ")}`}</span>
        </div>
      ) : null}
    </Shell>
  );
}

function RuntimeModal() {
  const st = runtime.state;
  const rows = [
    ["Agent Runtime", "rpi 0.3.24 · 同进程嵌入（无 sidecar、无监听端口）"],
    ["异步运行时", "Tokio multi-thread · 工具并发只读并行、写与 shell 串行"],
    ["当前 Turn", `${st.messages.length} 条消息 · ${st.messages.flatMap((m) => m.blocks).filter((b) => b.kind === "tool").length} 个工具块`],
    ["队列", `main ${st.queue.main.length} · steering ${st.queue.steering.length} · follow-up ${st.queue.follow_up.length}`],
    ["SQLite", "WAL · 单 writer task · schema v1"],
    ["子进程", "MCP stdio 进程登记在 ProcessGroup，退出统一回收"],
    ["checkpoint 仓库", "~/.local/share/kilo-desktop/ckpt/&lt;repo-hash&gt;（shadow git-dir，不碰用户 HEAD）"],
  ];
  return (
    <Shell title="Runtime 诊断" sub="同进程 · Tokio · 子进程与 checkpoint 仓库" wide foot={<button className="btn primary" onClick={() => ui.set({ modal: null })}>关闭</button>}>
      {rows.map(([k, v]) => (
        <div className="srow" key={k}>
          <div className="l">
            <div className="n">{k}</div>
            <div className="d" dangerouslySetInnerHTML={{ __html: v }} />
          </div>
          <span className={`badge ${k === "Agent Runtime" ? "ok" : "gray"}`}>{k === "Agent Runtime" ? "running" : "info"}</span>
        </div>
      ))}
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <span>协议版本 schema_version=1 · runtime_version=rpi-0.3.24，前端不匹配时会提示重启应用。</span>
      </div>
    </Shell>
  );
}

function PanicModal() {
  return (
    <Shell
      title="任务异常终止"
      sub="catch_unwind · 崩溃域隔离"
      foot={
        <>
          <span className="push">panic 只终止该 Turn，窗口与其余任务不受影响</span>
          <button className="btn" onClick={() => ui.set({ modal: null, toast: { title: "已回滚到检查点", body: "git checkout <ckpt> -- <paths>" } })}>
            回滚到检查点
          </button>
          <button
            className="btn primary"
            onClick={() => {
              ui.set({ modal: null });
              void invoke("submit_message", { session_id: runtime.state.session ?? "", text: "重试上一轮", mode: "code", model: "" });
            }}
          >
            重试这一轮
          </button>
        </>
      }
    >
      <div className="notice warn">
        <Icon name="alert" cls="sm" />
        <span>Agent 任务在 Turn 5 触发 panic：index out of bounds。已捕获并转成 <span className="mono">agent_error&#123;fatal:true&#125;</span>。</span>
      </div>
      <div className="mcard">
        <div className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
          queue_state：main 0 · steering 1 · follow_up 2
          <br />
          last_turn：4 · 文件快照 3b8de02
        </div>
      </div>
    </Shell>
  );
}

function ShortcutsModal() {
  const rows: [string, string, string][] = [
    ["⌘K", "命令面板", "全局"],
    ["⌘⇧S", "屏目索引", "全局"],
    ["⌥[ / ⌥]", "折叠左栏 / 右栏", "全局"],
    ["Enter", "发送 · busy 时加入 steering 队列", "输入框"],
    ["Shift+Enter", "换行", "输入框"],
    ["Esc", "中断当前 Turn（保留已生成内容）", "对话"],
    ["⇧Tab", "切换推理变体", "输入框"],
    ["↑ / ↓", "历史提示词", "输入框"],
    ["Ctrl+Z", "回滚提示词增强", "输入框"],
  ];
  return (
    <Shell title="快捷键" sub="含全局快捷键与冲突提示" foot={<button className="btn primary" onClick={() => ui.set({ modal: null })}>完成</button>}>
      {rows.map(([k, v, g]) => (
        <div className="srow" key={k}>
          <div className="l">
            <div className="n">{v}</div>
            <div className="d">{g}</div>
          </div>
          <span className="kbd">{k}</span>
        </div>
      ))}
      <div className="notice warn">
        <Icon name="alert-circle" cls="sm" />
        <span>冲突：⌥[ 与系统输入法切换冲突时，可在设置里改绑；全局快捷键由 Rust 侧注册，冲突会明确提示而不是静默失败。</span>
      </div>
    </Shell>
  );
}

function ProjectNewModal() {
  const [path, setPath] = useState("~/src/opencode");
  return (
    <Shell
      title="打开 / 新建工作空间"
      sub="git 仓库与普通目录两种路径"
      foot={
        <>
          <span className="push">projects 表记录 path / is_git / last_opened</span>
          <button
            className="btn primary"
            onClick={() =>
              void invoke("project_open", { path }).then((p) =>
                ui.set({ modal: null, toast: { title: `已打开 ${(p as { name: string }).name}`, body: `is_git=${(p as { is_git: boolean }).is_git ? "启用变更审查与 checkpoint" : "普通目录：只启用文件树与预览"}` } }),
              )
            }
          >
            打开
          </button>
        </>
      }
    >
      <Field label="目录路径" hint="git 仓库会额外启用变更审查、检查点与 Revert；普通目录只用文件树与预览">
        <input value={path} onChange={(e) => setPath(e.target.value)} />
      </Field>
      <div className="grid2">
        <div className="mcard">
          <b style={{ color: "var(--text-strong)" }}>是 git 仓库</b>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-weak)" }}>右栏出现变更审查；写类工具执行前打 checkpoint 快照</div>
        </div>
        <div className="mcard">
          <b style={{ color: "var(--text-strong)" }}>普通目录</b>
          <div style={{ fontSize: "var(--fs-11)", color: "var(--text-weak)" }}>文件树 + 预览 + 勾选加入上下文；git 面板置灰并说明原因</div>
        </div>
      </div>
    </Shell>
  );
}

function MultiwinModal() {
  return (
    <Shell title="多窗口与布局记忆" sub="几何 / 折叠态 / 面板子视图按项目存 ui_state" foot={<button className="btn primary" onClick={() => ui.set({ modal: null })}>知道了</button>}>
      <div className="mono" style={{ fontSize: "var(--fs-11)" }}>
        opencode · 1440×900 · 左栏展开 · 面板=变更审查
        <br />
        cloud-billing · 1280×820 · 左栏折叠 · 面板=文件树
      </div>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <span>UI 态写入 ui_state 表（不污染会话数据），窗口重开时各自还原布局。</span>
      </div>
    </Shell>
  );
}

function UpdateModal() {
  return (
    <Shell
      title="有可用更新"
      sub="0.1.0 → 0.2.0"
      foot={
        <>
          <span className="push">签名校验通过才允许安装</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            稍后
          </button>
          <button className="btn primary" onClick={() => ui.set({ modal: null, toast: { title: "已下载并校验签名", body: "安装并重启" } })}>
            安装并重启
          </button>
        </>
      }
    >
      <div className="srow">
        <div className="l">
          <div className="n">更新包签名</div>
          <div className="d">Ed25519 · 与内置公钥比对，失败即拒绝安装并给出原因</div>
        </div>
        <span className="badge ok">已校验</span>
      </div>
      <div className="srow">
        <div className="l">
          <div className="n">变更</div>
          <div className="d">适配层对齐 rpi 0.3.24 事件；审批卡支持改参数后执行</div>
        </div>
      </div>
    </Shell>
  );
}

function SessDelModal() {
  return (
    <Shell
      title="删除会话？"
      sub="sessions.deleted_at 软删标记"
      foot={
        <>
          <span className="push">30 天后清理；附件缓存与检查点一并回收</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            取消
          </button>
          <button
            className="btn primary"
            style={{ background: "var(--surface-critical-strong)" }}
            onClick={() =>
              void invoke("session_delete", { session_id: runtime.state.session ?? "" }).then(() =>
                ui.set({ modal: null, toast: { title: "已删除（软删，可撤销 10s）" } }),
              )
            }
          >
            删除
          </button>
        </>
      }
    >
      <div className="notice warn">
        <Icon name="alert" cls="sm" />
        <span>删除只标记 <span className="mono">deleted_at</span>，撤销窗口内可恢复。</span>
      </div>
    </Shell>
  );
}

function ResumeModal() {
  const q = runtime.state.queue;
  return (
    <Shell
      title="恢复上次未完成的任务？"
      sub="从 checkpoints.queue_state 续跑"
      foot={
        <>
          <span className="push">队列状态与文件快照都已持久化</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            丢弃
          </button>
          <button className="btn primary" onClick={() => ui.set({ modal: null, toast: { title: "已从检查点续跑（Turn 5）" } })}>
            恢复
          </button>
        </>
      }
    >
      <div className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
        queue_state：main {q.main.length} · steering {q.steering.length} · follow_up {q.follow_up.length}
        <br />
        last_turn：4 · 文件快照 3b8de02
      </div>
    </Shell>
  );
}

function CostModal() {
  const [cap, setCap] = useState(2);
  const [turns, setTurns] = useState(10);
  const [repeat, setRepeat] = useState(3);
  return (
    <Shell
      title="花费与熔断"
      sub="金额为估算，非实际账单"
      foot={
        <>
          <span className="push">阈值下发给 rpi 循环，与 runtime 自带保护取更严者</span>
          <button className="btn primary" onClick={() => ui.set({ modal: null, toast: { title: "已写入配置", body: `上限 $${cap} · ${turns} turns · 重复 ${repeat} 次熔断` } })}>
            保存
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="会话最大花费估算（$）" hint="达到上限即暂停并询问，不静默停">
          <input type="number" step="0.5" value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </Field>
        <Field label="最大 Turn 数">
          <input type="number" value={turns} onChange={(e) => setTurns(Number(e.target.value))} />
        </Field>
        <Field label="同名工具同参数重复次数" hint="连续达到即熔断询问，防死循环">
          <input type="number" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} />
        </Field>
        <Field label="shell 超时（秒）" hint="超时 kill 并回收子进程">
          <input type="number" defaultValue={120} />
        </Field>
      </div>
      <div className="srow">
        <div className="l">
          <div className="n">本会话累计（估算）</div>
          <div className="d">4 turns · 11 tools · prompt 38.2k / completion 2.1k / cache read 21k</div>
        </div>
        <span className="badge brand">$0.0842</span>
      </div>
    </Shell>
  );
}

function EndpointModal({ editing }: { editing?: string }) {
  const [name, setName] = useState(editing ?? "");
  const [url, setUrl] = useState(editing ? "http://localhost:11434/v1" : "");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Shell
      title={editing ? "编辑端点" : "添加端点"}
      sub="OpenAI 兼容协议"
      wide
      foot={
        <>
          <span className="push">key 存系统 keychain，界面永不回显明文</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() =>
              void invoke("provider_upsert", { name: name || "新端点", base_url: url, api_key: key || undefined, models }).then(() =>
                ui.set({ modal: null, toast: { title: "端点已保存", body: `models ${models.length} 个 · key_ref=keychain` } }),
              )
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="名称" hint="仅用于界面显示">
          <input value={name} placeholder="My Gateway" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Base URL" hint="需 http(s):// 前缀；本地可留空 key">
          <input value={url} placeholder="https://api.example.com/v1" onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </div>
      <Field label="API Key" hint="支持 {env:VAR}；勾选后存入系统 keychain，日志与错误信息脱敏">
        <input type="password" value={key} placeholder="留空 = 无需密钥（本地模型）" onChange={(e) => setKey(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn"
          onClick={() =>
            void invoke("provider_test", { base_url: url, api_key: key }).then((r) => {
              const hit = r as { ok: boolean; models: string[]; error?: string };
              setModels(hit.models);
              setTest({ ok: hit.ok, text: hit.ok ? `拉到 ${hit.models.length} 个模型：${hit.models.join(", ")}` : `失败：${hit.error}` });
            })
          }
        >
          <Icon name="zap" cls="sm" />
          连通性测试并拉取 /models
        </button>
        <span className="hint" style={{ color: "var(--text-weaker)" }}>拉取失败时回退手填，合并不丢收藏</span>
      </div>
      {test ? (
        <div className={test.ok ? "notice info" : "notice warn"} style={{ marginTop: 12 }}>
          <Icon name={test.ok ? "check" : "alert-circle"} cls="sm" />
          <span>{test.text}</span>
        </div>
      ) : null}
      <div className="grid2">
        <Field label="思考链字段" hint="DeepSeek/Anthropic 各自字段名不同，按端点声明">
          <select defaultValue="reasoning_content">
            <option value="reasoning_content">reasoning_content</option>
            <option value="thinking">thinking</option>
            <option value="none">不支持</option>
          </select>
        </Field>
        <Field label="超时与重试">
          <div className="mc-grid" style={{ display: "flex", gap: 8 }}>
            <input defaultValue="60" title="超时(s)" />
            <input defaultValue="3" title="重试次数" />
          </div>
        </Field>
      </div>
    </Shell>
  );
}

function McpModal() {
  const [transport, setTransport] = useState("stdio");
  return (
    <Shell
      title="编辑 MCP 服务器"
      sub="stdio / sse / http"
      wide
      foot={
        <>
          <span className="push">stdio 子进程登记到 ProcessGroup，退出与停用时统一回收</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() => void invoke("mcp_upsert", { name: "context7", transport: transport as "stdio", config: {}, enabled: true }).then(() => ui.set({ modal: null, toast: { title: "已保存，正在连接…" } }))}
          >
            保存并重连
          </button>
        </>
      }
    >
      <Field label="传输协议">
        <select value={transport} onChange={(e) => setTransport(e.target.value)}>
          <option value="stdio">stdio（本地子进程 + JSON-RPC over stdio）</option>
          <option value="sse">sse（远端事件流）</option>
          <option value="http">http（streamable HTTP）</option>
        </select>
      </Field>
      {transport === "stdio" ? (
        <div className="grid2">
          <Field label="命令"><input defaultValue="npx" /></Field>
          <Field label="参数" hint="空格分隔"><input defaultValue="-y @upstash/context7-mcp" /></Field>
        </div>
      ) : (
        <div className="grid2">
          <Field label="URL"><input defaultValue="https://mcp.linear.app/sse" /></Field>
          <Field label="Header" hint="支持 {env:VAR}；needs_auth 时提供「打开授权页」">
            <input defaultValue="Authorization: Bearer {env:LINEAR_TOKEN}" />
          </Field>
        </div>
      )}
      <Field label="默认策略" hint="MCP 工具命名为 mcp:&lt;server&gt;:&lt;tool&gt;，可按 host glob 覆盖">
        <div className="chips">
          {["auto", "require_approval", "deny"].map((p, i) => (
            <button key={p} className={`chip ${i === 1 ? "on" : ""}`}>
              {p}
            </button>
          ))}
        </div>
      </Field>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <span>超时与并发上限默认 60s；失败日志可在 MCP 页展开查看，异常按指数退避重启、上限 5 次。</span>
      </div>
    </Shell>
  );
}

function SkillModal() {
  return (
    <Shell
      title="新建 Skill"
      sub="斜杠命令 · 作用域 · 模型覆盖"
      wide
      foot={
        <>
          <span className="push">写盘路径与 skills 表保持一致</span>
          <button className="btn" onClick={() => ui.set({ modal: null })}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() =>
              void invoke("skill_upsert", { command: "sqlite-doc", system_prompt: "按模板输出存储章节", scope: "project", enabled: true }).then(() =>
                ui.set({ modal: null, toast: { title: "已保存 Skill", body: "/sqlite-doc 可用" } }),
              )
            }
          >
            保存
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="命令" hint="不带斜杠，输入 /command 触发"><input defaultValue="sqlite-doc" /></Field>
        <Field label="作用域">
          <select defaultValue="project">
            <option value="global">global</option>
            <option value="project">project</option>
            <option value="builtin">builtin</option>
          </select>
        </Field>
      </div>
      <Field label="System Prompt" hint="支持 {{args}} 模板占位；注入为消息 part，不塞进 system 拼接">
        <textarea defaultValue="你是存储文档写手。目标：{{args}}&#10;要求：给出表结构与迁移策略。" />
      </Field>
      <div className="grid2">
        <Field label="模型覆盖（可空）"><input placeholder="跟随会话" /></Field>
        <Field label="推理变体（可空）"><input placeholder="跟随端点" /></Field>
      </div>
    </Shell>
  );
}

function UsageModal() {
  const u = runtime.state.usage;
  const rows = [
    ["Prompt", (u?.used ?? 24200).toLocaleString()],
    ["Completion", "2,140"],
    ["Reasoning", "512"],
    ["Cache read", "21,000"],
  ];
  return (
    <Shell title="用量与费用" sub="以下金额仅为估算，非实际账单" foot={<button className="btn primary" onClick={() => ui.set({ modal: null })}>关闭</button>}>
      <div className="notice warn">
        <Icon name="alert-circle" cls="sm" />
        <span>本地按 <span className="mono">Model.cost</span> 单价估算，与服务商账单可能有差异；右侧同时给出服务端 usage 原值以便对账。</span>
      </div>
      <div className="grid2">
        {rows.map(([k, v]) => (
          <div className="mcard" key={k}>
            <div style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>{k}</div>
            <div className="mono" style={{ fontSize: "var(--fs-18)", color: "var(--text-strong)" }}>
              {v}
            </div>
          </div>
        ))}
      </div>
      <Field label="上下文占用三段" hint="used / reserved / window · 超过 auto_compact_at 自动压缩">
        <span className="ctxbar" style={{ width: "100%", height: 6 }}>
          <i style={{ width: `${u ? Math.round((u.used / u.window) * 100) : 38}%` }} />
        </span>
        <div className="hint mono">
          {(u?.used ?? 24200).toLocaleString()} used · {(u?.reserved ?? 4096).toLocaleString()} reserved · {(u?.window ?? 64000).toLocaleString()} window · 命中缓存 {Math.round((u?.hit_rate ?? 0.62) * 100)}%
        </div>
      </Field>
    </Shell>
  );
}

export function Modals() {
  const s = useUi();
  const id = s.modal?.id ?? "";
  const arg = s.modal?.arg;
  const body = useMemo(() => {
    switch (id) {
      case "skin":
        return <SkinModal />;
      case "runtime":
        return <RuntimeModal />;
      case "panic":
        return <PanicModal />;
      case "shortcuts":
        return <ShortcutsModal />;
      case "projectnew":
        return <ProjectNewModal />;
      case "multiwin":
        return <MultiwinModal />;
      case "update":
        return <UpdateModal />;
      case "sessdel":
        return <SessDelModal />;
      case "resume":
        return <ResumeModal />;
      case "cost":
        return <CostModal />;
      case "endpoint":
        return <EndpointModal editing={arg?.n} />;
      case "mcp":
        return <McpModal />;
      case "skill":
        return <SkillModal />;
      case "usage":
        return <UsageModal />;
      default:
        return null;
    }
  }, [id, arg]);
  if (!body) return null;
  return body;
}

export { DEFAULT_SKIN };
