// 打包 sidecar：复用 kilo-vscode 的 local-bin 产物（二进制 + tree-sitter/sandbox/ffmpeg 资源），
// 复制成 tauri externalBin 命名。跑法：bun script/sidecar.ts [--force]
import { join } from "path"
import {$} from "bun"

const desktop = join(import.meta.dir, "..")
const root = join(desktop, "..", "..")
const vscodeBin = join(root, "packages", "kilo-vscode", "bin")
const out = join(desktop, "src-tauri", "binaries")

const triples: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
}
const triple = triples[`${process.platform}-${process.arch}`] ?? "unknown-unknown"
const exe = process.platform === "win32" ? ".exe" : ""

await $`bun ${join(root, "packages/kilo-vscode/script/local-bin.ts")} ${process.argv.includes("--force") ? "--force" : ""}`.cwd(root)
await $`mkdir -p ${out}`
await $`cp ${join(vscodeBin, `kilo${exe}`)} ${join(out, `kilo-${triple}${exe}`)}`
await $`chmod +x ${join(out, `kilo-${triple}${exe}`)}`
for (const res of ["tree-sitter", "ffmpeg", "kilo-sandbox-mutation-worker.js"]) {
  await $`cp -R ${join(vscodeBin, res)} ${join(out, res)}`.nothrow()
}
console.log(`sidecar ready: ${join(out, `kilo-${triple}${exe}`)}`)
