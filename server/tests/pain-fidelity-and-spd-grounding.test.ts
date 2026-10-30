import "dotenv/config";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as aiClient from "../ai-client";
import { judgeAndRepairPainFidelityWithLLM, refineAudiencePainRegistry, buildMaterialityContextForPain } from "../shared/pain-classifier";
import { judgeAndRepairSpdExplanation, judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { runProductAssessmentForPain } from "../strategic-reasoning/product-assessment";
import {
  buildAudiencePainRegistry,
  bindPainEvidence,
  isCompetitorAuthoredContent,
  CandidateAudiencePain
} from "../shared/audience-pain-registry";

describe("Audience Pain Fidelity & SPD Grounding Hardening", { timeout: 45000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TEST 1: Question-vs-Pain — Identifies and repairs/drops over-generalized routine price/size questions", async () => {
    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Difficulty finding clear and accessible information about product pricing and sizes",
      evidenceTexts: [
        "Price please",
        "What size is the model wearing?",
        "How much is the plum set?"
      ],
      accountId: "test_account"
    });

    expect(["OVER_GENERALIZED", "SEMANTIC_DRIFT", "UNSUPPORTED"]).toContain(result.verdict);
    if (result.verdict === "OVER_GENERALIZED" || result.verdict === "SEMANTIC_DRIFT") {
      expect(result.canonical.toLowerCase()).not.toContain("difficulty finding");
      expect(result.canonical.toLowerCase()).not.toContain("lack of transparency");
    }
  });

  it("TEST 2: Restock Inquiry — Preserves availability frustration without claiming inventory software defects", async () => {
    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Poor inventory tracking and stock management software failures",
      evidenceTexts: [
        "Pls restock plum set in medium",
        "Waiting for restock of the blue dress!"
      ],
      accountId: "test_account"
    });

    expect(["OVER_GENERALIZED", "SEMANTIC_DRIFT"]).toContain(result.verdict);
    expect(result.canonical.toLowerCase()).not.toContain("software failure");
    expect(result.canonical.toLowerCase()).not.toContain("tracking system");
  });

  it("TEST 3: Real Fulfillment Failure — Preserves genuine customer complaint faithfully", async () => {
    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Orders arriving incomplete and customer support failing to resolve delivery issues",
      evidenceTexts: [
        "I only received half my package and support stopped replying to my emails",
        "Package arrived missing 2 items from the order"
      ],
      accountId: "test_account"
    });

    expect(result.verdict).toBe("FAITHFUL");
    expect(result.canonical).toBe("Orders arriving incomplete and customer support failing to resolve delivery issues");
  });

  it("TEST 4: SPD Explanation Grounding Judge — Flags ungrounded inventory/logistics tech assertion", async () => {
    const mockProductTruth = [
      { factType: "PRODUCT_SCOPE", statement: "Sara-ft designs and sells modest summer dresses, abayas, and co-ord sets." },
      { factType: "CAPABILITY", statement: "Provides online catalog ordering and direct customer delivery." }
    ];

    const audit = await judgeAndRepairSpdExplanation({
      painClaim: "Customer uncertainty regarding restock availability and item sizing",
      finalClassification: "SUPPORTING",
      proposedReason: "While the target audience is covered, the offering solves this because Sara-ft provides inventory tracking, automated stock signaling, and fulfillment transparency platforms.",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: mockProductTruth as any,
      productAssessmentReason: "Sara-ft is a fashion brand selling modest dresses; it does not provide inventory management software.",
      accountId: "test_account"
    });

    expect(audit.valid).toBe(true);
    expect(audit.status).toBe("REPAIRED");
    expect(audit.groundedReason).toBeDefined();
    expect(audit.groundedReason.length).toBeGreaterThan(10);
    expect(audit.groundedReason.toLowerCase()).not.toContain("fulfillment transparency platform");
  });

  it("TEST 5: SPD Decision vs Explanation Separation — Reason repair does not alter classification decision", async () => {
    const mockProductTruth = [
      { factType: "PRODUCT_SCOPE", statement: "Sara-ft designs and sells modest summer dresses." }
    ];

    const decision = await judgeStrategicPainDecision({
      jobId: "test_job_123",
      painId: "test_pain_456",
      targetUnderstandingAuthorityId: "tua_test",
      productTruthFactIds: ["ptf_1"],
      campaignOfferingId: "offering_test",
      targetAssessmentAuthorityId: "taa_test",
      productAssessmentAuthorityId: "paa_test",
      targetAssessmentParentAuthorityIds: ["tua_test", "test_pain_456"],
      productAssessmentParentAuthorityIds: ["offering_test", "test_pain_456"],
      targetAssessmentJobId: "test_job_123",
      productAssessmentJobId: "test_job_123",
      painClaim: "Lack of immediate sizing confirmation when selecting dress sizes",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: mockProductTruth as any,
      productAssessmentReason: "Sara-ft provides sizing charts and customer assistance for dress sizing, but is not a sizing tech platform.",
      materiality: {
        mode: "GROUNDED",
        rawCitationCount: 2,
        uniqueEvidenceCount: 2,
        uniqueSourceCount: 1,
        occurrenceCount: 2,
        sourceTypes: ["DIRECT_CUSTOMER_FEEDBACK"],
        rawEvidenceUids: ["ev_1", "ev_2"],
        evidence: [
          {
            evidenceUid: "ev_1",
            rawEvidenceUids: ["ev_1"],
            canonicalEvidenceId: "ext:ev_1",
            actorType: "CUSTOMER",
            authorityClass: "DIRECT_CUSTOMER_VOICE",
            sourceType: "REVIEW",
            verbatimText: "Hard to tell sizing from the photos alone.",
            boundedExcerpt: "[Review] Hard to tell sizing from the photos alone."
          },
          {
            evidenceUid: "ev_2",
            rawEvidenceUids: ["ev_2"],
            canonicalEvidenceId: "ext:ev_2",
            actorType: "CUSTOMER",
            authorityClass: "DIRECT_CUSTOMER_VOICE",
            sourceType: "REVIEW",
            verbatimText: "Wish there were more exact measurements listed.",
            boundedExcerpt: "[Review] Wish there were more exact measurements listed."
          }
        ]
      },
      accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
      campaignId: "camp_mtewrp8kkom3"
    });

    expect(decision.status).toBe("COMPLETE");
    expect(["SUPPORTING", "CORE_PURCHASE", "EXCLUDE"]).toContain(decision.finalClassification);
    expect(decision.reason).toBeDefined();
    expect(decision.reason.length).toBeGreaterThan(10);
  });

  it("TEST 6: Pain Fidelity — First call malformed JSON -> repair attempt succeeds -> accept repaired result", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      callCount++;
      if (callCount === 1) {
        // Return malformed JSON
        return { choices: [{ message: { content: "INVALID_JSON_NOT_AN_OBJECT" } }] } as any;
      }
      // Attempt 2 targeted repair succeeds
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdict: "OVER_GENERALIZED",
              critique: "Customer inquiry was exaggerated into operational failure",
              repairedClaim: "Frequent customer inquiries regarding dress sizes and pricing"
            })
          }
        }]
      } as any;
    });

    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Difficulty finding clear pricing and sizing information",
      evidenceTexts: ["Price please", "What size is the model wearing?"],
      accountId: "test_account"
    });

    expect(callCount).toBe(2);
    expect(result.verdict).toBe("OVER_GENERALIZED");
    expect(result.canonical).toBe("Frequent customer inquiries regarding dress sizes and pricing");
  });

  it("TEST 7: Pain Fidelity — First call provider error -> retry attempt succeeds -> accept result", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      callCount++;
      if (callCount === 1) {
        throw new Error("503 Service Unavailable");
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              verdict: "FAITHFUL",
              critique: "Genuine customer delivery friction stated verbatim"
            })
          }
        }]
      } as any;
    });

    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Orders arriving incomplete and missing items",
      evidenceTexts: ["I only received half my package"],
      accountId: "test_account"
    });

    expect(callCount).toBe(2);
    expect(result.verdict).toBe("FAITHFUL");
    expect(result.canonical).toBe("Orders arriving incomplete and missing items");
  });

  it("TEST 8: Pain Fidelity — All attempts fail -> FIDELITY_JUDGE_INCOMPLETE -> pain marked ineligible downstream", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      if (opts?.endpoint?.includes("atomicity")) {
        return { choices: [{ message: { content: JSON.stringify({ isAtomic: true }) } }] } as any;
      }
      callCount++;
      throw new Error("Continuous provider network failure");
    });

    const result = await judgeAndRepairPainFidelityWithLLM({
      painClaim: "Unverified proposed pain",
      evidenceTexts: ["Some evidence text"],
      accountId: "test_account"
    });

    // 3 bounded attempts
    expect(callCount).toBe(3);
    expect(result.verdict).toBe("FIDELITY_JUDGE_INCOMPLETE");

    // Verify refineAudiencePainRegistry drops it from downstream processing
    const mockRegistry = [{
      painId: "pain_exhausted_1",
      canonical: "Unverified proposed pain",
      segmentId: "seg_1",
      segmentIds: ["seg_1"],
      evidenceUids: ["ev_1"],
      sourceTypes: ["DIRECT_CUSTOMER_VOICE"],
      rank: 1,
      classification: "SUPPORTING" as any,
      allowedUses: ["SUPPORTING_MESSAGING" as any],
      prohibitedUses: [],
      eligible: true
    }];

    const refined = await refineAudiencePainRegistry(mockRegistry as any, {
      accountId: "test_acc",
      campaignId: "test_camp",
      evidenceContext: new Map([["ev_1", { label: "Comment", detail: "Some evidence text" }]]),
      atomicityJudge: async () => ({ verdict: "ATOMIC", action: "KEEP", originalClaim: "Unverified proposed pain", evidenceIds: ["ev_1"] })
    });

    // Ineligible, UNKNOWN classification, cannot continue downstream
    expect(refined.registry.length).toBe(1);
    const evaluatedPain = refined.registry[0];
    expect(evaluatedPain.eligible).toBe(false);
    expect(evaluatedPain.classification).toBe("UNKNOWN");
    expect(evaluatedPain.allowedUses).toEqual([]);

    // Authority neutrality: TA, PA, SPD were never run, so no fabricated NOT_COVERED or NOT_FIT decisions
    expect(evaluatedPain.coverageDecision).toBeUndefined();
    expect(evaluatedPain.fitType).toBe("UNKNOWN");
    expect(evaluatedPain.productFit).toBe("UNKNOWN");
    expect(evaluatedPain.targetAssessmentAuthorityId).toBeUndefined();
    expect(evaluatedPain.productAssessmentAuthorityId).toBeUndefined();
    expect(evaluatedPain.strategicPainDecisionAuthorityId).toBeUndefined();

    // Preserves rejection diagnostic notice
    expect(refined.judgeRejections.some(r => r.includes("PAIN_FIDELITY_INCOMPLETE"))).toBe(true);
  });

  it("TEST 9: SPD Explanation — First audit malformed -> repair succeeds -> grounded explanation returned", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      callCount++;
      if (callCount === 1) {
        return { choices: [{ message: { content: "INVALID_MALFORMED_OUTPUT" } }] } as any;
      }
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              grounded: false,
              critique: "Removed ungrounded inventory software claim",
              repairedReason: "The offering directly fits customer needs by providing modest apparel catalog options without automated stock tracking software."
            })
          }
        }]
      } as any;
    });

    const audit = await judgeAndRepairSpdExplanation({
      painClaim: "Stockout uncertainty",
      finalClassification: "SUPPORTING",
      proposedReason: "Business provides automated inventory tracking platforms",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: [{ statement: "Sells modest dresses" }] as any,
      accountId: "test_acc"
    });

    expect(callCount).toBe(2);
    expect(audit.valid).toBe(true);
    expect(audit.status).toBe("REPAIRED");
    expect(audit.groundedReason).toContain("modest apparel catalog options");
  });

  it("TEST 10: SPD Explanation — All attempts fail -> classification preserved, explanation marked incomplete", async () => {
    let callCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      callCount++;
      return { choices: [{ message: { content: "NOT_VALID_JSON" } }] } as any;
    });

    const audit = await judgeAndRepairSpdExplanation({
      painClaim: "Sizing uncertainty",
      finalClassification: "CORE_PURCHASE",
      proposedReason: "Original ungrounded proposal",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: [{ statement: "Sells modest dresses" }] as any,
      accountId: "test_acc"
    });

    // 3 bounded attempts
    expect(callCount).toBe(3);
    expect(audit.valid).toBe(false);
    expect(audit.status).toBe("EXPLANATION_GROUNDING_INCOMPLETE");
    expect(audit.groundedReason).toContain("EXPLANATION_GROUNDING_INCOMPLETE");
    expect(audit.unverifiedProposedReason).toBe("Original ungrounded proposal");
  });
});

