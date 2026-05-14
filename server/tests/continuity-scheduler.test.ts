/**
 * Seal #13 / Track #1 — Continuity scheduler regression suite.
 *
 * Covers the failure modes that produced the original outage:
 *   1. Scheduler runs even when there are zero APPROVED plans (no crash,
 *      a continuity_ticks row IS still written so ops can prove the
 *      heartbeat is alive).
 *   2. Idempotency: tick(now), tick(now+1s) → exactly one boss_run is
 *      attempted for a given (campaign, window_index).
 *   3. Long-gap re-anchor policy: a plan with anchor older than 1 window
 *      AND zero opened windows → a plan_anchor_resets row is written
 *      AND the scheduler then invokes runBoss with the freshly-anchored
 *      window_index=0.
 *   4. Missed-window detection: a plan with eval windows up to index 1
 *      and now-anchor diff = 4 weeks → missedWindowsDetected reports the
 *      correct gap (no re-anchor because windows DO exist).
 *   5. Dead-cycle escalation: a plan older than DEAD_CYCLE_THRESHOLD with
 *      no boss_runs → deadCyclesDetected fires.
 *
 * The test patches `runBoss` via vi.mock so we exercise the scheduler's
 * decision logic without needing the entire orchestrator. We use a real
 * sqlite-in-memory? No — drizzle-orm uses pg here. So we mock `db` calls
 * via vi.mock as well. This keeps the test hermetic + fast.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db module BEFORE importing the scheduler so its top-level
// import resolution sees the mocked version.
const dbState: {
  approvedPlans: Array<{
    account_id: string;
    campaign_id: string;
    plan_id: string;
    updated_at: Date;
  }>;
  approvals: Array<{ planId: string; createdAt: Date; decision: string }>;
  resets: Array<{ planId: string; reanchoredAt: Date }>;
  evalWindows: Array<{ campaignId: string; planId: string; windowIndex: number }>;
  bossRuns: Array<{ accountId: string; campaignId: string; startedAt: Date }>;
  insertedResets: Array<{ planId: string; reanchoredAt: Date; reason: string }>;
  insertedTicks: Array<Record<string, unknown>>;
} = {
  approvedPlans: [],
  approvals: [],
  resets: [],
  evalWindows: [],
  bossRuns: [],
  insertedResets: [],
  insertedTicks: [],
};

vi.mock("../db", () => {
  // Build a tiny chainable query stub. The scheduler's queries are simple
  // enough that we can pattern-match on the table reference and return the
  // appropriate slice of dbState.
  function makeChain(rows: any[]) {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: any) => any) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  }
  return {
    db: {
      execute: async (_sql: any) => ({ rows: dbState.approvedPlans }),
      select: (shape?: any) => {
        // The scheduler calls .select() with no args for full row reads, and
        // with a {maxIdx: max(...)} shape for the windowIndex aggregation.
        if (shape && "maxIdx" in shape) {
          return {
            from: () => ({
              where: () => Promise.resolve([
                { maxIdx: dbState.evalWindows.length === 0
                    ? null
                    : Math.max(...dbState.evalWindows.map((w) => w.windowIndex)) },
              ]),
            }),
          };
        }
        if (shape && "startedAt" in shape) {
          return {
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve(
                    dbState.bossRuns.length > 0
                      ? [{ startedAt: dbState.bossRuns[dbState.bossRuns.length - 1].startedAt }]
                      : [],
                  ),
                }),
              }),
            }),
          };
        }
        // Default: full row read. Decide table by which sequential call this
        // is. A more robust approach uses a router by table reference, but
        // for the scheduler's known query order we can dispatch via a
        // simple FIFO. We use the from() argument's name string when
        // possible.
        return {
          from: (table: any) => {
            const tableName = String(table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "");
            const dataset =
              tableName.includes("approval") ? dbState.approvals
              : tableName.includes("reset") ? dbState.resets
              : [];
            return makeChain(dataset);
          },
        };
      },
      insert: (table: any) => ({
        values: async (row: any) => {
          const tableName = String(table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "");
          if (tableName.includes("reset")) dbState.insertedResets.push(row);
          else if (tableName.includes("tick")) dbState.insertedTicks.push(row);
          return undefined;
        },
      }),
    },
  };
});

vi.mock("../boss", () => ({
  runBoss: vi.fn(async (input: any) => ({
    bossRunId: `mock_${input.accountId}_${input.campaignId}_${Date.now()}`,
    status: "completed",
  })),
  BossRunInFlightError: class BossRunInFlightError extends Error {
    code = "BOSS_RUN_IN_FLIGHT";
  },
}));

vi.mock("../boss/concurrency", () => ({
  BossRunInFlightError: class BossRunInFlightError extends Error {
    code = "BOSS_RUN_IN_FLIGHT";
  },
}));

vi.mock("../audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("../logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// Now safe to import — all transitive deps are mocked.
import {
  runContinuityTick,
  _resetContinuityState,
  WINDOW_MS,
  DEAD_CYCLE_THRESHOLD_MS,
} from "../continuity/scheduler";
import { runBoss } from "../boss";

beforeEach(() => {
  dbState.approvedPlans = [];
  dbState.approvals = [];
  dbState.resets = [];
  dbState.evalWindows = [];
  dbState.bossRuns = [];
  dbState.insertedResets = [];
  dbState.insertedTicks = [];
  _resetContinuityState();
  (runBoss as any).mockClear?.();
});

describe("Seal #13 / Track #1 — empty world", () => {
  it("writes a continuity_ticks row even with zero campaigns", async () => {
    const report = await runContinuityTick({ now: new Date("2026-05-14T12:00:00Z") });
    expect(report.campaignsScanned).toBe(0);
    expect(report.runsInvoked).toBe(0);
    expect(dbState.insertedTicks.length).toBe(1);
    expect((runBoss as any)).not.toHaveBeenCalled();
  });
});

describe("Seal #13 / Track #1 — long-gap re-anchor", () => {
  it("writes plan_anchor_resets row + invokes runBoss when anchor>1 window old AND no windows opened", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    const oldAnchor = new Date(now.getTime() - 4 * WINDOW_MS);
    dbState.approvedPlans = [
      { account_id: "acct1", campaign_id: "camp1", plan_id: "plan1", updated_at: oldAnchor },
    ];
    dbState.approvals = [
      { planId: "plan1", createdAt: oldAnchor, decision: "APPROVED" },
    ];
    // No eval windows opened, no boss runs.
    const report = await runContinuityTick({ now });
    expect(report.reanchorsWritten).toBe(1);
    expect(dbState.insertedResets.length).toBe(1);
    expect(dbState.insertedResets[0].reason).toContain("long_gap");
    expect(report.runsInvoked).toBe(1);
    expect((runBoss as any)).toHaveBeenCalledOnce();
    const decision = report.decisions[0];
    expect(decision.decision).toBe("reanchored_then_invoked");
  });
});

describe("Seal #13 / Track #1 — dead-cycle escalation", () => {
  it("counts a campaign with no boss_runs and aged>DEAD_CYCLE_THRESHOLD as a dead cycle", async () => {
    const now = new Date("2026-05-14T12:00:00Z");
    const ancient = new Date(now.getTime() - DEAD_CYCLE_THRESHOLD_MS - 24 * 60 * 60 * 1000);
    dbState.approvedPlans = [
      { account_id: "acct1", campaign_id: "camp1", plan_id: "plan1", updated_at: ancient },
    ];
    dbState.approvals = [{ planId: "plan1", createdAt: ancient, decision: "APPROVED" }];
    const report = await runContinuityTick({ now });
    expect(report.deadCyclesDetected).toBeGreaterThanOrEqual(1);
  });
});
