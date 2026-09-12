import type { PermissionAction, PermissionConfig, PermissionObjectConfig, PermissionRuleConfig } from "@kilocode/sdk/v2/types"

export type PermKey =
  | "read" | "edit" | "glob" | "grep" | "list" | "bash" | "task" | "external_directory"
  | "lsp" | "doom_loop" | "skill" | "question" | "webfetch" | "websearch" | "todowrite" | "agent_manager"

export function permMap(cfg?: PermissionConfig): Record<string, PermissionRuleConfig | undefined> {
  if (!cfg || typeof cfg === "string") return cfg ? { "*": cfg } : {}
  return cfg as Record<string, PermissionRuleConfig | undefined>
}

// 级别 = "*" 默认项；例外 = 其余 pattern→action
export function permLevel(cfg: PermissionConfig | undefined, tool: PermKey): PermissionAction {
  const r = permMap(cfg)[tool]
  if (!r) return "allow"
  if (typeof r === "string") return r
  return r["*"] ?? Object.values(r)[0] ?? "allow"
}

export function permPatterns(cfg: PermissionConfig | undefined, tool: PermKey): { pattern: string; action: PermissionAction }[] {
  const r = permMap(cfg)[tool]
  if (!r || typeof r === "string") return []
  return Object.entries(r)
    .filter(([p]) => p !== "*")
    .map(([pattern, action]) => ({ pattern, action }))
}

export function withLevel(base: PermissionConfig | undefined, tool: PermKey, action: PermissionAction): PermissionConfig {
  const cur = permMap(base)[tool]
  const next: PermissionObjectConfig = {}
  if (cur && typeof cur === "object") {
    for (const [p, a] of Object.entries(cur)) if (p !== "*" && a !== action) next[p] = a
  }
  if (Object.keys(next).length) next["*"] = action
  return { ...permMap(base), [tool]: Object.keys(next).length ? next : action }
}

export function withPattern(base: PermissionConfig | undefined, tool: PermKey, pattern: string, action: PermissionAction): PermissionConfig {
  const cur = permMap(base)[tool]
  const map: PermissionObjectConfig = typeof cur === "object" && cur ? { ...cur } : { "*": typeof cur === "string" ? cur : "allow" }
  map[pattern] = action
  return { ...permMap(base), [tool]: map }
}

export function withoutPattern(base: PermissionConfig | undefined, tool: PermKey, pattern: string): PermissionConfig {
  const cur = permMap(base)[tool]
  if (!cur || typeof cur === "string") return base ?? {}
  const map: PermissionObjectConfig = {}
  for (const [p, a] of Object.entries(cur)) if (p !== pattern) map[p] = a
  return { ...permMap(base), [tool]: Object.keys(map).length ? map : "allow" }
}
