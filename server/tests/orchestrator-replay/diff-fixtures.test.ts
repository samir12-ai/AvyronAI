/**
 * Task #89 / Phase 4-A — 7 hand-crafted divergence fixtures.
 *
 * Each fixture forces exactly ONE class of divergence and asserts the
 * classifier returns that class. This is the precedence proof for
 * STRUCTURAL > CANONICAL_FIELD > DEGRADATION_SURFACE > BUDGET_LEDGER >
 * PROVENANCE > ORDER > TIMING_ONLY.
 */
import { describe, it, expect } from "vitest";
import { classifyReplay } from "../../orchestrator/replay/diff";
import type { CassetteFinalResult } from "../../orchestrator/replay/types";

function baseFinal(): CassetteFinalResult {
  return {
    jobId: "j",
    status: "COMPLETED",
    completedEngines: ["mi", "audience"],
    durationMs: 100,
    ledgerEntryCount: 0,
  };
}

function baseObs() {
  return {
    finalResult: baseFinal(),
    systemControlVerdict: { integrityVerdict: "PASS", executionMode: "FULL", blockReasons: [] },
    budgetLedger: [{ engineId: "budget", decisionAction: "scale", appliedAt: 1 }],
    engineOrder: ["mi", "audience"],
    planPersist: { planId: "p1", source: "primary", degraded: false },
    contextKeys: ["mi", "audience"],
    inputHashes: { mi: "h1", audience: "h2" },
  };
}

describe("Task #89 / diff — 7 divergence-class fixtures", () => {
  it("1. STRUCTURAL — completedEngines length differs", () => {
    const exp = baseObs();
    const act = baseObs();
    act.finalResult.completedEngines = ["mi"];
    const d = classifyReplay(exp, act);
    const klasses = d.map((x) => x.class);
    expect(klasses).toContain("STRUCTURAL");
  });

  it("2. CANONICAL_FIELD — finalResult.status changed", () => {
    const exp = baseObs();
    const act = baseObs();
    act.finalResult.status = "PARTIAL";
    const d = classifyReplay(exp, act);
    expect(d.find((x) => x.path === "finalResult.status")?.class).toBe("CANONICAL_FIELD");
  });

  it("3. DEGRADATION_SURFACE — planPersist.degraded flipped", () => {
    const exp = baseObs();
    const act = baseObs();
    act.planPersist!.degraded = true;
    const d = classifyReplay(exp, act);
    expect(d.find((x) => x.path === "planPersist.degraded")?.class).toBe("DEGRADATION_SURFACE");
  });

  it("4. BUDGET_LEDGER — entry-tuple decisionAction differs", () => {
    const exp = baseObs();
    const act = baseObs();
    act.budgetLedger[0].decisionAction = "halt";
    const d = classifyReplay(exp, act);
    expect(d.find((x) => x.path.startsWith("budgetLedger[0]"))?.class).toBe("BUDGET_LEDGER");
  });

  it("5. PROVENANCE — inputHashes.mi differs", () => {
    const exp = baseObs();
    const act = baseObs();
    act.inputHashes!.mi = "h1-changed";
    const d = classifyReplay(exp, act);
    expect(d.find((x) => x.path === "inputHashes.mi")?.class).toBe("PROVENANCE");
  });

  it("6. ORDER — engine sequence reversed", () => {
    const exp = baseObs();
    const act = baseObs();
    act.engineOrder = ["audience", "mi"];
    act.finalResult.completedEngines = ["audience", "mi"];
    const d = classifyReplay(exp, act);
    // Both engineOrder and completedEngines mismatches are ORDER (lengths match).
    expect(d.find((x) => x.path === "engineOrder")?.class).toBe("ORDER");
    expect(d.find((x) => x.path === "finalResult.completedEngines")?.class).toBe("ORDER");
  });

  it("7. TIMING_ONLY — only durationMs differs", () => {
    const exp = baseObs();
    const act = baseObs();
    act.finalResult.durationMs = 999;
    const d = classifyReplay(exp, act);
    expect(d.length).toBe(1);
    expect(d[0].class).toBe("TIMING_ONLY");
  });

  it("8. deep-diff catches a non-boutique field the hand-coded checks miss (STRUCTURAL)", () => {
    // Inject a brand-new canonical field on finalResult that the boutique
    // checks above do NOT enumerate. The deep walker must surface it as
    // STRUCTURAL — proving the harness is not blind to fields added by a
    // future engine. Pre-deep-diff this divergence was silently dropped.
    const exp = baseObs();
    const act = baseObs();
    (act.finalResult as any).newCanonicalField = "drifted_value";
    const d = classifyReplay(exp, act);
    const hit = d.find((x) => x.path === "finalResult.newCanonicalField");
    expect(hit).toBeDefined();
    expect(hit!.class).toBe("STRUCTURAL");
    expect(hit!.actual).toBe("drifted_value");
    expect(hit!.expected).toBeUndefined();
  });

  it("9. deep-diff catches a controlVerdict.blockReasons array drift (STRUCTURAL)", () => {
    // controlVerdict.blockReasons is NOT in the boutique list. Pre-deep-diff
    // the harness would silently miss drift here.
    const exp = baseObs();
    const act = baseObs();
    (act.systemControlVerdict as any).blockReasons = ["new_reason"];
    const d = classifyReplay(exp, act);
    const hit = d.find((x) => x.path.startsWith("systemControlVerdict.blockReasons"));
    expect(hit).toBeDefined();
    // Length mismatch (0 → 1) or [0] element diff — both are STRUCTURAL.
    expect(hit!.class).toBe("STRUCTURAL");
  });

  it("10. precedence: CANONICAL_FIELD wins over a co-located STRUCTURAL diff", () => {
    // When finalResult.status AND finalResult.planId both differ, the
    // boutique status check fires FIRST (CANONICAL_FIELD); the deep walker
    // sees status path is already in `seen` and skips it — proving
    // precedence holds and we do not double-report.
    const exp = baseObs();
    const act = baseObs();
    act.finalResult.status = "BLOCKED";
    act.finalResult.planId = "different-plan";
    const d = classifyReplay(exp, act);
    const statusHits = d.filter((x) => x.path === "finalResult.status");
    expect(statusHits.length).toBe(1);
    expect(statusHits[0].class).toBe("CANONICAL_FIELD");
  });
});
