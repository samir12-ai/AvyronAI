import { describe, it, expect, vi, beforeEach } from "vitest";

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

    // 2. Final Pain Atomicity Judge & Repair Mock
    if (endpoint === "final-pain-atomicity-judge" || endpoint === "final-pain-atomicity-repair") {
      // Test A: Inconsistent COMPOUND_PAIN + KEEP -> repair to SPLIT
      if (prompt.includes("INCONSISTENT_COMPOUND_KEEP")) {
        if (endpoint === "final-pain-atomicity-repair") {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  verdict: "COMPOUND_PAIN",
                  action: "SPLIT",
                  critique: "Repaired: split into two distinct capability claims.",
                  splitClaims: [
                    { claim: "First distinct problem", evidenceIds: ["EV_1"] },
                    { claim: "Second distinct problem", evidenceIds: ["EV_2"] }
                  ]
                })
              }
            }]
          };
        }
        // Initial invalid proposal: COMPOUND_PAIN + KEEP
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "KEEP",
                critique: "Invalid compound with keep"
              })
            }
          }]
        };
      }

      // Test B: Inconsistent ATOMIC + SPLIT -> repair to KEEP
      if (prompt.includes("INCONSISTENT_ATOMIC_SPLIT")) {
        if (endpoint === "final-pain-atomicity-repair") {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  verdict: "ATOMIC",
                  action: "KEEP",
                  critique: "Repaired: single coherent problem."
                })
              }
            }]
          };
        }
        // Initial invalid proposal: ATOMIC + SPLIT
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "ATOMIC",
                action: "SPLIT",
                critique: "Invalid atomic with split",
                splitClaims: [{ claim: "Sub", evidenceIds: ["EV_1"] }]
              })
            }
          }]
        };
      }

      // Test C1: Valid REPLACE with atomic replacement
      if (prompt.includes("VALID_REPLACE_TARGET")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "REPLACE",
                critique: "Refined to single atomic core issue",
                repairedClaim: "Focused single atomic customer problem"
              })
            }
          }]
        };
      }

      // Test C2: Invalid REPLACE with still-compound replacement
      if (prompt.includes("STILL_COMPOUND_REPLACE_TARGET")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "REPLACE",
                critique: "Tried to replace but gave another compound statement",
                repairedClaim: "Still compound: bad quality and unresponsive support"
              })
            }
          }]
        };
      }

      // Exhaustion mock
      if (prompt.includes("EXHAUST_REPAIR_FAIL")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "KEEP",
                critique: "Repeatedly invalid"
              })
            }
          }]
        };
      }

      // Multi-attribute product pain -> SPLIT
      if (prompt.includes("budget-friendly") && prompt.includes("natural fabrics") && prompt.includes("hot weather")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "SPLIT",
                critique: "Combines general budget/affordability constraints with specific natural fabric material requirements and hot-weather climate comfort.",
                splitClaims: [
                  {
                    claim: "Scarcity of budget-friendly modest apparel options",
                    evidenceIds: ["EV_BUDGET_1"]
                  },
                  {
                    claim: "Difficulty finding modest clothing in breathable natural fabrics like linen or cotton",
                    evidenceIds: ["EV_FABRIC_1", "EV_FABRIC_2"]
                  }
                ]
              })
            }
          }]
        };
      }

      // Cross-lifecycle pain -> SPLIT
      if (prompt.includes("cheaply made") && prompt.includes("customer service") && prompt.includes("refund")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "SPLIT",
                critique: "Conjoins product quality defects with post-purchase customer service and refund friction.",
                splitClaims: [
                  {
                    claim: "Received garments that are cheaply made or see-through",
                    evidenceIds: ["EV_QUALITY_1"]
                  },
                  {
                    claim: "Unresponsive customer service when resolving order disputes and refund requests",
                    evidenceIds: ["EV_REFUND_1"]
                  }
                ]
              })
            }
          }]
        };
      }

      // Coherent domain-neutral multi-attribute pain -> KEEP
      if (prompt.includes("database lock contention") || prompt.includes("Slow database queries without automated indexing")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "ATOMIC",
                action: "KEEP",
                critique: "Single coherent causal problem regarding slow queries lacking indexing recommendations."
              })
            }
          }]
        };
      }

      // Default ATOMIC + KEEP
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdict: "ATOMIC",
              action: "KEEP",
              critique: "Coherent atomic customer problem."
            })
          }
        }]
      };
    }

    // 2b. Final Pain Atomicity Revalidation Mock
    if (endpoint === "final-pain-atomicity-revalidation") {
      if (prompt.includes("Still compound: bad quality and unresponsive support")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "COMPOUND_PAIN",
                action: "SPLIT",
                critique: "Revalidation rejected: candidate replacement is still compound"
              })
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdict: "ATOMIC",
              action: "KEEP",
              critique: "Revalidation accepted: candidate replacement is atomic"
            })
          }
        }]
      };
    }

    // 3. Merged Claim Revalidation Mock
    if (endpoint.includes("audience-engine-v3-merged-claim-revalidation") || prompt.includes("Audience Merged-Claim Evidence Revalidation")) {
      if (prompt.includes("cheaply made") && prompt.includes("refund")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                status: "INVALID",
                canMerge: false,
                critique: "Rejected: Conjoins product quality defect with post-purchase refund customer service."
              })
            }
          }]
        };
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              status: "VALID",
              canMerge: true
            })
          }
        }]
      };
    }

    // 4. Pain Fidelity Judge Mock
    if (endpoint.includes("pain-fidelity-judge") || prompt.includes("Hostile Audience Pain Fidelity Judge")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdict: "FAITHFUL",
              critique: "Claim is directly supported by cited evidence."
            })
          }
        }]
      };
    }

    // 5. Product Assessment Mock
    if (endpoint.includes("product-assessment") || prompt.includes("Product Assessment Engine")) {
      if (prompt.includes("multi-cloud failover") || prompt.includes("complex manual zero-downtime")) {
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
      if (prompt.includes("slow database queries") || prompt.includes("breathable natural fabrics") || prompt.includes("cheaply made or see-through") || prompt.includes("Focused single atomic")) {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                fitType: "DIRECT_FIT",
                reason: "Offering directly provides validated capabilities addressing this atomic problem."
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

    // 6. Target Assessment Mock
    if (endpoint.includes("target-assessment") || prompt.includes("Target Assessment")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              decision: "COVERED",
              reason: "Discovered audience role legitimately matches verified target roles."
            })
          }
        }]
      };
    }

    // 7. Strategic Pain Decision Judge Mock
    if (endpoint.includes("strategic-pain-judge") || prompt.includes("Strategic Pain Decision Judge")) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              finalClassification: "CORE_PURCHASE",
              reason: "Primary commercial bottleneck directly addressable by offering."
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
import {
  validateAndApplySplitClaim,
  judgeAndRepairFinalPainAtomicityWithLLM,
  refineFinalPainAtomicityRegistry,
  extractPairedEvidence,
  buildAtomicityPrompt
} from "../shared/pain-atomicity";
import { consolidateSegmentPainsSemantic } from "../audience-engine/engine";
import { refineAudiencePainRegistry } from "../shared/pain-classifier";
import { aiChat } from "../ai-client";

