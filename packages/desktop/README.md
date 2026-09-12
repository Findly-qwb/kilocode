# kilo-desktop

Kilo 桌面端（alpha）：Tauri v2 壳 + SolidJS 前端，复用仓库 CLI 作为后端进程（`kilo serve`，HTTP + SSE，零后端改动）。功能范围与进度见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 开发

系统前置（Windows）：Rust 工具链（rustup，`stable-msvc`）+ VS C++ 生成工具 + WebView2（Win11 自带）。

```bash
# 仓库根目录装好依赖后：
bun run dev          # 注入仓库 CLI 为后端并启动 tauri dev（Windows/macOS 均已冒烟通过）
```

- `script/dev.ts` 把 `bun run --cwd packages/opencode ... serve --port 0` 注入为 `KILO_DESKTOP_BACKEND_CMD`，桌面壳只负责拉起与守护。
- 端口随机、Basic Auth（`kilo:<随机密码>`），凭据经 `server_info` 命令传给 webview。
- 崩溃后 1s 自动重拉；重拉会换端口/密码，前端常驻监听 `backend://ready` 重建连接（见 `src/client.ts`）。
- Vite 单独调试 UI：`bun run dev:vite`（连不上后端时界面为空，仅用于纯样式）。

## 打包

```bash
bun run package      # = script/sidecar.ts 准备 kilo 二进制/resources -> tauri build
bun run sidecar      # 仅构建/复制 sidecar（含 tree-sitter/ffmpeg/sandbox 资源，复制后 chmod +x）
```

## 质量门禁

```bash
bun run typecheck    # tsc --noEmit
bun run build:vite
```

oxlint 需从仓库根运行（根 `.oxlintrc.json` 启用了 `typeAware`，不能作为嵌套配置加载）：

```bash
# 仓库根目录
bunx oxlint packages/desktop/src
```

## 目录

```
src/                SolidJS 前端
  client.ts         后端连接、SSE 重连、目录/recents 状态
  store.ts          全局信号、事件 reducer、会话/消息/助理/审批动作
  views/            Chat / Plugins / Providers / Files / Settings
src-tauri/          Rust 壳：spawn/守护 kilo serve、pick_dir、open_url、
                    write_skill、write_agent、restart_backend（附加 CLI 参数与环境变量）
script/             dev.ts（注入仓库 CLI）、sidecar.ts（打包资源）
```

## 已知坑

- webview 中 `createResource` 模块加载即执行，必须挂 `ready()` source。
- 主线程 Tauri 命令里禁用 blocking dialog。
- `v2.fs.read` 返回 Blob；`v2.skill.list`/`v2.agent.list` 返回 `{location, data}` 双层。
- 详见 REQUIREMENTS.md §10。
