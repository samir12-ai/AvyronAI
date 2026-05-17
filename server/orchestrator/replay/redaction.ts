/**
 * Task #89 / Phase 4-A — PII redaction for replay cassettes.
 *
 * Mandatory before persisting a cassette. The redaction map lives ONLY in
 * memory during the request that produces the cassette — once the cassette
 * is persisted, the original PII values are unrecoverable.
 *
 * Redacted field classes:
 *   - account_email          — anything that smells like an RFC-5322 address
 *   - social_handle          — @handles (Instagram, TikTok, Twitter style)
 *   - brand_dns_name         — bare hostnames / FQDNs (audit treats these as
 *                              private brand identity in the cassette context)
 *   - account_id / campaign_id when shaped as opaque UUIDs are NOT redacted
 *     (they are first-class join keys for player tests). Same-shape strings
 *     embedded in payload TEXT are also not touched — only typed PII patterns.
 *
 * Strategy: walk the cassette body, replace matched substrings with a stable
 * `redact:<sha256-12>` token. Same input → same token (so diff equality across
 * runs is preserved). The mapping is returned alongside the redacted body so
 * the recording site can attach it to an in-memory map keyed by jobId (and
 * dropped at request end).
 *
 * D5: missing fields are NOT silently substituted — `redactValue` only
 * rewrites when a regex actually matches.
 */
import { createHash } from "node:crypto";

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// @handle — allow letters/digits/underscores/dots, 2-30 chars after @, must
// be surrounded by non-word OR string boundary. Avoids matching e.g. "x@y"
// inside an email (handled first by EMAIL_RE).
const HANDLE_RE = /(^|[^A-Za-z0-9._@])@([A-Za-z0-9._]{2,30})\b/g;
// Bare hostname/FQDN with at least one dot, excluding email addresses
// (already redacted) and pure-numeric strings. Anchored to non-word chars.
const FQDN_RE = /\b((?:[a-z0-9-]+\.){1,}[a-z]{2,})\b/gi;

const HASH_PREFIX = "redact:";

function hashToken(value: string): string {
  const h = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${HASH_PREFIX}${h}`;
}

export class RedactionMap {
  private readonly originals = new Map<string, string>();
  /** token → original. Only the recording site has access; never serialised. */
  set(token: string, original: string): void {
    if (!this.originals.has(token)) this.originals.set(token, original);
  }
  get(token: string): string | undefined {
    return this.originals.get(token);
  }
  size(): number {
    return this.originals.size;
  }
  /** Wipe — call at request end so PII does not linger in memory. */
  clear(): void {
    this.originals.clear();
  }
}

/**
 * Redact one string. Order matters: email first (so the @handle regex does
 * not double-match the address local-part), then handles, then bare FQDNs.
 *
 * Returns the same string if nothing matched.
 */
export function redactString(input: string, map: RedactionMap): string {
  if (typeof input !== "string" || input.length === 0) return input;
  let out = input;
  out = out.replace(EMAIL_RE, (m) => {
    const token = hashToken(m.toLowerCase());
    map.set(token, m);
    return token;
  });
  out = out.replace(HANDLE_RE, (_full, lead, handle) => {
    const original = `@${handle}`;
    const token = hashToken(original.toLowerCase());
    map.set(token, original);
    return `${lead}${token}`;
  });
  out = out.replace(FQDN_RE, (m) => {
    // Skip if the match is already inside a token we just emitted.
    if (m.startsWith(HASH_PREFIX)) return m;
    // Skip common TLD-only false positives (single label).
    if (!m.includes(".")) return m;
    const token = hashToken(m.toLowerCase());
    map.set(token, m);
    return token;
  });
  return out;
}

/** Walk an arbitrary JSON value and redact every string in-place (immutable). */
export function redactValue<T>(value: T, map: RedactionMap): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value, map) as unknown as T;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, map)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactValue(v, map);
  }
  return out as T;
}
