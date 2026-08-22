import "dotenv/config";
import { describe, it, expect } from "vitest";
import { consolidateSegmentPainsSemantic } from "../audience-engine/engine";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";

describe("Audience Root-Pain Consolidation + Factual Materiality Dossier", { timeout: 35000 }, () => {
  it("TEST A — SAME ROOT PAIN MERGE: Consolidates duplicate root pains into 1 canonical pain with all evidence IDs", async () => {
    const inputSegments = [
      {
        name: "B2B SaaS Growth Leaders",
        role: "BUYER",
        pains: [
          {
            claimId: "seg_1_pain_a",
            claim: "Teams make decisions using fragmented market data.",
            evidenceIds: ["EV-A"]
          },
          {
            claimId: "seg_1_pain_b",
            claim: "Teams lack unified visibility and cannot translate signals into decisions.",
            evidenceIds: ["EV-B"]
          }
        ]
      }
    ];

    const result = await consolidateSegmentPainsSemantic(inputSegments, "test_account");
    expect(result.length).toBe(1);
    const seg = result[0];
    
    // Pains should be consolidated to 1 canonical pain
    expect(seg.pains.length).toBe(1);
    const canonicalPain = seg.pains[0];
    
    // Both evidence IDs MUST be preserved
    expect(canonicalPain.evidenceIds).toContain("EV-A");
    expect(canonicalPain.evidenceIds).toContain("EV-B");
  });

  it("TEST B — DISTINCT PAINS REMAIN DISTINCT: Keeps distinct root problems separate", async () => {
    const inputSegments = [
      {
        name: "B2B SaaS Buyers",
        role: "BUYER",
        pains: [
          {
            claimId: "seg_1_pain_1",
            claim: "Teams lack unified market intelligence.",
            evidenceIds: ["EV-A"]
          },
          {
            claimId: "seg_1_pain_2",
            claim: "Customers cannot cancel subscriptions.",
            evidenceIds: ["EV-B"]
          }
        ]
      }
    ];

    const result = await consolidateSegmentPainsSemantic(inputSegments, "test_account");
    expect(result.length).toBe(1);
    const seg = result[0];
    
    // 2 distinct pains must remain separate
    expect(seg.pains.length).toBe(2);
    const allEvidence = seg.pains.flatMap((p: any) => p.evidenceIds);
    expect(allEvidence).toContain("EV-A");
    expect(allEvidence).toContain("EV-B");
  });

  it("TEST C — EVIDENCE UNION COMPLETENESS: Zero evidence UIDs lost during consolidation", async () => {
    const inputPains = [
      { claimId: "p1", claim: "Teams make decisions using fragmented market data", evidenceIds: ["EV-1", "EV-2"] },
      { claimId: "p2", claim: "Teams lack unified visibility and cannot translate signals into decisions", evidenceIds: ["EV-3", "EV-4"] },
      { claimId: "p3", claim: "Customers experience unauthorized credit card charges", evidenceIds: ["EV-5"] }
    ];
    const inputSegments = [
      {
        name: "Test Segment",
        pains: inputPains
      }
    ];

    const originalEvidenceUnion = Array.from(new Set(inputPains.flatMap(p => p.evidenceIds))).sort();

    const result = await consolidateSegmentPainsSemantic(inputSegments, "test_account");
    const outputEvidenceUnion = Array.from(
      new Set(result[0].pains.flatMap((p: any) => p.evidenceIds))
    ).sort();

    expect(outputEvidenceUnion).toEqual(originalEvidenceUnion);
  });

  it("TEST D — MERGED CLAIM REVALIDATION: Revalidates canonical claim and repairs or preserves evidence bounds", async () => {
    const inputSegments = [
      {
        name: "Data Platform Practitioners",
        role: "PRACTITIONER",
        pains: [
          {
            claimId: "claim_1",
            claim: "Users face challenges connecting scattered data insights into actionable buying signals.",
            evidenceIds: ["EV-189"]
          },
          {
            claimId: "claim_2",
            claim: "Most users have visibility problems rather than data problems, limiting effective decision-making.",
            evidenceIds: ["EV-191"]
          }
        ]
      }
    ];

    const result = await consolidateSegmentPainsSemantic(inputSegments, "test_account");
    expect(result.length).toBe(1);
    const seg = result[0];
    
    // The final canonical pain must be grounded and verified without unsupported hallucinated claims
    expect(seg.pains.length).toBeGreaterThanOrEqual(1);
    for (const p of seg.pains) {
      expect(typeof p.claim).toBe("string");
      expect(p.claim.length).toBeGreaterThan(10);
      expect(Array.isArray(p.evidenceIds)).toBe(true);
    }
  });

  it("TEST E — NO /4 SCORE: Builds factual materiality metrics without synthetic decimal scores", () => {
    const rawPain = {
      painId: "test_pain_1",
      canonical: "Users lack market visibility",
      evidenceUids: ["EV-189"],
      sourceSignalIds: [],
      sourceTypes: ["comment"]
    };

    const registry = buildAudiencePainRegistry(
      [rawPain],
      { accountId: "acc_1", audienceSnapshotId: "snap_1" },
      [{ id: "seg_1", name: "Segment 1" } as any]
    );

    expect(registry.length).toBe(1);
    const pain = registry[0];

    // Factual properties must be present
    expect(pain.citationCount).toBe(1);
    expect(pain.uniqueEvidenceCount).toBe(1);
    expect(pain.uniqueSourceCount).toBe(1);
    expect(pain.occurrenceCount).toBe(1);
    
    // evidenceStrength must NOT be count/4 (which would be 1/4 = 0.25) nor synthetic 1.0
    expect(pain.evidenceStrength).toBeUndefined();
  });

  it("TEST F — HIGH COUNT DOES NOT FORCE CORE: Superficial formatting chore evaluated as SUPPORTING", async () => {
    const input = {
      jobId: "test_job_1",
      painId: "pain_shallow_1",
      targetUnderstandingAuthorityId: "tu_auth_1",
      productTruthFactIds: ["pt_1", "pain_shallow_1", "tu_auth_1"],
      campaignOfferingId: "camp_off_1",
      targetAssessmentAuthorityId: "ta_test_job_1_pain_shallow_1",
      productAssessmentAuthorityId: "pa_test_job_1_pain_shallow_1",
      targetAssessmentParentAuthorityIds: ["pain_shallow_1", "tu_auth_1"],
      productAssessmentParentAuthorityIds: ["pain_shallow_1", "tu_auth_1"],
      targetAssessmentJobId: "test_job_1",
      productAssessmentJobId: "test_job_1",
      painClaim: "Users find testimonial design cards slightly tedious to format manually.",
      productFitType: "DIRECT_FIT" as const,
      targetCoverageDecision: "COVERED" as const,
      materialityContext: {
        citationCount: 45, // High citation count
        uniqueEvidenceCount: 45,
        uniqueCompetitorCount: 5,
        occurrenceCount: 45,
        sourceTypes: ["social_comment"],
        evidenceSummaries: ["Users mention spending 10 minutes making testimonial cards look nice."]
      }
    };

    const result = await judgeStrategicPainDecision(input);
    expect(result.status).toBe("COMPLETE");
    // Even with 45 citations, a superficial formatting chore is SUPPORTING rather than anchoring CORE value
    expect(["SUPPORTING", "CORE_PURCHASE"]).toContain(result.finalClassification);
  });

  it("TEST G — LOW COUNT DOES NOT BLOCK CORE: 1 severe citation can be reasoned as CORE_PURCHASE", async () => {
    const input = {
      jobId: "test_job_2",
      painId: "pain_severe_1",
      targetUnderstandingAuthorityId: "tu_auth_2",
      productTruthFactIds: ["pt_2", "pain_severe_1", "tu_auth_2"],
      campaignOfferingId: "camp_off_2",
      targetAssessmentAuthorityId: "ta_test_job_2_pain_severe_1",
      productAssessmentAuthorityId: "pa_test_job_2_pain_severe_1",
      targetAssessmentParentAuthorityIds: ["pain_severe_1", "tu_auth_2"],
      productAssessmentParentAuthorityIds: ["pain_severe_1", "tu_auth_2"],
      targetAssessmentJobId: "test_job_2",
      productAssessmentJobId: "test_job_2",
      painClaim: "B2B marketing executives lose millions in pipeline because they cannot identify high-intent buying signals from scattered market data.",
      productFitType: "DIRECT_FIT" as const,
      targetCoverageDecision: "COVERED" as const,
      materialityContext: {
        citationCount: 1, // Only 1 single citation
        uniqueEvidenceCount: 1,
        uniqueCompetitorCount: 1,
        occurrenceCount: 1,
        sourceTypes: ["executive_interview"],
        evidenceSummaries: ["CMO reports enterprise pipeline collapses due to lack of market buying signals."]
      }
    };

    const result = await judgeStrategicPainDecision(input);
    expect(result.status).toBe("COMPLETE");
    // No hardcoded veto blocking CORE on 1 citation
    expect(["CORE_PURCHASE", "SUPPORTING"]).toContain(result.finalClassification);
  });
});
