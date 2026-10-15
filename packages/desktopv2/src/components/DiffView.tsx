/**
 * diff 视图（工具卡 / 审批卡共用）。
 * 只用 base.css 现成 class：.diff .add/.del/.ctx/.hh/.gh + .gn 行号槽 + .stat ±统计。
 */
import { Icon, actions } from "../App";

type Line = { t: string; k: string; n: string };

const head = /^(diff |index |--- |\+\+\+ |new file|deleted file)/;

export function lines(diff: string): Line[] {
  let old = 0;
  let neu = 0;
  return diff.replace(/\n+$/, "").split("\n").map((l) => {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
    if (h) {
      old = Number(h[1]);
      neu = Number(h[2]);
      return { t: l, k: "hh", n: "" };
    }
    if (head.test(l)) return { t: l, k: "gh", n: "" };
    if (l.startsWith("+")) return { t: l, k: "add", n: String(neu++) };
    if (l.startsWith("-")) return { t: l, k: "del", n: String(old++) };
    return { t: l, k: "ctx", n: String(old++) };
  });
}

export function tally(diff: string) {
  let added = 0;
  let deleted = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) added += 1;
    if (l.startsWith("-")) deleted += 1;
  }
  return { added, deleted };
}

/** ±统计（放在工具卡 .tstat 里） */
export function Stat({ added = 0, deleted = 0 }: { added?: number; deleted?: number }) {
  if (!added && !deleted) return null;
  return (
    <span className="stat">
      {added > 0 && <span className="a">+{added}</span>}
      {deleted > 0 && <span className="d">−{deleted}</span>}
    </span>
  );
}

/** 「在审查面板查看」跳转 */
export function ReviewLink() {
  return (
    <button className="btn xs" title="在审查面板查看完整 diff" onClick={() => actions.panel("review")}>
      <Icon name="eye" cls="sm" />审查面板
    </button>
  );
}

export function DiffView({
  diff,
  files,
  patch,
}: {
  diff?: string;
  files?: string[];
  patch?: string;
}) {
  const rows = lines(diff ?? patch ?? "");
  return (
    <>
      {files?.map((f) => (
        <div className="grow" key={f}>
          <Icon name="file" cls="sm" />
          <span style={{ flex: 1 }}>{f}</span>
          <button className="btn xs" title="在审查面板还原该文件（走 checkpoint）" onClick={() => actions.panel("review")}>
            <Icon name="redo" cls="sm" />还原
          </button>
        </div>
      ))}
      {rows.length > 0 && (
        <div className="diff">
          {rows.map((l, i) => (
            <span className={l.k} key={i}>
              <span className="gn">{l.n}</span>
              {l.t}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
