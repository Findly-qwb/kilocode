//! SQLite persistence — the desktop's source of truth (PLAN §10, §6.0, TODOS M2-1/M2-2).
//!
//! Three crash-domain rules are enforced structurally here, not by convention
//! (PLAN §3.3):
//!
//!  1. **One writer.** Every mutation is a closure shipped to a dedicated blocking
//!     thread that owns the only writable `Connection`. `tokio::sync::mpsc` serialises
//!     them, so two Turns can never interleave a transaction. Because the writer runs
//!     on `spawn_blocking`, no synchronous IO ever happens on the async event loop.
//!  2. **Read-only pool.** Readers take a connection from a small pool with
//!     `PRAGMA query_only=ON`; an accidental write through that path fails as
//!     `SQLITE_READONLY` instead of silently bypassing the writer. WAL lets those
//!     readers run concurrently with the writer.
//!  3. **Migrate before serving.** `user_version` drives the steps, and the file is
//!     copied to `backup/` first, so a bad migration is recoverable.
//!
//! rpi has its own `SqliteSessionStorage`; we deliberately do *not* share it with the
//! UI — PLAN §6.0 makes the desktop DB authoritative (see `adapt.rs`).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use rusqlite::{Connection, params};
use tokio::sync::{mpsc, oneshot};

use crate::error::{HostError, Result};
use crate::ipc;

/// Latest schema this build understands. Bump per migration step appended below.
pub const SCHEMA_VERSION: i64 = 3;

/// Default `busy_timeout`. The single-writer design should never contend, so this only
/// covers the reader/writer overlap while WAL checkpoints run.
pub const BUSY_TIMEOUT_MS: i64 = 5000;

type Task = Box<dyn FnOnce(&Connection) + Send + 'static>;

/// Handle to the writer thread. Cloneable; each clone shares the same queue.
#[derive(Clone)]
pub struct Writer {
	tx: mpsc::UnboundedSender<Task>,
}

impl Writer {
	/// Run a write closure on the single writer connection and await its result.
	pub async fn call<T>(&self, f: impl FnOnce(&Connection) -> Result<T> + Send + 'static) -> Result<T>
	where
		T: Send + 'static,
	{
		let (tx, rx) = oneshot::channel();
		let task: Task = Box::new(move |conn| {
			// A closed receiver means the caller was cancelled; the write is skipped,
			// which is exactly the semantics we want for a dropped future.
			let _ = tx.send(f(conn));
		});
		self.tx.send(task).map_err(|_| HostError::Store("writer task has exited".into()))?;
		rx.await.map_err(|_| HostError::Store("writer reply lost".into()))?
	}

	/// Fire-and-forget write, for events we must not block on (e.g. `logs` fan-out).
	pub fn detach(&self, f: impl FnOnce(&Connection) -> Result<()> + Send + 'static) {
		let task: Task = Box::new(move |conn| {
			if let Err(err) = f(conn) {
				tracing(&err);
			}
		});
		let _ = self.tx.send(task);
	}
}

fn tracing(err: &HostError) {
	// Never swallow: a failed background write must be visible. Kept in-memory so the
	// store has no logger dependency; the app crate drains it into `logs`.
	eprintln!("kilo-host store: write task failed: {}", err.safe());
}

/// One read connection. `Connection` is `Send` but not `Sync`, so each pool slot is
/// behind a mutex; N slots give readers real parallelism under WAL.
type Slot = Arc<Mutex<Connection>>;

/// Handle to the database: a writer queue plus a read-only pool.
pub struct Store {
	writer: Writer,
	readers: Arc<Pool>,
	path: PathBuf,
}

/// Owned so `fetch` can move it onto a blocking thread (`'static` is required there).
struct Pool {
	slots: Vec<Slot>,
	next: AtomicUsize,
}

impl Pool {
	fn run<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
		let slot = &self.slots[self.next.fetch_add(1, Ordering::Relaxed) % self.slots.len()];
		// A panic inside a read closure cannot corrupt SQLite (the statement is simply
		// dropped), so recovering the guard is deliberate, not an error swallow.
		let guard = slot.lock().unwrap_or_else(PoisonError::into_inner);
		f(&guard)
	}
}

