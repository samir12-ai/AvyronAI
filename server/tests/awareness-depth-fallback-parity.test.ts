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

// ── Phase 4-A post-audit (2026-05-18): industry-allowlist fallback path ──
//
// When the kill-switch IS on (reasoner enabled) but the operator has
// restricted the reasoner to a subset of industries via
// `COMMERCIAL_REASONER_ALLOWED_INDUSTRIES`, calls for industries outside
// that allowlist MUST fail-closed to the deterministic floor with the
// canonical reason `commercial_reasoner_industry_not_allowed`. This is
// the integration-level proof that the allowlist short-circuits the
// LLM call entirely (no network mock needed — if the LLM were invoked,
// the test would either need to stub the model or it would time out).

describe("awareness depth-gate — industry allowlist fail-closed (reasoner enabled)", () => {
  const origEnabled = process.env.COMMERCIAL_REASONER_ENABLED;
  const origAllowed = process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
  const origCurrent = process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;

  beforeEach(() => {
    process.env.COMMERCIAL_REASONER_ENABLED = "1";
    process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = "dtc_ecom";
    delete process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;
  });

  afterEach(() => {
    if (origEnabled === undefined) delete process.env.COMMERCIAL_REASONER_ENABLED;
    else process.env.COMMERCIAL_REASONER_ENABLED = origEnabled;
    if (origAllowed === undefined) delete process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES;
    else process.env.COMMERCIAL_REASONER_ALLOWED_INDUSTRIES = origAllowed;
    if (origCurrent === undefined) delete process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY;
    else process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY = origCurrent;
  });

  it("industry not in allowlist (explicit) → fallback to floor with canonical reason", async () => {
    const ael = makeAel();
    const r = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael,
      awarenessRouteSourceTexts: ["route", "trigger"],
      industry: "local_services",
    });
    expect(r.fellBackTo).toBe("deterministic_floor");
    expect(r.gateDecision.reason).toBe("commercial_reasoner_industry_not_allowed");
    expect(r.gateDecision.allow).toBe(r.deterministicFloor.passed);
    expect(r.reasoning).toBeNull();
  });

  it("allowlist set + industry missing entirely → fail-closed to floor", async () => {
    const ael = makeAel();
    const r = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael,
      awarenessRouteSourceTexts: ["route", "trigger"],
      // industry intentionally omitted
    });
    expect(r.fellBackTo).toBe("deterministic_floor");
    expect(r.gateDecision.reason).toBe("commercial_reasoner_industry_not_allowed");
  });

  it("industry resolved via COMMERCIAL_REASONER_CURRENT_INDUSTRY env (audit-pipeline path)", async () => {
    process.env.COMMERCIAL_REASONER_CURRENT_INDUSTRY = "local_services";
    const ael = makeAel();
    const r = await interpretAwarenessDepth({
      accountId: "test-acct",
      campaignId: "test-camp",
      runId: "test-run",
      ael,
      awarenessRouteSourceTexts: ["route", "trigger"],
    });
    expect(r.fellBackTo).toBe("deterministic_floor");
    expect(r.gateDecision.reason).toBe("commercial_reasoner_industry_not_allowed");
    expect((r.gateDecision.detail ?? "")).toContain("local_services");
  });
});
