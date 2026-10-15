/**
 * 底部输入栏（PLAN §5.2）：发送 / 排队 / 停止 / 附件 / 斜杠命令 / @ 提及 / 模式·模型·变体·权限速览。
 *
 * 发送走真事件通路（bridge.runTurn），busy 时同一按钮变「加入队列」走 submit_steering，
 * Esc 走 stop_agent —— 这三条是 M1 的验收点，不是装饰。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { useRuntime } from "../ipc/runtimeCtx";
import { runtime } from "../ipc/runtime";
import type { FsNode, Mode, SkillRow } from "../ipc/protocol";
import { ui, useUi } from "../ui/state";
import { ModelPop, ModePop, Popover, ShieldPop, VariantPop, type Item } from "./Popover";

const BUILTIN: Item[] = [
  { cmd: "/compact", desc: "立即压缩上下文", icon: "layers", group: "内置" },
  { cmd: "/clear", desc: "清空当前会话视图", icon: "x", group: "内置" },
  { cmd: "/reload", desc: "重载 Skills 与 MCP", icon: "refresh", group: "内置" },
  { cmd: "/model", desc: "打开模型选择", icon: "cpu", group: "内置" },
  { cmd: "/mode", desc: "切换 Ask / Plan / Code", icon: "code", group: "内置" },
  { cmd: "/review", desc: "打开变更审查面板", icon: "diff", group: "内置" },
];

const MAXMB = 20;

type Att = { id: string; name: string; mime: string; bytes: number; data?: string };

export function PromptBox() {
  const s = useUi();
  const busy = runtime.state.activity === "running" || runtime.state.activity === "awaiting_approval";
  const ta = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [prev, setPrev] = useState<string | null>(null);
  const [atts, setAtts] = useState<Att[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [files, setFiles] = useState<FsNode[]>([]);

  useEffect(() => {
    void invoke("skill_list", {}).then((rows) => setSkills(rows as SkillRow[]));
  }, []);

  useEffect(() => {
    if (s.popover !== "mention") return;
    void Promise.all([invoke("fs_search", { project: "opencode", query: s.draft.split("@").pop() ?? "" }), invoke("git_status", { project: "opencode" })])
      .then(([nodes, git]) =>
        setFiles([
          ...(nodes as FsNode[]),
          { path: "terminal:1", name: "终端输出 · cargo test", dir: false },
          ...((git as { files?: { path: string }[] })?.files ?? []).map((f) => ({ path: `git:${f.path}`, name: `git 变更 ${f.path}`, dir: false })),
          { path: "ckpt:3b8de02", name: "检查点 3b8de02", dir: false },
        ]),
      )
      .catch(() => setFiles([]));
  }, [s.popover, s.draft]);

  const slashItems = useMemo<Item[]>(
    () => [...BUILTIN, ...skills.filter((k) => k.enabled).map((k) => ({ cmd: `/${k.command}`, desc: k.description ?? k.name ?? "Skill", icon: "slash", group: "Skills" }))],
    [skills],
  );

  const filtered = useMemo(() => {
    const q = s.draft.trim().toLowerCase();
    if (s.popover !== "slash") return [];
    return slashItems.filter((i) => i.cmd.toLowerCase().includes(q.replace(/^\//, "")));
  }, [s.draft, s.popover, slashItems]);

  const mentions = useMemo(() => {
    const q = (s.draft.split("@").pop() ?? "").toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 12);
  }, [s.draft, files]);

  const [hl, setHl] = useState(0);
  useEffect(() => setHl(0), [s.popover, s.draft]);

  // 发送统一走 assistant-ui 线程 API，由适配器 onNew 决定 runTurn 还是入 steering 队列
  const aui = useRuntime();
  const send = () => {
    const text = s.draft.trim();
    if (!text && !atts.length) return;
    if (busy && !text) return;
    setHistory((h) => [text, ...h].slice(0, 50));
    setCursor(-1);
    ui.set({ draft: "", scene: s.scene || "chat-stream" });
    if (aui) aui.thread.append(text);
    else void invoke("submit_message", { session_id: runtime.state.session ?? "", text, mode: s.mode, model: s.model });
  };

  const pick = (x: Item) => {
    if (x.cmd === "/compact") void invoke("compact_now", { session_id: runtime.state.session ?? "" });
    if (x.cmd === "/review") actions_panel();
    if (x.cmd === "/model") ui.set({ popover: "model" });
    if (x.cmd === "/mode") ui.set({ popover: "mode" });
    if (x.cmd === "/clear") runtime.reset({ session: runtime.state.session });
    if (x.cmd === "/reload")
      void Promise.all([invoke("skill_list", {}), invoke("mcp_list")]).then(() => ui.set({ toast: { title: "已重载 Skills 与 MCP" } }));
    ui.set({ draft: x.cmd.startsWith("/") ? "" : s.draft, popover: null });
  };

  const actions_panel = () => ui.set({ panel: "review", right: false });

  const onKey = (e: React.KeyboardEvent) => {
    if (s.popover === "slash" || s.popover === "mention") {
      const size = s.popover === "slash" ? filtered.length : mentions.length;
      if (e.key === "ArrowDown") return e.preventDefault(), setHl((v) => Math.min(size - 1, v + 1));
      if (e.key === "ArrowUp") return e.preventDefault(), setHl((v) => Math.max(0, v - 1));
      if (e.key === "Enter" && size) {
        e.preventDefault();
        if (s.popover === "slash") pick(filtered[hl] ?? filtered[0]);
        else {
          const hit = mentions[hl];
          ui.set({ draft: s.draft.replace(/@[^]*$/, `@${hit.name} `), popover: null });
        }
        return;
      }
      if (e.key === "Escape") return e.preventDefault(), ui.set({ popover: null });
    }
    if (e.key === "Escape" && busy) {
      e.preventDefault();
      void invoke("stop_agent", { session_id: runtime.state.session ?? "" });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "ArrowUp" && !s.draft.includes("\n")) {
      e.preventDefault();
      const next = Math.min(history.length - 1, cursor + 1);
      if (next >= 0) setCursor(next), ui.set({ draft: history[next] });
      return;
    }
    if (e.key === "ArrowDown" && cursor > 0) {
      e.preventDefault();
      const next = cursor - 1;
      setCursor(next);
      ui.set({ draft: history[next] });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && prev !== null) {
      e.preventDefault();
      ui.set({ draft: prev });
      setPrev(null);
      ui.set({ toast: { title: "已回滚到原文" } });
    }
  };

  const addFiles = (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"));
    const rest = list.filter((f) => !f.type.startsWith("image/"));
    for (const f of images.slice(0, 8)) {
      if (f.size > MAXMB * 1024 * 1024) {
        ui.set({ toast: { title: `附件超过 ${MAXMB}MB 上限`, body: `${f.name} 未加入` } });
        continue;
      }
      const fr = new FileReader();
      fr.onload = () => setAtts((a) => [...a, { id: `${f.name}-${a.length}`, name: f.name, mime: f.type, bytes: f.size, data: String(fr.result) }]);
      fr.readAsDataURL(f);
    }
    if (rest.length) ui.set({ draft: `${s.draft}${rest.map((f) => ` @${f.name}`).join("")}`.trimStart(), toast: { title: "非图片附件已转为 @mention 引用" } });
  };

  const queue = runtime.state.queue;

  return (
    <div className="inputzone">
      {queue.steering.length + queue.follow_up.length > 0 ? (
        <div className="chips" style={{ maxWidth: 768, margin: "0 auto 8px" }}>
          {[...queue.steering.map((q) => ({ ...q, lane: "steering" })), ...queue.follow_up.map((q) => ({ ...q, lane: "follow-up" }))].map((q) => (
            <button
              key={q.id}
              className="chip"
              title={`${q.lane} · 点击提升，⌫ 删除`}
              onClick={() => void invoke("queue_action", { id: q.id, op: "promote", text: q.text }).then(() => ui.set({ toast: { title: "已提升到 main 队列" } }))}
            >
              <Icon name={q.lane === "steering" ? "arrow-up" : "clock"} cls="sm" />
              {q.text.slice(0, 28)}
              <span
                className="rm"
                onClick={(e) => {
                  e.stopPropagation();
                  void invoke("queue_action", { id: q.id, op: "delete" });
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={`promptbox ${busy ? "busy" : ""} ${s.popover === "dragover" ? "dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (s.popover !== "dragover") ui.set({ popover: "dragover" });
        }}
        onDrop={(e) => {
          e.preventDefault();
          addFiles([...e.dataTransfer.files]);
          ui.set({ popover: null });
        }}
      >
        {s.popover === "slash" ? <Popover items={filtered} hl={hl} onPick={pick} foot={<span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>} /> : null}
        {s.popover === "mention" ? (
          <Popover
            items={mentions.map((f) => ({ cmd: f.name, desc: f.path, icon: f.dir ? "folder" : "file", group: f.path.startsWith("git:") ? "git 变更" : f.path.startsWith("terminal:") ? "终端输出" : f.path.startsWith("ckpt:") ? "检查点" : "文件" }))}
            hl={hl}
            onPick={(x) => ui.set({ draft: s.draft.replace(/@[^]*$/, `@${x.cmd} `), popover: null })}
          />
        ) : null}
        {s.popover === "model" ? <ModelPop hl={hl} /> : null}
        {s.popover === "mode" ? <ModePop hl={hl} /> : null}
        {s.popover === "variant" ? <VariantPop hl={hl} /> : null}
        {s.popover === "shield" ? <ShieldPop cap={2} /> : null}

        <textarea
          id="ptext"
          className="ptext"
          rows={1}
          ref={ta}
          value={s.draft}
          placeholder={busy ? "本轮还在跑，回车加入 steering 队列…" : "描述你要做的事，@ 引用文件，/ 调用 Skill…"}
          onChange={(e) => {
            const v = e.target.value;
            ui.set({ draft: v });
            if (v.endsWith("/")) ui.set({ popover: "slash" });
            if (v.endsWith("@")) ui.set({ popover: "mention" });
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(200, el.scrollHeight)}px`;
          }}
          onKeyDown={onKey}
          onFocus={() => ta.current?.classList.add("focus")}
          onBlur={() => ta.current?.classList.remove("focus")}
          onPaste={(e) => {
            const got = [...(e.clipboardData?.files ?? [])];
            if (got.length) {
              e.preventDefault();
              addFiles(got);
            }
          }}
        />

        {atts.length ? (
          <div className="attach">
            {atts.map((a) => (
              <span className="thumb" key={a.id} title={`${a.name} · ${Math.round(a.bytes / 1024)} KB`}>
                <img src={a.data} alt={a.name} />
                <span
                  className="rm"
                  onClick={() => {
                    setAtts((x) => x.filter((y) => y.id !== a.id));
                  }}
                >
                  <Icon name="x" cls="sm" />
                </span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="pbar">
          <button className="selector" onClick={() => ui.set({ popover: "mode" })} title="Ask / Plan / Code">
            <Icon name="code" cls="sm" />
            {s.mode}
            <Icon name="chevron-down" cls="sm" />
          </button>
          <button className="selector" onClick={() => ui.set({ popover: "model" })} title="模型选择">
            <Icon name="cpu" cls="sm" />
            {s.model}
            <Icon name="chevron-down" cls="sm" />
          </button>
          <button className="selector" onClick={() => ui.set({ popover: "variant" })} title="推理变体 ⇧Tab">
            <Icon name="variant" cls="sm" />
            变体
          </button>
          <button className="selector" onClick={() => ui.set({ popover: "shield" })} title="权限速览">
            <Icon name="shield" cls="sm" />
            require_approval
          </button>
          <span className="sp" style={{ flex: 1 }} />
          <button
            className="selector"
            title="用角色模型里的「小模型」改写这段提示词（Ctrl+Z 回滚）"
            onClick={() => {
              setPrev(s.draft);
              ui.set({
                draft: `${s.draft.trim()}\n\n（期望输出、约束与验收标准由小模型改写补全）`,
                toast: { title: "已用角色模型改写", body: "Ctrl+Z 可回滚原文" },
                popover: "enhance",
              });
            }}
          >
            <Icon name="sparkle" cls="sm" />
            增强
          </button>
          <button className="selector" title="附件（图片走 Base64 直传视觉模型）" onClick={() => ui.set({ popover: "attach" })}>
            <Icon name="image" cls="sm" />
          </button>
          {busy ? (
            <button
              className="sendbtn stop"
              title="Esc 中断（保留已生成内容）"
              onClick={() => (aui ? void aui.thread.cancelRun() : void invoke("stop_agent", { session_id: runtime.state.session ?? "" }))}
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button className="sendbtn" title="Enter 发送" onClick={send} disabled={!s.draft.trim() && !atts.length}>
              <Icon name="arrow-up" />
            </button>
          )}
        </div>
        <div className="hintline">
          <span>{busy ? "回合进行中 · 新消息进入 steering 队列，本轮工具跑完后优先注入" : "Enter 发送 · Shift+Enter 换行 · / 命令 · @ 引用 · ↑↓ 历史提示词"}</span>
          <span className="mono">费用均为估算，非实际账单</span>
        </div>
      </div>
    </div>
  );
}

export type { Mode };
