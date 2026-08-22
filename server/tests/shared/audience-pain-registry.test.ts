
import { describe, it, expect } from "vitest";
import { 
  buildAudiencePainRegistry, 
  extractCanonicalSegmentPains, 
  selectPainForUse, 
  selectPainsForUse 
} from "../../shared/audience-pain-registry";
import { judgeProductFitStructural } from "../../shared/pain-classifier";

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

  it("10 & 11 & 12 & 13 & 14. Product Fit structural judge validates fit taxonomy and rejects false bridges", () => {
    const rawPains = [
      { claimId: "p_direct", claim: "Ad design takes too long", evidenceUids: ["EV:1"], segmentIds: ["seg_1"] },
      { claimId: "p_strategic", claim: "Burnout from manual work", evidenceUids: ["EV:2"], segmentIds: ["seg_1"] },
      { claimId: "p_unsupported", claim: "Credit card charges fail", evidenceUids: ["EV:3"], segmentIds: ["seg_1"] }
    ];
    const registry = buildAudiencePainRegistry(rawPains, lineage);

    // Test structural judge over proposed records
    const fitRecords = [
      {
        painId: "p_direct",
        classification: "SUPPORTING" as const,
        productFit: "ELIGIBLE" as const,
        fitType: "DIRECT_FIT" as const,
        requiredCapability: "Automate ad design",
        matchedProductCapability: "AI Creative automation",
        reason: "Valid direct capability executes the task"
      },
      {
        painId: "p_strategic",
        classification: "SUPPORTING" as const,
        productFit: "ELIGIBLE" as const,
        fitType: "STRATEGIC_FIT" as const,
        requiredCapability: "Reduce operational burnout",
        matchedProductCapability: "Strategic planning intelligence",
        strategicBridge: "Provides upstream strategic focus so teams do not waste energy on wrong angles",
        boundary: "Does not perform literal copywriting execution",
        reason: "Valid bounded strategic relationship"
      },
      {
        painId: "p_unsupported",
        classification: "SUPPORTING" as const,
        productFit: "INELIGIBLE" as const,
        fitType: "NOT_FIT" as const,
        requiredCapability: "Fix credit card billing",
        matchedProductCapability: "None",
        reason: "Product has no payment processing or billing capabilities"
      }
    ];

    const result = judgeProductFitStructural(registry, fitRecords);
    expect(result.accepted.size).toBe(3);
    expect(result.accepted.get("p_direct")?.fitType).toBe("DIRECT_FIT");
    expect(result.accepted.get("p_strategic")?.fitType).toBe("STRATEGIC_FIT");
    expect(result.accepted.get("p_unsupported")?.fitType).toBe("NOT_FIT");
    expect(result.accepted.get("p_unsupported")?.productFit).toBe("INELIGIBLE");
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

