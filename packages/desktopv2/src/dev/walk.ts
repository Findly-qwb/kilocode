/**
 * 逐屏验证装置（dev only，挂在 window.__walk）。
 *
 * 与验证原型时用的是同一套路：清场 → 打开一屏 → 采集 store + DOM 双向信号 → 断言。
 * 断言不比对像素，比对「这屏该有的语义是否真的出现」：
 *   store 侧看 runtime.state（消息块类型、队列、git、扫描、审批…）
 *   DOM 侧看渲染结果（可见视图、激活 tab、面板子视图、弹层、工具卡数量…）
 * 跑法：起 dev 后在控制台 `await __walk()`，或 `__walk({only:['perm-dock']})`。
 */
import { runtime } from "../ipc/runtime";
import { SCREENS } from "../screens";
import { goto } from "../ui/nav";
import { ui } from "../ui/state";

type Signal = {
  view: string | null;
  tab: string;
  panel: string;
  modal: boolean;
  modalText: string;
  blocks: string[];
  msgs: number;
  tools: number;
  cards: number;
  shell: string;
  skin: string;
  hash: string;
  text: number;
  queue: number;
  popover: string;
};

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const txt = (el: Element | null) => (el?.textContent ?? "").trim().replace(/\s+/g, " ");

function snap(): Signal {
  const shown = $$(".view.show").at(0);
  const st = runtime.state;
  const blocks = st.messages.flatMap((m) => m.blocks.map((b) => b.kind));
  const modal = $("#modalHost .modal") ?? $("#modalHost [class*=modal]");
  return {
    view: shown?.id.replace("v-", "") ?? null,
    tab: txt($(".set-nav .on")) || txt($(".set-nav .active")),
    panel: txt($(".dock-tabs .on")) || txt($(".dock-tabs .active")),
    modal: Boolean(modal),
    modalText: txt(modal).slice(0, 200),
    blocks,
    msgs: $$(".msg").length,
    tools: $$(".tool").length,
    cards: $$(".dock-card, .approve, [data-approval], .dock-card.q").length,
    shell: $("#shell")?.className ?? "",
    skin: document.documentElement.dataset.skin ?? "",
    hash: location.hash,
    text: (shown?.textContent ?? "").trim().length,
    queue: st.queue.steering.length + st.queue.follow_up.length + st.queue.main.length,
    popover: ui.get().popover ?? "",
  };
}

type Expect = (s: Signal) => string | null;
const need = (cond: boolean, why: string) => (cond ? null : why);
const viewIs = (v: string): Expect => (s) => need(s.view === v, `view=${s.view} 应为 ${v}`);
const modalIs = (re?: RegExp): Expect => (s) =>
  need(s.modal && (!re || re.test(s.modalText)), `弹层=${s.modal} 文本「${s.modalText.slice(0, 40)}」`);
const tabIs = (re: RegExp): Expect => (s) => need(re.test(s.tab), `设置 tab=「${s.tab}」`);
const panelIs = (re: RegExp): Expect => (s) => need(re.test(s.panel), `面板子视图=「${s.panel}」`);
const blockIs = (kind: string, min = 1): Expect => (s) =>
  need(s.blocks.filter((b) => b === kind).length >= min, `缺少 ${kind} 块（现有 ${[...new Set(s.blocks)].join(",") || "无"}）`);
const popIs = (what: string): Expect => (s) => need(s.popover === what, `浮层=「${s.popover}」`);

const scenes: Expect = (s) => need(s.msgs > 0 || s.text > 120, `对话区没内容（msgs=${s.msgs} 文本=${s.text}）`);

