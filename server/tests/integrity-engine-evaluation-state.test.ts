import { describe, it, expect } from "vitest";
import { runIntegrityEngine } from "../integrity-engine/engine";
import type {
  IntegrityMIInput,
  IntegrityAudienceInput,
  IntegrityPositioningInput,
  IntegrityDifferentiationInput,
  IntegrityOfferInput,
  IntegrityFunnelInput,
  LayerResult,
} from "../integrity-engine/types";

const emptyMI = (): IntegrityMIInput => ({
  marketDiagnosis: null,
  overallConfidence: 0,
  opportunitySignals: [],
  threatSignals: [],
});

const emptyAudience = (): IntegrityAudienceInput => ({
  objectionMap: {},
  emotionalDrivers: [],
  maturityIndex: null,
  awarenessLevel: null,
  audiencePains: [],
  desireMap: {},
  audienceSegments: [],
});

const emptyPositioning = (): IntegrityPositioningInput => ({
  territories: [],
  enemyDefinition: null,
  contrastAxis: null,
  narrativeDirection: null,
  confidenceScore: null,
});

const emptyDifferentiation = (): IntegrityDifferentiationInput => ({
  pillars: [],
  mechanismFraming: null,
  mechanismCore: null,
  authorityMode: null,
  claimStructures: [],
  proofArchitecture: [],
  confidenceScore: null,
});

const emptyOffer = (): IntegrityOfferInput => ({
  offerName: "",
  coreOutcome: "",
  mechanismDescription: "",
  deliverables: [],
  proofAlignment: [],
  offerStrengthScore: 0,
  riskNotes: [],
  completeness: { complete: false, missingLayers: [] },
  genericFlag: false,
  frictionLevel: 0,
});

const emptyFunnel = (): IntegrityFunnelInput => ({
  funnelName: "",
  funnelType: "",
  stageMap: [],
  trustPath: [],
  proofPlacements: [],
  commitmentLevel: "",
  frictionMap: [],
  entryTrigger: { mechanismType: "", purpose: "" },
  funnelStrengthScore: 0,
  compressionApplied: false,
});

const richAudience = (): IntegrityAudienceInput => ({
  objectionMap: { price: { weight: 0.6 }, trust: { weight: 0.4 } },
  emotionalDrivers: [{ name: "frustration" }],
  maturityIndex: 0.6,
  awarenessLevel: "problem_aware",
  audiencePains: [
    { canonical: "manual reporting wastes hours every week", frequency: 12, evidence: ["c1", "c2"] },
    { canonical: "data lives in too many tools", frequency: 8, evidence: ["c3"] },
  ],
  desireMap: { speed: { weight: 0.8 } },
  audienceSegments: [{ name: "ops_managers" }],
});

const richOffer = (): IntegrityOfferInput => ({
  offerName: "Reporting Autopilot",
  coreOutcome: "stop wasting hours on manual reporting every week",
  mechanismDescription: "unified data pipeline + scheduled rollups",
  deliverables: ["dashboard", "weekly digest", "slack alerts"],
  proofAlignment: ["case_proof"],
  offerStrengthScore: 0.7,
  riskNotes: [],
  completeness: { complete: true, missingLayers: [] },
  genericFlag: false,
  frictionLevel: 0.4,
});

const richFunnel = (): IntegrityFunnelInput => ({
  funnelName: "lead_demo_close",
  funnelType: "value_ladder",
  stageMap: [
    { name: "awareness", purpose: "introduce solution to price-conscious leads", contentType: "thought_leadership" },
    { name: "consideration", purpose: "show price comparison", contentType: "proof_content" },
    { name: "conversion", purpose: "convert via demo", conversionGoal: "purchase" },
  ],
  trustPath: [
    { action: "case study showing trust gains", proofType: "case_proof" },
    { action: "live demo", proofType: "process_proof" },
    { action: "checkout", proofType: "transparency_proof" },
  ],
  proofPlacements: [{ stage: "consideration", proofType: "case_proof" }],
  commitmentLevel: "medium",
  frictionMap: [{ stage: "conversion", mitigation: "money-back guarantee addressing price objection" }],
  entryTrigger: { mechanismType: "lead_magnet", purpose: "capture" },
  funnelStrengthScore: 0.7,
  compressionApplied: false,
});

const richPositioning = (): IntegrityPositioningInput => ({
  territories: [{ name: "ops automation" }],
  enemyDefinition: "manual spreadsheets",
  contrastAxis: "automated_vs_manual",
  narrativeDirection: "operational sanity through unified reporting",
  confidenceScore: 0.7,
});

