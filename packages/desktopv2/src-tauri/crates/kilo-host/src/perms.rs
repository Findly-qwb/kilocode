//! Permission engine (PLAN §6.6) — the one piece of real security Kilo adds on top of
//! rpi. rpi supplies the execution seam; this module decides *whether* it may run.
//!
//! Resolution, in order:
//!
//!  1. Collect configured rules whose `tool` pattern and `matcher` apply to the
//!     request. Scopes are the four PLAN §6.6 layers: global -> project -> session ->
//!     mode. **The strictest of those wins** (`Policy` is ordered Auto <
//!     RequireApproval < Deny, so "strictest" is `max`). Taking the max rather than
//!     "last layer wins" is what stops a project rule from talking a session rule into
//!     loosening, and it is what TODOS M3-1 tests.
//!  2. Inside one rule, a matching `exceptions` entry replaces that rule's policy
//!     (PLAN: "例外列表：命中例外即覆盖该工具默认", e.g. bash AUTO + `rm -rf *` DENY).
//!     Several exceptions matching -> strictest, again deliberately.
//!  3. With no rule at all, fall back to the mode default table from §6.6 (Ask/Plan/Code),
//!     keyed by tool class. So configured rules can *loosen* a mode default (that is the
//!     point of the exception list) but never above what the user wrote down.
//!  4. Unknown tool with no rule: REQUIRE_APPROVAL. The safe default per §6.6
//!     ("shell 与写文件默认 REQUIRE_APPROVAL") beats silently auto-allowing a new tool.
//!
//! The engine is pure: it reads rules and returns a decision. Blocking on a human is
//! `approval.rs`'s job, and git-diffing the pending change is `checkpoint.rs`'s.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::glob;
use crate::ipc::{self, Mode};
use crate::store::StoredPerm;

/// Three states of PLAN §6.6. Declaration order *is* severity order, so
/// `max()` == strictest. Serialized names match the `tool_permissions.policy` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Policy {
	Auto,
	RequireApproval,
	Deny,
}

impl Policy {
	pub fn as_str(self) -> &'static str {
		match self {
			Policy::Auto => "auto",
			Policy::RequireApproval => "require_approval",
			Policy::Deny => "deny",
		}
	}

	/// Inverse of `as_str`; unknown input maps to the strictest policy rather than to
	/// `Auto`, so a corrupted row can never widen permissions.
	pub fn parse(raw: &str) -> Policy {
		match raw {
			"auto" => Policy::Auto,
			"require_approval" => Policy::RequireApproval,
			_ => Policy::Deny,
		}
	}
}

/// The four layers of PLAN §6.6, ordered most-general first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Scope {
	Global,
	Project,
	Session,
	Mode,
}

impl Scope {
	pub fn as_str(self) -> &'static str {
		match self {
			Scope::Global => "global",
			Scope::Project => "project",
			Scope::Session => "session",
			Scope::Mode => "mode",
		}
	}

	pub fn parse(raw: &str) -> Scope {
		match raw {
			"project" => Scope::Project,
			"session" => Scope::Session,
			"mode" => Scope::Mode,
			_ => Scope::Global,
		}
	}
}

/// What kind of effect a tool has. Drives the mode default table only; configured rules
/// key off the tool name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum Class {
	Read,
	Write,
	Shell,
	/// `git_commit` / `git_push` — PLAN §7.2: "commit/push 走 REQUIRE_APPROVAL，永不自动执行".
	GitMutate,
	Mcp,
	Unknown,
}

/// `rpi-tools` built-ins plus the desktop supplements (PLAN §6.5).
pub fn class_of(tool: &str) -> Class {
	if tool.starts_with("mcp:") {
		return Class::Mcp;
	}
	match tool {
		"read" | "ls" | "find" | "grep" | "glob" | "git_status" | "git_diff" | "fs_scan" | "fs_tree" | "fs_preview"
		| "fs_search" => Class::Read,
		"write" | "edit" | "apply_patch" => Class::Write,
		"bash" | "powershell" | "shell" => Class::Shell,
		"git_commit" | "git_push" => Class::GitMutate,
		_ => Class::Unknown,
	}
}

