import * as crypto from "crypto";
import { LRUCache } from "lru-cache";
import {
  unlockerRequest,
  ScrapingUnconfiguredError,
  BRIGHT_DATA_TIMEOUT_MS,
} from "./brightdata-client";

// Re-exported so scrapers can catch the typed error / read the timeout knob
// WITHOUT importing brightdata-client directly (forbidden by ESLint rule
// `scraping-transport/no-direct-brightdata-client-import` — the pool manager
// is the single sanctioned transport gateway).
export { ScrapingUnconfiguredError, BRIGHT_DATA_TIMEOUT_MS };

const QUARANTINE_THRESHOLD = 2;
const QUARANTINE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_QUARANTINE_MS = 30 * 60 * 1000;
const MAX_QUARANTINE_MS = 120 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_RETRIES_PER_STAGE = 3;
const RETRY_DELAYS: [number, number][] = [[10000, 25000], [30000, 60000]];

export type BlockClass = "PROXY_BLOCKED" | "RATE_LIMIT" | "AUTH_REQUIRED" | "CHECKPOINT" | "OTHER";

/**
 * A logical scrape session. Since the 2026-07 Unlocker-API rebuild there is
 * no proxy identity (host/port/credentials/dispatcher) attached — Bright Data
 * manages IPs server-side per request. `sessionId`/`ipHash` survive as a
 * LOGICAL session-hash used for sticky bookkeeping, quarantine backoff, and
 * telemetry correlation — they do NOT correspond to a literal upstream IP.
 */
export interface ProxySession {
  sessionId: string;
  ipHash: string;
  createdAt: number;
  successCount: number;
  blockCount: number;
  lastBlockAt: number | null;
  previousBlockAt: number | null;
  cooldownUntil: number | null;
  isQuarantined: boolean;
}

export interface ProxyTelemetryEntry {
  timestamp: number;
  accountId: string;
  campaignId: string;
  competitorHash: string;
  proxySessionId: string;
  ipHash: string;
  stageName: string;
  attemptNumber: number;
  httpStatus: number | null;
  blockClass: BlockClass | null;
  durationMs: number;
  success: boolean;
}

interface AccountPool {
  sessions: LRUCache<string, ProxySession>;
  telemetry: ProxyTelemetryEntry[];
  stickyBindings: LRUCache<string, string>;
}

// F6.2 — strict LRU+TTL via lru-cache. `pools` and per-pool
// `stickyBindings` both expire after 24h regardless of access.
const MAX_POOLS = parseInt(process.env.PROXY_MAX_POOLS || "10000", 10);
const MAX_STICKY_BINDINGS = parseInt(process.env.PROXY_MAX_STICKY_BINDINGS || "500", 10);
const MAX_SESSIONS_PER_POOL = parseInt(process.env.PROXY_MAX_SESSIONS_PER_POOL || "100", 10);
const POOL_TTL_MS = parseInt(process.env.PROXY_POOL_TTL_MS || String(24 * 60 * 60 * 1000), 10);
export const STICKY_BINDING_TTL_MS = parseInt(
  process.env.PROXY_STICKY_BINDING_TTL_MS || String(24 * 60 * 60 * 1000),
  10,
);
const MAX_TELEMETRY_PER_ACCOUNT = 500;

const pools = new LRUCache<string, AccountPool>({
  max: MAX_POOLS,
  ttl: POOL_TTL_MS,
  updateAgeOnGet: true,
  ttlAutopurge: false,
});

export interface ScrapingConfig {
  apiKey: string;
  zone: string;
  /** ISO-3166 alpha-2 lowercase, or null → zone default geo. */
  country: string | null;
}

