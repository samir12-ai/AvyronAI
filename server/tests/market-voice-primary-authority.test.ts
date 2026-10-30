/**
 * Market Voice as Primary Audience Authority Test Suite
 * 
 * Verifies the 8 mandatory regression guards:
 * - Test A: MARKET_VOICE sourceType with UNRESOLVED_EXCLUDED does NOT become Primary.
 * - Test B: ASPIRATIONAL comment with sourceType "comment" does NOT enter Supporting/Primary by sourceType bypass.
 * - Test C: One isolated Market Voice quote does not automatically satisfy Primary evidence readiness; semantic sufficiency owns readiness.
 * - Test D: Verified DIRECT customer review can participate in Primary theme genesis.
 * - Test E: Instagram/TikTok Direct comments remain Supporting and cannot independently create canonical themes.
 * - Test F: Adjacent reviews/comments remain Supporting.
 * - Test G: Aspirational reviews/comments remain Benchmark.
 * - Test H: Cross-pool dedupe preserves all contributor provenance.
 */

import { describe, it, expect, vi } from "vitest";
import {
  synthesizeGlobalAudienceWithLLM,
  synthesizeFinalSignals,
  corroborateThemesWithNonDirectEvidenceWithLLM,
  deduplicateFromCanonicalCustomerVoice,
  type TerminalEvidenceClassification,
  type SemanticTheme,
  type AudienceSignalDraft,
  type DeduplicatedEvidenceUnit,
  type CanonicalCompetitorMap,
} from "../audience-engine/semantic-reasoner";
import {
  deduplicateCustomerVoice,
  type CustomerEvidenceUnit,
} from "../competitive-intelligence/evidence-routing";
import {
  judgePrimaryMarketVoiceSufficiencyWithLLM,
} from "../audience-engine/semantic-sufficiency-judge";

