/**
 * 对话主区（PLAN §5.1）：TaskHeader + 转录 + 转录内搜索 + 输入栏；空态是欢迎页。
 * welcome 态由 App 在 `!scene` 时给 `#v-chat` 加 `.welcome` 类，样式层负责居中。
 */
import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useKiloRuntime } from "../ipc/assistant";
import { KiloRuntime } from "../ipc/runtimeCtx";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { ProviderRow } from "../ipc/protocol";
import { ui, useUi } from "../ui/state";
import { Thread } from "../components/Thread";
import { PromptBox } from "../components/PromptBox";

const QUICK = [
  { icon: "diff", title: "审查当前改动", body: "把 git 变更列成 diff，逐文件给结论", mode: "ask" as const },
  { icon: "terminal", title: "跑测试并修失败项", body: "cargo test -p kilo-host，修到全绿", mode: "code" as const },
  { icon: "layers", title: "梳理模块结构", body: "按目录给出模块清单与依赖方向", mode: "plan" as const },
  { icon: "palette", title: "皮肤对比度体检", body: "检查三套内置皮肤是否都过 4.5:1", mode: "ask" as const },
];

/** 转录内搜索：Aa / 全词 / 正则 + n/m 计数 + 跳转高亮（M1-22） */
function Search() {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState({ case: false, word: false, regex: true });
  const [hits, setHits] = useState<number[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const body = document.querySelector("#messages")?.textContent ?? "";
    if (!q) return setHits([]);
    const src = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = opts.case ? "g" : "gi";
    let re: RegExp;
    try {
      re = new RegExp(opts.word ? `\\b${src}\\b` : src, flags);
    } catch {
      return setHits([]);
    }
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) && out.length < 200) out.push(m.index);
    setHits(out);
    setAt(0);
  }, [q, opts]);

  const jump = (step: number) => {
    if (!hits.length) return;
    const next = (at + step + hits.length) % hits.length;
    setAt(next);
    const el = document.querySelector("#messages");
    if (el) el.scrollTop = Math.max(0, hits[next] / 12 - 120);
  };

  return (
    <div className="tsearch show">
      <input value={q} placeholder="搜索转录…" onChange={(e) => setQ(e.target.value)} autoFocus />
      {(["case", "word", "regex"] as const).map((k) => (
        <span key={k} className={`toggle ${opts[k] ? "on" : ""}`} onClick={() => setOpts({ ...opts, [k]: !opts[k] })}>
          {k === "case" ? "Aa" : k === "word" ? "全词" : ".*"}
        </span>
      ))}
      <span className="count">
        {hits.length ? at + 1 : 0}/{hits.length}
      </span>
      <button className="iconbtn sm" onClick={() => jump(-1)}>
        <Icon name="arrow-up" cls="sm" />
      </button>
      <button className="iconbtn sm" onClick={() => jump(1)}>
        <Icon name="arrow-down" cls="sm" />
      </button>
      <button className="iconbtn sm" onClick={() => ui.set({ popover: null })}>
        <Icon name="x" cls="sm" />
      </button>
    </div>
  );
}

function ChatInner() {
  const s = useUi();
  const st = runtime.state;
  const hit = st.sessions.find((x) => x.id === st.session);
  const [providers, setProviders] = useState<ProviderRow[]>([]);

  useEffect(() => {
    void invoke("provider_upsert", { name: "DeepSeek", base_url: "https://api.deepseek.com/v1" })
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setProviders((prev) => prev);
  }, [s.view]);

  const ctx = useMemo(() => {
    const u = st.usage;
    if (!u) return { pct: 34, cls: "", label: "ctx 34%" };
    const pct = Math.round((u.used / u.window) * 100);
    return { pct, cls: pct > 90 ? "crit" : pct > 75 ? "warn" : "", label: `ctx ${pct}%` };
  }, [st.usage]);

  const waiting = st.messages.flatMap((m) => m.blocks).filter((b) => b.kind === "tool" && b.state === "awaiting_approval").length;

  if (!s.scene) {
    return (
      <>
        <div className="inputzone">
          <div style={{ maxWidth: 724, margin: "0 auto 18px", textAlign: "center" }}>
            <div style={{ fontSize: "var(--fs-22)", color: "var(--text-strong)", fontWeight: 600 }}>今天想做点什么？</div>
            <div style={{ color: "var(--text-weak)", fontSize: "var(--fs-12)" }}>本地优先 · 无账号 · 逻辑全在 Rust 主进程（rpi 同进程嵌入）</div>
          </div>
          <PromptBox />
          <div className="chips" style={{ maxWidth: 724, margin: "14px auto 0" }}>
            {QUICK.map((q) => (
              <button
                key={q.title}
                className="chip"
                onClick={() => {
                  ui.set({ draft: q.body, mode: q.mode, scene: "chat-stream" });
                  void runtime.state.session;
                }}
              >
                <Icon name={q.icon} cls="sm" />
                {q.title}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="taskhead">
        <div className="th-row">
          <div>
            <div className="th-title">{hit?.title ?? "SQLite 并发写：busy_timeout 取值"}</div>
            <div className="th-meta">
              <span className={`dot ${st.activity === "running" ? "run" : st.activity === "error" ? "err" : "idle"}`} />
              {st.activity} · opencode · main
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: "var(--fs-11)", color: "var(--text-weaker)" }}>
              {ctx.label} · $0.0421 估算
            </span>
            <span className="ctxbar">
              <i className={ctx.cls} style={{ width: `${ctx.pct}%` }} />
            </span>
            <button className="pill" onClick={() => ui.set({ popover: "mode" })}>
              <Icon name="code" cls="sm" />
              {s.mode}
            </button>
            <button className="pill" onClick={() => ui.set({ popover: "model" })}>
              <Icon name="cpu" cls="sm" />
              {s.model}
            </button>
            {waiting ? (
              <button className="pill warn" onClick={() => ui.set({ toast: { title: `${waiting} 项待审批`, body: "审批卡在转录里，超时自动 deny" } })}>
                <Icon name="shield" cls="sm" />
                {waiting} 待审批
              </button>
            ) : null}
          </div>
        </div>
        <div className="tl-bars" title="Turn 时间线">
          {[6, 12, 4, 18, 9, 3].map((w, i) => (
            <i key={i} style={{ width: `${w * 4}px`, background: i === 3 ? "var(--bar-think)" : i === 5 ? "var(--bar-err)" : "var(--bar-tool)" }} />
          ))}
        </div>
        <div className="tl-legend">
          <span>
            <i style={{ background: "var(--bar-tool)" }} />工具
          </span>
          <span>
            <i style={{ background: "var(--bar-think)" }} />思考
          </span>
          <span>
            <i style={{ background: "var(--bar-err)" }} />错误
          </span>
          <span className="mono">{providers.length} 端点</span>
        </div>
      </div>
      {s.popover === "search" ? <Search /> : null}
      <Thread />
      <PromptBox />
    </>
  );
}

/** 挂 assistant-ui 运行时（PLAN §5.3）：线程状态机与发送/中断走它，卡片视觉走我们的组件 */
export function Chat() {
  const rt = useKiloRuntime();
  return (
    <KiloRuntime.Provider value={rt}>
      <AssistantRuntimeProvider runtime={rt}>
        <ChatInner />
      </AssistantRuntimeProvider>
    </KiloRuntime.Provider>
  );
}
