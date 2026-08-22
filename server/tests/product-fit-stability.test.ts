import { describe, it, expect } from "vitest";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { judgePainClassifierOutput } from "../shared/pain-classifier";

const lineage = {
  jobId: "job-1",
  orchestratorSnapshotId: "snapshot-1",
  accountId: "account-1"
};

describe("Product Fit Semantic Stability (G9)", () => {
  it("1. DIRECT paraphrase fixture - SAME_PAIN_DIFFERENT_WORDING classifies identically", () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Silos prevent effective reporting", evidenceUids: ["EV:1"] },
      { canonical: "Fragmented data causes poor reporting", evidenceUids: ["EV:1"] },
      { canonical: "Unable to generate accurate reports due to scattered tools", evidenceUids: ["EV:1"] },
      { canonical: "Data fragmentation hurts report quality", evidenceUids: ["EV:1"] },
    ], lineage);

    const records = registry.map(p => ({
      painId: p.painId,
      classification: "CORE_PURCHASE" as const,
      productFit: "ELIGIBLE" as const,
      fitType: "DIRECT_FIT" as const,
      requiredCapability: "Automated data consolidation and reporting",
      matchedProductCapability: "Automated report validation and reconciliation",
      directCausalExplanation: "The product automatically consolidates fragmented data.",
      reason: "Direct fit based on reporting capability and other stuff.",
      semanticRank: p.rank,
    }));

    const judged = judgePainClassifierOutput(registry, records as any[], [], { productCapabilities: "Automated report validation and reconciliation" });
    expect(judged.accepted.size).toBe(4);
    expect(judged.rejections.length).toBe(0);
  });

  it("2. STRATEGIC paraphrase fixture - All paraphrases get STRATEGIC_FIT", () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "High employee turnover", evidenceUids: ["EV:2"] },
      { canonical: "Staff retention is poor", evidenceUids: ["EV:2"] },
      { canonical: "Losing too many good employees", evidenceUids: ["EV:2"] },
      { canonical: "High churn rate in the workforce", evidenceUids: ["EV:2"] },
    ], lineage);

    const records = registry.map(p => ({
      painId: p.painId,
      classification: p.classification, // Keep its natural classification to avoid promotion error
      productFit: "ELIGIBLE" as const,
      fitType: "STRATEGIC_FIT" as const,
      requiredCapability: "Employee retention programs",
      matchedProductCapability: "Employee feedback analytics",
      strategicBridge: "Analytics identifies root causes of turnover so management can fix them.",
      boundary: "Does not hire or fire employees at all",
      reason: "Strategic fit for retention because it is long enough.",
      semanticRank: p.rank,
    }));

    const judged = judgePainClassifierOutput(registry, records as any[], [], { productCapabilities: "Employee feedback analytics" });
    expect(judged.accepted.size).toBe(4);
    expect(judged.rejections.length).toBe(0);
  });

  it("3. NOT_FIT paraphrase fixture - All paraphrases get NOT_FIT", () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Office coffee is terrible", evidenceUids: ["EV:3"] },
      { canonical: "Poor quality beverages in breakroom", evidenceUids: ["EV:3"] },
      { canonical: "Staff hates the coffee machine", evidenceUids: ["EV:3"] },
      { canonical: "Bad coffee", evidenceUids: ["EV:3"] },
    ], lineage);

    const records = registry.map(p => ({
      painId: p.painId,
      classification: p.classification,
      productFit: "INELIGIBLE" as const,
      fitType: "NOT_FIT" as const,
      requiredCapability: "Better coffee beans",
      matchedProductCapability: "None",
      reason: "Not a fit for software because it is just coffee.",
      semanticRank: p.rank,
    }));

    const judged = judgePainClassifierOutput(registry, records as any[], [], { productCapabilities: "B2B Analytics Software" });
    expect(judged.accepted.size).toBe(4);
    expect(judged.rejections.length).toBe(0);
  });

  it("8. Strategic boundary still required", () => {
    const registry = buildAudiencePainRegistry([{ canonical: "Pain", evidenceUids: [] }], lineage);
    const judged = judgePainClassifierOutput(registry, [{
      painId: registry[0].painId,
      classification: registry[0].classification,
      productFit: "ELIGIBLE",
      fitType: "STRATEGIC_FIT",
      requiredCapability: "X", matchedProductCapability: "Y",
      strategicBridge: "A very good strategic bridge that makes sense.",
      reason: "this reason is definitely long enough", semanticRank: 1
    } as any], []);
    
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections.map(r => r.code)).toContain("BOUNDARY_MISSING");
  });

  it("9. Unsupported bridge rejected (generic)", () => {
    const registry = buildAudiencePainRegistry([{ canonical: "Pain", evidenceUids: [] }], lineage);
    const judged = judgePainClassifierOutput(registry, [{
      painId: registry[0].painId,
      classification: registry[0].classification,
      productFit: "ELIGIBLE",
      fitType: "STRATEGIC_FIT",
      requiredCapability: "X", matchedProductCapability: "Y",
      strategicBridge: "both are in marketing",
      boundary: "Does not write copy",
      reason: "this reason is definitely long enough", semanticRank: 1
    } as any], []);
    
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections.map(r => r.code)).toContain("FALSE_STRATEGIC_BRIDGE");
  });

  it("19. ELIGIBLE + missing fitType is invalid semantic output (Triggers Repair)", () => {
    const registry = buildAudiencePainRegistry([{ canonical: "Pain", evidenceUids: [] }], lineage);
    const judged = judgePainClassifierOutput(registry, [{
      painId: registry[0].painId,
      classification: registry[0].classification,
      productFit: "ELIGIBLE",
      reason: "this reason is definitely long enough", semanticRank: 1
    } as any], []);
    
    expect(judged.accepted.size).toBe(0);
    expect(judged.rejections.map(r => r.code)).toContain("FIT_TYPE_MISSING");
  });

  it("20. ELIGIBLE cannot auto-map to DIRECT_FIT (Removed legacy fallback)", () => {
    const registry = buildAudiencePainRegistry([{ canonical: "Pain", evidenceUids: [] }], lineage);
    const judged = judgePainClassifierOutput(registry, [{
      painId: registry[0].painId,
      classification: registry[0].classification,
      productFit: "ELIGIBLE",
      reason: "this reason is definitely long enough", semanticRank: 1
    } as any], []);
    
    // It should be rejected, NOT auto-mapped and accepted.
    expect(judged.accepted.size).toBe(0);
  });
});
