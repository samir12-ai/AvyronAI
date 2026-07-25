/**
 * Seal #18 / Track #5 — Scenario 15: anchor exactly 7 days ago.
 *
 * Boundary case: floor(diff / WINDOW_MS) where diff === WINDOW_MS
 * yields window_index = 1. Long-gap reanchor uses STRICT > so no
 * reanchor row is written.
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
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 15 — anchor exactly 7d ago yields window_index=1, no reanchor", () => {
  it("invokes runBoss for window 1 and writes no anchor reset", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const T_NOW = new Date(T0.getTime() + WEEK_MS); // exactly 7d
    const plan = seedApprovedPlan({ approvedAt: T0 });

    const report = await runOneTick(T_NOW);
    const dec = getDecisionsForCampaign(report, plan.campaignId);
    expect(dec[0].expectedWindowIndex).toBe(1);
    expect(dec[0].decision).toBe("invoked");
    expect(report.reanchorsWritten).toBe(0);
    expect(dbState.insertedResets.length).toBe(0);
    expect(dbState.bossRuns.length).toBe(1);

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
