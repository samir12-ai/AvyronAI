/**
 * Seal #18 / Track #5 — Scenario 16: re-anchor while runBoss is in flight.
 *
 * Tick A starts: runBoss is mocked to await a controllable promise.
 * Mid-flight, another process inserts a `plan_anchor_resets` row at a
 * later timestamp (representing an operator/manual API re-anchor).
 * runBoss then completes; tick A finishes. Tick B (next hour) MUST
 * pick up the new anchor and recompute window_index from there.
 *
 * To prove the new anchor is honored we make tickB land at a moment
 * where the OLD anchor would compute a window_index that is already
 * completed (skipped) but the NEW anchor computes window_index=0
 * which has no claim and is therefore INVOKED.
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
  setRunBossImpl,
  defaultRunBossImpl,
  getDecisionsForCampaign,
} from "./_harness";

beforeEach(() => setupHarness());
afterEach(() => teardownHarness());

describe("Scenario 16 — re-anchor injected mid-flight is honored on next tick", () => {
  it("manual reset row written during tick A is picked up by tick B", async () => {
    const T0 = new Date("2026-05-01T00:00:00Z");
    const plan = seedApprovedPlan({ approvedAt: T0 });

    // Exact week boundary — no long-gap reanchor by the scheduler.
    const tickA_at = new Date(T0.getTime() + WEEK_MS);

    // Block runBoss until we manually resolve it. While it's in flight
    // we INSERT a fresh anchor reset row at tickA_at + 30s.
    let resolveBoss: ((v: any) => void) | null = null;
    setRunBossImpl(
      (input) =>
        new Promise((resolve) => {
          resolveBoss = (v: any) => {
            // Fall through to default impl so the bossRun + evalWindow rows are written.
            void defaultRunBossImpl(input).then(resolve);
            void v;
          };
        }),
    );

    const tickAPromise = runOneTick(tickA_at);
    // Wait long enough for the scheduler to traverse plan-resolution +
    // claim insert and then call runBoss.
    for (let i = 0; i < 200 && resolveBoss === null; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    if (resolveBoss === null) {
      throw new Error("runBoss was not invoked within 1s");
    }

    // Inject a manual reset row mid-flight.
    const manualResetAt = new Date(tickA_at.getTime() + 30_000);
    dbState.resets.push({
      planId: plan.planId,
      reanchoredAt: manualResetAt,
      reason: "manual_test_injection",
    });

    // Resolve runBoss to let tick A finish (writes evalWindow @ index 1
    // and marks claim @ index 1 completed).
    resolveBoss!(undefined);
    await tickAPromise;
    expect(dbState.bossRuns.length).toBe(1);
    // The mid-flight injected reset is the newest anchor when defaultRunBossImpl
    // resolves, so the boss-written evalWindow may be at index 0 (recomputed
    // against the new anchor) — what matters for THIS scenario is that tick B
    // observes the new anchor and re-invokes runBoss (asserted below).

    // Tick B exactly at manualResetAt: the NEW anchor yields expected=0.
    // The OLD anchor (T0) would have yielded expected=1 (already
    // completed → skipped). Asserting "invoked" + expected=0 proves the
    // new anchor was picked up.
    setRunBossImpl(defaultRunBossImpl);
    const tickB_at = new Date(manualResetAt.getTime());
    const reportB = await runOneTick(tickB_at);
    const decB = getDecisionsForCampaign(reportB, plan.campaignId);
    expect(decB[0].expectedWindowIndex).toBe(0);
    expect(decB[0].decision).toBe("invoked");
    expect(dbState.bossRuns.length).toBe(2);

    assertCanonicalSurfaces({
      bossRuns: 2,
      anchorResets: 0,
      ticks: 2,
      auditEvents: {},
    });
  });
});
