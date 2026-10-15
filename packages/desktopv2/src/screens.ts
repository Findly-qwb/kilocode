/**
 * 屏目注册表（PLAN §16）。78 屏来自 prototype-v2.html 的实测快照
 * （screen-inventory.json / prototype-evidence.json），语义与原型一一对应。
 *
 * 与原型不同的是这里用**声明式指令**而不是各自一段 run() JS：
 * 好处是屏与屏之间状态可预测（先 reset 再按指令顺序执行），也是 ⌘⇧S 索引、
 * ⌘K 面板与逐屏验证脚本共用的同一份数据。
 */

export type Directive =
  | { do: "view"; view: "chat" | "history" | "settings" | "skills" | "mcp" | "onboard" }
  | { do: "scene"; id: string }
  | { do: "skin"; id: string }
  | { do: "modal"; id: string; arg?: Record<string, string> }
  | { do: "tab"; id: string }
  | { do: "panel"; id: "picker" | "tree" | "terminal" | "review" | "tasks" }
  | { do: "open"; what: "palette" | "tray" | "update" | "notif" | "search" | "slash" | "mention" | "model" | "mode" | "variant" | "shield" | "dragover" | "enhance" | "attach" }
  | { do: "collapse"; side: "left" | "right" | "both" | "none" }
  | { do: "draft"; text: string }
  | { do: "scale"; px: number }
  | { do: "cmd"; name: string; args?: Record<string, unknown> };

export type Screen = {
  id: string;
  sec: string;
  name: string;
  desc: string;
  pri: "P0" | "P1" | "P2";
  run: Directive[];
};

const SC = (id: string): Directive => ({ do: "scene", id });
const CHAT = (id: string): Directive[] => [{ do: "view", view: "chat" }, SC(id)];
const M = (id: string, arg?: Record<string, string>): Directive => ({ do: "modal", id, arg });

