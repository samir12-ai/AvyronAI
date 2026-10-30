import { describe, expect, it } from "vitest";
import {
  buildAudiencePainRegistry,
  buildMarketPainPortfolio,
  splitMarketPainPortfolio,
  attachTargetCoverageToPainRegistry,
  selectPainForUse,
  selectPainsForUse,
  validateAudiencePainRegistry,
} from "../shared/audience-pain-registry";
import {
  validatePainEvidenceOwnership,
  refineAudiencePainRegistry,
  LLM_CLASSIFIER_VERSION,
} from "../shared/pain-classifier";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { extractAudiencePainRoles } from "../orchestrator/plan-synthesis";

const lineage = { accountId: "account-a", audienceSnapshotId: "audience-run-a" };

function registryFixture() {
  return buildAudiencePainRegistry(
    [
      { canonical: "Refund and cancellation friction after purchase", sourceSignals: ["sig-1"], sourceTypes: ["review"], classification: "POST_PURCHASE_FRICTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["retention"] },
      { canonical: "Teams struggle to produce reliable reports", sourceSignals: ["sig-2", "sig-3"], rootCauses: ["RC1"], classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["positioning", "differentiation", "mechanism", "offer_core", "awareness", "funnel", "persuasion", "channel"] },
      { canonical: "Pricing proof concerns delay approval", sourceSignals: ["sig-4"], classification: "OBJECTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_objection", "awareness", "funnel", "persuasion"] },
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
      expect(pain.classifierVersion).toBeDefined();
      expect(pain.classificationReason.length).toBeGreaterThan(0);
    }
    const refund = registry.find((p) => p.canonical.startsWith("Refund"))!;
    expect(refund.sourceTypes).toEqual(["review"]);
    const reports = registry.find((p) => p.canonical.includes("reliable reports"))!;
    expect(reports.rootCauseIds).toEqual(["RC1"]);
    expect(reports.sourceSignalIds).toEqual(["sig-2", "sig-3"]);
  });

  it("provides an auditable classification reason", () => {
    const raw = [{ canonical: "Refund friction after delivery" }];
    const registry = buildAudiencePainRegistry(raw, lineage);
    expect(registry[0].classificationReason).toBeDefined();
    expect(registry[0].classificationReason.length).toBeGreaterThan(0);
  });
});

describe("canonical assessment & decision authority pipeline (G3)", () => {
  it("preserves canonical pain IDs and identities without hallucinated additions", () => {
    const registry = registryFixture();
    expect(registry.length).toBe(3);
    expect(registry.map(p => p.painId)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pain_/)]),
    );
  });

  it("fails closed on Strategic Pain Decision when upstream authorities are missing", async () => {
    const res = await judgeStrategicPainDecision({
      jobId: "job_test",
      painId: "p1",
      targetUnderstandingAuthorityId: "",
      productTruthFactIds: [],
      campaignOfferingId: "co_1",
      targetAssessmentAuthorityId: "",
      productAssessmentAuthorityId: "",
      targetAssessmentParentAuthorityIds: [],
      productAssessmentParentAuthorityIds: [],
      targetAssessmentJobId: "job_test",
      productAssessmentJobId: "job_test",
      painClaim: "Some claim",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: { mode: "NONE", rawEvidenceUids: [], rawCitationCount: 0, uniqueEvidenceCount: 0, sourceTypes: [] },
      accountId: lineage.accountId,
      campaignId: "campaign-test",
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.finalClassification).toBe("DROPPED");
  });

  it("routes post-purchase friction away from core acquisition uses", () => {
    const registry = registryFixture();
    const refund = registry.find((p) => p.classification === "POST_PURCHASE_FRICTION")!;
    expect(selectPainForUse(registry, "offer_core")?.painId).not.toBe(refund.painId);
    expect(selectPainForUse(registry, "positioning")?.painId).not.toBe(refund.painId);
    expect(selectPainForUse(registry, "retention")?.painId).toBe(refund.painId);
  });

  it("executes pain refinement pipeline across canonical assess/judge flow", async () => {
    const registry = registryFixture();
    const refined = await refineAudiencePainRegistry(registry, {
      accountId: lineage.accountId,
      campaignId: "campaign-test",
      llmEnabled: false,
    });
    expect(refined.classifierUsed).toBe(LLM_CLASSIFIER_VERSION);
    expect(refined.registry.map((p) => p.painId)).toEqual(registry.map((p) => p.painId));
  });
});

describe("cross-tenant evidence ownership (G5)", () => {
  it("marks pains citing unresolvable registry evidence as ineligible", async () => {
    const evMap = new Map<string, any>([
      ["EV:other-tenant:v1:deadbeef", { id: "EV:other-tenant:v1:deadbeef", verbatimText: "other tenant quote", confidence: 0.9, customerEvidenceId: "ce_1" }]
    ]);
    const registry = buildAudiencePainRegistry(
      [{ canonical: "Teams struggle to produce reliable reports", evidenceUids: ["EV:other-tenant:v1:deadbeef"] }],
      lineage,
      evMap,
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
  it("validates DIRECT_FIT and STRATEGIC_FIT deterministically from Product Assessment", async () => {
    const jobId = "job_pf_test";
    const res = await runProductAssessmentForPain({
      painId: "p_direct",
      canonicalPain: "Teams struggle to produce reliable reports",
      campaignOfferingId: "co_test",
      businessUnderstandingAuthorityId: "bu_test",
      productTruthFacts: [{ factId: "f1", statement: "Automated reporting", factType: "CAPABILITY" }],
      accountId: lineage.accountId,
      campaignId: "campaign-test",
      jobId,
      existingAssessment: {
        productAssessmentAuthorityId: `pa_${jobId}_p_direct`,
        status: "COMPLETE",
        fitType: "STRATEGIC_FIT",
        jobId,
        accountId: lineage.accountId,
        campaignId: "campaign-test",
        painId: "p_direct",
        campaignOfferingId: "co_test",
        productTruthFactIds: ["f1"],
        reason: "Strategic fit for reporting analytics",
      },
    });
    expect(res.status).toBe("COMPLETE");
    expect(res.fitType).toBe("STRATEGIC_FIT");
  });

  it("fails closed on Product Assessment when inputs are missing", async () => {
    const res = await runProductAssessmentForPain({
      painId: "p_test",
      canonicalPain: "Some pain",
      campaignOfferingId: "",
      businessUnderstandingAuthorityId: "",
      productTruthFacts: [],
      accountId: lineage.accountId,
      campaignId: "campaign-test",
      jobId: "job_test",
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.fitType).toBe("UNKNOWN");
  });

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


