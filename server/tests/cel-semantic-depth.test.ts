import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  SEMANTIC_MATCH_THRESHOLD,
} from "../shared/embedding";
import {
  enforceEngineDepthCompliance,
  buildDepthGateResult,
  buildDepthRejectionDirective,
  DEPTH_GATE_MAX_RETRIES,
  isDepthBlocking,
} from "../causal-enforcement-layer/engine";
import type { AnalyticalPackage } from "../analytical-enrichment-layer/types";

// ─────────────────────────────────────────────────────────────────────────────
// cosineSimilarity: calibrated threshold test cases
// ─────────────────────────────────────────────────────────────────────────────

describe("cosineSimilarity — threshold calibration", () => {
  it("aligned paraphrase scores above threshold", () => {
    const ael = "users distrust the company because of hidden fees and lack of transparency in pricing";
    const out = "audience is skeptical due to undisclosed costs and unclear billing structure";
    const score = cosineSimilarity(ael, out);
    expect(score).toBeGreaterThan(SEMANTIC_MATCH_THRESHOLD);
    expect(score).toBeGreaterThan(0.60);
  });

  it("true semantic drift scores below threshold", () => {
    const ael = "users distrust the company because of hidden fees and lack of transparency";
    const out = "innovation drives growth and empowers users to achieve their goals faster";
    const score = cosineSimilarity(ael, out);
    expect(score).toBeLessThan(SEMANTIC_MATCH_THRESHOLD);
    expect(score).toBeLessThan(0.15);
  });

  it("keyword stuffing (random word order) scores below threshold", () => {
    const ael = "users distrust hidden fees";
    const out = "trust distrust fees hidden users transparency company";
    const score = cosineSimilarity(ael, out);
    expect(score).toBeLessThan(SEMANTIC_MATCH_THRESHOLD);
  });

  it("identical texts score 1.0", () => {
    const text = "users fear losing money due to hidden pricing and lack of transparency";
    expect(cosineSimilarity(text, text)).toBeCloseTo(1.0, 5);
  });

  it("empty inputs return 0", () => {
    expect(cosineSimilarity("", "some text")).toBe(0);
    expect(cosineSimilarity("some text", "")).toBe(0);
    expect(cosineSimilarity("", "")).toBe(0);
  });

  it("synonym substitution recognized: distrust ↔ skeptical, hidden ↔ undisclosed", () => {
    const a = "customers distrust the platform because of hidden charges";
    const b = "buyers are skeptical about the service due to undisclosed fees";
    expect(cosineSimilarity(a, b)).toBeGreaterThan(SEMANTIC_MATCH_THRESHOLD);
  });

  it("synonym substitution recognized: worry ↔ fear, barrier ↔ obstacle", () => {
    const a = "users worry about barriers to adoption";
    const b = "customers fear obstacles when getting started";
    expect(cosineSimilarity(a, b)).toBeGreaterThan(SEMANTIC_MATCH_THRESHOLD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH_GATE_MAX_RETRIES
// ─────────────────────────────────────────────────────────────────────────────

describe("DEPTH_GATE_MAX_RETRIES", () => {
  it("is exactly 1 (2 total attempts: initial + 1 repair)", () => {
    expect(DEPTH_GATE_MAX_RETRIES).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enforceEngineDepthCompliance — semantic reference matching
// ─────────────────────────────────────────────────────────────────────────────

function makeAel(overrides: Partial<AnalyticalPackage> = {}): AnalyticalPackage {
  return {
    root_causes: [],
    pain_types: [],
    causal_chains: [],
    buying_barriers: [],
    mechanism_gaps: [],
    trust_gaps: [],
    contradiction_flags: [],
    priority_ranking: [],
    confidence_notes: [],
    generatedAt: new Date().toISOString(),
    version: 2,
    inputSummary: { hasMI: true, hasAudience: true, hasProductDNA: false, hasCompetitiveData: false, signalCount: 5 },
    ...overrides,
  };
}

describe("enforceEngineDepthCompliance — rootCauseReferences", () => {
  it("recognizes root cause via paraphrase (different words, same meaning)", () => {
    const ael = makeAel({
      root_causes: [{
        surfaceSignal: "users lose trust due to hidden fees",
        deepCause: "lack of pricing transparency causes financial anxiety and distrust",
        causalReasoning: "users cannot predict their costs so they distrust the product",
        sourceData: "reviews",
        confidenceLevel: "high",
      }],
    });
    const output = ["audience is skeptical because undisclosed billing creates cost uncertainty"];
    const result = enforceEngineDepthCompliance("test-engine", output, ael);
    expect(result.rootCauseReferences).toBeGreaterThan(0);
    expect(result.depthDiagnostics.hasRootCauseGrounding).toBe(true);
  });

  it("does not recognize root cause when output drifts to unrelated domain", () => {
    const ael = makeAel({
      root_causes: [{
        surfaceSignal: "users distrust the platform",
        deepCause: "hidden fees and lack of pricing transparency erode trust",
        causalReasoning: "financial unpredictability causes hesitation and abandonment",
        sourceData: "reviews",
        confidenceLevel: "high",
      }],
    });
    const output = ["our innovative technology empowers businesses to scale and grow revenue"];
    const result = enforceEngineDepthCompliance("test-engine", output, ael);
    expect(result.rootCauseReferences).toBe(0);
    expect(result.depthDiagnostics.hasRootCauseGrounding).toBe(false);
  });
});

describe("enforceEngineDepthCompliance — causalChainReferences", () => {
  it("recognizes causal chain via synonym paraphrase", () => {
    const ael = makeAel({
      root_causes: [{ surfaceSignal: "trust issues", deepCause: "hidden fees", causalReasoning: "financial concern", sourceData: "r", confidenceLevel: "high" }],
      causal_chains: [{
        pain: "financial anxiety",
        cause: "undisclosed costs cause financial worry and hesitation",
        impact: "buyers resist committing because they fear unexpected charges",
        behavior: "prospects abandon checkout when they cannot predict total cost",
        conversionEffect: "conversion drops 40%",
      }],
    });
    const output = ["customers are reluctant to purchase due to hidden billing that creates cost uncertainty and fear of unexpected fees"];
    const result = enforceEngineDepthCompliance("test-engine", output, ael);
    expect(result.causalChainReferences).toBeGreaterThan(0);
    expect(result.depthDiagnostics.hasCausalChainUsage).toBe(true);
  });
});

describe("enforceEngineDepthCompliance — barrierReferences", () => {
  it("recognizes buying barrier via paraphrase", () => {
    const ael = makeAel({
      root_causes: [{ surfaceSignal: "trust", deepCause: "hidden fees", causalReasoning: "fear", sourceData: "r", confidenceLevel: "high" }],
      buying_barriers: [{
        barrier: "lack of price transparency",
        rootCause: "users cannot predict their monthly costs and fear hidden charges",
        userThinking: "I might be tricked into paying more than I expect",
        requiredResolution: "show clear pricing with no undisclosed fees",
        severity: "blocking",
      }],
    });
    const output = ["customers are skeptical and worried about undisclosed billing — they fear being surprised by unexpected costs and cannot trust the pricing"];
    const result = enforceEngineDepthCompliance("test-engine", output, ael);
    expect(result.barrierReferences).toBeGreaterThan(0);
    expect(result.depthDiagnostics.hasBarrierResolution).toBe(true);
  });
});

describe("enforceEngineDepthCompliance — null/empty AEL", () => {
  it("returns depth-skipped result when AEL is null", () => {
    const result = enforceEngineDepthCompliance("test-engine", ["any output"], null);
    expect(result.causalDepthScore).toBe(0);
    expect(result.rootCausesEvaluated).toBe(0);
    expect(result.enforcementLog.some(l => l.includes("NO_AEL"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildDepthGateResult + buildDepthRejectionDirective
// ─────────────────────────────────────────────────────────────────────────────

describe("buildDepthGateResult — retry count", () => {
  it("produces DEPTH_FAILED status on attempt 1 of max 1 when blocked", () => {
    const ael = makeAel({
      root_causes: [{ surfaceSignal: "trust", deepCause: "hidden fees", causalReasoning: "fear", sourceData: "r", confidenceLevel: "high" }],
    });
    const driftOutput = ["innovation drives scale and growth in modern enterprise markets"];
    const depth = enforceEngineDepthCompliance("test-engine", driftOutput, ael);
    const gate = buildDepthGateResult(depth, DEPTH_GATE_MAX_RETRIES, DEPTH_GATE_MAX_RETRIES, []);
    expect(gate.attempt).toBe(DEPTH_GATE_MAX_RETRIES);
    expect(gate.maxAttempts).toBe(DEPTH_GATE_MAX_RETRIES);
    expect(gate.status).toBe("DEPTH_FAILED");
    expect(gate.passed).toBe(false);
  });

  it("total attempt limit is 2 (initial attempt 1 + max 1 repair)", () => {
    expect(DEPTH_GATE_MAX_RETRIES + 1).toBe(2);
  });
});

describe("buildDepthRejectionDirective", () => {
  it("is preserved and produces non-empty directive string", () => {
    const ael = makeAel({
      root_causes: [{ surfaceSignal: "trust", deepCause: "hidden fees", causalReasoning: "fear", sourceData: "r", confidenceLevel: "high" }],
    });
    const driftOutput = ["innovation drives scale and growth"];
    const depth = enforceEngineDepthCompliance("test-engine", driftOutput, ael);
    const directive = buildDepthRejectionDirective(depth, 1);
    expect(directive).toContain("DEPTH ENFORCEMENT REJECTION");
    expect(directive).toContain("Attempt 1");
    expect(typeof directive).toBe("string");
    expect(directive.length).toBeGreaterThan(100);
  });
});