/**
 * Env contract (2026-07 Unlocker rebuild):
 *   BRIGHT_DATA_API_KEY — Bearer key for api.brightdata.com
 *   BRIGHT_DATA_ZONE    — Unlocker zone name (e.g. "marketmindai")
 *   BRIGHT_DATA_COUNTRY — optional 2-letter geo target
 *
 * Both API_KEY and ZONE must be present; anything else is unconfigured.
 * Partial configuration is boot-FATAL in env-validator; returning null here
 * is the runtime defense-in-depth for the same rule (D5: missing canonical
 * config never silently substitutes).
 */
export function getScrapingConfig(): ScrapingConfig | null {
  const apiKey = process.env.BRIGHT_DATA_API_KEY?.trim();
  const zone = process.env.BRIGHT_DATA_ZONE?.trim();
  if (!apiKey || !zone) return null;
  return { apiKey, zone, country: resolveScrapingCountry() };
}

let warnedInvalidCountry = false;

/**
 * Strict country resolution: a valid ISO-3166 alpha-2 code or null (zone
 * default). NO silent "us" fallback and NO country-name mapping — a malformed
 * BRIGHT_DATA_COUNTRY is boot-FATAL in env-validator; if one is somehow seen
 * at runtime it is IGNORED loudly rather than misdirected (B2/B3).
 */
export function resolveScrapingCountry(): string | null {
  const raw = (process.env.BRIGHT_DATA_COUNTRY || "").trim();
  if (!raw) return null;
  if (/^[a-zA-Z]{2}$/.test(raw)) return raw.toLowerCase();
  if (!warnedInvalidCountry) {
    warnedInvalidCountry = true;
    console.error(
      `[ProxyPool] INVALID_COUNTRY_FORMAT | BRIGHT_DATA_COUNTRY="${raw}" is not an ISO-3166 alpha-2 code (e.g. "ae", "us"). Value IGNORED — requests use the zone's default geo. Boot validation should have rejected this.`,
    );
  }
  return null;
}

function computeIpHash(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

function jitteredDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, ms));
}

function newPool(): AccountPool {
  return {
    sessions: new LRUCache<string, ProxySession>({ max: MAX_SESSIONS_PER_POOL, ttl: SESSION_TTL_MS }),
    telemetry: [],
    stickyBindings: new LRUCache<string, string>({
      max: MAX_STICKY_BINDINGS,
      ttl: STICKY_BINDING_TTL_MS,
      updateAgeOnGet: true,
    }),
  };
}

function getOrCreatePool(accountId: string): AccountPool {
  let pool = pools.get(accountId);
  if (!pool) {
    pool = newPool();
    pools.set(accountId, pool);
  }
  return pool;
}

/** Test helper: drops all pools (used between vitest cases). */
export function _resetPoolsForTesting(): void {
  pools.clear();
}

/** Test helper: count pools currently held in the LRU. */
export function _poolCountForTesting(): number {
  return pools.size;
}

function createSession(accountId: string): ProxySession | null {
  const config = getScrapingConfig();
  if (!config) return null;

  const shortAccount = accountId.substring(0, 8);
  const ts = (Date.now() % 1000000).toString(36);
  const rand = Math.random().toString(36).substr(2, 4);
  const sessionId = `s${shortAccount}${ts}${rand}`;

  const session: ProxySession = {
    sessionId,
    ipHash: computeIpHash(sessionId),
    createdAt: Date.now(),
    successCount: 0,
    blockCount: 0,
    lastBlockAt: null,
    previousBlockAt: null,
    cooldownUntil: null,
    isQuarantined: false,
  };

  const pool = getOrCreatePool(accountId);
  pool.sessions.set(sessionId, session);
  return session;
}

export function recordSuccess(accountId: string, sessionId: string): void {
  const pool = getOrCreatePool(accountId);
  const session = pool.sessions.get(sessionId);
  if (session) {
    session.successCount++;
    session.previousBlockAt = session.lastBlockAt;
    session.lastBlockAt = null;
  }
}

