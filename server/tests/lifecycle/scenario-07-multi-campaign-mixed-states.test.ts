/**
 * Seal #18 / Track #5 — Scenario 7: multi-campaign, mixed states.
 *
 * Three campaigns evaluated in a single tick:
 *   A — fresh: should invoke
 *   B — already evaluated in current window: should skip_no_advance
 *   C — long-gap idle: should reanchor + invoke
 *
 * Verifies per-campaign isolation: one bad / quiescent neighbor
 * never blocks another's progress.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../db", async () => (await import("./_harness")).__dbModuleMock);
vi.mock("../../boss", async () => (await import("./_harness")).__bossModuleMock);
vi.mock("../../boss/concurrency", async () => (await import("./_harness")).__concurrencyModuleMock);
vi.mock("../../audit", async () => (await import("./_harness")).__auditModuleMock);
vi.mock("../../logger", async () => (await import("./_harness")).__loggerModuleMock);

import {
  setupHarness,
  teardownHarness,
  assertCanonicalSurfaces,
  seedApprovedPlan,
  runOneTick,
  dbState,
  WEEK_MS,
  assertMetric,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 7 — three campaigns in mixed lifecycle states", () => {
  it("invokes A, skips B, reanchors+invokes C in the same tick", async () => {
    const T_NOW = new Date("2026-06-01T01:00:00Z");
    const ONE_WEEK_AGO = new Date(T_NOW.getTime() - WEEK_MS);
    const FOUR_WEEKS_AGO = new Date(T_NOW.getTime() - 4 * WEEK_MS);

    const A = seedApprovedPlan({
      accountId: "acct_A",
      campaignId: "camp_A",
      planId: "plan_A",
      approvedAt: ONE_WEEK_AGO,
    });
    const B = seedApprovedPlan({
      accountId: "acct_B",
      campaignId: "camp_B",
      planId: "plan_B",
      approvedAt: ONE_WEEK_AGO,
    });
    const C = seedApprovedPlan({
      accountId: "acct_C",
      campaignId: "camp_C",
      planId: "plan_C",
      approvedAt: FOUR_WEEKS_AGO,
    });

    // B already evaluated for window 1 by a prior (manual) run.
    const bWindowStart = new Date(ONE_WEEK_AGO.getTime() + WEEK_MS);
    dbState.bossRuns.push({
      accountId: B.accountId,
      campaignId: B.campaignId,
      startedAt: new Date(bWindowStart.getTime() + 5 * 60_000),
      status: "completed",
    });
    dbState.evalWindows.push({
      campaignId: B.campaignId,
      planId: B.planId,
      windowIndex: 1,
    });

    const report = await runOneTick(T_NOW);

    expect(report.campaignsScanned).toBe(3);
    expect(report.runsInvoked).toBe(2);
    expect(report.runsSkippedIdempotent).toBe(1);
    expect(report.reanchorsWritten).toBe(1);

    const decA = getDecisionsForCampaign(report, A.campaignId);
    const decB = getDecisionsForCampaign(report, B.campaignId);
    const decC = getDecisionsForCampaign(report, C.campaignId);
    expect(decA[0].decision).toBe("invoked");
    expect(decB[0].decision).toBe("skipped_no_advance");
    expect(decC[0].decision).toBe("reanchored_then_invoked");

    assertMetric("continuity_runs_invoked_total", 2);
    assertMetric("continuity_reanchors_written_total", 1);
    assertMetric("continuity_runs_skipped_total", 1, {
      reason: "current_window_already_evaluated",
    });

    assertCanonicalSurfaces({
      bossRuns: 3,
      evalWindows: 3,
      anchorResets: 1,
      ticks: 1,
      claims: 2,
      auditEvents: { CONTINUITY_REANCHOR: 1 },
    });
  });
});
