/**
 * Seal #18 / Track #5 — Scenario 11: two replicas, exactly one runs.
 *
 * Pre-seed an `in_progress` claim row for this (campaign, plan, window)
 * owned by `replica_other`. The scheduler tick must observe the claim,
 * skip with reason `claimed_by_other_replica`, and emit the
 * CONTINUITY_REPLICA_CONFLICT audit. No boss run is invoked.
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
  runBossMock,
  assertMetric,
  getAuditEvents,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 11 — claim already owned by another replica", () => {
  it("scheduler skips with claimed_by_other_replica and emits the conflict audit", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });
    const T_NOW = new Date(T0.getTime() + WEEK_MS);

    // Other replica already holds the claim for window 1.
    dbState.claims.push({
      campaign_id: plan.campaignId,
      plan_id: plan.planId,
      window_index: 1,
      account_id: plan.accountId,
      claimed_by: "replica_other",
      claimed_at: T_NOW,
      status: "in_progress",
    });

    const report = await runOneTick(T_NOW);

    const dec = getDecisionsForCampaign(report, plan.campaignId);
    expect(dec[0].decision).toBe("skipped_claimed_by_other_replica");
    expect(dec[0].claimedBy).toBe("replica_other");
    expect(report.runsInvoked).toBe(0);
    expect(runBossMock).not.toHaveBeenCalled();
    expect(dbState.bossRuns.length).toBe(0);

    const conflicts = getAuditEvents("CONTINUITY_REPLICA_CONFLICT");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].payload.details.ownedBy).toBe("replica_other");

    assertMetric("continuity_window_claims_lost_other_replica_total", 1);
    assertMetric("continuity_runs_skipped_total", 1, {
      reason: "claimed_by_other_replica",
    });
  });
});
