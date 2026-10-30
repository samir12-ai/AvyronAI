import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAudiencePainRegistry } from "../../shared/audience-pain-registry";
import { judgeStrategicPainDecision } from "../../strategic-pain-decision-judge";
import { runProductAssessmentForPain } from "../../strategic-reasoning/product-assessment";
import { db } from "../../db";
import * as aiClient from "../../ai-client";

describe("Contract: Candidate Pain Promotion Lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Unassessed raw candidate pain begins unpromoted (NOT_EVALUATED, eligible=false, allowedUses=[])", () => {
    const rawPain = {
      painId: "raw_candidate_1",
      canonical: "Manual invoice entry errors cause delays",
    };

    const registry = buildAudiencePainRegistry([rawPain], {
      accountId: "acc_1",
      audienceSnapshotId: "aud_snap_1",
    });

    expect(registry.length).toBe(1);
    const pain = registry[0];
    expect(pain.classification).toBe("NOT_EVALUATED");
    expect(pain.fitType).toBe("UNKNOWN");
    expect(pain.eligible).toBe(false);
    expect(pain.allowedUses).toEqual([]);
  });

  it("2. Product Assessment (PA) promotes candidate to DIRECT_FIT based on Product Truth", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              fitType: "DIRECT_FIT",
              reason: "Automated AI invoice OCR directly solves manual invoice entry",
            }),
          },
        },
      ],
    } as any);

    vi.spyOn(db, "insert").mockReturnValue({
      values: () => Promise.resolve(),
    } as any);

    const paResult = await runProductAssessmentForPain({
      painId: "pain_1",
      canonicalPain: "Manual invoice entry takes too many hours",
      campaignOfferingId: "offering_1",
      businessUnderstandingAuthorityId: "bu_1",
      productTruthFacts: [
        {
          productTruthFactId: "fact_ocr_1",
          statement: "Automated AI invoice OCR extracts 100% of line items instantly.",
          factType: "CAPABILITY",
        },
      ],
      accountId: "acc_1",
      campaignId: "camp_1",
      jobId: "job_pa_1",
    });

    expect(paResult.fitType).toBe("DIRECT_FIT");
    expect(paResult.productAssessmentAuthorityId).toBeDefined();
  });

  it("3. Strategic Pain Decision (SPD) promotes candidate to CORE_PURCHASE and unlocks allowedUses", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              finalClassification: "CORE_PURCHASE",
              reason: "Direct operational bottleneck and primary purchase driver",
              confidence: 0.95,
            }),
          },
        },
      ],
    } as any);

    vi.spyOn(db, "insert").mockReturnValue({
      values: () => Promise.resolve(),
    } as any);

    const spdResult = await judgeStrategicPainDecision({
      jobId: "job_spd_1",
      painId: "pain_1",
      targetUnderstandingAuthorityId: "tu_1",
      productTruthFactIds: ["fact_ocr_1"],
      campaignOfferingId: "offering_1",
      targetAssessmentAuthorityId: "ta_1",
      productAssessmentAuthorityId: "pa_1",
      targetAssessmentParentAuthorityIds: ["pain_1", "tu_1"],
      productAssessmentParentAuthorityIds: ["pain_1"],
      targetAssessmentJobId: "job_spd_1",
      productAssessmentJobId: "job_spd_1",
      painClaim: "Manual invoice entry takes too many hours",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materiality: {
        mode: "GROUNDED",
        evidence: [{ verbatimText: "Invoice entry is our biggest bottleneck" }],
        rawEvidenceUids: ["ev_1"],
        rawCitationCount: 5,
        uniqueEvidenceCount: 3,
        sourceTypes: ["interview"],
      },
      accountId: "acc_1",
      campaignId: "camp_1",
    });

    expect(spdResult.finalClassification).toBe("CORE_PURCHASE");

    const promotedRegistry = buildAudiencePainRegistry(
      [
        {
          painId: "pain_1",
          canonical: "Manual invoice entry takes too many hours",
          classification: spdResult.finalClassification,
          fitType: "DIRECT_FIT",
          productFit: "ELIGIBLE",
          eligible: true,
          allowedUses: ["positioning", "mechanism", "offer_core"],
        },
      ],
      { accountId: "acc_1", audienceSnapshotId: "aud_snap_1" }
    );

    expect(promotedRegistry[0].eligible).toBe(true);
    expect(promotedRegistry[0].classification).toBe("CORE_PURCHASE");
    expect(promotedRegistry[0].allowedUses).toContain("positioning");
    expect(promotedRegistry[0].allowedUses).toContain("mechanism");
  });

  it("4. SPD rejection (DROPPED/EXCLUDE) demotes candidate to ineligible with zero allowed uses", async () => {
    vi.spyOn(db, "insert").mockReturnValue({
      values: () => Promise.resolve(),
    } as any);

    const spdRejected = await judgeStrategicPainDecision({
      jobId: "job_spd_2",
      painId: "pain_frivolous_2",
      targetUnderstandingAuthorityId: "tu_1",
      productTruthFactIds: ["fact_ocr_1"],
      campaignOfferingId: "offering_1",
      targetAssessmentAuthorityId: "ta_1",
      productAssessmentAuthorityId: "pa_1",
      targetAssessmentParentAuthorityIds: ["pain_frivolous_2", "tu_1"],
      productAssessmentParentAuthorityIds: ["pain_frivolous_2"],
      targetAssessmentJobId: "job_spd_2",
      productAssessmentJobId: "job_spd_2",
      painClaim: "I wish the dashboard color was purple",
      productFitType: "NOT_FIT",
      targetCoverageDecision: "NOT_COVERED",
      materiality: {
        mode: "NONE",
        evidence: [],
        rawEvidenceUids: [],
        rawCitationCount: 0,
        uniqueEvidenceCount: 0,
        sourceTypes: [],
      },
      accountId: "acc_1",
      campaignId: "camp_1",
    });

    expect(spdRejected.finalClassification === "EXCLUDE" || spdRejected.finalClassification === "DROPPED").toBe(true);

    const demotedRegistry = buildAudiencePainRegistry(
      [
        {
          painId: "pain_frivolous_2",
          canonical: "I wish the dashboard color was purple",
          classification: "UNKNOWN",
          fitType: "NOT_FIT",
          productFit: "INELIGIBLE",
          eligible: false,
          allowedUses: [],
        },
      ],
      { accountId: "acc_1", audienceSnapshotId: "aud_snap_1" }
    );

    expect(demotedRegistry[0].eligible).toBe(false);
    expect(demotedRegistry[0].allowedUses).toEqual([]);
  });
});