export function recordBlock(accountId: string, sessionId: string): void {
  const pool = getOrCreatePool(accountId);
  const session = pool.sessions.get(sessionId);
  if (!session) return;

  const now = Date.now();
  session.blockCount++;
  session.previousBlockAt = session.lastBlockAt;
  session.lastBlockAt = now;

  if (session.previousBlockAt && (now - session.previousBlockAt) <= QUARANTINE_WINDOW_MS) {
    quarantineSession(accountId, session, now);
  }
}

function quarantineSession(accountId: string, session: ProxySession, now: number): void {
  const baseDuration = DEFAULT_QUARANTINE_MS;
  const exponentialFactor = Math.min(Math.pow(2, session.blockCount - QUARANTINE_THRESHOLD), 4);
  const duration = Math.min(baseDuration * exponentialFactor, MAX_QUARANTINE_MS);

  session.isQuarantined = true;
  session.cooldownUntil = now + duration;

  console.log(`[ProxyPool] QUARANTINE | account=${accountId} | session=${session.sessionId} | duration=${duration}ms | blockCount=${session.blockCount}`);
}

function addTelemetry(accountId: string, entry: ProxyTelemetryEntry): void {
  const pool = getOrCreatePool(accountId);
  pool.telemetry.push(entry);
  if (pool.telemetry.length > MAX_TELEMETRY_PER_ACCOUNT) {
    pool.telemetry = pool.telemetry.slice(-MAX_TELEMETRY_PER_ACCOUNT);
  }
}

/**
 * Classifies a failed/blocked scrape attempt.
 *
 * `brdErrorCode` is the `x-brd-err-code` response header from the Unlocker
 * API (surfaced on every poolFetch Response). Documented codes:
 *   - sr_rate_limit → zone hit its request rate limit (HTTP 429).
 * Unknown brd codes fall through to status/message heuristics.
 */
export function classifyBlock(
  httpStatus: number | null,
  errorMessage: string,
  brdErrorCode?: string | null,
): BlockClass {
  const code = (brdErrorCode || "").toLowerCase();
  if (code === "sr_rate_limit") return "RATE_LIMIT";

  const msg = (errorMessage || "").toLowerCase();
  if (msg.includes("proxy") || msg.includes("tunnel") || msg.includes("connect")) return "PROXY_BLOCKED";
  if (httpStatus === 429 || msg.includes("rate limit") || msg.includes("wait a few minutes")) return "RATE_LIMIT";
  if (httpStatus === 401 || msg.includes("require_login") || msg.includes("auth")) return "AUTH_REQUIRED";
  if (msg.includes("checkpoint") || msg.includes("challenge")) return "CHECKPOINT";
  if (httpStatus === 403 || msg.includes("blocked") || msg.includes("forbidden")) return "PROXY_BLOCKED";
  return "OTHER";
}

export interface PoolFetchInit {
  /** Wall-clock ceiling for this request. Default: BRIGHT_DATA_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface StickySessionContext {
  accountId: string;
  campaignId: string;
  competitorHash: string;
  session: ProxySession;
  attemptNumber: number;
  usedSessionIds: Set<string>;
  /**
   * Transport for this sticky session. Routes through the Unlocker API
   * client. Throws ScrapingUnconfiguredError when BRIGHT_DATA_API_KEY/ZONE
   * are absent — there is NO direct-fetch fallback anywhere (safe-off).
   * Custom request headers are intentionally NOT supported: the Unlocker
   * API manages fingerprints (UA, TLS, headers) server-side.
   */
  poolFetch(url: string, init?: PoolFetchInit): Promise<Response>;
}

async function executePoolFetch(url: string, init?: PoolFetchInit): Promise<Response> {
  const config = getScrapingConfig();
  if (!config) throw new ScrapingUnconfiguredError();
  const result = await unlockerRequest({
    apiKey: config.apiKey,
    zone: config.zone,
    url,
    country: config.country,
    timeoutMs: init?.timeoutMs,
  });
  return result.response;
}

