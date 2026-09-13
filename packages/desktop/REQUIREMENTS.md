# Kilo Desktop — 需求与实现对照（REQUIREMENTS）

基准：`design/kilo-desktop/prototype.html`（高保真原型）+ `design/kilo-desktop/PLAN.md`（架构）。
本文档记录桌面端 `packages/desktop/` 的实现范围、数据链路与有意裁剪项。

## 架构（与 PLAN.md 一致）

- 后端：`packages/opencode` 构建的 `kilo serve` 作为 sidecar（dev 由 `script/dev.ts` 注入仓库 CLI；打包走 `externalBin`）。
- 持久化：会话/消息/权限/配置全部落在 CLI 引擎自带数据库 `kilo.db`（`Global.Path.data/kilo.db`，WAL）；桌面层不建第二套库，UI 态存 localStorage。
- 前端：SolidJS 直接复用 `@kilocode/sdk/v2` 客户端 + SSE（`/global/event`），组件按原型类名/布局 1:1 移植（`src/index.css` 即原型样式 + 深色主题变量化）。
- Tauri 2：无边框窗口（titlebar 红绿灯 = 关闭/最小化/最大化，drag region），Rust 侧负责 sidecar 监管、目录选择、git CLI、技能/助理/配置写盘。

## 屏幕 → 实现映射

| 原型 | 实现 | 数据链路 |
|---|---|---|
| Titlebar（面包屑/分支/服务点/折叠） | `App.tsx` | `/vcs` + `/global/health` + `/path` |
| 左栏：搜索、新对话、市场、项目分组、日期分组会话、助理列表、账户/设置 | `App.tsx` | `session.list`、`v2.agent.list`、recents(localStorage) |
| Hero 欢迎态（问候/示例 chips/大输入卡） | `Chat.tsx`（`.view.welcome`） | — |
| 任务头（费用/上下文%/活动条/压缩） | `Chat.tsx` | session.cost/tokens + 模型 limit.context |
| 消息流（user 气泡、md/代码高亮、思考折叠、工具卡、diff、To-dos、Patch、compaction、retry、回合结果条） | `Chat.tsx` `Message/PartView/ToolCard` | SSE message/part/delta 事件 |
| 审批 dock（允许一次/总是/拒绝 + 规则开关） | `Chat.tsx` `PermDock` | `permission.asked` → `permission.reply` |
| 问题 dock（多题翻页/多选/自定义答案） | `Chat.tsx` `QDock` | `question.asked` → `question.reply/reject` |
| 排队行（运行中发送自动入队、编辑/删除） | `Chat.tsx` + `store.queue` | idle 事件自动 flush |
| 输入区（slash 菜单、@ 文件搜索、模型弹层含预览/收藏、shield 弹层、模式/变体、附件、🪄 增强、停止、快捷键） | `Chat.tsx` | `command.list`、`v2.fs.find`、`provider.list`、`session.command`、`enhancePrompt.enhance` |
| PromptRail / 回到底部 | `Chat.tsx` | — |
| 转录内搜索（Aa/全词/n·m/↑↓ 跳转 + 字符级高亮） | `Chat.tsx` findbar | CSS Custom Highlight API（`::highlight`）非破坏式高亮 |
| RevertBanner（回退横幅 + Redo/文件变更） | `Chat.tsx` | `session.revert` → `session.unrevert` |
| task 子代理子会话展开（工具卡内联） | `Chat.tsx` `SubtaskView` | `session.children` → `session.messages` |
| 结构化错误卡（未授权/限流/长度上限/中断/未知） | `Chat.tsx` `ErrorCard` | AssistantMessage.error 判别式 |
| 桌面 OS 通知（回合完成/待批准/代理提问，仅窗口未聚焦时） | `host.ts notifyOS` ← `store.ts` 事件流 | `tauri-plugin-notification` + 权限请求 + 设置页开关/测试 |
| 右栏五模块（文件树+预览、Git、浏览器、Diff 三源、用量） | `right/modules.tsx` | `v2.fs.list/read`、`vcs.diff`+git CLI+`commitMessage.generate`、iframe、`session.diff`/`vcs.diff`/`git diff main...HEAD`、消息 tokens 聚合 |
| 历史页（本地/云端/Worktree 三 tab + 导入弹窗） | `History.tsx`、`Modals.tsx` | `session.list`、`kilo.cloudSessions`、`experimental/worktree`、`kilo.cloud.session.import` |
| 账户页（资料/余额/Kilo Pass/设备授权/后端信息） | `Profile.tsx` | `kilo.profile` |
| 设置 13 tab（模型/供应商/代理行为 5 子页/自动批准/浏览器/检查点/显示/上下文/提交/索引/实验/沙箱/语言/关于），行级对齐 prototype SETTINGS 定义 | `Settings.tsx` | `config.get/update`（真实写 kilo.json：model/small_model/subagent_model/subagent_variant/default_agent/username/hide_prompt_training_models/disabled_providers/agent/permission/watcher.ignore/compaction.{auto,threshold_percent,prune}/web_search/commit_message.prompt/tools/experimental.{batch_tool,image_generation,image_generation_model,shared_agent_board,native_notebook_tools,continue_loop_on_deny,task_model_selection,disable_paste_summary,speech_to_text_model,mcp_timeout}/sandbox.{enabled,network,writable_paths,allowed_hosts}/indexing.{enabled,provider,model,dimension,vectorStore,fileExtensions,searchMinScore,searchMaxResults,embeddingBatchSize}+consent API/share/autoupdate/remote_control/privacy_mode/auto_collapse_reasoning/terminal_command_display/code_edit_display/mcp_tool_display）、`provider.list`+`auth.set/remove`+`provider.oauth.authorize`、`mcp.status/add/connect/disconnect`、`v2.skill.list`、`command.list`、`config.sources`、`indexing.status`、`sandbox.support`、Agents 全量（含子代理徽章）+导出/导入/删除（`remove_agent` host 命令） |
| 七类模态（连接供应商/自定义供应商/MCP/市场/安装/云导入/反馈）+ 助理编辑 | `Modals.tsx` | 同上 + `write_agent/write_skill/remove_mcp` host 命令；自定义供应商保存后 `instance.reload`+`provider.list` 自动发现模型 |

