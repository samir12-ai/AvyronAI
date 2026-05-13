/**
 * Seal #10 / Task #28 / F2.8 — global log-redaction helper.
 *
 * `logSafe(value)` returns a structurally-cloned copy of `value` with any
 * field whose key matches a secret/PII pattern stripped to "[REDACTED]",
 * AND any string value scanned for inline secret patterns (Bearer tokens,
 * API key prefixes, JWT-shaped strings, email addresses) — those substrings
 * are replaced with "[REDACTED]" inline.
 *
 * Use BEFORE handing data to console.log / structured logger / Sentry.
 *
 * NOT a substitute for Logger.stripSecrets() in server/logger.ts (which
 * targets pino-shape error objects). This helper is for engine-emitted
 * data structures (plans, snapshots, AI inputs) that may contain user
 * PII or authoritative tokens picked up from upstream payloads.
 */

const SECRET_KEY_RE =
  /^(token|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|authorization|cookie|password|jwt|bearer|email|phone|phone[_-]?number|ssn|dob|address)$/i;

const INLINE_SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
];

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MAX_STRING_LEN = 4096;

function redactString(s: string): string {
  if (typeof s !== "string") return s;
  if (s.length > MAX_STRING_LEN) s = s.slice(0, MAX_STRING_LEN) + "…";
  let out = s;
  for (const re of INLINE_SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

export function logSafe<T = any>(value: T, depth = 0): any {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[depth-limit]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (Array.isArray(value)) return value.map((v) => logSafe(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = logSafe(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/**
 * Convenience: stringify a value safely for log emission. Returns at most
 * `maxLen` characters of redacted JSON.
 */
export function logSafeJson(value: any, maxLen = 1200): string {
  try {
    const out = JSON.stringify(logSafe(value));
    return out.length > maxLen ? out.slice(0, maxLen) + "…" : out;
  } catch {
    return "[unserializable]";
  }
}
