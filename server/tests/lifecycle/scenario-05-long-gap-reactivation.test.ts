/**
 * Seal #18 / Track #5 — Scenario 5: long-gap reactivation.
 *
 * A plan with anchor 4 weeks old and ZERO opened eval windows is the
 * exact pattern that produced the original outage. The scheduler must
 * write a plan_anchor_resets row, then invoke runBoss with the
 * fresh anchor (window_index=0) and return decision
 * `reanchored_then_invoked`.
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
  seedApprovedPlan,
  runOneTick,
  dbState,
  WEEK_MS,
  assertMetric,
  getDecisionsForCampaign,
  getAuditEvents,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 5 — long-gap reactivation triggers reanchor + invoke", () => {
  it("4-week-idle plan with no opened windows reanchors and runs window 0", async () => {
    const T_NOW = new Date("2026-06-01T00:00:00Z");
    const T_ANCHOR = new Date(T_NOW.getTime() - 4 * WEEK_MS);
    const plan = seedApprovedPlan({ approvedAt: T_ANCHOR });

    const report = await runOneTick(T_NOW);

    expect(report.reanchorsWritten).toBe(1);
    expect(dbState.insertedResets.length).toBe(1);
    expect(dbState.insertedResets[0].planId).toBe(plan.planId);
    expect(dbState.insertedResets[0].reason).toMatch(/long_gap/);
    expect(report.runsInvoked).toBe(1);
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.evalWindows.length).toBe(1);
    expect(dbState.evalWindows[0].windowIndex).toBe(0);

    const decisions = getDecisionsForCampaign(report, plan.campaignId);
    expect(decisions[0].decision).toBe("reanchored_then_invoked");

    assertMetric("continuity_reanchors_written_total", 1);
    assertMetric("continuity_runs_invoked_total", 1);

    // Missed-window audit also fires (4 windows never opened).
    expect(getAuditEvents("CONTINUITY_MISSED_WINDOWS").length).toBeGreaterThanOrEqual(1);
  });
});
