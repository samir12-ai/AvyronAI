import { describe, it, expect, vi, beforeEach } from "vitest";
import { runProductAssessmentForPain } from "../../strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../../strategic-pain-decision-judge";
import { splitMarketPainPortfolio, buildAudiencePainRegistry } from "../../shared/audience-pain-registry";
import * as aiClient from "../../ai-client";

describe("Contract: Single Owner Isolation (Product Assessment vs Strategic Pain Decision)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Product Assessment is sole authority on fitType (DIRECT_FIT, STRATEGIC_FIT, NOT_FIT, UNKNOWN)", async () => {
    const facts = [
      { factId: "f1", sourceField: "productSpecs", rawValue: "100% natural cotton summer dresses" }
    ];

    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              fitType: "DIRECT_FIT",
              reason: "100% natural cotton directly addresses synthetic fabric heat rash.",
              productTruthFactIds: ["f1"],
            })
          }
        }]
      } as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              fitType: "NOT_FIT",
              reason: "Clothing brand cannot solve accounting software problems.",
              productTruthFactIds: [],
            })
          }
        }]
      } as any);

    const resultDirect = await runProductAssessmentForPain({
      painId: "p1",
      canonicalPain: "synthetic dresses cause heat rash in summer",
      campaignOfferingId: "co1",
      businessUnderstandingAuthorityId: "bu1",
      productTruthFacts: facts,
      accountId: "acc1",
      campaignId: "camp1",
      jobId: "j1",
    });
    expect(resultDirect.fitType).toBe("DIRECT_FIT");
    expect(resultDirect.productAssessmentAuthorityId).toMatch(/^pa_/);

    const resultNotFit = await runProductAssessmentForPain({
      painId: "p2",
      canonicalPain: "cannot find accounting software",
      campaignOfferingId: "co1",
      businessUnderstandingAuthorityId: "bu1",
      productTruthFacts: facts,
      accountId: "acc1",
      campaignId: "camp1",
      jobId: "j1",
    });
    expect(resultNotFit.fitType).toBe("NOT_FIT");
  });

  it("2. Strategic Pain Decision Judge is sole authority on finalClassification (CORE_PURCHASE, SUPPORTING, EXCLUDE, DROPPED)", async () => {
    const facts = [
      { factId: "f1", sourceField: "productSpecs", rawValue: "100% natural cotton summer dresses" }
    ];

    vi.spyOn(aiClient, "aiChat").mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            finalClassification: "CORE_PURCHASE",
            reason: "Fabric discomfort is a primary purchase blocker directly solved by product capabilities."
          })
        }
      }]
    } as any);

    const spdResult = await judgeStrategicPainDecision({
      jobId: "j1",
      painId: "p1",
      targetUnderstandingAuthorityId: "tu1",
      productTruthFactIds: ["f1"],
      campaignOfferingId: "co1",
      targetAssessmentAuthorityId: "ta1",
      productAssessmentAuthorityId: "pa1",
      targetAssessmentParentAuthorityIds: ["tu1", "p1"],
      productAssessmentParentAuthorityIds: ["co1", "p1"],
      targetAssessmentJobId: "j1",
      productAssessmentJobId: "j1",
      painClaim: "synthetic dresses cause heat rash in summer",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "SUPPORTED",
      materiality: {
        mode: "NONE",
        evidence: [],
        rawEvidenceUids: [],
        rawCitationCount: 0,
        uniqueEvidenceCount: 0,
        sourceTypes: [],
        uniqueCompetitorCount: 0,
      },
      productTruthFacts: facts,
      productAssessmentReason: "Direct fit to fabric capabilities",
      accountId: "acc1",
      campaignId: "camp1",
    });

    expect(spdResult.finalClassification).toBe("CORE_PURCHASE");
    expect(spdResult.strategicPainDecisionAuthorityId).toMatch(/^spd_/);
  });

  it("3. splitMarketPainPortfolio partitions strictly by fitType (DIRECT_FIT / STRATEGIC_FIT vs NOT_FIT / UNKNOWN)", () => {
    const registry = buildAudiencePainRegistry([
      { painId: "p1", canonical: "Pain 1", classification: "CORE_PURCHASE", fitType: "DIRECT_FIT", eligible: true, allowedUses: ["positioning"] },
      { painId: "p2", canonical: "Pain 2", classification: "SUPPORTING", fitType: "STRATEGIC_FIT", eligible: true, allowedUses: ["positioning"] },
      { painId: "p3", canonical: "Pain 3", classification: "UNKNOWN", fitType: "NOT_FIT", eligible: false, allowedUses: [] },
      { painId: "p4", canonical: "Pain 4", classification: "UNKNOWN", fitType: "UNKNOWN", eligible: false, allowedUses: [] },
    ], { accountId: "acc1", audienceSnapshotId: "aud1" });

    const portfolio = splitMarketPainPortfolio(registry, { accountId: "acc1", audienceSnapshotId: "aud1", campaignId: "camp1" });
    expect(portfolio.reconciliation.directFit).toBe(1);
    expect(portfolio.reconciliation.strategicFit).toBe(1);
    expect(portfolio.reconciliation.notFit).toBe(1);
    expect(portfolio.reconciliation.unknown).toBe(1);
    expect(portfolio.productAligned.map(p => p.painId)).toEqual(["p1", "p2"]);
    expect(portfolio.generalMarket.map(p => p.painId)).toEqual(["p3", "p4"]);
  });
});