export const SCREENS: Screen[] = [
  /* ---------------- M0 骨架 / 皮肤 ---------------- */
  { id: "onboard", sec: "M0 骨架 / 皮肤", name: "首启 · 配置端点", desc: "无账号无登录；填 OpenAI 兼容端点或本地模型", pri: "P0", run: [{ do: "view", view: "onboard" }] },
  { id: "chat-welcome", sec: "M0 骨架 / 皮肤", name: "三栏空态（欢迎）", desc: "居中大号输入框 + 快捷卡片", pri: "P0", run: [{ do: "view", view: "chat" }, { do: "scene", id: "" }] },
  { id: "chat-stream", sec: "M0 骨架 / 皮肤", name: "会话中（三栏全开）", desc: "TaskHeader + 时间线 + 流式 + 输入区", pri: "P0", run: CHAT("chat-stream") },
  { id: "skin-graphite", sec: "M0 骨架 / 皮肤", name: "皮肤 · 石墨深灰", desc: "深色 IDE · 蓝墨偏移", pri: "P0", run: [...CHAT("chat-stream"), { do: "skin", id: "graphite-dark" }] },
  { id: "skin-paper", sec: "M0 骨架 / 皮肤", name: "皮肤 · 纸张浅灰", desc: "极简灰度 + 少量蓝强调", pri: "P0", run: [...CHAT("chat-stream"), { do: "skin", id: "paper-light" }] },
  { id: "skin-amber", sec: "M0 骨架 / 皮肤", name: "皮肤 · 夜航暖橙", desc: "强调色可替换的扩展性验证", pri: "P1", run: [...CHAT("chat-stream"), { do: "skin", id: "nocturne-amber" }] },
  { id: "skin-manager", sec: "M0 骨架 / 皮肤", name: "皮肤管理 · 导入与校验", desc: "skin.json bundle · extends · 对比度守护", pri: "P0", run: [...CHAT("chat-stream"), M("skin")] },
  { id: "set-display", sec: "M0 骨架 / 皮肤", name: "设置 · 显示与皮肤", desc: "字号滑杆实时生效 / 密度 / 折叠默认态", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "display" }, { do: "scale", px: 15 }] },
  { id: "shell-nol", sec: "M0 骨架 / 皮肤", name: "左栏折叠", desc: "边缘把手恢复", pri: "P0", run: [...CHAT("chat-stream"), { do: "collapse", side: "left" }] },
  { id: "shell-nor", sec: "M0 骨架 / 皮肤", name: "右栏折叠", desc: "能力面板收起，状态栏保留入口", pri: "P0", run: [...CHAT("chat-stream"), { do: "collapse", side: "right" }] },
  { id: "shell-focus", sec: "M0 骨架 / 皮肤", name: "专注模式（双栏折叠）", desc: "阅读/演示态", pri: "P1", run: [...CHAT("chat-stream"), { do: "collapse", side: "both" }] },
  { id: "cmdk", sec: "M0 骨架 / 皮肤", name: "命令面板 ⌘K", desc: "会话 / 命令 / 面板 / 皮肤统一入口", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "palette" }] },
  { id: "tray", sec: "M0 骨架 / 皮肤", name: "系统托盘菜单", desc: "后台运行 · 快速提问 · 退出", pri: "P1", run: [...CHAT("chat-stream"), { do: "open", what: "tray" }] },
  { id: "notif", sec: "M0 骨架 / 皮肤", name: "系统通知", desc: "回合完成 / 需审批 / 异常终止", pri: "P1", run: [...CHAT("chat-stream"), { do: "open", what: "notif" }] },
  { id: "update", sec: "M0 骨架 / 皮肤", name: "自动更新", desc: "签名校验 + 安装并重启", pri: "P1", run: [...CHAT("chat-stream"), M("update")] },
  { id: "runtime", sec: "M0 骨架 / 皮肤", name: "Runtime 诊断", desc: "同进程 · Tokio · 子进程与 checkpoint 仓库", pri: "P0", run: [...CHAT("chat-stream"), M("runtime")] },
  { id: "panic", sec: "M0 骨架 / 皮肤", name: "任务异常隔离", desc: "catch_unwind：不崩窗，可重试或回退检查点", pri: "P0", run: [...CHAT("chat-stream"), M("panic")] },
  { id: "shortcuts", sec: "M0 骨架 / 皮肤", name: "快捷键", desc: "含全局快捷键与冲突提示", pri: "P1", run: [...CHAT("chat-stream"), M("shortcuts")] },
  { id: "project-new", sec: "M0 骨架 / 皮肤", name: "打开 / 新建工作空间", desc: "git 仓库与普通目录两种路径", pri: "P0", run: [...CHAT("chat-stream"), M("projectnew")] },
  { id: "multiwin", sec: "M0 骨架 / 皮肤", name: "多窗口与布局记忆", desc: "几何 / 折叠态 / 面板子视图按项目存 ui_state", pri: "P1", run: [...CHAT("chat-stream"), M("multiwin")] },

  /* ---------------- M1 对话核心 ---------------- */
  { id: "tool-read", sec: "M1 对话核心", name: "工具卡 · Read / List / Glob / Grep", desc: "含失败态与输出截断", pri: "P0", run: CHAT("tool-read") },
  { id: "tool-bash", sec: "M1 对话核心", name: "工具卡 · Bash", desc: "命令块 + 流式输出 + 超时 kill", pri: "P0", run: CHAT("tool-bash") },
  { id: "tool-edit", sec: "M1 对话核心", name: "工具卡 · Write / Edit / Apply Patch", desc: "内嵌 diff + ±统计 + 审查面板跳转", pri: "P0", run: CHAT("tool-edit") },
  { id: "tool-web", sec: "M1 对话核心", name: "工具卡 · 检索类（grep/MCP 文档）", desc: "结果列表 + 抓取正文", pri: "P1", run: CHAT("tool-web") },
  { id: "tool-todo", sec: "M1 对话核心", name: "工具卡 · To-dos", desc: "完成 / 进行中 / 待办 + 分段耗时", pri: "P0", run: CHAT("tool-todo") },
  { id: "tool-question", sec: "M1 对话核心", name: "工具卡 · ask_user（内联）", desc: "多题 + 选项 + 自定义答案", pri: "P0", run: CHAT("tool-question") },
  { id: "tool-task", sec: "M1 对话核心", name: "工具卡 · 子任务 / Skill 注入", desc: "可展开子步骤 + 后台化", pri: "P1", run: CHAT("tool-task") },
  { id: "tool-mcp", sec: "M1 对话核心", name: "工具卡 · MCP 泛用", desc: "结果 + needs_auth 态", pri: "P1", run: CHAT("tool-mcp") },
  { id: "outcome-done", sec: "M1 对话核心", name: "回合结果 · 完成", desc: "turns / 费用估算 / 吞吐 + 反馈", pri: "P0", run: CHAT("outcome-done") },
  { id: "outcome-stop", sec: "M1 对话核心", name: "回合结果 · 已中断", desc: "Esc 中断保留内容", pri: "P0", run: CHAT("outcome-stop") },
  { id: "outcome-error", sec: "M1 对话核心", name: "回合结果 · 错误", desc: "SQLITE_IOERR + 重试", pri: "P0", run: CHAT("outcome-error") },
  { id: "outcome-limit", sec: "M1 对话核心", name: "回合结果 · 花费熔断", desc: "达上限暂停并询问", pri: "P0", run: CHAT("outcome-limit") },
  { id: "err-set", sec: "M1 对话核心", name: "错误卡集合", desc: "端点未配置 / 401 / 429 / 重试倒计时", pri: "P0", run: CHAT("err-set") },
  { id: "perm-dock", sec: "M1 对话核心", name: "审批卡 · 命令", desc: "shell 高亮 + 复制 + 命中规则 + 例外三态", pri: "P0", run: CHAT("perm-dock") },
  { id: "perm-edit", sec: "M1 对话核心", name: "审批卡 · 文件与 diff", desc: "路径列表 + diff 预览 + 始终允许 + 改参数", pri: "P0", run: CHAT("perm-edit") },
  { id: "q-dock", sec: "M1 对话核心", name: "提问卡", desc: "多题翻页 + 自定义答案 + 跳过", pri: "P0", run: CHAT("q-dock") },
  { id: "queued", sec: "M1 对话核心", name: "排队消息（steering 队列）", desc: "busy 时入队，可编辑 / 删除 / 提升", pri: "P0", run: [...CHAT("chat-stream"), { do: "cmd", name: "submit_steering", args: { text: "先别提交，我想再看一眼 diff" } }, SC("queued")] },
  { id: "revert", sec: "M1 对话核心", name: "Revert / Redo", desc: "消息 hover + 回退横幅 + 文件统计", pri: "P0", run: CHAT("revert") },
  { id: "compact", sec: "M1 对话核心", name: "上下文压缩", desc: "分割线 + 阈值 + 摘要说明", pri: "P0", run: CHAT("compact") },
  { id: "search", sec: "M1 对话核心", name: "转录内搜索 + PromptRail", desc: "Aa / 全词 / 正则 + n/m 计数", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "search" }] },
  { id: "pop-slash", sec: "M1 对话核心", name: "斜杠命令补全", desc: "内置动作 + Skills 分组", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "slash" }] },
  { id: "pop-mention", sec: "M1 对话核心", name: "@ 提及", desc: "文件 / 目录 / 终端 / git 变更 / 检查点", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "mention" }] },
  { id: "pop-model", sec: "M1 对话核心", name: "模型选择弹层", desc: "按端点分组 + 收藏 + 上下文/价格/能力", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "model" }] },
  { id: "pop-shield", sec: "M1 对话核心", name: "权限速览弹层", desc: "各工具摘要 + 例外 + 熔断 + 跳全量设置", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "shield" }] },
  { id: "pop-mode", sec: "M1 对话核心", name: "模式切换 Ask/Plan/Code", desc: "含描述与策略预览", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "mode" }] },
  { id: "pop-variant", sec: "M1 对话核心", name: "推理变体选择器", desc: "端点无 variants 时自动隐藏 · ⇧Tab", pri: "P0", run: [...CHAT("chat-stream"), { do: "open", what: "variant" }] },
  { id: "attach", sec: "M1 对话核心", name: "附件缩略条", desc: "图片 Base64 直传视觉模型", pri: "P0", run: [...CHAT("attach"), { do: "open", what: "attach" }] },
  { id: "dragover", sec: "M1 对话核心", name: "拖拽热区", desc: "dragover 态 + 数量/体积上限", pri: "P1", run: [...CHAT("chat-stream"), { do: "open", what: "dragover" }] },
  { id: "enhance", sec: "M1 对话核心", name: "提示词增强", desc: "小模型改写 + Ctrl+Z 回滚", pri: "P1", run: [...CHAT("chat-stream"), { do: "open", what: "enhance" }] },
  { id: "reload", sec: "M1 对话核心", name: "热重载", desc: "/reload 刷新 Skills 与 MCP", pri: "P1", run: CHAT("reload") },

  /* ---------------- M2 会话与持久化 ---------------- */
  { id: "history", sec: "M2 会话与持久化", name: "历史会话", desc: "本地 SQLite · 工作空间过滤 · FTS 搜索", pri: "P0", run: [{ do: "view", view: "history" }] },
  { id: "sess-ops", sec: "M2 会话与持久化", name: "会话行内操作", desc: "重命名 / 导出 / 软删 + 撤销", pri: "P0", run: [{ do: "view", view: "history" }, M("sessdel")] },
  { id: "draft", sec: "M2 会话与持久化", name: "草稿恢复", desc: "按会话隔离保存（drafts 表）", pri: "P1", run: [{ do: "view", view: "chat" }, { do: "scene", id: "" }, { do: "draft", text: "顺便把 README 的存储章节也更新一下" }] },
  { id: "resume", sec: "M2 会话与持久化", name: "断点恢复", desc: "重启后从 checkpoints.queue_state 续跑未完成 Turn", pri: "P0", run: [...CHAT("chat-stream"), M("resume")] },

  /* ---------------- M3 权限与安全 ---------------- */
  { id: "approve-page", sec: "M3 权限与安全", name: "权限与审批页", desc: "三态 × 分层作用域 + 例外 matcher + effective 表", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "approve" }] },
  { id: "tools-page", sec: "M3 权限与安全", name: "工具策略页", desc: "逐工具策略 + 输出截断 + 沙箱(P1)", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "tools" }] },
  { id: "cost", sec: "M3 权限与安全", name: "花费与熔断", desc: "估算上限 / 最大 Turn / 重复检测", pri: "P0", run: [...CHAT("chat-stream"), M("cost")] },
  { id: "sec-defaults", sec: "M3 权限与安全", name: "安全默认", desc: "keychain · 无端口 · 无遥测 · punycode 提示", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "security" }] },

  /* ---------------- M4 端点与模型 ---------------- */
  { id: "endpoints", sec: "M4 端点与模型", name: "模型端点列表", desc: "OpenAI 兼容 · key 引用 · 连通性", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "endpoints" }] },
  { id: "endpoint-new", sec: "M4 端点与模型", name: "添加端点", desc: "base URL + key + 协议细节", pri: "P0", run: [...CHAT("chat-stream"), M("endpoint")] },
  { id: "endpoint-edit", sec: "M4 端点与模型", name: "编辑端点", desc: "/models 拉取合并 + 思考链字段 + 超时重试", pri: "P0", run: [...CHAT("chat-stream"), M("endpoint", { n: "Ollama（本地）" })] },
  { id: "role-models", sec: "M4 端点与模型", name: "角色模型", desc: "对话 / 小模型 / 压缩 + 按模式覆盖", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "models" }] },

  /* ---------------- M5 扩展 ---------------- */
  { id: "mcp", sec: "M5 扩展", name: "MCP 页", desc: "三协议 · 状态机 · Sign in / 重试 / 删除", pri: "P1", run: [{ do: "view", view: "mcp" }] },
  { id: "mcp-edit", sec: "M5 扩展", name: "MCP 编辑", desc: "stdio 命令/args/env 与 remote url/headers + 策略", pri: "P1", run: [...CHAT("chat-stream"), M("mcp")] },
  { id: "skills", sec: "M5 扩展", name: "Skills 页", desc: "扫描目录 · 作用域 · 重载", pri: "P1", run: [{ do: "view", view: "skills" }] },
  { id: "skill-new", sec: "M5 扩展", name: "Skill 编辑", desc: "命令 / 作用域 / 模型变体覆盖 / 模板占位", pri: "P1", run: [...CHAT("chat-stream"), M("skill")] },

  /* ---------------- M6 能力面板 ---------------- */
  { id: "panel-tree", sec: "M6 能力面板", name: "文件树", desc: "懒加载 + .gitignore + 勾选加入上下文 + 预览", pri: "P0", run: [...CHAT("chat-stream"), { do: "panel", id: "tree" }] },
  { id: "panel-terminal", sec: "M6 能力面板", name: "终端", desc: "PTY 会话 + 输出加入上下文（feature）", pri: "P1", run: [...CHAT("chat-stream"), { do: "panel", id: "terminal" }] },
  { id: "panel-review", sec: "M6 能力面板", name: "变更审查", desc: "git 状态 / diff / 暂存提交 / 检查点 Revert", pri: "P0", run: [...CHAT("chat-stream"), { do: "cmd", name: "git_status" }, { do: "panel", id: "review" }] },
  { id: "panel-tasks", sec: "M6 能力面板", name: "后台任务", desc: "扫描 / 压缩 / MCP 重连 · 可取消可重试", pri: "P1", run: [...CHAT("chat-stream"), { do: "panel", id: "tasks" }] },
  { id: "panel-picker", sec: "M6 能力面板", name: "能力面板入口总览", desc: "折叠态与子视图按项目记忆", pri: "P0", run: [...CHAT("chat-stream"), { do: "panel", id: "picker" }] },

  /* ---------------- M6 设置 ---------------- */
  { id: "set-context", sec: "M6 设置", name: "设置 · 上下文", desc: "压缩阈值 / 注入预算 / watcher 忽略", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "context" }] },
  { id: "set-git", sec: "M6 设置", name: "设置 · Git 与检查点", desc: "CLI 后端 / 提交策略 / 快照保留", pri: "P0", run: [{ do: "view", view: "settings" }, { do: "tab", id: "git" }] },
  { id: "set-files", sec: "M6 设置", name: "设置 · 文件与附件", desc: "扫描预算 / 附件缓存与上限", pri: "P1", run: [{ do: "view", view: "settings" }, { do: "tab", id: "files" }] },
  { id: "set-notify", sec: "M6 设置", name: "设置 · 通知", desc: "触发条件 / 提示音 / 静默时段", pri: "P1", run: [{ do: "view", view: "settings" }, { do: "tab", id: "notify" }] },
  { id: "set-experimental", sec: "M6 设置", name: "设置 · 实验性", desc: "终端 / 索引 / 多代理 / 沙箱", pri: "P2", run: [{ do: "view", view: "settings" }, { do: "tab", id: "experimental" }] },
  { id: "set-about", sec: "M6 设置", name: "设置 · 关于与诊断", desc: "版本 / runtime / 数据路径 / 体积门禁", pri: "P1", run: [{ do: "view", view: "settings" }, { do: "tab", id: "about" }] },
  { id: "usage-modal", sec: "M6 设置", name: "用量与费用（估算）", desc: "Token 细分 + 上下文三段 + 估算声明", pri: "P0", run: [...CHAT("chat-stream"), M("usage")] },
];

export const find = (id: string) => SCREENS.find((s) => s.id === id);
