# prototype-v2.html 原型验证报告

验证时间：2026-10-15 · 验证人：Qoder（逐屏实跑，不是读代码推断）
被验证对象：`design/kilo-desktop/prototype-v2.html`（2916 行单文件原型）
证据：[prototype-evidence.json](./prototype-evidence.json)（78 条逐屏记录）· [shot-chat-stream.png](./shot-chat-stream.png)

## 1. 方法

用浏览器驱动真实加载原型，在页面里注入一套验证装置，然后逐屏执行 `openScreen(id)`：

- 每屏先**清场**（`osClose` / `closeModal` / `closeModule` / 关屏目索引 / 复位皮肤与折叠态），排除原型里「后一屏依赖前一屏遗留状态」的干扰；
- 执行后等待 260ms，采集 17 项状态信号：当前可见 `.view`、`.screen-badge` 里的场景名、`#shell` 的 `nol/nor` 类、`data-skin`、`#scrim` + `#modalHost` 弹层文本、`.set-nav .on` 激活项、`.dock-tabs .on` 面板子视图、消息数 `.msg`、工具卡数 `.tool`、输入框内容、hash；
- 对 **78 屏逐屏写显式断言**（不是「没报错就算过」）：例如 `skin-paper` 必须让 `data-skin=paper-light` 且消息数 > 0；`panel-review` 必须让右栏子视图激活项等于「变更审查」；`endpoint-edit` 必须打开编辑态弹层且名称输入框预填 `Ollama（本地）`、base_url 预填 `http://localhost:11434/v1`；30 个 `M1` 屏必须让场景徽章等于 `scene · <屏id>`；
- 全程挂 `window.onerror` / `unhandledrejection` / `console.error` 钩子收集脚本报错；
- 皮肤与折叠另做**数值核对**：读 `getComputedStyle(shell).gridTemplateColumns` 验证折叠，读计算后的 CSS 变量验证三套皮肤的 L2 令牌是否真的落地；
- 静态交叉检查：把原型 HTML 里所有 `openScreen('x')` 引用与 `SCREENS` 声明的 78 个 id 做集合差。

复现方式：浏览器打开原型 → 按 ⌘⇧S 出屏目索引 → 逐条点击；或 `location.hash = '#s=<屏id>'` 直达任意图中一屏。

## 2. 结论：78/78 屏可达，77 屏断言通过，0 脚本报错

| 分组 | 屏数 | 断言通过 |
|---|---|---|
| M0 骨架 / 皮肤 | 20 | 19（`shell-nol` 见缺陷 A） |
| M1 对话核心 | 30 | 30 |
| M2 会话与持久化 | 4 | 4 |
| M3 权限与安全 | 4 | 4 |
| M4 端点与模型 | 4 | 4 |
| M5 扩展 | 4 | 4 |
| M6 能力面板 | 5 | 5 |
| M6 设置 | 7 | 7 |

整个 78 屏走查过程中 **没有产生任何 JS 错误、Promise rejection 或 console.error**。`SCREENS` 注册表 78 条与 `screen-inventory.json` 78 条完全一致（分组计数、P0/P1/P2 分布 54/23/1 均对得上）。

## 3. 发现的缺陷

**A. `shell-nol` 的导航条件写反了（P0 屏）**

屏目索引里点「左栏折叠」不会真的折叠。源码条件是把已折叠当作前提：仅当 `#shell` 已含 `nol` 时才 `toggleLeft()`，否则只弹一句 toast。对照 `shell-nor` 的条件是反的（`if(!contains('nor')) toggleRight()`），所以右栏那屏是好的。折叠能力本身没坏：手动 `toggleLeft()` 后 `grid-template-columns` 从 `268px … 348px` 变成 `0px 497px 348px`，`.edge-toggle` 把手存在。属于**屏目索引的入口 bug，不是功能缺失**。

**B. 三处 `openScreen()` 指向不存在的屏（静态交叉检查抓到，逐屏走查抓不到）**

| 位置 | 引用 | 说明 |
|---|---|---|
| prototype-v2.html:1276 状态栏 | `indexing` | 「语义索引状态」入口，点了会提示「未知屏：indexing」。PLAN §1 明确不做语义索引，这个入口本身就该删 |
| prototype-v2.html:1290 托盘菜单 | `sys-shortcuts` | 声明表里只有 `shortcuts` |
| prototype-v2.html:1293 托盘菜单 | `shell-crash` | 「重启引擎」，v1 遗留（v2 无 sidecar，不存在重启侧车这回事） |

