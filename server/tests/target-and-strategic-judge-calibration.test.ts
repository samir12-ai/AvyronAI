import 'dotenv/config';
import { describe, it, expect } from "vitest";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { runTargetAssessmentForPain } from "../strategic-reasoning/target-assessment";

describe("Target Assessment & Strategic Pain Decision Judge Calibration Tests", () => {
  const accountId = "acc_test_judge";
  const campaignId = "camp_test_judge";
  const jobId = "job_test_judge";
  const targetUnderstandingAuthorityId = "tu_test_judge";
  const campaignOfferingId = "co_test_judge";
  const productTruthFactIds = ["fact_1", "fact_2"];

  it("Target Assessment evaluates semantic role overlap without requiring exact literal title matches", async () => {
    const canonicalTargetRoles = [
      {
        targetRoleFactId: "role_1",
        roleType: "BUYER",
        roleTitle: "VP of Marketing / VP of Strategy",
        rationale: "Evaluates market intelligence and positioning tools"
      },
      {
        targetRoleFactId: "role_2",
        roleType: "USER",
        roleTitle: "Marketing Strategist & Intelligence Analyst",
        rationale: "Conducts competitive analysis and GTM planning"
      }
    ];

    const result = await runTargetAssessmentForPain({
      painId: "pain_gtm_strat",
      segmentId: "seg_gtm",
      canonicalPain: "Data fragmentation and poor data quality hinder effective targeting and decision-making.",
      segmentContext: {
        name: "B2B SaaS GTM Decision Makers and Strategic Marketers",
        role: "STRATEGIC_MARKETER",
        segmentDefinition: "In-house marketing leaders and growth strategists responsible for go-to-market accuracy."
      },
      targetUnderstandingAuthorityId,
      canonicalTargetRoles,
      accountId,
      campaignId,
      jobId
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.decision).toBe("COVERED");
  }, 30000);

  it("CASE A: Target = RELATED_BUT_UNPROVEN, Product = DIRECT_FIT, Materiality = strong -> Final Judge can assign CORE_PURCHASE", async () => {
    const painId = "pain_case_a";
    const taAuthorityId = `ta_${jobId}_${painId}`;
    const paAuthorityId = `pa_${jobId}_${painId}`;

    const result = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId,
      productTruthFactIds,
      campaignOfferingId,
      targetAssessmentAuthorityId: taAuthorityId,
      productAssessmentAuthorityId: paAuthorityId,
      targetAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      productAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, ...productTruthFactIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Data fragmentation and unverified signals lead to severe go-to-market strategy misallocations costing millions in wasted spend.",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "RELATED_BUT_UNPROVEN",
      materialityContext: {
        evidenceStrength: 0.95,
        evidenceUids: ["EV-101", "EV-102", "EV-103", "EV-104", "EV-105"],
        occurrenceCount: 15,
        sourceTypes: ["Executive Interview", "G2 Verified Review", "Industry Survey"]
      },
      accountId,
      campaignId
    });

    expect(result.status).toBe("COMPLETE");
    // With strong materiality and DIRECT_FIT, CORE_PURCHASE is valid and allowed (not vetoed)
    expect(["CORE_PURCHASE", "SUPPORTING"]).toContain(result.finalClassification);
  }, 30000);

  it("CASE B: Target = RELATED_BUT_UNPROVEN, Product = DIRECT_FIT, Materiality = weak -> Final Judge assigns SUPPORTING", async () => {
    const painId = "pain_case_b";
    const taAuthorityId = `ta_${jobId}_${painId}`;
    const paAuthorityId = `pa_${jobId}_${painId}`;

    const result = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId,
      productTruthFactIds,
      campaignOfferingId,
      targetAssessmentAuthorityId: taAuthorityId,
      productAssessmentAuthorityId: paAuthorityId,
      targetAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      productAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, ...productTruthFactIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Minor font rendering inconsistencies in competitor reporting exports cause occasional aesthetic annoyance.",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "RELATED_BUT_UNPROVEN",
      materialityContext: {
        evidenceStrength: 0.2,
        evidenceUids: ["EV-999"],
        occurrenceCount: 1,
        sourceTypes: ["One-off comment"]
      },
      accountId,
      campaignId
    });

    expect(result.status).toBe("COMPLETE");
    expect(["SUPPORTING", "EXCLUDE"]).toContain(result.finalClassification);
  }, 30000);

  it("CASE C: Target = COVERED, Product = DIRECT_FIT, Materiality = weak -> CORE is NOT automatic", async () => {
    const painId = "pain_case_c";
    const taAuthorityId = `ta_${jobId}_${painId}`;
    const paAuthorityId = `pa_${jobId}_${painId}`;

    const result = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId,
      productTruthFactIds,
      campaignOfferingId,
      targetAssessmentAuthorityId: taAuthorityId,
      productAssessmentAuthorityId: paAuthorityId,
      targetAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      productAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, ...productTruthFactIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "Occasional mild delay in downloading monthly dashboard PDF summaries.",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materialityContext: {
        evidenceStrength: 0.25,
        evidenceUids: ["EV-01"],
        occurrenceCount: 1,
        sourceTypes: ["Minor feedback"]
      },
      accountId,
      campaignId
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.finalClassification).toBe("SUPPORTING");
  }, 30000);

  it("CASE D: Target = NOT_COVERED, Product = NOT_FIT -> EXCLUDE is legitimate", async () => {
    const painId = "pain_case_d";
    const taAuthorityId = `ta_${jobId}_${painId}`;
    const paAuthorityId = `pa_${jobId}_${painId}`;

    const result = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId,
      productTruthFactIds,
      campaignOfferingId,
      targetAssessmentAuthorityId: taAuthorityId,
      productAssessmentAuthorityId: paAuthorityId,
      targetAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      productAssessmentParentAuthorityIds: [targetUnderstandingAuthorityId, ...productTruthFactIds, painId],
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "End-consumer subscribers experience recurring credit card charges after requesting service cancellation.",
      productFitType: "NOT_FIT",
      targetCoverageDecision: "NOT_COVERED",
      materialityContext: {
        evidenceStrength: 0.8,
        evidenceUids: ["EV-B1"],
        occurrenceCount: 8,
        sourceTypes: ["Consumer complaint forum"]
      },
      accountId,
      campaignId
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.finalClassification).toBe("EXCLUDE");
  }, 30000);
});
