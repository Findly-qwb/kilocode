# Kilo Desktop 设计方案（Solid + Tauri + opencode 二进制后端）

> 原型：`design/kilo-desktop/prototype.html`（三栏 CodePilot 式布局，左右栏可独立折叠，居中大号 PromptInput）
> 本文档给出架构决策、复用策略、全部功能点清单（M0–M6）与风险。

---

## 1. 总体架构

```
┌────────────────────────── Tauri App (Rust Shell) ──────────────────────────┐
│  窗口管理 · 系统托盘 · 全局快捷键 · 通知 · 自动更新 · 单实例 · 文件对话框      │
│  ┌──────────────── Solid 前端（WebView）────────────────┐                  │
│  │  复用 packages/kilo-vscode/webview-ui（已是 SolidJS） │                  │
│  │  复用 packages/kilo-ui（消息渲染/对话框/选择器组件）   │                  │
│  │  HostBridge：替换 context/vscode.tsx 的传输层         │                  │
│  └───────────────┬──────────────────────┬──────────────┘                  │
│             SSE/HTTP（@kilocode/sdk）  invoke()（少量宿主命令）              │
│  ┌───────────────▼──────────┐  ┌────────▼─────────┐                       │
│  │ sidecar: kilo serve      │  │ tauri-plugin-sql │                       │
│  │ packages/opencode 二进制  │  │ （桌面态 SQLite） │                       │
│  │ HTTP + SSE · loopback    │  └──────────────────┘                       │
│  │ + basic auth · :0 随机端口│                                             │
│  └───────────────┬──────────┘                                              │
│         会话/消息/权限/配置 持久化（opencode 自身 storage）                    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 核心决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 后端 | 复用 `packages/opencode` 构建的 `kilo` 单二进制，以 Tauri sidecar 方式 spawn `kilo serve --port 0` | 与 VS Code 扩展同一接入模式（`server-manager.ts:121` 已验证）；HTTP+SSE + basic auth（`kilo` / `KILO_SERVER_PASSWORD`，`server/auth.ts`）现成可用；不重复造 agent 运行时 |
| 前端 | 直接移植 `packages/kilo-vscode/webview-ui`（SolidJS）+ `packages/kilo-ui` | webview-ui 本来就是 Solid；全部聊天/工具卡/设置/审批 UI 已实现，移植成本远低于重写 |
| 传输层 | 新建 `desktop-host` 适配包，实现与 `VSCodeContext` 相同的 `postMessage/onMessage` 协议 | 唯一接缝在 `context/vscode.tsx`（一个 `VSCodeContextValue` 接口）；其余组件对宿主无感知 |
| 会话持久化 | 会话/消息/权限/配置由 opencode 后端 storage 负责；桌面层 SQLite（tauri-plugin-sql）只存 UI 态 | 避免双写不一致；后端已有会话 API（分页/fork/revert/export） |
| 窗口 | Tauri 2.x + `WebviewWindow`；右栏「浏览器」模块用子 webview 叠加 | Tauri 2 sidecar/updater/tray/global-shortcut 均为一等插件 |

### 消息桥设计（关键复用点）

webview-ui 现有协议是 `WebviewMessage`（~180 个请求）/ `ExtensionMessage`（~180 个推送）。desktop-host 适配分三类：

1. **直连 SDK 类**（多数）：`session.*`、`permission.*`、`question.*`、`providers`、`config`、`mcp` 等 → 适配器直接调 `@kilocode/sdk`，SSE 事件流回灌为 `ExtensionMessage`（partUpdated、sessionStatus 等）。
2. **宿主命令类**：文件对话框、图片预览、打开外部链接、diff 查看器、终端、通知、剪贴板 → `invoke()` 走 Rust 侧实现。
3. **扩展专属类**（Agent Manager worktree、编辑器 tab、VS Code 设置读写）→ 桌面端提供等价物或首版隐藏（feature flag）。

这样 webview-ui 的 `session.tsx`、`provider.tsx`、`config.tsx` 等 context 层**零改动**复用。

---

## 2. Tauri Shell（Rust）职责

| 能力 | 插件/机制 | 说明 |
|---|---|---|
| sidecar 生命周期 | `tauri-plugin-shell` | 启动 spawn、健康探测（GET `/global/health`）、崩溃指数退避重启、退出时杀进程组（防 PTY 泄漏，同扩展侧教训） |
| SQLite | `tauri-plugin-sql` | 表：`ui_state`（窗口几何/折叠态/右栏模块）、`drafts`、`recent_projects`、`attachments_cache`、`update_log` |
| 窗口 | core | 无边框/透明标题栏自绘（对应原型 titlebar）、多窗口、记住每项目窗口布局 |
| 托盘 + 全局快捷键 | `tray-icon`、`global-shortcut` | 后台运行、⌘N 新会话、⌘, 设置 |
| 单实例 | `single-instance` | 二次启动聚焦已有窗口并透传 deep link |
| 通知/声音 | `notification` | 回合完成/需审批提醒（对应设置页 Notifications） |
| 对话框/fs scope | `dialog`、`fs` | 附件选择、导入导出设置、受限文件访问 |
| 自动更新 | `updater` | 签名校验；后端二进制与前端同包版本锁定 |
| 深链 | `deep-link` | `kilo://session/<id>` 打开云端导入 |
| 登录 keychain | `stronghold`/OS keychain | 供应商 API key 加密存储（替代扩展的 settings 存储） |

