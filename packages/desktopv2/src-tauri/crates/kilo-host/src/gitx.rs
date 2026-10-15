//! Git channel one: the *user's* repository (PLAN §7.1, §7.2; TODOS M6-6).
//!
//! Deliberately the system `git` CLI and not `git2`/libgit2 (PLAN §7.1): libgit2 brings a
//! native build graph and its own index/ref semantics, both of which we would have to
//! re-derive to be sure we never touch the user's state. The CLI's `--porcelain=v2` and
//! `-z` are documented-stable machine formats, so parsing is auditable and testable on
//! fixtures.
//!
//! Every call goes through `crate::proc`, so git children are registered and bounded like
//! any other subprocess. When git is absent (Windows without it) callers get
//! `HostError::GitMissing` and the UI degrades to checkpoint-only rollback (PLAN §14).
//!
//! Mutating the user's repo is *never* automatic: `commit`/`push` are gated by the
//! permission engine as `Class::GitMutate` (PLAN §7.2), so this module presumes a human
//! has already approved.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::error::{HostError, Result};
use crate::ipc;
use crate::proc::{self, Registry};

/// Git is a fast local command; anything slower than this is a pathology worth killing.
pub const GIT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
	/// The two-char `XY` status field, verbatim (`"M "`, `"??"`, `"R "`…).
	pub status: String,
	pub path: String,
	/// Source path for rename/copy entries.
	pub origin: Option<String>,
	pub staged: bool,
	pub unstaged: bool,
	pub untracked: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Status {
	pub branch: Option<String>,
	pub oid: Option<String>,
	pub upstream: Option<String>,
	pub ahead: i64,
	pub behind: i64,
	pub files: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hunk {
	pub header: String,
	pub old_start: i64,
	pub old_lines: i64,
	pub new_start: i64,
	pub new_lines: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DiffFile {
	pub path: String,
	pub old_path: Option<String>,
	pub binary: bool,
	pub added: i64,
	pub deleted: i64,
	pub hunks: Vec<Hunk>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Diff {
	pub files: Vec<DiffFile>,
	/// Raw text, because the review panel renders the patch, not our reconstruction.
	pub text: String,
}

impl Diff {
	pub fn added(&self) -> i64 {
		self.files.iter().map(|f| f.added).sum()
	}

	pub fn deleted(&self) -> i64 {
		self.files.iter().map(|f| f.deleted).sum()
	}
}

pub struct Git {
	root: PathBuf,
	reg: Registry,
	cancel: CancellationToken,
}

impl Git {
	pub fn new(root: impl Into<PathBuf>, reg: Registry) -> Git {
		Git { root: root.into(), reg, cancel: CancellationToken::new() }
	}

	pub fn root(&self) -> &Path {
		&self.root
	}

	pub fn cancel(&self) -> &CancellationToken {
		&self.cancel
	}

	/// Probe once per process; every panel asks whether to render at all.
	pub fn available() -> bool {
		static OK: OnceLock<bool> = OnceLock::new();
		*OK.get_or_init(|| {
			std::process::Command::new("git")
				.arg("--version")
				.stdout(std::process::Stdio::null())
				.stderr(std::process::Stdio::null())
				.status()
				.map(|s| s.success())
				.unwrap_or(false)
		})
	}

	async fn git(&self, args: &[String]) -> Result<String> {
		if !Git::available() {
			return Err(HostError::GitMissing);
		}
		let argv: Vec<OsString> = args.iter().map(OsString::from).collect();
		let out = proc::run(&self.reg, OsStr::new("git"), &argv, Some(&self.root), GIT_TIMEOUT, self.cancel.clone()).await?;
		if out.timed_out {
			return Err(HostError::TimedOut { secs: GIT_TIMEOUT.as_secs() });
		}
		if !out.ok() {
			return Err(HostError::Git {
				args: args.clone(),
				code: out.code,
				stderr: crate::secret::redact(out.stderr.trim()),
			});
		}
		Ok(out.stdout)
	}

	/// Convenience: turn `&["status", "-z"]` into owned args at one place.
	async fn run(&self, args: &[&str]) -> Result<String> {
		self.git(&args.iter().map(|s| s.to_string()).collect::<Vec<String>>()).await
	}

	async fn paths(&self, head: &[&str], paths: &[String]) -> Result<String> {
		let mut args: Vec<String> = head.iter().map(|s| s.to_string()).collect();
		args.push("--".into());
		args.extend(paths.iter().cloned());
		self.git(&args).await
	}

	/// `git status --porcelain=v2 --branch -z`.
	pub async fn status(&self) -> Result<Status> {
		let raw = self.run(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]).await?;
		Ok(parse_status_v2(&raw))
	}

	/// `git status -z` — the v1 NUL format. PLAN §7.1 names it explicitly, and older
	/// binaries emit it, so both parsers ship.
	pub async fn status_v1(&self) -> Result<Status> {
		let raw = self.run(&["status", "-z", "--untracked-files=all"]).await?;
		Ok(parse_status_v1(&raw))
	}

	/// Status joined with `diff --numstat` line counts, keyed by path, so
	/// `git_status_changed.files[].added|deleted` is measured rather than guessed.
	/// Untracked files are absent from `diff HEAD` and report zero.
	pub async fn status_counts(&self, status: &Status) -> Result<Vec<ipc::GitFile>> {
		let raw = self.git(&["diff".into(), "--numstat".into(), "HEAD".into(), "--".into()]).await?;
		let counts = parse_numstat(&raw);
		Ok(status
			.files
			.iter()
			.map(|entry| {
				let hit = counts.iter().find(|c| c.path == entry.path);
				ipc::GitFile {
					path: entry.path.clone(),
					status: entry.status.clone(),
					added: hit.map(|c| c.added).unwrap_or(0),
					deleted: hit.map(|c| c.deleted).unwrap_or(0),
				}
			})
			.collect())
	}

	/// `git diff --no-color` over optional paths (staged when `staged`).
	pub async fn diff(&self, paths: &[String], staged: bool) -> Result<Diff> {
		let mut head: Vec<&str> = vec!["diff", "--no-color"];
		if staged {
			head.push("--cached");
		}
		let text = if paths.is_empty() { self.run(&head).await? } else { self.paths(&head, paths).await? };
		Ok(parse_diff(&text))
	}

	/// Stage. `git add --` never touches the worktree.
	pub async fn stage(&self, paths: &[String]) -> Result<()> {
		self.paths(&["add"], paths).await?;
		Ok(())
	}

	/// Unstage without discarding worktree edits (`restore --staged`, git >= 2.23).
	pub async fn unstage(&self, paths: &[String]) -> Result<()> {
		self.paths(&["restore", "--staged"], paths).await?;
		Ok(())
	}

	/// Commit with the current index. `--no-verify` is intentional: hooks belong to the
	/// user's own CLI workflow, and a hook prompt cannot be answered over our IPC.
	pub async fn commit(&self, message: &str) -> Result<String> {
		let args = vec!["commit".to_string(), "--no-verify".into(), "-m".into(), message.to_string()];
		self.git(&args).await
	}

	pub async fn stage_all(&self) -> Result<()> {
		self.run(&["add", "-A"]).await?;
		Ok(())
	}

	/// Push the current branch to `origin`, creating the tracking ref on first push.
	pub async fn push(&self) -> Result<String> {
		let branch = self.status().await?.branch.ok_or_else(|| HostError::Git {
			args: vec!["push".into()],
			code: None,
			stderr: "detached HEAD: nothing to push".into(),
		})?;
		self.git(&["push".into(), "--set-upstream".into(), "origin".into(), branch]).await
	}

	/// Input for the AI commit message (PLAN §9.2 `git_generate_message`): the host
	/// supplies the staged patch, the runtime writes the message.
	pub async fn staged_patch(&self) -> Result<String> {
		self.run(&["diff", "--cached", "--no-color"]).await
	}

	pub async fn branch_name(&self) -> Result<Option<String>> {
		Ok(self.status().await?.branch)
	}

	/// Cheap worktree test used when opening a workspace (TODOS M0-18 → `projects.is_git`).
	pub fn is_repo(path: &Path) -> bool {
		path.join(".git").exists()
	}
}

/* ------------------------------- parsers ------------------------------- */

/// `git status --porcelain=v2 --branch -z`.
///
/// Headers: `# branch.oid …`, `# branch.head …`, `# branch.upstream …`, `# branch.ab +A -B`.
/// Entries are 9 space-separated fields, NUL terminated; a `2` (rename/copy) entry is
/// followed by one extra NUL-terminated source path.
pub fn parse_status_v2(raw: &str) -> Status {
	let mut out = Status::default();
	let mut records = raw.split('\0').filter(|s| !s.is_empty());
	while let Some(chunk) = records.next() {
		if let Some(header) = chunk.strip_prefix("# ") {
			apply_header(&mut out, header);
			continue;
		}
		let parts: Vec<&str> = chunk.splitn(9, ' ').collect();
		if parts.len() < 9 {
			eprintln!("kilo-host gitx: malformed porcelain v2 record `{chunk}`");
			continue;
		}
		let (kind, xy, path) = (parts[0], parts[1], parts[8]);
		let entry = match kind {
			"1" => Entry {
				status: xy.into(),
				path: path.into(),
				origin: None,
				staged: index_dirty(xy),
				unstaged: worktree_dirty(xy),
				untracked: false,
			},
			"2" => Entry {
				status: xy.into(),
				path: path.into(),
				origin: Some(records.next().unwrap_or_default().into()),
				staged: index_dirty(xy),
				unstaged: worktree_dirty(xy),
				untracked: false,
			},
			"u" => Entry {
				status: xy.into(),
				path: path.into(),
				origin: None,
				staged: true,
				unstaged: true,
				untracked: false,
			},
			"?" => Entry {
				status: "??".into(),
				path: path.into(),
				origin: None,
				staged: false,
				unstaged: true,
				untracked: true,
			},
			other => {
				eprintln!("kilo-host gitx: unknown porcelain kind `{other}` for `{path}`");
				continue;
			}
		};
		out.files.push(entry);
	}
	out
}

fn apply_header(out: &mut Status, header: &str) {
	let mut kv = header.splitn(2, ' ');
	let key = kv.next().unwrap_or_default();
	let value = kv.next().unwrap_or_default();
	match key {
		"branch.oid" => out.oid = Some(value.into()),
		// git writes `# branch.head (detached)` when HEAD is detached; that is not a name.
		"branch.head" => out.branch = if value == "(detached)" { None } else { Some(value.into()) },
		"branch.upstream" => out.upstream = Some(value.into()),
		"branch.ab" => {
			for tok in value.split(' ') {
				if let Some(n) = tok.strip_prefix('+') {
					out.ahead = n.parse().unwrap_or_default();
				}
				if let Some(n) = tok.strip_prefix('-') {
					out.behind = n.parse().unwrap_or_default();
				}
			}
		}
		other => {
			eprintln!("kilo-host gitx: unhandled status header `{other}`");
		}
	}
}

/// `X` — index differs from HEAD.
pub fn index_dirty(xy: &str) -> bool {
	xy.chars().next().is_some_and(|c| c != '.')
}

/// `Y` — worktree differs from the index.
pub fn worktree_dirty(xy: &str) -> bool {
	xy.chars().nth(1).is_some_and(|c| c != '.')
}

/// `git status -z` (porcelain v1): `XY path\0`, renames as `XY new\0old`.
pub fn parse_status_v1(raw: &str) -> Status {
	let mut out = Status::default();
	let mut records = raw.split('\0').filter(|s| !s.is_empty());
	while let Some(chunk) = records.next() {
		// v1 is always two status chars + one space + path.
		if !chunk.is_char_boundary(3) || chunk.len() < 4 {
			eprintln!("kilo-host gitx: malformed porcelain v1 record `{chunk}`");
			continue;
		}
		let xy = chunk[..2].to_string();
		let path = chunk[3..].to_string();
		let rename = xy.starts_with('R') || xy.starts_with('C');
		let origin = if rename { Some(records.next().unwrap_or_default().to_string()) } else { None };
		out.files.push(Entry {
			status: xy.clone(),
			path,
			origin,
			staged: index_dirty(&xy),
			unstaged: worktree_dirty(&xy),
			untracked: xy.starts_with('?'),
		});
	}
	out
}

/// `git diff --numstat`: `<added>\t<deleted>\t<path>`; binary rows are `-\t-\t<path>`.
pub fn parse_numstat(raw: &str) -> Vec<ipc::GitFile> {
	let mut out = Vec::new();
	for line in raw.lines() {
		let mut cols = line.splitn(3, '\t');
		let (Some(added), Some(deleted), Some(path)) = (cols.next(), cols.next(), cols.next()) else {
			continue;
		};
		out.push(ipc::GitFile {
			path: expand_numstat_path(path),
			status: String::new(),
			// `-` marks a binary file: zero lines changed, still a change.
			added: added.parse().unwrap_or_default(),
			deleted: deleted.parse().unwrap_or_default(),
		});
	}
	out
}

/// numstat renames arrive as `old => new`, `{a => b}` or quoted; normalise to the new path.
pub fn expand_numstat_path(raw: &str) -> String {
	let path = unquote(raw);
	// `dir/{old => new}/file` — the braces sit inside the path.
	if let Some((prefix, rest)) = path.split_once('{') {
		if let Some((middle, suffix)) = rest.split_once('}') {
			if let Some((_, new)) = middle.split_once("=>") {
				return format!("{}{}{}", prefix, new.trim_start(), suffix);
			}
		}
	}
	if let Some((_, new)) = path.rsplit_once(" => ") {
		return new.to_string();
	}
	path
}

fn unquote(raw: &str) -> String {
	let trimmed = raw.trim();
	if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
		return trimmed[1..trimmed.len() - 1].replace("\\\"", "\"");
	}
	trimmed.to_string()
}

/// `git diff --no-color` -> per-file hunks.
pub fn parse_diff(raw: &str) -> Diff {
	let mut files: Vec<DiffFile> = Vec::new();
	for block in raw.split("diff --git ").filter(|b| !b.trim().is_empty()) {
		let body = format!("diff --git {block}");
		let header = block.lines().next().unwrap_or_default();
		let mut old_path = None;
		let mut path = String::new();
		// `a/old b/new`; paths may contain spaces, so split on the ` b/` marker that git
		// always inserts between the two halves.
		if let Some(pair) = header.split_once(" b/") {
			old_path = pair.0.strip_prefix("a/").map(str::to_string);
			path = pair.1.to_string();
		} else {
			path = header.strip_prefix("a/").unwrap_or(header).to_string();
		}
		files.push(DiffFile {
			path: unquote(&path),
			old_path: old_path.as_deref().map(unquote),
			binary: body.lines().any(|l| l.starts_with("Binary files")),
			added: body.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count() as i64,
			deleted: body.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count() as i64,
			hunks: body.lines().filter_map(parse_hunk).collect(),
		});
	}
	Diff { files, text: raw.to_string() }
}

/// `@@ -1,4 +5,2 @@ heading`
pub fn parse_hunk(line: &str) -> Option<Hunk> {
	let inner = line.strip_prefix("@@ ")?;
	let (range, header) = inner.split_once(" @@").unwrap_or((inner, ""));
	let (old, new) = range.split_once(' ')?;
	let (old_start, old_lines) = parse_range(old.strip_prefix('-')?)?;
	let (new_start, new_lines) = parse_range(new.strip_prefix('+')?)?;
	Some(Hunk { header: header.to_string(), old_start, old_lines, new_start, new_lines })
}

fn parse_range(raw: &str) -> Option<(i64, i64)> {
	// `@@ -N +M @@` (a one-line range omits `,count`, which means 1)
	match raw.split_once(',') {
		Some((start, lines)) => Some((start.parse().ok()?, lines.parse().ok()?)),
		None => Some((raw.parse().ok()?, 1)),
	}
}
