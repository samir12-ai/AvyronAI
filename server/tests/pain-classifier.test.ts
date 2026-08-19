import { describe, expect, it } from "vitest";
import {
  buildAudiencePainRegistry,
  buildMarketPainPortfolio,
  splitMarketPainPortfolio,
  attachTargetCoverageToPainRegistry,
  classifyAudiencePainDetailed,
  selectPainForUse,
  selectPainsForUse,
  validateAudiencePainRegistry,
  DETERMINISTIC_CLASSIFIER_VERSION,
} from "../shared/audience-pain-registry";
import {
  judgePainClassifierOutput,
  applyJudgedPainClassification,
  validatePainEvidenceOwnership,
  refineAudiencePainRegistry,
  LLM_CLASSIFIER_VERSION,
} from "../shared/pain-classifier";
import { extractAudiencePainRoles } from "../orchestrator/plan-synthesis";

const lineage = { accountId: "account-a", audienceSnapshotId: "audience-run-a" };

function registryFixture() {
  return buildAudiencePainRegistry(
    [
      { canonical: "Refund and cancellation friction after purchase", sourceSignals: ["sig-1"], sourceTypes: ["review"] },
      { canonical: "Teams struggle to produce reliable reports", sourceSignals: ["sig-2", "sig-3"], rootCauses: ["RC1"] },
      { canonical: "Pricing proof concerns delay approval", sourceSignals: ["sig-4"] },
    ],
    lineage,
  );
}

describe("extended registry contract (G2)", () => {
  it("carries original/normalized statements, source types, evidence strength, and classifier metadata", () => {
    const registry = registryFixture();
    for (const pain of registry) {
      expect(pain.originalStatement.length).toBeGreaterThan(0);
      expect(pain.normalizedStatement).toBe(pain.normalizedStatement.toLowerCase());
      expect(pain.classifierVersion).toBe(DETERMINISTIC_CLASSIFIER_VERSION);
      expect(pain.classificationReason.length).toBeGreaterThan(0);
      expect(pain.evidenceStrength).toBeGreaterThanOrEqual(0);
      expect(pain.evidenceStrength).toBeLessThanOrEqual(1);
    }
    const refund = registry.find((p) => p.canonical.startsWith("Refund"))!;
    expect(refund.sourceTypes).toEqual(["review"]);
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    expect(reports.rootCauseIds).toEqual(["RC1"]);
    expect(reports.sourceSignalIds).toEqual(["sig-2", "sig-3"]);
  });

  it("provides an auditable deterministic classification reason", () => {
    const detailed = classifyAudiencePainDetailed("Refund friction after delivery");
    expect(detailed.classification).toBe("POST_PURCHASE_FRICTION");
    expect(detailed.reason).toContain("refund");
  });
});

