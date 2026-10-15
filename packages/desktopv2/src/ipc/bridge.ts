/**
 * IPC 桥（PLAN §3.2「只走 Tauri IPC，不起 HTTP」）。
 *
 * 在 Tauri 里走原生 invoke/event；在浏览器里退回 mock 宿主 —— 这条通路让整个
 * 前端可以脱离原生壳逐屏验证（与 prototype-v2.html 的验证方式对齐）。
 */
import type { CommandName, Commands, EventName } from "./protocol";
import { runtime } from "./runtime";

type Unsub = () => void;

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const handlers = new Map<EventName, Set<(p: never) => void>>();

export function listen<E extends EventName>(name: E, fn: (payload: import("./protocol").Events[E]) => void): Unsub {
  if (!isTauri) {
    const set = handlers.get(name) ?? new Set();
    set.add(fn as never);
    handlers.set(name, set);
    return () => set.delete(fn as never);
  }
  let disposed = false;
  let un: Unsub | undefined;
  void import("@tauri-apps/api/event").then(({ listen: native }) => {
    if (disposed) return;
    void native(name, (e) => fn(e.payload as never)).then((off) => {
      un = off;
    });
  });
  return () => {
    disposed = true;
    un?.();
  };
}

/** 事件唯一入口：Tauri 与 mock 都汇到这里，再进 store  reducer */
export function dispatch<E extends EventName>(name: E, payload: import("./protocol").Events[E]) {
  runtime.feed(name, payload);
  for (const fn of handlers.get(name) ?? []) (fn as (p: unknown) => void)(payload);
}

export async function invoke<C extends CommandName>(cmd: C, args?: Commands[C][0]): Promise<Commands[C][1]> {
  if (isTauri) {
    const { invoke: native } = await import("@tauri-apps/api/core");
    return native(cmd, args ?? {}) as Promise<Commands[C][1]>;
  }
  const { host } = await import("./mock");
  return host.invoke(cmd, args) as Promise<Commands[C][1]>;
}

export const native = isTauri;

/**
 * 打开一屏的事件脚本。dev-only：原生壳里没有场景脚本，改由真实宿主事件驱动。
 * 返回投递的事件数，供逐屏验证脚本断言「这屏真的有事件流过」。
 */
export async function play(scene: string): Promise<number> {
  if (isTauri || !scene) return 0;
  const { host } = await import("./mock");
  return host.play(scene);
}

/** 走一遍真审批往返（submit → human_confirm_required → approve → result） */
export async function runTurn(text: string, mode: import("./protocol").Mode) {
  if (isTauri) return invoke("submit_message", { session_id: runtime.state.session ?? "", text, mode, model: "" });
  const { host } = await import("./mock");
  return host.runTurn(text, mode);
}

/** 事件断流后按 since_seq 补齐（PLAN §5.3） */
runtime.onResync(async (since) => {
  const session = runtime.state.session;
  if (!session) return;
  const parts = await invoke("resync", { session_id: session, since_seq: since });
  for (const part of parts) runtime.feed("message_part_upserted", { session_id: session, part });
});
