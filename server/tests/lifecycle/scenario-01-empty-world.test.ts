/**
 * Seal #18 / Track #5 — Scenario 1: empty world.
 *
 * Boot the scheduler with zero approved plans, advance 24 simulated
 * hours and run a tick every hour. Expect: 24 continuity_ticks rows,
 * 0 boss_runs, 0 audit events, scheduler heartbeat counters reflect
 * 24 ticks scanned across 0 campaigns.
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
  runOneTick,
  advanceHours,
  dbState,
  auditLogs,
  runBossMock,
  assertMetric,
} from "./_harness";

beforeEach(() => setupHarness(new Date("2026-05-01T00:00:00Z")));

describe("Scenario 1 — empty world", () => {
  it("24 hourly ticks with zero campaigns produce 24 tick rows and 0 boss runs", async () => {
    let now = new Date("2026-05-01T00:00:00Z");
    for (let h = 0; h < 24; h++) {
      const report = await runOneTick(now);
      expect(report.campaignsScanned).toBe(0);
      expect(report.runsInvoked).toBe(0);
      now = advanceHours(1, now);
    }
    expect(dbState.insertedTicks.length).toBe(24);
    expect(dbState.bossRuns.length).toBe(0);
    expect(auditLogs.length).toBe(0);
    expect(runBossMock).not.toHaveBeenCalled();

    assertMetric("continuity_scheduler_ticks_total", 24);
    assertMetric("continuity_campaigns_scanned_total", 0);
    assertMetric("continuity_runs_invoked_total", 0);
  });
});