describe("deterministic judge over LLM classifier output (G3)", () => {
  it("rejects invented pain IDs — the LLM can never create a pain", () => {
    const registry = registryFixture();
    const judged = judgePainClassifierOutput(registry, [
      { painId: "pain_invented000000", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "made-up pain the LLM hallucinated" },
    ]);
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections.map((r) => r.code)).toContain("LLM_INVENTED_PAIN_ID");
  });

  it("rejects evidence invention and merge/rewrite attempts", () => {
    const registry = registryFixture();
    const judged = judgePainClassifierOutput(registry, [
      { painId: registry[0].painId, classification: "POST_PURCHASE_FRICTION", productFit: "ELIGIBLE", reason: "post purchase refund friction", evidenceUids: ["EV:fake"] } as any,
      { painId: registry[1].painId, classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "core reporting struggle", mergedPainIds: [registry[1].painId, registry[2].painId] } as any,
    ]);
    expect(judged.accepted.size).toBe(0);
    const codes = judged.rejections.map((r) => r.code);
    expect(codes).toContain("LLM_EVIDENCE_INVENTION");
    expect(codes).toContain("LLM_REWRITE_OR_MERGE_FORBIDDEN");
  });

  it("rejects promoting a post-purchase complaint into a purchase motivation", () => {
    const registry = registryFixture();
    const refund = registry.find((p) => p.classification === "POST_PURCHASE_FRICTION")!;
    const judged = judgePainClassifierOutput(registry, [
      { painId: refund.painId, classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "this refund complaint is really purchase motivation" },
    ]);
    expect(judged.accepted.has(refund.painId)).toBe(false);
    expect(judged.rejections.map((r) => r.code)).toContain("LLM_POST_PURCHASE_PROMOTION_FORBIDDEN");
  });

  it("rejects invalid enums and missing reasons", () => {
    const registry = registryFixture();
    const judged = judgePainClassifierOutput(registry, [
      { painId: registry[1].painId, classification: "SUPER_PAIN", productFit: "ELIGIBLE", reason: "not a valid classification" },
      { painId: registry[2].painId, classification: "OBJECTION", productFit: "MAYBE", reason: "not a valid product fit" },
      { painId: registry[0].painId, classification: "POST_PURCHASE_FRICTION", productFit: "UNKNOWN", reason: "short" },
    ]);
    expect(judged.accepted.size).toBe(0);
    const codes = judged.rejections.map((r) => r.code);
    expect(codes).toContain("LLM_CLASSIFICATION_INVALID");
    expect(codes).toContain("LLM_PRODUCT_FIT_INVALID");
    expect(codes).toContain("LLM_REASON_MISSING");
  });

  it("applies accepted classifications, recomputes allowed uses, and keeps uncertainty (UNKNOWN stays ineligible)", () => {
    const registry = registryFixture();
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    const pricing = registry.find((p) => p.canonical.includes("Pricing"))!;
    const judged = judgePainClassifierOutput(registry, [
      { painId: reports.painId, classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "unmet reporting outcome drives purchase" },
      { painId: pricing.painId, classification: "OBJECTION", productFit: "UNKNOWN", reason: "cannot judge product fit from identity" },
    ]);
    const updated = applyJudgedPainClassification(registry, judged);
    const updatedReports = updated.find((p) => p.painId === reports.painId)!;
    const updatedPricing = updated.find((p) => p.painId === pricing.painId)!;
    expect(updatedReports.classifierVersion).toBe(LLM_CLASSIFIER_VERSION);
    expect(updatedReports.allowedUses).toContain("positioning");
    expect(updatedPricing.productFit).toBe("UNKNOWN");
    expect(updatedPricing.eligible).toBe(false); // uncertain stays uncertain — never promoted
    expect(selectPainsForUse(updated, "offer_objection").map(p => p.painId)).not.toContain(updatedPricing.painId);
    // registry validation stays coherent after LLM application
    const validation = validateAudiencePainRegistry(updated, lineage);
    expect(validation.issues.filter((i) => i.startsWith("PRODUCT_FIT_MISMATCH"))).toEqual([]);
  });

  it("applies semantic rank only as a full valid permutation", () => {
    const registry = registryFixture();
    const good = judgePainClassifierOutput(registry, registry.map((p, i) => ({
      painId: p.painId, classification: p.classification, productFit: "ELIGIBLE", reason: "valid record for ranking test", semanticRank: registry.length - i,
    })));
    expect(good.semanticRanks).not.toBeNull();
    const bad = judgePainClassifierOutput(registry, registry.map((p) => ({
      painId: p.painId, classification: p.classification, productFit: "ELIGIBLE", reason: "duplicate rank permutation test", semanticRank: 1,
    })));
    expect(bad.semanticRanks).toBeNull();
    expect(bad.rejections.map((r) => r.code)).toContain("LLM_RANK_INVALID");
  });

  it("fails closed to deterministic classification when the LLM is unavailable", async () => {
    const registry = registryFixture();
    const refined = await refineAudiencePainRegistry(registry, {
      accountId: lineage.accountId,
      campaignId: "campaign-test",
      llmEnabled: false,
    });
    expect(refined.classifierUsed).toBe(DETERMINISTIC_CLASSIFIER_VERSION);
    expect(refined.registry.map((p) => p.painId)).toEqual(registry.map((p) => p.painId));
  });
});

describe("cross-tenant evidence ownership (G5)", () => {
  it("marks pains citing unresolvable registry evidence as ineligible", async () => {
    const registry = buildAudiencePainRegistry(
      [{ canonical: "Teams struggle to produce reliable reports", evidenceUids: ["EV:other-tenant:v1:deadbeef"] }],
      lineage,
    );
    const result = await validatePainEvidenceOwnership(registry, lineage.accountId, "campaign-test");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.registry[0].eligible).toBe(false);
  });

  it("passes pains without registry-format evidence untouched (audience pains carry sourceSignals, not EV UIDs)", async () => {
    const registry = registryFixture();
    const result = await validatePainEvidenceOwnership(registry, lineage.accountId, "campaign-test");
    expect(result.issues).toEqual([]);
    expect(result.registry).toEqual(registry);
  });
});