vi.mock("../ai-client", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    aiGemini: vi.fn(async (params: any) => {
      let prompt = "";
      let sys = "";
      if (Array.isArray(params)) {
        prompt = (params?.[1]?.content || "").toLowerCase();
        sys = (params?.[0]?.content || "").toLowerCase();
      } else if (typeof params === "object") {
        const contents = typeof params.contents === "string" ? params.contents : JSON.stringify(params.contents || "");
        const parts = contents.split(/USER:\n/i);
        sys = (parts[0] || contents).toLowerCase();
        prompt = (parts[1] || contents).toLowerCase();
      }

      if (sys.includes("sufficiency judge")) {
        if (prompt.includes("spam quote") || prompt.includes("single isolated quote without depth")) {
          return JSON.stringify({
            verdict: "INSUFFICIENT",
            reason: "Corpus contains only isolated single quote without sufficient semantic depth or category trade-offs.",
            categoryRelevance: "LOW",
            buyerAuthenticity: "MIXED",
            substantiveThemesFound: [],
          });
        }
        return JSON.stringify({
          verdict: "SUFFICIENT",
          reason: "Corpus contains authentic buyer experiences discussing fabric sheer and modesty trade-offs.",
          categoryRelevance: "HIGH",
          buyerAuthenticity: "VERIFIED_BUYER",
          substantiveThemesFound: ["Fabric transparency in sunlight", "Breathability trade-off"],
        });
      }

      return JSON.stringify({});
    }),
    aiChat: vi.fn(async (params: any) => {
      const endpoint = params.endpoint || "";
      const content = (params.messages?.[1]?.content || "").toLowerCase();
      const sysContent = (params.messages?.[0]?.content || "").toLowerCase();

      if (endpoint.includes("sufficiency-judge")) {
        if (content.includes("spam quote") || content.includes("single isolated quote without depth")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  verdict: "INSUFFICIENT",
                  reason: "Corpus contains only isolated single quote without sufficient semantic depth or category trade-offs.",
                  categoryRelevance: "LOW",
                  buyerAuthenticity: "MIXED",
                  substantiveThemesFound: [],
                }),
              },
            }],
          };
        }
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                verdict: "SUFFICIENT",
                reason: "Corpus contains authentic buyer experiences discussing fabric sheer and modesty trade-offs.",
                categoryRelevance: "HIGH",
                buyerAuthenticity: "VERIFIED_BUYER",
                substantiveThemesFound: ["Fabric transparency in sunlight", "Breathability trade-off"],
              }),
            },
          }],
        };
      }

      if (endpoint === "semantic-reasoner-theme-batch") {
        if (content.includes("fabric") || content.includes("sheer") || content.includes("see-through") || content.includes("linen") || content.includes("review")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  themes: [
                    {
                      themeId: "theme_mv_fabric_sheer",
                      canonicalMeaning: "Summer fabric sheer and breathability friction",
                      description: "Customers discuss dresses being too sheer in summer sunlight",
                      supportingClaimIds: ["clm_1"],
                      supportingEvidenceUnitIds: ["ev_1"],
                      semanticRationale: "Discussed by multiple verified primary voices",
                      confidence: 0.9,
                    },
                  ],
                  isolatedTruthClaimIds: [],
                  redundantClaimMappings: [],
                  insufficientClaimIds: [],
                  noMeaningfulTruthClaimIds: [],
                }),
              },
            }],
          };
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                themes: [],
                isolatedTruthClaimIds: [],
                redundantClaimMappings: [],
                insufficientClaimIds: [],
                noMeaningfulTruthClaimIds: [],
              }),
            },
          }],
        };
      }

      if (endpoint === "semantic-reasoner-theme-corroboration") {
        if (content.includes("theme_mv_fabric_sheer")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  corroborations: [
                    {
                      claimId: "clm_social_1",
                      evidenceUnitId: "ev_social_1",
                      themeId: "theme_mv_fabric_sheer",
                      corroborationRationale: "Directly corroborates dress transparency concern",
                    },
                  ],
                  unmatchedClaimIds: [],
                }),
              },
            }],
          };
        }

        return {
          choices: [{
            message: {
              content: JSON.stringify({
                corroborations: [],
                unmatchedClaimIds: ["clm_social_unmatched"],
              }),
            },
          }],
        };
      }

      if (sysContent.includes("senior audience intelligence strategist") || content.includes("synthesize the comprehensive audience intelligence signals")) {
        if (content.includes("theme_mv_fabric_sheer")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    type: "pain",
                    canonical: "Summer fabric sheer and breathability friction",
                    explanation: "Customers express concern that summer dresses are too sheer in daylight",
                    themeIds: ["theme_mv_fabric_sheer"],
                    supportingClaimIds: ["clm_1"],
                    support: [
                      {
                        evidenceUnitId: "ev_1",
                        whyItSupportsThisSignal: "Primary customer evidence on fabric transparency",
                      },
                    ],
                    confidence: 0.88,
                  },
                ]),
              },
            }],
          };
        }
        return { choices: [{ message: { content: "[]" } }] };
      }

      return { choices: [{ message: { content: "{}" } }] };
    }),
  };
});

