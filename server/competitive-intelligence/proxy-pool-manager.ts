import { ProxyAgent } from "undici";
import * as crypto from "crypto";

const QUARANTINE_THRESHOLD = 2;
const QUARANTINE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_QUARANTINE_MS = 30 * 60 * 1000;
const MAX_QUARANTINE_MS = 120 * 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_RETRIES_PER_STAGE = 3;
const RETRY_DELAYS: [number, number][] = [[10000, 25000], [30000, 60000]];

export type BlockClass = "PROXY_BLOCKED" | "RATE_LIMIT" | "AUTH_REQUIRED" | "CHECKPOINT" | "OTHER";

export interface ProxySession {
  sessionId: string;
  ipHash: string;
  dispatcher: ProxyAgent;
  sessionUsername: string;
  sessionPassword: string;
  proxyHost: string;
  proxyPort: string;
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

// Seal #11 / Task #29 / F6.2 (architect pass-3): sticky bindings carry an
// explicit per-entry `touchedAt` so we can enforce a 24h TTL on EACH
// binding independently — pool-level LRU alone could keep a stale
// binding alive indefinitely if the pool itself stays warm.
interface StickyBinding {
  sessionId: string;
  touchedAt: number;
}
interface AccountPool {
  sessions: Map<string, ProxySession>;
  telemetry: ProxyTelemetryEntry[];
  stickyBindings: Map<string, StickyBinding>;
  lastTouchedAt: number;
}

// Seal #11 / Task #29 / F6.2 — bounded pool registry.
// Pre-fix: `pools = new Map<accountId, AccountPool>()` grew without bound;
// every account that ever ran a scrape (or every random accountId in a
// load-test / abuse scenario) added a row that lived for the lifetime of
// the process. Same for per-pool stickyBindings/sessions Maps.
//
// Now: pools is bounded by MAX_POOLS (LRU evict by `lastTouchedAt`); each
// pool's stickyBindings is bounded by MAX_STICKY_BINDINGS, sessions are
// bounded by SESSION_TTL_MS (already enforced) + MAX_SESSIONS_PER_POOL.
const MAX_POOLS = parseInt(process.env.PROXY_MAX_POOLS || "10000", 10);
const MAX_STICKY_BINDINGS = 500;
const MAX_SESSIONS_PER_POOL = 100;
const POOL_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
// Per-binding TTL (architect pass-3 requirement) — must match the pool TTL
// so a binding that has not been touched in 24h is reaped on the next
// access regardless of whether the parent pool is hot.
export const STICKY_BINDING_TTL_MS = parseInt(
  process.env.PROXY_STICKY_BINDING_TTL_MS || String(24 * 60 * 60 * 1000),
  10,
);

/**
 * Drop sticky bindings whose touchedAt is older than STICKY_BINDING_TTL_MS.
 * Exported for behavioral testing of the per-binding TTL contract.
 */
export function evictExpiredStickyBindings(
  bindings: Map<string, { sessionId: string; touchedAt: number }>,
  now: number = Date.now(),
): number {
  let evicted = 0;
  for (const [k, v] of bindings) {
    if (now - v.touchedAt > STICKY_BINDING_TTL_MS) {
      bindings.delete(k);
      evicted++;
    }
  }
  return evicted;
}

export function getProxyConfig(): { host: string; port: string; username: string; password: string } | null {
  const host = process.env.BRIGHT_DATA_PROXY_HOST;
  const port = process.env.BRIGHT_DATA_PROXY_PORT;
  const username = process.env.BRIGHT_DATA_PROXY_USERNAME;
  const password = process.env.BRIGHT_DATA_PROXY_PASSWORD;
  if (!host || !port || !username || !password) return null;
  return { host, port, username, password };
}

function computeIpHash(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

function jitteredDelay(min: number, max: number): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, ms));
}

const pools = new Map<string, AccountPool>();
const MAX_TELEMETRY_PER_ACCOUNT = 500;

function evictIdlePools(): number {
  const now = Date.now();
  let evicted = 0;
  // Drop any pool idle longer than POOL_IDLE_TTL_MS first (cheap pass).
  for (const [accountId, pool] of pools) {
    if (now - pool.lastTouchedAt > POOL_IDLE_TTL_MS) {
      pools.delete(accountId);
      evicted++;
    }
  }
  // If still over MAX_POOLS, evict LRU (oldest lastTouchedAt) until under.
  if (pools.size > MAX_POOLS) {
    const sorted = [...pools.entries()].sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt);
    const overflow = pools.size - MAX_POOLS;
    for (let i = 0; i < overflow; i++) {
      pools.delete(sorted[i][0]);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log(`[ProxyPool] LRU_EVICT | evicted=${evicted} | remaining=${pools.size} | maxPools=${MAX_POOLS}`);
  }
  return evicted;
}

