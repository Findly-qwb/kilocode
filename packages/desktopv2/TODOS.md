# Kilo Desktop v2 · 功能拆解清单（packages/desktopv2）

依据两份材料，二者都经过实测核对：

- 原型：`design/kilo-desktop/prototype-v2.html`，78 屏逐屏实跑验证，结论见 [prototype-verification.md](./prototype-verification.md)（77 通过 / 1 原型导航缺陷 / 0 脚本报错）。
- 技术方案：`design/kilo-desktop/PLAN.md`（v2 五项冻结决策：皮肤系统、嵌入开源 rpi、去账号、右栏本地能力、保留 Revert + git）。

清单同时是人读文档与机读数据：`todos.json` 是本文件的结构化副本，`bun run todos:check` 会校验每条任务是否带 screen / PLAN 章节 / 验收方式，并校验 `screen-inventory.json` 的 78 屏是否全部被覆盖。

状态取值：`todo` 未开始 · `wip` 进行中 · `done` 已实现并通过验收 · `blocked` 被外部条件卡住。

---

## 0. 工程落点

```
packages/desktopv2/
  TODOS.md / todos.json                 # 本清单 + 机读数据
  screen-inventory.json                 # 原型 78 屏快照（已验证）
  prototype-verification.md             # 原型验证报告
  scripts/check-todos.ts                # 清单完整性 + 屏目覆盖率校验
  src/                                  # React 18 + TS 前端
    skins/<id>/skin.json                # 皮肤 bundle（PLAN §4）
    skins/loader.ts                     # 加载 / extends / 完整度 / 对比度门禁
    ipc/protocol.ts                     # 20 事件 + 命令的 TS 类型（由 ts-rs 对齐）
    ipc/bridge.ts                       # Tauri 真桥 + 浏览器 mock 桥
    ipc/runtime.ts                      # ExternalStoreRuntime 适配（PLAN §5.3）
    shell/                              # 三栏骨架、标题栏、状态栏、命令面板、屏目索引
    views/                              # chat / history / settings / skills / mcp / onboard
    panels/                             # 右栏：tree / terminal / review / tasks / picker
    components/                         # 工具卡、审批卡、提问卡、diff、弹层
  src-tauri/                            # Rust 宿主（PLAN §15）
    src/ipc.rs store.rs perms.rs checkpoint.rs gitx.rs fsx.rs mcp.rs adapt.rs lib.rs main.rs
```

跑法：`bun run dev` 起浏览器版（mock 桥，全部屏目可视可点），`bun run tauri:dev` 起原生版。

---

## S0. Spike（PLAN §12，先于 MVP1）

rpi 事实已用 crates.io 真实源码核对完毕（结论见下节「rpi 事实核对」），S0-1 / S0-3 不再卡外部信息，只卡本机编译接线进度。

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| S0-1 | rpi 最小回合：流式对话 + 一次 bash + 一次审批往返 | chat-stream | §6.0 §6.2 | Rust | `cargo test spike_turn` 用 `FauxProvider` 跑通一轮，事件序列含 text_delta / tool_call_start / human_confirm_required / tool_call_result | wip |
| S0-2 | ExternalStoreRuntime 吃 Tauri 事件流 | chat-stream | §5.3 §12 | FE | 浏览器版用 mock 桥重放录制事件流，消息/part/interrupt 状态与 §9.1 一致，乱序 seq 触发 resync | done |
| S0-3 | 适配层：rpi AgentEvent → 桌面 20 事件协议 | chat-stream | §6.9 | Rust | `cargo test adapt` 逐 variant 映射快照，20 事件全部有来源，无未定义字段 | wip |
| S0-4 | 皮肤 bundle 规范落地（extends + 完整度 + 对比度门禁） | skin-manager | §4 | FE | 导入缺 L2 必需 token 的皮肤被拒；对比度不达标给警告 + 自动提亮；切换不重启即时生效 | done |

### rpi 事实核对（写代码前用真实 registry 源码确认，PLAN 有两处需要据此修正）

