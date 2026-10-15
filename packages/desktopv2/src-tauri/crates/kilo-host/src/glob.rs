//! Glob matching for permission matchers (PLAN §6.6) and `.gitignore` (PLAN §6.8).
//!
//! Hand-rolled rather than pulling a crate: these two domains need *different*
//! wildcard semantics and both must be assertable precisely in tests.
//!
//! Path patterns are split on `/` and matched segment-by-segment:
//!   `?`     one char
//!   `*`     any run of chars, but never across a `/` (segment-local)
//!   `**`    a whole segment: matches any number of segments, including zero
//!   `{a,b}` alternation inside a segment, may nest
//!   `\c`    escapes `c`
//!
//! So `src/*.ts` matches `src/a.ts` and not `src/a/b.ts`, while `**/*.ts` matches both.
//!
//! Commands (the bash matcher) contain no `/`, hence `*` freely spans spaces — exactly
//! the "command prefix glob" of PLAN §6.6: `git diff*` matches `git diff --stat`.
//!
//! Hosts get their own function with certificate-style semantics, because letting `*`
//! cross `.` would have `*.example.com` authorise `evil-example.com`.
//!
//! Matching is plain recursion with backtracking. Patterns here come from a settings
//! file and are capped by `validate`, so the worst case is irrelevant next to the
//! clarity and auditability it buys.

use crate::error::{HostError, Result};

/// Longest pattern we accept — bounds the backtracking cost above.
pub const MAX_PATTERN: usize = 512;

/// Path or generic glob, anchored at both ends.
pub fn match_glob(pattern: &str, text: &str) -> bool {
	let pp: Vec<&str> = pattern.split('/').collect();
	let tt: Vec<&str> = text.split('/').collect();
	seg(&pp, 0, &tt, 0)
}

fn seg(pp: &[&str], mut pi: usize, tt: &[&str], mut ti: usize) -> bool {
	loop {
		let Some(pat) = pp.get(pi) else {
			return ti == tt.len();
		};
		if *pat == "**" {
			for k in ti..=tt.len() {
				if seg(pp, pi + 1, tt, k) {
					return true;
				}
			}
			return false;
		}
		let Some(txt) = tt.get(ti) else {
			return false;
		};
		if !wild(pat, txt) {
			return false;
		}
		pi += 1;
		ti += 1;
	}
}

/// Single-segment wildcard match.
pub fn wild(pattern: &str, text: &str) -> bool {
	let p: Vec<char> = pattern.chars().collect();
	let t: Vec<char> = text.chars().collect();
	walk(&p, 0, &t, 0)
}

fn walk(p: &[char], mut pi: usize, t: &[char], mut ti: usize) -> bool {
	loop {
		if pi >= p.len() {
			return ti == t.len();
		}
		match p[pi] {
			'*' => {
				pi += 1;
				for k in ti..=t.len() {
					if walk(p, pi, t, k) {
						return true;
					}
				}
				return false;
			}
			'?' => {
				if ti >= t.len() {
					return false;
				}
				pi += 1;
				ti += 1;
			}
			'\\' => {
				let Some(lit) = p.get(pi + 1) else {
					return ti >= t.len();
				};
				if ti >= t.len() || t[ti] != *lit {
					return false;
				}
				pi += 2;
				ti += 1;
			}
			'{' => {
				let Some(close) = close_brace(p, pi) else {
					// Unbalanced: treat `{` as a literal rather than rejecting the rule.
					if ti >= t.len() || t[ti] != '{' {
						return false;
					}
					pi += 1;
					ti += 1;
					continue;
				};
				let tail = &p[close + 1..];
				for alt in alternatives(&p[pi + 1..close]) {
					let mut next: Vec<char> = Vec::with_capacity(alt.len() + tail.len());
					next.extend_from_slice(alt);
					next.extend_from_slice(tail);
					if walk(&next, 0, t, ti) {
						return true;
					}
				}
				return false;
			}
			lit => {
				if ti >= t.len() || t[ti] != lit {
					return false;
				}
				pi += 1;
				ti += 1;
			}
		}
	}
}

fn close_brace(p: &[char], open: usize) -> Option<usize> {
	let mut depth = 0usize;
	for (i, c) in p.iter().enumerate().skip(open) {
		match c {
			'{' => depth += 1,
			'}' => {
				depth -= 1;
				if depth == 0 {
					return Some(i);
				}
			}
			_ => {}
		}
	}
	None
}

/// Split a brace body on top-level commas.
fn alternatives(body: &[char]) -> Vec<&[char]> {
	let mut out = Vec::new();
	let mut depth = 0usize;
	let mut start = 0usize;
	for (i, c) in body.iter().enumerate() {
		match c {
			'{' => depth += 1,
			'}' => depth = depth.saturating_sub(1),
			',' if depth == 0 => {
				out.push(&body[start..i]);
				start = i + 1;
			}
			_ => {}
		}
	}
	out.push(&body[start..]);
	out
}

/// Command-prefix glob (PLAN §6.6 `command` matcher).
pub fn match_command(pattern: &str, command: &str) -> bool {
	// A trailing `*`-less pattern is a *prefix* glob, so `git diff` must also match
	// `git diff --stat`; anchor the remainder explicitly.
	let p = pattern.trim();
	let c = command.trim();
	if p.contains('*') || p.contains('?') || p.contains('{') {
		return match_glob(p, c);
	}
	c == p || c.starts_with(&format!("{p} "))
}

/// Host glob with certificate semantics. A leading `*.` means "one or more extra
/// labels"; a pattern without wildcards is an exact case-insensitive compare.
pub fn match_host(pattern: &str, host: &str) -> bool {
	let p = pattern.trim().to_ascii_lowercase();
	let h = host.trim().trim_end_matches('/').to_ascii_lowercase();
	if let Some(rest) = p.strip_prefix("*.") {
		let Some(prefix) = h.strip_suffix(rest) else {
			return false;
		};
		// `prefix` is everything before the suffix and must be at least one label plus the dot
		return prefix.len() > 1 && prefix.ends_with('.');
	}
	if p.contains('*') || p.contains('?') {
		return match_glob(&p, &h);
	}
	p == h
}

/// Reject patterns that would silently never match, so `permission_set` fails loudly.
pub fn validate(pattern: &str) -> Result<()> {
	if pattern.len() > MAX_PATTERN {
		return Err(HostError::Perms(format!(
			"glob longer than {MAX_PATTERN} chars: `{}`",
			&pattern.chars().take(32).collect::<String>()
		)));
	}
	let mut stack: Vec<char> = Vec::new();
	let mut prev: Option<char> = None;
	for c in pattern.chars() {
		if c == '{' || c == '[' {
			stack.push(if c == '{' { '}' } else { ']' });
		}
		if c == '}' || c == ']' {
			let Some(want) = stack.pop() else {
				return Err(HostError::Perms(format!("unbalanced `{c}` in glob `{pattern}`")));
			};
			if want != c {
				return Err(HostError::Perms(format!("mismatched bracket in glob `{pattern}`")));
			}
		}
		if c == '*' && prev == Some('*') {
			// `***` is meaningless to us; reject instead of half-supporting it.
			return Err(HostError::Perms(format!("`***` is not supported in glob `{pattern}`")));
		}
		prev = Some(c);
	}
	if !stack.is_empty() {
		return Err(HostError::Perms(format!("unclosed bracket in glob `{pattern}`")));
	}
	Ok(())
}