describe("Surgical SPD Evidence Context Hardening (Tests A–F)", { timeout: 45000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TEST A: INVALID STATE IMPOSSIBLE — Unbound candidate pain cannot become authoritative pain; SPD fails closed on missing/invalid materiality", async () => {
    // 1. Candidate with evidenceUids but no registry entries is omitted at boundary
    const ungroundedCandidate: CandidateAudiencePain = {
      painId: "unbound_pain_1",
      canonical: "Modest dresses are cheaply made with see-through fabric",
      evidenceUids: ["ev_nonexistent_1", "ev_nonexistent_2"]
    };
    const emptyRegistry = new Map();
    const authoritativePains = buildAudiencePainRegistry(
      [ungroundedCandidate],
      { accountId: "acc_1", audienceSnapshotId: "snap_1" },
      emptyRegistry
    );
    expect(authoritativePains).toEqual([]);

    // 2. bindPainEvidence fails closed returning null
    const bindResult = bindPainEvidence(ungroundedCandidate, emptyRegistry);
    expect(bindResult).toBeNull();

    // 3. SPD call with missing materiality fails closed immediately with status: "INCOMPLETE"
    const mockPt = [{ factId: "pt_1", statement: "Sells modest dresses" }];
    const spdMissing = await judgeStrategicPainDecision({
      jobId: "job_test",
      painId: "unbound_pain_1",
      targetUnderstandingAuthorityId: "tu_1",
      productTruthFactIds: ["pt_1"],
      campaignOfferingId: "co_1",
      targetAssessmentAuthorityId: "ta_1",
      productAssessmentAuthorityId: "pa_1",
      targetAssessmentParentAuthorityIds: ["tu_1", "unbound_pain_1"],
      productAssessmentParentAuthorityIds: ["co_1", "pt_1", "unbound_pain_1"],
      targetAssessmentJobId: "job_test",
      productAssessmentJobId: "job_test",
      painClaim: "Modest dresses are cheaply made with see-through fabric",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: mockPt as any,
      materiality: undefined as any,
      accountId: "acc_1",
      campaignId: "camp_1"
    });
    expect(spdMissing.status).toBe("INCOMPLETE");
    expect(spdMissing.reason).toContain("materiality");

    // 4. SPD call with empty evidence array when mode is GROUNDED also fails closed
    const spdEmptyGrounded = await judgeStrategicPainDecision({
      jobId: "job_test",
      painId: "unbound_pain_1",
      targetUnderstandingAuthorityId: "tu_1",
      productTruthFactIds: ["pt_1"],
      campaignOfferingId: "co_1",
      targetAssessmentAuthorityId: "ta_1",
      productAssessmentAuthorityId: "pa_1",
      targetAssessmentParentAuthorityIds: ["tu_1", "unbound_pain_1"],
      productAssessmentParentAuthorityIds: ["co_1", "pt_1", "unbound_pain_1"],
      targetAssessmentJobId: "job_test",
      productAssessmentJobId: "job_test",
      painClaim: "Modest dresses are cheaply made with see-through fabric",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: mockPt as any,
      materiality: { mode: "GROUNDED", evidence: [] as any, rawEvidenceUids: [], rawCitationCount: 0, uniqueEvidenceCount: 0, sourceTypes: [] },
      accountId: "acc_1",
      campaignId: "camp_1"
    });
    expect(spdEmptyGrounded.status).toBe("INCOMPLETE");
    expect(spdEmptyGrounded.reason).toContain("materiality");
  });

  it("TEST B: BOUND ONCE — 3 raw Trustpilot rows (2 mirrored, 1 unique) produce 2 canonical items; bound upfront into pain.materiality", () => {
    const rawRegistry = new Map<string, any>([
      ["mve_5e92", {
        label: "Trustpilot US",
        detail: "Very cheaply made and see through and they shouldn't call it modest clothing because there is no way a hijabi women would wear it.",
        url: "https://www.trustpilot.com/reviews/66c0d5718dfd38a063198086",
        platform: "trustpilot",
        actorType: "CUSTOMER",
      }],
      ["mve_a288", {
        label: "Trustpilot AU",
        detail: "Very cheaply made and see through and they shouldn't call it modest clothing because there is no way a hijabi women would wear it.",
        url: "https://au.trustpilot.com/reviews/66c0d5718dfd38a063198086",
        platform: "trustpilot",
        actorType: "CUSTOMER",
      }],
      ["mve_be25", {
        label: "Trustpilot US",
        detail: "And the fabric quality is horrendous. I got sucked in on a social media post.",
        url: "https://www.trustpilot.com/reviews/66c1f215682281fa0e722518",
        platform: "trustpilot",
        actorType: "CUSTOMER",
      }],
    ]);

    const candidate: CandidateAudiencePain = {
      painId: "seg_1_pain_1",
      canonical: "Modest dresses are cheaply made with low-quality, see-through fabric",
      evidenceUids: ["mve_5e92", "mve_a288", "mve_be25"],
    };

    const authoritativePains = buildAudiencePainRegistry(
      [candidate],
      { accountId: "acc_1", audienceSnapshotId: "snap_1" },
      rawRegistry
    );

    expect(authoritativePains.length).toBe(1);
    const pain = authoritativePains[0];
    expect(pain.materiality.mode).toBe("GROUNDED");
    if (pain.materiality.mode === "GROUNDED") {
      // Exactly 2 canonical items, 3 citations
      expect(pain.materiality.uniqueEvidenceCount).toBe(2);
      expect(pain.materiality.rawCitationCount).toBe(3);
      expect(pain.materiality.evidence.length).toBe(2);
      // All 3 raw UIDs preserved in lineage
      expect(pain.materiality.rawEvidenceUids).toEqual(["mve_5e92", "mve_a288", "mve_be25"]);
      // Contains bounded excerpts
      expect(pain.materiality.evidence[0].boundedExcerpt).toContain("there is no way a hijabi women would wear it");
      expect(pain.materiality.evidence[1].boundedExcerpt).toContain("fabric quality is horrendous");
    }
  });

  it("TEST C: CUSTOMER REVIEW OF COMPETITOR PRESERVED — sourceScope='COMPETITOR' with customer author binds into materiality", () => {
    const competitorReview = {
      label: "Competitor Trustpilot Review",
      detail: "Competitor brand dresses are completely transparent and rip easily.",
      url: "https://www.trustpilot.com/reviews/comp123",
      platform: "trustpilot",
      sourceScope: "COMPETITOR",
      actorType: "CUSTOMER",
      authorRole: "CUSTOMER"
    };

    expect(isCompetitorAuthoredContent(competitorReview)).toBe(false);

    const registry = new Map([["mve_comp_review", competitorReview]]);
    const candidate: CandidateAudiencePain = {
      painId: "pain_comp_1",
      canonical: "Dresses are transparent and rip easily",
      evidenceUids: ["mve_comp_review"]
    };

    const bound = bindPainEvidence(candidate, registry);
    expect(bound).not.toBeNull();
    expect(bound?.mode).toBe("GROUNDED");
    if (bound?.mode === "GROUNDED") {
      expect(bound.evidence.length).toBe(1);
      expect(bound.evidence[0].boundedExcerpt).toContain("Competitor brand dresses are completely transparent");
    }
  });

  it("TEST D: COMPETITOR AUTHORED CONTENT EXCLUDED — sourceActor='COMPETITOR' marketing/posts are excluded", () => {
    const competitorMarketingPost = {
      label: "Competitor Instagram Ad",
      detail: "Check out our new summer collection with breathable chiffon fabric!",
      url: "https://instagram.com/p/competitor_ad_1",
      platform: "instagram",
      sourceActor: "COMPETITOR",
      authorityClass: "COMPETITOR_ASSET",
      authorRole: "COMPETITOR"
    };

    expect(isCompetitorAuthoredContent(competitorMarketingPost)).toBe(true);

    const registry = new Map([["mve_comp_post", competitorMarketingPost]]);
    const candidate: CandidateAudiencePain = {
      painId: "pain_comp_post",
      canonical: "Marketing claim about chiffon fabric",
      evidenceUids: ["mve_comp_post"]
    };

    // Binding fails because all evidence was competitor-authored content
    const bound = bindPainEvidence(candidate, registry);
    expect(bound).toBeNull();

    // buildAudiencePainRegistry omits pain entirely
    const authoritativePains = buildAudiencePainRegistry(
      [candidate],
      { accountId: "acc_1", audienceSnapshotId: "snap_1" },
      registry
    );
    expect(authoritativePains).toEqual([]);
  });

  it("TEST E: SPD PROMPT RENDERING — Grounded pain renders citation count, unique count, and verbatim customer excerpts", async () => {
    let capturedPrompt = "";
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      if (opts.endpoint === "strategic-pain-judge" || !opts.endpoint) {
        capturedPrompt = opts.messages?.[0]?.content || "";
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                finalClassification: "CORE_PURCHASE",
                reason: "Direct customer evidence confirms see-through fabric is a primary purchase-blocking concern directly solved by the offering's verified premium fabrics."
              })
            }
          }]
        } as any;
      }
      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const spdResult = await judgeStrategicPainDecision({
      jobId: "job_test_e",
      painId: "seg_1_pain_1",
      targetUnderstandingAuthorityId: "tu_test",
      productTruthFactIds: ["f1"],
      campaignOfferingId: "co_test",
      targetAssessmentAuthorityId: "ta_test",
      productAssessmentAuthorityId: "pa_test",
      targetAssessmentParentAuthorityIds: ["tu_test", "seg_1_pain_1"],
      productAssessmentParentAuthorityIds: ["bu_test", "f1", "seg_1_pain_1"],
      targetAssessmentJobId: "job_test_e",
      productAssessmentJobId: "job_test_e",
      painClaim: "Modest dresses are cheaply made with low-quality, see-through fabric, making them unsuitable without layering and compromising modesty.",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: [{ factId: "f1", statement: "The dresses are crafted with premium fabrics to ensure long-lasting wear and comfort." }] as any,
      productAssessmentReason: "Verified capabilities explicitly state dresses are crafted with premium fabrics, directly solving and mitigating the customer problem.",
      materiality: {
        mode: "GROUNDED",
        rawCitationCount: 3,
        uniqueEvidenceCount: 2,
        uniqueSourceCount: 1,
        sourceTypes: ["DIRECT_CUSTOMER_VOICE"],
        rawEvidenceUids: ["mve_5e92", "mve_a288", "mve_be25"],
        evidence: [
          {
            evidenceUid: "mve_5e92",
            rawEvidenceUids: ["mve_5e92", "mve_a288"],
            canonicalEvidenceId: "rev:66c0d5718dfd38a063198086",
            actorType: "CUSTOMER",
            authorityClass: "DIRECT_CUSTOMER_VOICE",
            sourceType: "REVIEW",
            verbatimText: "Very cheaply made and see through and they shouldn't call it modest clothing because there is no way a hijabi women would wear it.",
            boundedExcerpt: '[Trustpilot - Renee] "Very cheaply made and see through and they shouldn\'t call it modest clothing because there is no way a hijabi women would wear it."'
          },
          {
            evidenceUid: "mve_be25",
            rawEvidenceUids: ["mve_be25"],
            canonicalEvidenceId: "rev:66c1f215682281fa0e722518",
            actorType: "CUSTOMER",
            authorityClass: "DIRECT_CUSTOMER_VOICE",
            sourceType: "REVIEW",
            verbatimText: "And the fabric quality is horrendous. I got sucked in on a social media post.",
            boundedExcerpt: '[Trustpilot - MK] "And the fabric quality is horrendous. I got sucked in on a social media post."'
          }
        ]
      },
      accountId: "acc_test",
      campaignId: "camp_test",
    });

    // Check that grounded customer evidence was rendered into the SPD prompt
    expect(capturedPrompt).toContain("2 unique customer evidence items (3 citations across market data)");
    expect(capturedPrompt).toContain("Grounded Customer Evidence Excerpts:");
    expect(capturedPrompt).toContain("Very cheaply made and see through");
    expect(capturedPrompt).toContain("fabric quality is horrendous");

    expect(spdResult.status).toBe("COMPLETE");
    expect(spdResult.finalClassification).toBe("CORE_PURCHASE");
  });

  it("TEST F: NO LEGACY UID FALLBACK — Pain with materiality.mode === 'NONE' renders explicit notice without fabricated citation counts or evidence IDs", async () => {
    let capturedPrompt = "";
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      if (opts.endpoint === "strategic-pain-judge" || !opts.endpoint) {
        capturedPrompt = opts.messages?.[0]?.content || "";
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                finalClassification: "SUPPORTING",
                reason: "Secondary concern without empirical customer evidence."
              })
            }
          }]
        } as any;
      }
      return { choices: [{ message: { content: "{}" } }] } as any;
    });

    const spdResult = await judgeStrategicPainDecision({
      jobId: "job_test_f",
      painId: "non_empirical_pain_1",
      targetUnderstandingAuthorityId: "tu_test",
      productTruthFactIds: ["f1"],
      campaignOfferingId: "co_test",
      targetAssessmentAuthorityId: "ta_test",
      productAssessmentAuthorityId: "pa_test",
      targetAssessmentParentAuthorityIds: ["tu_test", "non_empirical_pain_1"],
      productAssessmentParentAuthorityIds: ["bu_test", "f1", "non_empirical_pain_1"],
      targetAssessmentJobId: "job_test_f",
      productAssessmentJobId: "job_test_f",
      painClaim: "Sizing uncertainty across catalog items",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      productTruthFacts: [{ factId: "f1", statement: "Provides detailed size charts." }] as any,
      productAssessmentReason: "Size charts address sizing uncertainty.",
      materiality: {
        mode: "NONE",
        evidence: [],
        rawEvidenceUids: [],
        rawCitationCount: 0,
        uniqueEvidenceCount: 0,
        sourceTypes: [],
        uniqueCompetitorCount: 0
      },
      accountId: "acc_test",
      campaignId: "camp_test"
    });

    expect(capturedPrompt).toContain("No empirical customer evidence bound for this pain claim.");
    expect(capturedPrompt).not.toContain("citations across market data");
    expect(capturedPrompt).not.toContain("Evidence UIDs:");
    expect(spdResult.status).toBe("COMPLETE");
  });

  it("PA RATIONALE: uses 'addresses / mitigates' semantics and does not imply that Product Truth invalidates the market pain", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            fitType: "DIRECT_FIT",
            reason: "Verified capabilities explicitly state dresses are crafted with premium fabrics. This directly contradicts the pain claim about cheaply made see-through fabric."
          })
        }
      }]
    } as any);

    const paResult = await runProductAssessmentForPain({
      painId: "seg_1_pain_1",
      canonicalPain: "Modest dresses are cheaply made with see-through fabric",
      campaignOfferingId: "co_test",
      businessUnderstandingAuthorityId: "bu_test",
      productTruthFacts: [{ productTruthFactId: "f1", statement: "Premium fabrics" }] as any,
      accountId: "acc_test",
      campaignId: "camp_test",
      jobId: "job_test",
    });

    expect(paResult.fitType).toBe("DIRECT_FIT");
    expect(paResult.reason.toLowerCase()).not.toContain("contradicts the pain claim");
    expect(paResult.reason.toLowerCase()).toContain("directly addresses and mitigates the customer pain claim");
  });
});

