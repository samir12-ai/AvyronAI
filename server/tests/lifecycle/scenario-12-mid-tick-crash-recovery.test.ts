/**
 * Seal #18 / Track #5 — Scenario 12: mid-tick crash recovery.
 *
 * runBoss throws BossRunInFlightError on the first attempt (architect-
 * flagged finding #2: this used to leak the claim row forever). The
 * scheduler MUST release the claim, then a subsequent tick must
 * recover and successfully invoke runBoss. No double-run.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../db", async () => (await import("./_harness")).__dbModuleMock);
vi.mock("../../boss", async () => (await import("./_harness")).__bossModuleMock);
vi.mock("../../boss/concurrency", async () => (await import("./_harness")).__concurrencyModuleMock);
vi.mock("../../audit", async () => (await import("./_harness")).__auditModuleMock);
vi.mock("../../logger", async () => (await import("./_harness")).__loggerModuleMock);

import {
  setupHarness,
  seedApprovedPlan,
  runOneTick,
  dbState,
  WEEK_MS,
  setRunBossImpl,
  defaultRunBossImpl,
  BossRunInFlightError,
  assertMetric,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 12 — mid-tick crash (BossRunInFlightError) recovers next tick", () => {
  it("releases the in_progress claim on crash so the next tick re-claims and runs", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });

    setRunBossImpl(async () => {
      throw new BossRunInFlightError(plan.campaignId);
    });
    const tick1 = new Date(T0.getTime() + WEEK_MS + 60_000);
    const r1 = await runOneTick(tick1);
    const dec1 = getDecisionsForCampaign(r1, plan.campaignId);
    expect(dec1[0].decision).toBe("skipped_in_flight");
    // Critical: claim row was deleted (no leak).
    expect(dbState.claims.length).toBe(0);

    setRunBossImpl(defaultRunBossImpl);
    const tick2 = new Date(tick1.getTime() + 60 * 60_000);
    const r2 = await runOneTick(tick2);
    expect(r2.runsInvoked).toBe(1);
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.claims.length).toBe(1);
    expect(dbState.claims[0].status).toBe("completed");

    assertMetric("continuity_runs_skipped_total", 1, { reason: "in_flight" });
    assertMetric("continuity_window_claims_released_total", 1);
    assertMetric("continuity_runs_invoked_total", 1);
  });
});
