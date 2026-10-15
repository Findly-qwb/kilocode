//! Git channel two: the checkpoint shadow repository (PLAN §7.2; TODOS M6-7).
//!
//! Revert/Redo must be able to rewind *agent* writes without ever pretending to be the
//! user's VCS. So the snapshot repo is fully separated:
//!
//! ```text
//! --git-dir   ~/.local/share/kilo-desktop/ckpt/<repo-hash>   (our bare repo)
//! --work-tree <project directory>                             (the user's files)
//! ```
//!
//! The invariants, all covered by `tests/checkpoint.rs`:
//!   * every git command passes `--git-dir=<shadow>` explicitly, so the user's repository
//!     is never the repo being written to;
//!   * the index is a fresh scratch file (`GIT_INDEX_FILE=<shadow>/kilo-index.<n>`) per
//!     snapshot, so we cannot corrupt the user's index *or* our own previous one;
//!   * history is written with `commit-tree` + `update-ref refs/kilo/ckpt`; the user's
//!     `HEAD`, branch refs, reflog and stash are outside the shadow gitdir and stay
//!     untouched;
//!   * restore uses `git restore --source=<oid> -- <paths>` rather than the PLAN's
//!     `git checkout <ckpt> -- <paths>`, because `checkout` also rewrites the index and
//!     "never touch the index" outranks the wording in §7.2. Worktree result is identical.
//!   * `.gitignore` is honoured by `add -A`, so `node_modules` never enters a snapshot.
//!
//! Snapshots are taken *before* a write-class tool runs (PLAN §6.2 step 6), which is what
//! makes the previous snapshot the revert target.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::error::{HostError, Result};
use crate::ipc;
use crate::proc::{self, Registry};
use crate::secret;

/// Ref the chain hangs off, inside the shadow repo only.
pub const REF: &str = "refs/kilo/ckpt";

/// PLAN §10: cache dir for attachments and checkpoint repos.
pub const APP: &str = "kilo-desktop";

#[derive(Debug, Clone)]
pub struct Checkpoint {
	shadow: PathBuf,
	work: PathBuf,
	reg: Registry,
	cancel: CancellationToken,
	seq: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

/// Where checkpoint repos live. Overridable so tests never touch a real `$HOME`, and so
/// the settings page can show the true path (TODOS M6-14).
pub fn root() -> PathBuf {
	if let Ok(over) = std::env::var("KILO_DESKTOP_DATA") {
		return PathBuf::from(over).join("ckpt");
	}
	#[cfg(windows)]
	let base = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
	#[cfg(not(windows))]
	let base = std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
	base.join(".local").join("share").join(APP).join("ckpt")
}

/// Stable directory key for a project: sha256 of the canonical path. Canonicalising means
/// two symlinks to the same tree share one snapshot repo; a missing path is still hashable
/// so the UI can offer "snapshot anyway" during a rename race.
pub fn hash_of(path: &Path) -> String {
	let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
	let mut hasher = Sha256::new();
	hasher.update(canonical.to_string_lossy().as_bytes());
	let digest = hasher.finalize();
	digest.iter().take(10).map(|b| format!("{b:02x}")).collect()
}

impl Checkpoint {
	/// Prepare (init if needed) the shadow repo for `work`.
	pub fn open(work: &Path, data_root: Option<&Path>) -> Result<Checkpoint> {
		if !crate::gitx::Git::available() {
			return Err(HostError::GitMissing);
		}
		let base = data_root.map(PathBuf::from).unwrap_or_else(root);
		let shadow = base.join(hash_of(work));
		std::fs::create_dir_all(&shadow)
			.map_err(|source| HostError::Io { path: shadow.display().to_string(), source })?;
		let work = work.canonicalize().unwrap_or_else(|_| work.to_path_buf());
		let ckpt = Checkpoint {
			shadow,
			work,
			reg: Registry::new(),
			cancel: CancellationToken::new(),
			seq: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
		};
		if !ckpt.shadow.join("HEAD").exists() {
			ckpt.init_bare()?;
		}
		Ok(ckpt)
	}

	pub fn shadow(&self) -> &Path {
		&self.shadow
	}

	pub fn work(&self) -> &Path {
		&self.work
	}

	pub fn registry(&self) -> &Registry {
		&self.reg
	}

	pub fn cancel(&self) -> &CancellationToken {
		&self.cancel
	}