/// PLAN §6.6: in Plan mode the shell is AUTO only for read-only commands.
/// Prefixes, matched case-sensitively against the first token plus, for compound
/// allow-entries like `git status`, the first two.
pub const READ_ONLY: &[&str] = &[
	"ls", "cat", "head", "tail", "wc", "pwd", "echo", "whoami", "date", "which", "find", "grep", "rg", "tree", "file",
	"stat", "du", "df", "git status", "git diff", "git log", "git show", "git rev-parse", "git branch",
];

pub fn read_only(command: &str) -> bool {
	let c = command.trim();
	READ_ONLY.iter().any(|p| c == *p || c.starts_with(&format!("{p} ")))
}

/// Path / command / host glob, all optional (PLAN §10 `matcher` JSON).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub struct Matcher {
	#[serde(skip_serializing_if = "Option::is_none")]
	pub path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub command: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub host: Option<String>,
}

impl Matcher {
	pub fn empty(&self) -> bool {
		self.path.is_none() && self.command.is_none() && self.host.is_none()
	}

	/// An empty matcher applies to everything its tool pattern covers.
	pub fn matches(&self, req: &Request) -> bool {
		if let Some(p) = &self.path {
			let Some(target) = &req.path else {
				return false;
			};
			if !glob::match_glob(p, target) {
				return false;
			}
		}
		if let Some(p) = &self.command {
			let Some(target) = &req.command else {
				return false;
			};
			if !glob::match_command(p, target) {
				return false;
			}
		}
		if let Some(p) = &self.host {
			let Some(target) = &req.host else {
				return false;
			};
			if !glob::match_host(p, target) {
				return false;
			}
		}
		true
	}

	pub fn describe(&self) -> String {
		let mut bits = Vec::new();
		if let Some(p) = &self.path {
			bits.push(format!("path={p}"));
		}
		if let Some(p) = &self.command {
			bits.push(format!("command={p}"));
		}
		if let Some(p) = &self.host {
			bits.push(format!("host={p}"));
		}
		if bits.is_empty() {
			return "*".into();
		}
		bits.join(" ")
	}

	/// Reject unusable globs at write time (see `glob::validate`).
	pub fn validate(&self) -> crate::error::Result<()> {
		for p in [&self.path, &self.command, &self.host].into_iter().flatten() {
			glob::validate(p)?;
		}
		Ok(())
	}
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub struct Exception {
	pub matcher: Matcher,
	pub policy: Policy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
	pub id: String,
	pub scope: Scope,
	pub scope_ref: Option<String>,
	/// Exact tool name or a glob (`mcp:*`, `git_*`).
	pub tool: String,
	pub policy: Policy,
	pub matcher: Matcher,
	pub exceptions: Vec<Exception>,
}

/// Everything the resolution needs about the pending tool call.
#[derive(Debug, Clone)]
pub struct Request {
	pub tool: String,
	pub path: Option<String>,
	pub command: Option<String>,
	pub host: Option<String>,
}

impl Request {
	pub fn class(&self) -> Class {
		class_of(&self.tool)
	}
}

/// Where the user is right now, so scope_ref can be filtered.
#[derive(Debug, Clone)]
pub struct Ctx {
	pub mode: Mode,
	pub project_id: Option<String>,
	pub session_id: Option<String>,
}

/// The answer, plus enough provenance for the approval card to show *why* (M3-4:
/// "命中规则文本来自 effective 解析，非硬编码").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Effective {
	pub policy: Policy,
	/// Human-readable winning rule; `None` when the mode default table decided it.
	pub rule: Option<String>,
	pub scope: Scope,
	pub matcher: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Engine {
	rules: Vec<Rule>,
}

impl Engine {
	pub fn new(rules: Vec<Rule>) -> Engine {
		Engine { rules }
	}

