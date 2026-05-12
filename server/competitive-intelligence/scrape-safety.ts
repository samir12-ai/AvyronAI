/**
 * Seal #5 — scraping security & reliability primitives.
 *
 * Single source of truth for:
 *   - SSRF defense (DNS resolve + IP block + DNS-rebinding pin)        F7.2
 *   - sha256 helpers for review IDs and author hashes                  F7.6 / F7.7
 *   - User-supplied handle/url validators                              F8.1
 *   - Module-level circuit breaker keyed by `${platform}:${zone}`      F6.12
 *   - safeFetch() helper that wraps fetch with AbortController         F6.7
 *
 * Imported by every scraper module.
 */

import { promises as dns } from "node:dns";
import * as net from "node:net";
import * as crypto from "node:crypto";
import type { LookupAddress } from "node:dns";

// ── F7.6 / F7.7 — sha256 helpers ─────────────────────────────────────────────

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function reviewIdHash(placeId: string, author: string, fullText: string, time: number | string): string {
  return sha256Hex(`${placeId}:${author}:${fullText}:${time}`).slice(0, 16);
}

export function authorHash(name: string): string {
  if (!name) return "";
  return sha256Hex(name).slice(0, 12);
}

// ── F8.1 — user-supplied input validators ────────────────────────────────────

const HANDLE_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;

export function validateHandle(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Handle must be a string");
  const trimmed = raw.trim().replace(/^@/, "");
  if (!HANDLE_REGEX.test(trimmed)) {
    throw new Error("Invalid handle format (allowed: a-z, A-Z, 0-9, dot, underscore, hyphen, max 64 chars)");
  }
  return trimmed;
}

export function validateUserUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("URL must be a string");
  let parsed: URL;
  try { parsed = new URL(raw.trim()); }
  catch { throw new Error("Invalid URL"); }
  if (parsed.protocol !== "https:") throw new Error("Only https URLs allowed");
  return parsed.toString();
}

// ── F7.2 — SSRF defense with DNS-rebinding pin ───────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "0.0.0.0", "metadata.google.internal",
  "169.254.169.254", "metadata", "kubernetes.default",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  // NOTE: bitwise `&` in JS returns int32 (signed). For ranges with the
  // high-bit set (e.g. 172.x, 192.x) `(n & mask)` is negative while the
  // hex literal is positive — they never compare equal. Coerce both sides
  // back to uint32 with `>>> 0` before comparing.
  const m24 = (n & 0xff000000) >>> 0;
  const m16 = (n & 0xffff0000) >>> 0;
  const m12 = (n & 0xfff00000) >>> 0;
  const m10 = (n & 0xffc00000) >>> 0;
  if (m24 === 0x00000000) return true; // 0.0.0.0/8
  if (m24 === 0x0a000000) return true; // 10.0.0.0/8
  if (m24 === 0x7f000000) return true; // 127.0.0.0/8
  if (m16 === 0xa9fe0000) return true; // 169.254.0.0/16 link-local
  if (m12 === 0xac100000) return true; // 172.16.0.0/12
  if (m16 === 0xc0a80000) return true; // 192.168.0.0/16
  if (m10 === 0x64400000) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // IPv4-mapped: ::ffff:a.b.c.d (also accept the colon-grouped form ::ffff:0:a.b.c.d)
  const mapped = lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  // Other internal IPv6 short forms after node's normalization
  if (lower === "::ffff:0:0" || lower === "::ffff:0.0.0.0") return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return false;
}

/**
 * Resolve URL hostname → check IP against block ranges → return parsed URL +
 * resolved IP so the caller can pin the connection (defeats DNS rebinding).
 *
 * Throws on:
 *   - non-http(s) protocol
 *   - hostname literally in BLOCKED_HOSTNAMES
 *   - hostname that is itself a blocked IP literal (decimal, hex, IPv6 internal)
 *   - hostname that resolves to a blocked IP via dns.lookup
 *   - .local / .internal TLDs
 */
export async function resolveSafeUrl(rawUrl: string): Promise<{ url: URL; ip: string; family: 4 | 6 }> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs allowed");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked hostname");
  if (host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Internal hostname blocked");
  // Decimal/hex/octal IPv4 literal: normalize via Number()
  if (/^\d+$/.test(host)) {
    const asInt = Number(host);
    if (!Number.isNaN(asInt)) {
      const a = (asInt >>> 24) & 0xff, b = (asInt >>> 16) & 0xff, c = (asInt >>> 8) & 0xff, d = asInt & 0xff;
      const dotted = `${a}.${b}.${c}.${d}`;
      if (isBlockedIPv4(dotted)) throw new Error(`Blocked decimal IP literal: ${host} → ${dotted}`);
    }
  }
  if (net.isIP(host) && isBlockedIp(host)) throw new Error(`Blocked IP literal: ${host}`);

  let lookup: LookupAddress;
  try { lookup = await dns.lookup(host, { verbatim: true }); }
  catch (err: any) { throw new Error(`DNS lookup failed for ${host}: ${err.message}`); }

  if (isBlockedIp(lookup.address)) {
    throw new Error(`Blocked resolved IP for ${host}: ${lookup.address}`);
  }

  return { url: parsed, ip: lookup.address, family: lookup.family as 4 | 6 };
}

