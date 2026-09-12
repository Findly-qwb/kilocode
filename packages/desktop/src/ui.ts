import { createSignal } from "solid-js"

export type ModalName = "provider" | "custom" | "mcp" | "market" | "install" | "cloudimport" | "feedback" | "agent"
export type ModalArg = { provider?: string; mcp?: string; item?: string; name?: string }

export const [modal, setModal] = createSignal<{ name: ModalName; arg?: ModalArg }>()
export const openModal = (name: ModalName, arg?: ModalArg) => setModal({ name, arg })
export const closeModal = () => setModal(undefined)

export let setSettingsTab: (t: string) => void = () => {}
export const setTabFromExternal = (fn: (t: string) => void) => {
  setSettingsTab = fn
}
