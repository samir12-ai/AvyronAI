import { describe, it, expect, vi } from "vitest";

// Mock aiChat before imports
vi.mock("../ai-client", () => ({
  aiChat: vi.fn(async (opts: any) => {
    const prompt = (opts.messages || []).map((m: any) => m.content).join("\n");
    const endpoint = opts.endpoint || "";

    // 1. Audience Judge Mock
    if (endpoint.includes("audience-engine-v3-judge") || prompt.includes("Semantic Audience Judge")) {
      if (prompt.includes("conjoined") || prompt.includes("pricing and sizing") || prompt.includes("refunds and defective items")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdicts: [{
                  claimId: "seg_1_pain_compound",
                  status: "INVALID",
                  rejectionCode: "COMPOUND_PAIN",
                  critique: "This pain combines multiple independently actionable problems with different capability requirements or lifecycle stages.",
                  repairDirective: "Split this compound claim into separate, evidence-grounded atomic claims under splitClaims."
                }]
              })
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdicts: [{
                claimId: "seg_1_pain_atomic",
                status: "VALID"
              }]
            })
          }
        }]
      };
    }

    // 2. Product Assessment Mock
    if (endpoint.includes("product-assessment") || prompt.includes("Product Assessment Engine")) {
      if (prompt.includes("multi-cloud failover") || prompt.includes("complex manual zero-downtime")) {
        // Multi-clause pain where only 1 of 3 is supported -> STRATEGIC_FIT
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                fitType: "STRATEGIC_FIT",
                reason: "Offering directly addresses slow query indexing but does not provide multi-cloud failover or zero-downtime migration capabilities."
              })
            }
          }]
        };
      }
      if (prompt.includes("slow database queries without automated indexing")) {
        // Full direct fit
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT",
                reason: "Offering directly provides automated slow query indexing recommendations."
              })
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              fitType: "STRATEGIC_FIT",
              reason: "Partially supported."
            })
          }
        }]
      };
    }

    // 3. Strategic Pain Decision Judge Mock
    if (endpoint.includes("strategic-pain-judge") || prompt.includes("Strategic Pain Decision Judge")) {
      if (prompt.includes("prefer Slack over email")) {
        // Secondary friction with DIRECT_FIT -> SUPPORTING
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                finalClassification: "SUPPORTING",
                reason: "Direct fit on notification integration, but alert delivery channel preference is a secondary friction rather than a primary purchase-driving constraint."
              })
            }
          }]
        };
      }
      if (prompt.includes("Production database outages")) {
        // Severe primary bottleneck -> CORE_PURCHASE
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                finalClassification: "CORE_PURCHASE",
                reason: "Production outages causing direct revenue loss represent a decisive primary commercial bottleneck directly addressable by the offering."
              })
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              finalClassification: "SUPPORTING",
              reason: "Supporting messaging."
            })
          }
        }]
      };
    }

    return { choices: [{ message: { content: "{}" } }] };
  })
}));

import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";

