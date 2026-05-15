/**
 * Seal #18 / Track #5 — Scenario 18: scheduler disabled at boot.
 *
 * `CONTINUITY_SCHEDULER_DISABLED=true` short-circuits
 * `startContinuityScheduler()` and sets `continuity_scheduler_up=0`.
 * `getContinuityHealth().schedulerUp` is false. No ticks fire and no
 * runBoss invocations are observed.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../db", async () => (await import("./_harness")).__dbModuleMock);
vi.mock("../../boss", async () => (await import("./_harness")).__bossModuleMock);
vi.mock("../../boss/concurrency", async () => (await import("./_harness")).__concurrencyModuleMock);
vi.mock("../../audit", async () => (await import("./_harness")).__auditModuleMock);
vi.mock("../../logger", async () => (await import("./_harness")).__loggerModuleMock);

import {
  setupHarness,
  seedApprovedPlan,
  runBossMock,
  dbState,
  getMetricValue,
} from "./_harness";

const PRIOR_ENV = process.env.CONTINUITY_SCHEDULER_DISABLED;

beforeEach(() => {
  setupHarness();
  process.env.CONTINUITY_SCHEDULER_DISABLED = "true";
});
afterEach(() => {
  if (PRIOR_ENV === undefined) delete process.env.CONTINUITY_SCHEDULER_DISABLED;
  else process.env.CONTINUITY_SCHEDULER_DISABLED = PRIOR_ENV;
});

describe("Scenario 18 — CONTINUITY_SCHEDULER_DISABLED short-circuits start", () => {
  it("startContinuityScheduler is a no-op; health reports schedulerUp=false", async () => {
    seedApprovedPlan({ approvedAt: new Date("2026-05-01T00:00:00Z") });

    const mod = await import("../../continuity/scheduler");
    mod._resetContinuityState();
    mod.startContinuityScheduler();

    const health = mod.getContinuityHealth();
    expect(health.schedulerUp).toBe(false);
    expect(getMetricValue("continuity_scheduler_up")).toBe(0);
    expect(runBossMock).not.toHaveBeenCalled();
    expect(dbState.bossRuns.length).toBe(0);
    expect(dbState.insertedTicks.length).toBe(0);
  });
});
