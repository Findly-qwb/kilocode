# kilo-desktop 功能需求清单

架构：Tauri v2 壳 + SolidJS 前端 + `kilo serve` sidecar（HTTP+SSE，Basic Auth）。后端零改动，所有能力复用 `packages/opencode` 现有 API。

状态标记：✅ 已完成 · 🔨 进行中 · ⬜ 待做

## 1. 连接与进程层（Rust）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 1.1 | spawn/守护 `kilo serve`（随机密码 + 端口解析 + 崩溃 1s 重拉） | ✅ | `src-tauri/src/lib.rs` |
| 1.2 | dev 注入仓库 CLI（`KILO_DESKTOP_BACKEND_CMD`） | ✅ | `script/dev.ts` |
| 1.3 | release 走 externalBin sidecar（含 tree-sitter/ffmpeg/sandbox 资源） | ✅ | `script/sidecar.ts`，二进制已实测可服务 |
| 1.4 | 文件夹选择（非阻塞）、外链打开、写 skill/agent 文件命令 | ✅ | `pick_dir`/`open_url`/`write_skill`；`write_agent` ⬜ |
| 1.5 | 多窗口 / 托盘 / 深链（`kilo://` OAuth 回调） | ⬜ | OAuth localhost 回调当前靠轮询兜底 |

## 2. 侧边栏（对照原型图 1）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 2.1 | Logo（EVE）+ 新对话 + 搜索会话（本地过滤） | ✅ | |
| 2.2 | 插件 / 素材库 / 服务商 入口 | ✅ | |
| 2.3 | 「项目」可折叠分组：新建项目 + 最近项目列表 + 点击切换 | 🔨 | recents 已存 localStorage（`client.ts`），UI 未接 |
| 2.4 | 「助理」可折叠分组：助理列表 + 选中 + 编辑/新建入口 | 🔨 | store 的 agents/agent 信号已加，UI 与写入未做 |
| 2.5 | 会话列表（标题、删除、当前高亮、按时间分组） | ✅ | 时间分组 ⬜ |
| 2.6 | 底部「设置」入口 | ⬜ | 设置页见 §7 |

## 3. 首页 / 对话（核心链路）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 3.1 | 问候空态 + 输入框 + 两张引导卡片 | ✅ | 卡片为入口引导，未做「个人助理」独立体系 |
| 3.2 | 会话 CRUD（创建/打开/删除/历史加载） | ✅ | |
| 3.3 | SSE 流式渲染（text delta / reasoning 折叠 / tool 状态卡） | ✅ | `store.ts` 事件 reducer |
| 3.4 | Markdown 渲染（marked + DOMPurify） | ✅ | 代码高亮 ⬜（可引 shiki，注意体积） |
| 3.5 | 权限审批弹窗（once/always/reject）+ 自动批准开关 | ✅ | |
| 3.6 | question 追问卡片（选项应答） | ✅ | 自由文本输入 ⬜ |
| 3.7 | 停止（abort）、错误条、cost 展示 | ✅ | |
| 3.8 | 模型选择器（已连接 provider × models + 默认模型推断） | ✅ | variant/context 维度 ⬜ |
| 3.9 | 审批模式下拉（请求批准/自动批准，对齐原型） | ⬜ | 现为 checkbox |
| 3.10 | 助理（agent）选择并随 prompt 下发 | 🔨 | `prompt({agent})` 参数已支持，UI 未接 |
| 3.11 | 会话重命名、fork、share、revert、todo 面板、diff 查看 | ⬜ | 后端 API 均有 |
| 3.12 | 文件/图片附件上传（prompt FilePart） | ⬜ | |
| 3.13 | 消息重试/编辑重发 | ⬜ | |

## 4. 插件中心（对照原型图 2）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 4.1 | 技能 / MCP / 命令行工具 三 tab + 搜索 + 卡片 | ✅ | ready 时序 bug 已修 |
| 4.2 | 新建技能（写 `.kilo/skills/<name>.md`） | ✅ | |
| 4.3 | 技能市场按钮（外链） | ⬜ | |
| 4.4 | MCP 添加/连接/断开/鉴权（`/mcp` add/connect/auth） | ⬜ | 现在只读展示 |
| 4.5 | 技能启停、来源分组（市场安装/插件提供） | ⬜ | |

## 5. 素材库

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 5.1 | 目录浏览（`v2.fs.list`）+ 面包屑 + 文本预览（`v2.fs.read` Blob） | ✅ | |
| 5.2 | 图片缩略预览、文件图标区分类型 | ⬜ | |
| 5.3 | 会话产物聚合视图（按 session diff 收集文件） | ⬜ | 可用 `GET /session/:id/diff` |

## 6. 服务商（对照原型图 3）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 6.1 | 分组列表（授权登录/官方 API）+ 连接状态 | ✅ | 数据源 store.providers（ready 修复后正常） |
| 6.2 | API Key 保存（`PUT /auth/{providerID}`） | ✅ | auth body 形状按 `{type:"api",key}`，需真机验证各家 |
| 6.3 | OAuth 浏览器授权 + 轮询 connected | ✅ | 深链回调 ⬜（1.5） |
| 6.4 | 「Claude Code 兼容套餐」分组（GLM/Kimi/MiniMax 等） | ⬜ | 按 provider metadata 归类即可 |
| 6.5 | 删除凭证（`DELETE /auth/{id}`）、env 变量提示 | ⬜ | |
| 6.6 | 空态引导（原型「配置 API 服务商以开始对话 → 打开设置」） | ⬜ | |

## 7. 设置页 ⬜（整页待做）

- 7.1 默认模型 / 默认助理
- 7.2 自动批准、主题（浅/深/跟随系统）
- 7.3 最近项目管理（移除条目）
- 7.4 后端信息（版本、端口、重启后端）
- 7.5 自定义 `kilo serve` 启动参数（代理/TLS 等环境变量透传）

## 8. 打包分发（M4 尾部）

| # | 功能 | 状态 | 说明 |
|---|---|---|---|
| 8.1 | `tauri build --no-bundle` release 编译 | ✅ | 已验证 |
| 8.2 | 完整 bundle（.app/.dmg）+ 图标 | 🔨 | 图标已生成；bundle 未跑通全流程 |
| 8.3 | 代码签名 + 公证 | ⬜ | 需 Apple Developer 账号 |
| 8.4 | 自动更新（updater endpoint） | ⬜ | 需发布物托管 |
| 8.5 | 双架构 universal 二进制 | ⬜ | CLI 需分别构建 arm64+x64 |
| 8.6 | Windows/Linux target | ⬜ | sidecar 脚本 triple 映射已留 |

## 9. 工程门禁

- ✅ desktop：`tsc` / oxlint 0 警告 / `vite build`；根 oxlint 0 errors；`cargo` 全绿
- ✅ changeset（`desktop-alpha.md`）
- ⬜ CI：desktop 包暂不在任何 workflow 中；接入 `bun turbo typecheck` 已覆盖，需加 lint/build job
- ⬜ README（安装/开发说明）

## 10. 已知坑（勿重复踩）

1. webview 里 `createResource` 模块加载即执行——必须挂 `ready()` source（已修，新页面沿用）。
2. 主线程命令里禁用 blocking dialog（曾卡死整窗）。
3. SSE 用 fetch+headers（非 EventSource），Basic Auth 走 `Authorization` 头即可。
4. `fs.read` 返回 Blob；`skill.list` 返回 `{location, data}` 双层。
5. sidecar 复制后必须 `chmod +x`。