| 项 | 实测事实 | 对方案的影响 |
|---|---|---|
| 版本 | `rpi-agent` / `rpi-ai` / `rpi-tools` / `rpi-harness` 均 **0.3.24**，MIT，`forbid(unsafe_code)` | 钉 `=0.3.24`；API 迭代极快，升级只改 `adapt.rs` |
| feature | `rpi-ai` **默认无 features**，真实 HTTP provider 藏在 `providers` 后 | Cargo.toml 必须 `features = ["providers"]`，否则线上只有 faux |
| 事件 | `AgentEvent` 11 variant；文本/思考增量在 `MessageUpdate` 内层 `AssistantMessageEvent`（`TextDelta` / `ThinkingDelta` / `ToolCall*` / `Done` / `Error`） | 桌面 `text_delta` / `reasoning_delta` 要从内层事件取，不是顶层 |
| **权限插入点** | PLAN §6.5 说的 `ExecutionEnv` 其实是 FS/Shell 沙箱抽象（`trait ExecutionEnv: FileSystem + Shell`），**不是拦截缝**；真正插入点是 `before_tool_call` 钩子，`BeforeToolCallResult{block,reason,terminate,args}` 可拦截并改参，且 async 可 await oneshot | PLAN §6.5/§6.9 措辞应改为「before_tool_call 钩子」；改参执行（M3-5）正好由 `args` 字段承载 |
| 钩子可达性 | `Agent::build_config` 把 `before_tool_call` 硬编码 `None` | 必须走 `AgentHarnessOptions.before_tool_call` 或 `run_agent_loop` + 自配 `AgentLoopConfig`，不能直接用 `Agent` 默认构造 |
| 队列 | `PendingMessageQueue` + `Agent::steer()/follow_up()/abort()/wait_for_idle()`；harness `QueueKind{Steer,FollowUp,NextRun,Context}` | §6.1 三队列成立；桌面 `queue_state` 是投影，不是实现 |
| usage 字段 | `input/output/cache_read/cache_write/reasoning/total_tokens/cost` | `turn_end.tokens` 映射按此命名，别自造 |
| 离线测试 | `FauxProvider` 无 feature 门控始终可用 | 所有 runtime 单测走 faux，不发真实请求 |
| 依赖面 | `rpi-tools` 传递依赖 `rpi-plugin-sdk` | PLAN §13「不引入 rpi-plugin-sdk」在传递依赖层面做不到，只是不直接使用其 ABI |

一处与 PLAN 的实现偏差（已确认取舍，供 review）：样式不引入 Tailwind 原子类层，而是沿用原型那套 token 驱动 CSS（L1 结构令牌 / L2 皮肤 bundle / L3 组件层）。皮肤系统的本质就是 CSS 变量 bundle，原子类再叠一层不会带来用户可见收益，反而给 78 屏的还原增加漂移面。PLAN §2 的 Tailwind 选择据此调整。

聊天内核按 PLAN §2/§5.3 接 `@assistant-ui/react`（实测版本 0.15.26，传递依赖 core 0.3.25 + store 0.3.18）。Spike ② 的真实结论，对应 PLAN §14 的头号风险项：

能吃下我们的事件流。`useExternalStoreRuntime` 的 adapter 只要 `messages / convertMessage / isRunning / onNew / onCancel / onEdit / onReload / onDelete`，我们把自己 reducer 投影成 adapter（`src/ipc/assistant.ts`），composer 的发送与中断走 `runtime.thread.append()/cancelRun()`，不再自己造线程状态机。

原生字段正好对上桌面语义，不必再自造概念：待审批用 `status:{type:"requires-action", reason:"interrupt"}` 表达（§6.6 的审批阻塞）；`AppendMessage.steer` 直接映射 §6.1 的 steering 队列；分页历史用 `hasEarlier + onLoadEarlier` 接 `session_load`。

卡片视觉仍归我们。工具卡/审批卡/diff 卡是原型的视觉资产，套它的 primitive 反而受限；做法是渲染时通过 `getExternalStoreMessages(message)` 取回原始消息按 block 渲染，assistant-ui 负责线程与运行生命周期，我们负责 part 的呈现。审批/提问这类非 part 语义（outcome/compact/error/question）不下传，避免为迁就库而丢信息。

踩到的约束（写给后来人）：`MessageStatus` 的 `complete` 必须带 `reason:"stop"|"unknown"`；`tool-call` part 的 `args`/`argsText` 是必填；`AssistantRuntime.thread` 是属性不是方法（写成 `thread()` 会挂）。