	/// Hydrate from the `tool_permissions` table. Bad JSON is skipped loudly rather
	/// than silently widening access.
	pub fn load(rows: &[StoredPerm]) -> (Engine, Vec<String>) {
		let mut rules = Vec::new();
		let mut skipped = Vec::new();
		for row in rows {
			let matcher = match &row.matcher {
				Some(raw) => match serde_json::from_str(raw) {
					Ok(m) => m,
					Err(err) => {
						skipped.push(format!("{}: bad matcher JSON: {err}", row.id));
						continue;
					}
				},
				None => Matcher::default(),
			};
			let exceptions = match &row.exceptions {
				Some(raw) => match serde_json::from_str(raw) {
					Ok(e) => e,
					Err(err) => {
						skipped.push(format!("{}: bad exceptions JSON: {err}", row.id));
						continue;
					}
				},
				None => Vec::new(),
			};
			rules.push(Rule {
				id: row.id.clone(),
				scope: Scope::parse(&row.scope),
				scope_ref: row.scope_ref.clone(),
				tool: row.tool.clone(),
				policy: Policy::parse(&row.policy),
				matcher,
				exceptions,
			});
		}
		(Engine::new(rules), skipped)
	}

	pub fn rules(&self) -> &[Rule] {
		&self.rules
	}

	/// Upsert a `permission_set` command (PLAN §9.2). Uniqueness follows the DB index:
	/// (scope, scope_ref, tool).
	pub fn set(&mut self, args: &ipc::PermissionSetArgs) {
		let tool = args.tool.clone();
		if let Some(existing) =
			self.rules.iter_mut().find(|r| r.scope == args.scope && r.scope_ref == args.scope_ref && r.tool == tool)
		{
			existing.policy = args.policy;
			existing.matcher = args.matcher.clone().unwrap_or_default();
			existing.exceptions = args.exceptions.clone();
			return;
		}
		self.rules.push(Rule {
			id: crate::store::uuid(),
			scope: args.scope,
			scope_ref: args.scope_ref.clone(),
			tool,
			policy: args.policy,
			matcher: args.matcher.clone().unwrap_or_default(),
			exceptions: args.exceptions.clone(),
		});
	}

	/// "Always allow this kind" from an approval card (M3-5): a session-scoped rule that
	/// carries the matcher the user actually saw.
	pub fn allow_always(&mut self, session_id: &str, tool: &str, matcher: Matcher) {
		self.rules.push(Rule {
			id: crate::store::uuid(),
			scope: Scope::Session,
			scope_ref: Some(session_id.to_string()),
			tool: tool.to_string(),
			policy: Policy::Auto,
			matcher,
			exceptions: Vec::new(),
		});
	}

	fn in_scope(&self, rule: &Rule, ctx: &Ctx) -> bool {
		match rule.scope {
			Scope::Global => true,
			Scope::Project => rule.scope_ref.as_deref() == ctx.project_id.as_deref(),
			Scope::Session => rule.scope_ref.as_deref() == ctx.session_id.as_deref(),
			Scope::Mode => rule.scope_ref.as_deref() == Some(ctx.mode.as_str()),
		}
	}

	pub fn effective(&self, ctx: &Ctx, req: &Request) -> Effective {
		let mut best: Option<(Policy, usize, &Rule)> = None;
		for rule in self.rules.iter() {
			if !self.in_scope(rule, ctx) {
				continue;
			}
			if !glob::match_glob(&rule.tool, &req.tool) {
				continue;
			}
			if !rule.matcher.matches(req) {
				continue;
			}
			let policy = resolve_exceptions(rule, req);
			// strictest wins; on a tie the more specific layer (higher Scope ordinal)
			// describes the decision, which is what the audit trail should show.
			let better = match &best {
				None => true,
				Some((p, rank, _)) => policy > *p || (policy == *p && rule.scope as usize > *rank),
			};
			if better {
				best = Some((policy, rule.scope as usize, rule));
			}
		}
		if let Some((policy, _, rule)) = best {
			return Effective {
				policy,
				rule: Some(format!("{}:{} -> {}", rule.scope.as_str(), rule.tool, policy.as_str())),
				scope: rule.scope,
				matcher: Some(rule.matcher.describe()),
			};
		}
		let policy = mode_default(ctx.mode, req);
		Effective { policy, rule: None, scope: Scope::Mode, matcher: None }
	}