对实现的处理：`src/screens.ts` 只收 78 个真实屏（由 `bun run todos:check` 与 `screen-inventory.json` 逐一对账，多一屏少一屏都构建失败）；状态栏不放索引入口；缺陷 A 在新实现里用声明式指令 `{do:"collapse", side:"left"}` 规避 —— 每屏先 reset 再按指令执行，不存在「依赖当前折叠态」的条件分支。

## 4. 皮肤系统实测（拆单依据）

三套内置皮肤均真实落地，各自 **109 个 CSS 变量**，切换后 `getComputedStyle` 能读到值：

| 皮肤 | mode | `--surface-base` | `--text-strong` | `--accent` |
|---|---|---|---|---|
| graphite-dark | dark | #11161e | #eaf0f9 | #4c6ef5 |
| paper-light | light | #ffffff | #171717 | #2563eb |
| nocturne-amber | dark | #191510 | #f5ead8 | #e0a53c |

- 组件层实际引用了 **102 个**必须由皮肤提供的 L2 语义令牌（`scripts/extract-skins.ts` 从 base.css 的 `var()` 引用反推得出，写成 `src/skins/required.ts`）→ 这就是「完整度校验」的判据，内置三套全部满足。
- 对比度门禁在原型里是可运行的真实算法（`lum()` / `ratio()`，WCAG 相对亮度），阈值 4.5:1 / 3:1 / 2.2:1；三套内置皮肤均通过。`skin-manager` 屏另有导入与「阻止保存 + 自动提亮」的说明文本。
- **命名与 PLAN 有偏差**：PLAN §4 把语义色写作 `danger/success/warn/info`，原型实际实现为 `--surface-critical-*` / `--surface-success-*` / `--surface-warning-*` / `--surface-info-*`，不存在 `--danger` 变量。实现按原型（可运行的一方）为准，PLAN 措辞后续应更新。
- 折叠态实测：`.shell` 为 `268px minmax(0,1fr) 348px`；`nor` 时右列转 0；`nol` 时左列转 0；双折叠 `0px … 0px`。左 268 / 右 348 与 PLAN §5.1 写的 220 / 280 不一致，**以原型为准**（原型是已验证的视觉基准），实现照 268/348 落。

## 5. 其它值得记一笔的事实

- 原型是自包含单文件：无外部 JS 依赖（只外链 Google Fonts 与本地 `logo.png`），5 个 `<script>` 块 + 1 个 `<style>` 块，因此可以在 `file://` 下直接双击运行 —— 这也是它能被逐屏自动化的原因。
- 原型图标是内联 SVG sprite（`prototype-v2.html:1071-1158`，86 个 `symbol`），已抽到 `src/assets/sprite.ts`，无需引入图标库。
- `chat-welcome`、`draft` 两屏走的是 welcome 态（`#v-chat.welcome`），断言用「场景徽章 = `scene · welcome`」+ 输入框预填文本核对，均通过。
- 逐屏走查在**应用内嵌浏览器的窄视口（531×802）**下完成。三栏骨架没有断点（`@media` 只用于 `prefers-reduced-motion`），窄视口下中栏被压到 0 宽，因此**视觉排布需在大视口再核一遍**；本次的状态类断言（视图切换、弹层、面板子视图、皮肤、折叠、消息与工具卡数量）不受视口影响，均按 computed style 与 DOM 状态判定。

## 6. 这份报告如何约束后续实现

1. `screen-inventory.json` + `prototype-evidence.json` 是屏目契约；`src/screens.ts` 必须与之一一对账（CI 由 `bun run todos:check` 把守）。
2. TODOS.md 的每条任务都必须挂到真实屏或标为基建任务，验收列要能落到具体检查动作。
3. 缺陷 A/B 不进实现；`indexing` 类入口按 PLAN §1 的「明确不做」删除。
4. 皮肤 token 与折叠尺寸以本报告的实测值为准，PLAN 文字若有冲突，改 PLAN 而不是改实现。
