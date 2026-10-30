import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeProductTruthHash,
  runProductAssessmentForPain,
  canReuseProductAssessment,
  type ProductAssessmentInput,
} from "../strategic-reasoning/product-assessment";
import {
  refineAudiencePainRegistry,
} from "../shared/pain-classifier";
import * as aiClient from "../ai-client";

describe("Phase 7: Audience Assessments & Product Truth Grounding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Product Assessment Authority & Fact Normalization", () => {
    it("computes deterministic product truth hash across varied fact shapes (CPG, SaaS, Services)", () => {
      const cpgFacts = [
        { factId: "fact_1", sourceField: "ingredients", rawValue: "100% pure cold-pressed extra virgin olive oil" },
        { factId: "fact_2", sourceField: "packaging", rawValue: "500ml dark glass bottle UV protected" },
      ];

      const saasFacts = [
        { productTruthFactId: "pt_saas_1", statement: "SOC2 Type II certified with real-time audit logging" },
        { productTruthFactId: "pt_saas_2", verifiedCapability: "Single sign-on via SAML 2.0 and Okta integration" },
      ];

      const hash1 = computeProductTruthHash(cpgFacts);
      const hash2 = computeProductTruthHash(cpgFacts);
      const hashSaas = computeProductTruthHash(saasFacts);

      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBe(16);
      expect(hash1).toBe(hash2);
      expect(hashSaas.length).toBe(16);
      expect(hashSaas).not.toBe(hash1);
    });

    it("fails closed when required authority inputs are missing", async () => {
      const incompleteInput: ProductAssessmentInput = {
        painId: "",
        canonicalPain: "High subscription price",
        campaignOfferingId: "",
        businessUnderstandingAuthorityId: "",
        productTruthFacts: [],
        accountId: "acc_1",
        campaignId: "camp_1",
        jobId: "job_1",
      };

      const result = await runProductAssessmentForPain(incompleteInput);
      expect(result.status).toBe("INCOMPLETE");
      expect(result.fitType).toBe("UNKNOWN");
      expect(result.reason).toContain("Missing required");
    });

    it("evaluates DIRECT_FIT when offering facts directly address audience pain", async () => {
      vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT",
                reason: "Native Okta SAML 2.0 directly satisfies the enterprise SSO requirement.",
                requirementBreakdown: [
                  {
                    requirement: "SAML 2.0 Okta integration",
                    status: "SUPPORTED",
                    evidenceFactIds: ["fact_sso_1"],
                    notes: "Direct verified capability match",
                  },
                ],
              }),
            },
          },
        ],
      } as any);

      const saasInput: ProductAssessmentInput = {
        painId: "pain_saml_compliance",
        canonicalPain: "Cannot adopt platform because enterprise requires Okta SAML SSO compliance",
        campaignOfferingId: "off_enterprise_saas",
        businessUnderstandingAuthorityId: "bu_auth_001",
        productTruthFacts: [
          {
            factId: "fact_sso_1",
            statement: "Native Okta and Azure AD SAML 2.0 SSO integration supported on all enterprise plans",
            verifiedCapability: "Enterprise SAML 2.0 Identity Provider Integration",
          },
        ],
        accountId: "acc_test",
        campaignId: "camp_test",
        jobId: "job_test_001",
      };

      const result = await runProductAssessmentForPain(saasInput);
      expect(result.status).toBe("COMPLETE");
      expect(result.fitType).toBe("DIRECT_FIT");
      expect(result.productAssessmentAuthorityId).toBe("pa_job_test_001_pain_saml_compliance");
      expect(result.parentAuthorityIds).toContain("bu_auth_001");
      expect(result.parentAuthorityIds).toContain("fact_sso_1");
    });

    it("evaluates NOT_FIT when offering facts contradict or cannot solve the pain", async () => {
      vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitType: "NOT_FIT",
                reason: "Assortment contains tree nuts and is processed on equipment with almonds; cannot resolve allergy friction.",
                requirementBreakdown: [
                  {
                    requirement: "Nut-free facility",
                    status: "CONTRADICTED",
                    evidenceFactIds: ["fact_nuts_1"],
                    notes: "Direct contradiction with product allergen warning",
                  },
                ],
              }),
            },
          },
        ],
      } as any);

      const cpgInput: ProductAssessmentInput = {
        painId: "pain_nut_allergy",
        canonicalPain: "Severe pistachio and peanut allergy makes shared facility products unsafe",
        campaignOfferingId: "off_traditional_sweets",
        businessUnderstandingAuthorityId: "bu_auth_002",
        productTruthFacts: [
          {
            factId: "fact_nuts_1",
            statement: "Assortment contains antep pistachios, walnuts, and is processed on equipment with almonds",
            verifiedCapability: "Artisanal sweet production",
          },
        ],
        accountId: "acc_test",
        campaignId: "camp_test",
        jobId: "job_test_002",
      };

      const result = await runProductAssessmentForPain(cpgInput);
      expect(result.status).toBe("COMPLETE");
      expect(result.fitType).toBe("NOT_FIT");
      expect(result.reason.length).toBeGreaterThan(5);
    });

    it("supports reusing existing valid same-job product assessment", async () => {
      const existing = {
        productAssessmentAuthorityId: "pa_job_reuse_pain_1",
        status: "COMPLETE",
        fitType: "DIRECT_FIT" as const,
        jobId: "job_reuse",
        accountId: "acc_reuse",
        campaignId: "camp_reuse",
        painId: "pain_1",
        campaignOfferingId: "off_reuse",
        productTruthFactIds: ["fact_reuse_1"],
        reason: "Previously verified direct capability match",
      };

      const input: ProductAssessmentInput = {
        painId: "pain_1",
        canonicalPain: "Need export to CSV",
        campaignOfferingId: "off_reuse",
        businessUnderstandingAuthorityId: "bu_reuse",
        productTruthFacts: [
          { factId: "fact_reuse_1", statement: "Full CSV and JSON data export included" },
        ],
        accountId: "acc_reuse",
        campaignId: "camp_reuse",
        jobId: "job_reuse",
        existingAssessment: existing,
      };

      const result = await runProductAssessmentForPain(input);
      expect(result.productAssessmentAuthorityId).toBe("pa_job_reuse_pain_1");
      expect(result.fitType).toBe("DIRECT_FIT");
      expect(result.reason).toContain("Previously verified");
    });

    it("canReuseProductAssessment helper correctly handles matching and mismatched inputs", () => {
      const existing = {
        productAssessmentAuthorityId: "pa_1",
        status: "COMPLETE",
        fitType: "DIRECT_FIT",
        jobId: "j1",
        accountId: "a1",
        campaignId: "c1",
        painId: "p1",
        campaignOfferingId: "co1",
        productTruthFactIds: ["f1"],
        productTruthHash: "hash_current",
      };

      const targetPain = {
        painId: "p1",
        canonicalPain: "Some pain",
      };

      expect(canReuseProductAssessment(existing, targetPain, "hash_current", { jobId: "j1", accountId: "a1", campaignId: "c1", campaignOfferingId: "co1" })).toBe(true);
      // Mismatched offering ID
      expect(canReuseProductAssessment(existing, targetPain, "hash_current", { jobId: "j1", accountId: "a1", campaignId: "c1", campaignOfferingId: "co_different" })).toBe(false);
      // Mismatched truth hash
      expect(canReuseProductAssessment(existing, targetPain, "hash_different", { jobId: "j1", accountId: "a1", campaignId: "c1", campaignOfferingId: "co1" })).toBe(false);
    });
  });

  describe("Pain Classifier Integration with Product Truth", () => {
    it("refineAudiencePainRegistry preserves and attributes product assessment authority", async () => {
      // Mock aiChat for fidelity, target assessment, product assessment, and SPD
      vi.spyOn(aiClient, "aiChat").mockImplementation(async (params: any) => {
        const content = params.messages?.[0]?.content || "";
        if (content.includes("Pain Fidelity Judge") || content.includes("FAITHFUL")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "FAITHFUL",
                    canonical: "Users struggle with high latency when generating monthly reports",
                    critique: "Accurate reflection of negative customer friction",
                  }),
                },
              },
            ],
          } as any;
        }
        if (content.includes("Product Assessment Engine")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    fitType: "DIRECT_FIT",
                    reason: "In-memory columnar query engine directly provides sub-second reporting.",
                  }),
                },
              },
            ],
          } as any;
        }
        if (content.includes("Target Assessment Engine")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    decision: "COVERED",
                    reason: "Engineering Lead is responsible for performance and reporting.",
                  }),
                },
              },
            ],
          } as any;
        }
        if (content.includes("Strategic Pain Decision Judge")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    finalClassification: "CORE_PURCHASE",
                    reason: "Core operational friction motivating purchase.",
                  }),
                },
              },
            ],
          } as any;
        }
        return {
          choices: [{ message: { content: "{}" } }],
        } as any;
      });

      const mockPain = {
        painId: "pain_test_attr",
        canonical: "Users struggle with high latency when generating monthly reports",
        frequency: 12,
        rank: 1,
        evidence: ["Export takes 10 minutes"],
        evidenceUids: ["EV:market_voice_quote:market_voice_evidence:mv_001@123456789abc"],
        classification: "SUPPORTING" as const,
        productFit: "UNKNOWN" as const,
        eligible: true,
        allowedUses: ["CONTENT_TOPIC"],
        prohibitedUses: [],
      };

      const buMock = {
        businessUnderstandingAuthorityId: "bu_snap_001",
        campaignOfferingId: "off_analytics_001",
        campaignOffering: {
          id: "off_analytics_001",
          offeringName: "Real-time Reporting Engine",
          productTruthFacts: [
            {
              factId: "fact_rt_1",
              statement: "Sub-second report generation using in-memory columnar engine",
              verifiedCapability: "Ultra-low latency query engine",
            },
          ],
        },
        targetUnderstanding: {
          targetUnderstandingAuthorityId: "tu_snap_001",
          targetRoles: [{ roleTitle: "Engineering Lead" }],
        },
      };

      const result = await refineAudiencePainRegistry([mockPain as any], {
        accountId: "acc_test_refine",
        campaignId: "camp_test_refine",
        jobId: "job_test_refine",
        businessUnderstanding: buMock,
        atomicityJudge: async () => ({
          verdict: "ATOMIC",
          action: "KEEP",
        }),
      });

      expect(result.registry.length).toBeGreaterThan(0);
      const refinedPain = result.registry[0];
      expect(refinedPain.businessUnderstandingAuthorityId).toBe("bu_snap_001");
      expect(refinedPain.campaignOfferingId).toBe("off_analytics_001");
      expect(refinedPain.targetUnderstandingAuthorityId).toBe("tu_snap_001");
      expect(refinedPain.productAssessmentAuthorityId).toBe("pa_job_test_refine_pain_test_attr");
      expect(refinedPain.fitType).toBe("DIRECT_FIT");
    });
  });
});
