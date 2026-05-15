/**
 * Seal #18 / Track #5 — Lifecycle test harness.
 *
 * Shared in-memory mock fabric for the 18 deterministic behavioral
 * scenarios under server/tests/lifecycle/scenario-NN-*.test.ts.
 *
 * Each scenario file declares the four `vi.mock(...)` blocks pointing
 * at the exports below (`__dbModuleMock`, `__bossModuleMock`,
 * `__concurrencyModuleMock`, `__auditModuleMock`, `__loggerModuleMock`)
 * then drives the scheduler via `runOneTick(now)` and asserts on
 * `dbState`, `auditLogs`, and `assertMetric()`.
 *
 * Design notes:
 *   - Per-plan filtering on planApprovals/planAnchorResets is done by
 *     walking the drizzle WHERE expression and matching any string
 *     value against known plan ids (extractKnownIdFromWhere). This lets
 *     multi-campaign scenarios (#7, #17) work without per-iteration
 *     globals.
 *   - Postgres INSERT...ON CONFLICT DO NOTHING atomicity is simulated
 *     via a serial Promise mutex (`withClaimsLock`).
 *   - The runBoss mock stamps `startedAt` from a simulated-now global
 *     so window idempotency comparisons line up with the same clock the
 *     scheduler sees via `opts.now`.
 *   - Metric values are read from the private `.values` map of each
 *     Counter/Gauge instance. `resetMetrics()` clears all of them in
 *     `beforeEach` so per-scenario assertions are absolute (not deltas).
 */
import { vi, expect } from "vitest";
import { continuityMetrics } from "../../continuity/metrics";

// ---------------------------------------------------------------------------
// In-memory state.
// ---------------------------------------------------------------------------

export interface ApprovedPlan {
  account_id: string;
  campaign_id: string;
  plan_id: string;
  updated_at: Date | null;
  created_at: Date | null;
}

export interface ApprovalRow {
  planId: string;
  createdAt: Date;
  decision: string;
}

export interface ResetRow {
  planId: string;
  reanchoredAt: Date;
  reason?: string;
}

export interface EvalWindowRow {
  campaignId: string;
  planId: string;
  windowIndex: number;
}

export interface BossRunRow {
  accountId: string;
  campaignId: string;
  startedAt: Date;
  status: string;
}

export interface ClaimRow {
  campaign_id: string;
  plan_id: string;
  window_index: number;
  account_id: string;
  claimed_by: string;
  claimed_at: Date;
  status: string;
  outcome?: string;
  outcome_at?: Date;
  boss_run_id?: string;
}

export interface AuditEvent {
  accountId: string;
  eventType: string;
  payload: any;
}

export const dbState = {
  approvedPlans: [] as ApprovedPlan[],
  approvals: [] as ApprovalRow[],
  resets: [] as ResetRow[],
  evalWindows: [] as EvalWindowRow[],
  bossRuns: [] as BossRunRow[],
  claims: [] as ClaimRow[],
  insertedTicks: [] as any[],
  insertedResets: [] as any[],
  dbAvailable: true as boolean,
};

export const auditLogs: AuditEvent[] = [];

let __simulatedNow: Date = new Date();
export function setSimulatedNow(d: Date): void {
  __simulatedNow = d;
  // Keep vitest fake timers in lock-step so any code path inside the
  // scheduler / harness that reads Date.now() or `new Date()` (without
  // the explicit `now` injection) sees the same simulated wall-clock.
  // setupHarness() installs vi.useFakeTimers(); this call is a no-op
  // before that runs.
  try {
    vi.setSystemTime(d);
  } catch {
    // vi.setSystemTime throws if fake timers are not installed yet.
    // setupHarness() will install them and restamp the clock.
  }
}
export function getSimulatedNow(): Date {
  return __simulatedNow;
}

// ---------------------------------------------------------------------------
// Where-clause introspection.
// drizzle's `eq(col, val)` builds an SQL chunk whose params/values appear
// somewhere in the predicate object tree. We walk it and collect every
// string value, then match against ids we know about.
// ---------------------------------------------------------------------------

