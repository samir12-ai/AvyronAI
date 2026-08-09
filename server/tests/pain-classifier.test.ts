import { describe, expect, it } from "vitest";
import {
  buildAudiencePainRegistry,
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
    expect(selectPainForUse(updated, "offer_objection")?.painId).not.toBe(updatedPricing.painId);
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
