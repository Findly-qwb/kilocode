/**
 * 清单与屏目的一致性校验（TODOS.md 的唯一机读门禁）。
 *
 * 校验三件事：
 *   1. TODOS.md 每条任务都有 PLAN 章节 / 验收方式 / 合法状态（屏目对基建类任务可选）；
 *   2. screen-inventory.json 里原型实测的 78 屏，每屏至少被一条任务覆盖，且任务不得引用不存在的屏；
 *   3. 应用内的屏目注册表 src/screens.ts 与原型清单完全一致（多一屏少一屏都算失败）。
 *
 * 跑法：bun run todos:check
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SCREENS } from "../src/screens";

const root = resolve(import.meta.dir, "..");
const OK = new Set(["todo", "wip", "done", "blocked"]);
const problems: string[] = [];

type Task = { id: string; screens: string[]; plan: string; verify: string; status: string };
const tasks: Task[] = [];

const md = await readFile(resolve(root, "TODOS.md"), "utf8");
for (const line of md.split("\n")) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length < 6) continue;
  if (cells[0] === "id" || /^-+$/.test(cells[0])) continue;
  const [id, , screens, plan, , verify, status] = cells;
  const row: Task = {
    id,
    screens: screens.split(/\s+/).filter((s) => s && s !== "—"),
    plan,
    verify,
    status,
  };
  if (!row.plan || row.plan === "—") problems.push(`${row.id}：缺 PLAN 章节`);
  if (!row.verify || row.verify.length < 6) problems.push(`${row.id}：验收方式太弱`);
  if (!OK.has(row.status)) problems.push(`${row.id}：状态 "${row.status}" 非法（${[...OK].join("/")}）`);
  tasks.push(row);
}

const inv = JSON.parse(await readFile(resolve(root, "screen-inventory.json"), "utf8")) as {
  total: number;
  screens: { id: string }[];
};
const covered = new Set(tasks.flatMap((t) => t.screens));
const never = inv.screens.map((s) => s.id).filter((id) => !covered.has(id));
if (never.length) problems.push(`以下原型屏没有任何任务覆盖：${never.join(", ")}`);

const bogus = [...covered].filter((id) => !inv.screens.some((s) => s.id === id) && id !== "—");
if (bogus.length) problems.push(`任务引用了原型里不存在的屏：${bogus.join(", ")}`);

const app = SCREENS.map((s) => s.id);
const missingInApp = inv.screens.map((s) => s.id).filter((id) => !app.includes(id));
const extraInApp = app.filter((id) => !inv.screens.some((s) => s.id === id));
if (missingInApp.length) problems.push(`src/screens.ts 缺屏：${missingInApp.join(", ")}`);
if (extraInApp.length) problems.push(`src/screens.ts 多出不存在的屏：${extraInApp.join(", ")}`);
if (SCREENS.length !== inv.total) problems.push(`屏数不一致：screens.ts=${SCREENS.length} 原型清单=${inv.total}`);

const dist = tasks.reduce<Record<string, number>>((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {});
console.log(
  `任务 ${tasks.length} 条 · 覆盖屏 ${covered.size}/${inv.total} · 状态分布 ${Object.entries(dist)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`,
);

if (problems.length) {
  console.error(`\n校验失败 ${problems.length} 项：`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("TODOS 清单与原型屏目一致 ✓");
