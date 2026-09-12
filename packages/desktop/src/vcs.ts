import { createSignal } from "solid-js"
import { client, directory } from "./client"

let timer: ReturnType<typeof setTimeout> | undefined

export const [vcs, setVcs] = createSignal({ branch: "", ahead: 0, behind: 0, dirty: 0 })

export async function vcsRefresh() {
  const c = client()
  if (!c || !directory()) return
  const [i, d] = await Promise.all([
    c.vcs.get({ directory: directory() }).catch(() => undefined),
    c.vcs.diff({ directory: directory(), mode: "git" }).catch(() => undefined),
  ])
  setVcs({ branch: i?.data?.branch ?? "", ahead: 0, behind: 0, dirty: (d?.data ?? []).length })
}

export function vcsSoon(ms = 300) {
  clearTimeout(timer)
  timer = setTimeout(() => void vcsRefresh(), ms)
}
