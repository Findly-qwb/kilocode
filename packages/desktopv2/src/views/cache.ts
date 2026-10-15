/**
 * 前端侧的补充缓存（localStorage）。
 *
 * 协议里目前没有 provider_list / 角色模型 / 例外 matcher 的读取命令，Rust 侧补齐
 * （src-tauri store.rs）前应把这里当作只读投影；所有写操作仍先走 invoke，
 * 这里只保存 UI 需要回显的补充字段（key_ref、models 拉取结果、按模式覆盖等）。
 */
import type { Policy, ProviderRow } from "../ipc/protocol";

const KEY = {
  providers: "kilo.settings.providers",
  exceptions: "kilo.settings.exceptions",
  roles: "kilo.settings.roles",
};

type Store = { providers: ProviderRow[]; exceptions: Record<string, { matcher: string; policy: Policy }[]>; roles: Record<string, string> };

type Row = Partial<ProviderRow> & { id: string };

function read<T>(key: string, fallback: T): T {
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? "") as T;
    return hit ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / file:// 写不了本地存储；本次会话内仍可用 */
  }
}

export const providerCache = {
  list(): ProviderRow[] {
    return read<Store["providers"]>(KEY.providers, []);
  },
  touch(hit: Row) {
    const rows = providerCache.list();
    const i = rows.findIndex((x) => x.id === hit.id);
    if (i < 0) {
      write(KEY.providers, [
        ...rows,
        { id: hit.id, name: hit.name ?? "端点", base_url: hit.base_url ?? "", models: hit.models ?? [], has_key: hit.has_key ?? false, key_ref: hit.key_ref, last_check: Date.now() } as ProviderRow,
      ]);
      return;
    }
    rows[i] = { ...rows[i]!, ...hit, last_check: Date.now() };
    write(KEY.providers, rows);
  },
  drop(id: string) {
    write(
      KEY.providers,
      providerCache.list().filter((x) => x.id !== id),
    );
  },
};

export const excCache = {
  list(): Store["exceptions"] {
    return read<Store["exceptions"]>(KEY.exceptions, {});
  },
  set(tool: string, scope: string, list: { matcher: string; policy: Policy }[]) {
    const all = excCache.list();
    all[`${scope}:${tool}`] = list;
    write(KEY.exceptions, all);
  },
  get(tool: string, scope: string) {
    return excCache.list()[`${scope}:${tool}`] ?? [];
  },
};

export const roleCache = {
  list(): Store["roles"] {
    return read<Store["roles"]>(KEY.roles, {});
  },
  set(key: string, value: string) {
    const all = roleCache.list();
    all[key] = value;
    write(KEY.roles, all);
  },
};