const richDifferentiation = (): IntegrityDifferentiationInput => ({
  pillars: [{ name: "unified pipeline" }, { name: "scheduled rollups" }],
  mechanismFraming: { name: "unified pipeline", description: "single data layer for all reporting" },
  mechanismCore: {
    mechanismName: "unified pipeline",
    mechanismType: "system",
    mechanismSteps: ["ingest sources", "normalize", "schedule rollups"],
    mechanismPromise: "one place for reporting",
    mechanismProblem: "fragmented data",
    mechanismLogic: "centralize then schedule",
  },
  authorityMode: "expertise",
  claimStructures: [],
  proofArchitecture: [
    { category: "process_proof" },
    { category: "case_proof" },
    { category: "outcome_proof" },
  ],
  confidenceScore: 0.7,
});

const richMI = (): IntegrityMIInput => ({
  marketDiagnosis: "fragmented analytics tooling",
  overallConfidence: 0.7,
  opportunitySignals: [{ name: "ops automation gap" }, { name: "reporting fatigue" }],
  threatSignals: [{ name: "incumbent bundling" }],
});

function getLayer(result: ReturnType<typeof runIntegrityEngine>, name: string): LayerResult {
  const layer = result.layerResults.find(l => l.layerName === name);
  if (!layer) throw new Error(`Layer ${name} not found in result`);
  return layer;
}

