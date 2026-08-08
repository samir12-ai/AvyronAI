/**
 * Regression tests for CEL compliance bugs confirmed in forensic audit (2026-08-08).
 *
 * Bug 1 (CEL_VALIDATOR_BUG): TRUST_OPACITY_RULE.requiredAxisPatterns was missing `/evidence/i`,
 *   causing "evidence-linked" territory text to fail alignment check despite demonstrating
 *   transparency/proof commitment. Fix: added `/evidence/i` to requiredAxisPatterns.
 *
 * Bug 2 (LINEAGE_MAPPING_BUG): Orchestrator called enforceGenericEngineCompliance("differentiation")
 *   using only .claim strings — missing pillar descriptions and mechanism text where TRUST_OPACITY
 *   patterns (transparent, evidence-linked) appear, producing spurious missing_alignment violations.
 *   Fix: orchestrator now builds full texts (pillar name+description + claims + mechanism.description)
 *   mirroring the engine's own celSourceTexts construction (engine.ts:1532-1536).
 *
 * Bugs 3 & 4 (ALREADY_FIXED before audit): Awareness engine excluded mythBreaker/narrativeReframe
 *   from CEL source texts (now fixed at awareness-engine/engine.ts:1132-1147). Funnel engine
 *   called enforceEngineDepthCompliance before groundedJourneyRationale was attached (FIX-C at
 *   funnel-engine/engine.ts:1511). Regression tests verify the fix invariants hold.
 */

import { describe, it, expect } from "vitest";
import {
  enforcePositioningCompliance,
  enforceGenericEngineCompliance,
  enforceEngineDepthCompliance,
  CAUSAL_CONSTRAINT_RULES,
  CONSTRAINT_THRESHOLDS,
} from "../causal-enforcement-layer/engine";
import { EMPTY_ANALYTICAL_PACKAGE } from "../analytical-enrichment-layer/types";

// ---------------------------------------------------------------------------
// Minimal AEL stub with TRUST_OPACITY as primary theme
// ---------------------------------------------------------------------------
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";

const TRUST_AEL: AnalyticalPackage = {
  ...EMPTY_ANALYTICAL_PACKAGE,
  root_causes: [
    {
      surfaceSignal: "Users complain about high price and refund policy issues",
      deepCause:
        "Users perceive the product as overpriced relative to demonstrated value and fear financial loss due to restrictive refund policies, which undermines trust in the offering",
      causalReasoning:
        "This financial anxiety is rooted in lack of clear proof of value and fear of commitment without safety nets, causing hesitation to purchase",
      sourceData: "Review dataset: 1,200 negative reviews mentioning price + refund",
      confidenceLevel: "high" as const,
    },
  ],
  causal_chains: [
    {
      pain: "Financial anxiety from high price and no refund",
      cause: "Users cannot see clear value justification and fear losing money",
      impact: "Users hesitate to commit financially due to risk aversion",
      behavior: "Users delay or avoid purchase, seek cheaper alternatives",
      conversionEffect: "Reduces purchase conversion rate significantly",
    },
  ],
};

// Helper: build a minimal territory object with required confidenceScore
function makeTerritories(overrides: {
  name?: string;
  contrastAxis?: string;
  narrativeDirection?: string;
  enemyDefinition?: string;
}[]): Array<{
  name: string;
  contrastAxis: string;
  narrativeDirection: string;
  enemyDefinition: string;
  confidenceScore: number;
}> {
  return overrides.map((t) => ({
    name: t.name ?? "Test Territory",
    contrastAxis: t.contrastAxis ?? "",
    narrativeDirection: t.narrativeDirection ?? "",
    enemyDefinition: t.enemyDefinition ?? "",
    confidenceScore: 0.8,
  }));
}

