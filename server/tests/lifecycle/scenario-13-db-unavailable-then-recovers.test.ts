/**
 * Seal #18 / Track #5 — Scenario 13: DB unavailable for 30 minutes.
 *
 * While `dbAvailable=false`, ticks gracefully degrade (list returns
 * empty, no boss runs invoked). Once DB returns, the next tick scans
 * the campaign normally and invokes runBoss.
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
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 13 — DB unavailable then recovers", () => {
  it("ticks during outage are no-ops; tick after recovery invokes runBoss", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    seedApprovedPlan({ approvedAt: T0 });

    const tickAt = new Date(T0.getTime() + WEEK_MS + 60_000);

    // 30-minute outage = ~30 ticks if the scheduler ticked every minute.
    // We model 3 outage ticks at 10-minute spacing.
    dbState.dbAvailable = false;
    for (let i = 0; i < 3; i++) {
      const r = await runOneTick(new Date(tickAt.getTime() + i * 10 * 60_000));
      expect(r.campaignsScanned).toBe(0);
      expect(r.runsInvoked).toBe(0);
    }
    expect(runBossMock).not.toHaveBeenCalled();
    expect(dbState.bossRuns.length).toBe(0);

    // DB returns.
    dbState.dbAvailable = true;
    const recoveryAt = new Date(tickAt.getTime() + 35 * 60_000);
    const rr = await runOneTick(recoveryAt);
    expect(rr.campaignsScanned).toBe(1);
    expect(rr.runsInvoked).toBe(1);
    expect(dbState.bossRuns.length).toBe(1);

    assertMetric("continuity_runs_invoked_total", 1);
  });
});