---

## M0. 骨架 / 皮肤（P0）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M0-1 | Vite+React+TS+Tailwind 工程、tsconfig、构建脚本 | — | §15 | 工程 | `bun run build` 成功，`bun run typecheck` 零错误 | done |
| M0-2 | 三栏骨架：左 268 / 中 flex / 右 348，折叠态写 ui_state | chat-welcome chat-stream shell-nol shell-nor shell-focus | §5.1 | FE+Rust | 折叠后 computed grid 列宽为 0，恢复后回落；状态按项目持久化 | wip |
| M0-3 | 标题栏（模型/模式/上下文/费用徽章/主题/窗口控制）+ 状态栏 | chat-stream | §5.1 | FE | 徽章随事件更新，右栏折叠时状态栏保留能力入口 | done |
| M0-4 | 边缘把手折叠（含 ⌥[ / ⌥] 快捷键） | shell-nol shell-nor | §5.1 | FE | 键盘与把手两条路径都能折叠/恢复（修掉原型 shell-nol 只在已折叠时才折叠的导航缺陷） | done |
| M0-5 | 皮肤 bundle：三套内置 skin.json（graphite-dark / paper-light / nocturne-amber） | skin-graphite skin-paper skin-amber | §4 | FE | L1 结构令牌 + L2 语义令牌全量对齐原型实测值 | done |
| M0-6 | 皮肤加载器：`<html data-skin>` + CSS 变量注入 + 即时生效 | skin-graphite skin-paper skin-amber | §4 | FE | 切换后无需重建 WebView，L3 组件层只引用 L2/L3 | done |
| M0-7 | 继承与回落：`extends` 链 + 缺省 token 回落父皮肤 | skin-manager | §4 | FE | 子皮肤缺 token 时取父值；循环继承被检测并报错 | done |
| M0-8 | 完整度校验：缺 L2 必需 token 即拒绝加载 | skin-manager | §4 | FE | 构造缺 `--surface-base` 的皮肤，加载失败并提示缺失项 | done |
| M0-9 | 对比度门禁：正文 4.5:1 / 次要 3:1 / 弱化 2.2:1 + 自动提亮 | skin-manager set-display | §4 | FE | 与原型 `lum`/`ratio` 同算法；不达标阻止保存并给一键提亮 | done |
| M0-10 | danger/warn 语义色必须图标 + 文字，不单靠颜色 | skin-manager perm-dock | §4 | FE | 组件审查：状态徽标均含文字标签 | done |
| M0-11 | 皮肤管理弹窗：列表、应用、导入 skin.json、回落默认 | skin-manager | §4 §16 | FE+Rust | 导入 → 校验 → 应用全流程；一键回落 | wip |
| M0-12 | 字号滑杆（--fscale 实时生效）+ 密度 | set-display | M0 | FE | 滑杆改 13→18px 全站字号随之缩放并持久化 | done |
| M0-13 | 命令面板 ⌘K：会话 / 命令 / 面板 / 皮肤统一入口 | cmdk | M0 | FE | 四类条目可搜可执行，键盘导航完整 | done |
| M0-14 | 屏目索引 ⌘⇧S（开发态，按 M0–M6 分组、hash 直达） | — | §16 | FE | 78 屏全部 hash 可达，逐屏断言通过 | done |
| M0-15 | i18n zh/en + 语言资源 | — | M0 | FE | 切换语言覆盖全部可见文案，缺失键回退 zh | wip |
| M0-16 | 崩溃域隔离：Turn 任务 catch_unwind → agent_error{fatal} | panic runtime | §3.3 §6 | Rust+FE | panic 不崩窗，UI 出现「重试 / 回滚到检查点」 | wip |
| M0-17 | Runtime 诊断面板：Tokio 任务、子进程、checkpoint 仓库 | runtime | §3.3 | Rust+FE | 读宿主真实计数，非静态文案 | wip |
| M0-18 | 打开 / 新建工作空间（git 仓库与普通目录两条路径） | project-new | §5.1 §7 | FE+Rust | 选择目录后 projects 落库、右栏能力随之切换 | wip |
| M0-19 | 系统托盘 + 全局快捷键 + 开机自启 | tray shortcuts | M0 | Rust | 托盘菜单动作可用；快捷键冲突提示 | done |
| M0-20 | 系统通知（回合完成 / 需审批 / 异常终止）+ 提示音 + 静默时段 | notif set-notify | M6 | Rust+FE | 三类事件触发系统通知，静默时段内不发 | wip |
| M0-21 | 自动更新（签名校验 + 安装重启） | update | M6 | Rust | 校验失败时不安装并给原因 | done |
| M0-22 | 多窗口与按项目布局记忆（几何/折叠/子视图 → ui_state） | multiwin | §5.1 §10 | Rust+FE | 两窗口分别记忆布局，重开还原 | wip |