---

## 3. 功能点清单（对照原型逐屏）

优先级：P0=首版必须 / P1=首版应有 / P2=后续。
来源：① 原型屏 ② 用户原始需求 ③ webview-ui 既有功能。

### M0 骨架（P0）
| # | 功能点 | 验收 |
|---|---|---|
| 0.1 | Tauri 工程 + Vite + Solid，复用 webview-ui 构建链 | 窗口打开原型同款三栏 |
| 0.2 | kilo 二进制作为 sidecar 打包（macOS universal / win x64 / linux x64） | `kilo serve` 随应用启停 |
| 0.3 | desktop-host 桥：直连 SDK + SSE 事件回灌 | 能收 `partUpdated` 流 |
| 0.4 | 自绘 titlebar：红绿灯、项目/分支名、◧/◨ 折叠按钮 | 左右栏独立折叠，中栏恒为输入区 |
| 0.5 | 主题（浅/深跟随系统）、i18n（zh/en…）、字号滑杆 | — |
| 0.6 | 崩溃恢复：sidecar 重启后重连并恢复会话视图 | kill -9 后端自动复活 |

### M1 对话核心（P0）
| # | 功能点 | 来源 |
|---|---|---|
| 1.1 | 实时流式渲染（文本增量、光标动画、自动跟随滚动、上滚暂停+回底按钮） | ①② |
| 1.2 | Markdown 渲染 + 代码块语法高亮（延迟 shiki）、文件路径链接可点击 | ①② |
| 1.3 | 思考/reasoning 折叠块（完成自动折叠、Shift+Tab 循环变体） | ① |
| 1.4 | 工具卡全家：read/list/glob/grep/bash（输出流+open in editor）/edit/write/apply_patch（内嵌 diff+±统计+在 Diff 面板打开）/websearch/webfetch/todowrite 清单/question/skill/task 子代理（可展开子工具流、后台化）/MCP 泛用卡 | ① |
| 1.5 | 回合结果条 TurnOutcome（interrupted/error/limit + steps/费用/tokens） | ① |
| 1.6 | 模式切换 Code/Plan/Ask（ModeSwitcher，含描述与 deprecated 徽章） | ①② |
| 1.7 | 模型选择器大弹层：搜索、收藏/Auto/推荐/最常用/按供应商分组、★收藏、右侧 ModelPreview（价格四行、上下文、Terminal Bench、能力徽章） | ①② |
| 1.8 | 推理变体选择器（ThinkingSelector，模型无 variants 时隐藏） | ① |
| 1.9 | 斜杠命令补全（内置 /new /sessions /models /agents /variant /compact /export /goal /help /settings + 自定义命令，Actions/Commands 分组） | ①② |
| 1.10 | @ 提及：文件/目录（模糊搜索）、@terminal、@git-changes、@past-chats、@worktrees、工作区外文件选择 | ①② |
| 1.11 | 附件：图片粘贴/拖拽/选择 → 缩略图条 → 视觉模型识别；非图片转 @mention | ①② |
| 1.12 | 发送/停止/排队（busy 发送=队列，Queued 行可编辑/删除）、Esc 中断、编辑重发 Continue | ① |
| 1.13 | 提示词增强（🪄，Ctrl+Z 回滚）、历史提示词 ↑↓ | ① |
| 1.14 | 转录内搜索（Aa/全词/正则、n/m 计数、高亮定位）、PromptRail 刻度导航 | ① |
| 1.15 | 用户消息 hover：复制/Fork 消息/Revert 到此（checkpoint 回滚）+ RevertBanner（Redo/Redo All/文件统计） | ① |
| 1.16 | 上下文压缩：/compact、压缩分割线、自动压缩阈值 | ①② |
| 1.17 | 错误卡：未授权✨升级、限流🕙、provider 未连接（Sign in 按钮）、API 重试倒计时+取消 | ① |
| 1.18 | 反馈 👍👎、吞吐徽章 tok/s | ① |

