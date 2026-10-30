import { describe, it, expect } from "vitest";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import { buildAudiencePainRegistry, splitMarketPainPortfolio } from "../shared/audience-pain-registry";

describe("Product Assessment Authority & Portfolio Splitting Stability", () => {
  const accountId = "acc_pf_stab";
  const campaignId = "camp_pf_stab";
  const jobId = "job_pf_stab";
  const buId = "bu_pf_stab";
  const coId = "co_pf_stab";
  const productTruthFacts = [
    {
      productTruthFactId: "fact_1",
      statement: "Automated report validation and reconciliation engine.",
      verifiedCapability: "Automated report validation and reconciliation",
      factType: "CAPABILITY"
    },
    {
      productTruthFactId: "fact_2",
      statement: "Employee feedback sentiment analytics.",
      verifiedCapability: "Employee feedback analytics",
      factType: "CAPABILITY"
    }
  ];

  it("1. Fails closed with INCOMPLETE and UNKNOWN fit when inputs are missing", async () => {
    const res = await runProductAssessmentForPain({
      painId: "p_missing",
      canonicalPain: "Some pain",
      campaignOfferingId: "",
      businessUnderstandingAuthorityId: "",
      productTruthFacts: [],
      accountId,
      campaignId,
      jobId
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.fitType).toBe("UNKNOWN");
    expect(res.reason).toContain("Missing required Business Understanding");
  });

  it("2. Reuses valid existing assessment deterministically preserving DIRECT_FIT", async () => {
    const painId = "p_direct";
    const existing = {
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      status: "COMPLETE",
      fitType: "DIRECT_FIT" as const,
      jobId,
      accountId,
      campaignId,
      painId,
      campaignOfferingId: coId,
      productTruthFactIds: ["fact_1"],
      reason: "Direct fit on report reconciliation"
    };

    const res = await runProductAssessmentForPain({
      painId,
      canonicalPain: "Data silos prevent reliable reports",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId,
      existingAssessment: existing
    });

    expect(res.status).toBe("COMPLETE");
    expect(res.fitType).toBe("DIRECT_FIT");
    expect(res.productAssessmentAuthorityId).toBe(existing.productAssessmentAuthorityId);
    expect(res.parentAuthorityIds).toContain("fact_1");
  });

  it("3. Reuses valid existing assessment deterministically preserving STRATEGIC_FIT", async () => {
    const painId = "p_strategic";
    const existing = {
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      status: "COMPLETE",
      fitType: "STRATEGIC_FIT" as const,
      jobId,
      accountId,
      campaignId,
      painId,
      campaignOfferingId: coId,
      productTruthFactIds: ["fact_2"],
      reason: "Strategic fit via turnover sentiment analysis"
    };

    const res = await runProductAssessmentForPain({
      painId,
      canonicalPain: "High employee turnover rate",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId,
      existingAssessment: existing
    });

    expect(res.status).toBe("COMPLETE");
    expect(res.fitType).toBe("STRATEGIC_FIT");
    expect(res.parentAuthorityIds).toContain("fact_2");
  });

  it("4. Reuses valid existing assessment deterministically preserving NOT_FIT", async () => {
    const painId = "p_not_fit";
    const existing = {
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      status: "COMPLETE",
      fitType: "NOT_FIT" as const,
      jobId,
      accountId,
      campaignId,
      painId,
      campaignOfferingId: coId,
      productTruthFactIds: ["fact_1", "fact_2"],
      reason: "Office coffee is out of scope for B2B analytics software"
    };

    const res = await runProductAssessmentForPain({
      painId,
      canonicalPain: "Office coffee quality is terrible",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId,
      campaignId,
      jobId,
      existingAssessment: existing
    });

    expect(res.status).toBe("COMPLETE");
    expect(res.fitType).toBe("NOT_FIT");
  });

  it("5. splitMarketPainPortfolio correctly separates DIRECT_FIT and STRATEGIC_FIT into productAligned", () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Direct pain", fitType: "DIRECT_FIT" as any },
      { canonical: "Strategic pain", fitType: "STRATEGIC_FIT" as any },
      { canonical: "Not fit pain", fitType: "NOT_FIT" as any },
      { canonical: "Unknown pain", fitType: "UNKNOWN" as any },
    ], { accountId, audienceSnapshotId: "snap_1" });

    const views = splitMarketPainPortfolio(registry);
    expect(views.productAligned.length).toBe(2);
    expect(views.generalMarket.length).toBe(2);
    expect(views.reconciliation.directFit).toBe(1);
    expect(views.reconciliation.strategicFit).toBe(1);
    expect(views.reconciliation.notFit).toBe(1);
    expect(views.reconciliation.unknown).toBe(1);
    expect(views.reconciliation.sumMatchesTotal).toBe(true);
  });
});
