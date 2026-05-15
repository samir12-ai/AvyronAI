/**
 * Seal #18 / Track #5 — Scenario 4: manual + scheduled in same window.
 *
 * Mimic an operator manually invoking runBoss for window N (we just
 * append a completed boss_run row directly). The next scheduled tick
 * lands inside the same window — it MUST detect the existing run and
 * skip with `skipped_no_advance` / reason `current_window_already_evaluated`.
 * Total boss runs: 1 (the manual one).
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
  runBossMock,
  assertMetric,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 4 — manual + scheduled in same window is idempotent", () => {
  it("a prior manual boss run in the current window blocks the scheduled tick", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });

    // Simulate a manual invocation just past the window 1 boundary.
    const manualAt = new Date(T0.getTime() + WEEK_MS + 60_000);
    dbState.bossRuns.push({
      accountId: plan.accountId,
      campaignId: plan.campaignId,
      startedAt: manualAt,
      status: "completed",
    });
    dbState.evalWindows.push({
      campaignId: plan.campaignId,
      planId: plan.planId,
      windowIndex: 1,
    });

    // Scheduled tick lands a few minutes later — same window.
    const scheduledAt = new Date(manualAt.getTime() + 10 * 60 * 1000);
    const report = await runOneTick(scheduledAt);

    expect(dbState.bossRuns.length).toBe(1);
    expect(report.runsInvoked).toBe(0);
    expect(report.runsSkippedIdempotent).toBe(1);
    expect(runBossMock).not.toHaveBeenCalled();

    const decisions = getDecisionsForCampaign(report, plan.campaignId);
    expect(decisions[0].decision).toBe("skipped_no_advance");
    expect(decisions[0].reason).toBe("current_window_already_evaluated");

    assertMetric("continuity_runs_invoked_total", 0);
    assertMetric("continuity_runs_skipped_total", 1, {
      reason: "current_window_already_evaluated",
    });

    assertCanonicalSurfaces({
      bossRuns: 1,
      evalWindows: 1,
      anchorResets: 0,
      ticks: 1,
      claims: 0,
      auditEvents: {},
    });
  });
});
