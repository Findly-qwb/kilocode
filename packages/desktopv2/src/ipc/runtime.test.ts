/**
 * IPC 事件流 → store reducer 的单元测试（PLAN §5.3 的三条硬要求）。
 * 跑法：bun test src/ipc
 */
import { describe, expect, test } from "bun:test";
import { Runtime, type ToolPart } from "./runtime";

const sid = "s-test";

const mk = () => {
  const r = new Runtime();
  r.local((s) => {
    s.session = sid;
  });
  return r;
};

describe("文本与思考增量", () => {
  test("按 seq 顺序拼接", () => {
    const r = mk();
    r.feed("text_delta", { session_id: sid, message_id: "a1", seq: 0, delta: "你好，" });
    r.feed("text_delta", { session_id: sid, message_id: "a1", seq: 1, delta: "世界" });
    const text = r.state.messages.find((m) => m.id === "a1")?.blocks.find((b) => b.kind === "text");
    expect(text?.kind === "text" && text.text).toBe("你好，世界");
  });

  test("reasoning 单独成块，不混进正文", () => {
    const r = mk();
    r.feed("reasoning_delta", { session_id: sid, message_id: "a2", seq: 0, delta: "先想想" });
    r.feed("text_delta", { session_id: sid, message_id: "a2", seq: 0, delta: "结论" });
    const kinds = r.state.messages.find((m) => m.id === "a2")?.blocks.map((b) => b.kind);
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("text");
  });

  test("重复投递同一 seq 不重复追加", () => {
    const r = mk();
    r.feed("text_delta", { session_id: sid, message_id: "a3", seq: 0, delta: "x" });
    const same = { session_id: sid, message_id: "a3", seq: 0, delta: "x" };
    r.feed("text_delta", same);
    const block = r.state.messages.find((m) => m.id === "a3")?.blocks[0];
    expect(block?.kind === "text" && block.text).toBe("x");
  });
});

describe("乱序与 resync（PLAN §5.3）", () => {
  test("低 seq 投递被丢弃并请求 resync", () => {
    const r = mk();
    let asked = -1;
    r.onResync((since) => {
      asked = since;
    });
    r.feed("text_delta", { session_id: sid, message_id: "a4", seq: 5, delta: "后" });
    r.feed("text_delta", { session_id: sid, message_id: "a4", seq: 2, delta: "前" });
    expect(asked).toBe(5);
    const block = r.state.messages.find((m) => m.id === "a4")?.blocks[0];
    expect(block?.kind === "text" && block.text).toBe("后");
  });
});

describe("工具卡状态机", () => {
  test("start → output_delta → result 落定为 ok", () => {
    const r = mk();
    r.feed("tool_call_start", { call_id: "c1", tool_name: "bash", source: "rpi", args: { command: "ls" }, session_id: sid, turn_index: 0 });
    r.feed("tool_call_output_delta", { call_id: "c1", chunk: "a\n" });
    r.feed("tool_call_output_delta", { call_id: "c1", chunk: "b\n" });
    r.feed("tool_call_result", { call_id: "c1", result: "done", duration_ms: 12, truncated: false });
    const t = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "tool");
    expect(t?.kind === "tool" && t.state).toBe("ok");
    expect(t?.kind === "tool" && t.output).toBe("a\nb\n");
  });

  test("带 error 的结果转 err 并保留截断标记", () => {
    const r = mk();
    r.feed("tool_call_start", { call_id: "c2", tool_name: "read", source: "rpi", args: {}, session_id: sid, turn_index: 1 });
    r.feed("tool_call_result", { call_id: "c2", error: "没找到", duration_ms: 3, truncated: true });
    const t = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "tool");
    expect(t?.kind === "tool" && t.state).toBe("err");
    expect(t?.kind === "tool" && t.truncated).toBe(true);
  });
});

