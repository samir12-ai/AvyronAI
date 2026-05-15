/**
 * Seal #18 / Track #5 — Scenario 2: fresh approval, +1 week.
 *
 * Approve plan at T0; advance one week and run a tick. The scheduler
 * should invoke runBoss exactly once and the (mocked) boss invocation
 * creates one pipeline_eval_windows row at index=1.
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

beforeEach(() => setupHarness(new Date("2026-05-01T00:00:00Z")));
afterEach(() => teardownHarness());

describe("Scenario 2 — single campaign, fresh approval, +1 week", () => {
  it("invokes runBoss exactly once and writes one eval window at index 1", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });
    const tickAt = new Date(T0.getTime() + WEEK_MS);

    const report = await runOneTick(tickAt);

    expect(report.runsInvoked).toBe(1);
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.evalWindows.length).toBe(1);
    expect(dbState.evalWindows[0].windowIndex).toBe(1);
    expect(dbState.insertedTicks.length).toBe(1);

    const decisions = getDecisionsForCampaign(report, plan.campaignId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("invoked");
    expect(decisions[0].expectedWindowIndex).toBe(1);

    assertMetric("continuity_runs_invoked_total", 1);
    assertMetric("continuity_window_claims_acquired_total", 1);

    assertCanonicalSurfaces({
      bossRuns: 1,
      evalWindows: 1,
      anchorResets: 0,
      ticks: 1,
      claims: 1,
      auditEvents: {},
    });
  });
});