describe("engine pain routing invariants (G4)", () => {
  it("routes the same refund painId to retention while excluding it from every acquisition core use", () => {
    const registry = registryFixture();
    const refund = registry.find((p) => p.classification === "POST_PURCHASE_FRICTION")!;
    expect(selectPainForUse(registry, "retention")?.painId).toBe(refund.painId);
    for (const use of ["positioning", "differentiation", "mechanism", "offer_core", "funnel", "persuasion"] as const) {
      expect(selectPainForUse(registry, use)?.painId).not.toBe(refund.painId);
    }
  });

  it("funnel eligibility contains objections and persuasion splits motivations from objections", () => {
    const registry = registryFixture();
    const funnelPains = selectPainsForUse(registry, "funnel");
    expect(funnelPains.some((p) => p.classification === "OBJECTION")).toBe(true);
    expect(funnelPains.every((p) => p.classification !== "POST_PURCHASE_FRICTION")).toBe(true);
    const persuasionPains = selectPainsForUse(registry, "persuasion");
    expect(persuasionPains.filter((p) => p.classification === "CORE_PURCHASE").length).toBeGreaterThan(0);
    expect(persuasionPains.filter((p) => p.classification === "OBJECTION").length).toBeGreaterThan(0);
  });
});

describe("synthesis preservation of engine roles (G6)", () => {
  function stepResult(output: any) {
    return { status: "SUCCESS", output } as any;
  }

  it("preserves acquisition-engine roles verbatim without reselection", () => {
    const results = new Map<any, any>([
      ["positioning", stepResult({ selectedPainRoles: { core: { painId: "pain_a", classification: "CORE_PURCHASE" } } })],
      ["differentiation", stepResult({ selectedPainRoles: { core: { painId: "pain_a", classification: "CORE_PURCHASE" } } })],
      ["mechanism", stepResult({ selectedPainRoles: { core: { painId: "pain_a", classification: "CORE_PURCHASE", rootCauseIds: ["RC1"] } } })],
      ["funnel", stepResult({ selectedPainRoles: { primary: { painId: "pain_c", classification: "OBJECTION" }, objections: [{ painId: "pain_c", classification: "OBJECTION" }] } })],
      ["persuasion", stepResult({ selectedPainRoles: { motivations: [{ painId: "pain_a", classification: "CORE_PURCHASE" }], objections: [{ painId: "pain_c", classification: "OBJECTION" }] } })],
      ["offer", stepResult({ selectedPainRoles: { core: { painId: "pain_a" }, objections: [{ painId: "pain_c" }] } })],
      ["retention", stepResult({ selectedPainRoles: { retention: { painId: "pain_b", classification: "POST_PURCHASE_FRICTION" } } })],
    ]);
    const preserved = extractAudiencePainRoles(results);
    expect(preserved.violations).toEqual([]);
    expect(preserved.roles?.positioningCore?.painId).toBe("pain_a");
    expect(preserved.roles?.differentiationCore?.painId).toBe("pain_a");
    expect(preserved.roles?.mechanismCore?.rootCauseIds).toEqual(["RC1"]);
    expect(preserved.roles?.funnelPrimary?.painId).toBe("pain_c");
    expect(preserved.roles?.persuasionMotivations?.[0]?.painId).toBe("pain_a");
    expect(preserved.roles?.persuasionObjections?.[0]?.painId).toBe("pain_c");
    expect(preserved.roles?.retention?.painId).toBe("pain_b");
  });

  it("flags a post-purchase pain claiming any acquisition core slot as a violation", () => {
    const results = new Map<any, any>([
      ["positioning", stepResult({ selectedPainRoles: { core: { painId: "pain_b", classification: "POST_PURCHASE_FRICTION" } } })],
      ["mechanism", stepResult({ selectedPainRoles: { core: { painId: "pain_b", classification: "POST_PURCHASE_FRICTION" } } })],
      ["funnel", stepResult({ selectedPainRoles: { primary: { painId: "pain_b", classification: "POST_PURCHASE_FRICTION" }, objections: [] } })],
    ]);
    const preserved = extractAudiencePainRoles(results);
    expect(preserved.violations).toContain("POSITIONING_CORE_POST_PURCHASE_FORBIDDEN");
    expect(preserved.violations).toContain("MECHANISM_CORE_POST_PURCHASE_FORBIDDEN");
    expect(preserved.violations).toContain("FUNNEL_PRIMARY_POST_PURCHASE_FORBIDDEN");
    expect(preserved.roles?.positioningCore).toBeUndefined();
  });
});