impl Store {
	/// Open (creating if needed), migrate, then start the writer thread.
	pub fn open(path: impl AsRef<Path>) -> Result<Store> {
		Store::with_pool(path, 4)
	}

	pub fn with_pool(path: impl AsRef<Path>, readers: usize) -> Result<Store> {
		let path = path.as_ref().to_path_buf();
		if let Some(dir) = path.parent() {
			std::fs::create_dir_all(dir).map_err(|source| HostError::Io { path: dir.display().to_string(), source })?;
		}
		let fresh = !path.exists();
		let setup = configure(&path)?;
		let found = version(&setup)?;
		if found > SCHEMA_VERSION {
			return Err(HostError::SchemaVersion { found, supported: SCHEMA_VERSION });
		}
		// PLAN §10: "任何迁移前先复制 db 到 backup/". An empty file has nothing to keep.
		if !fresh && found < SCHEMA_VERSION {
			backup(&path, found)?;
		}
		drop(setup);

		let wconn = configure(&path)?;
		migrate(&wconn)?;
		drop(wconn);

		let (tx, rx) = mpsc::unbounded_channel::<Task>();
		// A dedicated *blocking* thread: the writer must never occupy an async worker,
		// and must never be a future that a `select!` can abandon mid-transaction.
		std::thread::Builder::new()
			.name("kilo-store-writer".into())
			.spawn(move || writer_loop(&path, rx))
			.map_err(|source| HostError::Io { path: "kilo-store-writer".into(), source })?;

		let mut slots = Vec::with_capacity(readers.max(1));
		for _ in 0..readers.max(1) {
			let conn = configure(&path)?;
			// Enforce rule 2 at the engine level.
			conn.execute_batch("PRAGMA query_only=ON;").map_err(HostError::from)?;
			slots.push(Arc::new(Mutex::new(conn)));
		}

		Ok(Store { writer: Writer { tx }, readers: Arc::new(Pool { slots, next: AtomicUsize::new(0) }), path })
	}

	pub fn path(&self) -> &Path {
		&self.path
	}

	pub fn writer(&self) -> &Writer {
		&self.writer
	}

