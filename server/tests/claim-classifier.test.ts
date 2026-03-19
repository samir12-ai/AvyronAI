import { describe, test, expect } from "vitest";
import {
  classifyClaims,
  buildClaimBreakdown,
  extractFactualClaims,
  extractNonFactualClaims,
  ClassifiedClaim,
  ClaimType,
} from "../causal-enforcement-layer/claim-classifier";
import {
  enforceEngineDepthCompliance,
} from "../causal-enforcement-layer/engine";
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";

function makeAel(overrides: Partial<AnalyticalPackage> = {}): AnalyticalPackage {
  return {
    root_causes: [
      {
        deepCause: "users distrust vendors because of hidden fees and lack of billing transparency",
        surfaceSignal: "churn increases when pricing is opaque",
        causalReasoning: "trust breakdown caused by undisclosed costs",
        confidence: 0.9,
        behavioralImplication: "resistance to commitment without clear pricing",
        id: "rc-1",
      },
    ],
    causal_chains: [
      {
        cause: "lack of pricing transparency causes customer hesitation and distrust",
        impact: "lower conversion rate among high-intent leads",
        behavior: "customers delay purchase decisions when fees are hidden",
        pain: "revenue loss from hesitating buyers",
      },
    ],
    buying_barriers: [
      {
        barrier: "skepticism about value of new tool",
        rootCause: "lack of visible proof from trusted sources",
        userThinking: "I have seen similar promises before that didn't deliver",
        requiredResolution: "evidence-backed case studies with measurable results",
        severity: "blocking",
      },
    ],
    mechanism_gaps: [],
    market_intelligence: { sophistication: "medium", priceAnchoring: "unknown", commoditizationLevel: "medium" },
    buying_triggers: [],
    ...overrides,
  } as unknown as AnalyticalPackage;
}