describe("Compound Pain Semantic Hardening & Contract Invariants", () => {
  const saasProductTruthFacts = [
    {
      productTruthFactId: "fact_saas_1",
      factType: "CAPABILITY",
      statement: "Automated real-time PostgreSQL database performance monitoring and slow query indexing recommendations",
      sourceEvidenceId: "ev_saas_1",
      authorityClass: "CANONICAL_PRODUCT_TRUTH"
    },
    {
      productTruthFactId: "fact_saas_2",
      factType: "CAPABILITY",
      statement: "Automated alerts sent via Slack and PagerDuty when query execution exceeds latency thresholds",
      sourceEvidenceId: "ev_saas_2",
      authorityClass: "CANONICAL_PRODUCT_TRUTH"
    }
  ];

  // Test C: Product Assessment Partial Match
  it("Test C: Compound pain with 1-of-3 supported capabilities must NOT receive DIRECT_FIT", async () => {
    const result = await runProductAssessmentForPain({
      painId: "test_c_compound_pain",
      canonicalPain: "Slow database queries degrading app performance, complex manual zero-downtime database schema migrations, and lack of automated multi-cloud failover",
      campaignOfferingId: "off_test_saas",
      businessUnderstandingAuthorityId: "bu_test_saas",
      productTruthFacts: saasProductTruthFacts,
      accountId: "acc_test",
      campaignId: "camp_test",
      jobId: "job_test_c"
    });

    // Invariant: If only a subset of a compound claim is directly addressed, the offering cannot receive DIRECT_FIT
    expect(result.fitType).not.toBe("DIRECT_FIT");
    expect(result.fitType).toBe("STRATEGIC_FIT");
  });

  // Test D: Full Direct Fit
  it("Test D: Coherent pain where Product Truth genuinely addresses the full requirement receives DIRECT_FIT", async () => {
    const result = await runProductAssessmentForPain({
      painId: "test_d_atomic_pain",
      canonicalPain: "Engineers spend hours debugging slow database queries without automated indexing recommendations",
      campaignOfferingId: "off_test_saas",
      businessUnderstandingAuthorityId: "bu_test_saas",
      productTruthFacts: saasProductTruthFacts,
      accountId: "acc_test",
      campaignId: "camp_test",
      jobId: "job_test_d"
    });

    // Invariant: Genuine full capability match yields DIRECT_FIT
    expect(result.fitType).toBe("DIRECT_FIT");
  });

  // Test E: Direct Fit Does Not Guarantee CORE
  it("Test E: DIRECT_FIT does not mechanically imply CORE_PURCHASE when evidence/context indicates secondary friction", async () => {
    const testJobId = "job_test_e";
    const painId = "test_e_secondary_pain";
    const spd = await judgeStrategicPainDecision({
      jobId: testJobId,
      painId,
      targetUnderstandingAuthorityId: "tu_test",
      productTruthFactIds: ["fact_saas_2"],
      campaignOfferingId: "off_test_saas",
      targetAssessmentAuthorityId: `ta_${testJobId}_${painId}`,
      productAssessmentAuthorityId: `pa_${testJobId}_${painId}`,
      targetAssessmentParentAuthorityIds: ["tu_test", painId],
      productAssessmentParentAuthorityIds: ["bu_test_saas", "off_test_saas", painId],
      targetAssessmentJobId: testJobId,
      productAssessmentJobId: testJobId,
      painClaim: "Engineers prefer Slack over email for alert delivery",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materialityContext: {
        citationCount: 2,
        evidenceUids: ["ev_1", "ev_2"],
        sourceTypes: ["review"],
        evidenceSummaries: ["Users noted they like Slack alerts more than email notifications."]
      },
      accountId: "acc_test",
      campaignId: "camp_test"
    });

    // Invariant: DIRECT_FIT + COVERED does not mechanically force CORE_PURCHASE
    expect(["SUPPORTING", "EXCLUDE"]).toContain(spd.finalClassification);
    expect(spd.finalClassification).toBe("SUPPORTING");
  });

  // Test F: Purchase Lifecycle & Strategic Priority
  it("Test F: SPD evaluates primary buying constraints and can award CORE_PURCHASE when justified by commercial consequence", async () => {
    const testJobId = "job_test_f";
    const painId = "test_f_core_pain";
    const spd = await judgeStrategicPainDecision({
      jobId: testJobId,
      painId,
      targetUnderstandingAuthorityId: "tu_test",
      productTruthFactIds: ["fact_saas_1"],
      campaignOfferingId: "off_test_saas",
      targetAssessmentAuthorityId: `ta_${testJobId}_${painId}`,
      productAssessmentAuthorityId: `pa_${testJobId}_${painId}`,
      targetAssessmentParentAuthorityIds: ["tu_test", painId],
      productAssessmentParentAuthorityIds: ["bu_test_saas", "off_test_saas", painId],
      targetAssessmentJobId: testJobId,
      productAssessmentJobId: testJobId,
      painClaim: "Production database outages caused by unindexed slow queries costing thousands per hour in downtime",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      materialityContext: {
        citationCount: 15,
        evidenceUids: ["ev_1", "ev_2", "ev_3", "ev_4", "ev_5"],
        sourceTypes: ["review", "case_study"],
        evidenceSummaries: ["Critical unindexed query spikes take down checkout during peak hours, causing immediate lost revenue."]
      },
      accountId: "acc_test",
      campaignId: "camp_test"
    });

    // Invariant: Severe operational bottleneck directly addressed by the product can anchor CORE_PURCHASE
    expect(spd.finalClassification).toBe("CORE_PURCHASE");
  });

  // Test G: Canonical Product Truth Structure
  it("Test G: Product Assessment requires array of structured Product Truth facts and fails closed if missing", async () => {
    const incompleteRes = await runProductAssessmentForPain({
      painId: "test_g_pain",
      canonicalPain: "Any customer pain",
      campaignOfferingId: "",
      businessUnderstandingAuthorityId: "",
      productTruthFacts: [] as any[],
      accountId: "acc_test",
      campaignId: "camp_test",
      jobId: "job_test_g"
    });

    // Invariant: Fails closed to UNKNOWN when canonical facts are absent
    expect(incompleteRes.fitType).toBe("UNKNOWN");
    expect(incompleteRes.status).toBe("INCOMPLETE");
  });
});