describe("product fit taxonomy and portfolio views (G7)", () => {
  it("validates DIRECT_FIT and STRATEGIC_FIT with required bridge and boundary", () => {
    const registry = registryFixture();
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    const records = [
      {
        painId: reports.painId,
        classification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        fitType: "STRATEGIC_FIT" as const,
        strategicBridge: "Provides automated report validation before stakeholder presentation.",
        boundary: "Does not write custom spreadsheet macros.",
        reason: "Strategic fit for analytics reporting reliability.",
        semanticRank: 1,
      },
    ];

    const sourceFacts = {
      productCapabilities: "automated report validation and data reconciliation",
      businessProfile: "Enterprise analytics tool",
    };

    const judged = judgePainClassifierOutput(
      [reports],
      records,
      [],
      sourceFacts
    );

    expect(judged.rejections).toEqual([]);
    expect(judged.accepted.get(reports.painId)?.fitType).toBe("STRATEGIC_FIT");
    expect(judged.accepted.get(reports.painId)?.strategicBridge).toBe("Provides automated report validation before stakeholder presentation.");
    expect(judged.accepted.get(reports.painId)?.boundary).toBe("Does not write custom spreadsheet macros.");
  });

  it("rejects STRATEGIC_FIT when boundary or strategicBridge is missing", () => {
    const registry = registryFixture();
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    const missingBoundaryRecord = [
      {
        painId: reports.painId,
        classification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        fitType: "STRATEGIC_FIT" as const,
        strategicBridge: "Provides automated report validation before stakeholder presentation.",
        reason: "Strategic fit for analytics reporting.",
        semanticRank: 1,
      },
    ];

    const judged = judgePainClassifierOutput(
      [reports],
      missingBoundaryRecord,
      [],
      { productCapabilities: "automated report validation", businessProfile: "Analytics" }
    );

    expect(judged.rejections.some((r) => r.code === "BOUNDARY_MISSING")).toBe(true);
  });

  it("rejects generic false strategic bridges", () => {
    const registry = registryFixture();
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    const falseBridgeRecord = [
      {
        painId: reports.painId,
        classification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        fitType: "STRATEGIC_FIT" as const,
        strategicBridge: "Both are in marketing and our tool is a marketing tool.",
        boundary: "We do not write the reports.",
        reason: "Strategic fit because of same marketing industry.",
        semanticRank: 1,
      },
    ];

    const judged = judgePainClassifierOutput(
      [reports],
      falseBridgeRecord,
      [],
      { productCapabilities: "analytics tool", businessProfile: "Analytics" }
    );

    expect(judged.rejections.some((r) => r.code === "FALSE_STRATEGIC_BRIDGE")).toBe(true);
  });

  it("recovers a STRATEGIC_FIT from a false-negative NOT_FIT via the Semantic Judge repair directive (LIVE LLM)", async () => {
    // Phase 7: Domain-Neutral Controlled Case
    // Pain: "Inability to predict which localized weather patterns will disrupt supply chain routing."
    // Product: Global meteorological data API. Does NOT route trucks. Does provide the data needed to route trucks.
    const registry = buildAudiencePainRegistry([
      { canonical: "Inability to predict which localized weather patterns will disrupt supply chain routing, causing delivery delays.", sourceSignals: ["sig-1"] }
    ], lineage);
    
    // Simulate Phase 8: Force the FIRST proposer attempt to return NOT_FIT.
    // We will do this by mocking `classifyPainRegistryWithLLM` just for the first call,
    // or we can manually feed the record to the Judge and then call the Proposer with the repair directive.
    const forcedNotFitRecord = {
      painId: registry[0].painId,
      classification: "CORE_PURCHASE" as const,
      productFit: "INELIGIBLE",
      fitType: "NOT_FIT" as const,
      requiredCapability: "Supply chain routing optimization software that automatically reroutes trucks.",
      matchedProductCapability: "Global meteorological data API",
      reason: "The product provides weather data but does not perform supply chain routing or truck dispatch.",
      semanticRank: 1,
    };

    const sourceFacts = {
      productCapabilities: [
        { factId: "fact_1", sourceField: "coreOffer", rawValue: "Global meteorological data API with localized disruption forecasting" }
      ]
    };

    // Phase 9: Semantic Judge must reject underclassification
    const { judgePainWithLLM } = await import("../shared/pain-classifier");
    const semanticVerdicts = await judgePainWithLLM(
      registry,
      [forcedNotFitRecord as any],
      { accountId: lineage.accountId, productCapabilities: sourceFacts.productCapabilities }
    );

    const verdict = semanticVerdicts.get(registry[0].painId);
    expect(verdict).toBeDefined();
    expect(verdict!.valid).toBe(false);
    expect(verdict!.rejectionCode).toBe("STRATEGIC_FIT_NOT_CONSIDERED");
    expect(verdict!.repairDirective).toBeDefined();
    
    // Phase 10: Targeted Retry
    const { classifyPainRegistryWithLLM } = await import("../shared/pain-classifier");
    const previousRejections = [`STRATEGIC_FIT_NOT_CONSIDERED:${registry[0].painId} — ${verdict!.critique}\nRepair Directive: ${verdict!.repairDirective}`];
    
    const retryRecords = await classifyPainRegistryWithLLM(registry, {
      accountId: lineage.accountId,
      campaignId: "test",
      productCapabilities: sourceFacts.productCapabilities
    }, previousRejections);
    
    expect(retryRecords).toBeDefined();
    expect(retryRecords!.length).toBe(1);
    
    // Phase 11: Retry Result
    const retryRecord = retryRecords![0];
    expect(retryRecord.fitType).toBe("STRATEGIC_FIT");
    expect(retryRecord.productFit).toBe("ELIGIBLE");
    expect(retryRecord.strategicBridge).toBeDefined();
    expect(retryRecord.boundary).toBeDefined();
    
    // Final Judge approval
    const finalVerdicts = await judgePainWithLLM(
      registry,
      [retryRecord],
      { accountId: lineage.accountId, productCapabilities: sourceFacts.productCapabilities }
    );
    expect(finalVerdicts.get(registry[0].painId)!.valid).toBe(true);
  }, 45000);

  it("reconciles MarketPainPortfolio into ProductAligned and GeneralMarket without losing pains", () => {
    const registry = registryFixture();
    const views = splitMarketPainPortfolio(registry, {
      campaignId: "camp-test",
      accountId: "acct-test",
      audienceSnapshotId: "snap-test",
    });

    expect(views.reconciliation.total).toBe(3);
    expect(views.reconciliation.sumMatchesTotal).toBe(true);
    expect(views.productAligned.length + views.generalMarket.length).toBe(3);
    expect(views.marketPortfolio.pains.length).toBe(3);
  });
});

