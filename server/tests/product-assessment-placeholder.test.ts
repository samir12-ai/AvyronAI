import 'dotenv/config';
import { describe, it, expect } from "vitest";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";

describe("Product Assessment Placeholder Regression Tests", () => {
  const accountId = "acc_test_123";
  const campaignId = "camp_test_123";
  const jobId = "job_test_123";
  const businessUnderstandingAuthorityId = "bu_test_123";
  const campaignOfferingId = "co_test_123";

  const productTruthFacts = [
    {
      productTruthFactId: "fact_1",
      statement: "Avyron continuously analyzes real competitor and audience evidence via its Live Market Mirror.",
      verifiedCapability: "Continuous competitor and audience market intelligence analysis",
      factType: "CAPABILITY"
    },
    {
      productTruthFactId: "fact_2",
      statement: "Avyron converts empirical audience and competitor evidence into structured strategic intelligence.",
      verifiedCapability: "Converts scattered data into structured GTM strategic intelligence",
      factType: "CAPABILITY"
    }
  ];

  it("semantically evaluates a pain and does not return UNKNOWN when Product Truth directly addresses it", async () => {
    const painClaim = "Difficulty connecting scattered data and insights to real buying signals hampers go-to-market effectiveness.";
    
    const result = await runProductAssessmentForPain({
      painId: "pain_gtm_signals",
      canonicalPain: painClaim,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.productAssessmentAuthorityId).toBe(`pa_${jobId}_pain_gtm_signals`);
    expect(result.productTruthFactIds).toContain("fact_1");
    expect(result.productTruthFactIds).toContain("fact_2");
    // Must be DIRECT_FIT or STRATEGIC_FIT, not stuck at placeholder UNKNOWN
    expect(["DIRECT_FIT", "STRATEGIC_FIT"]).toContain(result.fitType);
  }, 30000);

  it("reuses a valid same-job ProductAssessmentAuthority", async () => {
    const painClaim = "Difficulty connecting scattered data and insights to real buying signals hampers go-to-market effectiveness.";
    const existingAuthorityId = `pa_${jobId}_pain_reuse_test`;

    const result = await runProductAssessmentForPain({
      painId: "pain_reuse_test",
      canonicalPain: painClaim,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId,
      existingAssessment: {
        productAssessmentAuthorityId: existingAuthorityId,
        status: "COMPLETE",
        fitType: "DIRECT_FIT",
        jobId,
        accountId,
        campaignId,
        painId: "pain_reuse_test",
        campaignOfferingId,
        productTruthFactIds: ["fact_1", "fact_2"],
        reason: "Valid existing same-job assessment"
      }
    });

    expect(result.productAssessmentAuthorityId).toBe(existingAuthorityId);
    expect(result.fitType).toBe("DIRECT_FIT");
    expect(result.reason).toBe("Valid existing same-job assessment");
  }, 30000);

  it("does NOT reuse previous-job ProductAssessment authority and re-evaluates cleanly", async () => {
    const painClaim = "Difficulty connecting scattered data and insights to real buying signals hampers go-to-market effectiveness.";
    const staleJobId = "job_stale_previous_456";
    const staleAuthorityId = `pa_${staleJobId}_pain_stale_test`;

    const result = await runProductAssessmentForPain({
      painId: "pain_stale_test",
      canonicalPain: painClaim,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId, // current job
      existingAssessment: {
        productAssessmentAuthorityId: staleAuthorityId,
        status: "COMPLETE",
        fitType: "NOT_FIT", // Stale decision from another job
        jobId: staleJobId, // Stale job
        accountId,
        campaignId,
        painId: "pain_stale_test",
        campaignOfferingId,
        productTruthFactIds: ["fact_1", "fact_2"],
        reason: "Stale previous job"
      }
    });

    // Must generate authority for CURRENT jobId, not stale jobId
    expect(result.jobId).toBe(jobId);
    expect(result.productAssessmentAuthorityId).toBe(`pa_${jobId}_pain_stale_test`);
    // Must re-evaluate cleanly rather than reusing the stale NOT_FIT
    expect(result.fitType).not.toBe("NOT_FIT");
  }, 30000);
});