## M1. 对话核心（P0）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M1-1 | 消息流 + 流式渲染 + 自动跟随滚动（上滚解除跟随） | chat-stream | §5.2 | FE | 注入乱序/分段 text_delta 后顺序与光标态正确 | done |
| M1-2 | Markdown 渲染 + 代码高亮（tk-* 语法 token 随皮肤）+ 文件路径链接 | chat-stream tool-edit | §4 §5.2 | FE | 三种皮肤下高亮色均正确解析 | done |
| M1-3 | 思考链折叠（reasoning_delta，时长显示） | chat-stream | §5.2 | FE+Rust | 折叠态记忆，reasoning 增量单独成 part | wip |
| M1-4 | 工具卡：Read / List / Glob / Grep（失败态 + 输出截断） | tool-read | §5.2 §6.5 | FE | 截断标记、失败态、耗时均渲染 | done |
| M1-5 | 工具卡：Bash（命令块 + 流式输出 + 超时 kill） | tool-bash | §5.2 §3.3 | FE+Rust | output_delta 逐块渲染，超时后状态转 err | wip |
| M1-6 | 工具卡：Write / Edit / Apply Patch（内嵌 diff + ±统计 + 跳审查面板） | tool-edit | §5.2 §7.2 | FE | diff 行用 `--diff-*` token，±与文件数正确 | done |
| M1-7 | 工具卡：检索类（grep / MCP 文档抓取结果列表） | tool-web | §5.2 | FE | 结果项可展开正文 | done |
| M1-8 | 工具卡：To-dos（完成/进行中/待办 + 分段耗时） | tool-todo | §6.5 | FE | 状态机与耗时条渲染 | done |
| M1-9 | 工具卡：ask_user 内联（多题 + 选项 + 自定义答案） | tool-question q-dock | §6.5 §9.1 | FE+Rust | question_required → answer_question 往返闭环 | wip |
| M1-10 | 工具卡：子任务 / Skill 注入（可展开子步骤 + 后台化） | tool-task | §5.2 | FE | 折叠展开与后台标记 | done |
| M1-11 | 工具卡：MCP 泛用（结果 + needs_auth） | tool-mcp | §8 | FE | needs_auth 时给出「打开授权页」 | done |
| M1-12 | Turn 结果条四态：完成 / 中断 / 错误 / 上限 | outcome-done outcome-stop outcome-error outcome-limit | §6.2 | FE+Rust | turn_end / agent_end reason 映射四态 | wip |
| M1-13 | Ask / Plan / Code 模式切换（含策略预览） | pop-mode | §6.6 | FE+Rust | 切模式后 effective 策略随之变化并落库 | wip |
| M1-14 | 模型选择弹层（按端点分组 + 收藏 + 上下文/价格/能力） | pop-model | §6.7 | FE+Rust | 端点无模型时不报错，收藏跨会话记忆 | wip |
| M1-15 | 推理变体选择器（端点无 variants 自动隐藏，⇧Tab） | pop-variant | §6.7 | FE | 隐藏条件与快捷键生效 | done |
| M1-16 | 权限速览弹层（各工具摘要 + 例外 + 熔断 + 跳全量设置） | pop-shield | §6.6 | FE | effective 摘要与设置页一致 | done |
| M1-17 | 斜杠命令补全（内置动作 + Skills 分组） | pop-slash | §5.2 | FE | 过滤、分组、执行 /compact 等内置命令 | done |
| M1-18 | @ 提及（文件 / 目录 / 终端输出 / git 变更 / 检查点） | pop-mention | §5.2 §6.8 | FE+Rust | 四类来源均有候选，选中后作为 context_ref part 注入 | wip |
| M1-19 | 附件：图片粘贴/拖拽 Base64 直传 + 非图片转 @mention + 缩略条 | attach dragover | §1 §5.2 | FE+Rust | 上限（数量/体积）命中给明确提示 | wip |
| M1-20 | 提示词增强（小模型改写 + Ctrl+Z 回滚） | enhance | M1 | FE+Rust | 回滚恢复原文 | wip |
| M1-21 | 历史提示词 ↑↓ | chat-stream | M1 | FE | 会话内历史回填 | done |
| M1-22 | 转录内搜索（FTS + Aa/全词/正则 + n/m 计数 + 高亮定位）+ PromptRail | search | §10 §5.2 | FE+Rust | parts_fts 命中并在视图内定位 | wip |
| M1-23 | 消息 hover：复制 / Revert / Fork | revert | §7.2 | FE+Rust | 三动作均打到真实命令 | wip |
| M1-24 | 上下文压缩：分割线 + context_usage + 手动 /compact | compact | §6.3 | FE+Rust | compact_done 后分割线 part 入库 | wip |
| M1-25 | 错误卡集合：未配置端点 / 401 / 429 / 重试倒计时 | err-set | §6.7 | FE+Rust | agent_error.code 分类映射，倒计时按 retry_in_ms | wip |
| M1-26 | 费用估算标注「仅为估算，非实际账单」 | usage-modal outcome-done | §1 §14 | FE | 所有费用出现处均带声明，且展示服务端 usage 原值对照 | done |
| M1-27 | 热重载 /reload 刷新 Skills 与 MCP | reload | §8 M5 | FE+Rust | 重载后候选列表更新并发事件 | wip |
| M1-28 | 三队列排队条：busy 时入队 steering / follow_up，支持编辑 / 删除 / 提升 | queued | §6.1 §9.2 | Rust+FE | queue_state 事件驱动列表，queue_action 三条动作各自生效 | wip |

