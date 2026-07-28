/**
 * Proxy pool manager — RETIRED SHIM (P-6.12, 2026-07-28).
 *
 * HISTORY: this module owned the Bright Data Unlocker transport — sticky
 * per-competitor sessions, quarantine/rotation, adaptive per-target backoff
 * (T006), circuit breakers, and the poolFetch() choke point every scraper
 * routed through. P-6.12 migrated all acquisition to Apify actors
 * (server/acquisition/*), and Bright Data was removed entirely:
 * brightdata-client.ts, pool-config.ts, pool-persistence.ts and
 * target-backoff.ts are deleted; poolFetch() no longer exists.
 *
 * WHY A SHIM AND NOT DELETION: the pool's *call sites* encode retry
 * choreography (fetch-orchestrator's rotate-on-block loop, the worker's
 * shared-pool session acquisition, the admin pool-status panel). Those flows
 * still run — they just no longer have a proxy pool underneath. The shim
 * keeps every entry point callable with truthful "retired / empty" answers
 * so no caller crashes, while guaranteeing ZERO outbound Bright Data paths:
 *   - acquireStickySession()  → null (callers already null-guard)
 *   - rotateSessionOnBlock()  → null (rotation exhausted immediately)
 *   - releaseStickySession(), logProxyTelemetry() → no-ops
 *   - getScrapingConfig(), getSerpConfig() → null (BD env vars are IGNORED
 *     even when still set — there is no code path that could use them)
 *   - testScrapingConnectivity() → probes APIFY (the live transport)
 *   - getPoolStatusReport() → static RETIRED report (admin panel + hourly
 *     worker summary keep rendering, with zeroed counters)
 *   - classifyBlock() → kept as the real pure classifier: callers still use
 *     it to classify APIFY/actor errors into retry buckets.
 */

export type BlockClass = "PROXY_BLOCKED" | "RATE_LIMIT" | "AUTH_REQUIRED" | "CHECKPOINT" | "OTHER";

export const SCRAPE_PLATFORMS = ["instagram", "tiktok", "reviews", "website"] as const;
export type ScrapePlatform = (typeof SCRAPE_PLATFORMS)[number];

// ── Pure block classifier (kept live — transport-agnostic) ──────────────────

/**
 * Classifies a failed/blocked scrape attempt into a retry bucket. Kept from
 * the pool era because the classification heuristics are transport-agnostic:
 * fetch-orchestrator still uses it to decide RATE_LIMIT backoff vs
 * BLOCKED_BY_PLATFORM vs generic retry for Apify/actor errors.
 *
 * NOTE: Apify-facing scrapers sanitize provider-API status tokens
 * ("403"→"4xx", "rate limit"→"throttled") BEFORE messages reach any
 * substring detector, so this classifier only sees genuine target-platform
 * signals (see tiktok-scraper / profile-scraper).
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

// ── Retained type shapes (no live constructors) ─────────────────────────────

export interface ProxySession {
  sessionId: string;
  ipHash: string;
  createdAt: number;
  blockCount: number;
  isQuarantined: boolean;
  cooldownUntil: number | null;
  previousBlockAt: number | null;
  lastBlockAt: number | null;
}

export interface PoolFetchTarget {
  accountId: string;
  platform: ScrapePlatform;
  targetKey: string;
}

export interface PoolFetchInit {
  timeoutMs?: number;
  target?: PoolFetchTarget;
  backoffGraceSince?: number;
}

/**
 * Retained so `StickySessionContext | null` annotations at call sites keep
 * compiling. Nothing constructs this anymore — acquireStickySession() always
 * returns null.
 */
export interface StickySessionContext {
  accountId: string;
  campaignId: string;
  competitorHash: string;
  platform: ScrapePlatform;
  session: ProxySession;
  attemptNumber: number;
  usedSessionIds: Set<string>;
  backoffGraceSince: number;
  poolFetch(url: string, init?: PoolFetchInit): Promise<Response>;
}

export interface ScrapingConfig {
  apiKey: string;
  zone: string;
  country: string | null;
}

// ── Inert session lifecycle ──────────────────────────────────────────────────