function extractStringValues(node: any): string[] {
  const out: string[] = [];
  const seen = new WeakSet<object>();
  function walk(n: any): void {
    if (n === null || n === undefined) return;
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    if (typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "table") continue;
      try {
        walk((n as any)[key]);
      } catch {
        // some drizzle internals throw on getter access — ignore.
      }
    }
  }
  walk(node);
  return out;
}

function extractKnownPlanId(predicate: any): string | null {
  if (!predicate) return null;
  const values = extractStringValues(predicate);
  for (const v of values) {
    if (dbState.approvedPlans.some((p) => p.plan_id === v)) return v;
  }
  return null;
}

function extractKnownCampaignId(predicate: any): string | null {
  if (!predicate) return null;
  const values = extractStringValues(predicate);
  for (const v of values) {
    if (dbState.approvedPlans.some((p) => p.campaign_id === v)) return v;
  }
  return null;
}

function extractWindowIndexFromPredicate(predicate: any): number | null {
  if (!predicate) return null;
  const seen = new WeakSet<object>();
  let found: number | null = null;
  function walk(n: any): void {
    if (found !== null || n === null || n === undefined) return;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 100000) {
      found = n;
      return;
    }
    if (typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "table") continue;
      try {
        walk((n as any)[key]);
      } catch {
        // ignore
      }
    }
  }
  walk(predicate);
  return found;
}

function extractStartedAtCutoff(predicate: any): Date | null {
  if (!predicate) return null;
  const seen = new WeakSet<object>();
  let found: Date | null = null;
  function walk(n: any): void {
    if (found || n === null || n === undefined) return;
    if (n instanceof Date) {
      found = n;
      return;
    }
    if (typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "table") continue;
      try {
        walk((n as any)[key]);
      } catch {
        // ignore
      }
    }
  }
  walk(predicate);
  return found;
}

// ---------------------------------------------------------------------------
// Claims atomicity mutex.
// ---------------------------------------------------------------------------

let claimsMutex: Promise<unknown> = Promise.resolve();
async function withClaimsLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = claimsMutex.then(() => fn());
  claimsMutex = next.catch(() => undefined);
  return next as Promise<T>;
}

const __claimLookupKey = "__lifecycle_lastClaimLookup";

function checkDbAvailable(): void {
  if (!dbState.dbAvailable) {
    throw new Error("db_unavailable");
  }
}

// ---------------------------------------------------------------------------
// Boss / concurrency mocks.
// ---------------------------------------------------------------------------

export class BossRunInFlightError extends Error {
  code = "BOSS_RUN_IN_FLIGHT";
  constructor(public campaignId: string) {
    super(`A Boss run is already in flight for campaign ${campaignId}`);
    this.name = "BossRunInFlightError";
  }
}

export function resolveEffectiveAnchorFor(planId: string, fallback: Date): Date {
  let anchor: Date = fallback;
  let foundApproval = false;
  for (const a of dbState.approvals) {
    if (a.planId === planId && a.decision === "APPROVED" && a.createdAt) {
      if (!foundApproval || a.createdAt.getTime() > anchor.getTime()) {
        anchor = a.createdAt;
        foundApproval = true;
      }
    }
  }
  for (const r of dbState.resets) {
    if (r.planId === planId && r.reanchoredAt && r.reanchoredAt.getTime() > anchor.getTime()) {
      anchor = r.reanchoredAt;
    }
  }
  return anchor;
}

