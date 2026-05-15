/**
 * Seal #18 / Track #5 — Scenario 3: single campaign, +2 weeks.
 *
 * Two ticks at +1w and +2w → two distinct boss runs (one per window),
 * eval_windows has indices [1, 2].
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
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 3 — single campaign, +2 weeks", () => {
  it("two ticks one week apart yield two boss runs and two eval windows", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    seedApprovedPlan({ approvedAt: T0 });

    await runOneTick(new Date(T0.getTime() + WEEK_MS));
    await runOneTick(new Date(T0.getTime() + 2 * WEEK_MS));

    expect(dbState.bossRuns.length).toBe(2);
    expect(dbState.evalWindows.map((w) => w.windowIndex).sort()).toEqual([1, 2]);
    expect(dbState.insertedTicks.length).toBe(2);
    assertMetric("continuity_runs_invoked_total", 2);
    assertMetric("continuity_window_claims_acquired_total", 2);

    assertCanonicalSurfaces({
      bossRuns: 2,
      evalWindows: 2,
      anchorResets: 0,
      ticks: 2,
      claims: 2,
      auditEvents: {},
    });
  });
});
