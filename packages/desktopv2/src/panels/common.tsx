/** 面板共享件：项目上下文 / 按项目记忆（localStorage，不扩 ui store）/ 设置缓存。 */
import { useEffect, useState } from "react";
import { invoke } from "../ipc/bridge";
import type { ProjectRow, Settings } from "../ipc/protocol";
import { ui, type Panel } from "../ui/state";
import { t } from "../i18n";

export type Mem = { panel: Panel; right: boolean };

const PKEY = "kilo.panel.project";
const MKEY = "kilo.panel.mem";

function all(): Record<string, Mem> {
  try {
    return JSON.parse(localStorage.getItem(MKEY) ?? "{}") as Record<string, Mem>;
  } catch (err) {
    // 记忆损坏：清掉重来，同时留一条可见的提示而非静默吞掉
    localStorage.removeItem(MKEY);
    ui.set({ toast: { title: t("common.cfgFail"), body: String(err) } });
    return {};
  }
}

export const memory = {
  load(p: string): Mem | undefined {
    return p ? all()[p] : undefined;
  },
  save(p: string, m: Mem) {
    if (!p) return;
    const map = all();
    map[p] = m;
    localStorage.setItem(MKEY, JSON.stringify(map));
  },
};

let current = localStorage.getItem(PKEY) ?? "";

/** 当前项目（fs/git/terminal 类命令都按项目寻址）。 */
export function useProject() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [name, setName] = useState(current);

  useEffect(() => {
    void invoke("project_list")
      .then((list) => {
        setRows(list);
        const hit = list.some((r) => r.name === current) ? current : list.at(0)?.name ?? "";
        if (hit && hit !== current) {
          current = hit;
          localStorage.setItem(PKEY, current);
          setName(current);
        }
      })
      .catch((err) => ui.set({ toast: { title: t("common.cfgFail"), body: String(err) } }));
  }, []);

  /** 显式切换项目：折叠态与子视图按项目记忆恢复 */
  const choose = (next: string) => {
    if (!next || next === current) return;
    current = next;
    localStorage.setItem(PKEY, next);
    setName(next);
    const hit = memory.load(next);
    if (hit) ui.set({ panel: hit.panel, right: hit.right });
  };

  return { name, rows, choose };
}

export function useSettings() {
  const [cfg, setC] = useState<Settings | undefined>(undefined);
  useEffect(() => {
    void invoke("settings_get")
      .then(setC)
      .catch((err) => ui.set({ toast: { title: t("common.cfgFail"), body: String(err) } }));
  }, []);
  return cfg;
}

export const bytes = (n?: number) => {
  if (n === undefined) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

export const fail = (title: string, err: unknown) => ui.set({ toast: { title, body: String(err) } });