/**
 * One-shot transport for scrapers that do not hold a sticky session
 * (reviews, TikTok, website/blog). Same contract as ctx.poolFetch.
 */
export async function poolFetch(url: string, init?: PoolFetchInit): Promise<Response> {
  return executePoolFetch(url, init);
}

function buildCtx(base: Omit<StickySessionContext, "poolFetch">): StickySessionContext {
  return {
    ...base,
    poolFetch: (url: string, init?: PoolFetchInit) => executePoolFetch(url, init),
  };
}

export function acquireStickySession(
  accountId: string,
  campaignId: string,
  competitorHash: string,
): StickySessionContext | null {
  const pool = getOrCreatePool(accountId);
  const bindingKey = `${accountId}:${campaignId}:${competitorHash}`;

  // lru-cache.get() bumps recency AND is null when the entry has TTL-expired,
  // so we get strict 24h sticky-binding semantics for free.
  const existingSessionId = pool.stickyBindings.get(bindingKey);
  if (existingSessionId) {
    const existingSession = pool.sessions.get(existingSessionId);
    if (existingSession && !existingSession.isQuarantined && Date.now() - existingSession.createdAt < SESSION_TTL_MS) {
      return buildCtx({
        accountId, campaignId, competitorHash,
        session: existingSession,
        attemptNumber: 1,
        usedSessionIds: new Set([existingSessionId]),
      });
    }
    pool.stickyBindings.delete(bindingKey);
  }

  const session = createSession(accountId);
  if (!session) return null;

  pool.stickyBindings.set(bindingKey, session.sessionId);
  return buildCtx({
    accountId, campaignId, competitorHash,
    session,
    attemptNumber: 1,
    usedSessionIds: new Set([session.sessionId]),
  });
}

export function rotateSessionOnBlock(ctx: StickySessionContext, blockClass: BlockClass): StickySessionContext | null {
  const allowedRotation = blockClass === "PROXY_BLOCKED" || blockClass === "RATE_LIMIT";
  if (!allowedRotation) {
    console.log(`[ProxyPool] ROTATION_DENIED | blockClass=${blockClass} | Only PROXY_BLOCKED and RATE_LIMIT allow rotation`);
    return null;
  }

  recordBlock(ctx.accountId, ctx.session.sessionId);

  if (ctx.attemptNumber >= MAX_RETRIES_PER_STAGE) {
    console.log(`[ProxyPool] MAX_RETRIES_REACHED | account=${ctx.accountId} | competitor=${ctx.competitorHash} | attempts=${ctx.attemptNumber}`);
    return null;
  }

  const newSession = createSession(ctx.accountId);
  if (!newSession) return null;

  const pool = getOrCreatePool(ctx.accountId);
  const bindingKey = `${ctx.accountId}:${ctx.campaignId}:${ctx.competitorHash}`;
  pool.stickyBindings.set(bindingKey, newSession.sessionId);

  const newUsed = new Set(ctx.usedSessionIds);
  newUsed.add(newSession.sessionId);

  console.log(`[ProxyPool] SESSION_ROTATED | account=${ctx.accountId} | oldSession=${ctx.session.sessionId} | newSession=${newSession.sessionId} | attempt=${ctx.attemptNumber + 1} | blockClass=${blockClass}`);

  return buildCtx({
    accountId: ctx.accountId,
    campaignId: ctx.campaignId,
    competitorHash: ctx.competitorHash,
    session: newSession,
    attemptNumber: ctx.attemptNumber + 1,
    usedSessionIds: newUsed,
  });
}

export async function getRetryDelay(attemptNumber: number): Promise<void> {
  const idx = Math.min(attemptNumber - 2, RETRY_DELAYS.length - 1);
  if (idx < 0) return;
  const [min, max] = RETRY_DELAYS[idx];
  await jitteredDelay(min, max);
}

