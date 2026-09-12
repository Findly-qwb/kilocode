// tauri dev 启动器：把本仓库 CLI（bun 直跑源码）注入为桌面端后端。
// 打包版走 externalBin sidecar，M4 再接。
import { join } from "path"

const desktop = join(import.meta.dir, "..")
const root = join(desktop, "..", "..")

process.env.KILO_CLIENT = "cli"
// Windows 的 PATH 里常只有 npm shim（bun.ps1/bun.cmd）没有 bun.exe；用 execPath 绝对路径。
// ponytail: 按空白切分命令，路径含空格的机器请改用打包 sidecar
const exe = process.execPath
process.env.KILO_DESKTOP_BACKEND_CMD = [
  exe,
  "run",
  "--cwd",
  join(root, "packages", "opencode"),
  "--conditions=node",
  "src/index.ts",
  "serve",
  "--port",
  "0",
  "--hostname",
  "127.0.0.1",
].join(" ")

const proc = Bun.spawn([exe, "run", "tauri", "dev"], {
  cwd: desktop,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: process.env,
})

process.exit(await proc.exited)