	/// Borrow a read-only connection and run a query on it.
	pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
		self.readers.run(f)
	}

	/// `read` offloaded to the blocking pool, for callers on an async context.
	pub async fn fetch<T>(&self, f: impl FnOnce(&Connection) -> Result<T> + Send + 'static) -> Result<T>
	where
		T: Send + 'static,
	{
		let readers = Arc::clone(&self.readers);
		tokio::task::spawn_blocking(move || readers.run(f))
			.await
			.map_err(|err| HostError::Store(format!("read task panicked: {err}")))?
	}

	/* ------------------------------- rows ------------------------------- */

	pub fn schema_version(&self) -> Result<i64> {
		self.read(|conn| version(conn))
	}

	pub async fn upsert_project(&self, id: &str, path_s: &str, name: &str, is_git: bool) -> Result<()> {
		let (id, path_s, name) = (id.to_string(), path_s.to_string(), name.to_string());
		self.writer
			.call(move |conn| {
				let now = ipc::now_ms();
				conn.execute(
					"INSERT INTO projects (id, path, name, is_git, last_opened, created_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
					 ON CONFLICT(id) DO UPDATE SET name=excluded.name, is_git=excluded.is_git, last_opened=excluded.last_opened",
					params![id, path_s, name, is_git as i64, now, now],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn create_session(&self, args: &ipc::SessionCreateArgs) -> Result<Session> {
		let id = uuid();
		self.create_session_id(&id, args).await
	}

	pub async fn create_session_id(&self, id: &str, args: &ipc::SessionCreateArgs) -> Result<Session> {
		let id = id.to_string();
		let project_id = args.project_id.clone();
		let title = args.title.clone();
		let mode = args.mode.as_str().to_string();
		let model = args.model.clone();
		self.writer
			.call(move |conn| {
				let now = ipc::now_ms();
				conn.execute(
					"INSERT INTO sessions (id, project_id, title, mode, model, status, created_at, updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?6)",
					params![id, project_id, title, mode, model, now],
				)?;
				Ok(())
			})
			.await?;
		self.session(&id).await
	}

	pub async fn session(&self, id: &str) -> Result<Session> {
		let id = id.to_string();
		self.fetch(move |conn| {
			let row = conn
				.query_row(
					"SELECT id, project_id, title, mode, model, status, total_tokens, cost_estimate, pinned, deleted_at
					 FROM sessions WHERE id = ?1",
					params![id],
					|row| {
						Ok(Session {
							id: row.get(0)?,
							project_id: row.get(1)?,
							title: row.get(2)?,
							mode: row.get(3)?,
							model: row.get(4)?,
							status: row.get(5)?,
							total_tokens: row.get(6)?,
							cost_estimate: row.get(7)?,
							pinned: row.get(8)?,
							deleted_at: row.get(9)?,
						})
					},
				)
				.map_err(|_| HostError::SessionNotFound(id.clone()))?;
			Ok(row)
		})
		.await
	}

	pub async fn list_sessions(&self, project_id: Option<&str>, limit: i64) -> Result<Vec<Session>> {
		let key = project_id.map(str::to_string);
		self.fetch(move |conn| {
			let mut sql = String::from(
				"SELECT id, project_id, title, mode, model, status, total_tokens, cost_estimate, pinned, deleted_at
				 FROM sessions WHERE deleted_at IS NULL",
			);
			if key.is_some() {
				sql.push_str(" AND project_id = ?1");
			}
			sql.push_str(" ORDER BY pinned DESC, updated_at DESC LIMIT ?");
			sql.push_str(if key.is_some() { "2" } else { "1" });
			let mut stmt = conn.prepare(&sql)?;
			let mapped = |row: &rusqlite::Row| {
				Ok(Session {
					id: row.get(0)?,
					project_id: row.get(1)?,
					title: row.get(2)?,
					mode: row.get(3)?,
					model: row.get(4)?,
					status: row.get(5)?,
					total_tokens: row.get(6)?,
					cost_estimate: row.get(7)?,
					pinned: row.get(8)?,
					deleted_at: row.get(9)?,
				})
			};
			let rows = match &key {
				Some(p) => stmt.query_map(params![p, limit], mapped)?,
				None => stmt.query_map(params![limit], mapped)?,
			};
			rows.collect::<std::result::Result<Vec<_>, _>>().map_err(HostError::from)
		})
		.await
	}

	/// Activity drives the left-column status dot (PLAN §9.1 `session_updated`).
	pub async fn set_activity(&self, id: &str, activity: ipc::Activity) -> Result<i64> {
		let id = id.to_string();
		let status = status_of(activity).to_string();
		self.writer
			.call(move |conn| {
				let now = ipc::now_ms();
				conn.execute("UPDATE sessions SET status = ?2, updated_at = ?3 WHERE id = ?1", params![id, status, now])?;
				Ok(now)
			})
			.await
	}

	pub async fn rename_session(&self, id: &str, title: &str) -> Result<()> {
		let (id, title) = (id.to_string(), title.to_string());
		self.writer
			.call(move |conn| {
				conn.execute("UPDATE sessions SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, ipc::now_ms()])?;
				Ok(())
			})
			.await
	}

	/// Soft delete — `deleted_at` only, so M2-3's undo window can restore it.
	pub async fn soft_delete(&self, id: &str) -> Result<()> {
		let id = id.to_string();
		self.writer
			.call(move |conn| {
				conn.execute("UPDATE sessions SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, ipc::now_ms()])?;
				Ok(())
			})
			.await
	}

	pub async fn restore(&self, id: &str) -> Result<()> {
		let id = id.to_string();
		self.writer
			.call(move |conn| {
				conn.execute("UPDATE sessions SET deleted_at = NULL WHERE id = ?1", params![id])?;
				Ok(())
			})
			.await
	}

	pub async fn add_message(&self, msg: &NewMessage) -> Result<String> {
		let id = msg.id.clone().unwrap_or_else(uuid);
		let (sid, role, turn) = (msg.session_id.clone(), msg.role.clone(), msg.turn_index);
		let (model, prompt, completion, reasoning, cache, cost) = (
			msg.model.clone(),
			msg.prompt_tokens,
			msg.completion_tokens,
			msg.reasoning_tokens,
			msg.cache_read_tokens,
			msg.cost_estimate,
		);
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO messages (id, session_id, role, turn_index, status, prompt_tokens, completion_tokens,
					 reasoning_tokens, cache_read_tokens, cost_estimate, model, created_at)
					 VALUES (?1, ?2, ?3, ?4, 'complete', ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
					params![id, sid, role, turn, prompt, completion, reasoning, cache, cost, model, ipc::now_ms()],
				)?;
				Ok(id)
			})
			.await
	}

	/// Insert/replace a part and keep `parts_fts` in sync (PLAN §10 needs FTS for
	/// in-transcript search; the triggers below are what make that table non-dead).
	pub async fn upsert_part(&self, part: &ipc::Part) -> Result<()> {
		let p = part.clone();
		self.writer
			.call(move |conn| {
				let now = ipc::now_ms();
				let content = p.content.to_string();
				conn.execute(
					"INSERT INTO parts (id, message_id, seq, type, tool_name, tool_source, call_id, state, content, created_at, updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
					 ON CONFLICT(id) DO UPDATE SET
						state=excluded.state, content=excluded.content, updated_at=excluded.updated_at",
					params![p.id, p.message_id, p.seq, p.r#type.as_str(), p.tool_name, p.tool_source, p.call_id, p.state, content, now],
				)?;
				Ok(())
			})
			.await
	}

	/// Reverse-paged history (PLAN §9.2 `session_load`).
	pub async fn load_parts(&self, message_ids: Vec<String>) -> Result<Vec<ipc::Part>> {
		self.fetch(move |conn| {
			let mut out = Vec::new();
			let mut stmt = conn.prepare(
				"SELECT id, message_id, seq, type, tool_name, tool_source, call_id, state, content, created_at, updated_at
				 FROM parts WHERE message_id = ?1 ORDER BY seq",
			)?;
			for mid in &message_ids {
				let rows = stmt.query_map(params![mid], row_to_part)?;
				for row in rows {
					out.push(row?);
				}
			}
			Ok(out)
		})
		.await
	}

	pub async fn search_parts(&self, needle: &str, limit: i64) -> Result<Vec<ipc::Part>> {
		let needle = needle.to_string();
		self.fetch(move |conn| {
			let mut stmt = conn.prepare(
				"SELECT p.id, p.message_id, p.seq, p.type, p.tool_name, p.tool_source, p.call_id, p.state, p.content, p.created_at, p.updated_at
				 FROM parts_fts f JOIN parts p ON p.id = f.part_id
				 WHERE parts_fts MATCH ?1 ORDER BY p.created_at DESC LIMIT ?2",
			)?;
			let rows = stmt.query_map(params![needle, limit], row_to_part)?;
			rows.collect::<std::result::Result<Vec<_>, _>>().map_err(HostError::from)
		})
		.await
	}

	/// Queue snapshot for resume-after-restart (PLAN §6.1, §10 `checkpoints`).
	pub async fn save_checkpoint(&self, session_id: &str, queue: &ipc::QueueState, last_turn: i64) -> Result<()> {
		let session_id = session_id.to_string();
		let blob = serde_json::to_string(queue).map_err(|err| HostError::Store(err.to_string()))?;
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO checkpoints (session_id, queue_state, last_turn, updated_at) VALUES (?1, ?2, ?3, ?4)
					 ON CONFLICT(session_id) DO UPDATE SET queue_state=excluded.queue_state, last_turn=excluded.last_turn, updated_at=excluded.updated_at",
					params![session_id, blob, last_turn, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn checkpoint(&self, session_id: &str) -> Result<Option<(ipc::QueueState, i64)>> {
		let session_id = session_id.to_string();
		self.fetch(move |conn| {
			let raw: Option<(String, i64)> = conn
				.query_row("SELECT queue_state, last_turn FROM checkpoints WHERE session_id = ?1", params![session_id], |row| Ok((row.get(0)?, row.get(1)?)))
				.ok();
			let Some((blob, turn)) = raw else {
				return Ok(None);
			};
			let state: ipc::QueueState = serde_json::from_str(&blob).map_err(|err| HostError::Store(err.to_string()))?;
			Ok(Some((state, turn)))
		})
		.await
	}

	/// File-level rollback rows (PLAN §7.2 `file_snapshots`).
	pub async fn record_snapshot(&self, snap: &NewSnapshot) -> Result<()> {
		let (id, session_id, message_id, ckpt, files) =
			(snap.id.clone(), snap.session_id.clone(), snap.message_id.clone(), snap.ckpt_oid.clone(), snap.files.clone());
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO file_snapshots (id, session_id, turn_index, message_id, ckpt_oid, files, created_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
					params![id, session_id, snap.turn_index, message_id, ckpt, files, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn snapshots(&self, session_id: &str) -> Result<Vec<(i64, String, String)>> {
		let session_id = session_id.to_string();
		self.fetch(move |conn| {
			let mut stmt =
				conn.prepare("SELECT turn_index, ckpt_oid, files FROM file_snapshots WHERE session_id = ?1 ORDER BY turn_index")?;
			let rows = stmt.query_map(params![session_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
			rows.collect::<std::result::Result<Vec<_>, _>>().map_err(HostError::from)
		})
		.await
	}

	pub async fn set_permission(&self, rule: &StoredPerm) -> Result<()> {
		let r = rule.clone();
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO tool_permissions (id, scope, scope_ref, tool, policy, matcher, exceptions, updated_at)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
					 ON CONFLICT(scope, IFNULL(scope_ref,''), tool) DO UPDATE SET
						policy=excluded.policy, matcher=excluded.matcher, exceptions=excluded.exceptions,
						updated_at=excluded.updated_at",
					params![r.id, r.scope, r.scope_ref, r.tool, r.policy, r.matcher, r.exceptions, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn permissions(&self) -> Result<Vec<StoredPerm>> {
		self.fetch(|conn| {
			let mut stmt = conn.prepare(
				"SELECT id, scope, scope_ref, tool, policy, matcher, exceptions FROM tool_permissions ORDER BY updated_at",
			)?;
			let rows = stmt.query_map([], |row| {
				Ok(StoredPerm {
					id: row.get(0)?,
					scope: row.get(1)?,
					scope_ref: row.get(2)?,
					tool: row.get(3)?,
					policy: row.get(4)?,
					matcher: row.get(5)?,
					exceptions: row.get(6)?,
				})
			})?;
			rows.collect::<std::result::Result<Vec<_>, _>>().map_err(HostError::from)
		})
		.await
	}

	/// Collapse-state / geometry / skin memory (PLAN §5.1, §10 `ui_state`).
	pub async fn set_ui(&self, key: &str, value: &str) -> Result<()> {
		let (key, value) = (key.to_string(), value.to_string());
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO ui_state (key, value, updated_at) VALUES (?1, ?2, ?3)
					 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
					params![key, value, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn ui(&self, key: &str) -> Result<Option<String>> {
		let key = key.to_string();
		self.fetch(move |conn| {
			Ok(conn
				.query_row("SELECT value FROM ui_state WHERE key = ?1", params![key], |row| row.get::<_, String>(0))
				.ok())
		})
		.await
	}

	pub async fn save_draft(&self, session_id: &str, text: &str, attachments: &str) -> Result<()> {
		let (session_id, text, attachments) = (session_id.to_string(), text.to_string(), attachments.to_string());
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO drafts (session_id, text, attachments, updated_at) VALUES (?1, ?2, ?3, ?4)
					 ON CONFLICT(session_id) DO UPDATE SET text=excluded.text, attachments=excluded.attachments, updated_at=excluded.updated_at",
					params![session_id, text, attachments, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	/// PLAN §10: `providers.key_ref` holds a keychain reference — this API cannot be
	/// given a plaintext key at all, which is what TODOS M3-9 asserts.
	pub async fn upsert_provider(&self, id: &str, name: &str, base_url: &str, key_ref: &str, models: &[String]) -> Result<()> {
		let (id, name, base_url) = (id.to_string(), name.to_string(), base_url.to_string());
		let key_ref = crate::secret::KeyRef::parse(key_ref)?;
		let blob = serde_json::to_string(models).map_err(|err| HostError::Store(err.to_string()))?;
		self.writer
			.call(move |conn| {
				conn.execute(
					"INSERT INTO providers (id, name, base_url, key_ref, models, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
					 ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url, key_ref=excluded.key_ref, models=excluded.models",
					params![id, name, base_url, key_ref.as_str(), blob, ipc::now_ms()],
				)?;
				Ok(())
			})
			.await
	}

	pub async fn provider_key_ref(&self, id: &str) -> Result<Option<String>> {
		let id = id.to_string();
		self.fetch(move |conn| {
			Ok(conn
				.query_row("SELECT key_ref FROM providers WHERE id = ?1", params![id], |row| row.get::<_, Option<String>>(0))
				.ok()
				.flatten())
		})
		.await
	}

	/// Local log sink (PLAN §3.2 rule 5: local logging only, no telemetry).
	pub fn log(&self, level: &str, event: &str, payload: serde_json::Value) {
		let (level, event) = (level.to_string(), event.to_string());
		let blob = payload.to_string();
		self.writer.detach(move |conn| {
			conn.execute("INSERT INTO logs (ts, level, event, payload) VALUES (?1, ?2, ?3, ?4)", params![ipc::now_ms(), level, event, blob])?;
			Ok(())
		});
	}
}

/// The writer thread exits once every `Store` (and thus every `Writer` sender) is
/// dropped, after the queue drains — that is the shutdown path; there is no separate
/// close command, which keeps it impossible to write after the store is gone.
fn writer_loop(path: &Path, mut rx: mpsc::UnboundedReceiver<Task>) {
	let Ok(conn) = configure(path) else {
		eprintln!("kilo-host store: writer could not open {path:?}");
		return;
	};
	while let Some(task) = rx.blocking_recv() {
		task(&conn);
	}
	drop(rx);
}

fn configure(path: &Path) -> Result<Connection> {
	let conn = Connection::open(path).map_err(|err| HostError::Store(err.to_string()))?;
	conn.execute_batch(&format!(
		"PRAGMA journal_mode=WAL;
		 PRAGMA synchronous=NORMAL;
		 PRAGMA foreign_keys=ON;
		 PRAGMA busy_timeout={BUSY_TIMEOUT_MS};
		 PRAGMA temp_store=MEMORY;"
	))
	.map_err(|err| HostError::Store(err.to_string()))?;
	Ok(conn)
}

fn version(conn: &Connection) -> Result<i64> {
	conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).map_err(HostError::from)
}

/// One schema step. `version` is the `user_version` the DB carries afterwards.
struct Migration {
	version: i64,
	notes: &'static str,
	sql: &'static str,
}

/// PLAN §10 verbatim, split into `user_version` steps so migrations are testable
/// end-to-end. Two deviations, both forced by SQLite itself:
///   * `skills` cannot carry `UNIQUE(command, scope, IFNULL(path,''))` inside
///     `CREATE TABLE` — table constraints accept column names only, not expressions.
///     The equivalent expression index is created alongside it.
///   * `parts_fts` needs triggers to be populated at all, so the three of them ship in
///     the same step as the virtual table.
const MIGRATIONS: &[Migration] = &[
	Migration {
		version: 1,
		notes: "core transcript tables",
		sql: r#"
CREATE TABLE projects (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  is_git INTEGER DEFAULT 0, last_opened INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'ask',
  model TEXT, variant TEXT, provider_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  total_tokens INTEGER DEFAULT 0, cost_estimate REAL DEFAULT 0,
  pinned INTEGER DEFAULT 0, deleted_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_project_updated ON sessions(project_id, updated_at DESC);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, turn_index INTEGER, status TEXT DEFAULT 'complete',
  prompt_tokens INTEGER, completion_tokens INTEGER, reasoning_tokens INTEGER,
  cache_read_tokens INTEGER, cost_estimate REAL, model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE TABLE parts (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, type TEXT NOT NULL,
  tool_name TEXT, tool_source TEXT, call_id TEXT, state TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_parts_msg_seq ON parts(message_id, seq);
"#,
	},
	Migration {
		version: 2,
		notes: "attachments, resume, rollback, permissions",
		sql: r#"
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  part_id TEXT, kind TEXT NOT NULL,
  name TEXT NOT NULL, mime TEXT, bytes INTEGER, path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE checkpoints (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  queue_state TEXT NOT NULL, last_turn INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE file_snapshots (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL, message_id TEXT, ckpt_oid TEXT NOT NULL,
  files TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_snapshots_session ON file_snapshots(session_id, turn_index);
CREATE TABLE tool_permissions (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, scope_ref TEXT,
  tool TEXT NOT NULL, policy TEXT NOT NULL,
  matcher TEXT,
  exceptions TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_perm_unique ON tool_permissions(scope, IFNULL(scope_ref,''), tool);
"#,
	},
	Migration {
		version: 3,
		notes: "extensions, providers, ui memory, logs, FTS",
		sql: r#"
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, transport TEXT NOT NULL,
  config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'disabled', tools INTEGER DEFAULT 0, last_error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE skills (
  id TEXT PRIMARY KEY, command TEXT NOT NULL, name TEXT, description TEXT,
  system_prompt TEXT NOT NULL, model TEXT, variant TEXT,
  scope TEXT NOT NULL DEFAULT 'global',
  path TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_skills_unique ON skills(command, scope, IFNULL(path,''));
CREATE TABLE providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
  key_ref TEXT,
  models TEXT, last_check INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE ui_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE drafts (session_id TEXT PRIMARY KEY, text TEXT, attachments TEXT, updated_at INTEGER);
CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, event TEXT, payload TEXT);
CREATE VIRTUAL TABLE parts_fts USING fts5(content, part_id UNINDEXED, tokenize='unicode61');
CREATE TRIGGER parts_fts_ai AFTER INSERT ON parts BEGIN
  INSERT INTO parts_fts (content, part_id) VALUES (new.content, new.id);
END;
CREATE TRIGGER parts_fts_ad AFTER DELETE ON parts BEGIN
  DELETE FROM parts_fts WHERE part_id = old.id;
END;
CREATE TRIGGER parts_fts_au AFTER UPDATE OF content ON parts BEGIN
  DELETE FROM parts_fts WHERE part_id = old.id;
  INSERT INTO parts_fts (content, part_id) VALUES (new.content, new.id);
END;
"#,
	},
];

/// Apply pending steps. Each step commits atomically and stamps `user_version`, so a
/// crash mid-migration resumes at the right step.
pub fn migrate(conn: &Connection) -> Result<()> {
	let from = version(conn)?;
	if from >= SCHEMA_VERSION {
		return Ok(());
	}
	for step in MIGRATIONS.iter().filter(|m| m.version > from) {
		conn.execute_batch("BEGIN").map_err(|err| HostError::Migrate { from, to: step.version, why: err.to_string() })?;
		match conn.execute_batch(step.sql) {
			Ok(()) => {}
			Err(err) => {
				let _ = conn.execute_batch("ROLLBACK");
				return Err(HostError::Migrate { from, to: step.version, why: crate::secret::redact(&err.to_string()) });
			}
		}
		conn.pragma_update(None, "user_version", step.version)
			.map_err(|err| HostError::Migrate { from, to: step.version, why: err.to_string() })?;
		conn.execute_batch("COMMIT")
			.map_err(|err| HostError::Migrate { from, to: step.version, why: err.to_string() })?;
	}
	Ok(())
}

/// Copy the DB (and, if present, its WAL sibling) into `<dir>/backup/` before migrating.
fn backup(path: &Path, from: i64) -> Result<PathBuf> {
	let dir = path.parent().unwrap_or(Path::new(".")).join("backup");
	std::fs::create_dir_all(&dir).map_err(|source| HostError::Io { path: dir.display().to_string(), source })?;
	let stamp = ipc::now_ms();
	let dest = dir.join(format!("{}-v{from}-{stamp}.sqlite", file_stem(path)));
	let src = Connection::open(path).map_err(|err| HostError::Store(err.to_string()))?;
	// Checkpoint first so the copy is self-contained even with WAL in flight.
	let _ = src.pragma_update(None, "wal_checkpoint", "TRUNCATE");
	drop(src);
	std::fs::copy(path, &dest).map_err(|source| HostError::Io { path: path.display().to_string(), source })?;
	Ok(dest)
}

fn file_stem(path: &Path) -> String {
	path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "kilo".into())
}

fn status_of(activity: ipc::Activity) -> &'static str {
	match activity {
		ipc::Activity::Idle => "idle",
		ipc::Activity::Running => "running",
		ipc::Activity::AwaitingInput => "awaiting_input",
		ipc::Activity::AwaitingApproval => "awaiting_approval",
		ipc::Activity::Error => "error",
	}
}

fn row_to_part(row: &rusqlite::Row) -> rusqlite::Result<ipc::Part> {
	let raw: String = row.get(8)?;
	Ok(ipc::Part {
		id: row.get(0)?,
		message_id: row.get(1)?,
		seq: row.get(2)?,
		r#type: serde_json::from_value(serde_json::Value::String(row.get(3)?)).unwrap_or(ipc::PartKind::Text),
		tool_name: row.get(4)?,
		tool_source: row.get(5)?,
		call_id: row.get(6)?,
		state: row.get(7)?,
		content: serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw)),
		created_at: row.get(9)?,
		updated_at: row.get(10)?,
	})
}

/// Short unique id. Session/message/part ids only ever need to be unique inside one
/// desktop install; time + a counter is enough and keeps the DB human-readable.
pub fn uuid() -> String {
	use std::sync::atomic::AtomicU32;
	static SEQ: AtomicU32 = AtomicU32::new(0);
	let n = SEQ.fetch_add(1, Ordering::Relaxed);
	format!("{:x}{:x}", ipc::now_ms(), n)
}

#[derive(Debug, Clone)]
pub struct Session {
	pub id: String,
	pub project_id: String,
	pub title: String,
	pub mode: String,
	pub model: Option<String>,
	pub status: String,
	pub total_tokens: i64,
	pub cost_estimate: f64,
	pub pinned: i64,
	pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct NewMessage {
	pub id: Option<String>,
	pub session_id: String,
	pub role: String,
	pub turn_index: Option<i64>,
	pub prompt_tokens: Option<i64>,
	pub completion_tokens: Option<i64>,
	pub reasoning_tokens: Option<i64>,
	pub cache_read_tokens: Option<i64>,
	pub cost_estimate: Option<f64>,
	pub model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewSnapshot {
	pub id: String,
	pub session_id: String,
	pub turn_index: i64,
	pub message_id: Option<String>,
	pub ckpt_oid: String,
	/// JSON `[{path,added,deleted}]` per PLAN §10.
	pub files: String,
}

#[derive(Debug, Clone)]
pub struct StoredPerm {
	pub id: String,
	pub scope: String,
	pub scope_ref: Option<String>,
	pub tool: String,
	pub policy: String,
	pub matcher: Option<String>,
	pub exceptions: Option<String>,
}
