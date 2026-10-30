
import { describe, it, expect } from "vitest";
import { 
  buildAudiencePainRegistry, 
  extractCanonicalSegmentPains, 
  selectPainForUse, 
  selectPainsForUse,
} from "../../shared/audience-pain-registry";
import { runProductAssessmentForPain } from "../../strategic-reasoning/product-assessment";

describe("Audience Pain Registry & Canonical Segment Binding", () => {
  const lineage = { accountId: "test_acc", audienceSnapshotId: "test_snap" };

  it("1. should map evidenceIds to evidenceUids for new AEL schema", () => {
    const rawPains = [
      {
        claimId: "seg_1_pain_1",
        claim: "Manual Data Entry takes too long",
        evidenceIds: ["EV:causal_claim:test:123", "EV:causal_claim:test:456"],
        segmentIds: ["seg_1"]
      }
    ];
    
    const result = buildAudiencePainRegistry(rawPains, lineage);
    expect(result.length).toBe(1);
    expect(result[0].evidenceUids).toEqual(["EV:causal_claim:test:123", "EV:causal_claim:test:456"]);
  });

  it("2 & 3 & 4. REGRESSION: extracts only Judge-approved segment pains and ignores legacy heuristic painMap / pseudo-pains", () => {
    const audienceSegments = [
      {
        name: "Marketing Managers",
        role: "PRACTITIONER",
        segmentDefinition: { claimId: "seg_1_def", claim: "Marketing managers focused on campaign performance" },
        pains: [
          {
            claimId: "p_data_quality",
            claim: "Data Quality and targeting fragmentation degrade campaign efficiency",
            evidenceIds: ["EV:data:1", "EV:data:2"]
          },
          {
            claimId: "p_manual_workflow",
            claim: "Manual Workflow and team bandwidth constraints delay execution",
            evidenceIds: ["EV:workflow:1"]
          }
        ]
      }
    ];

    const legacyPainMap = [
      "Unresolved need: belonging / community",
      "Unresolved need: desire for attractiveness",
      "cost and affordability concerns",
      "Problem behind objection: fear of commitment"
    ];

    // 1. Extract canonical segment pains
    const canonicalPains = extractCanonicalSegmentPains(audienceSegments);
    expect(canonicalPains.length).toBe(2);

    // 2. Build registry from canonical segment pains
    const registry = buildAudiencePainRegistry(canonicalPains, lineage, audienceSegments);

    expect(registry.length).toBe(2);

    // Assert P1 preserved
    const p1 = registry.find(p => p.painId === "p_data_quality" || p.canonical.includes("Data Quality"));
    expect(p1).toBeDefined();
    expect(p1?.canonical).toBe("Data Quality and targeting fragmentation degrade campaign efficiency");
    expect(p1?.evidenceUids).toEqual(["EV:data:1", "EV:data:2"]);
    expect(p1?.strategicRole).toBe("PRACTITIONER");
    expect(p1?.segmentIds).not.toContain("UNMATCHED");

    // Assert P2 preserved
    const p2 = registry.find(p => p.painId === "p_manual_workflow" || p.canonical.includes("Manual Workflow"));
    expect(p2).toBeDefined();
    expect(p2?.canonical).toBe("Manual Workflow and team bandwidth constraints delay execution");
    expect(p2?.evidenceUids).toEqual(["EV:workflow:1"]);
    expect(p2?.strategicRole).toBe("PRACTITIONER");
    expect(p2?.segmentIds).not.toContain("UNMATCHED");

    // Assert legacy heuristic strings are absent
    for (const legacyStr of legacyPainMap) {
      expect(registry.some(p => p.canonical === legacyStr)).toBe(false);
      expect(registry.some(p => p.canonical.includes("belonging"))).toBe(false);
      expect(registry.some(p => p.canonical.includes("attractiveness"))).toBe(false);
      expect(registry.some(p => p.canonical.includes("affordability"))).toBe(false);
    }
  });

  it("5, 6, 7. Preserves evidence IDs, segment IDs, and role without modification", () => {
    const rawPains = [
      {
        claimId: "seg_lead_pain_1",
        claim: "High cost of acquisition",
        evidenceIds: ["EV:lead:101", "EV:lead:102"],
        segmentIds: ["seg_lead_gen"],
        role: "BUSINESS_OWNER",
      }
    ];
    const registry = buildAudiencePainRegistry(rawPains, lineage);
    expect(registry[0].evidenceUids).toEqual(["EV:lead:101", "EV:lead:102"]);
    expect(registry[0].segmentIds).toEqual(["seg_lead_gen"]);
    expect(registry[0].strategicRole).toBe("BUSINESS_OWNER");
  });

  it("8 & 9. Preserves canonical painId for Target Coverage and Product Fit consumers", () => {
    const rawPains = [
      {
        claimId: "canonical_pain_id_999",
        claim: "Conversion rates drop on mobile",
        evidenceIds: ["EV:mobile:1"],
        segmentIds: ["seg_mobile"],
        targetCovered: true,
        targetCoverageAuthorityId: "tc_auth_999",
      }
    ];
    const registry = buildAudiencePainRegistry(rawPains, lineage);
    expect(registry[0].painId).toBe("canonical_pain_id_999");
    expect(registry[0].targetCovered).toBe(true);
    expect(registry[0].targetCoverageAuthorityId).toBe("tc_auth_999");
  });

  it("10 & 11 & 12 & 13 & 14. Product Assessment validates fit taxonomy deterministically", async () => {
    const jobId = "job_pa_test";
    const coId = "co_pa_test";
    const buId = "bu_pa_test";
    const productTruthFacts = [
      { factId: "fact_1", statement: "AI Creative automation", factType: "CAPABILITY" },
      { factId: "fact_2", statement: "Strategic planning intelligence", factType: "CAPABILITY" },
    ];

    const directRes = await runProductAssessmentForPain({
      painId: "p_direct",
      canonicalPain: "Ad design takes too long",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId: lineage.accountId,
      campaignId: "camp_1",
      jobId,
      existingAssessment: {
        productAssessmentAuthorityId: `pa_${jobId}_p_direct`,
        status: "COMPLETE",
        fitType: "DIRECT_FIT",
        jobId,
        accountId: lineage.accountId,
        campaignId: "camp_1",
        painId: "p_direct",
        campaignOfferingId: coId,
        productTruthFactIds: ["fact_1"],
        reason: "Valid direct capability executes the task",
      },
    });
    expect(directRes.status).toBe("COMPLETE");
    expect(directRes.fitType).toBe("DIRECT_FIT");

    const strategicRes = await runProductAssessmentForPain({
      painId: "p_strategic",
      canonicalPain: "Burnout from manual work",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId: lineage.accountId,
      campaignId: "camp_1",
      jobId,
      existingAssessment: {
        productAssessmentAuthorityId: `pa_${jobId}_p_strategic`,
        status: "COMPLETE",
        fitType: "STRATEGIC_FIT",
        jobId,
        accountId: lineage.accountId,
        campaignId: "camp_1",
        painId: "p_strategic",
        campaignOfferingId: coId,
        productTruthFactIds: ["fact_2"],
        reason: "Valid bounded strategic relationship",
      },
    });
    expect(strategicRes.status).toBe("COMPLETE");
    expect(strategicRes.fitType).toBe("STRATEGIC_FIT");

    const notFitRes = await runProductAssessmentForPain({
      painId: "p_unsupported",
      canonicalPain: "Credit card charges fail",
      campaignOfferingId: coId,
      businessUnderstandingAuthorityId: buId,
      productTruthFacts,
      accountId: lineage.accountId,
      campaignId: "camp_1",
      jobId,
      existingAssessment: {
        productAssessmentAuthorityId: `pa_${jobId}_p_unsupported`,
        status: "COMPLETE",
        fitType: "NOT_FIT",
        jobId,
        accountId: lineage.accountId,
        campaignId: "camp_1",
        painId: "p_unsupported",
        campaignOfferingId: coId,
        productTruthFactIds: ["fact_1", "fact_2"],
        reason: "Product has no payment processing or billing capabilities",
      },
    });
    expect(notFitRes.status).toBe("COMPLETE");
    expect(notFitRes.fitType).toBe("NOT_FIT");
  });

  it("15 & 16 & 17 & 18 & 19 & 20. Supports multiple CORE pains and ensures non-DIRECT_FIT cannot become CORE", () => {
    const rawPains = [
      {
        claimId: "p_core_1",
        claim: "Targeting fragmentation",
        evidenceUids: ["EV:1"],
        segmentIds: ["seg_1"],
        classification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        fitType: "DIRECT_FIT",
        targetCovered: true,
      },
      {
        claimId: "p_core_2",
        claim: "Campaign decay over time",
        evidenceUids: ["EV:2"],
        segmentIds: ["seg_1"],
        classification: "CORE_PURCHASE",
        productFit: "ELIGIBLE",
        fitType: "DIRECT_FIT",
        targetCovered: true,
      },
      {
        claimId: "p_supporting",
        claim: "Billing friction",
        evidenceUids: ["EV:3"],
        segmentIds: ["seg_1"],
        classification: "CORE_PURCHASE", // attempted illegitimate CORE
        productFit: "INELIGIBLE",
        fitType: "NOT_FIT",
        targetCovered: true,
      }
    ];

    const registry = buildAudiencePainRegistry(rawPains, lineage);
    
    // Select for CORE uses
    const positioningPains = selectPainsForUse(registry, "positioning");
    expect(positioningPains.length).toBe(2);
    expect(positioningPains.map(p => p.painId)).toEqual(["p_core_1", "p_core_2"]);
    
    // Non-DIRECT_FIT / INELIGIBLE pain cannot be selected
    expect(positioningPains.some(p => p.painId === "p_supporting")).toBe(false);
  });

  it("25. Fails closed (returns empty array) when audienceSegments has 0 pains", () => {
    const emptySegments = [
      {
        name: "Empty Segment",
        role: "BUYER",
        pains: []
      }
    ];

    const canonicalPains = extractCanonicalSegmentPains(emptySegments);
    expect(canonicalPains).toEqual([]);
  });
});

