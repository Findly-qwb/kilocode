/**
 * assistant-ui 运行时适配层（PLAN §5.3 / §12 Spike ②）。
 *
 * 分工：
 *   - Rust 事件流 → src/ipc/runtime.ts 的 reducer（part 级状态、seq 去重、resync）——桌面侧事实来源；
 *   - 本文件把这份 store 投影成 assistant-ui 的 ExternalStoreAdapter，由 assistant-ui 拥有
 *     线程状态机与发送/中断/重发/删除的生命周期，以及 composer；
 *   - 卡片视觉仍由我们的组件渲染（工具卡/审批卡是原型的视觉资产）：需要时通过
 *     getExternalStoreMessages(message) 拿回原始消息，不为套 primitive 而牺牲视觉。
 */
import { useMemo, useSyncExternalStore } from "react";
import {
  useExternalStoreRuntime,
  type ExternalStoreAdapter,
  type ReasoningMessagePart,
  type TextMessagePart,
  type ThreadMessageLike,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import { invoke, runTurn } from "./bridge";
import { runtime, type Block, type Message, type ToolPart } from "./runtime";
import { ui } from "../ui/state";

type Part = TextMessagePart | ReasoningMessagePart | ToolCallMessagePart;

/** Block → assistant-ui content part；outcome/compact/error/question 属于我们的渲染，不下传 */
function toParts(blocks: Block[]): Part[] {
  const out: Part[] = [];
  for (const b of blocks) {
    if (b.kind === "text") out.push({ type: "text", text: b.text });
    if (b.kind === "reasoning") out.push({ type: "reasoning", text: b.text });
    if (b.kind === "tool") {
      const t = b as ToolPart;
      out.push({
        type: "tool-call",
        toolCallId: t.call_id,
        toolName: `${t.source}:${t.tool_name}`,
        args: (t.args ?? {}) as ToolCallMessagePart["args"],
        argsText: JSON.stringify(t.args ?? {}),
        result: t.result,
        isError: t.state === "err" || t.state === "denied" || undefined,
        artifact: { state: t.state, output: t.output, error: t.error, duration_ms: t.duration_ms, truncated: t.truncated, confirm: t.confirm },
      });
    }
  }
  return out;
}

const snapshot = () => runtime.state;
const subscribe = (fn: () => void) => runtime.subscribe(fn);

export function useKiloRuntime() {
  const state = useSyncExternalStore(subscribe, snapshot);
  const adapter = useMemo<ExternalStoreAdapter<Message>>(
    () => ({
      messages: state.messages,
      isRunning: state.activity === "running" || state.activity === "awaiting_approval",
      convertMessage: (m): ThreadMessageLike => ({
        id: m.id,
        role: m.role,
        createdAt: new Date(m.created_at),
        // 待审批用 assistant-ui 原生 requires-action/interrupt 表达，不自己造状态
        status:
          m.status === "streaming"
            ? state.activity === "awaiting_approval"
              ? { type: "requires-action", reason: "interrupt" as const }
              : ({ type: "running" } as const)
            : m.status === "stopped"
              ? ({ type: "incomplete", reason: "cancelled" } as const)
              : m.status === "error"
                ? ({ type: "incomplete", reason: "error" } as const)
                : ({ type: "complete", reason: "stop" } as const),
        content: toParts(m.blocks),
        metadata: { custom: { turn_index: m.turn_index ?? null } },
      }),
      onNew: async (message) => {
        const text = message.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("");
        // assistant-ui 的原生 steer 标记映射到桌面 steering 队列（PLAN §6.1）
        if (message.steer || state.activity === "running" || state.activity === "awaiting_approval") {
          await invoke("submit_steering", { session_id: state.session ?? "", text });
          return;
        }
        await runTurn(text, ui.get().mode);
      },
      onCancel: async () => {
        await invoke("stop_agent", { session_id: state.session ?? "" });
      },
      onReload: async () => {
        const last = [...state.messages].reverse().find((m) => m.role === "user");
        if (last) await runTurn(last.text ?? "", ui.get().mode);
      },
      onDelete: async (id) => {
        runtime.local((s) => {
          s.messages = s.messages.filter((m) => m.id !== id);
        });
      },
    }),
    [state],
  );
  return useExternalStoreRuntime(adapter);
}