describe("frozen target coverage authority consumption (G8)", () => {
  it("marks all pains targetCovered: false when Target Coverage is GAP", () => {
    const registry = registryFixture();
    const targetCoverage = {
      status: "GAP" as const,
      matches: [
        { isCovered: false, matchedSegmentNames: ["Operations Leads"] }
      ]
    };

    const updated = attachTargetCoverageToPainRegistry(registry, targetCoverage);
    expect(updated.every((p) => p.targetCovered === false)).toBe(true);
  });

  it("marks all pains targetCovered: false when Target Coverage is NOT_EVALUATED", () => {
    const registry = registryFixture();
    const targetCoverage = {
      status: "NOT_EVALUATED" as const,
      matches: []
    };

    const updated = attachTargetCoverageToPainRegistry(registry, targetCoverage);
    expect(updated.every((p) => p.targetCovered === false)).toBe(true);
  });

  it("marks only pains belonging to covered segments as targetCovered: true", () => {
    const raw = [
      { canonical: "Pain 1", segmentIds: ["Segment Alpha"], segmentId: "Segment Alpha" },
      { canonical: "Pain 2", segmentIds: ["Segment Beta"], segmentId: "Segment Beta" },
    ];
    const registry = buildAudiencePainRegistry(raw, lineage);
    const targetCoverage = {
      status: "PARTIAL" as const,
      matches: [
        { isCovered: true, matchedSegmentNames: ["Segment Alpha"] },
        { isCovered: false, matchedSegmentNames: ["Segment Beta"] },
      ]
    };

    const updated = attachTargetCoverageToPainRegistry(registry, targetCoverage);
    const p1 = updated.find((p) => p.canonical === "Pain 1")!;
    const p2 = updated.find((p) => p.canonical === "Pain 2")!;

    expect(p1.targetCovered).toBe(true);
    expect(p2.targetCovered).toBe(false);
  });

  it("does not allow off-target or GAP pains to become strategyEligible", () => {
    const raw = [
      { canonical: "Pain Alpha", segmentIds: ["Segment A"], segmentId: "Segment A" },
      { canonical: "Pain Beta", segmentIds: ["Segment B"], segmentId: "Segment B" },
    ];
    const registry = buildAudiencePainRegistry(raw, lineage);
    const targetCoverage = {
      status: "GAP" as const,
      matches: []
    };

    const attached = attachTargetCoverageToPainRegistry(registry, targetCoverage);
    for (const pain of attached) {
      const isFit = pain.productFit === "ELIGIBLE" || pain.fitType === "DIRECT_FIT";
      const isStrategyEligible = !!pain.targetCovered && isFit;
      expect(isStrategyEligible).toBe(false);
    }
  });
});


