import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  filterAudienceTerritories,
  classifyTerritoryLevel,
  evaluateCompressionQuality,
  Territory
} from "../positioning-engine/engine";
import { judgeDifferentiation } from "../differentiation-engine/judge";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { CanonicalDifferentiationInput, DifferentiationCandidate } from "../differentiation-engine/types";
import * as aiModule from "../ai-client";

describe("Phase 8 — Differentiation & Positioning Engine Improvements", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Positioning Engine: Non-SaaS Noun Support", () => {
    it("accepts CPG and food product territories into systemLevel without SaaS-only rejection", () => {
      const cpgTerritories: Territory[] = [
        {
          name: "Curated Mixed Sweets Gift Box Selection",
          opportunityScore: 0.85,
          confidenceScore: 0.8,
          description: "Freshly packed assortment of premium authentic sweets",
        },
        {
          name: "Single-Origin Specialty Coffee Roast Pack",
          opportunityScore: 0.78,
          confidenceScore: 0.75,
          description: "Direct-trade craft roast beans with transparent batch sourcing",
        },
        {
          name: "Artisan Olive Oil Batch Offering",
          opportunityScore: 0.82,
          confidenceScore: 0.79,
          description: "Cold-pressed extra virgin harvest collection",
        },
      ];

      const { systemLevel, rejected } = filterAudienceTerritories(cpgTerritories);
      expect(rejected).toHaveLength(0);
      expect(systemLevel).toHaveLength(3);
      expect(systemLevel.map(t => t.name)).toEqual([
        "Curated Mixed Sweets Gift Box Selection",
        "Single-Origin Specialty Coffee Roast Pack",
        "Artisan Olive Oil Batch Offering",
      ]);
    });

    it("accepts Professional Services and Consulting territories into systemLevel", () => {
      const serviceTerritories: Territory[] = [
        {
          name: "Comprehensive Compliance Advisory Engagement",
          opportunityScore: 0.88,
          confidenceScore: 0.85,
          description: "Hands-on audit and strategic risk assessment",
        },
        {
          name: "Growth Strategy Assessment Program",
          opportunityScore: 0.8,
          confidenceScore: 0.78,
          description: "Direct consulting practice and execution roadmap",
        },
      ];

      const { systemLevel, rejected } = filterAudienceTerritories(serviceTerritories);
      expect(rejected).toHaveLength(0);
      expect(systemLevel).toHaveLength(2);
    });

    it("still strictly rejects pure audience emotion markers and data labels", () => {
      const pureAudienceTerritories: Territory[] = [
        {
          name: "Belonging Community and Empowerment (14 signals)",
          opportunityScore: 0.7,
          confidenceScore: 0.6,
          description: "Audience desire for belonging and acceptance",
        },
        {
          name: "Dominant intent: comparison-shopping and hesitation",
          opportunityScore: 0.65,
          confidenceScore: 0.55,
          description: "Buyer anxiety about cost and affordability",
        },
      ];

      const { systemLevel, rejected } = filterAudienceTerritories(pureAudienceTerritories);
      expect(systemLevel).toHaveLength(0);
      expect(rejected).toHaveLength(2);
    });

    it("classifies territory levels correctly for CPG, services, and audience emotions", () => {
      const cpg = classifyTerritoryLevel({
        name: "Authentic Confectionery Assortment Box",
        opportunityScore: 0.8,
        confidenceScore: 0.8,
        description: "Fresh craft sweets delivered direct",
        domainFailure: "mass production sweet offerings lack authentic regional recipes and fresh preparation",
      });
      expect(cpg.level).toBe("system");

      const svc = classifyTerritoryLevel({
        name: "Strategic Brand Advisory Practice",
        opportunityScore: 0.8,
        confidenceScore: 0.8,
        description: "Bespoke consulting engagement",
        domainFailure: "generic agency support lacks strategic accountability and direct partner execution",
      });
      expect(svc.level).toBe("system");

      const audience = classifyTerritoryLevel({
        name: "Anxiety and Longing for Belonging",
        opportunityScore: 0.5,
        confidenceScore: 0.5,
        description: "Feelings of isolation and need for community",
      });
      expect(audience.level).toBe("audience");
    });

    it("evaluates compression quality without penalizing CPG and service nouns", () => {
      const cpgScore = evaluateCompressionQuality({
        name: "Premium Pistachio Sweets Box Delivery",
        enemyDefinition: "stale warehouse confectioneries",
        narrativeDirection: "authentic fresh bakery craft offering",
        domainFailure: "mass market sweet boxes lack fresh packaging",
        opportunityScore: 0.85,
        confidenceScore: 0.8,
        description: "Handcrafted authentic Turkish confectionery gift boxes with same-day packaging",
      });
      expect(cpgScore).toBeGreaterThan(0.5);

      const svcScore = evaluateCompressionQuality({
        name: "Executive Advisory Consulting Program",
        enemyDefinition: "unaccountable advisory firms",
        narrativeDirection: "hands-on partner strategy service",
        domainFailure: "generic consultants lack execution support",
        opportunityScore: 0.8,
        confidenceScore: 0.8,
        description: "Specialized leadership strategy and risk audit practice",
      });
      expect(svcScore).toBeGreaterThan(0.5);
    });
  });

  describe("Differentiation Judge: Error Handling & Candidate ID Integrity", () => {
    const sampleInput: CanonicalDifferentiationInput = {
      lineage: {
        accountId: "acc_test",
        campaignId: "camp_test",
        jobId: "job_test",
        audienceSnapshotId: "aud_test",
        miSnapshotId: "mi_test",
      },
      corePains: [
        {
          painId: "pain_freshness",
          targetCoverageAuthorityId: "tc_1",
          productFitAuthorityId: "pf_1",
          coreDecisionId: "spd_1",
          canonicalPain: "Packaged sweets arrive stale and crushed during transit",
          segmentIds: ["seg_gift_buyers"],
          fitType: "DIRECT_FIT",
          requiredCapability: "Sturdy vacuum packaging and fresh daily preparation",
          matchedProductCapability: "Daily prepared batches with protective gift boxing",
          productTruthFactIds: ["pt_fresh_prep"],
        },
      ],
      productTruth: [
        {
          productTruthFactId: "pt_fresh_prep",
          factType: "DELIVERY_MECHANISM",
          fact: "All sweet boxes are prepared daily from fresh ingredients and sealed in protective food-grade packaging.",
        },
      ],
      ourProductFacts: [
        {
          productTruthFactId: "pt_fresh_prep",
          factType: "DELIVERY_MECHANISM",
          fact: "All sweet boxes are prepared daily from fresh ingredients and sealed in protective food-grade packaging.",
        },
      ],
      competitiveAuthority: [
        {
          miAuthorityId: "mi_comp_posture",
          competitorId: "comp_1",
          factType: "COMPETITOR_FACT",
          fact: "Competitor 1 ships pre-stocked shelf-stable confectioneries from regional 3PLs.",
          miSnapshotId: "mi_test",
          sourceScope: "OBSERVED_COMPETITOR",
        },
      ],
      miFacts: [
        {
          miAuthorityId: "mi_comp_posture",
          competitorId: "comp_1",
          factType: "COMPETITOR_FACT",
          fact: "Competitor 1 ships pre-stocked shelf-stable confectioneries from regional 3PLs.",
          miSnapshotId: "mi_test",
          sourceScope: "OBSERVED_COMPETITOR",
        },
      ],
      strategicLanes: [],
      marketContext: {},
    };

    const candidate: DifferentiationCandidate = {
      differentiationId: "diff_cand_123",
      corePainIds: ["pain_freshness"],
      differentiationClaim: "Daily-crafted sweets prepared on-demand with protective packaging",
      distinctiveProperty: "Fresh-batch preparation vs warehouse shelf storage",
      buyerValue: "Guarantees authentic bakery-fresh taste upon delivery",
      mechanismStatus: "ESTABLISHED",
      mechanismName: "Fresh-batch packing workflow",
      proofBoundary: "Verified daily baking and protective packing",
      strategicForm: "DOCUMENTED_COMPARATIVE_CONTRAST",
      productTruthFactIds: ["pt_fresh_prep"],
      comparisonBaseline: {
        statement: "Competitor relies on pre-stocked 3PL shelf inventory",
        miAuthorityIds: ["mi_comp_posture"],
        competitorIds: ["comp_1"],
      },
    };

    it("associates defects to candidate differentiationId on fatal LLM / JSON exception", async () => {
      vi.spyOn(aiModule, "aiChat").mockRejectedValueOnce(new Error("LLM Rate Limit"));

      const result = await judgeDifferentiation(sampleInput, [candidate]);
      expect(result.valid).toBe(false);
      expect(result.defects).toHaveLength(1);
      expect(result.defects[0].differentiationId).toBe("diff_cand_123");
      expect(result.defects[0].reason).toContain("Judge execution exception: LLM Rate Limit");
    });

    it("associates defects to candidate differentiationId when judge response fails schema validation", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                malformed_key: true,
              }),
            },
          },
        ],
      } as any);

      const result = await judgeDifferentiation(sampleInput, [candidate]);
      expect(result.valid).toBe(false);
      expect(result.defects).toHaveLength(1);
      expect(result.defects[0].differentiationId).toBe("diff_cand_123");
      expect(result.defects[0].code).toBe("SPECIFICITY_LACKING");
    });

    it("forces valid=false and preserves differentiationId when contradiction occurs", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                valid: true, // Contradiction: valid=true but productFactualSupport is false
                assessmentsCompleted: true,
                assessmentDetails: {
                  productFactualSupport: false,
                  competitiveFactualSupport: true,
                  audienceLaneRelevance: true,
                  commercialMeaningfulness: true,
                  strategicRoleValidity: true,
                  evidenceCompleteness: true,
                },
                defects: [],
                overallVerdictRationale: "Looks good overall",
              }),
            },
          },
        ],
      } as any);

      const result = await judgeDifferentiation(sampleInput, [candidate]);
      expect(result.valid).toBe(false);
      expect(result.defects.length).toBeGreaterThan(0);
      expect(result.defects[0].differentiationId).toBe("diff_cand_123");
      expect(result.defects[0].code).toBe("CAPABILITY_NOT_DIFFERENTIATION");
    });
  });

  describe("Differentiation Engine: Strategic Market Emphasis & Repair Loop", () => {
    it("successfully runs differentiation engine with Strategic Market Emphasis when competitor negatives are absent", async () => {
      const mockMi = {
        dominanceData: [],
        competitors: [
          {
            competitorId: "comp_sweets_co",
            competitorName: "Sweets Co",
            intentType: "DEFENSIVE",
          },
        ],
        opportunitySignals: ["Demand for premium gift assortments"],
      };

      const mockAud = {
        painRegistry: [
          {
            painId: "pain_authentic_recipe",
            classification: "CORE_PURCHASE",
            canonical: "Customers struggle to find authentic regional recipes made with real pistachio",
            targetAssessmentAuthorityId: "ta_rec",
            productAssessmentAuthorityId: "pa_rec",
            strategicPainDecisionAuthorityId: "spd_rec",
            matchedProductCapability: "Traditional Gaziantep recipes with 100% Antep pistachios",
            productTruthFactIds: ["pt_fact_pistachio"],
          },
        ],
        productTruthFacts: [
          {
            productTruthFactId: "pt_fact_pistachio",
            factType: "CAPABILITY",
            statement: "Confectioneries are made strictly with 100% Antep pistachios and clarified butter.",
          },
        ],
      };

      // Mock Proposer returning valid STRATEGIC_MARKET_EMPHASIS candidate
      vi.spyOn(aiModule, "aiChat")
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  differentiations: [
                    {
                      corePainIds: ["pain_authentic_recipe"],
                      differentiationClaim: "Anchored on 100% Antep pistachio heritage recipes without artificial substitutes",
                      distinctiveProperty: "Pure authentic ingredients with documented sourcing",
                      buyerValue: "Assurance of authentic taste for discerning gifters",
                      mechanismStatus: "ESTABLISHED",
                      mechanismName: "Authentic ingredient sourcing commitment",
                      proofBoundary: "Verified 100% Antep pistachio usage",
                      strategicForm: "STRATEGIC_MARKET_EMPHASIS",
                      productTruthFactIds: ["pt_fact_pistachio"],
                      comparisonBaseline: {
                        statement: "Focuses on verified ingredient integrity without unverified claims about competitors",
                        miAuthorityIds: [],
                        competitorIds: [],
                      },
                    },
                  ],
                  painDispositions: [
                    {
                      painId: "pain_authentic_recipe",
                      disposition: "ACCEPTED_DIFFERENTIATION",
                    },
                  ],
                }),
              },
            },
          ],
        } as any)
        // Mock Judge approving candidate
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
                  overallVerdictRationale: "Approved Strategic Market Emphasis strictly grounded in verified ingredient truth",
                }),
              },
            },
          ],
        } as any);

      const result = await runDifferentiationEngine(mockMi as any, mockAud as any, {} as any);
      expect(result.status).toBe("SUCCESS");
      expect(result.differentiations).toHaveLength(1);
      expect(result.differentiations[0].strategicForm).toBe("STRATEGIC_MARKET_EMPHASIS");
      expect(result.differentiations[0].isJudgeApproved).toBe(true);
      expect(result.pillars).toHaveLength(1);
      expect(result.painDispositions[0].disposition).toBe("ACCEPTED_DIFFERENTIATION");
    });
  });
});