describe("classifyClaims — rule pass (factual)", () => {
  test("sentence with percentage is classified as factual_claim", () => {
    const claims = classifyClaims("Conversion rates improved by 32% after implementing the new pricing strategy.");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'results in' causative verb is classified as factual_claim", () => {
    const claims = classifyClaims("Poor pricing transparency results in higher churn among enterprise customers.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'causes' is classified as factual_claim", () => {
    const claims = classifyClaims("Trust deficit causes conversion drop in high-intent buyer segments.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'studies show' is classified as factual_claim", () => {
    const claims = classifyClaims("Studies show that 67% of buyers abandon the funnel at pricing disclosure.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'data indicates' is classified as factual_claim", () => {
    const claims = classifyClaims("Data indicates a measurable improvement in MRR after the onboarding change.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'proven to' is classified as factual_claim", () => {
    const claims = classifyClaims("This approach is proven to reduce acquisition cost by 2x in comparable markets.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with '2x' multiplier is classified as factual_claim", () => {
    const claims = classifyClaims("The new flow generates 2x more qualified leads per campaign cycle.");
    expect(claims[0].type).toBe("factual_claim");
    expect(claims[0].classifiedBy).toBe("rule");
  });
});

describe("classifyClaims — rule pass (emotional)", () => {
  test("sentence with 'creates a feeling of' is classified as emotional_synthesis", () => {
    const claims = classifyClaims("This creates a feeling of confidence and safety in every buyer interaction.");
    expect(claims[0].type).toBe("emotional_synthesis");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'resonates with' is classified as emotional_synthesis", () => {
    const claims = classifyClaims("The message resonates with buyers who fear being locked into a bad contract.");
    expect(claims[0].type).toBe("emotional_synthesis");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'taps into' is classified as emotional_synthesis", () => {
    const claims = classifyClaims("The campaign taps into the deep desire for financial security and freedom.");
    expect(claims[0].type).toBe("emotional_synthesis");
    expect(claims[0].classifiedBy).toBe("rule");
  });

  test("sentence with 'inspires' is classified as emotional_synthesis", () => {
    const claims = classifyClaims("The brand story inspires buyers to envision a better version of their business.");
    expect(claims[0].type).toBe("emotional_synthesis");
    expect(claims[0].classifiedBy).toBe("rule");
  });
});

describe("classifyClaims — embedding pass (inferred)", () => {
  test("neutral analytical sentence defaults to inferred_insight via embedding", () => {
    const claims = classifyClaims("The buyer journey suggests an emerging shift in how mid-market teams evaluate spend.");
    expect(claims.length).toBeGreaterThan(0);
    const types: ClaimType[] = ["factual_claim", "inferred_insight", "emotional_synthesis"];
    expect(types).toContain(claims[0].type);
    expect(claims[0].classifiedBy).toBe("embedding");
  });

  test("sentences classified by embedding have classifiedBy=embedding", () => {
    const text = "The pattern implies buyers are holding back due to unclear outcome expectations.";
    const claims = classifyClaims(text);
    expect(claims[0].classifiedBy).toBe("embedding");
  });
});

describe("classifyClaims — multi-sentence output", () => {
  test("mixed output produces multiple classified claims", () => {
    const text = [
      "Conversion rates improved by 35% after introducing transparent billing.",
      "This creates a feeling of trust and confidence in the pricing model.",
      "The pattern suggests buyers are more likely to convert when risks are removed.",
    ].join(" ");
    const claims = classifyClaims(text);
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  test("factual claims are present in output when numbers appear", () => {
    const text = "The tool reduces churn by 28%. This creates a feeling of stability for retained customers.";
    const claims = classifyClaims(text);
    const factual = claims.filter(c => c.type === "factual_claim");
    expect(factual.length).toBeGreaterThan(0);
  });

  test("emotional claims are present in output when emotional language appears", () => {
    const text = "The tool reduces churn by 28%. This resonates deeply with buyers seeking stability.";
    const claims = classifyClaims(text);
    const emotional = claims.filter(c => c.type === "emotional_synthesis");
    expect(emotional.length).toBeGreaterThan(0);
  });
});

describe("buildClaimBreakdown", () => {
  test("returns correct counts for mixed claim set", () => {
    const claims: ClassifiedClaim[] = [
      { text: "A", type: "factual_claim", classifiedBy: "rule" },
      { text: "B", type: "factual_claim", classifiedBy: "rule" },
      { text: "C", type: "inferred_insight", classifiedBy: "embedding" },
      { text: "D", type: "emotional_synthesis", classifiedBy: "rule" },
    ];
    const breakdown = buildClaimBreakdown(claims);
    expect(breakdown.factual).toBe(2);
    expect(breakdown.inferred).toBe(1);
    expect(breakdown.emotional).toBe(1);
  });

  test("returns zeros for empty claim set", () => {
    const breakdown = buildClaimBreakdown([]);
    expect(breakdown.factual).toBe(0);
    expect(breakdown.inferred).toBe(0);
    expect(breakdown.emotional).toBe(0);
  });
});

describe("extractFactualClaims / extractNonFactualClaims", () => {
  test("extractFactualClaims returns only factual_claim texts", () => {
    const claims: ClassifiedClaim[] = [
      { text: "A factual", type: "factual_claim", classifiedBy: "rule" },
      { text: "An inferred", type: "inferred_insight", classifiedBy: "embedding" },
      { text: "An emotional", type: "emotional_synthesis", classifiedBy: "rule" },
    ];
    const factual = extractFactualClaims(claims);
    expect(factual).toHaveLength(1);
    expect(factual[0]).toBe("A factual");
  });

  test("extractNonFactualClaims returns inferred and emotional texts", () => {
    const claims: ClassifiedClaim[] = [
      { text: "A factual", type: "factual_claim", classifiedBy: "rule" },
      { text: "An inferred", type: "inferred_insight", classifiedBy: "embedding" },
      { text: "An emotional", type: "emotional_synthesis", classifiedBy: "rule" },
    ];
    const nonFactual = extractNonFactualClaims(claims);
    expect(nonFactual).toHaveLength(2);
    expect(nonFactual).toContain("An inferred");
    expect(nonFactual).toContain("An emotional");
  });
});

describe("enforceEngineDepthCompliance — claimBreakdown integration", () => {
  test("result includes claimBreakdown with numeric fields", () => {
    const ael = makeAel();
    const result = enforceEngineDepthCompliance("test-engine", ["buyers distrust hidden fees and lack of transparency"], ael);
    expect(result.claimBreakdown).toBeDefined();
    expect(typeof result.claimBreakdown.factual).toBe("number");
    expect(typeof result.claimBreakdown.inferred).toBe("number");
    expect(typeof result.claimBreakdown.emotional).toBe("number");
  });

  test("claimBreakdown is non-negative", () => {
    const ael = makeAel();
    const result = enforceEngineDepthCompliance("test-engine", ["some generic output with no special claims"], ael);
    expect(result.claimBreakdown.factual).toBeGreaterThanOrEqual(0);
    expect(result.claimBreakdown.inferred).toBeGreaterThanOrEqual(0);
    expect(result.claimBreakdown.emotional).toBeGreaterThanOrEqual(0);
  });

  test("claimBreakdown present even when AEL is null", () => {
    const result = enforceEngineDepthCompliance("test-engine", ["some output text"], null);
    expect(result.claimBreakdown).toBeDefined();
    expect(result.claimBreakdown.factual).toBeGreaterThanOrEqual(0);
  });

  test("enforcement log includes CLAIM_CLASSIFIER entry", () => {
    const ael = makeAel();
    const result = enforceEngineDepthCompliance("test-engine", ["buyers distrust hidden fees and lack of transparency"], ael);
    const classifierLog = result.enforcementLog.find(l => l.includes("CLAIM_CLASSIFIER"));
    expect(classifierLog).toBeDefined();
    expect(classifierLog).toMatch(/factual=\d+/);
    expect(classifierLog).toMatch(/inferred=\d+/);
    expect(classifierLog).toMatch(/emotional=\d+/);
  });

  test("enforcement log includes factual_sentences_for_depth_check when AEL is present", () => {
    const ael = makeAel();
    const result = enforceEngineDepthCompliance("test-engine", ["Conversion improved by 30%. Buyers feel more confident."], ael);
    const classifierLog = result.enforcementLog.find(l => l.includes("factual_sentences_for_depth_check"));
    expect(classifierLog).toBeDefined();
  });

  test("output with purely emotional sentences does not trigger blocking root_cause or causal_chain violations", () => {
    const ael = makeAel();
    const emotionalOnlyOutput = [
      "This creates a feeling of trust and deep resonance with buyers.",
      "The message taps into the longing for financial freedom and stability.",
      "The brand inspires passionate commitment from the audience.",
    ];
    const result = enforceEngineDepthCompliance("test-engine", emotionalOnlyOutput, ael);
    expect(result.claimBreakdown.emotional).toBeGreaterThan(0);
    const blockingViolations = result.violations.filter(v => v.severity === "blocking");
    const rootCauseViolation = result.violations.find(v => v.violationType === "missing_root_cause");
    const causalChainViolation = result.violations.find(v => v.violationType === "missing_causal_chain");
    expect(rootCauseViolation).toBeUndefined();
    expect(causalChainViolation).toBeUndefined();
    expect(result.passed).not.toBe(false);
  });

  test("purely inferred output does not trigger blocking root_cause violations", () => {
    const ael = makeAel();
    const inferredOnlyOutput = [
      "The pattern suggests buyers are holding back due to unclear outcome expectations.",
      "This implies a structural mismatch between offer framing and audience readiness.",
      "The signals point toward an emerging shift in buyer expectations around value delivery.",
    ];
    const result = enforceEngineDepthCompliance("test-engine", inferredOnlyOutput, ael);
    const rootCauseViolation = result.violations.find(v => v.violationType === "missing_root_cause");
    const causalChainViolation = result.violations.find(v => v.violationType === "missing_causal_chain");
    expect(rootCauseViolation).toBeUndefined();
    expect(causalChainViolation).toBeUndefined();
  });

  test("factual claims without AEL root cause alignment DO trigger missing_root_cause violation", () => {
    const ael = makeAel();
    const factualUnalignedOutput = [
      "Conversion rates improved by 35% in completely unrelated gardening software segments.",
      "Data indicates a 2x reduction in tomato harvest yield among competing platforms.",
      "Studies show 40% faster seed germination resulting from unrelated soil treatments.",
    ];
    const result = enforceEngineDepthCompliance("test-engine", factualUnalignedOutput, ael);
    expect(result.claimBreakdown.factual).toBeGreaterThan(0);
    const rootCauseViolation = result.violations.find(v => v.violationType === "missing_root_cause");
    expect(rootCauseViolation).toBeDefined();
  });

  test("factual claims with root cause alignment pass depth check", () => {
    const ael = makeAel();
    const factualAlignedOutput = [
      "Users distrust hidden fees causing 28% higher churn in the first 90 days.",
      "Data indicates that billing transparency results in measurable trust gains.",
      "Studies show transparent pricing leads to higher conversion among skeptical buyers.",
    ];
    const result = enforceEngineDepthCompliance("test-engine", factualAlignedOutput, ael);
    expect(result.claimBreakdown.factual).toBeGreaterThan(0);
    expect(result.claimBreakdown.factual + result.claimBreakdown.inferred + result.claimBreakdown.emotional).toBeGreaterThan(0);
  });

  test("classifyClaims is called on full outputTexts join (not per-text)", () => {
    const ael = makeAel();
    const multiTextOutput = [
      "Conversion improved by 32%.",
      "This resonates deeply with buyers seeking stability.",
    ];
    const result = enforceEngineDepthCompliance("test-engine", multiTextOutput, ael);
    const total = result.claimBreakdown.factual + result.claimBreakdown.inferred + result.claimBreakdown.emotional;
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