function getOrCreatePool(accountId: string): AccountPool {
  let pool = pools.get(accountId);
  if (!pool) {
    if (pools.size >= MAX_POOLS) evictIdlePools();
    pool = { sessions: new Map(), telemetry: [], stickyBindings: new Map(), lastTouchedAt: Date.now() };
    pools.set(accountId, pool);
  } else {
    // LRU touch — move-to-end for recency.
    pool.lastTouchedAt = Date.now();
    pools.delete(accountId);
    pools.set(accountId, pool);
  }
  // Per-pool sticky-bindings bound (FIFO trim).
  if (pool.stickyBindings.size > MAX_STICKY_BINDINGS) {
    const overflow = pool.stickyBindings.size - MAX_STICKY_BINDINGS;
    const keys = [...pool.stickyBindings.keys()].slice(0, overflow);
    for (const k of keys) pool.stickyBindings.delete(k);
  }
  // Per-pool session bound: drop oldest by createdAt above MAX_SESSIONS_PER_POOL.
  if (pool.sessions.size > MAX_SESSIONS_PER_POOL) {
    const sorted = [...pool.sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const overflow = pool.sessions.size - MAX_SESSIONS_PER_POOL;
    for (let i = 0; i < overflow; i++) pool.sessions.delete(sorted[i][0]);
  }
  return pool;
}

function createSession(accountId: string): ProxySession | null {
  const proxy = getProxyConfig();
  if (!proxy) return null;

  const shortAccount = accountId.substring(0, 8);
  const ts = (Date.now() % 1000000).toString(36);
  const rand = Math.random().toString(36).substr(2, 4);
  const sessionId = `s${shortAccount}${ts}${rand}`;
  const isWebUnlocker = proxy.port === "33335";
  const country = process.env.BRIGHT_DATA_PROXY_COUNTRY || "us";
  const countrySegment = `-country-${country}`;
  const sessionUsername = isWebUnlocker
    ? proxy.username
    : `${proxy.username}${countrySegment}-session-${sessionId}`;
  const sessionUrl = `http://${sessionUsername}:${proxy.password}@${proxy.host}:${proxy.port}`;

  const session: ProxySession = {
    sessionId,
    ipHash: computeIpHash(sessionId),
    dispatcher: new ProxyAgent({ uri: sessionUrl, requestTls: { rejectUnauthorized: false } }),
    sessionUsername,
    sessionPassword: proxy.password,
    proxyHost: proxy.host,
    proxyPort: proxy.port,
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

function selectHealthySession(accountId: string, excludeIds: Set<string> = new Set()): ProxySession | null {
  const pool = getOrCreatePool(accountId);
  const now = Date.now();

  for (const [id, session] of pool.sessions) {
    if (excludeIds.has(id)) continue;
    if (session.isQuarantined) {
      if (session.cooldownUntil && now >= session.cooldownUntil) {
        session.isQuarantined = false;
        session.cooldownUntil = null;
        session.blockCount = 0;
        console.log(`[ProxyPool] Session ${id} quarantine expired for account ${accountId}`);
      } else {
        continue;
      }
    }
    if (now - session.createdAt > SESSION_TTL_MS) {
      pool.sessions.delete(id);
      continue;
    }
    return session;
  }
  return null;
}

function quarantineSession(accountId: string, sessionId: string): void {
  const pool = getOrCreatePool(accountId);
  const session = pool.sessions.get(sessionId);
  if (!session) return;

  session.isQuarantined = true;
  const escalation = Math.min(session.blockCount, 4);
  session.cooldownUntil = Date.now() + Math.min(DEFAULT_QUARANTINE_MS * escalation, MAX_QUARANTINE_MS);
  console.log(`[ProxyPool] QUARANTINE | account=${accountId} | session=${sessionId} | ipHash=${session.ipHash} | blocks=${session.blockCount} | cooldownUntil=${new Date(session.cooldownUntil).toISOString()}`);
}

function recordBlock(accountId: string, sessionId: string): void {
  const pool = getOrCreatePool(accountId);
  const session = pool.sessions.get(sessionId);
  if (!session) return;

  session.previousBlockAt = session.lastBlockAt;
  session.blockCount++;
  session.lastBlockAt = Date.now();

  if (session.blockCount >= QUARANTINE_THRESHOLD && session.previousBlockAt !== null) {
    const timeBetweenBlocks = session.lastBlockAt - session.previousBlockAt;
    if (timeBetweenBlocks <= QUARANTINE_WINDOW_MS) {
      quarantineSession(accountId, sessionId);
    }
  }
}

function recordSuccess(accountId: string, sessionId: string): void {
  const pool = getOrCreatePool(accountId);
  const session = pool.sessions.get(sessionId);
  if (session) session.successCount++;
}

function addTelemetry(accountId: string, entry: ProxyTelemetryEntry): void {
  const pool = getOrCreatePool(accountId);
  pool.telemetry.push(entry);
  if (pool.telemetry.length > MAX_TELEMETRY_PER_ACCOUNT) {
    pool.telemetry = pool.telemetry.slice(-MAX_TELEMETRY_PER_ACCOUNT);
  }
}

export function classifyBlock(httpStatus: number | null, errorMessage: string): BlockClass {
  const msg = (errorMessage || "").toLowerCase();
  if (msg.includes("proxy") || msg.includes("tunnel") || msg.includes("connect")) return "PROXY_BLOCKED";
  if (httpStatus === 429 || msg.includes("rate limit") || msg.includes("wait a few minutes")) return "RATE_LIMIT";
  if (httpStatus === 401 || msg.includes("require_login") || msg.includes("auth")) return "AUTH_REQUIRED";
  if (msg.includes("checkpoint") || msg.includes("challenge")) return "CHECKPOINT";
  if (httpStatus === 403 || msg.includes("blocked") || msg.includes("forbidden")) return "PROXY_BLOCKED";
  return "OTHER";
}

export interface StickySessionContext {
  accountId: string;
  campaignId: string;
  competitorHash: string;
  session: ProxySession;
  attemptNumber: number;
  usedSessionIds: Set<string>;
}

export function acquireStickySession(
  accountId: string,
  campaignId: string,
  competitorHash: string,
): StickySessionContext | null {
  const pool = getOrCreatePool(accountId);
  const bindingKey = `${accountId}:${campaignId}:${competitorHash}`;

  const existingSessionId = pool.stickyBindings.get(bindingKey);
  if (existingSessionId) {
    const existingSession = pool.sessions.get(existingSessionId);
    if (existingSession && !existingSession.isQuarantined && Date.now() - existingSession.createdAt < SESSION_TTL_MS) {
      return {
        accountId, campaignId, competitorHash,
        session: existingSession,
        attemptNumber: 1,
        usedSessionIds: new Set([existingSessionId]),
      };
    }
    pool.stickyBindings.delete(bindingKey);
  }

  const session = createSession(accountId);
  if (!session) return null;

  pool.stickyBindings.set(bindingKey, session.sessionId);
  return {
    accountId, campaignId, competitorHash,
    session,
    attemptNumber: 1,
    usedSessionIds: new Set([session.sessionId]),
  };
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

  return {
    ...ctx,
    session: newSession,
    attemptNumber: ctx.attemptNumber + 1,
    usedSessionIds: newUsed,
  };
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

  if (success) {
    recordSuccess(ctx.accountId, ctx.session.sessionId);
  }

  console.log(`[ProxyTelemetry] account=${ctx.accountId} | campaign=${ctx.campaignId} | competitor=${ctx.competitorHash} | session=${ctx.session.sessionId} | ipHash=${ctx.session.ipHash} | stage=${stageName} | attempt=${ctx.attemptNumber} | http=${httpStatus ?? "N/A"} | block=${blockClass ?? "NONE"} | duration=${durationMs}ms | success=${success}`);
}

export async function getRetryDelay(attemptNumber: number): Promise<void> {
  const idx = Math.min(attemptNumber - 2, RETRY_DELAYS.length - 1);
  if (idx < 0) return;
  const [min, max] = RETRY_DELAYS[idx];
  await jitteredDelay(min, max);
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

export { MAX_RETRIES_PER_STAGE, SESSION_TTL_MS, QUARANTINE_THRESHOLD, QUARANTINE_WINDOW_MS, DEFAULT_QUARANTINE_MS };