## M2. 会话与持久化（P0）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M2-1 | SQLite schema 全量建表 + user_version 迁移 + 迁移前备份 | — | §10 | Rust | `cargo test store_migrate` 空库→最新，二次运行为 no-op | wip |
| M2-2 | 单 writer task + WAL + 连接池读 | — | §3.3 §10 | Rust | 并发写串行化测试无 SQLITE_BUSY | wip |
| M2-3 | 会话 CRUD：list/create/rename/delete(软删+撤销)/fork/export | sess-ops | §9.2 | Rust+FE | 撤销窗口内恢复；export 出 Markdown | wip |
| M2-4 | 分页加载 session_load(before/limit) + part 级落库 | chat-stream | §9.2 §10 | Rust | 反向分页无重复无缺条 | done |
| M2-5 | 项目分组 + 切换 + 最近打开 | panel-picker | §5.1 §10 | Rust+FE | projects.last_opened 驱动左栏分组顺序 | wip |
| M2-6 | 左栏会话列表时间分组 + 活动状态点 | chat-stream | §5.1 | FE | 今天/昨天/本周/更早分桶正确，状态点随 session_updated 变化 | done |
| M2-7 | 历史会话页（工作空间过滤 + FTS 搜索） | history | §10 | Rust+FE | 搜索结果点击直达会话与消息 | wip |
| M2-8 | 草稿按会话隔离（drafts 表） | draft | §10 | Rust+FE | 切会话回填各自草稿（含附件） | wip |
| M2-9 | 断点恢复：checkpoints.queue_state 续跑未完成 Turn | resume | §6.1 §10 | Rust+FE | 重启后弹恢复确认，续跑从中断 turn_index 开始 | wip |
| M2-10 | 首启配置端点引导（无账号） | onboard | §0 §6.7 | FE | 未配置端点时进站即引导，配置后直达对话 | done |

