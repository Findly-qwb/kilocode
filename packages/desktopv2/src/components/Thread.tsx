/**
 * 对话渲染层（PLAN §5.2）：全部走 assistant-ui primitives。
 *
 * 线程迭代、part 分派、流式状态、复制/重发/编辑这些动作由库负责；
 * 我们只提供「每种 part 长什么样」的注册表和原型的 class 名，皮肤 token 照旧生效。
 * outcome / compact / question / error 也在适配器里变成了 data part，
 * 因此这里没有「回查我们自己的 store」这种旁路。
 */
import { ActionBarPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type {
  DataMessagePartProps,
  ReasoningMessagePartProps,
  TextMessagePartProps,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime, type ToolPart } from "../ipc/runtime";
import { ui } from "../ui/state";
import { ApprovalCard } from "./ApprovalCard";
import { DiffView, Stat } from "./DiffView";
import { Md } from "../md";
import { OutcomeBar } from "./OutcomeBar";
import { QuestionCard } from "./QuestionCard";
import { ToolCard } from "./ToolCard";

const Text = ({ text, status }: TextMessagePartProps) => <Md text={text} streaming={status?.type === "running"} />;

const Reasoning = ({ text, status }: ReasoningMessagePartProps) => (
  <div className={`tool think ${status?.type === "running" ? "running" : ""}`}>
    <details open={status?.type === "running"}>
      <summary className="thead">
        <span className="ti">
          <Icon name="bulb" cls="sm" />
        </span>
        <span className="tname">{status?.type === "running" ? "思考中…" : "思考链"}</span>
        <span className="tsub">{text.length.toLocaleString()} 字符</span>
      </summary>
      <div className="tbody">
        <Md text={text} />
      </div>
    </details>
  </div>
);

/** tool-call part 的 artifact 带回我们 store 的字段，卡片组件因此无需改动 */
const asTool = (part: ToolCallMessagePartProps): ToolPart => {
  const a = (part.artifact ?? {}) as Record<string, unknown>;
  const [src, name] = String(part.toolName).split(":");
  return {
    kind: "tool",
    call_id: part.toolCallId,
    tool_name: name ?? String(part.toolName),
    source: (src as ToolPart["source"]) ?? "rpi",
    args: (part.args ?? {}) as Record<string, unknown>,
    turn_index: (a.turn_index as number) ?? 0,
    state: (a.state as ToolPart["state"]) ?? (part.result ? "ok" : "running"),
    output: String(a.output ?? ""),
    result: part.result,
    error: (a.error as string) ?? (part.isError ? String(part.result ?? "") : undefined),
    duration_ms: a.duration_ms as number | undefined,
    truncated: Boolean(a.truncated),
    confirm: a.confirm as ToolPart["confirm"],
  };
};

const Tool = (props: ToolCallMessagePartProps) => {
  const t = asTool(props);
  return t.state === "awaiting_approval" && t.confirm ? <ApprovalCard confirm={t.confirm} args={t.args} /> : <ToolCard t={t} />;
};

const Data = ({ name, data }: DataMessagePartProps) => {
  const d = (data ?? {}) as Record<string, unknown>;
  if (name === "outcome") return <OutcomeBar end={d.end as never} turn={d.turn as never} />;
  if (name === "question") return <QuestionCard q={d.q as never} answered={Boolean(d.answered)} />;
  if (name === "compact")
    return (
      <div className="compact">
        <span className="tag">
          <Icon name="layers" cls="sm" /> 上下文已压缩 · Turn {String(d.from_turn ?? 0)}+ · {Number(d.before ?? 0).toLocaleString()} → {Number(d.after ?? 0).toLocaleString()} tokens
        </span>
      </div>
    );
  if (name === "revertbar")
    return (
      <div className="revertbar">
        <b>{String(d.text ?? "")}</b>
        <button className="btn xs" onClick={() => void invoke("redo_step", { session_id: runtime.state.session ?? "", message_id: "" })}>
          <Icon name="redo" cls="sm" />
          Redo
        </button>
      </div>
    );
  if (name === "diffstat") return <Stat added={Number(d.added ?? 0)} deleted={Number(d.deleted ?? 0)} />;
  if (name === "diff") return <DiffView diff={String(d.diff ?? "")} files={d.files as string[]} />;
  return null;
};

const PARTS = { Text, Reasoning, tools: { Fallback: Tool }, data: { by_name: { outcome: Data, question: Data, compact: Data, revertbar: Data, diffstat: Data, diff: Data } } };

export function Thread() {
  return (
    <ThreadPrimitive.Root style={{ display: "contents" }}>
      <ThreadPrimitive.Viewport className="messages" id="messages" autoScroll>
        <ThreadPrimitive.Empty>
          <div className="outcome">
            <span className="mono">还没有消息</span>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <ThreadPrimitive.ScrollToBottom className="tobottom show" title="回到底部">
        <Icon name="arrow-down" />
      </ThreadPrimitive.ScrollToBottom>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="msg user">
      <div className="meta">
        <span className="badge gray">{runtime.state.activity}</span>
        <MessagePrimitive.If hasAttachments>
          <span className="mono">附件</span>
        </MessagePrimitive.If>
      </div>
      <div className="bubble">
        <MessagePrimitive.Content components={{ Text }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="msg ai">
      <div className="aihead">
        <span className="who">Kilo</span>
        <span className="badge gray">Code</span>
        <span className="mono">{ui.get().model}</span>
      </div>
      <MessagePrimitive.Content components={PARTS} />
      <MessagePrimitive.Error>
        <div className="tool err">
          <div className="thead">
            <span className="ti">
              <Icon name="alert" cls="sm" />
            </span>
            <span className="tname">本回合未完成</span>
          </div>
        </div>
      </MessagePrimitive.Error>
      <ActionBarPrimitive.Root className="hoveract">
        <ActionBarPrimitive.Copy className="btn xs">
          <Icon name="copy" cls="sm" />
          复制
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Edit className="btn xs">
          <Icon name="pencil" cls="sm" />
          编辑
        </ActionBarPrimitive.Edit>
        <ActionBarPrimitive.Reload className="btn xs">
          <Icon name="refresh" cls="sm" />
          重发
        </ActionBarPrimitive.Reload>
        <ActionBarPrimitive.ExportMarkdown className="btn xs">
          <Icon name="download" cls="sm" />
          Markdown
        </ActionBarPrimitive.ExportMarkdown>
        <button
          className="btn xs"
          onClick={() =>
            void invoke("revert_to_message", { session_id: runtime.state.session ?? "", message_id: "" }).then((r) =>
              ui.set({ toast: { title: "已回退到此处", body: `恢复 ${(r as { files: string[] }).files.length} 个文件` } }),
            )
          }
        >
          <Icon name="redo" cls="sm" />
          Revert
        </button>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