	/// One snapshot of the whole work tree. Returns the commit oid to store in
	/// `file_snapshots.ckpt_oid`.
	pub async fn snapshot(&self, message: &str) -> Result<String> {
		let message = secret::redact(message);
		let index = self.scratch_index()?;
		let index_path = index.display().to_string();
		let (gitdir, workdir) = (self.gitdir(), self.workdir());
		let env = [("GIT_INDEX_FILE", index_path.as_str())];
		// `add -A` from a *scratch* index means the tree is exactly the current worktree,
		// with .gitignore applied and nothing carried over from the previous snapshot.
		self.git_env(&["-c", "core.bare=false", "--git-dir", &gitdir, "--work-tree", &workdir, "add", "-A", "--"], &env)
			.await?;
		let tree = self.git_env(&["--git-dir", &gitdir, "write-tree"], &env).await?.trim().to_string();
		let parent = self.tip().await?;
		let mut args: Vec<String> = vec![
			"--git-dir".into(),
			gitdir.clone(),
			"-c".into(),
			"user.name=kilo-desktop".into(),
			"-c".into(),
			"user.email=ckpt@kilo-desktop.local".into(),
			"commit-tree".into(),
			tree,
		];
		if let Some(p) = &parent {
			args.push("-p".into());
			args.push(p.clone());
		}
		args.extend(["-m".into(), message]);
		let commit = self.git_env_raw(&args, &[]).await?.trim().to_string();
		self.git_env(&["--git-dir", &gitdir, "update-ref", REF, &commit], &[]).await?;
		// The scratch index has done its job; leaving it behind would slowly fill the repo dir.
		tokio::fs::remove_file(&index).await.map_err(|err| HostError::Store(format!("scratch index cleanup: {err}")))?;
		Ok(commit)
	}

	/// Files this snapshot changes relative to its parent — the Revert confirmation dialog
	/// needs the ± stats before the user commits to it (PLAN §7.2).
	pub async fn changes(&self, oid: &str) -> Result<Vec<ipc::GitFile>> {
		let parent = match self.parent(oid).await? {
			Some(p) => p,
			// The first snapshot has no parent: everything in it counts as added.
			None => {
				let listing = self.git_env(&["--git-dir", &self.gitdir(), "ls-tree", "-r", "--name-only", oid], &[]).await?;
				return Ok(listing
					.lines()
					.map(|path| ipc::GitFile { path: path.to_string(), status: "A".into(), added: 0, deleted: 0 })
					.collect());
			}
		};
		let raw = self
			.git_env(&["--git-dir", &self.gitdir(), "diff", "--numstat", &parent, oid], &[])
			.await?;
		Ok(crate::gitx::parse_numstat(&raw)
			.into_iter()
			.map(|mut f| {
				f.status = "M".into();
				f
			})
			.collect())
	}

	/// Restore `paths` from a snapshot. Worktree only — the user's index is never written.
	pub async fn restore(&self, oid: &str, paths: &[String]) -> Result<()> {
		if paths.is_empty() {
			return Err(HostError::Invalid("restore needs at least one path".into()));
		}
		let mut args: Vec<String> = vec![
			"-c".into(),
			"core.bare=false".into(),
			"--git-dir".into(),
			self.gitdir(),
			"--work-tree".into(),
			self.workdir(),
			"restore".into(),
			format!("--source={oid}"),
			"--".into(),
		];
		args.extend(paths.iter().cloned());
		self.git_env_raw(&args, &[]).await?;
		Ok(())
	}

	/// Current chain tip, if any.
	pub async fn tip(&self) -> Result<Option<String>> {
		self.probe(&["--git-dir", &self.gitdir(), "rev-parse", REF]).await
	}

	/// Chain walk for the Redo banner. `log` is newest-first, so the child of `oid` is the
	/// entry immediately *before* it.
	pub async fn child_of(&self, oid: &str) -> Result<Option<String>> {
		let chain = self.log().await?;
		let hit = chain.iter().position(|(id, _)| id == oid);
		let Some(at) = hit else {
			return Ok(None);
		};
		Ok(at.checked_sub(1).and_then(|i| chain.get(i)).map(|(id, _)| id.clone()))
	}

	/// Parent commit of `oid`; `None` for the first snapshot in the chain.
	pub async fn parent(&self, oid: &str) -> Result<Option<String>> {
		self.probe(&["--git-dir", &self.gitdir(), "rev-parse", &format!("{oid}^")]).await
	}

	/// `oid, subject` newest-first, for diagnostics (TODOS M0-17).
	pub async fn log(&self) -> Result<Vec<(String, String)>> {
		let raw = self.git_env(&["--git-dir", &self.gitdir(), "log", "--format=%H %s", REF], &[]).await?;
		Ok(raw
			.lines()
			.filter_map(|line| {
				let mut halves = line.splitn(2, ' ');
				Some((halves.next()?.to_string(), halves.next().unwrap_or_default().to_string()))
			})
			.collect())
	}

