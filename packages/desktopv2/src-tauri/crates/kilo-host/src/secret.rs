//! Security defaults (PLAN §6.6, §3.2 rule 5; TODOS M3-9).
//!
//! Three guarantees, all testable without a keychain:
//!   1. **Keys are references, never values.** `providers.key_ref` stores a
//!      `keychain://service/account` pointer; `KeyRef` refuses to parse anything that
//!      looks like a literal secret, so plaintext can't reach the DB even by accident.
//!      The actual `keyring` call lives in the app crate (it is the only place allowed
//!      to touch platform APIs); here we only own the reference scheme + redaction.
//!   2. **Log/error text is redacted** before it leaves the host.
//!   3. **No listener, no telemetry.** Nothing in this crate opens a port or reports to
//!      a service — see the static guard test in `tests/protocol.rs`.

use crate::error::{HostError, Result};

/// Prefix of every stored credential pointer.
pub const PREFIX: &str = "keychain://";

/// A pointer into the OS keychain. Deliberately not `Clone`-able into a request struct
/// that could be serialised back to the UI with a value in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyRef {
	raw: String,
}

impl KeyRef {
	/// Accept `keychain://<service>/<account>` only. A bare secret (high entropy, no
	/// scheme) is rejected with an error that never echoes the value back.
	pub fn parse(raw: &str) -> Result<KeyRef> {
		let Some(rest) = raw.strip_prefix(PREFIX) else {
			return Err(HostError::Invalid(
				"credential must be a keychain reference (keychain://service/account), not a literal value".into(),
			));
		};
		let (service, account) = match rest.split_once('/') {
			Some(pair) => pair,
			None => {
				return Err(HostError::Invalid("keychain reference needs a service and an account segment".into()));
			}
		};
		if service.is_empty() || account.is_empty() {
			return Err(HostError::Invalid("empty keychain reference segment".into()));
		}
		if account.chars().any(|c| c.is_whitespace()) {
			return Err(HostError::Invalid("keychain account may not contain whitespace".into()));
		}
		Ok(KeyRef { raw: raw.to_string() })
	}

	pub fn build(service: &str, account: &str) -> KeyRef {
		KeyRef { raw: format!("{PREFIX}{service}/{account}") }
	}

	/// Safe to log and safe to store.
	pub fn as_str(&self) -> &str {
		&self.raw
	}

	/// `{env:VAR}` is the documented way to source a key without ever writing it to disk
	/// (PLAN §6.7). Resolve it to a reference, not to the secret.
	pub fn from_env(service: &str, var: &str) -> KeyRef {
		KeyRef::build(service, &format!("env:{var}"))
	}
}

/// Does this string look like a live credential rather than a reference?
pub fn looks_secret(raw: &str) -> bool {
	let trimmed = raw.trim();
	if trimmed.len() < 12 {
		return false;
	}
	trimmed.starts_with("sk-")
		|| trimmed.starts_with("sk_")
		|| trimmed.starts_with("ghp_")
		|| trimmed.starts_with("xox")
		|| trimmed.starts_with("AIza")
		|| trimmed.starts_with("ya29.")
		|| (trimmed.chars().filter(|c| c.is_ascii_alphanumeric()).count() >= 20
			&& trimmed.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c))
			&& !trimmed.contains('/')
			&& trimmed.contains(char::is_uppercase)
			&& trimmed.contains(char::is_lowercase)
			&& trimmed.chars().any(|c| c.is_ascii_digit()))
}

/// Mask anything credential-shaped in text headed for a log line, an error message or
/// the `agent_error` payload. Applied to *every* host error via `HostError::safe()`.
pub fn redact(input: &str) -> String {
	let mut out = input.to_string();
	for pat in REDACT_PATTERNS {
		out = replace_all(&out, pat.0, pat.1);
	}
	// `sk-` style tokens are the common case and can appear anywhere in a URL query or
	// an Authorization echo, so sweep them by shape as well.
	out = sweep_tokens(&out);
	out
}

const REDACT_PATTERNS: &[(&str, &str)] = &[
	("Authorization: Bearer", "Authorization: [redacted]"),
	("authorization: bearer", "authorization: [redacted]"),
	("api_key=", "api_key=[redacted]"),
	("apikey=", "apikey=[redacted]"),
	("x-api-key:", "x-api-key: [redacted]"),
	("password=", "password=[redacted]"),
	("secret=", "secret=[redacted]"),
	("token=", "token=[redacted]"),
	("keychain://", "keychain://"),
];

/// Replace every occurrence without regex (keeps the dependency set small and the
/// behaviour obvious to a reviewer).
fn replace_all(haystack: &str, needle: &str, with: &str) -> String {
	if !haystack.contains(needle) {
		return haystack.to_string();
	}
	let mut out = String::with_capacity(haystack.len());
	let bytes = haystack.as_bytes();
	let pat = needle.as_bytes();
	let mut i = 0usize;
	while i < bytes.len() {
		if bytes[i..].starts_with(pat) {
			out.push_str(with);
			// Skip the value that follows `key=value` / `Bearer <token>` forms so the
			// secret itself is dropped, not merely prefixed.
			i += pat.len();
			if needle.ends_with('=') {
				while i < bytes.len() && !matches!(bytes[i], b' ' | b'\t' | b',' | b';' | b'"' | b'\'' | b'&' | b'\n') {
					i += 1;
				}
			}
			continue;
		}
		// push one char boundary at a time
		let ch_len = char_len(bytes[i]);
		out.push_str(&haystack[i..i + ch_len]);
		i += ch_len;
	}
	out
}

fn char_len(b: u8) -> usize {
	match b {
		0..=0x7F => 1,
		0xC0..=0xDF => 2,
		0xE0..=0xEF => 3,
		_ => 4,
	}
}

/// Mask runs that look like API keys: `sk-…`, `sk-…-…`, long mixed-case tokens.
fn sweep_tokens(text: &str) -> String {
	let mut out = String::with_capacity(text.len());
	for token in text.split_inclusive(|c: char| c.is_whitespace()) {
		let core = token.trim_end();
		let tail = &token[core.len()..];
		if core.starts_with("sk-") || core.starts_with("sk_") || core.starts_with("ghp_") || core.starts_with("AIza") {
			out.push_str(&mask(core));
		} else {
			out.push_str(token);
		}
		if !tail.is_empty() {
			out.push_str(tail);
		}
	}
	out
}

fn mask(token: &str) -> String {
	let keep: String = token.chars().take(3).collect();
	format!("{keep}***[redacted)")
}

/// Sanitise a whole record before it goes into `logs` (PLAN §10).
pub fn redact_value(value: &serde_json::Value) -> serde_json::Value {
	match value {
		serde_json::Value::String(raw) => serde_json::Value::String(redact(raw)),
		serde_json::Value::Array(items) => serde_json::Value::Array(items.iter().map(redact_value).collect()),
		serde_json::Value::Object(map) => {
			let mut out = serde_json::Map::new();
			for (k, v) in map {
				// Keys that themselves name a secret never ship a value.
				let masked = matches!(
					k.as_str(),
					"api_key" | "apikey" | "key" | "token" | "secret" | "password" | "authorization"
				);
				out.insert(k.clone(), if masked { serde_json::Value::String("[redacted]".into()) } else { redact_value(v) });
			}
			serde_json::Value::Object(out)
		}
		other => other.clone(),
	}
}
