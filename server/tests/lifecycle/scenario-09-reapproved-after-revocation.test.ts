/**
 * Seal #18 / Track #5 — Scenario 9: re-approved after revocation.
 *
 * A plan is approved, runs for one week, is revoked, then a NEW
 * plan_id is approved. The new plan must anchor at its own
 * approvedAt and start at window_index=0.
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
  revokePlan,
  runOneTick,
  dbState,
  WEEK_MS,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 9 — re-approved after revocation starts a fresh anchor", () => {
  it("the new plan_id runs at window_index=0", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const oldPlan = seedApprovedPlan({
      accountId: "acct_X",
      campaignId: "camp_X",
      planId: "plan_old",
      approvedAt: T0,
    });
    await runOneTick(new Date(T0.getTime() + WEEK_MS + 60_000));
    revokePlan(oldPlan.planId);

    // Re-approve at week 3 with a DIFFERENT plan_id.
    const reApprovedAt = new Date(T0.getTime() + 3 * WEEK_MS);
    const newPlan = seedApprovedPlan({
      accountId: "acct_X",
      campaignId: "camp_X",
      planId: "plan_new",
      approvedAt: reApprovedAt,
    });

    const report = await runOneTick(new Date(reApprovedAt.getTime() + 60 * 60_000));

    const dec = getDecisionsForCampaign(report, newPlan.campaignId);
    expect(dec[0].decision).toBe("invoked");
    expect(dec[0].expectedWindowIndex).toBe(0);
    expect(report.runsInvoked).toBe(1);
    // Two boss runs total: one for old plan window 1, one for new plan window 0.
    expect(dbState.bossRuns.length).toBe(2);
    // The NEW plan should have its own claim row at windowIndex=0.
    expect(
      dbState.claims.find(
        (c) => c.plan_id === "plan_new" && c.window_index === 0,
      ),
    ).toBeDefined();
  });
});