export function getRetryDelayRange(attemptNumber: number): { min: number; max: number } {
  const delayIdx = Math.min(attemptNumber - 1, RETRY_DELAYS.length - 1);
  const [min, max] = RETRY_DELAYS[delayIdx];
  return { min, max };
}

export function recordTelemetry(entry: ProxyTelemetryEntry): void {
  addTelemetry(entry.accountId, entry);
}

export interface AccountPoolStats {
  accountId: string;
  totalSessions: number;
  healthySessions: number;
  quarantinedSessions: number;
  stickyBindings: number;
  recentTelemetryCount: number;
}

export function getPoolStats(accountId: string): AccountPoolStats {
  const pool = getOrCreatePool(accountId);
  const now = Date.now();

  let healthy = 0;
  let quarantined = 0;

  for (const session of pool.sessions.values()) {
    if (session.isQuarantined) {
      quarantined++;
    } else if (now - session.createdAt < SESSION_TTL_MS) {
      healthy++;
    }
  }

  return {
    accountId,
    totalSessions: pool.sessions.size,
    healthySessions: healthy,
    quarantinedSessions: quarantined,
    stickyBindings: pool.stickyBindings.size,
    recentTelemetryCount: pool.telemetry.length,
  };
}

export function getRecentTelemetry(accountId: string, limit = 50): ProxyTelemetryEntry[] {
  const pool = getOrCreatePool(accountId);
  return pool.telemetry.slice(-limit);
}

export function releaseStickySession(ctx: StickySessionContext): void {
  const pool = getOrCreatePool(ctx.accountId);
  const bindingKey = `${ctx.accountId}:${ctx.campaignId}:${ctx.competitorHash}`;
  pool.stickyBindings.delete(bindingKey);
}

export function logProxyTelemetry(
  ctx: StickySessionContext,
  stageName: string,
  httpStatus: number | null,
  blockClass: BlockClass | null,
  durationMs: number,
  success: boolean,
): void {
  const entry: ProxyTelemetryEntry = {
    timestamp: Date.now(),
    accountId: ctx.accountId,
    campaignId: ctx.campaignId,
    competitorHash: ctx.competitorHash,
    proxySessionId: ctx.session.sessionId,
    ipHash: ctx.session.ipHash,
    stageName,
    attemptNumber: ctx.attemptNumber,
    httpStatus,
    blockClass,
    durationMs,
    success,
  };
  addTelemetry(ctx.accountId, entry);
  if (success) recordSuccess(ctx.accountId, ctx.session.sessionId);
  console.log(`[ProxyTelemetry] account=${ctx.accountId} | campaign=${ctx.campaignId} | competitor=${ctx.competitorHash} | session=${ctx.session.sessionId} | ipHash=${ctx.session.ipHash} | stage=${stageName} | attempt=${ctx.attemptNumber} | http=${httpStatus ?? "N/A"} | block=${blockClass ?? "NONE"} | duration=${durationMs}ms | success=${success}`);
}

export function getPoolDiagnostics(accountId: string): {
  totalSessions: number;
  activeSessions: number;
  quarantinedSessions: number;
  totalTelemetryEntries: number;
  recentBlocks: number;
  recentSuccesses: number;
  stickyBindings: number;
} {
  const pool = getOrCreatePool(accountId);
  const now = Date.now();
  let active = 0;
  let quarantined = 0;
  for (const session of pool.sessions.values()) {
    if (session.isQuarantined) { quarantined++; continue; }
    if (now - session.createdAt < SESSION_TTL_MS) active++;
  }
  const recentWindow = 10 * 60 * 1000;
  const recentEntries = pool.telemetry.filter(e => now - e.timestamp < recentWindow);
  return {
    totalSessions: pool.sessions.size,
    activeSessions: active,
    quarantinedSessions: quarantined,
    totalTelemetryEntries: pool.telemetry.length,
    recentBlocks: recentEntries.filter(e => !e.success).length,
    recentSuccesses: recentEntries.filter(e => e.success).length,
    stickyBindings: pool.stickyBindings.size,
  };
}