### M2 会话与持久化（P0）
| # | 功能点 | 来源 |
|---|---|---|
| 2.1 | 会话由后端 storage 持久化（SQLite 语义：WAL、重启不丢）；桌面层 SQLite 存 UI 态/草稿/最近项目 | ② |
| 2.2 | 左栏：项目分组（多项目切换）、会话列表按今天/昨天/本周/更早分组、相对时间、活动状态点（运行/需输入/错误/空闲） | ①② |
| 2.3 | 会话操作：行内重命名、导出 Markdown、删除（确认+软删）、hover 快捷按钮 | ① |
| 2.4 | 历史视图：本地/云端/Worktree 三 tab、搜索、仅当前仓库过滤、分页加载 | ① |
| 2.5 | 云端会话导入（ses_/UUID 提取、legacy 报错）、会话同步开关 | ① |
| 2.6 | Fork 会话、新会话（草稿按会话隔离保存） | ① |
| 2.7 | 多窗口（每项目一窗），窗口几何/折叠态/右栏模块记忆 | 桌面新增 |
| 2.8 | 检查点开关与恢复（依赖后端 snapshot 能力） | ① |

### M3 权限与安全（P0）
| # | 功能点 | 来源 |
|---|---|---|
| 3.1 | 审批 Dock：命令块（shell 高亮+复制）、路径列表、diff 预览、允许一次/拒绝、Enter/Esc、punycode 防同形 | ①② |
| 3.2 | 审批卡内联「管理自动批准」规则三态（✓/✕/pending） | ① |
| 3.3 | 🛡️ 快捷弹层：各工具 allow/ask/deny 摘要 + 例外 + 花费上限 + 跳转全量设置 | ①② |
| 3.4 | 自动批准设置页：external_directory/bash/read/edit 通配+例外列表，glob/grep/list/task/skill/lsp/todo/web/doom_loop 下拉 | ①② |
| 3.5 | 每 Agent 独立权限（PermissionEditor 复用）+ effective 规则只读表 + 导出 JSON | ① |
| 3.6 | 会话最大花费上限与超限询问（SessionCostAlert） | ①② |
| 3.7 | 沙箱：启用/网络阻断/allowed_hosts/writable_paths（输入框无按钮，设置页控制） | ① |
| 3.8 | API key 进系统 keychain；日志脱敏；后端仅 loopback + basic auth | 桌面新增 |

