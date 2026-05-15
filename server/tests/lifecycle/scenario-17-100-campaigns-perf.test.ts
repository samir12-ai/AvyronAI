/**
 * Seal #18 / Track #5 — Scenario 17: 100 campaigns × 4 weekly ticks ≤60s.
 *
 * Soft wall-clock check. Seeds 100 plans approved at the same epoch,
 * runs 4 weekly ticks, asserts each tick invoked all 100 campaigns
 * AND total wall-clock is comfortably under 60s.
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
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 17 — 100 campaigns × 4 weekly ticks completes in <60s", () => {
  it("each weekly tick invokes runBoss for all 100 campaigns", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    for (let i = 0; i < 100; i++) {
      seedApprovedPlan({
        accountId: `acct_${i}`,
        campaignId: `camp_${i}`,
        planId: `plan_${i}`,
        approvedAt: T0,
      });
    }

    const start = Date.now();
    for (let week = 1; week <= 4; week++) {
      const tickAt = new Date(T0.getTime() + week * WEEK_MS);
      const r = await runOneTick(tickAt);
      expect(r.campaignsScanned).toBe(100);
      expect(r.runsInvoked).toBe(100);
    }
    const wallClockMs = Date.now() - start;

    expect(dbState.bossRuns.length).toBe(400);
    expect(dbState.evalWindows.length).toBe(400);
    assertMetric("continuity_runs_invoked_total", 400);
    expect(wallClockMs).toBeLessThan(60_000);
  }, 90_000);
});
