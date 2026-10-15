/** 把 assistant-ui 的 runtime 暴露给 composer（发送/中断走它的线程 API）。 */
import { createContext, useContext } from "react";
import type { AssistantRuntime } from "@assistant-ui/react";

export const KiloRuntime = createContext<AssistantRuntime | null>(null);

export function useRuntime() {
  return useContext(KiloRuntime);
}
