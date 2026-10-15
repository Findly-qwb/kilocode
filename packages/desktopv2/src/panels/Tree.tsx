/** 文件树：fs_tree 懒加载 + .gitignore 标记 + 勾选进上下文 + 扫描进度（可取消）+ 预览子视图。 */
import { useEffect, useState, type MouseEvent } from "react";
import { Icon } from "../App";
import { invoke } from "../ipc/bridge";
import { runtime } from "../ipc/runtime";
import type { FsNode } from "../ipc/protocol";
import { ui, useUi } from "../ui/state";
import { t } from "../i18n";
import { bytes, fail, useProject, useSettings } from "./common";

type Menu = { node: FsNode; x: number; y: number };
type Prev = { node: FsNode; data?: { text?: string; image?: string; truncated: boolean; bytes: number }; err?: string };

type RowProps = {
  node: FsNode;
  depth: number;
  sel: boolean;
  hot: boolean;
  opened: boolean;
  onAct: () => void;
  onCheck: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onPeek: (e: MouseEvent<HTMLButtonElement>) => void;
};

function TRow({ node, depth, sel, hot, opened, onAct, onCheck, onEnter, onLeave, onMenu, onPeek }: RowProps) {
  return (
    <div className={`n${sel ? " sel" : ""}`} style={{ paddingLeft: 6 + depth * 13 }} onClick={onAct} onMouseEnter={onEnter} onMouseLeave={onLeave} onContextMenu={onMenu}>
      {!node.dir && <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={onCheck} style={{ width: 13, height: 13, flex: "none" }} />}
      {node.dir ? <Icon name={opened ? "chevron-down" : "chevron-right"} cls="sm" /> : <span className="tw" />}
      <Icon name={node.dir ? "folder" : "file"} cls="sm" />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", opacity: node.ignored ? 0.5 : 1 }}>{node.name}</span>
      {node.ignored && <span className="badge gray">{t("tree.ignored")}</span>}
      {!node.dir && node.size !== undefined && (
        <span className="mono" style={{ fontSize: "var(--fs-10)", color: "var(--text-weaker)" }}>
          {bytes(node.size)}
        </span>
      )}
      <button className="iconbtn sm" style={{ visibility: hot ? "visible" : "hidden" }} title={t("tree.preview")} onClick={onPeek}>
        <Icon name="dots" cls="sm" />
      </button>
    </div>
  );
}