const EXP: Record<string, Expect> = {
  onboard: viewIs("onboard"),
  "chat-welcome": (s) => need(s.view === "chat" && !s.msgs, `空态应有输入区且无消息（msgs=${s.msgs}）`),
  "chat-stream": (s) => need(s.view === "chat" && s.msgs > 0, `会话中应有消息（msgs=${s.msgs}）`),
  "skin-graphite": (s) => need(s.skin === "graphite-dark", `skin=${s.skin}`),
  "skin-paper": (s) => need(s.skin === "paper-light", `skin=${s.skin}`),
  "skin-amber": (s) => need(s.skin === "nocturne-amber", `skin=${s.skin}`),
  "skin-manager": modalIs(/皮肤|skin|对比度/i),
  "set-display": tabIs(/显示|外观|皮肤/),
  "shell-nol": (s) => need(/\bnol\b/.test(s.shell), `shell=「${s.shell}」应含 nol`),
  "shell-nor": (s) => need(/\bnor\b/.test(s.shell), `shell=「${s.shell}」应含 nor`),
  "shell-focus": (s) => need(/nol/.test(s.shell) && /nor/.test(s.shell), `shell=「${s.shell}」应同时折叠`),
  cmdk: popIs("palette"),
  tray: popIs("tray"),
  notif: popIs("notif"),
  update: (s) => need(s.modal || s.popover === "update", "更新浮层未出现"),
  runtime: modalIs(/runtime|诊断|任务|checkpoint/i),
  panic: modalIs(/检查点|重试|异常|panic/i),
  shortcuts: modalIs(/⌘|⇧|⌥/),
  "project-new": modalIs(),
  multiwin: modalIs(/窗口|ui_state/),
  "tool-read": (s) => need(s.tools >= 3, `只读工具卡不足（.tool=${s.tools}）`),
  "tool-bash": (s) => need(s.blocks.includes("tool") && s.tools >= 1, `bash 工具卡未渲染（${s.tools}）`),
  "tool-edit": (s) => need(s.blocks.includes("tool") && !!$(".diff, .stat, [data-diff]"), "缺 diff/±统计"),
  "tool-web": blockIs("tool"),
  "tool-todo": blockIs("tool"),
  "tool-question": (s) => need(s.blocks.includes("question"), "缺提问卡"),
  "tool-task": blockIs("tool"),
  "tool-mcp": blockIs("tool"),
  "outcome-done": (s) => need(s.blocks.includes("outcome"), "缺回合结果条"),
  "outcome-stop": (s) => need(s.blocks.includes("outcome"), "缺中断结果"),
  "outcome-error": (s) => need(s.blocks.includes("error"), "缺错误卡"),
  "outcome-limit": (s) => need(s.blocks.some((b) => b === "outcome" || b === "error"), "缺熔断结果"),
  "err-set": (s) => need(s.blocks.filter((b) => b === "error").length >= 4, `错误卡不足（${s.blocks.filter((b) => b === "error").length}）`),
  "perm-dock": (s) =>
    need(s.cards > 0 && /同意/.test(txt($("#messages")) + s.modalText) && /拒绝|deny/i.test(txt($("#messages"))), `缺审批卡动作（dock-card=${s.cards}）`),
  "perm-edit": (s) =>
    need(s.cards >= 2 && !!$(".diff") && /改参数|始终允许/.test(txt($("#messages"))), `缺文件/diff 审批卡（dock-card=${s.cards} diff=${$(".diff") ? 1 : 0}）`),
  "q-dock": (s) => need(s.blocks.includes("question"), "缺提问卡"),
  queued: (s) => need(s.queue >= 2, `队列项不足（${s.queue}）`),
  revert: (s) => need(s.blocks.includes("tool") || /还原|Revert|回退/i.test(txt($("#messages"))), "缺 Revert 入口"),
  compact: (s) => need(s.blocks.includes("compact"), "缺压缩分割线"),
  search: popIs("search"),
  "pop-slash": (s) => need(s.popover === "slash" || !!$(".pm-item"), "缺斜杠补全浮层"),
  "pop-mention": (s) => need(s.popover === "mention" || !!$(".pm-item"), "缺 @ 提及浮层"),
  "pop-model": popIs("model"),
  "pop-shield": popIs("shield"),
  "pop-mode": popIs("mode"),
  "pop-variant": popIs("variant"),
  attach: (s) => need(/\.attach|thumb/.test(document.body.innerHTML) || s.popover === "attach", "缺附件缩略条"),
  dragover: popIs("dragover"),
  enhance: popIs("enhance"),
  reload: (s) => need(s.blocks.includes("text") || s.msgs > 0, "重载结果未渲染"),
  history: viewIs("history"),
  "sess-ops": (s) => need(s.view === "history" && s.modal, `历史页 + 删除确认（view=${s.view} modal=${s.modal}）`),
  draft: (s) => need(/README/.test(String(($(".promptbox textarea, #ptext") as HTMLTextAreaElement | null)?.value ?? "")) || s.view === "chat", "草稿未回填"),
  resume: modalIs(/恢复|续跑|checkpoint|queue_state/i),
  "approve-page": tabIs(/权限|审批/),
  "tools-page": tabIs(/工具/),
  cost: modalIs(/熔断|花费|上限|Turn/),
  "sec-defaults": viewIs("settings"),
  endpoints: tabIs(/端点/),
  "endpoint-new": modalIs(/端点|base|URL/i),
  "endpoint-edit": (s) => need(s.modal && /Ollama|编辑端点/.test(s.modalText + txt(document.querySelector("#modalHost"))), "编辑端点弹层未预填"),
  "role-models": tabIs(/模型/),
  mcp: viewIs("mcp"),
  "mcp-edit": modalIs(),
  skills: viewIs("skills"),
  "skill-new": modalIs(),
  "panel-tree": panelIs(/文件树/),
  "panel-terminal": panelIs(/终端/),
  "panel-review": panelIs(/变更审查|审查/),
  "panel-tasks": panelIs(/后台任务|任务/),
  "panel-picker": (s) => need(!s.panel, `picker 态不应有激活子视图（「${s.panel}」）`),
  "set-context": tabIs(/上下文/),
  "set-git": tabIs(/Git|检查点/i),
  "set-files": tabIs(/文件|附件/),
  "set-notify": tabIs(/通知/),
  "set-experimental": tabIs(/实验/),
  "set-about": tabIs(/关于|诊断/),
  "usage-modal": modalIs(/估算|token|Token|用量/),
};

export async function walk(opts: { only?: string[]; wait?: number } = {}) {
  const errs: string[] = [];
  const onErr = (e: ErrorEvent) => errs.push(String(e.message));
  addEventListener("error", onErr);
  const rows: { id: string; ok: boolean; why?: string; sig: Signal }[] = [];
  const list = SCREENS.filter((s) => !opts.only || opts.only.includes(s.id));
  for (const s of list) {
    const before = errs.length;
    let thrown: string | null = null;
    try {
      await goto(s.id);
    } catch (e) {
      thrown = String(e);
    }
    await new Promise((r) => setTimeout(r, opts.wait ?? 240));
    const sig = snap();
    const chk = EXP[s.id] ?? scenes;
    const why = thrown ?? (sig.hash !== `#s=${s.id}` ? `hash=${sig.hash}` : chk(sig)) ?? (errs.length > before ? `报错：${errs.slice(before)[0]}` : null);
    rows.push({ id: s.id, ok: !why, why: why ?? undefined, sig });
  }
  removeEventListener("error", onErr);
  const fail = rows.filter((r) => !r.ok);
  return { total: rows.length, pass: rows.length - fail.length, fail: fail.map((f) => ({ id: f.id, why: f.why })), jsErrors: errs, rows };
}

export function mount() {
  (window as unknown as Record<string, unknown>).__walk = walk;
}
