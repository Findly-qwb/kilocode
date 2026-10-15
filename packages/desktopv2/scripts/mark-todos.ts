/**
 * 用逐屏验证结果回写 TODOS.md 的任务状态，让「done」是证据而不是自述。
 *
 * 规则（前端证据只能证明前端，所以按「层」收窄判定）：
 *   层=FE      ：挂的屏全通过 → done；部分通过 → wip；否则 todo。
 *   层=FE+Rust ：屏全通过也只记 wip —— 浏览器跑的是 mock 宿主，证不了 Rust 侧。
 *   层=Rust / 不挂屏的基建任务 / S0 尖峰项：脚本不动，人工判定。
 *
 * 跑法：bun scripts/mark-todos.ts verification.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("用法：bun scripts/mark-todos.ts <verification.json>");

const { passed, failed } = JSON.parse(await readFile(resolve(file), "utf8")) as { passed: string[]; failed: string[] };
const ok = new Set(passed);
const bad = new Set(failed);

const md = await readFile(resolve(import.meta.dir, "../TODOS.md"), "utf8");
const tally = { done: 0, wip: 0, todo: 0, kept: 0 };

const out = md
  .split("\n")
  .map((line) => {
    if (!line.startsWith("|")) return line;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7 || cells[0] === "id" || /^-+$/.test(cells[0])) return line;
    const [id, , screens, , layer] = cells;
    const list = screens.split(/\s+/).filter((s) => s && s !== "—");
    if (!list.length || id.startsWith("S0") || layer === "Rust") {
      tally.kept++;
      return line;
    }
    const hit = list.filter((s) => ok.has(s));
    const miss = list.filter((s) => bad.has(s));
    const all = hit.length === list.length && !miss.length;
    const next = all ? (layer === "FE" ? "done" : "wip") : hit.length ? "wip" : "todo";
    tally[next]++;
    const patched = [...cells];
    patched[patched.length - 1] = next;
    return `| ${patched.join(" | ")} |`;
  })
  .join("\n");

await writeFile(resolve(import.meta.dir, "../TODOS.md"), out.endsWith("\n") ? out : out + "\n", "utf8");
console.log(`回写：done=${tally.done} wip=${tally.wip} todo=${tally.todo} · 未动（Rust/基建/S0）=${tally.kept}`);