	/// The effective-policy preview table the settings page shows (M3-6).
	pub fn preview(&self, ctx: &Ctx, tools: &[String]) -> Vec<(String, Effective)> {
		tools
			.iter()
			.map(|tool| {
				(
					tool.clone(),
					self.effective(
						ctx,
						&Request { tool: tool.clone(), path: None, command: None, host: None },
					),
				)
			})
			.collect()
	}
}

/// Exception list beats the rule it belongs to; several hits -> strictest.
fn resolve_exceptions(rule: &Rule, req: &Request) -> Policy {
	let mut hit: Option<Policy> = None;
	for ex in &rule.exceptions {
		if ex.matcher.matches(req) {
			hit = Some(match hit {
				Some(p) => p.max(ex.policy),
				None => ex.policy,
			});
		}
	}
	hit.unwrap_or(rule.policy)
}

/// PLAN §6.6 mode defaults, the table TODOS M3-2 pins down:
///   Ask  = write and shell all DENY
///   Plan = write DENY, shell AUTO only for the read-only whitelist (DENY otherwise)
///   Code = write and shell REQUIRE_APPROVAL
/// Read-only tools are AUTO in every mode — otherwise the agent could not see anything.
/// `git_commit`/`git_push` are never AUTO (§7.2), and MCP tools default to approval so a
/// new server cannot silently gain a shell.
pub fn mode_default(mode: Mode, req: &Request) -> Policy {
	match req.class() {
		Class::Read => Policy::Auto,
		Class::Write => match mode {
			Mode::Ask | Mode::Plan => Policy::Deny,
			Mode::Code => Policy::RequireApproval,
		},
		Class::Shell => match mode {
			Mode::Ask => Policy::Deny,
			Mode::Plan => {
				let cmd = req.command.as_deref().unwrap_or("");
				if read_only(cmd) {
					return Policy::Auto;
				}
				Policy::Deny
			}
			Mode::Code => Policy::RequireApproval,
		},
		Class::GitMutate => match mode {
			Mode::Ask => Policy::Deny,
			Mode::Plan | Mode::Code => Policy::RequireApproval,
		},
		Class::Mcp => match mode {
			Mode::Ask => Policy::Deny,
			Mode::Plan | Mode::Code => Policy::RequireApproval,
		},
		Class::Unknown => Policy::RequireApproval,
	}
}

/// Serialise a rule into `tool_permissions` rows.
pub fn to_stored(rule: &Rule) -> StoredPerm {
	StoredPerm {
		id: rule.id.clone(),
		scope: rule.scope.as_str().to_string(),
		scope_ref: rule.scope_ref.clone(),
		tool: rule.tool.clone(),
		policy: rule.policy.as_str().to_string(),
		matcher: if rule.matcher.empty() { None } else { Some(rule.matcher.to_json()) },
		exceptions: if rule.exceptions.is_empty() {
			None
		} else {
			Some(rule.to_exceptions_json())
		},
	}
}

impl Matcher {
	pub fn to_json(&self) -> String {
		serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
	}
}

impl Rule {
	pub fn to_exceptions_json(&self) -> String {
		serde_json::to_string(&self.exceptions).unwrap_or_else(|_| "[]".into())
	}
}

/// Punycode / homograph detection for the approval card (PLAN §6.6: "punycode/同形域名
/// 检测在审批卡上高亮提示"). Cheap and side-effect free so the UI can call it per host.
pub fn suspicious_host(raw: &str) -> Option<String> {
	let host = raw.trim().to_ascii_lowercase();
	if host.contains("xn--") {
		return Some("punycode host".into());
	}
	// Mixed scripts (e.g. Cyrillic 'а' inside a Latin label) is the classic homoglyph
	// attack on an allow-listed host.
	let has_ascii = host.chars().any(|c| c.is_ascii_alphanumeric());
	let has_other = host.chars().any(|c| !c.is_ascii());
	if has_ascii && has_other {
		return Some("mixed-script host".into());
	}
	None
}
