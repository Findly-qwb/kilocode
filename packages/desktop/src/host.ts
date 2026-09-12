import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

export const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

export async function pickDir() {
  if (!tauri) return null
  return invoke<string | null>("pick_dir")
}

export async function openUrl(url: string) {
  if (!tauri) {
    window.open(url, "_blank")
    return
  }
  await invoke("open_url", { url }).catch(() => window.open(url, "_blank"))
}

export async function openPath(p: string) {
  await openUrl(`file://${p.replace(/\\/g, "/")}`)
}

export async function gitCmd(dir: string, args: string[]) {
  if (!tauri) throw new Error("非桌面环境")
  return invoke<string>("git_cmd", { dir, args })
}

export async function writeSkill(dir: string, name: string, desc: string) {
  return invoke("write_skill", { dir, name, desc })
}

export async function writeAgent(dir: string, name: string, desc: string, body: string) {
  return invoke("write_agent", { dir, name, desc, body })
}

export async function toggleSkill(path: string, on: boolean) {
  return invoke("toggle_skill", { path, on })
}

export async function removeMcp(dir: string, name: string) {
  return invoke("remove_mcp", { dir, name })
}

export async function restartBackend(args: string, envs: string[]) {
  return invoke("restart_backend", { args, envs })
}

export const win = () => getCurrentWindow()
export const winMin = () => tauri && win().minimize()
export const winMax = () => tauri && win().toggleMaximize()
export const winClose = () => (tauri ? win().close() : window.close())
