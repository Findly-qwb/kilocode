import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { client, directory, info } from "../client"

export function Terminal(props: { onClose: () => void }) {
  let host!: HTMLDivElement
  const [err, setErr] = createSignal("")

  onMount(async () => {
    const c = client()
    const i = info()
    if (!c || !i) {
      setErr("后端未连接")
      return
    }
    const term = new XTerm({
      fontSize: 12,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      cursorBlink: true,
      theme: { background: "#14120f", foreground: "#f4ecdf" },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const created = await c.pty
      .create({ cwd: directory() || undefined, title: "Kilo", size: { rows: term.rows, cols: term.cols } })
      .catch((e: Error) => {
        setErr(`创建终端失败：${e.message}`)
      })
    if (!created) return
    const id = created.data!.id
    const tk = await c.pty.connectToken({ ptyID: id })
    const ws = new WebSocket(`${i.baseUrl.replace("http", "ws")}/pty/${id}/connect?ticket=${tk.data!.ticket}`)
    ws.binaryType = "arraybuffer"
    ws.onmessage = (ev) => {
      const d = ev.data
      if (d instanceof ArrayBuffer) {
        const b = new Uint8Array(d)
        if (b[0] !== 0) term.write(b)
      } else if (typeof d === "string" && d.charCodeAt(0) !== 0) term.write(d)
    }
    ws.onerror = () => setErr("终端连接断开")
    const data = term.onData((s) => ws.readyState === WebSocket.OPEN && ws.send(s))

    const ro = new ResizeObserver(() => {
      fit.fit()
      void c.pty.update({ ptyID: id, size: { rows: term.rows, cols: term.cols } }).catch(() => {})
    })
    ro.observe(host)

    onCleanup(() => {
      ro.disconnect()
      data.dispose()
      ws.close()
      term.dispose()
      void c.pty.remove({ ptyID: id }).catch(() => {})
    })
  })

  return (
    <div class="term">
      <div class="termbar">
        <span>终端</span>
        <span class="grow" />
        <Show when={err()}>
          <em class="gstat">{err()}</em>
        </Show>
        <button onClick={props.onClose}>×</button>
      </div>
      <div class="termhost" ref={host} />
    </div>
  )
}
