/**
 * 消息流渲染（PLAN §5.2）：store 的 Block 序列 -> 转录 DOM。
 *
 * 这里只做「块类型 -> 组件」的分发与滚动策略，卡片本体在 components/ 下各自实现。
 * 自动跟随滚动：用户上滚即解除跟随并出现 .tobottom；回到底部重新跟随。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime, type Block, type ToolPart } from "../ipc/runtime";
import { ui, useUi } from "../ui/state";
import { ApprovalCard, orphans, useConfirms } from "./ApprovalCard";
import { Md } from "../md";
import { OutcomeBar } from "./OutcomeBar";
import { QuestionCard } from "./QuestionCard";
import { ToolCard } from "./ToolCard";

const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

/** 错误卡：按 agent_error.code 给可行动说明，retryable 显示倒计时（PLAN §6.7 §9.1） */
function ErrorCard({ block }: { block: Extract<Block, { kind: "error" }> }) {
  const e = block.err;
  const [left, setLeft] = useState(e.retry_in_ms ?? 0);
  useEffect(() => {
    if (!e.retry_in_ms) return;
    const tick = setInterval(() => setLeft((v) => Math.max(0, v - 1000)), 1000);
    return () => clearInterval(tick);
  }, [e.retry_in_ms]);
  const why: Record<string, string> = {
    no_endpoint: "还没有可用端点",
    unauthorized: "端点拒绝了这个 key",
    rate_limited: "服务商限流",
    unreachable: "连不上端点",
    tool_timeout: "工具执行超时",
    sqlite_io: "本地数据库写入失败",
    panic: "任务异常终止（同进程崩溃域已隔离，窗口仍在）",
    loop_breaker: "疑似死循环，已熔断",
  };
  return (
    <div className="tool err">
      <div className="thead">
        <span className="ti">
          <Icon name="alert" cls="sm" />
        </span>
        <span className="tname">{why[e.code] ?? e.code}</span>
        <span className="tstat">
          {e.attempt ? <span>第 {e.attempt} 次</span> : null}
          {e.fatal ? <span className="badge err">致命</span> : null}
        </span>
      </div>
      <div className="tbody">
        <div style={{ marginBottom: 8 }}>{e.message}</div>
        <div className="grow">
          {e.retryable ? (
            <>
              <button className="btn xs primary" onClick={() => ui.set({ toast: { title: "已请求重试" } })}>
                <Icon name="refresh" cls="sm" />
                重试{left > 0 ? `（${secs(left)}）` : ""}
              </button>
              {e.fatal ? (
                <button className="btn xs" onClick={() => ui.set({ toast: { title: "已回滚到上一个检查点" } })}>
                  <Icon name="redo" cls="sm" />
                  回滚到检查点
                </button>
              ) : null}
            </>
          ) : (
            <button className="btn xs" onClick={() => ui.set({ view: "settings", tab: "endpoints" })}>
              <Icon name="sliders" cls="sm" />
              去端点设置
            </button>
          )}
          <span className="mono" style={{ color: "var(--text-weaker)", fontSize: "var(--fs-11)" }}>
            code={e.code}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 压缩分割线（PLAN §6.3） */
function CompactRule({ block }: { block: Extract<Block, { kind: "compact" }> }) {
  return (
    <div className="compact">
      <span className="tag">
        <Icon name="layers" cls="sm" />
        上下文已压缩 · Turn {block.from_turn}+ · {block.before.toLocaleString()} → {block.after.toLocaleString()} tokens
      </span>
    </div>
  );
}

function Reasoning({ block }: { block: Extract<Block, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool think">
      <div className="thead" onClick={() => setOpen(!open)}>
        <span className="ti">
          <Icon name="bulb" cls="sm" />
        </span>
        <span className="tname">思考链</span>
        <span className="tsub">{block.text.length.toLocaleString()} 字符</span>
        <span className="tstat">
          <Icon name={open ? "chevron-up" : "chevron-down"} cls="sm" />
        </span>
      </div>
      {open ? (
        <div className="tbody">
          <Md text={block.text} streaming={block.streaming} />
        </div>
      ) : null}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "text") return <Md text={block.text} streaming={block.streaming} />;
  if (block.kind === "reasoning") return <Reasoning block={block} />;
  if (block.kind === "tool") return <ToolCard t={block as ToolPart} />;
  if (block.kind === "compact") return <CompactRule block={block} />;
  if (block.kind === "error") return <ErrorCard block={block} />;
  if (block.kind === "outcome") return <OutcomeBar end={block.end} turn={block.turn} />;
  if (block.kind === "question") return <QuestionCard q={block.q} answered={block.answered} />;
  return null;
}

/** 消息 hover：复制 / Fork / Revert（PLAN §7.2 逐消息回滚入口） */
function Hover({ id }: { id: string }) {
  return (
    <div className="hoveract">
      <button
        onClick={() => {
          const m = runtime.state.messages.find((x) => x.id === id);
          const text = m?.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("") ?? m?.text ?? "";
          navigator.clipboard?.writeText(text).catch(() => undefined);
          ui.set({ toast: { title: "已复制" } });
        }}
      >
        <Icon name="copy" cls="sm" />
        复制
      </button>
      <button
        onClick={() =>
          void invoke("session_fork", { session_id: runtime.state.session ?? "", message_id: id }).then(() =>
            ui.set({ toast: { title: "已从此处 Fork 新会话" } }),
          )
        }
      >
        <Icon name="fork" cls="sm" />
        Fork
      </button>
      <button
        onClick={() =>
          void invoke("revert_to_message", { session_id: runtime.state.session ?? "", message_id: id }).then((r) =>
            ui.set({
              banner: { text: `已回退到此处（恢复 ${(r as { files: string[] }).files.length} 个文件）`, redo: true },
              toast: { title: "Revert 完成", body: "checkpoint 按文件粒度恢复快照" },
            }),
          )
        }
      >
        <Icon name="redo" cls="sm" />
        Revert
      </button>
    </div>
  );
}

export function MessageList() {
  const st = runtime.state;
  const s = useUi();
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const confs = useConfirms();
  const loose = orphans(confs);

  useLayoutEffect(() => {
    if (!follow) return;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.messages, follow]);

  const marks = st.messages.filter((m) => m.role === "user");

  return (
    <>
      <div className="messages" id="messages" ref={box} onScroll={() => setFollow(Boolean(box.current && box.current.scrollHeight - box.current.scrollTop - box.current.clientHeight < 60))}>
        {st.messages.map((m) =>
          m.role === "user" ? (
            <div className="msg user" key={m.id}>
              <div className="meta">
                <span className="badge gray">{st.session ? "Code" : ""}</span>
                <span className="mono">{new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="bubble">{m.text}</div>
              {m.attachments?.length ? (
                <div className="attach">
                  {m.attachments.map((a) => (
                    <span className="thumb" key={a.id} title={`${a.name} · ${a.bytes ?? 0} B`}>
                      {a.data ? <img src={a.data} alt={a.name} /> : <Icon name="file" cls="sm" />}
                    </span>
                  ))}
                </div>
              ) : null}
              <Hover id={m.id} />
            </div>
          ) : (
            <div className="msg ai" key={m.id}>
              <div className="aihead">
                <span className="mark">
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
                    <path d="M5 21V9a7 7 0 0 1 14 0v12l-3.5-2.5L12 21l-3.5-2.5z" stroke="var(--icon-strong)" strokeWidth="1.6" />
                  </svg>
                </span>
                <span className="who">Kilo</span>
                <span className="badge gray">Code</span>
                <span className="mono">{s.model}</span>
              </div>
              {m.blocks.map((b, i) => (
                <BlockView block={b} key={`${m.id}-${i}`} />
              ))}
              <Hover id={m.id} />
            </div>
          ),
        )}
        {/* 没有对应工具块的审批：直接挂在转录末尾（perm-dock 屏） */}
        {loose.map((c) => (
          <ApprovalCard key={c.call_id} confirm={c} />
        ))}
        {s.banner ? (
          <div className="revertbar">
            <b>{s.banner.text}</b>
            {s.banner.redo ? (
              <>
                <button
                  className="btn xs"
                  onClick={() =>
                    void invoke("redo_step", { session_id: st.session ?? "", message_id: "" }).then(() =>
                      ui.set({ banner: null, toast: { title: "已 Redo 到下一个快照" } }),
                    )
                  }
                >
                  <Icon name="redo" cls="sm" />
                  Redo
                </button>
                <button className="btn xs" onClick={() => ui.set({ banner: null })}>
                  Redo All
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {follow ? null : (
        <button
          className="tobottom show"
          onClick={() => {
            setFollow(true);
            if (box.current) box.current.scrollTop = box.current.scrollHeight;
          }}
        >
          <Icon name="arrow-down" />
          <span className="new" />
        </button>
      )}
      <div className="rail-marks" title="PromptRail：每个用户消息一个刻度，点击跳转">
        {marks.map((m, i) => (
          <i
            key={m.id}
            className={i === marks.length - 1 ? "cur" : ""}
            onClick={() => {
              const el = document.querySelector(`#v-chat [data-mid="${m.id}"]`);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        ))}
      </div>
    </>
  );
}