### M4 供应商与模型（P0）
| # | 功能点 | 来源 |
|---|---|---|
| 4.1 | Kilo Gateway 登录：设备授权卡（URL+复制+打开浏览器、QR、大字验证码、倒计时、取消、错误详情） | ① |
| 4.2 | 供应商连接弹窗：auth method 列表、API key（`{env:VAR}` 语法、本地 provider 可空）、Bedrock 多字段、Vertex JSON 粘贴、Azure endpointType 下拉、OAuth 自动/手动 code | ①② |
| 4.3 | 已连接列表（来源徽章 config/env/api/oauth/local、断开、ChatGPT OAuth、编辑自定义） | ① |
| 4.4 | 自定义供应商：ID/名称/SDK 包三选一/baseURL/apiKey + 模型卡（id/name/reasoning/image 复选，变体字段保留）+ 自动拉取 /models（防抖、勾选、全选、去重合并）+ headers 行编辑 + 高级直编配置 | ①② |
| 4.5 | 供应商全目录弹窗（搜索、Recommended/Other、置顶 Add Custom）；禁用供应商名单 | ① |
| 4.6 | 模型选择器分组与收藏持久化、按会话记忆模型选择、最近使用统计 | ① |
| 4.7 | 角色模型：默认/小模型/子代理模型+变体/自动补全模型/语音模型/压缩模型/按模式覆盖 | ①② |

### M5 扩展体系（P1）
| # | 功能点 | 来源 |
|---|---|---|
| 5.1 | MCP 列表：状态点（connected/failed/needs_auth/disabled）、协议徽章（stdio/sse/http）、启停开关、Sign in、编辑、删除确认、展开详情 | ①② |
| 5.2 | MCP 编辑弹窗：transport 三选、stdio command/args/env(kv)、remote url/headers | ①② |
| 5.3 | 市场：MCP/Agent/Skill 分类、状态/相关性过滤、卡片；安装弹窗（scope 项目/全局、方式选择、前置条件、参数表单、路径预览、成功/失败页）；卸载确认 | ①② |
| 5.4 | Agents：列表（built-in/sub/custom 徽章）、新建三步表单、编辑（prompt/模型/变体/temperature/top_p/steps/hidden/disabled/每代理权限）、导入导出 .agent.json、删除 | ①② |
| 5.5 | Skills：discovered 列表（location/作用域/builtin 保护）、Skill Paths/Skill URLs 添加删除 | ①② |
| 5.6 | Workflows/Commands：列表 + 每命令模型/变体覆盖 + 模板预览（编辑走文件） | ①② |
| 5.7 | Rules：指令文件列表（增删、打开编辑）、Claude Code 兼容开关 | ①② |
| 5.8 | 斜杠命令/技能变更后热重载（⟳ 重载按钮 → /reload） | ① |

### M6 右栏模块 + 系统能力（P1）
| # | 功能点 | 来源 |
|---|---|---|
| 6.1 | 文件模块：项目感知树（懒加载）、点击预览（语法高亮）、在系统编辑器打开 | ①② |
| 6.2 | Git 模块：分支/领先落后、变更列表（M/A/D 徽章 +±）、提交框（AI 生成 commit message）、提交/推送/放弃（审批链路） | ①② |
| 6.3 | 浏览器模块：URL 栏、子 webview 渲染、代理可驱动（截图/点击/DOM 元素引用回输入框 @mention） | ①② |
| 6.4 | Diff 模块：来源选择（会话/工作区/分支）、文件列表、内联/并排、还原文件、MD 渲染切换 | ①② |
| 6.5 | 用量模块：会话费用、上下文三段进度条、Token 细分表（in/cache/out/reasoning/费用/命中率）、吞吐；TaskHeader 常驻 $+% 徽章与展开时间线 | ①② |
| 6.6 | 设置全量（16 tab，原型已含）+ 底部通栏保存条（不压导航）+ 项目/全局配置打开 + 导出/导入 JSON + 重置 | ① |
| 6.7 | Profile：登录态/组织切换/余额/充值/Dashboard 外链/Kilo Pass 与供应商配额窗口进度条/设备授权 | ① |
| 6.8 | 索引模块：状态徽章、输入框按钮跳转设置；embedding provider/模型/向量库/扩展名/调优参数 | ①② |
| 6.9 | 通知：OS 通知+提示音选择+试听+测试；回合完成/需审批触发 | ① |
| 6.10 | 远程服务：远程控制开关+状态、会话分享 manual/auto/disabled、开机自启 | ① |
| 6.11 | 迁移向导：从 Roo Code 导入（数据扫描→选择→进度→汇总/强制重导/复制报告） | ① |
| 6.12 | 实验性：formatter/LSP/batch/图像生成+模型/共享看板/notebook/工具 kill-switch 列表/MCP 超时 | ①② |
| 6.13 | 关于：版本、CLI 服务器状态+端口、社区链接、数据存储路径（SQLite 位置） | ① |