describe("Integrity engine — CLP-15 per-layer evaluationState (P201 regression)", () => {
  it("returns INSUFFICIENT_EVIDENCE (passed:null, score:null) for layers whose upstream snapshots are empty", () => {
    const result = runIntegrityEngine(
      emptyMI(),
      emptyAudience(),
      emptyPositioning(),
      emptyDifferentiation(),
      emptyOffer(),
      emptyFunnel(),
    );

    const insufficientLayers = result.layerResults.filter(
      l => l.evaluationState === "INSUFFICIENT_EVIDENCE",
    );
    expect(insufficientLayers.length).toBeGreaterThanOrEqual(6);

    for (const layer of insufficientLayers) {
      expect(layer.passed).toBeNull();
      expect(layer.score).toBeNull();
      expect(Array.isArray(layer.missingDeps)).toBe(true);
      expect((layer.missingDeps ?? []).length).toBeGreaterThan(0);
      expect(layer.warnings.some(w => w.startsWith("INSUFFICIENT_EVIDENCE:"))).toBe(true);
    }
  });

  it("the engine reports INSUFFICIENT_LAYER_COVERAGE and safeToExecute:false when too few base layers evaluate", () => {
    const result = runIntegrityEngine(
      emptyMI(),
      emptyAudience(),
      emptyPositioning(),
      emptyDifferentiation(),
      emptyOffer(),
      emptyFunnel(),
    );

    expect(result.status).toBe("INSUFFICIENT_LAYER_COVERAGE");
    expect(result.safeToExecute).toBe(false);
    expect(result.integrityVerdict).toBe("FAIL");
    expect(result.overallStatus).toBe("FAIL");
    expect(result.evaluatedLayerCount ?? 0).toBeLessThan(4);
    expect((result.missingPrerequisites ?? []).length).toBeGreaterThan(0);
    expect(result.failureReasons.some(r => r.startsWith("insufficient_layer_coverage:"))).toBe(true);
  });

  it("excludes INSUFFICIENT_EVIDENCE layers from overall_integrity_score numerator AND denominator", () => {
    // Build a state where some layers can evaluate but others cannot, so we
    // can prove the score is computed from EVALUATED layers only — not
    // diluted to ~0 by INSUFFICIENT layers being counted as failures.
    const result = runIntegrityEngine(
      richMI(),
      richAudience(),
      emptyPositioning(),       // → l1, l3 INSUFFICIENT
      emptyDifferentiation(),   // → l1, l3, l6 INSUFFICIENT (jointly with offer)
      richOffer(),
      richFunnel(),
    );

    // At least one layer should be INSUFFICIENT (positioning_differentiation_compatibility).
    const insufficient = result.layerResults.filter(l => l.evaluationState === "INSUFFICIENT_EVIDENCE");
    expect(insufficient.length).toBeGreaterThanOrEqual(1);

    // And at least one layer should still evaluate (audience_offer_alignment has the inputs it needs).
    const evaluated = result.layerResults.filter(l => l.evaluationState === "EVALUATED");
    expect(evaluated.length).toBeGreaterThanOrEqual(1);

    // INSUFFICIENT layers must NOT show up as `passed: false` — they are
    // not failures, they are unknowns. (The score-aggregation comment in
    // engine.ts:770-772 promises this; this test holds the line.)
    for (const layer of insufficient) {
      expect(layer.passed).not.toBe(false);
      expect(layer.passed).toBeNull();
    }

    // The aggregator's denominator should equal the sum of EVALUATED-layer
    // weights, not the sum of all layer weights. We assert this indirectly:
    // when the only EVALUATED layers happen to score well, the overall
    // score should be > 0 (not pulled down to ~0 by INSUFFICIENT layers).
    if (evaluated.every(l => (l.score ?? 0) >= 0.5)) {
      expect(result.overallIntegrityScore).toBeGreaterThan(0);
    }
  });

  it("the layer3 positioning↔differentiation check returns INSUFFICIENT_EVIDENCE when either side is empty (not a silent passed:true)", () => {
    const result = runIntegrityEngine(
      richMI(),
      richAudience(),
      emptyPositioning(),
      richDifferentiation(),
      richOffer(),
      richFunnel(),
    );

    const l3 = getLayer(result, "positioning_differentiation_compatibility");
    expect(l3.evaluationState).toBe("INSUFFICIENT_EVIDENCE");
    expect(l3.passed).toBeNull();
    expect(l3.missingDeps).toContain("positioning_snapshot");
  });

  it("score denominator deterministically excludes INSUFFICIENT layers (would dilute to <0.5 if counted as 0)", () => {
    // P204 architect-review hardening — the prior numerator/denominator
    // exclusion test was indirect. This one is deterministic: build a
    // state where exactly a few layers can evaluate with high scores
    // and the rest are INSUFFICIENT. The aggregator divides only by the
    // evaluated layers' weight sum; if INSUFFICIENT counted as failures,
    // the score would be pulled toward 0 (weighted by 7+ slots) rather
    // than reflecting the actual evaluated subset.
    const result = runIntegrityEngine(
      richMI(),
      richAudience(),
      emptyPositioning(),
      emptyDifferentiation(),
      richOffer(),
      richFunnel(),
    );
    const evaluated = result.layerResults.filter(l => l.evaluationState === "EVALUATED");
    const insufficient = result.layerResults.filter(l => l.evaluationState === "INSUFFICIENT_EVIDENCE");
    expect(evaluated.length).toBeGreaterThanOrEqual(1);
    expect(insufficient.length).toBeGreaterThanOrEqual(1);

    // Compute the expected score from scratch and prove the engine matches.
    const evaluatedScoreSum = evaluated.reduce((acc, l) => acc + (l.score ?? 0), 0);
    const evaluatedAvg = evaluatedScoreSum / evaluated.length;
    // The engine uses LAYER_WEIGHTS so we only assert a band: the engine
    // score must be within the [min, max] of evaluated layer scores (would
    // be below min if INSUFFICIENT layers diluted the denominator).
    const minEvaluated = Math.min(...evaluated.map(l => l.score ?? 0));
    const maxEvaluated = Math.max(...evaluated.map(l => l.score ?? 0));
    expect(result.overallIntegrityScore).toBeGreaterThanOrEqual(minEvaluated - 0.001);
    expect(result.overallIntegrityScore).toBeLessThanOrEqual(maxEvaluated + 0.001);
    // Sanity: with rich inputs on evaluated layers, the average should be
    // comfortably above the 0.5 dilution floor.
    if (evaluatedAvg >= 0.5) {
      expect(result.overallIntegrityScore).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("when all upstream snapshots are populated, every layer evaluates and integrityVerdict is not forced to FAIL by missing-evidence reasons", () => {
    const result = runIntegrityEngine(
      richMI(),
      richAudience(),
      richPositioning(),
      richDifferentiation(),
      richOffer(),
      richFunnel(),
    );

    const insufficient = result.layerResults.filter(l => l.evaluationState === "INSUFFICIENT_EVIDENCE");
    expect(insufficient.length).toBe(0);
    expect(result.status).not.toBe("INSUFFICIENT_LAYER_COVERAGE");
    expect(result.evaluatedLayerCount).toBe(result.layerResults.length);
    expect(result.failureReasons.every(r => !r.startsWith("insufficient_layer_coverage:"))).toBe(true);
  });
});