/**
 * Build a `lookup` callback for fetch/undici that ALWAYS returns the
 * pre-resolved IP. This pins the connection to the IP we already validated,
 * so a second DNS query (e.g. by the agent) cannot re-resolve to an internal
 * IP between our check and the actual TCP connect.
 */
export function pinnedLookup(ip: string, family: 4 | 6): (hostname: string, opts: any, cb: any) => void {
  return (_hostname: string, _opts: any, cb: any) => {
    cb(null, ip, family);
  };
}

// ── F6.7 — abort wrapper ─────────────────────────────────────────────────────

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 15000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── F6.12 — circuit breaker keyed by `${platform}:${zone}` ───────────────────

type CBState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CBRecord {
  state: CBState;
  consecutiveFailures: number;
  windowStartMs: number;
  openedAtMs: number | null;
  halfOpenInflight: boolean;
}

const CB_FAILURE_THRESHOLD = 50;
const CB_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const CB_PROBE_AFTER_MS = 60 * 1000;

const breakers = new Map<string, CBRecord>();

function getOrCreateBreaker(key: string): CBRecord {
  let r = breakers.get(key);
  if (!r) {
    r = {
      state: "CLOSED",
      consecutiveFailures: 0,
      windowStartMs: Date.now(),
      openedAtMs: null,
      halfOpenInflight: false,
    };
    breakers.set(key, r);
  }
  return r;
}

export function isBreakerOpen(platform: string, zone: string): { open: boolean; reason?: string } {
  const key = `${platform}:${zone}`;
  const r = getOrCreateBreaker(key);
  const now = Date.now();
  if (r.state === "OPEN" && r.openedAtMs !== null) {
    if (now - r.openedAtMs >= CB_PROBE_AFTER_MS && !r.halfOpenInflight) {
      r.state = "HALF_OPEN";
      r.halfOpenInflight = true;
      return { open: false, reason: "HALF_OPEN_PROBE" };
    }
    return { open: true, reason: "OPEN" };
  }
  // Architect-#10 fix: while HALF_OPEN with an in-flight probe, block all
  // additional callers. Only the single probe call is allowed through.
  // recordBreakerSuccess/recordBreakerFailure clears halfOpenInflight.
  if (r.state === "HALF_OPEN" && r.halfOpenInflight) {
    return { open: true, reason: "HALF_OPEN_PROBE_INFLIGHT" };
  }
  return { open: false };
}

export function recordBreakerSuccess(platform: string, zone: string): void {
  const key = `${platform}:${zone}`;
  const r = getOrCreateBreaker(key);
  if (r.state === "HALF_OPEN" || r.state === "OPEN") {
    console.log(`[CircuitBreaker] CLOSE | ${key} (success after ${r.consecutiveFailures} failures)`);
  }
  r.state = "CLOSED";
  r.consecutiveFailures = 0;
  r.openedAtMs = null;
  r.halfOpenInflight = false;
  r.windowStartMs = Date.now();
}

export function recordBreakerFailure(platform: string, zone: string): void {
  const key = `${platform}:${zone}`;
  const r = getOrCreateBreaker(key);
  const now = Date.now();
  if (r.state === "HALF_OPEN") {
    r.state = "OPEN";
    r.openedAtMs = now;
    r.halfOpenInflight = false;
    console.log(`[CircuitBreaker] OPEN | ${key} (half-open probe failed)`);
    return;
  }
  if (now - r.windowStartMs > CB_FAILURE_WINDOW_MS) {
    r.windowStartMs = now;
    r.consecutiveFailures = 0;
  }
  r.consecutiveFailures++;
  if (r.consecutiveFailures >= CB_FAILURE_THRESHOLD && r.state === "CLOSED") {
    r.state = "OPEN";
    r.openedAtMs = now;
    console.log(`[CircuitBreaker] OPEN | ${key} (${r.consecutiveFailures} failures in ${CB_FAILURE_WINDOW_MS / 1000}s)`);
  }
}

export function _resetBreakersForTest(): void {
  breakers.clear();
}
export function _getBreakerStateForTest(platform: string, zone: string): CBRecord | undefined {
  return breakers.get(`${platform}:${zone}`);
}
