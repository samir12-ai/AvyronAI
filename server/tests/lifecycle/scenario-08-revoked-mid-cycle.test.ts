/**
 * Seal #18 / Track #5 — Scenario 8: plan revoked mid-cycle.
 *
 * After the first weekly run, the plan is revoked (removed from
 * APPROVED). Subsequent ticks must observe zero campaigns — no orphan
 * eval_windows or boss_runs are created.
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
  revokePlan,
  runOneTick,
  dbState,
  WEEK_MS,
  assertMetric,
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 8 — revoked plan stops further runs", () => {
  it("after revocation no new boss_runs or eval_windows are produced", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });

    // Cycle 1.
    await runOneTick(new Date(T0.getTime() + WEEK_MS + 60_000));
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.evalWindows.length).toBe(1);

    revokePlan(plan.planId);

    // Two more ticks across the next 2 weeks — should be no-ops.
    const r2 = await runOneTick(new Date(T0.getTime() + 2 * WEEK_MS + 60_000));
    const r3 = await runOneTick(new Date(T0.getTime() + 3 * WEEK_MS + 60_000));

    expect(r2.campaignsScanned).toBe(0);
    expect(r3.campaignsScanned).toBe(0);
    expect(dbState.bossRuns.length).toBe(1);
    expect(dbState.evalWindows.length).toBe(1);
    assertMetric("continuity_runs_invoked_total", 1);
    assertMetric("continuity_scheduler_ticks_total", 3);

    assertCanonicalSurfaces({
      bossRuns: 1,
      evalWindows: 1,
      anchorResets: 1,
      ticks: 3,
      claims: 1,
      auditEvents: { CONTINUITY_REANCHOR: 1 },
    });
  });
});
