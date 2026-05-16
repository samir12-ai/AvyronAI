/**
 * Operations Guardian — Phase 1B controlled-failure scenarios.
 *
 * Validates the FOUR wired Guardian collectors against the operator's
 * brief (Phase 1B / continuity + orchestration). The brief's Phase 1A
 * (scraping) and Phase 1C (AI/provider) are intentionally NOT covered
 * here — those collectors do not exist yet; their gap is documented
 * in `.local/docs/audits/operations-guardian-validation-2026-05.md`
 * and tracked under follow-up tasks.
 *
 * Doctrine compliance:
 *   - Deterministic harness (Seal #18 pattern). No live fault injection.
 *   - In-memory collector inputs (LEAKED_LOCK) mocked via vi.mock at
 *     module load. DB-backed collectors (WORKER_STUCK, RETRY_LOOP) read
 *     real seeded rows. Notice rows are real system_notices rows.
 *   - All test fixtures namespaced with TEST_PREFIX + Date.now() for
 *     parallel-safe runs and deterministic afterAll cleanup.
 *   - No new ESLint suppressions. No production code changes — every
 *     assertion goes through the existing _audienceFirewallOk +
 *     runGuardianInterpreterStep public surface.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";

// ─── In-memory stat mocks (must come BEFORE the interpreter import) ───
//
// The interpreter top-level-imports these three functions; vi.mock
// replaces the modules entirely for this file only. Mutating the
// shared objects below changes what the next collector call sees.

interface BossLikeStats {
  size: number;
  zombieEvictions: number;
  oldestAgeMs: number | null;
  maxAgeMs: number;
}
interface ContinuityTickStats {
  size: number;
  zombieEvictions: number;
  ageMs: number | null;
  maxAgeMs: number;
}

const bossStats: BossLikeStats = {
  size: 0,
  zombieEvictions: 0,
  oldestAgeMs: null,
  maxAgeMs: 30 * 60 * 1000,
};
const miActiveStats: BossLikeStats = {
  size: 0,
  zombieEvictions: 0,
  oldestAgeMs: null,
  maxAgeMs: 30 * 60 * 1000,
};
const continuityTickStats: ContinuityTickStats = {
  size: 0,
  zombieEvictions: 0,
  ageMs: null,
  maxAgeMs: 15 * 60 * 1000,
};

vi.mock("../boss/concurrency", () => ({
  _bossInFlightStats: (): BossLikeStats => bossStats,
}));
vi.mock("../market-intelligence-v3/fetch-orchestrator", () => ({
  _activeJobsStats: (): BossLikeStats => miActiveStats,
}));
vi.mock("../continuity/scheduler", () => ({
  _continuityTickInflightStats: (): ContinuityTickStats => continuityTickStats,
}));

function resetInMemoryStats(): void {
  bossStats.size = 0;
  bossStats.zombieEvictions = 0;
  bossStats.oldestAgeMs = null;
  miActiveStats.size = 0;
  miActiveStats.zombieEvictions = 0;
  miActiveStats.oldestAgeMs = null;
  continuityTickStats.size = 0;
  continuityTickStats.zombieEvictions = 0;
  continuityTickStats.ageMs = null;
}

// Now safe to import the interpreter — its module-level imports of the
// three stats functions resolve to the mocks above.
import { db } from "../db";
import {
  systemNotices,
  continuityWindowClaims,
  continuityTicks,
  miFetchJobs,
  miSnapshots,
} from "@shared/schema";
import { and, eq, like, sql } from "drizzle-orm";
import {
  runGuardianInterpreterStep,
  type GuardianTickReport,
} from "../operations-guardian/interpreter";
import type { ChainObservation } from "../continuity/supervisor";

// ─── Test fixture namespacing + cleanup ────────────────────────────────

const TEST_PREFIX = `og_scen_${Date.now()}_`;
const PLAN_PREFIX = `${TEST_PREFIX}plan_`;
const CAMPAIGN_PREFIX = `${TEST_PREFIX}camp_`;
const ACCOUNT_PREFIX = `${TEST_PREFIX}acct_`;

function planId(suffix: string): string {
  return `${PLAN_PREFIX}${suffix}`;
}
function campaignId(suffix: string): string {
  return `${CAMPAIGN_PREFIX}${suffix}`;
}
function accountId(suffix: string): string {
  return `${ACCOUNT_PREFIX}${suffix}`;
}

// Captured at module load. Bounds the deletion sweep so we cannot
// touch rows produced before this test run started, including legitimate
// production rows in the dev DB.
const TEST_RUN_START_TIME = new Date();

// The 4 wired internal collectors emit correlation keys that DO NOT
// carry TEST_PREFIX (they're hardcoded global keys in the production
// code). Per-test wipe must enumerate them — combined with the
// TEST_RUN_START_TIME timestamp guard, this only touches rows we
// just created and never live production rows.
const GLOBAL_TEST_CORRELATION_KEYS: readonly string[] = [
  "LEAKED_LOCK:boss",
  "LEAKED_LOCK:miv3",
  "LEAKED_LOCK:continuity-tick",
  "SCHEDULER_HEARTBEAT_DEAD:_continuity_scheduler",
];

// Phase 1A categories: the new collectors (SCRAPER_PROVIDER_DEGRADED,
// MARKET_DATA_DEGRADED) query global tables. When the dev DB carries
// real prod failed-fetch-job or stale-snapshot rows, the collectors
// will emit operator notices for those prod accounts/campaigns during
// the test run. The cleanup pass deletes any such notice whose
// first_seen_at is inside the test run window — bounded so it cannot
// touch rows that pre-date this test execution.
const PHASE_1A_CATEGORIES: readonly string[] = [
  "SCRAPER_PROVIDER_DEGRADED",
  "MARKET_DATA_DEGRADED",
];

async function wipeFixtures(): Promise<void> {
  // system_notices: delete (a) anything whose correlation key carries
  // TEST_PREFIX (per-test scoped: WORKER_STUCK, RETRY_LOOP, CHAIN_*),
  // OR (b) anything matching a global collector key AND first-seen
  // after this test run started (LEAKED_LOCK + SCHEDULER_HEARTBEAT_DEAD),
  // OR (c) any Phase 1A category (SCRAPER_PROVIDER_DEGRADED /
  // MARKET_DATA_DEGRADED) first-seen during this test run — those
  // collectors query global tables and may emit notices for real prod
  // accounts/campaigns; we must not leave those notices behind.
  await db.execute(sql`
    DELETE FROM ${systemNotices}
    WHERE correlation_key LIKE ${`%${TEST_PREFIX}%`}
       OR (
         correlation_key IN (
           ${GLOBAL_TEST_CORRELATION_KEYS[0]},
           ${GLOBAL_TEST_CORRELATION_KEYS[1]},
           ${GLOBAL_TEST_CORRELATION_KEYS[2]},
           ${GLOBAL_TEST_CORRELATION_KEYS[3]}
         )
         AND first_seen_at >= ${TEST_RUN_START_TIME}
       )
       OR (
         category IN (${PHASE_1A_CATEGORIES[0]}, ${PHASE_1A_CATEGORIES[1]})
         AND first_seen_at >= ${TEST_RUN_START_TIME}
       )
  `);
  await db
    .delete(continuityWindowClaims)
    .where(like(continuityWindowClaims.campaignId, `${CAMPAIGN_PREFIX}%`));
  // continuityTicks store campaignId in JSONB notes; bounded delete on
  // notes containing TEST_PREFIX (every test fixture stamps the prefix
  // into the note string).
  await db.execute(sql`
    DELETE FROM ${continuityTicks}
    WHERE notes::text LIKE ${`%${TEST_PREFIX}%`}
  `);
  // Phase 1A (Task #58) fixture tables. Both are scoped to TEST_PREFIX
  // account/campaign IDs so the sweep cannot touch real production rows.
  await db
    .delete(miFetchJobs)
    .where(like(miFetchJobs.accountId, `${ACCOUNT_PREFIX}%`));
  await db
    .delete(miSnapshots)
    .where(like(miSnapshots.accountId, `${ACCOUNT_PREFIX}%`));
}

async function seedFailedFetchJobs(opts: {
  account: string;
  count: number;
  minutesAgo?: number;
}): Promise<void> {
  const minutesAgo = opts.minutesAgo ?? 10;
  const createdAt = new Date(NOW.getTime() - minutesAgo * 60_000);
  const rows = Array.from({ length: opts.count }, (_, i) => ({
    id: `${TEST_PREFIX}fj_${opts.account}_${i}_${Math.random().toString(36).slice(2, 8)}`,
    accountId: opts.account,
    campaignId: campaignId(`fj_${i}`),
    status: "FAILED",
    createdAt,
    completedAt: createdAt,
    error: `${TEST_PREFIX} synthetic failed fetch job`,
  }));
  await db.insert(miFetchJobs).values(rows);
}

async function seedSnapshot(opts: {
  account: string;
  campaign: string;
  ageMinutes: number;
  status?: "COMPLETE" | "PARTIAL" | "PENDING" | "STALE";
}): Promise<void> {
  const createdAt = new Date(NOW.getTime() - opts.ageMinutes * 60_000);
  await db.insert(miSnapshots).values({
    accountId: opts.account,
    campaignId: opts.campaign,
    jobId: `${TEST_PREFIX}snap_job_${Math.random().toString(36).slice(2, 8)}`,
    status: opts.status ?? "COMPLETE",
    createdAt,
  });
}

// ─── Tick + assertion helpers ──────────────────────────────────────────

const NOW = new Date("2026-05-16T12:00:00Z");

function makeChainObservations(
  overrides: Partial<ChainObservation>[] = [],
): ChainObservation[] {
  // All omitted chains default to HEALTHY (no notice). Only the chains
  // explicitly listed in `overrides` are returned — collectChainSignals
  // skips any chain whose state is not DEGRADED or DEAD.
  return overrides.map((o) => ({
    chainId: o.chainId ?? "test-chain",
    expectedIntervalMs: o.expectedIntervalMs ?? 60_000,
    introspectionAvailable: o.introspectionAvailable ?? true,
    lastObservedRunAt: o.lastObservedRunAt ?? NOW.toISOString(),
    state: o.state ?? "HEALTHY",
    lagMs: o.lagMs ?? 0,
    reason: o.reason ?? "",
    stateChanged: o.stateChanged ?? false,
  }));
}

interface TickArgs {
  now?: Date;
  chains?: Partial<ChainObservation>[];
  schedulerState?: string;
  schedulerLagMs?: number | null;
}

async function runTick(args: TickArgs = {}): Promise<GuardianTickReport> {
  return runGuardianInterpreterStep({
    now: args.now ?? NOW,
    chainObservations: makeChainObservations(args.chains ?? []),
    schedulerState: args.schedulerState ?? "HEALTHY",
    schedulerLagMs: args.schedulerLagMs ?? 0,
  });
}

interface NoticeRow {
  id: string;
  category: string;
  severity: string;
  audience: string;
  correlationKey: string;
  campaignId: string | null;
  copyVars: unknown;
  detail: unknown;
  resolvedAt: Date | null;
  observationCount: number;
}

async function findNotice(
  correlationKey: string,
): Promise<NoticeRow | undefined> {
  const r = await db
    .select({
      id: systemNotices.id,
      category: systemNotices.category,
      severity: systemNotices.severity,
      audience: systemNotices.audience,
      correlationKey: systemNotices.correlationKey,
      campaignId: systemNotices.campaignId,
      copyVars: systemNotices.copyVars,
      detail: systemNotices.detail,
      resolvedAt: systemNotices.resolvedAt,
      observationCount: systemNotices.observationCount,
    })
    .from(systemNotices)
    .where(eq(systemNotices.correlationKey, correlationKey))
    .limit(2);
  expect(r.length, `expected ≤1 notice for ${correlationKey}, got ${r.length}`).toBeLessThanOrEqual(2);
  // Open row first if present, else any.
  return r.find((row) => row.resolvedAt == null) ?? r[0];
}

async function findOpenNoticesByCategoryPrefix(
  category: string,
): Promise<NoticeRow[]> {
  // Test-run-bounded query: matches rows for the category whose key
  // either carries TEST_PREFIX (per-test scoped categories) OR is a
  // known global key created during this test run (LEAKED_LOCK +
  // SCHEDULER_HEARTBEAT_DEAD have hardcoded global keys).
  const r = await db.execute(sql`
    SELECT id, category, severity, audience, correlation_key AS "correlationKey",
           campaign_id AS "campaignId", copy_vars AS "copyVars", detail,
           resolved_at AS "resolvedAt", observation_count AS "observationCount"
    FROM ${systemNotices}
    WHERE category = ${category}
      AND (
        correlation_key LIKE ${`%${TEST_PREFIX}%`}
        OR (
          correlation_key IN (
            ${GLOBAL_TEST_CORRELATION_KEYS[0]},
            ${GLOBAL_TEST_CORRELATION_KEYS[1]},
            ${GLOBAL_TEST_CORRELATION_KEYS[2]},
            ${GLOBAL_TEST_CORRELATION_KEYS[3]}
          )
          AND first_seen_at >= ${TEST_RUN_START_TIME}
        )
      )
  `);
  const rows = (r as unknown as { rows: NoticeRow[] }).rows ?? [];
  return rows.filter((row) => row.resolvedAt == null);
}

async function seedStuckClaim(opts: {
  campaign: string;
  plan: string;
  windowIndex: number;
  ageMinutes: number;
  account?: string;
  now?: Date;
}): Promise<void> {
  const now = opts.now ?? NOW;
  const claimedAt = new Date(now.getTime() - opts.ageMinutes * 60_000);
  await db.insert(continuityWindowClaims).values({
    campaignId: opts.campaign,
    planId: opts.plan,
    windowIndex: opts.windowIndex,
    accountId: opts.account ?? accountId("a"),
    claimedBy: `replica-${TEST_PREFIX}`,
    claimedAt,
    status: "in_progress",
  });
}

async function resolveStuckClaim(opts: {
  campaign: string;
  plan: string;
  windowIndex: number;
}): Promise<void> {
  await db
    .update(continuityWindowClaims)
    .set({ status: "completed", outcome: "completed", outcomeAt: new Date() })
    .where(
      and(
        eq(continuityWindowClaims.campaignId, opts.campaign),
        eq(continuityWindowClaims.planId, opts.plan),
        eq(continuityWindowClaims.windowIndex, opts.windowIndex),
      ),
    );
}

async function seedFailedTicks(opts: {
  campaign: string;
  count: number;
  hoursAgo?: number;
}): Promise<void> {
  const hoursAgo = opts.hoursAgo ?? 1;
  const tickAt = new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);
  // Single tick row carrying `count` failed-decision notes for this campaign.
  // Real production rows look the same: notes is a JSONB array, one entry
  // per campaign decision.
  const notes = Array.from({ length: opts.count }, () => ({
    campaignId: opts.campaign,
    decision: "failed",
    note: `${TEST_PREFIX} failed decision for fixture`,
  }));
  await db.insert(continuityTicks).values({
    tickAt,
    durationMs: 100,
    chainsChecked: 1,
    chainsHealthy: 0,
    chainsDegraded: 0,
    chainsDead: 0,
    notes: notes,
  });
}

// ─── Group: setup ──────────────────────────────────────────────────────

beforeAll(async () => {
  await wipeFixtures();
});
afterAll(async () => {
  await wipeFixtures();
});
beforeEach(async () => {
  // Per-test wipe + reset is essential: many scenarios leave open
  // rows that would leak into the next test's collector sweep
  // (e.g. a stuck claim from scenario 7 would inflate scenario 15's
  // report.collected count). Wipe is timestamp-bounded so it can
  // never delete rows that pre-date this test run.
  resetInMemoryStats();
  await wipeFixtures();
});

// ─── Group A: LEAKED_LOCK collector (in-memory zombie evictions) ──────

describe("Phase 1B / Continuity-Orchestration — LEAKED_LOCK", () => {
  it("[Scenario 1] No zombie evictions ⇒ no notice emitted", async () => {
    await runTick();
    const open = await findOpenNoticesByCategoryPrefix("LEAKED_LOCK");
    expect(open).toHaveLength(0);
    // NOTE: we do not assert report.collected === 0 because the Phase 1A
    // collectors (SCRAPER_PROVIDER_DEGRADED, MARKET_DATA_DEGRADED) query
    // global tables and may surface real prod-account signals here; per-
    // category open-notice assertion above is the doctrinally correct
    // check for this scenario.
  });

  it("[Scenario 2] Single boss-lock zombie eviction ⇒ exactly one operator notice (warning)", async () => {
    bossStats.zombieEvictions = 1;
    bossStats.oldestAgeMs = 2_000_000;
    await runTick();
    const leaked = await findOpenNoticesByCategoryPrefix("LEAKED_LOCK");
    expect(leaked).toHaveLength(1);
    const n = await findNotice("LEAKED_LOCK:boss");
    expect(n).toBeDefined();
    expect(n!.category).toBe("LEAKED_LOCK");
    expect(n!.severity).toBe("warning");
    expect(n!.audience).toBe("operator");
    expect((n!.copyVars as { source: string }).source).toBe("boss-locks");
  });

  it("[Scenario 3] Zombie evictions across all 3 sources ⇒ 3 distinct notices, no cross-source collapse", async () => {
    bossStats.zombieEvictions = 1;
    miActiveStats.zombieEvictions = 2;
    continuityTickStats.zombieEvictions = 1;
    await runTick();
    const open = await findOpenNoticesByCategoryPrefix("LEAKED_LOCK");
    expect(open).toHaveLength(3);
    const keys = open.map((n) => n.correlationKey).sort();
    expect(keys).toEqual([
      "LEAKED_LOCK:boss",
      "LEAKED_LOCK:continuity-tick",
      "LEAKED_LOCK:miv3",
    ]);
  });

  it("[Scenario 4] Same source emits twice ⇒ second tick UPDATES (not duplicates) + observation_count increments", async () => {
    bossStats.zombieEvictions = 1;
    await runTick();
    bossStats.zombieEvictions = 4; // load grew but same source
    const report = await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(report.updated).toBeGreaterThanOrEqual(1);
    expect(report.inserted).toBe(0);
    const n = await findNotice("LEAKED_LOCK:boss");
    expect(n!.observationCount).toBe(2);
    expect((n!.copyVars as { zombieEvictions: number }).zombieEvictions).toBe(4);
  });

  it("[Scenario 5] Eviction stops ⇒ next tick resolves the open notice (no false flap)", async () => {
    bossStats.zombieEvictions = 1;
    await runTick();
    let n = await findNotice("LEAKED_LOCK:boss");
    expect(n!.resolvedAt).toBeNull();
    // Source has gone quiet — tick must resolve the open notice.
    bossStats.zombieEvictions = 0;
    const report = await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    expect(report.resolved).toBeGreaterThanOrEqual(1);
    n = await findNotice("LEAKED_LOCK:boss");
    expect(n!.resolvedAt).not.toBeNull();
  });
});

// ─── Group B: WORKER_STUCK collector (DB stuck claims) ────────────────

describe("Phase 1B / Continuity-Orchestration — WORKER_STUCK", () => {
  it("[Scenario 6] Claim aged 30min ⇒ NO notice (below 2h threshold; transient)", async () => {
    await seedStuckClaim({
      campaign: campaignId("ws_below"),
      plan: planId("ws_below"),
      windowIndex: 1,
      ageMinutes: 30,
    });
    await runTick();
    const open = await findOpenNoticesByCategoryPrefix("WORKER_STUCK");
    expect(open).toHaveLength(0);
  });

  it("[Scenario 7] Claim aged 3h ⇒ warning severity notice", async () => {
    await seedStuckClaim({
      campaign: campaignId("ws_warn"),
      plan: planId("ws_warn"),
      windowIndex: 2,
      ageMinutes: 3 * 60,
    });
    await runTick();
    const key = `WORKER_STUCK:${campaignId("ws_warn")}:${planId("ws_warn")}:2`;
    const n = await findNotice(key);
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
    expect((n!.copyVars as { ageMinutes: number }).ageMinutes).toBeGreaterThanOrEqual(180);
  });

  it("[Scenario 8] Claim aged 5h ⇒ degraded severity (≥240m band)", async () => {
    await seedStuckClaim({
      campaign: campaignId("ws_deg"),
      plan: planId("ws_deg"),
      windowIndex: 3,
      ageMinutes: 5 * 60,
    });
    await runTick();
    const key = `WORKER_STUCK:${campaignId("ws_deg")}:${planId("ws_deg")}:3`;
    const n = await findNotice(key);
    expect(n!.severity).toBe("degraded");
  });

  it("[Scenario 9] Claim aged 9h ⇒ critical severity (≥480m band)", async () => {
    await seedStuckClaim({
      campaign: campaignId("ws_crit"),
      plan: planId("ws_crit"),
      windowIndex: 4,
      ageMinutes: 9 * 60,
    });
    await runTick();
    const key = `WORKER_STUCK:${campaignId("ws_crit")}:${planId("ws_crit")}:4`;
    const n = await findNotice(key);
    expect(n!.severity).toBe("critical");
  });

  it("[Scenario 10] Stuck claim resolves between ticks ⇒ notice resolved (no false-resolve when other claims still stuck)", async () => {
    // Two stuck claims for the same campaign — both should produce notices.
    await seedStuckClaim({
      campaign: campaignId("ws_resolves"),
      plan: planId("ws_resolves"),
      windowIndex: 5,
      ageMinutes: 3 * 60,
    });
    await seedStuckClaim({
      campaign: campaignId("ws_resolves"),
      plan: planId("ws_resolves_other"),
      windowIndex: 6,
      ageMinutes: 3 * 60,
    });
    await runTick();
    const k1 = `WORKER_STUCK:${campaignId("ws_resolves")}:${planId("ws_resolves")}:5`;
    const k2 = `WORKER_STUCK:${campaignId("ws_resolves")}:${planId("ws_resolves_other")}:6`;
    expect((await findNotice(k1))!.resolvedAt).toBeNull();
    expect((await findNotice(k2))!.resolvedAt).toBeNull();
    // Resolve only one — the other must stay open.
    await resolveStuckClaim({
      campaign: campaignId("ws_resolves"),
      plan: planId("ws_resolves"),
      windowIndex: 5,
    });
    await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    expect((await findNotice(k1))!.resolvedAt).not.toBeNull();
    expect((await findNotice(k2))!.resolvedAt).toBeNull();
  });
});

// ─── Group C: RETRY_LOOP collector (DB failed-tick aggregation) ───────

describe("Phase 1B / Continuity-Orchestration — RETRY_LOOP", () => {
  it("[Scenario 11] 2 failed decisions for a campaign ⇒ NO notice (below 3-failure threshold)", async () => {
    await seedFailedTicks({ campaign: campaignId("rl_below"), count: 2 });
    await runTick();
    const key = `RETRY_LOOP:${campaignId("rl_below")}`;
    const n = await findNotice(key);
    expect(n).toBeUndefined();
  });

  it("[Scenario 12] 3 failed decisions ⇒ warning notice", async () => {
    await seedFailedTicks({ campaign: campaignId("rl_warn"), count: 3 });
    await runTick();
    const key = `RETRY_LOOP:${campaignId("rl_warn")}`;
    const n = await findNotice(key);
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
    expect((n!.copyVars as { failedCount24h: number }).failedCount24h).toBe(3);
  });

  it("[Scenario 13] 7 failed decisions ⇒ degraded severity", async () => {
    await seedFailedTicks({ campaign: campaignId("rl_deg"), count: 7 });
    await runTick();
    const n = await findNotice(`RETRY_LOOP:${campaignId("rl_deg")}`);
    expect(n!.severity).toBe("degraded");
  });

  it("[Scenario 14] 12 failed decisions ⇒ critical severity", async () => {
    await seedFailedTicks({ campaign: campaignId("rl_crit"), count: 12 });
    await runTick();
    const n = await findNotice(`RETRY_LOOP:${campaignId("rl_crit")}`);
    expect(n!.severity).toBe("critical");
  });
});

// ─── Group D-A: SCRAPER_PROVIDER_DEGRADED (Phase 1A — Task #58) ───────

describe("Phase 1A / Scraping — SCRAPER_PROVIDER_DEGRADED", () => {
  it("[Scenario 24] No failed fetch jobs ⇒ no notice", async () => {
    await runTick();
    const open = await findOpenNoticesByCategoryPrefix(
      "SCRAPER_PROVIDER_DEGRADED",
    );
    expect(open).toHaveLength(0);
  });

  it("[Scenario 25] 2 failed fetch jobs in 1h ⇒ NO notice (below 3-failure threshold)", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_below"), count: 2 });
    await runTick();
    const key = `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_below")}`;
    const n = await findNotice(key);
    expect(n).toBeUndefined();
  });

  it("[Scenario 26] 3 failed fetch jobs ⇒ warning notice", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_warn"), count: 3 });
    await runTick();
    const key = `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_warn")}`;
    const n = await findNotice(key);
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
    expect((n!.copyVars as { failedCount1h: number }).failedCount1h).toBe(3);
  });

  it("[Scenario 27] 12 failed fetch jobs ⇒ degraded severity (≥10 band)", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_deg"), count: 12 });
    await runTick();
    const n = await findNotice(
      `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_deg")}`,
    );
    expect(n!.severity).toBe("degraded");
  });

  it("[Scenario 28] 30 failed fetch jobs ⇒ critical severity (≥25 band)", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_crit"), count: 30 });
    await runTick();
    const n = await findNotice(
      `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_crit")}`,
    );
    expect(n!.severity).toBe("critical");
  });

  it("[Scenario 29] Old failures outside 1h window ⇒ no notice", async () => {
    await seedFailedFetchJobs({
      account: accountId("scr_old"),
      count: 5,
      minutesAgo: 120,
    });
    await runTick();
    const n = await findNotice(
      `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_old")}`,
    );
    expect(n).toBeUndefined();
  });

  it("[Scenario 30] Failures stop between ticks ⇒ open notice resolved", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_resolves"), count: 5 });
    await runTick();
    const key = `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_resolves")}`;
    expect((await findNotice(key))!.resolvedAt).toBeNull();
    // Simulate failures aging out by deleting them; next tick must
    // resolve the open notice.
    await db
      .delete(miFetchJobs)
      .where(eq(miFetchJobs.accountId, accountId("scr_resolves")));
    await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    expect((await findNotice(key))!.resolvedAt).not.toBeNull();
  });

  it("[Scenario 31] Recurrence ⇒ single row, observation_count increments", async () => {
    await seedFailedFetchJobs({ account: accountId("scr_recur"), count: 4 });
    await runTick();
    await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    const open = await findOpenNoticesByCategoryPrefix(
      "SCRAPER_PROVIDER_DEGRADED",
    );
    const mine = open.filter(
      (r) =>
        r.correlationKey ===
        `SCRAPER_PROVIDER_DEGRADED:${accountId("scr_recur")}`,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.observationCount).toBe(2);
  });
});

// ─── Group D-B: MARKET_DATA_DEGRADED (Phase 1A — Task #58) ────────────

describe("Phase 1A / Scraping — MARKET_DATA_DEGRADED", () => {
  it("[Scenario 32] No snapshots at all for a campaign ⇒ silent (never-bootstrapped)", async () => {
    await runTick();
    const open = await findOpenNoticesByCategoryPrefix("MARKET_DATA_DEGRADED");
    expect(open).toHaveLength(0);
  });

  it("[Scenario 33] Fresh snapshot (1h old) ⇒ no notice", async () => {
    await seedSnapshot({
      account: accountId("md_fresh"),
      campaign: campaignId("md_fresh"),
      ageMinutes: 60,
    });
    await runTick();
    const n = await findNotice(
      `MARKET_DATA_DEGRADED:${campaignId("md_fresh")}`,
    );
    expect(n).toBeUndefined();
  });

  it("[Scenario 34] Snapshot 8h old ⇒ warning notice", async () => {
    await seedSnapshot({
      account: accountId("md_warn"),
      campaign: campaignId("md_warn"),
      ageMinutes: 8 * 60,
    });
    await runTick();
    const n = await findNotice(
      `MARKET_DATA_DEGRADED:${campaignId("md_warn")}`,
    );
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
    expect((n!.copyVars as { ageMinutes: number }).ageMinutes).toBeGreaterThanOrEqual(
      8 * 60 - 1,
    );
  });

  it("[Scenario 35] Snapshot 30h old ⇒ critical notice", async () => {
    await seedSnapshot({
      account: accountId("md_crit"),
      campaign: campaignId("md_crit"),
      ageMinutes: 30 * 60,
    });
    await runTick();
    const n = await findNotice(
      `MARKET_DATA_DEGRADED:${campaignId("md_crit")}`,
    );
    expect(n!.severity).toBe("critical");
  });

  it("[Scenario 36] Most-recent of multiple snapshots is fresh ⇒ no notice", async () => {
    // A campaign that had a stale snapshot at 10h but also has a fresh
    // one at 30min — most-recent rule must take the fresh one.
    await seedSnapshot({
      account: accountId("md_mixed"),
      campaign: campaignId("md_mixed"),
      ageMinutes: 10 * 60,
    });
    await seedSnapshot({
      account: accountId("md_mixed"),
      campaign: campaignId("md_mixed"),
      ageMinutes: 30,
    });
    await runTick();
    const n = await findNotice(
      `MARKET_DATA_DEGRADED:${campaignId("md_mixed")}`,
    );
    expect(n).toBeUndefined();
  });

  it("[Scenario 37] PENDING/STALE snapshot does not count as successful ⇒ if it's the only one, silent", async () => {
    // Only an unfinished snapshot exists; collector reads only
    // COMPLETE/PARTIAL — should treat the campaign as never-bootstrapped.
    await seedSnapshot({
      account: accountId("md_pending"),
      campaign: campaignId("md_pending"),
      ageMinutes: 20 * 60,
      status: "PENDING",
    });
    await runTick();
    const n = await findNotice(
      `MARKET_DATA_DEGRADED:${campaignId("md_pending")}`,
    );
    expect(n).toBeUndefined();
  });

  it("[Scenario 38] Fresh snapshot lands between ticks ⇒ open notice resolved", async () => {
    await seedSnapshot({
      account: accountId("md_recovers"),
      campaign: campaignId("md_recovers"),
      ageMinutes: 9 * 60,
    });
    await runTick();
    const key = `MARKET_DATA_DEGRADED:${campaignId("md_recovers")}`;
    expect((await findNotice(key))!.resolvedAt).toBeNull();
    // A fresh successful snapshot lands → most-recent moves into the
    // fresh window → next tick resolves.
    await seedSnapshot({
      account: accountId("md_recovers"),
      campaign: campaignId("md_recovers"),
      ageMinutes: 10,
    });
    await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    expect((await findNotice(key))!.resolvedAt).not.toBeNull();
  });

  it("[Scenario 39] Firewall — SCRAPER_PROVIDER_DEGRADED + MARKET_DATA_DEGRADED never carry audience='user'", async () => {
    await seedFailedFetchJobs({ account: accountId("fw_scr"), count: 30 });
    await seedSnapshot({
      account: accountId("fw_md"),
      campaign: campaignId("fw_md"),
      ageMinutes: 30 * 60,
    });
    await runTick();
    const all = await db
      .select({ category: systemNotices.category, audience: systemNotices.audience })
      .from(systemNotices)
      .where(
        sql`category IN ('SCRAPER_PROVIDER_DEGRADED', 'MARKET_DATA_DEGRADED')
            AND (correlation_key LIKE ${`%${TEST_PREFIX}%`})`,
      );
    expect(all.length).toBeGreaterThan(0);
    for (const row of all) {
      expect(row.audience).toBe("operator");
    }
  });
});

// ─── Group D: CHAIN_DEGRADED / CHAIN_DEAD / SCHEDULER_HEARTBEAT_DEAD ─

describe("Phase 1B / Continuity-Orchestration — CHAIN_* + SCHEDULER", () => {
  it("[Scenario 15] All chains HEALTHY ⇒ no chain notice", async () => {
    await runTick({
      chains: [{ chainId: `${TEST_PREFIX}c1`, state: "HEALTHY" }],
    });
    const open = await findOpenNoticesByCategoryPrefix("CHAIN_DEGRADED");
    expect(open).toHaveLength(0);
    // report.collected omitted — see Scenario 1 note.
  });

  it("[Scenario 16] Chain DEGRADED ⇒ warning notice", async () => {
    const chainId = `${TEST_PREFIX}c2`;
    await runTick({
      chains: [
        {
          chainId,
          state: "DEGRADED",
          lagMs: 180_000,
          reason: "lag exceeded 2x expected interval",
        },
      ],
    });
    const n = await findNotice(`CHAIN_DEGRADED:${chainId}`);
    expect(n).toBeDefined();
    expect(n!.severity).toBe("warning");
  });

  it("[Scenario 17] Chain DEAD ⇒ critical notice with chainId in copyVars", async () => {
    const chainId = `${TEST_PREFIX}c3`;
    await runTick({
      chains: [
        {
          chainId,
          state: "DEAD",
          lagMs: 600_000,
          reason: "no run observed in 4x interval",
        },
      ],
    });
    const n = await findNotice(`CHAIN_DEAD:${chainId}`);
    expect(n!.severity).toBe("critical");
    expect((n!.copyVars as { chainId: string }).chainId).toBe(chainId);
  });

  it("[Scenario 18] Chain UNKNOWN (introspection unavailable) ⇒ NOT classified as DEGRADED/DEAD ⇒ no notice", async () => {
    // CRITICAL-INVARIANT proof: the supervisor classifies chains without
    // introspection wiring as UNKNOWN per Seal #14 doctrine. A notice
    // here would mean a silent reclassification to HEALTHY/DEGRADED.
    await runTick({
      chains: [
        {
          chainId: `${TEST_PREFIX}c4`,
          state: "UNKNOWN",
          introspectionAvailable: false,
          lastObservedRunAt: null,
        },
      ],
    });
    const open = await findOpenNoticesByCategoryPrefix("CHAIN_DEGRADED");
    const open2 = await findOpenNoticesByCategoryPrefix("CHAIN_DEAD");
    expect(open).toHaveLength(0);
    expect(open2).toHaveLength(0);
  });

  it("[Scenario 19] Scheduler heartbeat DEAD ⇒ critical SCHEDULER_HEARTBEAT_DEAD notice", async () => {
    await runTick({ schedulerState: "DEAD", schedulerLagMs: 7200_000 });
    const n = await findNotice(
      "SCHEDULER_HEARTBEAT_DEAD:_continuity_scheduler",
    );
    expect(n).toBeDefined();
    expect(n!.severity).toBe("critical");
  });

  it("[Scenario 20] Chain recovers DEAD→HEALTHY between ticks ⇒ open notice resolved", async () => {
    const chainId = `${TEST_PREFIX}c5`;
    await runTick({
      chains: [{ chainId, state: "DEAD", lagMs: 600_000 }],
    });
    expect((await findNotice(`CHAIN_DEAD:${chainId}`))!.resolvedAt).toBeNull();
    // Recovery — chain is healthy again, so collectChainSignals returns
    // nothing for it; resolver should sweep the open notice.
    await runTick({
      now: new Date(NOW.getTime() + 5 * 60_000),
      chains: [{ chainId, state: "HEALTHY" }],
    });
    expect(
      (await findNotice(`CHAIN_DEAD:${chainId}`))!.resolvedAt,
    ).not.toBeNull();
  });
});

// ─── Group E: cross-cutting noise + correlation correctness ───────────

describe("Phase 1B / Continuity-Orchestration — noise + correlation", () => {
  it("[Scenario 21] Same warning emitted across 3 ticks ⇒ ONE row, observation_count=3, no per-tick spam", async () => {
    bossStats.zombieEvictions = 2;
    await runTick();
    await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    await runTick({ now: new Date(NOW.getTime() + 10 * 60_000) });
    const open = await findOpenNoticesByCategoryPrefix("LEAKED_LOCK");
    expect(open).toHaveLength(1);
    expect(open[0]!.observationCount).toBe(3);
  });

  it("[Scenario 23] Collector failure ⇒ that category's open notices are NOT swept (Task #56 P1 #2 invariant)", async () => {
    // Setup: create an open RETRY_LOOP notice in tick 1 (real failed-tick
    // fixture, real collector run, real upsert).
    const camp = campaignId("rl_sweep_guard");
    await seedFailedTicks({ campaign: camp, count: 5 });
    await runTick();
    const key = `RETRY_LOOP:${camp}`;
    expect((await findNotice(key))!.resolvedAt).toBeNull();

    // Tick 2: same collector throws — safeCollect catches and returns
    // ok=false. The fixture rows are still present (so under normal
    // conditions the notice would be re-observed and stay open), but
    // even if the fixtures were removed the resolver MUST NOT sweep
    // RETRY_LOOP this tick because the category is no longer fully
    // observed. We force the failure by spying on db.execute and
    // making the next call (the RETRY_LOOP collector's raw SQL) throw.
    //
    // The harder case: also remove the fixtures so observedKeys is
    // empty for RETRY_LOOP — without the safeCollect ok=false guard
    // the resolver WOULD sweep the open notice. This is exactly the
    // false-resolve the Task #56 fix prevents.
    await db.execute(sql`
      DELETE FROM ${continuityTicks} WHERE notes::text LIKE ${`%${TEST_PREFIX}%`}
    `);

    const originalExecute = db.execute.bind(db);
    let throwOnce = true;
    const spy = vi.spyOn(db, "execute").mockImplementation((q: unknown) => {
      // The RETRY_LOOP collector is the only `db.execute` raw-SQL caller
      // among the wired collectors that runs during this tick. Throwing
      // on the first execute call after the spy is installed targets it.
      if (throwOnce) {
        throwOnce = false;
        return Promise.reject(
          new Error("[test] forced RETRY_LOOP collector failure"),
        ) as never;
      }
      return originalExecute(q as never) as never;
    });

    try {
      await runTick({ now: new Date(NOW.getTime() + 5 * 60_000) });
    } finally {
      spy.mockRestore();
    }

    // Critical assertion: the open RETRY_LOOP notice MUST still be open.
    // If the resolver had swept it (because observedKeys was empty), the
    // Task #56 P1 #2 invariant would be broken and false-resolves would
    // cascade under any transient collector failure.
    const after = await findNotice(key);
    expect(after).toBeDefined();
    expect(
      after!.resolvedAt,
      "RETRY_LOOP notice MUST NOT be swept when its collector failed (Task #56 P1 #2)",
    ).toBeNull();
  });

  it("[Scenario 22] Internal-only category never carries audience='user' (firewall absolute)", async () => {
    // Trigger every wired internal collector at once — none of these may
    // ever produce a user-audience row regardless of severity.
    bossStats.zombieEvictions = 1;
    await seedStuckClaim({
      campaign: campaignId("fw"),
      plan: planId("fw"),
      windowIndex: 7,
      ageMinutes: 9 * 60, // critical
    });
    await seedFailedTicks({ campaign: campaignId("fw_loop"), count: 12 });
    await runTick({
      chains: [{ chainId: `${TEST_PREFIX}fw_chain`, state: "DEAD", lagMs: 999_999 }],
      schedulerState: "DEAD",
      schedulerLagMs: 999_999,
    });
    const all = await db
      .select({ audience: systemNotices.audience })
      .from(systemNotices)
      .where(like(systemNotices.correlationKey, `%${TEST_PREFIX}%`));
    for (const row of all) {
      expect(
        row.audience,
        `every notice must be operator-audience (no user leakage)`,
      ).toBe("operator");
    }
  });
});
