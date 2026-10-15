/**
 * 皮肤 bundle 规范的单元测试（PLAN §4 的四条规则：extends、完整度、对比度、回落）。
 * 跑法：bun test src/skins
 * 说明：这里只测纯逻辑（注册表解析与校验）；实际注入 CSS 变量与切换需 DOM，交给浏览器逐屏验证。
 */
import { describe, expect, test } from "bun:test";
import { GATE, brighten, check, ratio, repair } from "./contrast";
import { DEFAULT_SKIN, adopt, list, resolve, seed, validate } from "./loader";
import { builtin } from "./builtin";

const full = { ...builtin[0].tokens };

const mk = (id: string, over: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  mode: "dark",
  tokens: { ...full, ...over },
  ...extra,
});

describe("extends 继承与回落", () => {
  test("子皮肤缺 token 时取父值，自定义 token 子优先", () => {
    adopt(JSON.stringify(mk("parent-a", { "--accent": "#ff0000" })));
    const child = { ...full } as Record<string, string>;
    delete child["--accent"]; // 子皮肤不提供 --accent → 回落父值
    child["--surface-base"] = "#000000";
    adopt(JSON.stringify({ ...mk("child-a"), extends: "parent-a", tokens: child }));
    const hit = resolve("child-a");
    expect(hit.bad).toBeUndefined();
    expect(hit.bundle?.tokens["--surface-base"]).toBe("#000000");
    expect(hit.bundle?.tokens["--accent"]).toBe("#ff0000");
    expect(hit.chain).toEqual(["parent-a", "child-a"]);
  });

  test("父皮肤不存在时判定不合法", () => {
    const r = adopt(JSON.stringify({ ...mk("orphan"), extends: "nope" }));
    expect(r.ok).toBe(false);
  });

  test("继承链成环被检测", () => {
    seed({ ...mk("loop-1"), extends: "loop-2" });
    seed({ ...mk("loop-2"), extends: "loop-1" });
    expect(resolve("loop-1").bad?.kind).toBe("cycle");
  });
});

describe("完整度校验", () => {
  test("内置三套皮肤都完整", () => {
    for (const b of builtin) {
      const problems = validate(b).filter((p) => p.kind !== "contrast");
      expect(problems).toEqual([]);
    }
  });

  test("缺 L2 必需 token 即拒绝加载", () => {
    const broken = { ...mk("broken"), tokens: { ...full } };
    delete (broken.tokens as Record<string, string>)["--surface-base"];
    delete (broken.tokens as Record<string, string>)["--text-strong"];
    const r = adopt(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    const problems = validate({ ...broken, id: "broken2" });
    const missing = problems.find((p) => p.kind === "missing");
    expect(missing?.kind === "missing" && missing.tokens).toContain("--surface-base");
  });

  test("非法 JSON 与缺字段不入库", () => {
    expect(adopt("{").ok).toBe(false);
    expect(adopt(JSON.stringify({ id: "x" })).ok).toBe(false);
    expect(list().some((s) => s.id === "x")).toBe(false);
  });
});

describe("对比度门禁", () => {
  test("内置皮肤全部过门禁", () => {
    for (const b of builtin) expect(check(b.tokens)).toEqual([]);
  });

  test("低对比度前景被标记", () => {
    const bad = { ...full, "--surface-base": "#11161e", "--text-weak": "#1a1f28" };
    const fails = check(bad);
    expect(fails.length).toBeGreaterThan(0);
    expect(fails.some((f) => f.key === "--text-weak")).toBe(true);
  });

  test("自动提亮后达标", () => {
    const bg = "#11161e";
    const fixed = brighten("#2b3340", bg, 4.5);
    expect(ratio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test("repair 只动不达标的 token", () => {
    const bad = { ...full, "--text-weak": "#1a1f28" };
    const patch = repair(bad);
    expect(patch["--text-weak"]).toBeDefined();
    expect(patch["--accent"]).toBeUndefined();
    expect(check({ ...bad, ...patch })).toEqual([]);
  });

  test("阈值就是 PLAN §4 的 4.5 / 3 / 2.2", () => {
    expect(GATE.map((g) => g.min)).toEqual([4.5, 3, 2.2]);
  });

  test("默认皮肤是 graphite-dark", () => {
    expect(DEFAULT_SKIN).toBe("graphite-dark");
  });
});