describe("Authoritative Pain Atomicity Restoration & Hardening", () => {

  // Test A: COMPOUND_PAIN + KEEP is rejected and repaired
  it("Test A — STRICT CONSISTENCY: Inconsistent COMPOUND_PAIN + KEEP is rejected and repaired to valid SPLIT", async () => {
    const result = await judgeAndRepairFinalPainAtomicityWithLLM({
      painClaim: "INCONSISTENT_COMPOUND_KEEP: conjoining multiple capabilities without action",
      painId: "pain_inconsistent_1",
      evidenceUids: ["EV_1", "EV_2"],
      evidenceTexts: ["Quote 1", "Quote 2"],
      accountId: "acc_test",
    });

    expect(result.verdict).toBe("COMPOUND_PAIN");
    expect(result.action).toBe("SPLIT");
    expect(result.splitClaims).toHaveLength(2);
  });

  // Test B: ATOMIC + SPLIT is rejected and repaired
  it("Test B — STRICT CONSISTENCY: Inconsistent ATOMIC + SPLIT is rejected and repaired to valid KEEP", async () => {
    const result = await judgeAndRepairFinalPainAtomicityWithLLM({
      painClaim: "INCONSISTENT_ATOMIC_SPLIT: single coherent issue misclassified with split action",
      painId: "pain_inconsistent_2",
      evidenceUids: ["EV_1"],
      evidenceTexts: ["Quote 1"],
      accountId: "acc_test",
    });

    expect(result.verdict).toBe("ATOMIC");
    expect(result.action).toBe("KEEP");
  });

  // Test C: REPLACE result is revalidated before downstream authority
  it("Test C1 — REPLACE REVALIDATION: Valid atomic replacement is accepted after revalidation", async () => {
    const result = await judgeAndRepairFinalPainAtomicityWithLLM({
      painClaim: "VALID_REPLACE_TARGET: multi-issue claim refined to single core problem",
      painId: "pain_replace_valid",
      evidenceUids: ["EV_1"],
      evidenceTexts: ["Quote 1"],
      accountId: "acc_test",
    });

    expect(result.verdict).toBe("COMPOUND_PAIN");
    expect(result.action).toBe("REPLACE");
    expect(result.repairedClaim).toBe("Focused single atomic customer problem");
  });

  it("Test C2 — REPLACE REVALIDATION: Still-compound replacement fails revalidation and exhausts to ATOMICITY_INCOMPLETE", async () => {
    const result = await judgeAndRepairFinalPainAtomicityWithLLM({
      painClaim: "STILL_COMPOUND_REPLACE_TARGET: multi-issue claim with bad replacement",
      painId: "pain_replace_bad",
      evidenceUids: ["EV_1"],
      evidenceTexts: ["Quote 1"],
      accountId: "acc_test",
    });

    expect(result.verdict).toBe("ATOMICITY_INCOMPLETE");
  });

  // Test D: Evidence IDs remain aligned with exact evidence text after missing evidence filtering
  it("Test D — LINEAGE INTEGRITY: Missing evidence entries are filtered as PAIRS without index misalignment", () => {
    const pain = {
      painId: "pain_lineage_test",
      canonical: "Test pain",
      originalStatement: "Test pain",
      normalizedStatement: "test pain",
      classification: "NOT_EVALUATED" as const,
      rank: 1,
      productFit: "UNKNOWN" as const,
      eligible: false,
      allowedUses: [],
      prohibitedUses: [],
      evidenceUids: ["EV_A", "EV_B", "EV_C"],
      sourceSignalIds: [],
      sourceTypes: ["review"],
      rootCauseIds: [],
      segmentIds: ["seg_1"],
      classifierVersion: "test",
      classificationReason: "test",
      lineage: { accountId: "acc_test", audienceSnapshotId: "snap_test" },
    };

    const evidenceContext = new Map([
      ["EV_A", { label: "Review A", detail: "Detail text for A" }],
      // EV_B is missing from context
      ["EV_C", { label: "Review C", detail: "Detail text for C" }],
    ]);

    const paired = extractPairedEvidence(pain, evidenceContext);

    // Invariant: EV_B is omitted, EV_A is paired with Text A, EV_C is paired with Text C
    expect(paired).toHaveLength(2);
    expect(paired[0]).toEqual({ evidenceId: "EV_A", text: "Detail text for A" });
    expect(paired[1]).toEqual({ evidenceId: "EV_C", text: "Detail text for C" });

    // Invariant: Prompt serializes paired items without shifting EV_B onto Text C
    const prompt = buildAtomicityPrompt({
      painClaim: pain.canonical,
      evidenceItems: paired,
    });

    expect(prompt).toContain('[Evidence ID: EV_A] "Detail text for A"');
    expect(prompt).toContain('[Evidence ID: EV_C] "Detail text for C"');
    expect(prompt).not.toContain("EV_B");
  });

  // Test E: Production cannot bypass final atomicity with llmEnabled=false
  it("Test E — NO PRODUCTION BYPASS: llmEnabled=false fails closed as ATOMICITY_INCOMPLETE without unvalidated bypass", async () => {
    const unvalidatedPain = {
      painId: "pain_unvalidated",
      canonical: "Unvalidated candidate pain",
      originalStatement: "Unvalidated candidate pain",
      normalizedStatement: "unvalidated candidate pain",
      classification: "NOT_EVALUATED" as const,
      rank: 1,
      productFit: "UNKNOWN" as const,
      eligible: true,
      allowedUses: [],
      prohibitedUses: [],
      evidenceUids: ["EV_1"],
      sourceSignalIds: [],
      sourceTypes: ["review"],
      rootCauseIds: [],
      segmentIds: ["seg_1"],
      classifierVersion: "test",
      classificationReason: "test",
      lineage: { accountId: "acc_test", audienceSnapshotId: "snap_test" },
    };

    const refined = await refineFinalPainAtomicityRegistry([unvalidatedPain], {
      accountId: "acc_test",
      campaignId: "camp_test",
      llmEnabled: false, // Disabling LLM must not silently allow pain to pass as valid
    });

    expect(refined.registry).toHaveLength(1);
    expect(refined.registry[0].classification).toBe("UNKNOWN");
    expect(refined.registry[0].eligible).toBe(false);
    expect(refined.registry[0].classificationReason).toContain("ATOMICITY_INCOMPLETE");
    expect(refined.atomicityRejections).toHaveLength(1);
  });

  // Test F: Domain-neutral atomicity preserves coherent multi-attribute pains
  it("Test F — COHERENT MULTI-ATTRIBUTE: Single causal problem unit with descriptive detail is preserved as ATOMIC + KEEP", async () => {
    const coherentPain = {
      painId: "pain_db_lock",
      canonical: "Frequent application timeouts and high error rates during peak traffic spikes due to database lock contention",
      originalStatement: "Frequent application timeouts and high error rates during peak traffic spikes due to database lock contention",
      normalizedStatement: "frequent application timeouts and high error rates during peak traffic spikes due to database lock contention",
      classification: "NOT_EVALUATED" as const,
      rank: 1,
      productFit: "UNKNOWN" as const,
      eligible: false,
      allowedUses: [],
      prohibitedUses: [],
      evidenceUids: ["EV_LOCK_1"],
      sourceSignalIds: [],
      sourceTypes: ["system_log"],
      rootCauseIds: [],
      segmentIds: ["seg_backend"],
      classifierVersion: "test",
      classificationReason: "test",
      lineage: { accountId: "acc_test", audienceSnapshotId: "snap_test" },
    };

    const refined = await refineFinalPainAtomicityRegistry([coherentPain], {
      accountId: "acc_test",
      campaignId: "camp_test",
      llmEnabled: true,
    });

    expect(refined.registry).toHaveLength(1);
    expect(refined.registry[0].painId).toBe("pain_db_lock");
    expect(refined.registry[0].canonical).toBe("Frequent application timeouts and high error rates during peak traffic spikes due to database lock contention");
  });

  // Test G: No circular runtime dependency exists
  it("Test G — MODULE BOUNDARY: pain-atomicity.ts does not depend on pain-classifier.ts", async () => {
    // Read raw file text of pain-atomicity.ts
    const fs = await import("fs");
    const path = await import("path");
    const atomicityFilePath = path.resolve(__dirname, "../shared/pain-atomicity.ts");
    const content = fs.readFileSync(atomicityFilePath, "utf-8");

    // Ensure zero imports from pain-classifier
    expect(content).not.toMatch(/from\s+["'].*pain-classifier["']/);
  });

  // Test H: Product Assessment receives only valid atomic pains, never compound parents
  it("Test H — DOWNSTREAM PURITY: PA receives ONLY ATOMIC+KEEP, validated split children, and validated REPLACE results", async () => {
    const parentCompoundPain = {
      painId: "parent_compound_pain_id",
      canonical: "Difficulty finding budget-friendly modest clothes made from natural fabrics that provide comfort in hot weather",
      originalStatement: "Difficulty finding budget-friendly modest clothes made from natural fabrics that provide comfort in hot weather",
      normalizedStatement: "difficulty finding budget-friendly modest clothes made from natural fabrics that provide comfort in hot weather",
      classification: "NOT_EVALUATED" as const,
      rank: 1,
      productFit: "UNKNOWN" as const,
      eligible: false,
      allowedUses: [],
      prohibitedUses: [],
      evidenceUids: ["EV_BUDGET_1", "EV_FABRIC_1", "EV_FABRIC_2"],
      sourceSignalIds: [],
      sourceTypes: ["review"],
      rootCauseIds: [],
      segmentIds: ["seg_1"],
      segmentName: "Modest Fashion Shoppers",
      classifierVersion: "initial_neutral_registry",
      classificationReason: "initial unassessed",
      lineage: { accountId: "acc_test", audienceSnapshotId: "snap_test" },
    };

    const refined = await refineAudiencePainRegistry([parentCompoundPain], {
      accountId: "acc_test",
      campaignId: "camp_test",
      audienceSegments: [{ id: "seg_1", name: "Modest Fashion Shoppers" }],
      productCapabilities: "Modest clothing with breathable fabrics",
      llmEnabled: true,
    });

    // Invariant 1: The compound parent ID never appears in the refined authoritative registry
    expect(refined.registry.some(p => p.painId === "parent_compound_pain_id")).toBe(false);

    // Invariant 2: Refined registry contains only the split children
    expect(refined.registry.length).toBe(2);
    expect(refined.registry[0].painId).toBe("parent_compound_pain_id_split_1");
    expect(refined.registry[1].painId).toBe("parent_compound_pain_id_split_2");

    // Invariant 3: Product Assessment and SPD decisions are recorded per child
    expect(refined.registry[0].productAssessmentAuthorityId).toBeDefined();
    expect(refined.registry[1].productAssessmentAuthorityId).toBeDefined();
    expect(refined.registry[0].strategicPainDecisionAuthorityId).toBeDefined();
    expect(refined.registry[1].strategicPainDecisionAuthorityId).toBeDefined();
  });
});
