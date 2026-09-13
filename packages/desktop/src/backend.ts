import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

export type Info = { port: number; password: string; baseUrl: string }

const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

export const serverInfo = async () => (tauri ? invoke<Info | null>("server_info") : null)

export const onReady = (cb: (info: Info) => void) => (tauri ? listen<Info>("backend://ready", (e) => cb(e.payload)) : async () => {})

export const onExit = (cb: (reason: string) => void) => (tauri ? listen<string>("backend://exit", (e) => cb(e.payload)) : async () => {})

export const authHeader = (info: Info) => "Basic " + btoa(`kilo:${info.password}`)

export async function health(info: Info) {
  const res = await fetch(`${info.baseUrl}/global/health`, { headers: { Authorization: authHeader(info) } })
  if (!res.ok) throw new Error(`health ${res.status}`)
  const body: { version?: unknown } = await res.json()
  if (typeof body.version !== "string") throw new Error("health payload missing version")
  return { healthy: true as const, version: body.version }
}
