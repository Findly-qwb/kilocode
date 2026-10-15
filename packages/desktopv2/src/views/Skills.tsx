/**
 * Skills 页（M5）：斜杠命令列表 + 新建/编辑弹层（modal id "skill"）+ 启停 / 删除 / 重载。
 * 纯文本注入，不引入外部进程；数据走 skill_list / skill_upsert / skill_toggle / skill_delete。
 */
import { useEffect, useState } from "react";
import { Icon, actions } from "../App";
import { invoke } from "../ipc/bridge";
import type { SkillRow } from "../ipc/protocol";
import { ui } from "../ui/state";

const badgeOf = (scope: string) => (scope === "global" ? "brand" : scope === "builtin" ? "purple" : "ok");

export function Skills() {
  const [rows, setRows] = useState<SkillRow[]>([]);

  const reload = () => {
    void invoke("skill_list", {})
      .then(setRows)
      .catch((err: unknown) => console.error("skill_list failed", err));
  };

  useEffect(reload, []);

  const toggle = (row: SkillRow) => {
    void invoke("skill_toggle", { id: row.id, enabled: !row.enabled }).then(reload);
  };

  const run = (row: SkillRow) => {
    ui.set({ draft: `/${row.command.replace(/^\//, "")} `, view: "chat" });
    actions.toast("已填入输入框", `/${row.command.replace(/^\//, "")}`);
  };

  const counts = (scope: string) => rows.filter((r) => r.scope === scope).length;

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2>Skills</h2>
        <span className="lead" style={{ margin: 0 }}>
          自定义斜杠命令 · 纯文本注入，不引入外部进程
        </span>
        <button className="btn primary" style={{ marginLeft: "auto" }} onClick={() => actions.modal("skill")}>
          <Icon name="plus" cls="sm" />
          新建 Skill
        </button>
      </div>
      <div className="lead" style={{ marginTop: 8 }}>
        输入 <code className="mono">/</code> 即触发补全；改动后需 <code className="mono">/reload</code> 生效
      </div>
      <div className="sgroup">
        <div className="gh">
          <Icon name="slash" cls="sm" />
          已加载（{rows.length}）
          <span className="act">
            <button className="btn xs" onClick={reload}>
              <Icon name="refresh" cls="sm" />
              重载
            </button>
          </span>
        </div>
        {rows.length === 0 && (
          <div className="srow">
            <div className="l">
              <div className="n">尚无 Skill</div>
              <div className="d">新建后由 skill_list 返回；builtin 作用域来自安装包</div>
            </div>
          </div>
        )}
        {rows.map((r) => (
          <div className={`srow${r.enabled ? "" : " disabled"}`} key={r.id}>
            <div className="l">
              <div className="n">
                <span className="mono">/{r.command.replace(/^\//, "")}</span> {r.name ?? ""} <span className={`badge ${badgeOf(r.scope)}`}>{r.scope}</span>
              </div>
              <div className="d">
                {r.description ?? "无描述"} · <span className="mono">{r.path ?? "（内置）"}</span>
              </div>
            </div>
            <div className="c">
              <span className={`switch sm${r.enabled ? " on" : ""}`} onClick={() => toggle(r)}>
                <i />
              </span>
              <button className="btn sm" onClick={() => actions.modal("skill", { id: r.id })}>
                <Icon name="pencil" cls="sm" />
                编辑
              </button>
              <button className="btn sm" onClick={() => run(r)}>
                <Icon name="play" cls="sm" />
                运行
              </button>
              <button className="btn sm danger" onClick={() => actions.modal("confirm", { title: `删除 /${r.command}？`, body: "仅移除记录；磁盘上的 .md 源文件保留，可自行归档。", ok: "删除", danger: "1", drop: `skill:${r.id}` })}>
                <Icon name="trash" cls="sm" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="sgroup">
        <div className="gh">
          <Icon name="folder" cls="sm" />
          扫描目录
        </div>
        {[
          ["project", ".kilo/commands/*.md"],
          ["global", "~/.config/kilo-desktop/skills/*.md"],
          ["builtin", "安装包内置"],
        ].map(([scope, path]) => (
          <div className="srow" key={scope}>
            <div className="l">
              <div className="n">{scope}</div>
              <div className="d mono">{path}</div>
            </div>
            <div className="c">
              <span className="badge gray">{counts(scope)} 项</span>
            </div>
          </div>
        ))}
      </div>
      <div className="notice info">
        <Icon name="info" cls="sm" />
        <div>
          Skill 支持 <code className="mono">{"{{参数|默认值}}"}</code> 占位与模型/变体覆盖；不做市场与远程拉取（本地优先）。
        </div>
      </div>
    </div>
  );
}