export function getTelemetryForJob(accountId: string, competitorHash?: string): ProxyTelemetryEntry[] {
  const pool = pools.get(accountId);
  if (!pool) return [];
  if (competitorHash) return pool.telemetry.filter(e => e.competitorHash === competitorHash);
  return [...pool.telemetry];
}

export function clearPool(accountId: string): void {
  pools.delete(accountId);
}

export function isSessionQuarantined(accountId: string, sessionId: string): boolean {
  const pool = pools.get(accountId);
  if (!pool) return false;
  const session = pool.sessions.get(sessionId);
  if (!session) return false;
  return session.isQuarantined && (!session.cooldownUntil || Date.now() < session.cooldownUntil);
}

export function getActivePoolCount(): number {
  return pools.size;
}

export interface ScrapingConnectivityResult {
  ok: boolean;
  configured: true;
  status: number | null;
  brdErrorCode: string | null;
  durationMs: number;
  detail: string;
}

/**
 * Live connectivity probe for the /api/proxy/health endpoint. Sends ONE
 * Unlocker request to Bright Data's documented test target. Never throws;
 * never logs or returns the API key.
 */
export async function testScrapingConnectivity(): Promise<ScrapingConnectivityResult | { ok: false; configured: false; detail: string }> {
  const config = getScrapingConfig();
  if (!config) {
    return { ok: false, configured: false, detail: "SCRAPING_UNCONFIGURED — BRIGHT_DATA_API_KEY / BRIGHT_DATA_ZONE not set" };
  }
  const startMs = Date.now();
  try {
    const result = await unlockerRequest({
      apiKey: config.apiKey,
      zone: config.zone,
      url: "https://geo.brdtest.com/welcome.txt",
      country: config.country,
      timeoutMs: 30_000,
    });
    const ok = result.status >= 200 && result.status < 300 && !result.brdErrorCode;
    return {
      ok,
      configured: true,
      status: result.status,
      brdErrorCode: result.brdErrorCode,
      durationMs: result.durationMs,
      detail: ok
        ? `Unlocker API reachable | zone=${config.zone} | country=${config.country ?? "zone-default"} | ${result.durationMs}ms`
        : `Unlocker API returned status=${result.status}${result.brdErrorCode ? ` brdErrorCode=${result.brdErrorCode}` : ""}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      configured: true,
      status: null,
      brdErrorCode: null,
      durationMs: Date.now() - startMs,
      detail: `Connectivity test failed: ${err?.message || String(err)}`,
    };
  }
}

// Explicit session-selection helper retained for tests / future upgrades.
export function selectHealthySessionForTesting(accountId: string, excludeIds: Set<string> = new Set()): ProxySession | null {
  const pool = getOrCreatePool(accountId);
  const now = Date.now();
  for (const session of pool.sessions.values()) {
    if (excludeIds.has(session.sessionId)) continue;
    if (now - session.createdAt > SESSION_TTL_MS) {
      pool.sessions.delete(session.sessionId);
      continue;
    }
    if (session.isQuarantined) {
      if (session.cooldownUntil && session.cooldownUntil <= now) {
        session.isQuarantined = false;
        session.cooldownUntil = null;
        session.blockCount = 0;
        session.previousBlockAt = null;
        session.lastBlockAt = null;
        console.log(`[ProxyPool] QUARANTINE_RECOVERED | account=${accountId} | session=${session.sessionId}`);
      } else {
        continue;
      }
    } else if (session.cooldownUntil && session.cooldownUntil > now) {
      continue;
    }
    return session;
  }
  return null;
}

export { MAX_RETRIES_PER_STAGE, SESSION_TTL_MS, QUARANTINE_THRESHOLD, QUARANTINE_WINDOW_MS, DEFAULT_QUARANTINE_MS };