## M3. 权限与安全（P0）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M3-1 | 权限引擎：三态 × 分层解析（global→project→session→mode 取最严）+ matcher glob + 例外 | approve-page | §6.6 | Rust | 单测覆盖分层取严、glob、例外覆盖 | done |
| M3-2 | 模式默认策略：Ask 写/shell 全 DENY；Plan 写 DENY + 只读白名单 AUTO；Code REQUIRE_APPROVAL | pop-mode | §6.6 | Rust | 三模式默认表与 PLAN 一致 | done |
| M3-3 | 审批往返：human_confirm_required → oneshot → approve_tool_call，30 分钟超时自动 deny | perm-dock perm-edit | §6.6 §3.3 | Rust+FE | 超时用例自动 deny 且不挂起任务 | wip |
| M3-4 | 审批卡 · 命令：shell 高亮、复制、命中规则、同形/punycode 提示 | perm-dock | §6.6 | FE | 命中规则文本来自 effective 解析，非硬编码 | done |
| M3-5 | 审批卡 · 文件与 diff：路径列表 + diff 预览 + 始终允许此类 + 改参数后执行 | perm-edit | §6.6 §7.2 | FE+Rust | modified_args 真正影响执行结果；allow_always 写入 session 层 | wip |
| M3-6 | 权限设置页：分层 + matcher + 例外 + effective 预览表 | approve-page sec-defaults | §6.6 | FE+Rust | permission_set 后 effective 表实时重算 | wip |
| M3-7 | 工具策略页：逐工具策略 + 输出截断 | tools-page | §6.4 §6.5 | FE+Rust | 截断阈值改动体现在工具卡 | wip |
| M3-8 | 花费与熔断：估算上限 / 最大 Turn / 重复检测 | cost outcome-limit | §6.4 | Rust | 命中阈值即暂停并发 reason=limit | done |
| M3-9 | 安全默认：keychain 存 key、无监听端口、无遥测、日志脱敏 | sec-defaults | §6.6 §3.2 | Rust | 单测断言脱敏与 key 不落明文 | done |
| M3-10 | 防死循环阈值配置下发（rpi 与桌面取更严者） | tools-page | §6.4 | Rust | 阈值边界用例触发熔断 | done |

## M4. 端点与模型（P0）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M4-1 | 端点列表与增删改（base_url + `{env:VAR}` + keychain 引用） | endpoints endpoint-new | §6.7 §10 | Rust+FE | key 只存引用，UI 永不回显明文 | wip |
| M4-2 | 连通性测试 provider_test（失败给分类原因） | endpoint-new | §6.7 | Rust+FE | 错误端点显示可行动原因 | wip |
| M4-3 | `GET /models` 拉取与勾选合并 | endpoint-edit | §6.7 | Rust+FE | 拉取失败回退手填，合并不丢收藏 | wip |
| M4-4 | 角色模型：对话 / 小模型 / 压缩 + 按模式覆盖 | role-models | §11 M4 | Rust+FE | 三角色分别生效 | wip |
| M4-5 | 思考链字段 / 超时 / 重试策略按端点配置 | endpoint-edit | §6.7 | Rust+FE | 配置项真正流入 rpi-ai 调用参数 | wip |

## M5. 扩展（P1）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M5-1 | MCP 客户端 stdio（子进程 + JSON-RPC + 进程组登记回收） | mcp mcp-edit | §8 | Rust | 退出后无残留子进程 | done |
| M5-2 | MCP 客户端 sse / http + header 鉴权 `{env:VAR}` | mcp-edit | §8 | Rust | needs_auth 状态可达 | done |
| M5-3 | MCP 管理页：状态机、启停、重试、删除确认、工具数、失败日志 | mcp | §8 §9.1 | Rust+FE | mcp_status 事件驱动 UI | wip |
| M5-4 | MCP 工具注册进工具缝（命名 mcp:<server>:<tool>）+ 权限默认值 | tool-mcp | §6.5 §8 | Rust | 工具可被权限引擎拦截 | done |
| M5-5 | Skills CRUD + scope（global/project/builtin）+ 文件路径 | skills skill-new | §9.2 §10 | Rust+FE | 写盘与库内一致 | wip |
| M5-6 | Skills 斜杠命令注入 System Prompt | pop-slash | §6.2 | Rust | 注入后可在 transcript 验证 | done |

## M6. 本地能力面板与设置（P0/P1）

