/**
 * 设置视图（PLAN §16 M0/M3/M4/M6）：11 个 tab，直接读写 Settings（settings_get/set）。
 *
 * 未保存改动进本地 draft，`.savebar` 显示 diff 条数，保存走 settings_set。
 * 皮肤 / 字号滑杆是例外：它们改的是 CSS 变量（skins/loader），实时生效并立即落库，
 * 与原型 setScale/applySkin 的语义一致。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { Effective, Mode, Policy, ProviderRow, Settings as Cfg } from "../ipc/protocol";
import { SCREENS } from "../screens";
import * as skin from "../skins/loader";
import { useUi, ui } from "../ui/state";
import { excCache, providerCache, roleCache } from "./cache";

const TABS = [
  { key: "display", label: "显示与皮肤", icon: "palette" },
  { key: "endpoints", label: "模型端点", icon: "key" },
  { key: "models", label: "角色模型", icon: "layers" },
  { key: "approve", label: "权限与审批", icon: "shield-check" },
  { key: "tools", label: "工具", icon: "wrench" },
  { key: "context", label: "上下文", icon: "archive" },
  { key: "git", label: "Git 与检查点", icon: "branch" },
  { key: "files", label: "文件与附件", icon: "folder" },
  { key: "notify", label: "通知", icon: "bell" },
  { key: "experimental", label: "实验性", icon: "sparkle" },
  { key: "about", label: "关于与诊断", icon: "info" },
];

/** 内置工具基线：策略真值来自 permission_effective，这里只提供展示顺序与说明 */
const TOOLS: [string, string][] = [
  ["read", "读取文件（含截断策略）"],
  ["list", "列目录"],
  ["glob", "文件名匹配"],
  ["grep", "内容检索"],
  ["write", "新建文件"],
  ["edit", "精确替换"],
  ["apply_patch", "应用补丁"],
  ["bash", "执行 shell 命令"],
  ["todo", "任务清单"],
  ["ask_user", "向用户提问"],
  ["git_status", "读取 git 状态"],
  ["git_diff", "读取 diff"],
  ["git_commit", "提交"],
  ["git_push", "推送"],
  ["mcp:*", "MCP 工具（按 server 单独设策）"],
];

const MODES: [Mode, string][] = [
  ["ask", "仅问答，不改文件也不执行命令"],
  ["plan", "只读探索并产出计划，批准后转 Code"],
  ["code", "完整读写与命令执行"],
];

const POLICIES: Policy[] = ["auto", "require_approval", "deny"];

const badgeFor = (p: Policy) => (p === "auto" ? "ok" : p === "deny" ? "err" : "warn");

