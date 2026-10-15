import amber from "./nocturne-amber/skin.json";
import graphite from "./graphite-dark/skin.json";
import paper from "./paper-light/skin.json";
import type { Bundle } from "./types";

/** 内置三套（PLAN §4）。值由 scripts/extract-skins.ts 从已验证原型抽取，勿手改。 */
export const builtin: Bundle[] = [graphite as unknown as Bundle, paper as unknown as Bundle, amber as unknown as Bundle];