## 真实 vs 本地（诚实标注）

写入服务端（kilo.json / 引擎）：模型默认与小模型/子代理模型/变体/模式覆盖、供应商凭证（本地 auth store）、MCP、permission 规则、watcher.ignore、compaction、web_search、commit_message.prompt、tools kill-switch、experimental 全部开关、sandbox 段、indexing 段、share/autoupdate/remote_control/privacy_mode、显示项（terminal/code/mcp 展示、auto_collapse_reasoning）、自定义 provider、助理文件（.kilo/agent）。

仅桌面 UI 态（localStorage，前缀 `ui.`）：主题/字号/Shift+Tab 开关/Token 吞吐显示/显示自动批准原因/提交语言/检查点开关/索引文件扩展名/排队草稿/收藏模型/会话模型映射/右栏模块/最近项目。这些后端无对应 config 键，视觉行为完整但不假装写后端。

## 有意裁剪（P2，原型有但本版未接）

- 语音输入（原型已删）、Goal 后端语义（当前插入 `/goal` 文本走命令通道，未知命令由后端报错提示）、Roo 导入向导（按钮提示排期中）、Skill URLs 远程加载、云端会话分享列表实时同步、多项目并行会话（切项目即切目录，同后端单例模式）。
- 👍/👎 反馈：后端无 feedback 端点，本地持久化到 `localStorage.msgVotes`（按钮高亮保留）。
- @terminal 提及：数据源为「当前会话最近一次已完成的 bash 输出」（无需终端模块）；@worktrees 附加 `worktree.list` 路径列表。
- 提示音选择与预览（当前用系统默认提示音）、每代理权限编辑器、SessionCostAlert 花费上限、Diff 并排视图、浏览器代理 DOM 操作未接。
- 错误卡已结构化（未授权→Sign in/升级、限流→稍候自动重试、长度上限→继续、中断、未知）；重试等待读 `retry-after` 响应头（provider 未返回时不显示倒计时）。
- 浏览器模块为 iframe 预览；代理级浏览器自动化（截图/操作）未接。
- Worktree 创建走 `experimental/worktree`；历史 Worktree tab 仅列目录，未做跨 worktree 会话合并。

## 快捷键

Enter 发送 / ⇧Enter 换行 / Esc 停止或关弹层 / ⇧Tab 变体循环 / ↑ 顶格回填历史提示词 / ⌘Ctrl+K 历史↔聊天。

## 门禁

`bun run --cwd packages/desktop typecheck`、`bunx oxlint packages/desktop/src`（0 诊断）、`bun run --cwd packages/desktop build:vite`、`cargo check --manifest-path packages/desktop/src-tauri/Cargo.toml`、`bun run --cwd packages/desktop dev`（tauri dev 冒烟）。
