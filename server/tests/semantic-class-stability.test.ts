import { describe, it, expect } from "vitest";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";

describe("Semantic Role Authority & SPD Lineage Invariants", () => {
  const jobId = "job_test_spd";
  const accountId = "acc_test_spd";
  const campaignId = "camp_test_spd";
  const painId = "pain_test_1";
  const tuId = "tu_test_spd";
  const coId = "co_test_spd";
  const factIds = ["fact_1", "fact_2"];

  it("requires valid materiality contract on StrategicPainDecisionInput", async () => {
    const res = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: tuId,
      productTruthFactIds: factIds,
      campaignOfferingId: coId,
      targetAssessmentAuthorityId: `ta_${jobId}_${painId}`,
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      targetAssessmentParentAuthorityIds: [tuId, painId],
      productAssessmentParentAuthorityIds: [tuId, ...factIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Fragmented data impairs accurate reporting",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: null as any,
      accountId,
      campaignId,
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.finalClassification).toBe("DROPPED");
    expect(res.reason).toContain("Invalid or missing materiality contract");
  });

  it("fails closed when upstream authority IDs are missing", async () => {
    const res = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: "",
      productTruthFactIds: [],
      campaignOfferingId: coId,
      targetAssessmentAuthorityId: "",
      productAssessmentAuthorityId: "",
      targetAssessmentParentAuthorityIds: [],
      productAssessmentParentAuthorityIds: [],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Fragmented data impairs accurate reporting",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: { mode: "NONE", rawEvidenceUids: [], rawCitationCount: 0, uniqueEvidenceCount: 0, sourceTypes: [] },
      accountId,
      campaignId,
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.finalClassification).toBe("DROPPED");
    expect(res.reason).toContain("Missing upstream authority IDs");
  });

  it("fails closed when painId is not found in parent authority lineage", async () => {
    const res = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: tuId,
      productTruthFactIds: factIds,
      campaignOfferingId: coId,
      targetAssessmentAuthorityId: `ta_${jobId}_${painId}`,
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      targetAssessmentParentAuthorityIds: [tuId, "other_pain"],
      productAssessmentParentAuthorityIds: [tuId, ...factIds, "other_pain"],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Fragmented data impairs accurate reporting",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: { mode: "NONE", rawEvidenceUids: [], rawCitationCount: 0, uniqueEvidenceCount: 0, sourceTypes: [] },
      accountId,
      campaignId,
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.finalClassification).toBe("DROPPED");
    expect(res.reason).toContain("PainId not found in parent authority lineage");
  });

  it("fails closed when Target Assessment does not trace to Target Understanding", async () => {
    const res = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: tuId,
      productTruthFactIds: factIds,
      campaignOfferingId: coId,
      targetAssessmentAuthorityId: `ta_${jobId}_${painId}`,
      productAssessmentAuthorityId: `pa_${jobId}_${painId}`,
      targetAssessmentParentAuthorityIds: ["different_tu", painId],
      productAssessmentParentAuthorityIds: [tuId, ...factIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Fragmented data impairs accurate reporting",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: { mode: "NONE", rawEvidenceUids: [], rawCitationCount: 0, uniqueEvidenceCount: 0, sourceTypes: [] },
      accountId,
      campaignId,
    });
    expect(res.status).toBe("INCOMPLETE");
    expect(res.finalClassification).toBe("DROPPED");
    expect(res.reason).toContain("Target Assessment does not trace to Target Understanding Authority");
  });
});
