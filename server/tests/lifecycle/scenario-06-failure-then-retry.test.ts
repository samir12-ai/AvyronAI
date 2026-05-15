/**
 * Seal #18 / Track #5 — Scenario 6: failed boss run → retry next tick.
 *
 * INVARIANT-RETRY: a failed boss run MUST NOT short-circuit the
 * window. The scheduler must DELETE the in_progress claim row so the
 * next tick can re-claim and successfully invoke runBoss.
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
  runBossMock,
  defaultRunBossImpl,
  setRunBossImpl,
  assertMetric,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 6 — failed boss run releases claim and retries on next tick", () => {
  it("failure then success across two ticks yields 1 successful run, 0 leaked claims", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });

    // Tick 1: runBoss throws.
    setRunBossImpl(async () => {
      throw new Error("simulated_runboss_failure");
    });
    const tick1 = new Date(T0.getTime() + WEEK_MS + 60_000);
    const report1 = await runOneTick(tick1);
    expect(report1.runsFailed).toBe(1);
    const dec1 = getDecisionsForCampaign(report1, plan.campaignId);
    expect(dec1[0].decision).toBe("failed");
    // Claim row was deleted on failure (INVARIANT-RETRY).
    expect(dbState.claims.length).toBe(0);

    // Tick 2: restore default success impl.
    setRunBossImpl(defaultRunBossImpl);
    const tick2 = new Date(tick1.getTime() + 60 * 60 * 1000);
    const report2 = await runOneTick(tick2);
    expect(report2.runsInvoked).toBe(1);
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.evalWindows.length).toBe(1);
    expect(dbState.claims.length).toBe(1);
    expect(dbState.claims[0].status).toBe("completed");

    assertMetric("continuity_runs_failed_total", 1, {
      reason: "simulated_runboss_failure",
    });
    assertMetric("continuity_runs_invoked_total", 1);
    assertMetric("continuity_window_claims_released_total", 1);
    expect(runBossMock).toHaveBeenCalledTimes(2);
  });
});