export const defaultRunBossImpl = async (input: {
  accountId: string;
  campaignId: string;
  trigger?: string;
}) => {
  const startedAt = getSimulatedNow();
  const id = `mock_${input.accountId}_${input.campaignId}_${startedAt.getTime()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const plan = dbState.approvedPlans.find(
    (p) => p.account_id === input.accountId && p.campaign_id === input.campaignId,
  );
  if (plan) {
    const anchor = resolveEffectiveAnchorFor(
      plan.plan_id,
      plan.updated_at ?? plan.created_at ?? startedAt,
    );
    const wIdx = Math.floor(
      Math.max(0, startedAt.getTime() - anchor.getTime()) / WEEK_MS,
    );
    const exists = dbState.evalWindows.some(
      (w) =>
        w.campaignId === plan.campaign_id &&
        w.planId === plan.plan_id &&
        w.windowIndex === wIdx,
    );
    if (!exists) {
      dbState.evalWindows.push({
        campaignId: plan.campaign_id,
        planId: plan.plan_id,
        windowIndex: wIdx,
      });
    }
  }
  dbState.bossRuns.push({
    accountId: input.accountId,
    campaignId: input.campaignId,
    startedAt,
    status: "completed",
  });
  return { bossRunId: id, status: "completed" };
};

export const runBossMock = vi.fn(defaultRunBossImpl);

export function setRunBossImpl(
  impl: (input: { accountId: string; campaignId: string; trigger?: string }) => Promise<any>,
): void {
  runBossMock.mockImplementation(impl);
}

// ---------------------------------------------------------------------------
// db mock module.
// ---------------------------------------------------------------------------

function tableName(table: any): string {
  return String(table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "");
}

export const __dbModuleMock = {
  db: {
    execute: async () => {
      checkDbAvailable();
      // listActiveCampaigns reads strategic_plans status='APPROVED'.
      return { rows: dbState.approvedPlans };
    },
    select: (shape?: any) => {
      // inspectCampaignWindows: shape={maxIdx: max(...)}.
      if (shape && "maxIdx" in shape) {
        return {
          from: () => ({
            where: async (predicate: any) => {
              checkDbAvailable();
              const planId = extractKnownPlanId(predicate);
              const cmpId = extractKnownCampaignId(predicate);
              const rows = dbState.evalWindows.filter(
                (w) =>
                  (planId === null || w.planId === planId) &&
                  (cmpId === null || w.campaignId === cmpId),
              );
              return [
                {
                  maxIdx:
                    rows.length === 0 ? null : Math.max(...rows.map((w) => w.windowIndex)),
                },
              ];
            },
          }),
        };
      }
      // lastBossRun / latestRunInWindow: shape has startedAt + status.
      if (shape && "startedAt" in shape && "status" in shape && !("claimedBy" in shape)) {
        return {
          from: () => ({
            where: (predicate: any) => ({
              orderBy: () => ({
                limit: async () => {
                  checkDbAvailable();
                  const cmpId = extractKnownCampaignId(predicate);
                  const cutoff = extractStartedAtCutoff(predicate);
                  let rows = dbState.bossRuns.filter(
                    (b) => cmpId === null || b.campaignId === cmpId,
                  );
                  if (cutoff) {
                    rows = rows.filter((b) => b.startedAt.getTime() >= cutoff.getTime());
                  }
                  if (rows.length === 0) return [];
                  rows = [...rows].sort(
                    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
                  );
                  return [{ startedAt: rows[0].startedAt, status: rows[0].status }];
                },
              }),
            }),
          }),
        };
      }
      // tryClaimWindow pre-check: shape {status, claimedBy}.
      if (shape && "status" in shape && "claimedBy" in shape) {
        let predicate: any = null;
        return {
          from: () => ({
            where: (p: any) => {
              predicate = p;
              return {
                limit: async () =>
                  withClaimsLock(() => {
                    checkDbAvailable();
                    const campaignId = extractKnownCampaignId(predicate);
                    const planId = extractKnownPlanId(predicate);
                    const windowIndex = extractWindowIndexFromPredicate(predicate);
                    const lookup = (globalThis as any)[__claimLookupKey];
                    const found = dbState.claims.find((c) => {
                      const cidOk = campaignId
                        ? c.campaign_id === campaignId
                        : lookup
                          ? c.campaign_id === lookup.campaignId
                          : false;
                      const pidOk = planId
                        ? c.plan_id === planId
                        : lookup
                          ? c.plan_id === lookup.planId
                          : true;
                      const widxOk =
                        windowIndex !== null
                          ? c.window_index === windowIndex
                          : lookup
                            ? c.window_index === lookup.windowIndex
                            : true;
                      return cidOk && pidOk && widxOk;
                    });
                    return found
                      ? [{ status: found.status, claimedBy: found.claimed_by }]
                      : [];
                  }),
              };
            },
          }),
        };
      }
      // Default: full row reads (planApprovals or planAnchorResets).
      return {
        from: (table: any) => {
          const name = tableName(table);
          let predicate: any = null;
          const buildResult = async (): Promise<any[]> => {
            checkDbAvailable();
            const planId = extractKnownPlanId(predicate);
            if (name.includes("approval")) {
              const rows = dbState.approvals.filter(
                (a) =>
                  (planId === null || a.planId === planId) && a.decision === "APPROVED",
              );
              rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
              return rows;
            }
            if (name.includes("reset")) {
              const rows = dbState.resets.filter(
                (r) => planId === null || r.planId === planId,
              );
              rows.sort((a, b) => b.reanchoredAt.getTime() - a.reanchoredAt.getTime());
              return rows;
            }
            return [];
          };
          const chain: any = {
            from: () => chain,
            where: (p: any) => {
              predicate = p;
              return chain;
            },
            orderBy: () => chain,
            limit: () => buildResult(),
            then: (resolve: any) => buildResult().then(resolve),
          };
          return chain;
        },
      };
    },
    insert: (table: any) => {
      const name = tableName(table);
      if (name.includes("claim")) {
        let pendingRow: any = null;
        const builder: any = {
          values: (row: any) => {
            pendingRow = row;
            (globalThis as any)[__claimLookupKey] = {
              campaignId: row.campaignId,
              planId: row.planId,
              windowIndex: row.windowIndex,
            };
            return builder;
          },
          onConflictDoNothing: () => builder,
          returning: () =>
            withClaimsLock(() => {
              checkDbAvailable();
              const exists = dbState.claims.some(
                (c) =>
                  c.campaign_id === pendingRow.campaignId &&
                  c.plan_id === pendingRow.planId &&
                  c.window_index === pendingRow.windowIndex,
              );
              if (exists) return [];
              dbState.claims.push({
                campaign_id: pendingRow.campaignId,
                plan_id: pendingRow.planId,
                window_index: pendingRow.windowIndex,
                account_id: pendingRow.accountId,
                claimed_by: pendingRow.claimedBy,
                claimed_at: pendingRow.claimedAt ?? getSimulatedNow(),
                status: pendingRow.status ?? "in_progress",
              });
              return [{ claimedBy: pendingRow.claimedBy }];
            }),
          then: (resolve: any) => Promise.resolve(undefined).then(resolve),
        };
        return builder;
      }
      return {
        values: async (row: any) => {
          checkDbAvailable();
          if (name.includes("tick")) dbState.insertedTicks.push(row);
          else if (name.includes("anchor_reset")) {
            dbState.insertedResets.push(row);
            dbState.resets.push({
              planId: row.planId,
              reanchoredAt: row.reanchoredAt,
              reason: row.reason,
            });
          }
          return undefined;
        },
      };
    },
    update: (table: any) => {
      const name = tableName(table);
      if (!name.includes("claim")) {
        return { set: () => ({ where: async () => undefined }) };
      }
      return {
        set: (patch: any) => ({
          where: async () =>
            withClaimsLock(() => {
              checkDbAvailable();
              const lookup = (globalThis as any)[__claimLookupKey];
              if (!lookup) return undefined;
              const idx = dbState.claims.findIndex(
                (c) =>
                  c.campaign_id === lookup.campaignId &&
                  c.plan_id === lookup.planId &&
                  c.window_index === lookup.windowIndex,
              );
              if (idx >= 0) {
                dbState.claims[idx] = {
                  ...dbState.claims[idx],
                  status: patch.status ?? dbState.claims[idx].status,
                  outcome: patch.outcome ?? dbState.claims[idx].outcome,
                  outcome_at: patch.outcomeAt ?? dbState.claims[idx].outcome_at,
                  boss_run_id: patch.bossRunId ?? dbState.claims[idx].boss_run_id,
                };
              }
              return undefined;
            }),
        }),
      };
    },
    delete: (table: any) => {
      const name = tableName(table);
      if (!name.includes("claim")) {
        return { where: async () => undefined };
      }
      return {
        where: async () =>
          withClaimsLock(() => {
            checkDbAvailable();
            const lookup = (globalThis as any)[__claimLookupKey];
            if (!lookup) return undefined;
            const before = dbState.claims.length;
            dbState.claims = dbState.claims.filter(
              (c) =>
                !(
                  c.campaign_id === lookup.campaignId &&
                  c.plan_id === lookup.planId &&
                  c.window_index === lookup.windowIndex &&
                  c.status === "in_progress"
                ),
            );
            return before - dbState.claims.length;
          }),
      };
    },
  },
};

export const __bossModuleMock = {
  runBoss: (input: any) => runBossMock(input),
  BossRunInFlightError,
};

export const __concurrencyModuleMock = {
  BossRunInFlightError,
};

export const __auditModuleMock = {
  logAudit: vi.fn(async (accountId: string, eventType: string, payload: any) => {
    auditLogs.push({ accountId, eventType, payload: payload ?? {} });
  }),
};

export const __loggerModuleMock = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
};

// ---------------------------------------------------------------------------
// Lifecycle helpers.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

export function setupHarness(initialDate?: Date): void {
  dbState.approvedPlans = [];
  dbState.approvals = [];
  dbState.resets = [];
  dbState.evalWindows = [];
  dbState.bossRuns = [];
  dbState.claims = [];
  dbState.insertedTicks = [];
  dbState.insertedResets = [];
  dbState.dbAvailable = true;
  auditLogs.length = 0;
  (globalThis as any)[__claimLookupKey] = null;
  // Install vitest fake timers FIRST so setSimulatedNow's vi.setSystemTime
  // call lands. Doctrine: every lifecycle scenario owns the clock end-to-end.
  //
  // CRITICAL: only fake `Date` — leave setTimeout / setInterval /
  // setImmediate / queueMicrotask / process.nextTick on the REAL event loop.
  // The harness uses real-async controllable promises in mid-flight scenarios
  // (e.g. scenario-16) and a large sequential loop in scenario-17 — freezing
  // the event loop would deadlock the harness.
  vi.useFakeTimers({ toFake: ["Date"] });
  setSimulatedNow(initialDate ?? new Date("2026-05-01T00:00:00Z"));
  resetMetrics();
  // Fire and forget — scheduler state reset is best-effort.
  void resetSchedulerState();
  runBossMock.mockClear();
  runBossMock.mockImplementation(defaultRunBossImpl);
  (__auditModuleMock.logAudit as any).mockClear?.();
}

/**
 * Paired with setupHarness(). Restores real timers so vitest's per-file
 * isolation isn't polluted across scenarios. Every scenario MUST call this
 * in afterEach (the doctrine-required teardown for fake-timer scopes).
 */
export function teardownHarness(): void {
  // vi.useRealTimers() is idempotent and safe even if fake timers were
  // never installed in this scope.
  vi.useRealTimers();
}

/**
 * Canonical-surface assertion helper (Seal #18 acceptance contract).
 *
 * Every lifecycle scenario asserts the SAME six persisted/observable
 * surfaces, so the contract is named here and reused. Each field is
 * optional — pass only the surfaces you want to lock down for that
 * scenario; surfaces not specified are intentionally not asserted.
 *
 * Surfaces:
 *   - bossRuns        → dbState.bossRuns row count
 *   - evalWindows     → dbState.evalWindows row count (pipeline_eval_windows)
 *   - anchorResets    → dbState.insertedResets row count (plan_anchor_resets)
 *   - ticks           → dbState.insertedTicks row count (continuity_ticks)
 *   - claims          → dbState.claims row count (continuity_window_claims)
 *   - auditEvents     → { eventType: minimum count } (audit_log_archive)
 */
export function assertCanonicalSurfaces(opts: {
  bossRuns?: number;
  evalWindows?: number;
  anchorResets?: number;
  ticks?: number;
  claims?: number;
  auditEvents?: Record<string, number>;
}): void {
  if (opts.bossRuns !== undefined) {
    expect(dbState.bossRuns.length, "boss_runs").toBe(opts.bossRuns);
  }
  if (opts.evalWindows !== undefined) {
    expect(dbState.evalWindows.length, "pipeline_eval_windows").toBe(
      opts.evalWindows,
    );
  }
  if (opts.anchorResets !== undefined) {
    expect(dbState.insertedResets.length, "plan_anchor_resets").toBe(
      opts.anchorResets,
    );
  }
  if (opts.ticks !== undefined) {
    expect(dbState.insertedTicks.length, "continuity_ticks").toBe(opts.ticks);
  }
  if (opts.claims !== undefined) {
    expect(dbState.claims.length, "continuity_window_claims").toBe(
      opts.claims,
    );
  }
  if (opts.auditEvents) {
    for (const [eventType, minCount] of Object.entries(opts.auditEvents)) {
      const got = getAuditEvents(eventType).length;
      expect(
        got,
        `audit_log_archive event ${eventType} >= ${minCount}`,
      ).toBeGreaterThanOrEqual(minCount);
    }
  }
}

let __schedulerModulePromise: Promise<typeof import("../../continuity/scheduler")> | null = null;
function loadScheduler() {
  if (!__schedulerModulePromise) {
    __schedulerModulePromise = import("../../continuity/scheduler");
  }
  return __schedulerModulePromise;
}

async function resetSchedulerState(): Promise<void> {
  try {
    const mod = await loadScheduler();
    mod._resetContinuityState?.();
  } catch {
    // not loaded yet; first runOneTick will load it freshly.
  }
}

export interface SeedPlanOpts {
  accountId?: string;
  campaignId?: string;
  planId?: string;
  approvedAt: Date;
}

let __seedCounter = 0;
export function seedApprovedPlan(opts: SeedPlanOpts): {
  accountId: string;
  campaignId: string;
  planId: string;
  approvedAt: Date;
} {
  __seedCounter += 1;
  const accountId = opts.accountId ?? `acct_${__seedCounter}`;
  const campaignId = opts.campaignId ?? `camp_${__seedCounter}`;
  const planId = opts.planId ?? `plan_${__seedCounter}`;
  dbState.approvedPlans.push({
    account_id: accountId,
    campaign_id: campaignId,
    plan_id: planId,
    updated_at: opts.approvedAt,
    created_at: opts.approvedAt,
  });
  dbState.approvals.push({
    planId,
    createdAt: opts.approvedAt,
    decision: "APPROVED",
  });
  return { accountId, campaignId, planId, approvedAt: opts.approvedAt };
}

export function revokePlan(planId: string): void {
  dbState.approvedPlans = dbState.approvedPlans.filter((p) => p.plan_id !== planId);
}

export async function runOneTick(now: Date) {
  setSimulatedNow(now);
  const { runContinuityTick } = await import("../../continuity/scheduler");
  return runContinuityTick({ now, persist: true });
}

export function advanceClock(ms: number, fromBase?: Date): Date {
  const base = fromBase ?? getSimulatedNow();
  const next = new Date(base.getTime() + ms);
  setSimulatedNow(next);
  return next;
}

export function advanceWeeks(n: number, fromBase?: Date): Date {
  return advanceClock(n * WEEK_MS, fromBase);
}

export function advanceHours(n: number, fromBase?: Date): Date {
  return advanceClock(n * HOUR_MS, fromBase);
}

export function getDecisionsForCampaign(report: any, campaignId: string): any[] {
  return (report?.decisions ?? []).filter((d: any) => d.campaignId === campaignId);
}

export function getAuditEvents(eventType: string): AuditEvent[] {
  return auditLogs.filter((a) => a.eventType === eventType);
}

// ---------------------------------------------------------------------------
// Metrics access (reads private `.values` Map of the in-house Counter/Gauge).
// ---------------------------------------------------------------------------

function findMetric(name: string): any | null {
  for (const key of Object.keys(continuityMetrics)) {
    const m = (continuityMetrics as any)[key];
    if (m && m.name === name) return m;
  }
  return null;
}

function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join("|");
}

export function getMetricValue(
  name: string,
  labels: Record<string, string> = {},
): number {
  const m = findMetric(name);
  if (!m) return 0;
  const entry = m.values.get(labelKey(labels));
  return entry?.value ?? 0;
}

export function assertMetric(
  name: string,
  expected: number,
  labels: Record<string, string> = {},
): void {
  const actual = getMetricValue(name, labels);
  expect(actual, `metric ${name} ${JSON.stringify(labels)}`).toBe(expected);
}

export function resetMetrics(): void {
  for (const key of Object.keys(continuityMetrics)) {
    const m = (continuityMetrics as any)[key];
    if (m && m.values && typeof m.values.clear === "function") m.values.clear();
  }
}
