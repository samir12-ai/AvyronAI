import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { judgeDifferentiation } from "../differentiation-engine/judge";
import { CanonicalDifferentiationInput, DifferentiationCandidate } from "../differentiation-engine/types";
import * as aiModule from "../ai-client";

describe("Differentiation Engine Repaired Contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockInput: CanonicalDifferentiationInput = {
    lineage: {
      accountId: "acct_test",
      campaignId: "camp_test",
      jobId: "job_test",
      audienceSnapshotId: "aud_snap_test",
      miSnapshotId: "mi_snap_test",
    },
    corePains: [
      {
        painId: "pain_fabric_quality",
        targetCoverageAuthorityId: "tc_1",
        productFitAuthorityId: "pf_1",
        coreDecisionId: "spd_1",
        canonicalPain: "Garments deteriorate quickly and lack fabric durability",
        segmentIds: ["seg_1"],
        fitType: "DIRECT_FIT",
        requiredCapability: "Durable fabric craftsmanship",
        matchedProductCapability: "Crafted with premium fabrics for long-lasting wear",
        productTruthFactIds: ["pt_fact_fabrics"],
      },
    ],
    productTruth: [
      {
        productTruthFactId: "pt_fact_fabrics",
        factType: "CAPABILITY",
        fact: "The dresses are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      },
      {
        productTruthFactId: "pt_fact_pricing",
        factType: "PRICING_FACT",
        fact: "Summer dresses catalog pricing ranges from $35 to $62 across transparent SKU listings.",
      },
    ],
    ourProductFacts: [
      {
        productTruthFactId: "pt_fact_fabrics",
        factType: "CAPABILITY",
        fact: "The dresses are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      },
    ],
    competitiveAuthority: [
      {
        miAuthorityId: "mi_comp_posture",
        competitorId: "comp_1",
        factType: "COMPETITOR_FACT",
        fact: "Competitor 1 operates with fast-fashion volume focus and frequent promotional discounts.",
        miSnapshotId: "mi_snap_test",
        sourceScope: "OBSERVED_COMPETITOR",
      },
      {
        miAuthorityId: "mi_signal_saturation",
        competitorId: "market_baseline",
        factType: "MARKET_EVIDENCE_SIGNAL",
        fact: "Market observation shows narrative convergence around seasonal trends.",
        miSnapshotId: "mi_snap_test",
        sourceScope: "CATEGORY_SIGNAL",
      },
    ],
    miFacts: [
      {
        miAuthorityId: "mi_comp_posture",
        competitorId: "comp_1",
        factType: "COMPETITOR_FACT",
        fact: "Competitor 1 operates with fast-fashion volume focus.",
        miSnapshotId: "mi_snap_test",
        sourceScope: "OBSERVED_COMPETITOR",
      },
    ],
    strategicLanes: [
      {
        laneId: "lane_quality",
        laneName: "Durable Modest Craftsmanship",
        strategicFocus: "Long-lasting wear and transparent design",
        memberPainIds: ["pain_fabric_quality"],
        primaryBuyerTension: "Fear of poor fabric longevity and rapid wear",
      },
    ],
    marketContext: {
      marketPains: ["Garments deteriorate quickly"],
      opportunitySignals: ["Demand for premium durable modest apparel"],
      threatSignals: ["Fast-fashion low cost pressure"],
      categoryMaturity: "MATURING",
    },
  };

  describe("Judge Validation Contract & Fail-Closed Behavior", () => {
    it("rejects contradictory judge verdicts (valid=true but assessments failed or defects present)", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: true,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: false,
                  competitiveFactualSupport: true,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [
                  {
                    differentiationId: "diff_1",
                    code: "PRODUCT_TRUTH_UNSUPPORTED",
                    reason: "Invented unverified natural silk claim",
                    rejectedFields: ["differentiationClaim"],
                    fixDirective: "Ground claim strictly in ourProductFacts",
                  },
                ],
                overallVerdictRationale: "Invalid claims present",
              }),
            },
          },
        ],
      });

      const candidate: DifferentiationCandidate = {
        differentiationId: "diff_1",
        corePainIds: ["pain_fabric_quality"],
        differentiationClaim: "100% natural organic silk construction",
        distinctiveProperty: "Organic Silk",
        buyerValue: "Pure silk softness",
        mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
        proofBoundary: "100% silk certified",
        strategicForm: "STRATEGIC_MARKET_EMPHASIS",
        productTruthFactIds: ["pt_fact_fabrics"],
      };

      const result = await judgeDifferentiation(mockInput, [candidate]);
      expect(result.valid).toBe(false);
      expect(result.defects.length).toBeGreaterThan(0);
    });

    it("rejects unverified competitor negative claims in Strategic Market Emphasis", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: false,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: true,
                  competitiveFactualSupport: false,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: false,
                },
                defects: [
                  {
                    differentiationId: "diff_bad_comp",
                    code: "UNSUPPORTED_NEGATIVE_CLAIM",
                    reason: "Claimed competitors use toxic dyes without MI evidence",
                    unsupportedStatement: "unlike competitors who use cheap toxic dyes",
                    rejectedFields: ["differentiationClaim"],
                    fixDirective: "Remove unverified competitor negative claim or convert to Strategic Market Emphasis without disparaging competitors",
                  },
                ],
                overallVerdictRationale: "Competitor negative not in MI authority",
              }),
            },
          },
        ],
      });

      const candidate: DifferentiationCandidate = {
        differentiationId: "diff_bad_comp",
        corePainIds: ["pain_fabric_quality"],
        differentiationClaim: "Crafted with durable fabrics, unlike competitors who use cheap toxic dyes",
        distinctiveProperty: "Non-toxic durability",
        buyerValue: "Safe wear",
        mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
        proofBoundary: "Premium fabric certification",
        strategicForm: "STRATEGIC_MARKET_EMPHASIS",
        productTruthFactIds: ["pt_fact_fabrics"],
      };

      const result = await judgeDifferentiation(mockInput, [candidate]);
      expect(result.valid).toBe(false);
      expect(result.defects[0].code).toBe("UNSUPPORTED_NEGATIVE_CLAIM");
    });
  });

  describe("Zero Proof Asset Leakage on Failure", () => {
    it("returns empty proofArchitecture, pillars, and differentiations when judge rejects all candidates", async () => {
      vi.spyOn(aiModule, "aiChat")
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      differentiationClaim: "Invented fabric technology",
                      distinctiveProperty: "Nano-fiber weave",
                      buyerValue: "Extreme durability",
                      mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
                      proofBoundary: "Nano-fiber lab testing",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_fact_fabrics"],
                    },
                  ],
                  painDispositions: [
                    { painId: "pain_fabric_quality", disposition: "ACCEPTED_DIFFERENTIATION" },
                  ],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  valid: false,
                  assessmentsCompleted: true,
                  assessmentDetails: {
                    productFactualSupport: false,
                    competitiveFactualSupport: true,
                    audienceLaneRelevance: true,
                    commercialMeaningfulness: false,
                    strategicRoleValidity: false,
                    evidenceCompleteness: false,
                  },
                  defects: [
                    {
                      differentiationId: "diff_test",
                      code: "PRODUCT_TRUTH_UNSUPPORTED",
                      reason: "Nano-fiber is not in product truth",
                      rejectedFields: ["differentiationClaim"],
                      fixDirective: "Remove unverified nano-fiber claim",
                    },
                  ],
                  overallVerdictRationale: "Unsupported product claims present",
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      differentiationClaim: "Still unverified claim",
                      distinctiveProperty: "Nano weave",
                      buyerValue: "Wear",
                      mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_fact_fabrics"],
                    },
                  ],
                  painDispositions: [
                    { painId: "pain_fabric_quality", disposition: "NO_SUPPORTED_DIFFERENTIATION" },
                  ],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  valid: false,
                  assessmentsCompleted: true,
                  assessmentDetails: {
                    productFactualSupport: false,
                    competitiveFactualSupport: true,
                    audienceLaneRelevance: true,
                    commercialMeaningfulness: false,
                    strategicRoleValidity: false,
                    evidenceCompleteness: false,
                  },
                  defects: [
                    {
                      differentiationId: "diff_test_2",
                      code: "PRODUCT_TRUTH_UNSUPPORTED",
                      reason: "Still unverified",
                      rejectedFields: ["differentiationClaim"],
                      fixDirective: "Ground in product truth",
                    },
                  ],
                  overallVerdictRationale: "Repair candidate still unverified",
                }),
              },
            },
          ],
        });

      const miInput = { dominanceData: [], opportunitySignals: [] };
      const audInput = {
        painRegistry: mockInput.corePains,
        productTruthFacts: mockInput.productTruth,
        strategicLanes: mockInput.strategicLanes,
      };

      const result = await runDifferentiationEngine(miInput, audInput, {} as any, {
        accountId: "acct_test",
        campaignId: "camp_test",
      });

      expect(result.status).toBe("FAILED");
      expect(result.statusMessage).toContain("NO_SUPPORTED_DIFFERENTIATION");
      expect(result.differentiations).toEqual([]);
      expect(result.pillars).toEqual([]);
      expect(result.claimStructures).toEqual([]);
      expect(result.proofArchitecture).toEqual([]);
      expect(result.confidenceScore).toBe(0.0);
    });
  });

  describe("Successful Differentiation Contract", () => {
    it("generates evidence-grounded differentiation and populates proof architecture strictly from verified facts", async () => {
      vi.spyOn(aiModule, "aiChat")
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      differentiationClaim: "Premium fabric craftsmanship designed for durable, long-lasting modest wear",
                      distinctiveProperty: "Durable Modest Garment Craftsmanship",
                      buyerValue: "Assurance against premature garment wear and fabric deterioration",
                      mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
                      proofBoundary: "Verified premium fabric sourcing and multi-occasion construction",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_fact_fabrics"],
                    },
                  ],
                  painDispositions: [
                    { painId: "pain_fabric_quality", disposition: "ACCEPTED_DIFFERENTIATION" },
                  ],
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  valid: true,
                  assessmentsCompleted: true,
                  assessmentDetails: {
                    productFactualSupport: true,
                    competitiveFactualSupport: true,
                    audienceLaneRelevance: true,
                    commercialMeaningfulness: true,
                    strategicRoleValidity: true,
                    evidenceCompleteness: true,
                  },
                  defects: [],
                  overallVerdictRationale: "Fully supported by product truth Fact pt_fact_fabrics and aligned to lane tension.",
                }),
              },
            },
          ],
        });

      const miInput = {
        dominanceData: [
          {
            competitorId: "comp_1",
            competitorName: "Comp 1",
            canonicalFacts: [{ fact: "Fast-fashion volume model", factType: "COMPETITOR_FACT" }],
          },
        ],
        opportunitySignals: ["Modest fashion durability demand"],
      };
      const audInput = {
        painRegistry: mockInput.corePains,
        productTruthFacts: mockInput.productTruth,
        strategicLanes: mockInput.strategicLanes,
      };

      const result = await runDifferentiationEngine(miInput, audInput, {} as any, {
        accountId: "acct_test",
        campaignId: "camp_test",
        strategicLanes: mockInput.strategicLanes,
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.differentiations.length).toBe(1);
      expect(result.differentiations[0].isJudgeApproved).toBe(true);
      expect(result.pillars.length).toBe(1);
      expect(result.pillars[0].productTruthFactIds).toContain("pt_fact_fabrics");
      expect(result.proofArchitecture.length).toBeGreaterThan(0);
      const compProof = result.proofArchitecture.filter(p => p.type === "comparative_proof");
      expect(compProof.length).toBe(0);
    });

    it("handles COMMERCIAL_MEANINGFULNESS defect code without schema contract failure", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: false,
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: true,
                  competitiveFactualSupport: true,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: false,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [
                  {
                    differentiationId: "diff_1",
                    painId: "pain_fabric_quality",
                    code: "COMMERCIAL_MEANINGFULNESS",
                    reason: "Generic operational capabilities do not constitute distinct differentiation.",
                    rejectedFields: ["differentiationClaim"],
                    fixDirective: "Focus on verified core design.",
                  },
                ],
                overallVerdictRationale: "Candidate lacks commercial meaningfulness.",
              }),
            },
          },
        ],
      } as any);

      const candidate: DifferentiationCandidate = {
        differentiationId: "diff_1",
        corePainIds: ["pain_fabric_quality"],
        differentiationClaim: "Fast shipping and standard customer support",
        distinctiveProperty: "Customer service",
        buyerValue: "Reliable shopping",
        mechanismStatus: "NO_DISTINCT_MECHANISM_ESTABLISHED",
        mechanismName: null,
        proofBoundary: "Factually proven policies",
        strategicForm: "STRATEGIC_MARKET_EMPHASIS",
        productTruthFactIds: ["pt_fact_fabrics"],
        comparisonBaseline: { statement: "Competitor posture", miAuthorityIds: [], competitorIds: [] },
      };

      const result = await judgeDifferentiation(mockInput, [candidate]);
      expect(result.assessmentsCompleted).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.defects.length).toBe(1);
      expect(result.defects[0].code).toBe("COMMERCIAL_MEANINGFULNESS");
      expect(result.defects[0].reason).toContain("Generic operational capabilities");
    });

    it("deduplicates productTruthFactIds, locks Round 1 zero-defect candidates so Round 2 repair cannot overturn them, and strips self-contradictory unverified-guarantee demands", async () => {
      const twoPainInput = {
        painRegistry: [
          {
            painId: "pain_freshness_anxiety",
            canonical: "Customers experience anxiety over stale or spoiled baklava arriving after shipping",
            segmentId: "seg_1",
            fitType: "DIRECT_FIT",
            requiredCapability: "Daily fresh production and hygienic packaging",
            matchedProductCapability: "Produced daily in Gaziantep with hygienic packaging",
            productTruthFactIds: ["pt_daily_gaziantep", "pt_hygienic_pack", "pt_daily_gaziantep"],
          },
          {
            painId: "pain_ingredient_authenticity",
            canonical: "Buyers distrust artificial syrups and low-grade nuts in commercial baklava",
            segmentId: "seg_1",
            fitType: "DIRECT_FIT",
            requiredCapability: "100% Antep pistachio and pure butter without glucose",
            matchedProductCapability: "100% Antep pistachio, pure butter, zero glucose",
            productTruthFactIds: ["pt_antep_pistachio", "pt_pure_butter_no_glucose"],
          },
        ],
        productTruthFacts: [
          {
            productTruthFactId: "pt_daily_gaziantep",
            factType: "CAPABILITY",
            statement: "Produced fresh every day exclusively in Gaziantep, Turkey.",
          },
          {
            productTruthFactId: "pt_hygienic_pack",
            factType: "DELIVERY_MECHANISM",
            statement: "Packed under strict hygienic standards for nationwide delivery.",
          },
          {
            productTruthFactId: "pt_antep_pistachio",
            factType: "CAPABILITY",
            statement: "Crafted with 100% first-harvest Antep pistachio.",
          },
          {
            productTruthFactId: "pt_pure_butter_no_glucose",
            factType: "CAPABILITY",
            statement: "Made with pure clarified butter and natural sugar without glucose syrup.",
          },
        ],
        strategicLanes: [
          {
            laneId: "lane_authentic_freshness",
            laneName: "Authentic Gaziantep Craft & Freshness",
            strategicFocus: "Daily production and pure ingredients",
            memberPainIds: ["pain_freshness_anxiety", "pain_ingredient_authenticity"],
            primaryBuyerTension: "Fear of receiving stale or glucose-filled imitation baklava",
          },
        ],
      };

      const aiSpy = vi.spyOn(aiModule, "aiChat")
        // 1. Proposer Round 1: returns 2 candidates; Candidate 1 has duplicate fact IDs
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      differentiationId: "cand_1",
                      corePainIds: ["pain_freshness_anxiety"],
                      differentiationClaim: "Daily Gaziantep production paired with hygienic packaging",
                      distinctiveProperty: "Daily origin production + hygienic pack",
                      buyerValue: "Reduces risk of stale arrival",
                      mechanismStatus: "ESTABLISHED",
                      mechanismName: "Daily Origin Dispatch",
                      proofBoundary: "Verifies daily production and hygienic pack; does not guarantee carrier transit times",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_daily_gaziantep", "pt_daily_gaziantep", "pt_hygienic_pack"],
                    },
                    {
                      differentiationId: "cand_2",
                      corePainIds: ["pain_ingredient_authenticity"],
                      differentiationClaim: "100% Antep pistachio and pure butter formulation with zero glucose syrup",
                      distinctiveProperty: "Pure Antep ingredient standard",
                      buyerValue: "Eliminates artificial syrup aftertaste and ingredient deception",
                      mechanismStatus: "ESTABLISHED",
                      mechanismName: "Zero-Glucose Antep Formulation",
                      proofBoundary: "Verified ingredient composition",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_antep_pistachio", "pt_pure_butter_no_glucose"],
                    },
                  ],
                  painDispositions: [
                    { painId: "pain_freshness_anxiety", disposition: "ACCEPTED_DIFFERENTIATION" },
                    { painId: "pain_ingredient_authenticity", disposition: "ACCEPTED_DIFFERENTIATION" },
                  ],
                }),
              },
            },
          ],
        } as any)
        // 2. Judge Round 1: rejects cand_1 ONLY, approves cand_2 (0 defects on cand_2)
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  valid: false,
                  assessmentsCompleted: true,
                  assessmentDetails: {
                    productFactualSupport: true,
                    competitiveFactualSupport: true,
                    audienceLaneRelevance: true,
                    commercialMeaningfulness: false,
                    strategicRoleValidity: true,
                    evidenceCompleteness: true,
                  },
                  defects: [
                    {
                      differentiationId: "cand_1",
                      painId: "pain_freshness_anxiety",
                      code: "SPECIFICITY_LACKING",
                      reason: "Needs stronger articulation of how daily production + hygienic packaging mitigates buyer freshness anxiety.",
                      rejectedFields: ["differentiationClaim"],
                      fixDirective: "Connect daily production and hygienic packaging directly to freshness risk reduction.",
                    },
                  ],
                  overallVerdictRationale: "cand_2 has no defects; cand_1 needs clearer buyer tension linkage.",
                }),
              },
            },
          ],
        } as any)
        // 3. Repair Round 2: repairs cand_1
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      differentiationId: "cand_1",
                      corePainIds: ["pain_freshness_anxiety"],
                      differentiationClaim: "Daily Gaziantep production combined with hygienic packaging directly mitigates stale-arrival risk",
                      distinctiveProperty: "Integrated daily production and hygienic sealing",
                      buyerValue: "Gives buyers confidence in fresh arrival without unverified preservative claims",
                      mechanismStatus: "ESTABLISHED",
                      mechanismName: "Daily Origin Dispatch",
                      proofBoundary: "Proves daily production and hygienic packaging; does not claim laboratory mold-prevention guarantees",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_daily_gaziantep", "pt_hygienic_pack"],
                    },
                  ],
                  painDispositions: [
                    { painId: "pain_freshness_anxiety", disposition: "ACCEPTED_DIFFERENTIATION" },
                  ],
                }),
              },
            },
          ],
        } as any)
        // 4. Judge Round 2: emits self-contradictory COMMERCIAL_MEANINGFULNESS defect demanding unverified mold-prevention guarantee absent from ourProductFacts
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  valid: false,
                  assessmentsCompleted: true,
                  assessmentDetails: {
                    productFactualSupport: true,
                    competitiveFactualSupport: true,
                    audienceLaneRelevance: true,
                    commercialMeaningfulness: false,
                    strategicRoleValidity: true,
                    evidenceCompleteness: true,
                  },
                  defects: [
                    {
                      differentiationId: "cand_1",
                      painId: "pain_freshness_anxiety",
                      code: "COMMERCIAL_MEANINGFULNESS",
                      reason: "While grounded in product truth, it does not prove mold prevention.",
                      missingOrContradictedAuthority: "No explicit product truth fact or evidence verifies direct freshness guarantees or mold prevention mechanisms",
                      rejectedFields: ["differentiationClaim"],
                      fixDirective: "Provide explicit mold prevention guarantee.",
                    },
                  ],
                  overallVerdictRationale: "Missing explicit mold prevention guarantee in product truth.",
                }),
              },
            },
          ],
        } as any);

      const result = await runDifferentiationEngine(
        { dominanceData: [], opportunitySignals: [] },
        twoPainInput as any,
        {} as any,
        {
          accountId: "acct_test",
          campaignId: "camp_test",
          strategicLanes: twoPainInput.strategicLanes,
        }
      );

      expect(aiSpy).toHaveBeenCalledTimes(4);
      expect(result.status).toBe("SUCCESS");
      expect(result.differentiations.length).toBe(2);
      // Verify duplicate fact IDs on cand_1 were deduplicated
      const cand1 = result.differentiations.find(d => d.differentiationId === "cand_1")!;
      const cand2 = result.differentiations.find(d => d.differentiationId === "cand_2")!;
      expect(cand1.productTruthFactIds).toEqual(["pt_daily_gaziantep", "pt_hygienic_pack"]);
      expect(cand2.productTruthFactIds).toEqual(["pt_antep_pistachio", "pt_pure_butter_no_glucose"]);
      expect(cand1.isJudgeApproved).toBe(true);
      expect(cand2.isJudgeApproved).toBe(true);
    });
  });
});
