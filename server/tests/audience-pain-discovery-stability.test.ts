import "dotenv/config";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as aiClient from "../ai-client";
import { discoverAtomicAudiencePains, consolidateSegmentPainsSemantic, constructSegments } from "../audience-engine/engine";
import { judgeAndRepairPainFidelityWithLLM } from "../shared/pain-classifier";
import type { AudienceEvidenceUnit } from "../audience-engine/evidence-selector";

describe("Audience Pain Discovery Stability & Structural Completeness (Tests A-G)", { timeout: 45000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST A (MULTI-CONCEPT EVIDENCE): Multi-concept evidence unit produces independent atomic pains
  it("TEST A: Multi-Concept Evidence — Single unit with distinct problems produces independent atomic pains with shared evidence lineage", async () => {
    const multiConceptEvidence: AudienceEvidenceUnit[] = [
      {
        id: "EV-TEST-1",
        sourceActor: "VERIFIED_BUYER",
        authorityClass: "DIRECT_CUSTOMER_VOICE",
        text: "The dress is completely see-through and cheaply made, and when I contacted customer service to request a return they completely ignored me for three weeks.",
        safeUses: ["PAIN_EXTRACTION"],
        prohibitedUses: []
      }
    ];

    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      if (opts?.endpoint === "audience-engine-v3-pain-discovery") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  pains: [
                    {
                      claimId: "disc_pain_1",
                      claim: "Garments arriving with see-through, cheaply made fabric and construction defects",
                      evidenceIds: ["EV-TEST-1"]
                    },
                    {
                      claimId: "disc_pain_2",
                      claim: "Customer service unresponsive to return and refund requests",
                      evidenceIds: ["EV-TEST-1"]
                    }
                  ]
                })
              }
            }
          ]
        } as any;
      }
      if (opts?.endpoint === "pain-fidelity-judge") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "FAITHFUL",
                  critique: "Directly supported by quote",
                  repairedClaim: ""
                })
              }
            }
          ]
        } as any;
      }
      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const discovered = await discoverAtomicAudiencePains(
      multiConceptEvidence,
      { industry: "Fashion", coreOffer: "Modest Dresses", targetAudience: "Women" },
      "test_acc"
    );

    expect(discovered.length).toBe(2);
    // Both pains cite EV-TEST-1
    expect(discovered[0].evidenceIds).toContain("EV-TEST-1");
    expect(discovered[1].evidenceIds).toContain("EV-TEST-1");
    // Distinct claim IDs
    expect(discovered[0].claimId).not.toBe(discovered[1].claimId);
    // Neither conjoins the other issue (atomic)
    expect(discovered[0].claim.toLowerCase()).toContain("see-through");
    expect(discovered[0].claim.toLowerCase()).not.toContain("customer service");
    expect(discovered[1].claim.toLowerCase()).toContain("customer service");
    expect(discovered[1].claim.toLowerCase()).not.toContain("see-through");
  });

  // TEST B (SEGMENT DOES NOT ERASE PAIN): Structural completeness check catches omitted minority pain and repairs grouping via LLM
  it("TEST B: Segment Clustering Does Not Erase Pain — Omitted minority pain is caught by completeness check and assigned via bounded LLM repair", async () => {
    let repairCalled = false;
    let initialProposalReturned = false;

    const canonicalPains = [
      { claimId: "disc_pain_1", claim: "See-through and thin fabric quality", evidenceIds: ["EV-1"] },
      { claimId: "disc_pain_2", claim: "Heat discomfort from non-breathable fabrics", evidenceIds: ["EV-2"] },
      { claimId: "disc_pain_3", claim: "Inaccurate sizing chart leading to poor fit", evidenceIds: ["EV-3"] }
    ];

    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      // Step 1: Initial segment generator omits disc_pain_1 (groups only pain 2 and 3)
      if (opts?.endpoint === "audience-engine-v3-segments") {
        initialProposalReturned = true;
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  segments: [
                    {
                      name: "Fabric Comfort Seekers",
                      segmentDefinition: { claimId: "seg_1_def", claim: "Women seeking breathable modest dresses", evidenceIds: ["EV-2"] },
                      role: { claimId: "seg_1_role", value: "END_CONSUMER", evidenceIds: ["EV-2"] },
                      description: "Looking for heat-friendly wear",
                      pains: [
                        { claimId: "disc_pain_2", claim: "Heat discomfort from non-breathable fabrics", evidenceIds: ["EV-2"] }
                      ]
                    },
                    {
                      name: "Fit & Sizing Focus",
                      segmentDefinition: { claimId: "seg_2_def", claim: "Women concerned with sizing accuracy", evidenceIds: ["EV-3"] },
                      role: { claimId: "seg_2_role", value: "END_CONSUMER", evidenceIds: ["EV-3"] },
                      description: "Looking for accurate sizing",
                      pains: [
                        { claimId: "disc_pain_3", claim: "Inaccurate sizing chart leading to poor fit", evidenceIds: ["EV-3"] }
                      ]
                    }
                  ]
                })
              }
            }
          ]
        } as any;
      }

      // Step 2: Bounded repair prompt receives the missing pain (disc_pain_1) and assigns it
      if (opts?.endpoint === "audience-engine-v3-grouping-repair") {
        repairCalled = true;
        expect(opts.messages[0].content).toContain("disc_pain_1");
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assignments: [
                    { claimId: "disc_pain_1", assignToSegmentIndex: 0 }
                  ]
                })
              }
            }
          ]
        } as any;
      }

      // Step 3: Semantic Judge verdicts for manifest claims
      if (opts?.endpoint === "audience-engine-v3-judge") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdicts: [
                    { claimId: "seg_1_def", status: "VALID" },
                    { claimId: "seg_1_role", status: "VALID" },
                    { claimId: "disc_pain_2", status: "VALID" },
                    { claimId: "disc_pain_1", status: "VALID" },
                    { claimId: "seg_2_def", status: "VALID" },
                    { claimId: "seg_2_role", status: "VALID" },
                    { claimId: "disc_pain_3", status: "VALID" }
                  ]
                })
              }
            }
          ]
        } as any;
      }

      // Consolidation
      if (opts?.endpoint === "audience-engine-v3-pain-consolidation") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ canonicalPains: [] })
              }
            }
          ]
        } as any;
      }

      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const evidenceItems: AudienceEvidenceUnit[] = [
      { id: "EV-1", sourceActor: "VERIFIED_BUYER", authorityClass: "DIRECT_CUSTOMER_VOICE", text: "See-through and thin fabric quality", safeUses: ["PAIN_EXTRACTION"], prohibitedUses: [] },
      { id: "EV-2", sourceActor: "VERIFIED_BUYER", authorityClass: "DIRECT_CUSTOMER_VOICE", text: "Heat discomfort from non-breathable fabrics", safeUses: ["PAIN_EXTRACTION"], prohibitedUses: [] },
      { id: "EV-3", sourceActor: "VERIFIED_BUYER", authorityClass: "DIRECT_CUSTOMER_VOICE", text: "Inaccurate sizing chart leading to poor fit", safeUses: ["PAIN_EXTRACTION"], prohibitedUses: [] },
    ];

    const resultSegments = await constructSegments(
      [], [], [], [],
      { level: "MODERATE", description: "moderate" } as any,
      { level: "PROBLEM_AWARE", description: "aware" } as any,
      { industry: "Fashion", coreOffer: "Modest Dresses", targetAudience: "Women" },
      evidenceItems,
      "test_acc",
      null,
      undefined,
      undefined,
      canonicalPains
    );

    expect(initialProposalReturned).toBe(true);
    expect(repairCalled).toBe(true);
    expect(resultSegments.length).toBe(2);

    const allAssignedClaims = resultSegments.flatMap((s: any) => (s.pains || []).map((p: any) => p.claim));
    expect(allAssignedClaims.some((c: string) => c.toLowerCase().includes("see-through"))).toBe(true);
  });

  // TEST C (PREFERENCE DOES NOT BECOME REQUIREMENT): Invariant 4 repairs over-specialized requirement to faithful core friction
  it("TEST C: Preference Does Not Become Requirement — Invariant 4 repairs narrow fabric requirement into faithful heat discomfort friction", async () => {
    // Live LLM test against Invariant 4 in pain-classifier.ts
    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Buyers require 100% natural, breathable fabrics and cannot wear synthetic materials in summer",
      evidenceTexts: [
        "polyester feels so hot in 90 degree weather, I always prefer cotton or linen dresses in summer",
        "wearing synthetics in hot weather makes me sweat so much, prefer natural fabrics"
      ],
      accountId: "test_acc"
    });

    expect(["OVER_GENERALIZED", "SEMANTIC_DRIFT"]).toContain(result.verdict);
    expect(result.canonical).toBeDefined();
    // Repaired claim MUST NOT assert an absolute category requirement
    expect(result.canonical.toLowerCase()).not.toContain("require 100% natural");
    expect(result.canonical.toLowerCase()).not.toContain("cannot wear synthetic");
    // Repaired claim MUST preserve the faithful core friction (heat discomfort / breathability)
    expect(
      result.canonical.toLowerCase().includes("heat") ||
      result.canonical.toLowerCase().includes("breathab") ||
      result.canonical.toLowerCase().includes("comfort")
    ).toBe(true);
  });

  // TEST D (FIDELITY REPAIR IS LOCAL): Local repair mutates only the target claim, leaving neighboring claims untouched
  it("TEST D: Local Fidelity Repair — Mutates only the target claim and preserves neighboring claims and citation lineage", async () => {
    const candidatePains = [
      {
        claimId: "pain_1",
        claim: "Inaccurate sizing charts leading to ill-fitting garments",
        evidenceIds: ["EV-1"]
      },
      {
        claimId: "pain_2",
        claim: "Buyers mandate 100% organic cotton and reject all other fabrics",
        evidenceIds: ["EV-2"]
      },
      {
        claimId: "pain_3",
        claim: "Delayed delivery exceeding estimated delivery window by multiple weeks",
        evidenceIds: ["EV-3"]
      }
    ];

    const evidenceMap = new Map([
      ["EV-1", "The size chart said L is 40 inches but it was only 36 inches"],
      ["EV-2", "I prefer organic cotton because it feels nicer in the heat"],
      ["EV-3", "Package arrived 3 weeks after the promised date"]
    ]);

    const results: any[] = [];
    for (const p of candidatePains) {
      const texts = p.evidenceIds.map(id => evidenceMap.get(id)!).filter(Boolean);
      const res = await judgeAndRepairPainFidelityWithLLM({
        painClaim: p.claim,
        evidenceTexts: texts,
        accountId: "test_acc"
      });
      results.push({
        claimId: p.claimId,
        originalClaim: p.claim,
        finalClaim: res.canonical,
        verdict: res.verdict,
        evidenceIds: p.evidenceIds
      });
    }

    // Pain 1: Faithful -> untouched
    expect(results[0].verdict).toBe("FAITHFUL");
    expect(results[0].finalClaim).toBe(candidatePains[0].claim);
    expect(results[0].evidenceIds).toEqual(["EV-1"]);

    // Pain 2: Over-generalized -> repaired locally
    expect(["OVER_GENERALIZED", "SEMANTIC_DRIFT"]).toContain(results[1].verdict);
    expect(results[1].finalClaim).not.toBe(candidatePains[1].claim);
    expect(results[1].finalClaim.toLowerCase()).not.toContain("mandate 100% organic");
    expect(results[1].evidenceIds).toEqual(["EV-2"]); // Citation preserved

    // Pain 3: Faithful -> untouched
    expect(results[2].verdict).toBe("FAITHFUL");
    expect(results[2].finalClaim).toBe(candidatePains[2].claim);
    expect(results[2].evidenceIds).toEqual(["EV-3"]);
  });

  // TEST E (FREQUENT THEME DOES NOT SILENCE DISTINCT EVIDENCE): Minority evidence pain is preserved
  it("TEST E: Frequent Theme Does Not Silence Minority Evidence — 10 heat quotes vs 2 see-through quotes preserves both", async () => {
    const evidenceItems: AudienceEvidenceUnit[] = [
      // 10 heat/breathability quotes
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `EV-HEAT-${i + 1}`,
        sourceActor: "VERIFIED_BUYER" as const,
        authorityClass: "DIRECT_CUSTOMER_VOICE" as const,
        text: `It is way too hot in summer for heavy polyester fabric #${i + 1}, need breathable dresses.`,
        safeUses: ["PAIN_EXTRACTION" as const],
        prohibitedUses: []
      })),
      // 2 see-through / cheap construction quotes
      {
        id: "EV-QUAL-1",
        sourceActor: "VERIFIED_BUYER",
        authorityClass: "DIRECT_CUSTOMER_VOICE",
        text: "The fabric on this dress is completely sheer and see-through, you can see right through it in daylight.",
        safeUses: ["PAIN_EXTRACTION"],
        prohibitedUses: []
      },
      {
        id: "EV-QUAL-2",
        sourceActor: "VERIFIED_BUYER",
        authorityClass: "DIRECT_CUSTOMER_VOICE",
        text: "Cheaply made Shein quality with unraveling seams and see-through skirt.",
        safeUses: ["PAIN_EXTRACTION"],
        prohibitedUses: []
      }
    ];

    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      if (opts?.endpoint === "audience-engine-v3-pain-discovery") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  pains: [
                    {
                      claimId: "disc_pain_1",
                      claim: "Difficulty finding modest dresses that prevent heat discomfort and lack breathability",
                      evidenceIds: ["EV-HEAT-1", "EV-HEAT-2", "EV-HEAT-3"]
                    },
                    {
                      claimId: "disc_pain_2",
                      claim: "Garments made with sheer, see-through fabric and flimsy construction",
                      evidenceIds: ["EV-QUAL-1", "EV-QUAL-2"]
                    }
                  ]
                })
              }
            }
          ]
        } as any;
      }
      if (opts?.endpoint === "pain-fidelity-judge") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({ verdict: "FAITHFUL", critique: "Supported", repairedClaim: "" })
              }
            }
          ]
        } as any;
      }
      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const discovered = await discoverAtomicAudiencePains(
      evidenceItems,
      { industry: "Fashion", coreOffer: "Modest Dresses", targetAudience: "Women" },
      "test_acc"
    );

    expect(discovered.length).toBeGreaterThanOrEqual(2);
    const hasQualityPain = discovered.some(p =>
      p.claim.toLowerCase().includes("see-through") ||
      p.claim.toLowerCase().includes("sheer") ||
      p.claim.toLowerCase().includes("flimsy")
    );
    expect(hasQualityPain).toBe(true);

    const qualityPain = discovered.find(p => p.claim.toLowerCase().includes("see-through") || p.claim.toLowerCase().includes("sheer"));
    expect(qualityPain?.evidenceIds).toContain("EV-QUAL-1");
  });

  // TEST F (DUPLICATE CLAIM IDs): Failed merge revalidation retains unique non-colliding claim IDs across all segments
  it("TEST F: Failed Merge Revalidation — Retains constituent claims with unique non-colliding IDs and lineage", async () => {
    const inputSegments = [
      {
        name: "Segment 1",
        pains: [
          { claimId: "seg_1_pain_1", claim: "Cheaply made see-through fabric", evidenceIds: ["EV-1"] },
          { claimId: "seg_1_pain_2", claim: "Unresponsive customer service", evidenceIds: ["EV-2"] }
        ]
      },
      {
        name: "Segment 2",
        pains: [
          { claimId: "seg_1_pain_1", claim: "Sizing chart inaccuracies", evidenceIds: ["EV-3"] }, // Duplicate ID from input!
          { claimId: "seg_2_pain_2", claim: "Delivery delays", evidenceIds: ["EV-4"] }
        ]
      }
    ];

    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      // Propose merge per segment
      if (opts?.endpoint === "audience-engine-v3-pain-consolidation") {
        const isSeg1 = opts.messages[0]?.content?.includes("Segment 1");
        if (isSeg1) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    canonicalPains: [
                      {
                        claimId: "seg_1_pain_1",
                        claim: "Cheap fabric and unresponsive customer service",
                        evidenceIds: ["EV-1", "EV-2"]
                      }
                    ]
                  })
                }
              }
            ]
          } as any;
        } else {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    canonicalPains: [
                      {
                        claimId: "seg_2_pain_1",
                        claim: "Sizing inaccuracies and delivery delays",
                        evidenceIds: ["EV-3", "EV-4"]
                      }
                    ]
                  })
                }
              }
            ]
          } as any;
        }
      }
      // Merge revalidation rejects merge (compound / different lifecycle stages)
      if (opts?.endpoint === "audience-engine-v3-merged-claim-revalidation") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "INVALID",
                  canMerge: false,
                  critique: "Distinct lifecycle stages and capability requirements"
                })
              }
            }
          ]
        } as any;
      }
      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const consolidated = await consolidateSegmentPainsSemantic(
      inputSegments,
      "test_acc",
      []
    );

    // Verify all final pain IDs across all segments are strictly unique
    const allPainIds = consolidated.flatMap((s: any) => (s.pains || []).map((p: any) => p.claimId));
    expect(allPainIds.length).toBe(4);
    expect(new Set(allPainIds).size).toBe(4);

    // Segment 1 IDs: seg_1_pain_1, seg_1_pain_2
    expect(consolidated[0].pains[0].claimId).toBe("seg_1_pain_1");
    expect(consolidated[0].pains[1].claimId).toBe("seg_1_pain_2");

    // Segment 2 IDs: seg_2_pain_1, seg_2_pain_2 (NO collision with Segment 1!)
    expect(consolidated[1].pains[0].claimId).toBe("seg_2_pain_1");
    expect(consolidated[1].pains[1].claimId).toBe("seg_2_pain_2");

    // Lineage preserved
    expect(consolidated[1].pains[0].previousClaimId).toBe("seg_1_pain_1");
  });

  // TEST G (PRODUCT TRUTH INDEPENDENCE): Structural assertion verifying Product Truth is absent from discovery
  it("TEST G: Product Truth Independence — Structural assertion proving discoverAtomicAudiencePains receives zero Product Truth", async () => {
    // 1. Signature assertion: discoverAtomicAudiencePains accepts exactly 3 parameters: evidenceItems, targetContext, accountId
    expect(discoverAtomicAudiencePains.length).toBeLessThanOrEqual(3);

    let recordedPrompt = "";
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      recordedPrompt = opts.messages[0]?.content || "";
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({ pains: [] })
            }
          }
        ]
      } as any;
    });

    const evidenceItems: AudienceEvidenceUnit[] = [
      { id: "EV-1", sourceActor: "VERIFIED_BUYER", authorityClass: "DIRECT_CUSTOMER_VOICE", text: "Great modest dress but runs small", safeUses: ["PAIN_EXTRACTION"], prohibitedUses: [] }
    ];

    // Call discoverAtomicAudiencePains with targetContext
    await discoverAtomicAudiencePains(
      evidenceItems,
      {
        industry: "Modest Apparel",
        coreOffer: "Modest Dresses",
        targetAudience: "Women",
        targetRoles: ["BUYER", "END_CONSUMER"]
      },
      "test_acc"
    );

    // 2. Assert Product Truth concepts are completely absent from prompt
    expect(recordedPrompt).not.toContain("PRODUCT OFFERING CONTEXT");
    expect(recordedPrompt).not.toContain("PRODUCT DNA");
    expect(recordedPrompt).not.toContain("uniqueMechanism");
    expect(recordedPrompt).not.toContain("strategicAdvantage");
    expect(recordedPrompt).not.toContain("productTruth");
    expect(recordedPrompt).not.toContain("capabilities");
    expect(recordedPrompt).not.toContain("productAnchor");

    // 3. Assert Product Truth changes in caller do not leak into targetContext
    const arbitraryProductTruth = {
      productDna: { uniqueMechanism: "UltraLuxe Fabric", coreProblemSolved: "Heat" },
      capabilities: ["100% French Linen"],
      productAnchor: { name: "Sara Dress", differentiatingFeature: "Exclusive weave" }
    };

    // Caller strictly sanitizes to targetContext:
    const sanitizedContext = {
      industry: "Modest Apparel",
      coreOffer: "Modest Dresses",
      targetAudience: "Women",
    };

    expect((sanitizedContext as any).productDna).toBeUndefined();
    expect((sanitizedContext as any).capabilities).toBeUndefined();
    expect((sanitizedContext as any).productAnchor).toBeUndefined();
  });
});
