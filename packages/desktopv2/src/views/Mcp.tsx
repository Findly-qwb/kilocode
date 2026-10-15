/**
 * MCP 页（M5）：stdio / sse / http 三协议 + 状态机（connecting/connected/needs_auth/failed/disabled）。
 * 行数据来自 mcp_list，实时状态叠加 runtime.state.mcp（mcp_status 事件投影）。
 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke, listen } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { McpRow, Policy, Settings as Cfg } from "../ipc/protocol";
import { roleCache } from "./cache";

const STAT: Record<string, [string, string]> = {
  connecting: ["run", "connecting"],
  connected: ["ok", "connected"],
  needs_auth: ["warn", "needs auth"],
  failed: ["err", "failed"],
  disabled: ["gray", "disabled"],
};

export function Mcp() {
  const [rows, setRows] = useState<McpRow[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [policy, setPolicy] = useState<Policy>(() => (roleCache.list()["mcp.policy"] as Policy) ?? "require_approval");

  const reload = () => {
    void invoke("mcp_list")
      .then(setRows)
      .catch((err: unknown) => console.error("mcp_list failed", err));
  };

  useEffect(() => {
    reload();
    void invoke("settings_get")
      .then(setCfg)
      .catch((err: unknown) => console.error("settings_get failed", err));
    return listen("mcp_status", reload);
  }, []);

  const live = (row: McpRow): [string, number, string | undefined] => {
    const hit = runtime.state.mcp[row.name];
    return [hit?.status ?? (row.enabled ? row.status : "disabled"), hit?.tools ?? row.tools, hit?.error ?? row.last_error];
  };

  const toggle = (row: McpRow) => void invoke("mcp_toggle", { id: row.id, enabled: !row.enabled }).then(reload);
  const retry = (row: McpRow) => void invoke("mcp_retry", { id: row.id }).then(() => actions.toast("重试连接中", "指数退避 · 上限 5 次"));

  const patch = <K extends keyof Cfg>(key: K, value: Cfg[K]) => {
    setCfg((c) => ({ ...c!, [key]: value }));
    void invoke("settings_set", { patch: { [key]: value } as Partial<Cfg> }).catch((err: unknown) => console.error("settings_set failed", err));
  };

  const counts = {
    connected: rows.filter((r) => live(r)[0] === "connected").length,
    auth: rows.filter((r) => live(r)[0] === "needs_auth").length,
    failed: rows.filter((r) => live(r)[0] === "failed").length,
    off: rows.filter((r) => !r.enabled).length,
  };

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2>MCP Servers</h2>
        <span className="lead" style={{ margin: 0 }}>
          stdio / sse / http 三协议 · 工具接入权限引擎
        </span>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => actions.modal("mcp")}>
          <Icon name="plus" cls="sm" />
          添加 Server
        </button>
      </div>
      <div className="lead" style={{ marginTop: 8 }}>
        <span className="badge ok">{counts.connected} connected</span> <span className="badge warn">{counts.auth} needs auth</span>{" "}
        <span className="badge err">{counts.failed} failed</span> <span className="badge gray">{counts.off} disabled</span>
      </div>
      <div className="sgroup">
        <div className="gh">
          <Icon name="zap" cls="sm" />
          列表
        </div>
        {rows.length === 0 && (
          <div className="srow">
            <div className="l">
              <div className="n">尚无 MCP Server</div>
              <div className="d">配置来自 kilo 配置文件或本页；无市场与一键安装（本地优先）</div>
            </div>
          </div>
        )}
        {rows.map((r) => {
          const [status, tools, error] = live(r);
          const [cls, label] = STAT[status] ?? ["gray", status];
          return (
            <div className={`srow${r.enabled ? "" : " disabled"}`} key={r.id}>
              <div className="l">
                <div className="n">
                  {r.name} <span className="badge gray">{r.transport}</span> <span className={`badge ${cls}`}>{label}</span>
                  {error ? <span className="badge err">stderr</span> : null}
                </div>
                <div className="d mono" style={{ fontSize: 11 }}>
                  {r.transport === "stdio" ? `stdio 子进程 · ${error ?? "生命周期由 runtime 托管"}` : "远程 endpoint · headers 支持 {env:VAR}"}
                </div>
              </div>
              <div className="c">
                <span className="mono" style={{ fontSize: 11, color: "var(--text-weaker)" }}>
                  {tools} tools
                </span>
                {status === "needs_auth" && (
                  <button className="btn sm primary" onClick={() => actions.toast("已打开授权页", "系统浏览器 · OAuth 回调不落端口")}>
                    <Icon name="key" cls="sm" />
                    Sign in
                  </button>
                )}
                {status === "failed" && (
                  <>
                    <button className="btn sm" onClick={() => actions.toast("已复制失败日志", error ?? "无 stderr")}>
                      <Icon name="copy" cls="sm" />
                      日志
                    </button>
                    <button className="btn sm" onClick={() => retry(r)}>
                      <Icon name="refresh" cls="sm" />
                      重试
                    </button>
                  </>
                )}
                <button className="btn sm" onClick={() => actions.modal("mcp", { id: r.id })}>
                  <Icon name="pencil" cls="sm" />
                  编辑
                </button>
                <span className={`switch sm${r.enabled ? " on" : ""}`} onClick={() => toggle(r)}>
                  <i />
                </span>
                <button className="btn sm danger" onClick={() => actions.modal("confirm", { title: `删除 MCP ${r.name}？`, body: "stdio 子进程随之下线；历史 part 引用保留为只读。", ok: "删除", danger: "1", drop: `mcp:${r.id}` })}>
                  <Icon name="trash" cls="sm" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sgroup">
        <div className="gh">
          <Icon name="sliders" cls="sm" />
          全局策略
        </div>
        <div className="srow">
          <div className="l">
            <div className="n">MCP 工具默认策略</div>
            <div className="d">外部进程以你的权限运行，默认逐个确认；可在权限页按 server 单独设策。Settings 暂无对应键，存本机缓存</div>
          </div>
          <div className="c">
            <select className="sel" value={policy} onChange={(e) => {
              const next = e.currentTarget.value as Policy;
              setPolicy(next);
              roleCache.set("mcp.policy", next);
            }}>
              {["auto", "require_approval", "deny"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="srow">
          <div className="l">
            <div className="n">调用超时</div>
          </div>
          <div className="c">
            <input className="tinp num" type="number" value={cfg?.shellTimeout ?? 60} onChange={(e) => patch("shellTimeout", Number(e.currentTarget.value))} />
            s
          </div>
        </div>
        <div className="srow">
          <div className="l">
            <div className="n">输出截断阈值</div>
            <div className="d">超出后落盘并给出路径引用，避免污染上下文</div>
          </div>
          <div className="c">
            <input className="tinp num" type="number" value={cfg?.injectLimitKb ?? 32} onChange={(e) => patch("injectLimitKb", Number(e.currentTarget.value))} />
            KB
          </div>
        </div>
        <div className="srow">
          <div className="l">
            <div className="n">子进程回收</div>
            <div className="d">应用退出 / server 停用时 kill 进程组（含孙进程）</div>
          </div>
          <div className="c">
            <span className="badge ok">强制</span>
          </div>
        </div>
      </div>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <div>
          工具以 <code className="mono">mcp:&lt;server&gt;:&lt;tool&gt;</code> 注册；needs_auth 走系统浏览器授权，不监听本地端口。
        </div>
      </div>
    </div>
  );
}
