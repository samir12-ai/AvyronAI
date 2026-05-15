/**
 * Seal #18 / Track #5 — Scenario 14: clock skew (now < anchor).
 *
 * If the simulated `now` is BEFORE the plan's approvedAt (clock went
 * backwards / NTP skew), `computeWindowIndex` clamps the diff to 0
 * via `Math.max(0, ...)`. The scheduler must NOT throw; expected
 * window index is 0.
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
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());

describe("Scenario 14 — clock skew (now < anchor)", () => {
  it("clamps window_index to 0 and does not crash", async () => {
    const T_FUTURE_ANCHOR = new Date("2026-06-01T00:00:00Z");
    const T_NOW = new Date("2026-05-01T00:00:00Z"); // 1 month BEFORE anchor
    const plan = seedApprovedPlan({ approvedAt: T_FUTURE_ANCHOR });

    const report = await runOneTick(T_NOW);
    const dec = getDecisionsForCampaign(report, plan.campaignId);
    expect(dec[0].expectedWindowIndex).toBe(0);
    // Either invoked (single tick) or skipped — but no exception
    // thrown means the scheduler survived the skew.
    expect(["invoked", "reanchored_then_invoked"]).toContain(dec[0].decision);
  });
});
