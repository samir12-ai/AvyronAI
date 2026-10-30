import { describe, it, expect } from "vitest";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
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

  describe("Phase 4-8: Product Assessment Authority", () => {
    it("7. Missing Product Truth facts causes INCOMPLETE outcome", async () => {
      const result = await runProductAssessmentForPain({
        painId: "p1",
        canonicalPain: "diet confusion",
        campaignOfferingId: "co_1",
        businessUnderstandingAuthorityId: "bu_1",
        productTruthFacts: [],
        accountId: "acc_1",
        campaignId: "camp_1",
        jobId: "job_1",
      });
      expect(result.status).toBe("INCOMPLETE");
      expect(result.fitType).toBe("UNKNOWN");
    });

    it("11. Missing BU authority ID causes fail-closed INCOMPLETE", async () => {
      const result = await runProductAssessmentForPain({
        painId: "p1",
        canonicalPain: "diet confusion",
        campaignOfferingId: "co_1",
        businessUnderstandingAuthorityId: "",
        productTruthFacts: [{ factId: "f1", statement: "Provides COA to prove purity", factType: "CAPABILITY" }],
        accountId: "acc_1",
        campaignId: "camp_1",
        jobId: "job_1",
      });
      expect(result.status).toBe("INCOMPLETE");
      expect(result.fitType).toBe("UNKNOWN");
    });

    it("15. UNKNOWN and NOT_FIT are valid deterministic outcomes from existing assessment", async () => {
      const resultUnknown = await runProductAssessmentForPain({
        painId: "p1",
        canonicalPain: "diet confusion",
        campaignOfferingId: "co_1",
        businessUnderstandingAuthorityId: "bu_1",
        productTruthFacts: [{ factId: "f1", statement: "Some fact", factType: "CAPABILITY" }],
        accountId: "acc_1",
        campaignId: "camp_1",
        jobId: "job_1",
        existingAssessment: {
          productAssessmentAuthorityId: "pa_job_1_p1",
          status: "COMPLETE",
          fitType: "UNKNOWN",
          jobId: "job_1",
          accountId: "acc_1",
          campaignId: "camp_1",
          painId: "p1",
          campaignOfferingId: "co_1",
          productTruthFactIds: ["f1"],
          reason: "Not enough evidence to establish fit.",
        },
      });
      expect(resultUnknown.status).toBe("COMPLETE");
      expect(resultUnknown.fitType).toBe("UNKNOWN");

      const resultNotFit = await runProductAssessmentForPain({
        painId: "p1",
        canonicalPain: "diet confusion",
        campaignOfferingId: "co_1",
        businessUnderstandingAuthorityId: "bu_1",
        productTruthFacts: [{ factId: "f1", statement: "Some fact", factType: "CAPABILITY" }],
        accountId: "acc_1",
        campaignId: "camp_1",
        jobId: "job_1",
        existingAssessment: {
          productAssessmentAuthorityId: "pa_job_1_p1",
          status: "COMPLETE",
          fitType: "NOT_FIT",
          jobId: "job_1",
          accountId: "acc_1",
          campaignId: "camp_1",
          painId: "p1",
          campaignOfferingId: "co_1",
          productTruthFactIds: ["f1"],
          reason: "No capability exists for this pain.",
        },
      });
      expect(resultNotFit.status).toBe("COMPLETE");
      expect(resultNotFit.fitType).toBe("NOT_FIT");
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