/**
 * Always null — the proxy pool is retired. Every historical call site
 * null-guards this return (verified before gutting), so callers proceed
 * proxy-less onto the Apify transport.
 */
export function acquireStickySession(..._args: unknown[]): StickySessionContext | null {
  return null;
}

/** Rotation is meaningless without a pool — always "rotation exhausted". */
export function rotateSessionOnBlock(_ctx: StickySessionContext, _blockClass: BlockClass): StickySessionContext | null {
  return null;
}

export function releaseStickySession(_ctx: StickySessionContext): void {
  // no-op — nothing to release
}

export function logProxyTelemetry(
  _ctx: StickySessionContext,
  _stageName: string,
  _httpStatus: number | null,
  _blockClass: BlockClass | null,
  _durationMs: number,
  _success: boolean,
): void {
  // no-op — proxy telemetry retired with the pool
}

// ── Retired configuration surface ────────────────────────────────────────────

/**
 * Always null. BRIGHT_DATA_* env vars are deliberately NOT read: even a
 * fully-set Bright Data environment yields no callable transport (P-6.12
 * zero-callable-BD guarantee).
 */
export function getScrapingConfig(): ScrapingConfig | null {
  return null;
}

/** Always null — the SERP zone product was retired with Bright Data. */
export function getSerpConfig(): ScrapingConfig | null {
  return null;
}

// ── Diagnostics / status surfaces (truthful zeros) ───────────────────────────

export function getPoolDiagnostics(_accountId: string): {
  totalSessions: number;
  activeSessions: number;
  quarantinedSessions: number;
  totalTelemetryEntries: number;
  recentBlocks: number;
  recentSuccesses: number;
  stickyBindings: number;
} {
  return {
    totalSessions: 0,
    activeSessions: 0,
    quarantinedSessions: 0,
    totalTelemetryEntries: 0,
    recentBlocks: 0,
    recentSuccesses: 0,
    stickyBindings: 0,
  };
}

export interface PoolStatusReport {
  generatedAt: string;
  /** P-6.12 — pool retired; static report so operator surfaces keep rendering. */
  retired: true;
  transport: "apify";
  activeAccountPools: number;
  platforms: Record<
    ScrapePlatform,
    {
      inflight: number;
      coolingTargets: number;
      trackedTargets: number;
    }
  >;
  backoffEntries: never[];
  persistence: { persistFailures: number; hydrateFailures: number; hydratedScopes: number };
}

/**
 * Static retired report for /api/admin/pool-status and the hourly worker
 * summary. Zeroed counters are TRUTHFUL — there is no pool, so nothing is
 * inflight/cooling and persistence can no longer fail.
 */
export function getPoolStatusReport(): PoolStatusReport {
  const platforms = {} as PoolStatusReport["platforms"];
  for (const platform of SCRAPE_PLATFORMS) {
    platforms[platform] = { inflight: 0, coolingTargets: 0, trackedTargets: 0 };
  }
  return {
    generatedAt: new Date().toISOString(),
    retired: true,
    transport: "apify",
    activeAccountPools: 0,
    platforms,
    backoffEntries: [],
    persistence: { persistFailures: 0, hydrateFailures: 0, hydratedScopes: 0 },
  };
}

export interface ScrapingConnectivityResult {
  ok: boolean;
  configured: boolean;
  provider: "apify";
  durationMs: number;
  detail: string;
}

/**
 * Connectivity probe for the health endpoint — now probes Apify, the live
 * acquisition transport. Never throws; never returns the API key.
 */
export async function testScrapingConnectivity(): Promise<ScrapingConnectivityResult> {
  const startMs = Date.now();
  const { testApifyConnectivity, isApifyAcquisitionConfigured } = await import("../acquisition/apify-client");
  if (!isApifyAcquisitionConfigured()) {
    return {
      ok: false,
      configured: false,
      provider: "apify",
      durationMs: Date.now() - startMs,
      detail: "APIFY_API_KEY not set — acquisition is safe-off (all scrape paths fail fast, nothing fabricates data)",
    };
  }
  const result = await testApifyConnectivity();
  return {
    ok: result.ok,
    configured: true,
    provider: "apify",
    durationMs: Date.now() - startMs,
    detail: result.detail,
  };
}
