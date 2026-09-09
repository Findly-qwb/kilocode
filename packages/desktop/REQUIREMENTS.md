# kilo-desktop 功能需求清单

架构：Tauri v2 壳 + SolidJS 前端 + `kilo serve` sidecar（HTTP+SSE，Basic Auth）。后端零改动，所有能力复用 `packages/opencode` 现有 API。

状态标记：✅ 已完成 · 🔨 进行中 · ⬜ 待做

> 2026-09-09 Windows 真机冒烟（dev 模式）通过：会话收发/流式、模型+variant+助理选择、审批、素材库（列表/缩略图/预览）、侧栏分组、设置页均实际可用。

## 1. 连接与进程层（Rust）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 1.1 | spawn/守护 `kilo serve`（随机密码 + 端口解析 + 崩溃 1s 重拉） | ✅ | `src-tauri/src/lib.rs` |
| 1.2 | dev 注入仓库 CLI（`KILO_DESKTOP_BACKEND_CMD`） | ✅ | `script/dev.ts` |
| 1.3 | release 走 externalBin sidecar（含 tree-sitter/ffmpeg/sandbox 资源） | ✅ | `script/sidecar.ts`，二进制已实测可服务 |
| 1.4 | 文件夹选择（非阻塞）、外链打开、写 skill/agent 文件命令 | ✅ | `pick_dir`/`open_url`/`write_skill`/`write_agent`/`remove_mcp`；另有 `restart_backend`（附加参数/环境变量重启） |
| 1.5 | 多窗口 / 托盘 / 深链（`kilo://` OAuth 回调） | ⬜ | OAuth localhost 回调当前靠轮询兜底 |

## 2. 侧边栏（对照原型图 1）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 2.1 | Logo（EVE）+ 新对话 + 搜索会话（本地过滤） | ✅ | |
| 2.2 | 插件 / 素材库 / 服务商 入口 | ✅ | |
| 2.3 | 「项目」可折叠分组：新建项目 + 最近项目列表 + 点击切换 | ✅ | recents localStorage + `use()` 切换即刷新/新建会话 |
| 2.4 | 「助理」可折叠分组：助理列表 + 选中 + 编辑/新建入口 | ✅ | `v2.agent.list`；新建/编辑写 `.kilo/agent/<id>.md`（编辑回读前端解析 frontmatter） |
| 2.5 | 会话列表（标题、删除、当前高亮、按时间分组） | ✅ | 今天/昨天/本周/更早 分组 + 相对时间 |
| 2.6 | 底部「设置」入口 | ✅ | → §7 设置页 |

## 3. 首页 / 对话（核心链路）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 3.1 | 问候空态 + 输入框 + 两张引导卡片 | ✅ | |
| 3.2 | 会话 CRUD（创建/打开/删除/历史加载） | ✅ | |
| 3.3 | SSE 流式渲染（text delta / reasoning 折叠 / tool 状态卡） | ✅ | `store.ts` 事件 reducer |
| 3.4 | Markdown 渲染（marked + DOMPurify + 内置轻量代码高亮） | ✅ | `util.ts` tokenizer（c-like/hash 两族规则），不引 shiki 控体积；自定义语言降级为纯文本 |
| 3.5 | 权限审批弹窗（once/always/reject）+ 自动批准开关 | ✅ | |
| 3.6 | question 追问卡片（选项应答 + 多选 + 自由文本 + 拒答） | ✅ | `question.reply/reject` |
| 3.7 | 停止（abort）、错误条、cost 展示 | ✅ | 含 assistant error part 展示 |
| 3.8 | 模型选择器（已连接 provider × models + 默认模型推断） | ✅ | variant 维度 ✅（模型带多档时出二级下拉，随 prompt 下发）；列表项含 context 标注 |
| 3.9 | 审批模式下拉（请求批准/自动批准，对齐原型） | ✅ | 输入框工具条下拉，选择持久化 |
| 3.10 | 助理（agent）选择并随 prompt 下发 | ✅ | 工具条下拉 + 侧栏选中双入口，`prompt({agent})` |
| 3.11 | 会话重命名、fork、share（复制链接）、revert/unrevert、todo 面板、diff 查看 | ✅ | 顶栏工具条 + diff 弹层（patch 展开） |
| 3.12 | 文件/图片附件上传（prompt FilePart，data URL） | ✅ | 📎 选择器 + 粘贴；6MB 上限；用户气泡展示附件 chip |
| 3.13 | 消息重试/编辑重发 | ✅ | 用户气泡 hover ↻/✎：`session.revert` 后重发/回填草稿；顶栏 ↩ 恢复 |

## 4. 插件中心（对照原型图 2）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 4.1 | 技能 / MCP / 命令行工具 三 tab + 搜索 + 卡片 | ✅ | ready 时序 bug 已修 |
| 4.2 | 新建技能（写 `.kilo/skills/<name>.md`） | ✅ | |
| 4.3 | 技能市场按钮（外链） | ✅ | → github.com/Kilo-Org/kilo-marketplace |
| 4.4 | MCP 添加/连接/断开/删除（`/mcp` add/connect/disconnect） | ✅ | 本地 command/远程 URL 两种 config；needs_auth 走 connect 流程提示；删除经 `remove_mcp` 改写项目 `.kilo/config.json`（全局配置条目不在范围） |
| 4.5 | 技能启停、来源分组（市场安装/插件提供） | ⬜ | 后端无启停 API，需写 config 覆写 |

## 5. 素材库

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 5.1 | 目录浏览（`v2.fs.list`）+ 面包屑 + 文本预览（`v2.fs.read` Blob） | ✅ | |
| 5.2 | 图片预览（objectURL）、文件图标按类型区分、缩略图网格模式 | ✅ | ▦ 切换缩略网格（懒加载，单目录限 120 项），偏好存 localStorage |
| 5.3 | 会话产物聚合视图（按 session diff 收集文件） | ✅ | 素材库「本会话产物」开关，点击可预览/绝对路径解析 |

