import { createKiloClient } from "@kilocode/sdk/v2/client"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { createSignal } from "solid-js"
import { authHeader, serverInfo, type Info } from "./backend"

export type Client = ReturnType<typeof createKiloClient>

const subs = new Set<(e: GlobalEvent) => void>()
let sse: AbortController | undefined

function makeClient(info: Info, directory: string): Client {
  return createKiloClient({
    baseUrl: info.baseUrl,
    headers: { Authorization: authHeader(info) },
    directory,
  })
}

function startSse(info: Info, directory: string) {
  sse?.abort()
  const ctrl = new AbortController()
  sse = ctrl
  void (async () => {
    let attempt = 0
    while (!ctrl.signal.aborted) {
      try {
        const client = makeClient(info, directory)
        const events = await client.global.event({ signal: ctrl.signal, sseMaxRetryAttempts: 0 })
        attempt = 0
        for await (const event of events.stream) {
          if (ctrl.signal.aborted) return
          for (const cb of subs) cb(event)
        }
      } catch {
        if (ctrl.signal.aborted) return
      }
      attempt += 1
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 30000)))
    }
  })()
}

async function waitInfo(): Promise<Info> {
  for (;;) {
    const info = await serverInfo()
    if (info) return info
    await new Promise((r) => setTimeout(r, 500))
  }
}

const [info, setInfo] = createSignal<Info>()
const [directory, setDirectorySignal] = createSignal(localStorage.getItem("directory") ?? "")
const [client, setClient] = createSignal<Client>()
const [ready, setReady] = createSignal(false)

export async function connect() {
  const i = await waitInfo()
  setInfo(i)
  if (!directory()) {
    const res = await fetch(`${i.baseUrl}/path`, { headers: { Authorization: authHeader(i) } })
    if (res.ok) setDirectorySignal((await res.json()).directory ?? "")
  }
  rebuild()
  setReady(true)
  return i
}

function rebuild() {
  const i = info()
  if (!i) return
  setClient(makeClient(i, directory()))
  startSse(i, directory())
}

export function setDirectory(dir: string) {
  localStorage.setItem("directory", dir)
  setDirectorySignal(dir)
  const recents: string[] = JSON.parse(localStorage.getItem("recents") ?? "[]")
  const next = [dir, ...recents.filter((r) => r !== dir)].slice(0, 8)
  localStorage.setItem("recents", JSON.stringify(next))
  setRecents(next)
  rebuild()
}

export const [recents, setRecents] = createSignal<string[]>(JSON.parse(localStorage.getItem("recents") ?? "[]"))

export function onEvent(cb: (e: GlobalEvent) => void) {
  subs.add(cb)
  return () => subs.delete(cb)
}

export { info, directory, client, ready }
