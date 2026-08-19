import { describe, it, expect } from "vitest";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { judgePainClassifierOutput } from "../shared/pain-classifier";
import { deriveAnchorFromProductDna } from "../shared/strategic-doctrine";

describe("Semantic Fidelity & Role Authority Regressions", () => {
  describe("Phase 1: Audience Fallback", () => {
    it("1. unmatched pain does NOT go to first segment", () => {
      const pains = [{ canonical: "Some random pain", evidenceStrength: 1 }];
      const segments = [{ name: "First Segment" }, { name: "Second Segment" }];
      const registry = buildAudiencePainRegistry(pains, { accountId: "1", audienceSnapshotId: "1" }, segments);
      
      expect(registry[0].segmentIds).not.toContain("First Segment");
    });

    it("2. unmatched pain remains UNMATCHED", () => {
      const pains = [{ canonical: "Some random pain", evidenceStrength: 1 }];
      const registry = buildAudiencePainRegistry(pains, { accountId: "1", audienceSnapshotId: "1" }, []);
      
      expect(registry[0].segmentIds).toContain("UNMATCHED");
    });
  });

  describe("Phase 4-8: Product Fit Semantic Judge", () => {
    const registry = [{
      painId: "p1",
      canonical: "diet confusion",
      segmentIds: ["seg1"],
      classification: "CORE_PURCHASE",
      rank: 1,
      productFit: "UNKNOWN",
      eligible: true,
      allowedUses: [],
      prohibitedUses: [],
      evidenceUids: [],
      sourceSignalIds: [],
      sourceTypes: [],
      evidenceStrength: 1,
    }] as any[];

    it("7. pain meaning cannot change", () => {
      const records = [{ painId: "p1", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "business growth", semanticRank: 1 }];
      const result = judgePainClassifierOutput(registry, records as any);
      expect(result.rejections).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SEMANTIC_REWRITE" })]));
    });

    it("11. unsupported COA rejected", () => {
      const records = [{ painId: "p1", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", reason: "Provides COA to prove purity.", semanticRank: 1 }];
      const result = judgePainClassifierOutput(registry, records as any, [], { productCapabilities: "no capabilities" });
      expect(result.rejections).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNSUPPORTED_PRODUCT_TRUTH" })]));
    });

    it("15. UNKNOWN/NOT_FIT are valid outcomes", () => {
      const records = [{ painId: "p1", classification: "CORE_PURCHASE", productFit: "UNKNOWN", reason: "Not enough evidence.", semanticRank: 1 }];
      const result = judgePainClassifierOutput(registry, records as any);
      expect(result.rejections.length).toBe(0);
      expect(result.accepted.size).toBe(1);
    });
  });

  describe("Phase 9: Product Anchor Data Sanity", () => {
    it("18. audience list cannot be interpreted as Strategic Advantage", () => {
      const dna = {
        coreOffer: "Test Product",
        productCategory: "Test Type",
        coreProblemSolved: "Test Problem",
        targetAudienceSegment: "clinic procurement managers",
        strategicAdvantage: "clinic procurement managers"
      };
      const anchor = deriveAnchorFromProductDna(dna);
      expect(anchor).toBeNull(); // Because the only advantage was an audience list, differentiator is empty, making it null.
    });

    it("19. missing businessModel does not default silently to service", () => {
      const dna = { 
        coreOffer: "Test Product",
        productCategory: "Test Type",
        coreProblemSolved: "Test Problem",
        uniqueMechanism: "Test Mech"
      };
      const anchor = deriveAnchorFromProductDna(dna);
      expect(anchor?.offeringType).toBe("unknown");
    });
  });
});