| id | 任务 | screen | PLAN | 层 | 验收 | 状态 |
|---|---|---|---|---|---|---|
| M6-1 | 右栏入口卡片 + 子视图切换（按项目记忆） | panel-picker | §5.1 | FE | 折叠/展开与子视图状态持久化 | done |
| M6-2 | 文件树：后台扫描 + 增量缓存 + .gitignore + 深度/数量上限 + scan_progress | panel-tree | §6.8 | Rust+FE | 大目录不卡 UI，进度可取消 | wip |
| M6-3 | 文件勾选加入上下文（context_ref part，不塞 system prompt） | panel-tree | §6.8 | Rust+FE | 注入内容以 part 形式入消息 | wip |
| M6-4 | 文件预览（shiki 子集 + 图片 + 大文件截断） | panel-tree | §5.2 | FE | 截断提示与语言高亮 | done |
| M6-5 | 终端（feature 开关，默认关；PTY 服务 + 输出入上下文） | panel-terminal | §5.2 §9.2 | Rust+FE | 关 feature 时不打包、入口隐藏 | wip |
| M6-6 | 变更审查：git status/diff/暂存/取消暂存/提交/推送/AI 提交信息 | panel-review | §7.1 §7.2 | Rust+FE | porcelain=v2 解析单测；commit/push 必过审批 | wip |
| M6-7 | checkpoint shadow 仓库（commit-tree 写 refs/kilo/ckpt，不碰用户 HEAD/index/stash） | revert panel-review | §7.2 | Rust | 快照后用户仓库 refs/reflog 无变化 | done |
| M6-8 | Revert / Redo（按文件粒度 checkout + 横幅 + Redo All） | revert | §7.2 | Rust+FE | 逐消息回滚文件内容正确，可 Redo 回下一快照 | wip |
| M6-9 | 后台任务列表（扫描/压缩/MCP 重连，可取消可重试） | panel-tasks | §5.1 | Rust+FE | 任务态与真实句柄绑定 | wip |
| M6-10 | 设置：上下文（压缩阈值 / 注入预算 / watcher 忽略） | set-context | §6.3 §6.8 | Rust+FE | 阈值影响压缩触发与注入上限 | wip |
| M6-11 | 设置：Git 与检查点（CLI 后端 / 提交策略 / 快照保留） | set-git | §7 | Rust+FE | Windows 无 git 时降级并提示（§14） | wip |
| M6-12 | 设置：文件与附件（扫描预算 / 缓存上限） | set-files | §6.8 §10 | Rust+FE | 上限命中给提示并可清理 | wip |
| M6-13 | 设置：实验性 | set-experimental | §13 §11 P2 | Rust+FE | 开关只影响 feature 门控项 | wip |
| M6-14 | 设置：关于与诊断（版本 / runtime / 数据路径 / schema_version） | set-about | §9.2 §13 | Rust+FE | 路径与版本来自宿主真实值 | wip |
| M6-15 | 用量与费用弹（token 细分 + 上下文三段 + 估算声明） | usage-modal | §6.3 §14 | Rust+FE | 数字来自 turn_end 累计，声明常驻 | wip |
| M6-16 | IPC 协议唯一来源 + ts-rs 生成前端类型（无手写漂移） | — | §15 | Rust | 生成产物与 protocol.ts 一致 | todo |

---

## 覆盖与阻塞说明

清单以本文件为唯一来源（不再另存一份 json，避免漂移）：`bun run todos:check` 解析上面所有表格，校验每条任务都带 screen / PLAN 章节 / 验收 / 状态四个字段，逐条比对 `screen-inventory.json` 的 78 屏是否全部被覆盖，并输出 done / wip / todo / blocked 的分布。

`done` 不是自述：`bun scripts/mark-todos.ts verification.json` 会按逐屏实测结果回写状态（任务挂的屏全通过才 done，部分通过 wip，未通过 todo），只有不挂屏的基建项与 S0 尖峰项保留人工判定。最终交付时的状态分布以脚本回写为准。

当前没有 `blocked` 项。剩余风险集中在两处：本机 tauri 依赖编译耗时（影响 S0-1 / S0-3 收尾），以及 rpi 仍在 0.x 快速迭代（对策是钉 `=0.3.24` 并把用法收敛在 `adapt.rs` 单点）。

刻意不做（PLAN §1 明确排除）：账号与计费、云同步与分享、市场、多代理编排面板、SSH、内网穿透、语音输入、行内补全、语义索引。原型里若残留相关入口，一并视为不实现项。
