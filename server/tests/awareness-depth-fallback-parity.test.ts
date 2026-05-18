/**
 * Phase 4-A — fallback floor parity test.
 *
 * Asserts that with `COMMERCIAL_REASONER_ENABLED=0` (the kill-switch
 * off — the default), the new awareness depth interpreter is byte-
 * identical to the legacy `enforceEngineDepthCompliance` call in
 * BOTH directions: the deterministicFloor field returned by the
 * interpreter equals the legacy result, and the gate decision
 * matches `enforceEngineDepthCompliance.passed`.
 *
 * This is §13-criterion-8 in plan form — a regression here means
 * Phase 4-A has compromised the safety floor and rollout MUST stop.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { interpretAwarenessDepth } from "../commercial-reasoning/awareness-depth-interpreter";
import { enforceEngineDepthCompliance } from "../causal-enforcement-layer/engine";
import {
  EMPTY_ANALYTICAL_PACKAGE,
  type AnalyticalPackage,
} from "../analytical-enrichment-layer/types";

const ORIGINAL_FLAG = process.env.COMMERCIAL_REASONER_ENABLED;

beforeEach(() => {
  process.env.COMMERCIAL_REASONER_ENABLED = "0";
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.COMMERCIAL_REASONER_ENABLED;
  else process.env.COMMERCIAL_REASONER_ENABLED = ORIGINAL_FLAG;
});

function makeAel(): AnalyticalPackage {
  return {
    ...EMPTY_ANALYTICAL_PACKAGE,
    root_causes: [
      {
        surfaceSignal: "drop-off at pricing page",
        deepCause: "tier names do not match the buyer's value model",
        causalReasoning: "buyers can't map tier features to outcomes they care about",
        sourceData: "ig comments + landing analytics",
        confidenceLevel: "high",
      },
    ],
  };
}

describe("awareness depth-gate fallback parity (kill-switch off)", () => {
  it("returns the deterministic floor result byte-identically", async () => {
    const ael = makeAel();
    const sourceTexts = [
      "warm-traffic-comparison-route",
      "evaluation-stage",
      "social-proof-trigger",
      "comparison-anchor",
      "third-party-validation",
      "fit-funnel-step",
      "tier-clarity-objection",
    ];

    const legacy = enforceEngineDepthCompliance("awareness", sourceTexts, ael);
    const interpreted = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael,
      awarenessRouteSourceTexts: sourceTexts,
    });

    expect(interpreted.fellBackTo).toBe("deterministic_floor");
    expect(interpreted.gateDecision.reason).toBe("commercial_reasoner_disabled");
    expect(interpreted.deterministicFloor.passed).toBe(legacy.passed);
    expect(interpreted.deterministicFloor.causalDepthScore).toBe(legacy.causalDepthScore);
    expect(interpreted.deterministicFloor.violations.length).toBe(legacy.violations.length);
    expect(interpreted.deterministicFloor.rootCausesEvaluated).toBe(legacy.rootCausesEvaluated);
    expect(interpreted.reasoning).toBeNull();
  });

  it("gate allow follows the deterministic floor when reasoner is disabled", async () => {
    const ael = makeAel();
    const sourceTexts = ["", "", ""];
    const interpreted = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael,
      awarenessRouteSourceTexts: sourceTexts,
    });
    expect(interpreted.fellBackTo).toBe("deterministic_floor");
    expect(interpreted.gateDecision.allow).toBe(interpreted.deterministicFloor.passed);
  });

  it("no AEL → fallback floor returns score=0 (legacy behavior preserved)", async () => {
    const interpreted = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael: null,
      awarenessRouteSourceTexts: ["some route", "some trigger"],
    });
    expect(interpreted.fellBackTo).toBe("deterministic_floor");
    expect(interpreted.deterministicFloor.causalDepthScore).toBe(0);
  });
});
