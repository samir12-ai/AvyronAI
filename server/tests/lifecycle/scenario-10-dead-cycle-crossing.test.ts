/**
 * Seal #18 / Track #5 — Scenario 10: DEAD_CYCLE_THRESHOLD crossed.
 *
 * A plan older than DEAD_CYCLE_THRESHOLD_MS (8 days) with NO boss
 * runs ever must produce a CONTINUITY_DEAD_CYCLE audit and bump the
 * `continuity_dead_cycles_total` counter on the crossing tick.
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
  getAuditEvents,
  assertMetric,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 10 — DEAD_CYCLE_THRESHOLD crossing fires the audit", () => {
  it("a 9-day-old plan with no boss_runs fires CONTINUITY_DEAD_CYCLE", async () => {
    const T_NOW = new Date("2026-05-15T00:00:00Z");
    const NINE_DAYS = 9 * 24 * 60 * 60 * 1000;
    const T_ANCHOR = new Date(T_NOW.getTime() - NINE_DAYS);
    const plan = seedApprovedPlan({ approvedAt: T_ANCHOR });

    const report = await runOneTick(T_NOW);

    expect(report.deadCyclesDetected).toBe(1);
    const events = getAuditEvents("CONTINUITY_DEAD_CYCLE");
    expect(events.length).toBe(1);
    expect(events[0].payload.details.campaignId).toBe(plan.campaignId);
    expect(events[0].payload.details.sinceDays).toBe(9);
    assertMetric("continuity_dead_cycles_total", 1);
  });
});