describe("审批（§6.6 oneshot 往返）", () => {
  test("human_confirm_required 让工具卡进入待审批并把会话态切成 awaiting_approval", () => {
    const r = mk();
    r.feed("tool_call_start", { call_id: "c3", tool_name: "write", source: "rpi", args: {}, session_id: sid, turn_index: 0 });
    r.feed("human_confirm_required", {
      call_id: "c3",
      tool_name: "write",
      source: "rpi",
      kind: "paths",
      paths: ["a.ts"],
      matched_rule: { scope: "mode:code", policy: "require_approval" },
      expires_at: Date.now() + 1000,
    });
    const t = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "tool");
    expect(t?.kind === "tool" && t.state).toBe("awaiting_approval");
    expect(t?.kind === "tool" && t.confirm?.paths).toEqual(["a.ts"]);
    expect(r.state.activity).toBe("awaiting_approval");
  });

  test("同意后继续执行，拒绝后置为 denied", () => {
    const r = mk();
    const ask = (call: string, turn: number, command: string) => {
      r.feed("tool_call_start", { call_id: call, tool_name: "bash", source: "rpi", args: {}, session_id: sid, turn_index: turn });
      r.feed("human_confirm_required", { call_id: call, tool_name: "bash", source: "rpi", kind: "command", command, expires_at: Date.now() });
    };
    const toolOf = (call: string) =>
      r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "tool" && b.call_id === call) as ToolPart | undefined;

    ask("c4", 0, "rm -rf x");
    r.approve("c4", "allow");
    expect(toolOf("c4")?.state).toBe("running");

    ask("c5", 1, "ls");
    r.approve("c5", "deny");
    expect(toolOf("c5")?.state).toBe("denied");
  });
});

describe("回合与生命周期", () => {
  test("turn_end 收尾流式标记并落 outcome 块", () => {
    const r = mk();
    r.feed("text_delta", { session_id: sid, message_id: "a9", seq: 0, delta: "hi" });
    r.feed("turn_end", { turn_index: 0, tokens: { prompt: 10, completion: 2, reasoning: 0, cache_read: 0 }, cost_estimate: 0.01, model: "m" });
    const blocks = r.state.messages.flatMap((m) => m.blocks);
    const text = blocks.find((b) => b.kind === "text");
    expect(text?.kind === "text" && text.streaming).toBeFalsy();
    expect(blocks.some((b) => b.kind === "outcome")).toBe(true);
  });

  test("agent_end reason=panic 把会话标为 error", () => {
    const r = mk();
    r.feed("agent_end", { reason: "panic", summary: "任务异常终止" });
    expect(r.state.activity).toBe("error");
  });

  test("fatal 错误进 store 且保留重试倒计时", () => {
    const r = mk();
    r.feed("agent_error", { level: "error", code: "rate_limited", message: "429", retryable: true, retry_in_ms: 8000, attempt: 2, fatal: true });
    const err = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "error");
    expect(err?.kind === "error" && err.err.retry_in_ms).toBe(8000);
    expect(r.state.activity).toBe("error");
  });

  test("compact_done 生成分割线块", () => {
    const r = mk();
    r.feed("compact_done", { from_turn: 3, tokens_before: 52000, tokens_after: 9000 });
    const c = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "compact");
    expect(c?.kind === "compact" && c.before).toBe(52000);
  });
});

describe("列表与队列", () => {
  test("queue_state 原样落到 store", () => {
    const r = mk();
    r.feed("queue_state", { main: [], steering: [{ id: "q1", text: "先别提交" }], follow_up: [{ id: "q2", text: "补注释" }] });
    expect(r.state.queue.steering.length).toBe(1);
    expect(r.state.queue.follow_up[0]?.text).toBe("补注释");
  });

  test("session_updated 更新会话活动态与标题", () => {
    const r = mk();
    r.local((s) => {
      s.sessions = [
        { id: sid, project_id: "p", title: "旧名", mode: "code", status: "idle", total_tokens: 0, cost_estimate: 0, pinned: false, updated_at: 1, created_at: 1 },
      ];
    });
    r.feed("session_updated", { session_id: sid, title: "新名", updated_at: 2, activity: "running" });
    expect(r.state.sessions[0]?.title).toBe("新名");
    expect(r.state.activity).toBe("running");
  });
});

describe("part 级覆盖", () => {
  test("message_part_upserted 覆盖同 call_id 的工具块", () => {
    const r = mk();
    r.feed("tool_call_start", { call_id: "c9", tool_name: "edit", source: "kilo", args: {}, session_id: sid, turn_index: 0 });
    r.feed("message_part_upserted", {
      session_id: sid,
      part: { id: "p1", message_id: "m1", seq: 0, type: "tool", call_id: "c9", tool_name: "edit", tool_source: "kilo", state: "ok", content: { output: "已应用", added: 4, deleted: 1 } },
    });
    const t = r.state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "tool" && b.call_id === "c9");
    expect(t?.kind === "tool" && t.state).toBe("ok");
  });
});