// ---------------------------------------------------------------------------
// Bug 1 tests — TRUST_OPACITY_RULE pattern gap: /evidence/i
// ---------------------------------------------------------------------------
describe("Bug 1 (CEL_VALIDATOR_BUG) — TRUST_OPACITY_RULE /evidence/i pattern", () => {
  it("CAUSAL_CONSTRAINT_RULES includes /evidence/i in TRUST_OPACITY_RULE.requiredAxisPatterns after fix", () => {
    const rule = CAUSAL_CONSTRAINT_RULES.find((r) => r.id === "TRUST_OPACITY_RULE");
    expect(rule).toBeDefined();
    const patterns = rule!.requiredAxisPatterns;
    const hasEvidencePattern = patterns.some((p) => p.test("evidence-linked"));
    expect(hasEvidencePattern).toBe(true);
  });

  it("territory with 'evidence-linked' passes TRUST_OPACITY alignment after fix", () => {
    const result = enforcePositioningCompliance(
      makeTerritories([
        {
          name: "Evidence-Linked Transparency",
          contrastAxis:
            "B2B teams leverage our evidence-linked pipeline to validate decisions through live competitor data, eliminating financial risk and uncertainty.",
          narrativeDirection:
            "Our evidence-linked strategy engine builds trust by surfacing real-time proof of value before purchase commitment.",
          enemyDefinition:
            "Generic platforms hide performance metrics behind opaque dashboards.",
        },
      ]),
      TRUST_AEL,
    );

    const alignmentViolations = result.violations.filter(
      (v) => v.violationType === "missing_alignment",
    );
    expect(alignmentViolations).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("territory with only generic benefit language fails TRUST_OPACITY alignment (gate is not weakened)", () => {
    const result = enforcePositioningCompliance(
      makeTerritories([
        {
          name: "Effortless Results",
          contrastAxis:
            "Our platform delivers faster results with less effort and a streamlined workflow.",
          narrativeDirection:
            "Get more done with AI-powered automation that maximises your marketing output.",
          enemyDefinition: "Traditional tools waste time and slow teams down.",
        },
      ]),
      TRUST_AEL,
    );

    const alignmentViolations = result.violations.filter(
      (v) => v.violationType === "missing_alignment",
    );
    expect(alignmentViolations.length).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });

  it("territory with 'transparent' (original patterns) still passes — fix is strictly additive", () => {
    const result = enforcePositioningCompliance(
      makeTerritories([
        {
          name: "Transparent Performance Mirror",
          contrastAxis:
            "Our transparent ROI tracking gives B2B teams clear proof of value before committing budget.",
          narrativeDirection:
            "Transparent, credible reporting eliminates buyer hesitation by making outcomes predictable.",
          enemyDefinition:
            "Opaque black-box AI platforms that hide methodology.",
        },
      ]),
      TRUST_AEL,
    );

    expect(result.passed).toBe(true);
  });

  it("TRUST_OPACITY_RULE threshold remains at 0.75 — fix does not lower the bar", () => {
    expect(CONSTRAINT_THRESHOLDS["TRUST_OPACITY_RULE"]).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 tests — Differentiation duplicate CEL evaluation
// ---------------------------------------------------------------------------
describe("Bug 2 (LINEAGE_MAPPING_BUG) — Differentiation: claim-only vs full-text CEL evaluation", () => {
  it("claim strings alone (old shallow orchestrator path) miss TRUST_OPACITY patterns even when full output has them", () => {
    // Simulate the OLD (buggy) orchestrator path: only .claim field, no pillar description
    const claimStringsOnly = [
      "By deploying its Community Validation method, the product unifies competitor data with buyer feedback into actionable insights, counteracting buyer isolation and enhancing peer validation.",
      "The Complexity Resolution method breaks down marketing strategy complexity by linking every strategic output to competitor complaint data and campaign triggers.",
    ];

    const result = enforceGenericEngineCompliance(
      "differentiation",
      claimStringsOnly,
      TRUST_AEL,
    );

    // The shallow claim strings don't contain TRUST_OPACITY required patterns —
    // this confirms the removed orchestrator path was producing spurious violations
    const hasAlignmentViolation = result.violations.some(
      (v) => v.violationType === "missing_alignment",
    );
    expect(hasAlignmentViolation).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("pillar+description text (what the engine's depth check sees) detects TRUST_OPACITY patterns", () => {
    // Simulate the engine's internal check with full pillar descriptions + mechanism
    const fullTexts = [
      "Community Validation Pipeline Gap Method — This pillar addresses the gap by integrating live competitor complaint data with buyer feedback. It provides users with directly traceable, actionable diagnostics, making complex strategy generation transparent, actionable, and anchored in real market signals.",
      "Complexity Resolution — Embedding stepwise, evidence-linked guidance throughout the 15-engine pipeline prevents user frustration by making complex strategy generation transparent and credible.",
      "Mechanism: Our process-based differentiation employs an anchored, transparent workflow that directly resolves core root causes of financial anxiety through honest, verifiable strategy evidence.",
    ];

    const result = enforceGenericEngineCompliance(
      "differentiation",
      fullTexts,
      TRUST_AEL,
    );

    // Full text includes "transparent", "evidence-linked" — should pass alignment
    const alignmentViolations = result.violations.filter(
      (v) => v.violationType === "missing_alignment",
    );
    expect(alignmentViolations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 3 tests (already fixed) — Awareness mythBreaker text in CEL source
// ---------------------------------------------------------------------------
describe("Bug 3 (ALREADY_FIXED) — Awareness: mythBreaker/narrativeReframe must reach CEL depth gate", () => {
  it("celSourceTexts without mythBreaker (pre-fix path) produces worse depth scoring", () => {
    // Shallow labels only — what the pre-fix awareness engine passed to enforceEngineDepthCompliance
    const shallowTexts = [
      "authority entry awareness route",
      "authority_entry",
      "problem_aware",
      "trust_breakdown",
      "moderate — some trust-building needed alongside entry mechanism",
      "adequate — entry route is compatible with funnel structure",
      "Funnel has no trust path — awareness entry must compensate",
    ];

    const shallowResult = enforceEngineDepthCompliance("awareness", shallowTexts, TRUST_AEL);

    // Rich texts with mythBreaker (post-fix state)
    const richTexts = [
      ...shallowTexts,
      // mythBreakerStatement
      "The hesitation to commit to the product is not about price alone — it is because users cannot see clear, evidence-linked value justification until the Refund Pipeline method reveals refund triggers from live competitor data.",
      // beliefToContradict
      "Users hesitate to commit financially due to risk aversion caused by perceived high price and lack of refund options.",
      // contradictionLogic
      "The actual root cause is that users cannot see clear, evidence-linked value justification before purchase, which creates financial anxiety and undermines trust in the offering.",
      // narrativeReframe currentModel
      "Marketing SaaS platforms overpromise AI strategy but fail to deliver measurable results, leaving users exposed to refund risks and purchase hesitation.",
    ];

    const richResult = enforceEngineDepthCompliance("awareness", richTexts, TRUST_AEL);

    // Rich texts should produce a better (higher) causal depth score.
    // Violation counts are NOT asserted here: the factual-claim classifier produces
    // more factual sentences for longer texts, which can increase violation counts
    // even when causal grounding improves. The depth score is the stable invariant.
    expect(richResult.causalDepthScore).toBeGreaterThanOrEqual(shallowResult.causalDepthScore);
  });

  it("mythBreaker text anchored to RC1 language is detectable by depth gate", () => {
    const richTexts = [
      // Only the myth-breaker content — tests that these texts are sufficient to ground RC1
      "The hesitation to commit to the product is not about price alone — users cannot see clear, evidence-linked value justification until the Refund Pipeline method reveals refund triggers from live competitor data.",
      "The actual root cause is that users cannot see clear value justification before purchase, which creates financial anxiety and undermines trust in the offering. Users hesitate to commit financially due to risk aversion caused by perceived high price and lack of refund options.",
      "Marketing SaaS platforms overpromise AI strategy but fail to deliver measurable results, leaving users exposed to refund risks. The Refund Pipeline Diagnostic System provides evidence-linked, trustworthy strategy output anchored in real competitor complaint data, resolving the financial anxiety and trust deficit.",
    ];

    const result = enforceEngineDepthCompliance("awareness", richTexts, TRUST_AEL);

    const rootCauseViolations = result.violations.filter(
      (v) => v.violationType === "missing_root_cause",
    );
    expect(rootCauseViolations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bug 4 tests (already fixed) — Funnel groundedJourneyRationale before CEL check
// ---------------------------------------------------------------------------
describe("Bug 4 (ALREADY_FIXED) — Funnel: groundedJourneyRationale must be attached before depth gate", () => {
  it("funnel celSourceTexts WITHOUT groundedJourneyRationale (pre-FIX-C) has worse depth scoring", () => {
    // Only deterministic stage labels — the pre-FIX-C state (groundedJourneyRationale was [])
    const preFix = [
      "full_funnel — Trust-First Entry Funnel for B2B Founders",
      "entry Capture attention and establish problem awareness through competitor data mirror",
      "consideration Build trust through evidence-linked strategy pipeline walkthrough",
      "decision Provide clear ROI evidence and risk mitigation for commitment",
    ];

    // Post-FIX-C: groundedJourneyRationale items included
    const postFix = [
      ...preFix,
      "The awareness phase addresses users' fear of losing money due to unclear ROI and restrictive refund policies by introducing how the Refund Pipeline method continuously analyzes competitor complaint data to preempt refund triggers, reducing purchase hesitation.",
      "The engagement phase breaks down the complexity of marketing strategy execution by demonstrating the 15-engine sequential strategy pipeline that delivers depth-gated, evidence-linked strategies, building user confidence in achieving marketing results.",
      "The decision phase resolves confusion caused by market saturation by clearly differentiating the product through its unique integration of live competitor complaint data and community validation pipeline, reducing skepticism and buyer inertia.",
    ];

    const preFixResult = enforceEngineDepthCompliance("funnel", preFix, TRUST_AEL);
    const postFixResult = enforceEngineDepthCompliance("funnel", postFix, TRUST_AEL);

    // Post-fix should have a better (higher) or equal causal depth score
    expect(postFixResult.causalDepthScore).toBeGreaterThanOrEqual(preFixResult.causalDepthScore);
  });

  it("funnel grounded journey rationale anchored to RC1/CC1 grounds the depth check", () => {
    const texts = [
      "The awareness phase addresses users' fear of losing money due to unclear ROI and restrictive refund policies by introducing how the Refund Pipeline method continuously analyzes competitor complaint data to preempt refund triggers, reducing purchase hesitation.",
      "The engagement phase demonstrates the evidence-linked strategy pipeline that delivers strategies to build user confidence and trust.",
      "The decision phase resolves confusion by clearly differentiating the product through unique integration of live data, reducing skepticism.",
    ];

    const result = enforceEngineDepthCompliance("funnel", texts, TRUST_AEL);

    const rootCauseViolations = result.violations.filter(
      (v) => v.violationType === "missing_root_cause",
    );
    expect(rootCauseViolations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-engine correctness — gate integrity preserved after all fixes
// ---------------------------------------------------------------------------
describe("CEL gate integrity — rules not weakened by fixes", () => {
  it("TRUST_OPACITY_RULE threshold remains at 0.75", () => {
    expect(CONSTRAINT_THRESHOLDS["TRUST_OPACITY_RULE"]).toBe(0.75);
  });

  it("VALUE_PERCEPTION_RULE threshold remains at 0.75", () => {
    expect(CONSTRAINT_THRESHOLDS["VALUE_PERCEPTION_RULE"]).toBe(0.75);
  });

  it("territory with empty content fails (AEL present but no causal alignment)", () => {
    const result = enforcePositioningCompliance(
      makeTerritories([
        {
          name: "Empty Territory",
          contrastAxis: "",
          narrativeDirection: "",
          enemyDefinition: "",
        },
      ]),
      TRUST_AEL,
    );
    // Empty territory has no alignment with TRUST_OPACITY required patterns
    expect(result.passed).toBe(false);
  });

  it("null AEL produces INCOMPLETE verdict — gate cannot be bypassed via missing AEL", () => {
    const result = enforcePositioningCompliance(
      makeTerritories([{ name: "Any Territory", contrastAxis: "evidence-linked transparent proof" }]),
      null,
    );
    expect(result.passed).toBe(false);
    expect(result.verdict).toBe("INCOMPLETE");
  });
});