function fmt(ts: number) {
  const d = new Date(ts);
  const one = 86_400_000;
  if (Date.now() - ts < one && new Date().getDate() === d.getDate()) return d.toTimeString().slice(0, 5);
  if (Date.now() - ts < 2 * one) return "昨天";
  if (Date.now() - ts < 7 * one) return ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][Math.max(0, d.getDay() - 1)];
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function Settings() {
  const s = useUi();
  const [loaded, set] = useState<Cfg | null>(null);
  const [draft, setDraft] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void invoke("settings_get").then((hit) => {
      set(hit);
      setDraft(hit);
    });
  }, []);

  const patch = useMemo(() => {
    if (!draft || !loaded) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (!Object.is(loaded[k as keyof Cfg], v)) out[k] = v;
    return out;
  }, [draft, loaded]);

  const dirty = Object.keys(patch).length > 0;

  if (!draft || !loaded) {
    return (
      <div className="settings">
        <div className="set-body">
          <h3>设置</h3>
          <div className="slead">读取 settings_get…</div>
        </div>
      </div>
    );
  }

  const edit = <K extends keyof Cfg>(key: K, value: Cfg[K]) => setDraft((d) => ({ ...d!, [key]: value }));

  const save = () => {
    setSaving(true);
    void invoke("settings_set", { patch })
      .then((hit) => {
        set(hit);
        setDraft(hit);
        actions.toast("设置已保存", `${Object.keys(patch).length} 项写入 settings 表`);
      })
      .catch((err: unknown) => actions.toast("保存失败", String(err)))
      .finally(() => setSaving(false));
  };

  const tab = TABS.some((x) => x.key === s.tab) ? s.tab : "display";

  return (
    <div className="settings">
      <nav className="set-nav">
        {TABS.map((x) => (
          <button key={x.key} className={tab === x.key ? "active" : ""} onClick={() => ui.set({ tab: x.key })}>
            <Icon name={x.icon} cls="sm" />
            {x.label}
          </button>
        ))}
        <div className="sep" />
        <button onClick={() => actions.toast("项目配置", ".kilo/config.json · 待宿主上报")}>
          <Icon name="folder" cls="sm" />
          项目配置
        </button>
        <button onClick={() => actions.toast("全局配置", `${loaded.about.dataDir}/config.json`)}>
          <Icon name="monitor" cls="sm" />
          全局配置
        </button>
        <button onClick={() => actions.openScreen("reload")}>
          <Icon name="refresh" cls="sm" />
          重载 Skills/MCP
        </button>
        <button onClick={() => actions.modal("shortcuts")}>
          <Icon name="keyboard" cls="sm" />
          快捷键
        </button>
      </nav>
      <div className="set-body">
        {tab === "display" && <Display cfg={draft} edit={edit} />}
        {tab === "endpoints" && <Endpoints />}
        {tab === "models" && <Roles cfg={draft} edit={edit} />}
        {tab === "approve" && <Approve cfg={draft} edit={edit} />}
        {tab === "tools" && <Tools cfg={draft} edit={edit} />}
        {tab === "context" && <Context cfg={draft} edit={edit} />}
        {tab === "git" && <Git cfg={draft} edit={edit} />}
        {tab === "files" && <Files cfg={draft} edit={edit} />}
        {tab === "notify" && <Notify cfg={draft} edit={edit} />}
        {tab === "experimental" && <Experimental cfg={draft} edit={edit} />}
        {tab === "about" && <About cfg={loaded} />}
        {dirty && (
          <div className="savebar">
            <span>
              <b>{Object.keys(patch).length}</b> 项未保存
            </span>
            <span className="sp" />
            <button className="btn" onClick={() => setDraft(loaded)}>
              放弃
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存设置"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 控件 ---------------- */

function Row({ n, d, children, disabled }: { n: string; d?: string; children?: React.ReactNode; disabled?: boolean }) {
  return (
    <div className={`srow${disabled ? " disabled" : ""}`}>
      <div className="l">
        <div className="n">{n}</div>
        {d ? <div className="d">{d}</div> : null}
      </div>
      <div className="c">{children}</div>
    </div>
  );
}

function Sw({ on, onSet, dis }: { on: boolean; onSet: (v: boolean) => void; dis?: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className={`switch${on ? " on" : ""}${dis ? " dis" : ""}`}
      onClick={() => {
        if (dis) return;
        onSet(!on);
      }}
    >
      <i />
    </span>
  );
}

function Select<T extends string>({ value, opts, onSet, width }: { value: T; opts: readonly (T | [T, string])[]; onSet: (v: T) => void; width?: number }) {
  return (
    <select className="sel" style={width ? { minWidth: width } : undefined} value={value} onChange={(e) => onSet(e.currentTarget.value as T)}>
      {opts.map((x) => {
        const [v, label] = Array.isArray(x) ? x : [x, x];
        return (
          <option key={v} value={v}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

function Num({ value, onSet, suffix }: { value: number; onSet: (v: number) => void; suffix?: React.ReactNode }) {
  return (
    <>
      <input className="tinp num" type="number" value={value} onChange={(e) => onSet(Number(e.currentTarget.value || 0))} />
      {suffix}
    </>
  );
}

function Tri({ value, onSet }: { value: Policy; onSet: (v: Policy) => void }) {
  return <Select value={value} opts={POLICIES} onSet={onSet} />;
}

function Group({ icon, title, act, children }: { icon: string; title: string; act?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="sgroup">
      <div className="gh">
        <Icon name={icon} cls="sm" />
        {title}
        {act ? <span className="act">{act}</span> : null}
      </div>
      {children}
    </div>
  );
}

type Edit = <K extends keyof Cfg>(key: K, value: Cfg[K]) => void;

/* ---------------- 显示与皮肤 ---------------- */

function Display({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  const [scale, setScale] = useState(skin.scaleNow());
  const [follow, setFollow] = useState(() => {
    try {
      return localStorage.getItem("kilo.follow") !== "0";
    } catch {
      return true;
    }
  });

  const pickSkin = (id: string) => {
    const hit = skin.apply(id);
    if (!hit.ok) {
      actions.toast("皮肤被拒绝", hit.problems?.[0]?.kind === "missing" ? "缺 L2 必需 token · 打开皮肤管理修复" : "加载失败");
      return;
    }
    void invoke("settings_set", { patch: { skin: id } as Partial<Cfg> }).catch((err: unknown) => console.error("skin persist failed", err));
    actions.toast(`皮肤：${hit.name ?? id}`, "只改 L1/L2 令牌 · 不重启 WebView");
  };

  return (
    <>
      <h3>显示与皮肤</h3>
      <div className="slead">皮肤 bundle · 字号滑杆实时生效 · 密度与默认折叠态</div>
      <Group icon="palette" title="皮肤">
        <Row n="当前皮肤" d="内置三套 + 导入 skin.json（extends 继承）">
          <Select value={cfg.skin} opts={skin.list().map((x): [string, string] => [x.id, `${x.name}${x.imported ? " · 导入" : ""}`])} onSet={pickSkin} width={150} />
          <button className="btn sm" onClick={() => actions.modal("skin")}>
            <Icon name="palette" cls="sm" />
            皮肤管理
          </button>
        </Row>
        <Row n="跟随系统主题" d="关闭后固定使用所选皮肤（prefers-color-scheme）">
          <Sw
            on={follow}
            onSet={(v) => {
              setFollow(v);
              try {
                localStorage.setItem("kilo.follow", v ? "1" : "0");
              } catch {
                /* 忽略存储失败 */
              }
              if (v) skin.restore();
            }}
          />
        </Row>
        <Row n="对比度守护" d="正文 ≥4.5:1 · 次要 ≥3:1 · 不达标阻止保存并提示自动提亮">
          <button className="btn sm" onClick={() => actions.modal("skin")}>
            <Icon name="eye" cls="sm" />
            门禁详情
          </button>
        </Row>
      </Group>
      <Group icon="sliders" title="排版">
        <Row n="字号" d="10–24px，作用于所有 --fs-* 令牌；拖动即时预览">
          <input
            className="rng"
            type="range"
            min={10}
            max={24}
            value={scale}
            onInput={(e) => {
              const px = Number(e.currentTarget.value);
              setScale(px);
              skin.setScale(px);
            }}
            onChange={(e) => edit("fontScale", Number(e.currentTarget.value))}
          />
          <span className="mono" style={{ fontSize: 11, color: "var(--text-weak)" }}>
            {scale}px
          </span>
        </Row>
        <Row n="界面密度">
          <Select value={cfg.density} opts={[["comfortable", "标准"], ["compact", "紧凑"]] as const} onSet={(v) => edit("density", v)} />
        </Row>
        <Row n="界面语言">
          <Select value={cfg.lang} opts={[["zh", "简体中文"], ["en", "English"]] as const} onSet={(v) => edit("lang", v)} />
        </Row>
      </Group>
      <Group icon="layout" title="默认布局">
        <Row n="默认折叠左栏" d="新窗口打开时会话列表收起（⌥[ 可随时恢复）">
          <Sw on={cfg.collapseLeft} onSet={(v) => edit("collapseLeft", v)} />
        </Row>
        <Row n="默认折叠右栏" d="专注模式：能力面板收起，状态栏保留入口">
          <Sw on={cfg.collapseRight} onSet={(v) => edit("collapseRight", v)} />
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 模型端点 ---------------- */

function Endpoints() {
  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<ProviderRow[]>([]);

  useEffect(() => {
    setRows(providerCache.list());
  }, [tick]);

  const remove = (row: ProviderRow) => {
    actions.modal("confirm", { title: `删除端点 ${row.name}？`, body: "使用该端点模型的会话保留，但会提示重新选择模型。keychain 引用一并移除。", ok: "删除", danger: "1", drop: row.id });
  };

  return (
    <>
      <h3>模型端点</h3>
      <div className="slead">OpenAI 兼容协议 · 密钥只存系统 keychain 引用，绝不写入配置与日志</div>
      <div className="notice warn">
        <Icon name="alert" cls="sm" />
        <div>协议暂未提供 provider_list：列表来自本机缓存（invoke 成功后回写）。宿主补齐只读命令后改为直连 providers 表。此处模型数与费用均为估算，非实际账单。</div>
      </div>
      <Group
        icon="key"
        title={`已配置（${rows.length}）`}
        act={
          <button className="btn xs primary" onClick={() => actions.modal("endpoint")}>
            <Icon name="plus" cls="sm" />
            添加端点
          </button>
        }
      >
        {rows.length === 0 && (
          <div className="srow">
            <div className="l">
              <div className="n">尚无端点</div>
              <div className="d">填一个 base URL 即可开始；本地 Ollama 可留空密钥</div>
            </div>
            <div className="c">
              <button className="btn sm primary" onClick={() => actions.modal("endpoint")}>
                <Icon name="plus" cls="sm" />
                添加
              </button>
            </div>
          </div>
        )}
        {rows.map((p) => (
          <div className="srow" key={p.id}>
            <div className="l">
              <div className="n">
                {p.name} <span className="badge gray">{p.models.length} 模型</span>
                <span className={`badge ${p.last_check ? "ok" : "gray"}`}>{p.last_check ? "已连通" : "未测"}</span>
              </div>
              <div className="d mono" style={{ fontSize: 11 }}>
                {p.base_url} · key: {p.key_ref ?? (p.has_key ? "keychain" : "留空")}
              </div>
            </div>
            <div className="c">
              <span className="picon" style={{ width: 22, height: 22, fontSize: 10 }}>
                <Icon name="cpu" cls="sm" />
              </span>
              <button className="btn sm" onClick={() => actions.modal("endpoint", { id: p.id })}>
                <Icon name="pencil" cls="sm" />编辑
              </button>
              <button className="btn sm" onClick={() => setTick((n) => n + 1)}>
                <Icon name="refresh" cls="sm" />刷新
              </button>
              <button className="btn sm danger" onClick={() => remove(p)}>
                <Icon name="trash" cls="sm" />
              </button>
            </div>
          </div>
        ))}
      </Group>
      <Group icon="card" title="费用口径">
        <Row n="所有费用均为估算" d="本地按近似 tokenizer 统计，非实际账单；精确金额请在服务商侧核对">
          <span className="badge warn">估算</span>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 角色模型 ---------------- */

function Roles({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  const [roles, setRoles] = useState(roleCache.list());
  const pick = (key: string, value: string) => {
    const next = { ...roles, [key]: value };
    setRoles(next);
    roleCache.set(key, value);
    if (key === "chat") edit("model", value);
  };
  const models = useMemo(() => [...new Set(providerCache.list().flatMap((p) => p.models))], []);
  const opts = useMemo(() => {
    const base = models.length ? models : [cfg.model ?? "deepseek-chat"];
    return [...new Set([...base, ""])] as string[];
  }, [models, cfg.model]);

  const roleRow = (key: string, n: string, d: string) => (
    <Row n={n} d={d}>
      <select className="sel" value={roles[key] ?? ""} onChange={(e) => pick(key, e.currentTarget.value)}>
        <option value="">（未设置）</option>
        {opts.filter(Boolean).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </Row>
  );

  return (
    <>
      <h3>角色模型</h3>
      <div className="slead">对话 / 小模型 / 压缩三角色，外加按模式覆盖；端点在「模型端点」页管理</div>
      <Group icon="layers" title="角色">
        {roleRow("chat", "对话模型", "输入框未显式选择时使用（写回 Settings.model）")}
        {roleRow("small", "小模型", "标题生成 / 摘要 / 提示词增强")}
        {roleRow("compact", "压缩模型", "/compact 生成摘要，默认跟随对话模型")}
      </Group>
      <Group icon="sliders" title="按模式覆盖">
        {MODES.map(([m, d]) => roleRow(`mode:${m}`, `${m.toUpperCase()} 模式模型`, d))}
      </Group>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <div>Settings 协议目前只有单一 model/variant 字段；角色与模式覆盖存于本机缓存，待宿主补齐 settings 键后随 settings_set 落库。</div>
      </div>
    </>
  );
}

/* ---------------- 权限与审批 ---------------- */

function Approve({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  const [scope, setScope] = useState<"global" | "project" | "session" | "mode">("global");
  const [eff, setEff] = useState<Effective[]>([]);
  const [exc, setExc] = useState<Record<string, { matcher: string; policy: Policy }[]>>({});
  const [open, setOpen] = useState<string | null>("bash");
  const [matcher, setMatcher] = useState("");
  const [adding, setAdding] = useState<Policy>("deny");

  useEffect(() => {
    void invoke("permission_effective", { session_id: runtime.state.session ?? "" })
      .then(setEff)
      .catch((err: unknown) => console.error("permission_effective failed", err));
  }, [scope]);

  const hit = (tool: string) => eff.find((x) => x.tool === tool);
  const listFor = (tool: string) => exc[tool] ?? excCache.get(tool, scope);

  const apply = (tool: string, policy: Policy) => {
    void invoke("permission_set", { scope, tool, policy, exceptions: listFor(tool) })
      .then(setEff)
      .catch((err: unknown) => console.error("permission_set failed", err));
  };

  const add = (tool: string) => {
    if (!matcher.trim()) return;
    const next = [...listFor(tool), { matcher: matcher.trim(), policy: adding }];
    setExc({ ...exc, [tool]: next });
    excCache.set(tool, scope, next);
    setMatcher("");
    void invoke("permission_set", { scope, tool, policy: hit(tool)?.policy ?? "require_approval", exceptions: next }).then(setEff);
  };

  const drop = (tool: string, m: string) => {
    const next = listFor(tool).filter((x) => x.matcher !== m);
    setExc({ ...exc, [tool]: next });
    excCache.set(tool, scope, next);
    void invoke("permission_set", { scope, tool, policy: hit(tool)?.policy ?? "require_approval", exceptions: next }).then(setEff);
  };

  return (
    <>
      <h3>权限与审批</h3>
      <div className="slead">三态策略 × 分层作用域（global / project / session / mode），命中最严格者生效；effective 表为宿主解析结果</div>
      <Group icon="compass" title="模式默认策略" act={<button className="btn xs" onClick={() => actions.toast("已恢复模式默认值")}>恢复默认</button>}>
        {MODES.map(([m, d]) => (
          <Row key={m} n={m.toUpperCase()} d={d}>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-weaker)" }}>
              write
            </span>
            <Tri value={m === "code" ? "require_approval" : "deny"} onSet={() => actions.toast("模式默认值由 runtime 固定", "请用下方作用域覆盖")} />
            <span className="mono" style={{ fontSize: 11, color: "var(--text-weaker)" }}>
              bash
            </span>
            <Tri value={m === "code" ? "require_approval" : "deny"} onSet={() => actions.toast("模式默认值由 runtime 固定", "请用下方作用域覆盖")} />
          </Row>
        ))}
      </Group>
      <Group
        icon="shield"
        title="工具策略"
        act={
          <select className="sel" style={{ minWidth: 140 }} value={scope} onChange={(e) => setScope(e.currentTarget.value as typeof scope)}>
            <option value="global">global</option>
            <option value="project">project</option>
            <option value="session">session</option>
            <option value="mode">mode</option>
          </select>
        }
      >
        {TOOLS.map(([tool, desc]) => {
          const cur = hit(tool);
          const ex = listFor(tool);
          return (
            <div key={tool}>
              <div className="perm-rule">
                <div className="pl">
                  <div className="n">
                    <span className="mono">{tool}</span>
                    {cur ? <span className={`badge ${badgeFor(cur.policy)}`}>{cur.from}</span> : <span className="badge gray">待宿主上报</span>}
                  </div>
                  <div className="d">{desc}</div>
                </div>
                <Tri value={cur?.policy ?? "require_approval"} onSet={(v) => apply(tool, v)} />
                <button className="btn xs" onClick={() => setOpen(open === tool ? null : tool)}>
                  <Icon name="plus" cls="sm" />
                  例外
                </button>
              </div>
              {open === tool && (
                <div className="exc">
                  {ex.map((x) => (
                    <div className="er" key={x.matcher}>
                      <span className={`lvl ${x.policy === "auto" ? "allow" : x.policy === "deny" ? "deny" : "ask"}`}>{x.policy}</span>
                      <code>{x.matcher}</code>
                      <span className="lvl" style={{ cursor: "pointer" }} onClick={() => drop(tool, x.matcher)}>
                        <Icon name="trash" cls="sm" />
                      </span>
                    </div>
                  ))}
                  <div className="addrow" style={{ marginTop: 6 }}>
                    <input className="tinp mono" style={{ width: 190 }} placeholder="matcher：git commit * / **/.env / *.corp.com" value={matcher} onChange={(e) => setMatcher(e.currentTarget.value)} />
                    <Tri value={adding} onSet={setAdding} />
                    <button className="btn xs" onClick={() => add(tool)}>
                      <Icon name="plus" cls="sm" />添加
                    </button>
                  </div>
                  <div className="hint" style={{ fontSize: 11, color: "var(--text-weaker)", marginTop: 6 }}>
                    path glob（edit/write）· command 前缀 glob（bash）· host（检索类）
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Group>
      <Group icon="target" title="熔断与守护" act={<button className="btn xs" onClick={() => actions.modal("cost")}>策略</button>}>
        <Row n="会话最大花费（估算）" d="达阈暂停回合并弹审批；仅为估算，非实际账单">
          <Num value={cfg.costCap} onSet={(v) => edit("costCap", v)} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>$</span>} />
        </Row>
        <Row n="最大 Turn 数" d="默认 10；防死循环">
          <Num value={cfg.maxTurns} onSet={(v) => edit("maxTurns", v)} />
        </Row>
        <Row n="重复工具调用检测" d="同工具同参数连续命中即熔断询问">
          <Num value={cfg.repeatBreaker} onSet={(v) => edit("repeatBreaker", v)} />
        </Row>
      </Group>
      <Group icon="lock" title="安全默认">
        <Row n="端点密钥存系统 keychain" d="不写入 db / 配置文件 / 日志">
          <span className="badge ok">强制</span>
        </Row>
        <Row n="无 HTTP 服务、无端口监听" d="前后端只走 Tauri IPC">
          <span className="badge ok">强制</span>
        </Row>
        <Row n="无遥测上报" d="日志仅本地，含脱敏">
          <span className="badge ok">强制</span>
        </Row>
        <Row n="punycode / 同形域名提示" d="审批卡高亮可疑主机">
          <span className="badge ok">强制</span>
        </Row>
      </Group>
      <Group icon="eye" title="Effective 规则（宿主解析 · 只读）">
        <table className="usage-table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>工具</th>
              <th>策略</th>
              <th>命中层</th>
              <th>matcher</th>
            </tr>
          </thead>
          <tbody>
            {eff.map((x) => (
              <tr key={`${x.from}:${x.tool}`}>
                <td>{x.tool}</td>
                <td style={{ color: x.policy === "deny" ? "var(--surface-critical-strong)" : x.policy === "auto" ? "var(--surface-success-strong)" : "var(--surface-warning-strong)" }}>{x.policy}</td>
                <td>{x.from}</td>
                <td className="mono">{x.matcher ?? "—"}</td>
              </tr>
            ))}
            {eff.length === 0 && (
              <tr>
                <td colSpan={4}>permission_effective 无返回 · 待宿主上报</td>
              </tr>
            )}
          </tbody>
        </table>
      </Group>
    </>
  );
}

/* ---------------- 工具 ---------------- */

function Tools({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  const [eff, setEff] = useState<Effective[]>([]);

  useEffect(() => {
    void invoke("permission_effective", { session_id: runtime.state.session ?? "" })
      .then(setEff)
      .catch((err: unknown) => console.error("permission_effective failed", err));
  }, []);

  return (
    <>
      <h3>工具</h3>
      <div className="slead">逐工具策略 + 输出截断阈值 + 沙箱（P1 灰态）</div>
      <Group icon="wrench" title="内置工具策略">
        {TOOLS.map(([tool, desc]) => {
          const cur = eff.find((x) => x.tool === tool);
          return (
            <Row key={tool} n={tool} d={`${desc}${cur ? ` · 命中 ${cur.from}` : ""}`}>
              <Tri value={cur?.policy ?? "require_approval"} onSet={(v) => void invoke("permission_set", { scope: "global", tool, policy: v }).then(setEff)} />
            </Row>
          );
        })}
      </Group>
      <Group icon="sliders" title="输出与截断">
        <Row n="单工具输出上限" d="工具卡内截断" disabled>
          <span className="badge gray">待宿主上报</span>
        </Row>
        <Row n="单文件注入上限 KB" d="超出截断并给出路径引用，避免污染上下文">
          <Num value={cfg.injectLimitKb} onSet={(v) => edit("injectLimitKb", v)} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>KB</span>} />
        </Row>
        <Row n="shell 超时" d="超时即 kill 进程组">
          <Num value={cfg.shellTimeout} onSet={(v) => edit("shellTimeout", v)} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>s</span>} />
        </Row>
      </Group>
      <Group icon="lock" title="沙箱（P1 · 未启用）">
        <Row n="启用命令沙箱" d="macOS sandbox-exec / Linux bubblewrap" disabled>
          <Sw on={cfg.experimentalSandbox} onSet={(v) => edit("experimentalSandbox", v)} dis />
        </Row>
        <Row n="阻断网络" d="默认拒绝出站" disabled>
          <Sw on dis={cfg.experimentalSandbox !== true} onSet={() => actions.toast("沙箱未启用", "P1：随 rpi before_tool_call 落地")} />
        </Row>
        <Row n="允许的主机" d="host:port 白名单" disabled>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-weaker)" }}>
            待宿主上报
          </span>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 上下文 ---------------- */

function Context({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  return (
    <>
      <h3>上下文</h3>
      <div className="slead">压缩策略 · 注入预算 · watcher 忽略模式</div>
      <Group icon="archive" title="压缩">
        <Row n="自动压缩" d="接近上限时生成摘要分割线">
          <Sw on={cfg.autoCompactAt > 0} onSet={(v) => edit("autoCompactAt", v ? 0.85 : 0)} />
        </Row>
        <Row n="触发阈值 %" d="0–100；达到后压缩历史">
          <Num value={Math.round(cfg.autoCompactAt * 100)} onSet={(v) => edit("autoCompactAt", Math.min(1, Math.max(0, v / 100)))} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>%</span>} />
        </Row>
      </Group>
      <Group icon="card" title="注入预算">
        <Row n="文件内容注入上限 KB" d="单文件加入上下文的最大体积">
          <Num value={cfg.injectLimitKb} onSet={(v) => edit("injectLimitKb", v)} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>KB</span>} />
        </Row>
      </Group>
      <Group icon="filter" title="文件监听">
        <Row n="忽略模式" d="逗号分隔；watcher 与文件树都不扫描">
          <input className="tinp mono" style={{ width: 320 }} value={cfg.ignorePatterns} onChange={(e) => edit("ignorePatterns", e.currentTarget.value)} />
        </Row>
      </Group>
    </>
  );
}

/* ---------------- Git 与检查点 ---------------- */

function Git({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  return (
    <>
      <h3>Git 与检查点</h3>
      <div className="slead">系统 git CLI 后端 · 独立 checkpoint 仓库，不碰用户 HEAD / index / reflog</div>
      <Group icon="branch" title="Git">
        <Row n="后端" d="libgit2 未编译以控体积；缺失时提示安装">
          <Select value={cfg.gitBackend} opts={[["cli", "系统 git CLI"], ["none", "禁用"]]} onSet={(v) => edit("gitBackend", v)} />
        </Row>
        <Row n="提交策略" d="写类操作默认强制审批">
          <Tri value={cfg.commitPolicy} onSet={(v) => edit("commitPolicy", v)} />
        </Row>
        <Row n="推送策略">
          <Tri value={cfg.pushPolicy} onSet={(v) => edit("pushPolicy", v)} />
        </Row>
      </Group>
      <Group icon="history" title="检查点 / Revert">
        <Row n="启用文件检查点" d="写类工具执行前打快照，Revert 只恢复文件">
          <Sw on={cfg.snapshotKeep > 0} onSet={(v) => edit("snapshotKeep", v ? 200 : 0)} />
        </Row>
        <Row n="快照保留数量" d="超出即清理最旧快照">
          <Num value={cfg.snapshotKeep} onSet={(v) => edit("snapshotKeep", v)} />
        </Row>
        <Row n="checkpoint 仓库" d="独立 git-dir">
          <span className="mono" style={{ fontSize: 11 }}>
            {cfg.about.dataDir}/ckpt
          </span>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 文件与附件 ---------------- */

function Files({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  return (
    <>
      <h3>文件与附件</h3>
      <div className="slead">扫描预算 · 忽略规则 · 附件缓存与上限</div>
      <Group icon="folder" title="扫描预算">
        <Row n="扫描文件数上限" d="超出即停止并提示">
          <Num value={cfg.scanFiles} onSet={(v) => edit("scanFiles", v)} />
        </Row>
        <Row n="扫描深度" d="目录递归上限">
          <Num value={cfg.scanDepth} onSet={(v) => edit("scanDepth", v)} />
        </Row>
      </Group>
      <Group icon="image" title="附件">
        <Row n="单附件体积上限 MB" d="图片 Base64 直传视觉模型，不入库">
          <Num value={cfg.attachMaxMb} onSet={(v) => edit("attachMaxMb", v)} suffix={<span className="mono" style={{ color: "var(--text-weaker)" }}>MB</span>} />
        </Row>
        <Row n="附件缓存目录">
          <span className="mono" style={{ fontSize: 11 }}>
            {cfg.about.dataDir}/attachments
          </span>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 通知 ---------------- */

function Notify({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  return (
    <>
      <h3>通知</h3>
      <div className="slead">系统通知触发条件 · 提示音 · 静默时段</div>
      <Group icon="bell" title="触发条件">
        <Row n="回合完成时" d="窗口未聚焦才发">
          <Sw on={cfg.notifyTurnEnd} onSet={(v) => edit("notifyTurnEnd", v)} />
        </Row>
        <Row n="需要审批时" d="含 MCP / 子任务发起">
          <Sw on={cfg.notifyApproval} onSet={(v) => edit("notifyApproval", v)} />
        </Row>
        <Row n="任务异常终止" d="panic / 工具失败">
          <Sw on={cfg.notifyError} onSet={(v) => edit("notifyError", v)} />
        </Row>
        <Row n="提示音">
          <Sw on={cfg.notifySound} onSet={(v) => edit("notifySound", v)} />
        </Row>
        <Row n="静默时段" d="HH:MM-HH:MM，跨午夜支持">
          <input className="tinp mono" style={{ width: 150 }} value={cfg.quietHours} onChange={(e) => edit("quietHours", e.currentTarget.value)} />
        </Row>
        <Row n="发送测试通知" d="立即弹一条系统通知卡（含命令片段）">
          <button className="btn sm" onClick={() => ui.set({ popover: "notif" })}>
            发送
          </button>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 实验性 ---------------- */

function Experimental({ cfg, edit }: { cfg: Cfg; edit: Edit }) {
  return (
    <>
      <h3>实验性</h3>
      <div className="slead">未稳定能力，默认关闭；开启后可能增加包体积或不完整可用</div>
      <Group icon="sparkle" title="特性开关">
        <Row n="内嵌终端（xterm feature）" d="会增加包体积，默认不打包">
          <Sw on={cfg.experimentalTerminal} onSet={(v) => edit("experimentalTerminal", v)} />
        </Row>
        <Row n="语义代码索引" d="embedding + 向量库">
          <Sw on={cfg.experimentalIndex} onSet={(v) => edit("experimentalIndex", v)} />
        </Row>
        <Row n="命令沙箱（Seatbelt / bubblewrap）" d="P1">
          <Sw on={cfg.experimentalSandbox} onSet={(v) => edit("experimentalSandbox", v)} />
        </Row>
        <Row n="多代理编排" d="Agent Manager 前身" disabled>
          <span className="badge gray">待宿主上报</span>
        </Row>
        <Row n="行内补全 Ghost text" d="依赖编辑器语义，桌面受限" disabled>
          <span className="badge gray">不实现</span>
        </Row>
      </Group>
    </>
  );
}

/* ---------------- 关于与诊断 ---------------- */

function About({ cfg }: { cfg: Cfg }) {
  return (
    <>
      <h3>关于与诊断</h3>
      <div className="slead">版本 · runtime 状态 · 数据路径 · 导入导出</div>
      <Group icon="info" title="运行时">
        <Row n="版本" d={`kilo-desktop ${cfg.about.app} · ${cfg.about.runtime} · schema ${cfg.about.schema}`}>
          <button className="btn sm" onClick={() => actions.toast("已复制版本信息")}>
            <Icon name="copy" cls="sm" />复制
          </button>
        </Row>
        <Row n="Agent Runtime" d="同进程 · Tokio · 无端口无鉴权">
          <button className="btn sm" onClick={() => actions.modal("runtime")}>
            <Icon name="cpu" cls="sm" />诊断
          </button>
        </Row>
        <Row n="数据目录" d="SQLite（WAL）· 附件缓存 · checkpoint 仓库">
          <span className="mono" style={{ fontSize: 11 }}>
            {cfg.about.dataDir}
          </span>
        </Row>
        <Row n="体积门禁" d="release 产物 ≤15MB（CI + cargo bloat 归因）">
          <span className="badge gray">待宿主上报</span>
        </Row>
      </Group>
      <Group icon="download" title="导入导出">
        <Row n="导出设置" d="JSON（不含 keychain 密钥）">
          <button className="btn sm" onClick={() => actions.toast("已导出 settings.json", "密钥仅引用")}>
            导出…
          </button>
        </Row>
        <Row n="皮肤管理" d="导入 skin.json · 对比度门禁 · 自动提亮">
          <button className="btn sm" onClick={() => actions.modal("skin")}>
            打开
          </button>
        </Row>
        <Row n="检查更新" d="签名校验 + 安装并重启">
          <button className="btn sm" onClick={() => actions.modal("update")}>
            <Icon name="upload" cls="sm" />检查更新
          </button>
        </Row>
        <Row n="屏目索引" d={`全部 ${SCREENS.length} 屏 · ⌘⇧S`}>
          <button className="btn sm" onClick={() => ui.set({ screenmap: true })}>
            打开
          </button>
        </Row>
        <Row n="重置全部设置" d="危险操作" disabled>
          <span className="badge gray">待宿主上报</span>
        </Row>
      </Group>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <div>会话最近活动：{(() => {
          const hit = runtime.state.sessions.at(0);
          return hit ? fmt(hit.updated_at) : "暂无会话";
        })()}</div>
      </div>
    </>
  );
}