export function Tree() {
  const s = useUi();
  const cfg = useSettings();
  const { name, rows, choose } = useProject();
  const [kids, setKids] = useState<Record<string, FsNode[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [load, setLoad] = useState(false);
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FsNode[] | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState("");
  const [prev, setPrev] = useState<Prev | null>(null);

  const scan = runtime.state.scan;

  const fetchDir = (path: string) => {
    if (!name) return;
    setLoad(true);
    void invoke("fs_tree", { project: name, path: path || undefined })
      .then((list) =>
        setKids((k) => ({
          ...k,
          [path]: [...list].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)),
        })),
      )
      .catch((err) => fail(t("tree.loadFail"), err))
      .finally(() => setLoad(false));
  };

  useEffect(() => {
    if (!name) return;
    setKids({});
    setOpen({});
    setHits(null);
    setPrev(null);
    fetchDir("");
  }, [name]);

  const fold = (node: FsNode) => {
    if (open[node.path]) {
      setOpen({ ...open, [node.path]: false });
      return;
    }
    setOpen({ ...open, [node.path]: true });
    if (!kids[node.path]) fetchDir(node.path);
  };

  const toggle = (path: string) => {
    const has = s.picked.includes(path);
    ui.set({ picked: has ? s.picked.filter((p) => p !== path) : [...s.picked, path] });
  };

  const preview = (node: FsNode) => {
    setMenu(null);
    setPrev({ node });
    void invoke("fs_preview", { path: node.path })
      .then((data) => setPrev({ node, data }))
      .catch((err) => setPrev({ node, err: String(err) }));
  };

  const search = (text: string) => {
    setQ(text);
    if (!text.trim()) {
      setHits(null);
      return;
    }
    void invoke("fs_search", { project: name, query: text })
      .then(setHits)
      .catch((err) => fail(t("tree.searchFail"), err));
  };

  const scanRun = (cancel = false) => {
    void invoke("fs_scan", { project: name, cancel })
      .then(() => {
        if (cancel) ui.set({ toast: { title: t("tree.cancelHint") } });
      })
      .catch((err) => fail(t("tree.scanFail"), err));
  };

  const copy = (path: string) => {
    setMenu(null);
    void navigator.clipboard
      .writeText(path)
      .then(() => ui.set({ toast: { title: t("tree.copied") } }))
      .catch((err) => fail(t("tree.copyFail"), err));
  };

  const rowsFlat: { node: FsNode; depth: number }[] = [];
  const walk = (path: string, depth: number) => {
    for (const node of kids[path] ?? []) {
      rowsFlat.push({ node, depth });
      if (node.dir && open[node.path]) walk(node.path, depth + 1);
    }
  };
  walk("", 0);

  const list: { node: FsNode; depth: number }[] = hits ? hits.map((node) => ({ node, depth: 0 })) : rowsFlat;

  const pct = scan && scan.total > 0 ? Math.min(100, Math.round((scan.scanned / scan.total) * 100)) : 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <select className="sel" style={{ minWidth: 0, flex: 1 }} value={name} title={t("tree.pickProject")} onChange={(e) => choose(e.target.value)}>
          {(rows.length ? rows : [{ id: name, path: name, name, is_git: false }]).map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="iconbtn sm" title={t("tree.reload")} onClick={() => fetchDir("")}>
          <Icon name="refresh" cls="sm" />
        </button>
        <button className="iconbtn sm" title={t("tree.scanBtn")} onClick={() => scanRun(false)}>
          <Icon name="search" cls="sm" />
        </button>
        <button className={`iconbtn sm${finding ? " on" : ""}`} title={t("tree.search")} onClick={() => setFinding(!finding)}>
          <Icon name="filter" cls="sm" />
        </button>
      </div>

      {finding && (
        <input
          className="sel"
          style={{ width: "100%", marginBottom: 8 }}
          placeholder={t("tree.searchPh")}
          value={q}
          autoFocus
          onChange={(e) => search(e.target.value)}
        />
      )}

      {scan && scan.phase !== "done" && (
        <div className="ucard" style={{ padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="badge run">{t("tree.scan")}</span>
            <span className="mono" style={{ flex: 1, fontSize: "var(--fs-10)", color: "var(--text-weaker)" }}>
              {scan.scanned}/{scan.total} · {t(`tree.phase.${scan.phase}`)}
            </span>
            <button className="btn xs" onClick={() => scanRun(true)}>
              {t("common.cancel")}
            </button>
          </div>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {scan && scan.phase === "done" && (
        <div className="mono" style={{ fontSize: "var(--fs-10)", color: "var(--text-weaker)", marginBottom: 6 }}>
          {t("tree.scanDone", { n: scan.scanned })}{" "}
          <button className="btn xs" onClick={() => scanRun(false)}>
            {t("common.rerun")}
          </button>
        </div>
      )}

      <div className="tree">
        {load && !hits && (
          <div className="n">
            <Icon name="clock" cls="sm" />
            {t("tree.loading")}
          </div>
        )}
        {hits && hits.length === 0 && <div className="n">{t("tree.noHits")}</div>}
        {!hits && !load && list.length === 0 && <div className="n">{t("tree.empty")}</div>}
        {list.map(({ node, depth }) => (
          <TRow
            key={node.path}
            node={node}
            depth={depth}
            sel={s.picked.includes(node.path)}
            hot={hover === node.path}
            opened={!!open[node.path]}
            onAct={() => (node.dir ? fold(node) : preview(node))}
            onCheck={() => toggle(node.path)}
            onEnter={() => setHover(node.path)}
            onLeave={() => setHover((h) => (h === node.path ? "" : h))}
            onMenu={(e) => {
              e.preventDefault();
              setMenu({ node, x: e.clientX, y: e.clientY });
            }}
            onPeek={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ node, x: r.left, y: r.bottom + 2 });
            }}
          />
        ))}
      </div>

      {prev && (
        <div className="fileview">
          <div className="fvh">
            <Icon name={prev.data?.image ? "image" : "file"} cls="sm" />
            <b>{prev.node.name}</b>
            <span className="mono" style={{ marginLeft: "auto", fontSize: "var(--fs-10)", color: "var(--text-weaker)" }}>
              {prev.data ? t("tree.meta", { bytes: bytes(prev.data.bytes) }) : t("tree.loading")}
            </span>
            <button className="btn xs" onClick={() => setPrev(null)}>
              <Icon name="x" cls="sm" />
              {t("common.close")}
            </button>
          </div>
          {prev.err && (
            <div className="notice err" style={{ margin: 0, borderRadius: 0 }}>
              <Icon name="alert" cls="sm" />
              <div>{t("tree.previewFail")}：{prev.err}</div>
            </div>
          )}
          {prev.data?.image && (
            <img src={prev.data.image} alt={prev.node.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />
          )}
          {prev.data?.text !== undefined && <pre>{prev.data.text}</pre>}
          {prev.data?.truncated && (
            <div className="notice warn" style={{ margin: 0, borderRadius: 0 }}>
              <Icon name="alert-circle" cls="sm" />
              <div>{t("tree.truncated", { bytes: bytes(prev.data.bytes) })}</div>
            </div>
          )}
        </div>
      )}

      <div className="notice info" style={{ marginTop: 10 }}>
        <Icon name="info" cls="sm" />
        <div>{t("tree.ctxNote", { kb: `${cfg?.injectLimitKb ?? 256} KB`, n: s.picked.length })}</div>
      </div>

      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="ucard"
            style={{
              position: "fixed",
              left: Math.min(menu.x, window.innerWidth - 180),
              top: Math.min(menu.y, window.innerHeight - 120),
              zIndex: 41,
              margin: 0,
              padding: 6,
              minWidth: 160,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {!menu.node.dir && (
              <button className="btn xs" style={{ justifyContent: "flex-start" }} onClick={() => preview(menu.node)}>
                <Icon name="eye" cls="sm" />
                {t("tree.preview")}
              </button>
            )}
            {!menu.node.dir && (
              <button
                className="btn xs"
                style={{ justifyContent: "flex-start" }}
                onClick={() => {
                  toggle(menu.node.path);
                  setMenu(null);
                }}
              >
                <Icon name={s.picked.includes(menu.node.path) ? "x" : "plus"} cls="sm" />
                {s.picked.includes(menu.node.path) ? t("tree.drop") : t("tree.add")}
              </button>
            )}
            <button className="btn xs" style={{ justifyContent: "flex-start" }} onClick={() => copy(menu.node.path)}>
              <Icon name="copy" cls="sm" />
              {t("tree.copy")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