### P2（明确延后）
- Agent Manager（多 worktree 编排、section、评审面板）——桌面版可作为独立窗口二期实现，协议已在 `types/messages/agent-manager.ts`。
- Ghost text 行内补全（依赖编辑器宿主语义，桌面首版仅保留聊天增强）。
- 语音输入 push-to-talk（原型已按需求移除，保留后端能力位）。
- 终端面板（右栏新模块，复用后端 PTY API）。
- 自动小模型路由可视化、团队/组织计费明细。

---

## 4. 工程结构建议

```
packages/desktop/                 # 桌面应用包（已建：src/assets/logo.png 为应用 logo）
  src-tauri/                      # Rust shell：sidecar 监管、sql、tray、updater
  src/                            # 从 webview-ui 移植的 Solid 应用（logo: src/assets/logo.png）
    host/                         # desktop-host：VSCodeContext 同协议适配器
    views/                        # chat / history / settings / profile
  icons/                          # 由 logo.png 生成 icns/ico/png 全套
  tauri.conf.json
```

- 复用方式：优先把 `webview-ui/src/components`、`context`、`utils` 提升为可共享包（或 workspace 引用 + 相对路径 alias），只替换 `context/vscode.tsx` 与新 `host/`；`types/messages` 原样复用作为桥协议。
- 构建：前端 `vite build`；`kilo` 二进制走既有 `script/build.ts --single` 产物，按平台注入 `bundle.externalBin`；CI 三平台矩阵打包 → updater 清单。

## 5. 里程碑顺序与依赖

1. **M0+M1**（可演示聊天）→ 依赖：desktop-host 桥、SDK 事件映射。
2. **M2+M3**（可日常使用）→ 依赖：审批/问题/队列协议直通，SQLite UI 态。
3. **M4**（可接任意模型）→ 与 M2 并行可做。
4. **M5+M6**（完整对齐原型）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| webview-ui 对 `acquireVsCodeApi` 的隐性依赖散布 | 移植首步全量 grep `vscode.` 引用，收敛到 host 适配层；CI 加 lint 禁直调 |
| 后端 API 演进导致桥协议漂移 | 桥协议类型从 `types/messages` 单一来源生成；SDK 版本与二进制版本锁定 |
| sidecar 泄漏（PTY/进程组） | 退出钩子 kill 进程组；healthcheck 失败重启上限；开发期 `--port 0` 随机端口防串台 |
| macOS 公证/Windows SmartScreen | 首发即接签名流水线（复用 kilo CI 证书体系） |
| Tauri webview 与 Solid 渲染差异（虚拟列表、Custom Highlight API） | M0 即在目标 webview 跑 MessageList 压测；不支持的 API 走降级 |
| 与 VS Code 扩展共享组件的维护成本 | 组件上收 `kilo-ui`/共享包，宿主差异全部留在各自 host 层 |