describe("Market Voice Primary Authority Architecture (Amended)", () => {
  const compMap: CanonicalCompetitorMap = {
    canonicalList: [
      { id: "comp_direct_1", name: "Sara Direct Brand", cleanKey: "saradirectbrand", websiteUrl: null, platform: null, strategicRole: "DIRECT" },
      { id: "comp_adjacent_1", name: "Adjacent Brand", cleanKey: "adjacentbrand", websiteUrl: null, platform: null, strategicRole: "ADJACENT" },
      { id: "comp_aspirational_1", name: "Aspirational Luxury", cleanKey: "aspirationalbrand", websiteUrl: null, platform: null, strategicRole: "ASPIRATIONAL" },
    ],
    idToCanonicalId: new Map([
      ["comp_direct_1", "comp_direct_1"],
      ["comp_adjacent_1", "comp_adjacent_1"],
      ["comp_aspirational_1", "comp_aspirational_1"],
    ]),
    canonicalIdToName: new Map([
      ["comp_direct_1", "Sara Direct Brand"],
      ["comp_adjacent_1", "Adjacent Brand"],
      ["comp_aspirational_1", "Aspirational Luxury"],
    ]),
    totalApprovedCount: 3,
  };

  const businessContext = {
    heroProduct: "Modest Summer Dresses",
    businessName: "Sara-ft",
    market: "Lebanon / Middle East",
    category: "Modest Apparel",
  };

  // -----------------------------------------------------------------------------
  // Guard A: MARKET_VOICE sourceType with UNRESOLVED_EXCLUDED does NOT become Primary
  // -----------------------------------------------------------------------------
  it("Guard A: MARKET_VOICE sourceType with UNRESOLVED_EXCLUDED does NOT become Primary", async () => {
    const unresolvedMarketVoiceUnit: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_mv_unresolved",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Linen fabric is too sheer",
      semanticClaims: [{ claimId: "clm_1", claimKind: "friction_problem", meaning: "Linen sheer", confidence: 0.9 }],
      confidence: 0.9,
      canonicalCompetitorId: "market_voice",
      canonicalBrandName: "Market Voice",
      platform: "reddit",
      rawText: "Linen fabric is too sheer in daylight.",
      evidencePool: "UNRESOLVED_EXCLUDED",
    };

    const result = await synthesizeGlobalAudienceWithLLM(
      [unresolvedMarketVoiceUnit],
      businessContext,
      "acc_test_a"
    );

    // Because evidencePool is UNRESOLVED_EXCLUDED, it does NOT enter Primary or Supporting
    expect(result.themes.length).toBe(0);
    expect(result.draft.pains.length).toBe(0);
  });

  // -----------------------------------------------------------------------------
  // Guard B: ASPIRATIONAL comment with sourceType "comment" does NOT enter Supporting/Primary
  // -----------------------------------------------------------------------------
  it("Guard B: ASPIRATIONAL comment with sourceType comment does NOT enter Supporting/Primary by sourceType bypass", async () => {
    const aspirationalComment: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_asp_comment",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Fabric quality issue",
      semanticClaims: [{ claimId: "clm_asp_1", claimKind: "friction_problem", meaning: "Fabric quality", confidence: 0.9 }],
      confidence: 0.9,
      canonicalCompetitorId: "comp_aspirational_1",
      canonicalBrandName: "Aspirational Luxury",
      platform: "instagram",
      rawText: "The fabric felt synthetic on the runway collection.",
      strategicRole: "ASPIRATIONAL",
      evidencePool: "BENCHMARK_CONTEXT",
    };

    const result = await synthesizeGlobalAudienceWithLLM(
      [aspirationalComment],
      businessContext,
      "acc_test_b"
    );

    // Cannot originate themes or corroborate as supporting social customer voice
    expect(result.themes.length).toBe(0);
    expect(result.draft.pains.length).toBe(0);
  });

  // -----------------------------------------------------------------------------
  // Guard C: One isolated Market Voice quote does not satisfy Primary evidence readiness (Sufficiency Judge)
  // -----------------------------------------------------------------------------
  it("Guard C: One isolated Market Voice quote does not satisfy Primary evidence readiness; semantic sufficiency judge owns readiness", async () => {
    const spamUnit: CustomerEvidenceUnit = {
      evidenceId: "ev_spam_1",
      origin: "MARKET_VOICE",
      platform: "reddit",
      evidencePool: "PRIMARY_MARKET_VOICE",
      accountId: "acc_test_c",
      campaignId: "camp_test_c",
      text: "single isolated quote without depth - check out our shop",
      author: "bot123",
      authorType: "COMMUNITY_USER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: { isVerified: true },
      rawEvidenceReference: { table: "market_voice_evidence", id: "1" },
    };

    const sufficiency = await judgePrimaryMarketVoiceSufficiencyWithLLM(
      [spamUnit],
      businessContext,
      "acc_test_c"
    );

    expect(sufficiency.isSufficient).toBe(false);
    expect(sufficiency.verdict).toBe("INSUFFICIENT");
    expect(sufficiency.reason).toContain("isolated");
  });

  // -----------------------------------------------------------------------------
  // Guard D: Verified DIRECT customer review can participate in Primary theme genesis
  // -----------------------------------------------------------------------------
  it("Guard D: Verified DIRECT customer review can participate in Primary theme genesis", async () => {
    const directReviewUnit: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_rev_direct_1",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Linen fabric sheer in daylight",
      semanticClaims: [{ claimId: "clm_1", claimKind: "friction_problem", meaning: "Linen fabric sheer in daylight", confidence: 0.95 }],
      confidence: 0.95,
      canonicalCompetitorId: "comp_direct_1",
      canonicalBrandName: "Sara Direct Brand",
      platform: "trustpilot",
      rawText: "The linen dress is completely sheer in daylight. Verified buyer review on Trustpilot.",
      strategicRole: "DIRECT",
      evidencePool: "PRIMARY_MARKET_VOICE",
    };

    const result = await synthesizeGlobalAudienceWithLLM(
      [directReviewUnit],
      businessContext,
      "acc_test_d"
    );

    expect(result.themes.length).toBe(1);
    expect(result.themes[0].themeId).toBe("theme_mv_fabric_sheer");
    expect(result.draft.pains.length).toBe(1);
  });

  // -----------------------------------------------------------------------------
  // Guard E: Instagram/TikTok Direct comments remain Supporting and cannot independently create themes
  // -----------------------------------------------------------------------------
  it("Guard E: Instagram/TikTok Direct comments remain Supporting and cannot independently create canonical themes", async () => {
    const directComments: TerminalEvidenceClassification[] = [
      {
        evidenceUnitId: "ev_social_1",
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: "Dress is too see through",
        semanticClaims: [{ claimId: "clm_social_1", claimKind: "friction_problem", meaning: "Dress see through", confidence: 0.9 }],
        confidence: 0.9,
        canonicalCompetitorId: "comp_direct_1",
        canonicalBrandName: "Sara Direct Brand",
        platform: "instagram",
        rawText: "Is this see through?",
        strategicRole: "DIRECT",
        evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
      },
    ];

    const result = await synthesizeGlobalAudienceWithLLM(
      directComments,
      businessContext,
      "acc_test_e"
    );

    // Invariant: 0 Primary Market Voice / Direct Review units -> 0 themes generated
    expect(result.themes.length).toBe(0);
    expect(result.draft.pains.length).toBe(0);
    expect(result.manifest.claimManifest.length).toBe(1);
  });

  // -----------------------------------------------------------------------------
  // Guard F: Adjacent reviews/comments remain Supporting
  // -----------------------------------------------------------------------------
  it("Guard F: Adjacent reviews/comments remain Supporting and corroborate Primary themes", async () => {
    const primaryUnit: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_1",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Linen fabric sheer in daylight",
      semanticClaims: [{ claimId: "clm_1", claimKind: "friction_problem", meaning: "Linen fabric sheer in daylight", confidence: 0.95 }],
      confidence: 0.95,
      canonicalCompetitorId: "market_voice",
      canonicalBrandName: "Broad Market Voice",
      platform: "reddit",
      rawText: "Linen fabric is completely see-through under bright sunlight.",
      evidencePool: "PRIMARY_MARKET_VOICE",
    };

    const adjacentComment: TerminalEvidenceClassification = {
      evidenceUnitId: "ev_social_1",
      primaryForm: "PAIN",
      semanticType: "PAIN",
      claim: "Linen dress transparency",
      semanticClaims: [{ claimId: "clm_social_1", claimKind: "friction_problem", meaning: "Linen dress transparency", confidence: 0.9 }],
      confidence: 0.9,
      canonicalCompetitorId: "comp_adjacent_1",
      canonicalBrandName: "Adjacent Brand",
      platform: "instagram",
      rawText: "The fabric looks see through in daylight.",
      strategicRole: "ADJACENT",
      evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
    };

    const result = await synthesizeGlobalAudienceWithLLM(
      [primaryUnit, adjacentComment],
      businessContext,
      "acc_test_f"
    );

    expect(result.themes.length).toBe(1);
    expect(result.themes[0].supportingEvidenceUnitIds).toContain("ev_1");
    expect(result.themes[0].supportingEvidenceUnitIds).toContain("ev_social_1");
  });

  // -----------------------------------------------------------------------------
  // Guard G: Aspirational reviews/comments remain Benchmark
  // -----------------------------------------------------------------------------
  it("Guard G: Aspirational reviews/comments remain Benchmark context", () => {
    const units: CustomerEvidenceUnit[] = [
      {
        evidenceId: "cev_asp_rev_1",
        origin: "COMPETITOR_REVIEW",
        platform: "trustpilot",
        competitorId: "comp_aspirational_1",
        strategicRole: "ASPIRATIONAL",
        evidencePool: "BENCHMARK_CONTEXT",
        accountId: "acc_test_g",
        campaignId: "camp_test_g",
        text: "Luxury silk dress was elegant but delicate.",
        author: "reviewer_1",
        authorType: "CUSTOMER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_reviews", id: "1" },
      },
    ];

    const deduped = deduplicateFromCanonicalCustomerVoice(units, compMap);
    expect(deduped.length).toBe(1);
    expect(deduped[0].evidencePool).toBe("BENCHMARK_CONTEXT");
  });

  // -----------------------------------------------------------------------------
  // Guard H: Cross-pool dedupe preserves all contributor provenance
  // -----------------------------------------------------------------------------
  it("Guard H: Cross-pool dedupe preserves all contributor provenance while elevating canonical pool", () => {
    const rawUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "cev_social_1",
        origin: "COMPETITOR_COMMENT",
        sourceId: "src_ig_1",
        platform: "instagram",
        competitorId: "comp_direct_1",
        competitorName: "Sara Direct Brand",
        strategicRole: "DIRECT",
        evidencePool: "SUPPORTING_SOCIAL_CUSTOMER_VOICE",
        accountId: "acc_test_h",
        campaignId: "camp_test_h",
        text: "The linen fabric is completely sheer in daylight.",
        author: "ig_user",
        authorType: "CUSTOMER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_comments", id: "1" },
      },
      {
        evidenceId: "cev_mv_1",
        origin: "MARKET_VOICE",
        sourceId: "src_reddit_1",
        platform: "instagram", // duplicate cross-pool
        strategicRole: "DIRECT",
        evidencePool: "PRIMARY_MARKET_VOICE",
        accountId: "acc_test_h",
        campaignId: "camp_test_h",
        text: "The linen fabric is completely sheer in daylight.",
        author: "reddit_user",
        authorType: "COMMUNITY_USER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "market_voice_evidence", id: "2" },
      },
    ];

    const dedupResult = deduplicateCustomerVoice(rawUnits);
    expect(dedupResult.uniqueUnits.length).toBe(1);
    const canonical = dedupResult.uniqueUnits[0];

    // Canonical unit is elevated to PRIMARY_MARKET_VOICE
    expect(canonical.evidencePool).toBe("PRIMARY_MARKET_VOICE");

    // All contributors preserved with full provenance
    expect(canonical.contributors).toBeDefined();
    expect(canonical.contributors?.length).toBe(2);
    expect(canonical.contributors?.[0].evidencePool).toBe("SUPPORTING_SOCIAL_CUSTOMER_VOICE");
    expect(canonical.contributors?.[0].origin).toBe("COMPETITOR_COMMENT");
    expect(canonical.contributors?.[1].evidencePool).toBe("PRIMARY_MARKET_VOICE");
    expect(canonical.contributors?.[1].origin).toBe("MARKET_VOICE");
  });
});