	/// Prune the chain to the newest `keep` snapshots (TODOS M6-11: snapshot retention).
	/// `keep == 0` clears the ref.
	pub async fn prune(&self, keep: usize) -> Result<usize> {
		let chain = self.log().await?;
		if chain.len() <= keep {
			return Ok(0);
		}
		let dropped = chain.len() - keep;
		match chain.get(keep - 1) {
			Some(tail) => {
				// Re-point at the oldest snapshot we keep, then let gc collect the rest.
				self.git_env(&["--git-dir", &self.gitdir(), "update-ref", REF, &tail.0], &[]).await?;
				self.git_env(&["--git-dir", &self.gitdir(), "gc", "--prune=now", "--quiet"], &[]).await?;
			}
			None => {
				self.git_env(&["--git-dir", &self.gitdir(), "update-ref", "-d", REF], &[]).await?;
			}
		}
		Ok(dropped)
	}

	/* ----------------------------- plumbing ----------------------------- */

	fn gitdir(&self) -> String {
		self.shadow.display().to_string()
	}

	fn workdir(&self) -> String {
		self.work.display().to_string()
	}

	/// Unique per snapshot, so a crash mid-`add` cannot leave a half-written index that
	/// the next snapshot silently inherits.
	fn scratch_index(&self) -> Result<PathBuf> {
		let n = self.seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
		Ok(self.shadow.join(format!("kilo-index.{}", std::process::id() * 1000 + n)))
	}

	/// Create the shadow repo. Synchronous because `open` must have finished it before any
	/// snapshot is attempted, and it is the only command run without `--git-dir`.
	fn init_bare(&self) -> Result<()> {
		let out = std::process::Command::new("git")
			.args(["init", "--bare", "--quiet"])
			.arg(&self.shadow)
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::piped())
			.output()
			.map_err(|source| HostError::Io { path: "git init".into(), source })?;
		if out.status.success() {
			return Ok(());
		}
		Err(HostError::Git {
			args: vec!["init".into(), "--bare".into(), self.shadow.display().to_string()],
			code: out.status.code(),
			stderr: String::from_utf8_lossy(&out.stderr).to_string(),
		})
	}

	async fn git_env(&self, args: &[&str], env: &[(&str, &str)]) -> Result<String> {
		let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
		self.git_env_raw(&owned, env).await
	}

	async fn git_env_raw(&self, args: &[String], env: &[(&str, &str)]) -> Result<String> {
		let out = self.run(args, env).await?;
		if out.timed_out {
			return Err(HostError::TimedOut { secs: crate::gitx::GIT_TIMEOUT.as_secs() });
		}
		if !out.ok() {
			return Err(HostError::Git {
				args: args.to_vec(),
				code: out.code,
				stderr: secret::redact(out.stderr.trim()),
			});
		}
		Ok(out.stdout)
	}

	/// A probe that is *expected* to fail (missing ref, no parent): `None` is the answer,
	/// not an error. Anything else still propagates, so a broken shadow repo is not
	/// mistaken for an empty one.
	async fn probe(&self, args: &[&str]) -> Result<Option<String>> {
		let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
		let out = self.run(&owned, &[]).await?;
		if out.timed_out {
			return Err(HostError::TimedOut { secs: crate::gitx::GIT_TIMEOUT.as_secs() });
		}
		if !out.ok() {
			let text = out.stderr.trim();
			// git exits non-zero for "no such ref" with an explanatory stderr; treat the
			// *absence* cases as None and report anything else.
			let benign = text.contains("unknown revision")
				|| text.contains("needed a single revision")
				|| text.is_empty();
			if benign {
				return Ok(None);
			}
			return Err(HostError::Git { args: owned, code: out.code, stderr: secret::redact(text) });
		}
		let text = out.stdout.trim().to_string();
		Ok(if text.is_empty() { None } else { Some(text) })
	}

	async fn run(&self, args: &[String], env: &[(&str, &str)]) -> Result<proc::Exec> {
		let argv: Vec<std::ffi::OsString> = args.iter().map(std::ffi::OsString::from).collect();
		proc::run_env(
			&self.reg,
			std::ffi::OsStr::new("git"),
			&argv,
			None,
			env,
			crate::gitx::GIT_TIMEOUT,
			self.cancel.clone(),
		)
		.await
	}
}