## 6. 服务商（对照原型图 3）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 6.1 | 分组列表（授权登录/官方 API）+ 连接状态 | ✅ | |
| 6.2 | API Key 保存（`PUT /auth/{providerID}`） | ✅ | auth body 形状按 `{type:"api",key}`，需真机验证各家 |
| 6.3 | OAuth 浏览器授权 + 轮询 connected | ✅ | 深链回调 ⬜（1.5） |
| 6.4 | 「Claude Code 兼容套餐」分组（GLM/Kimi/MiniMax 等） | ✅ | provider id 以 `-coding-plan` 结尾归类 |
| 6.5 | 删除凭证（`DELETE /auth/{id}`）、env 变量提示 | ✅ | 已连接卡片 hover × |
| 6.6 | 空态引导（原型「配置 API 服务商以开始对话 → 打开设置」） | ✅ | 首页横幅 + 顶栏「未连接服务商」警示 |

## 7. 设置页

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 7.1 | 默认模型 / 默认助理 | ✅ | localStorage 持久化，随 prompt 下发 |
| 7.2 | 自动批准、主题（浅/深/跟随系统） | ✅ | `html[data-theme=dark]` CSS 变量方案；system 跟随 matchMedia |
| 7.3 | 最近项目管理（切换/移除条目） | ✅ | |
| 7.4 | 后端信息（版本、端口/地址、重启后端） | ✅ | `restart_backend` kill + 守护循环重拉；前端重监听 `backend://ready` 换端口/密码 |
| 7.5 | 自定义 `kilo serve` 启动参数（代理/TLS 等环境变量透传） | ✅ | 附加参数 + `KEY=VALUE` 环境变量行，重启生效；启动时默认无追加 |

## 8. 打包分发（M4 尾部）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 8.1 | `tauri build --no-bundle` release 编译 | ✅ | 已验证 |
| 8.2 | 完整 bundle（.app/.dmg）+ 图标 | 🔨 | 图标已生成；bundle 未跑通全流程（本轮 Rust 改动已在 Windows `cargo check`/`cargo build` 全绿复验） |
| 8.3 | 代码签名 + 公证 | ⬜ | 需 Apple Developer 账号 |
| 8.4 | 自动更新（updater endpoint） | ⬜ | 需发布物托管 |
| 8.5 | 双架构 universal 二进制 | ⬜ | CLI 需分别构建 arm64+x64 |
| 8.6 | Windows/Linux target | 🔨 | sidecar 脚本 triple 映射已留；Windows dev 模式真机验证（完整对话链路可用）；bundle（MSI）未跑 |

## 9. 工程门禁

- ✅ desktop：`tsc` / oxlint 0 警告（typeAware root config） / `vite build`；根 oxlint 0 errors；`cargo check` / `cargo build`（Windows MSVC 工具链）全绿
- ✅ changeset（`desktop-alpha.md`）
- ⬜ CI：desktop 包暂不在任何 workflow 中；接入 `bun turbo typecheck` 已覆盖，需加 lint/build job
- ✅ README（安装/开发说明，`packages/desktop/README.md`）

## 10. 已知坑（勿重复踩）

1. webview 里 `createResource` 模块加载即执行——必须挂 `ready()` source（已修，新页面沿用）。
2. 主线程命令里禁用 blocking dialog（曾卡死整窗）。
3. SSE 用 fetch+headers（非 EventSource），Basic Auth 走 `Authorization` 头即可。
4. `fs.read` 返回 Blob；`skill.list` 返回 `{location, data}` 双层；`v2.agent.list` 同样双层（`data.data`，条目为 `AgentV2Info`，用 `id` 而非 `name`）。
5. sidecar 复制后必须 `chmod +x`。
6. 后端重启（`restart_backend`）会换新端口与密码，`backend://ready` 事件驱动前端重建 client/SSE（`client.ts` connect 内常驻监听）。
7. `session.messages` 不剔除 reverted 消息，前端按 `session.revert.messageID` 过滤显示（`store.thread()`）。
8. 事件 payload 的错误对象 `data.message` 是 union，直接取属性会得到 `{}` 类型，需 typeof 守卫。
9. Windows PATH 里的 `bun` 通常只有 npm shim（bun.ps1/bun.cmd）没有 bun.exe：Rust `Command::new("bun")` 与 `Bun.spawn(["bun"])` 均 ENOENT；`dev.ts` 已改用 `process.execPath` 绝对路径注入 `KILO_DESKTOP_BACKEND_CMD`（含空格路径需打包 sidecar，见 dev.ts ponytail 注）。
10. Rust `match Some(x) if x.remove(..)` 会在 guard 里不可变借用（E0596）——改写逻辑放 arm 体内。
11. `send()` 新建会话后必须先初始化 `messages[id]` 空数组：否则 prompt 前到达的 message 事件被 reducer 丢弃（`mutate` 查不到列表直接 return），流区永远空白卡在「正在工作」。
12. Windows 下 tauri dev 的 vite 子进程可能静默退出（code 255）——此后页面 reload/HMR 全部失败，修复看似「不生效」；症状是界面停留在旧代码，处理是重启 `bun run dev` 并看日志。
13. `button` 在 flex column 里不靠 stretch 撑满（webview UA 样式下会缩成内容宽）——列表项显式 `display:block; width:100%`。
14. WebView2 默认字体栈缺 emoji 时 📁/📦 渲染成单色豆腐块：font-family 需含 `Segoe UI Emoji`。
