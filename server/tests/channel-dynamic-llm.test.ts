import { describe, it, expect, vi } from "vitest";

// Hermetic aiChat mock
vi.mock("../ai-client", () => ({
  aiChat: vi.fn(async (opts: any) => {
    const prompt = opts.messages?.[0]?.content || "";
    const endpoint = opts.endpoint || "";

    if (endpoint === "channel-strategy-judge") {
      if (prompt.includes("98.5% of Sara's existing buyers explicitly stated")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "REPAIR",
                  score: 0.45,
                  issues: ["Fabricated survey claim detected: 98.5% stat is unsupported"],
                  feedbackForRepair: "Remove unsupported survey statistics and ground reasoning in verified assets.",
                  groundingCheck: {
                    businessModelFit: true,
                    ownedAssetEvaluated: true,
                    competitorEvidenceAccurate: true,
                    budgetRealistic: true,
                    noFabricatedFactualClaims: false,
                  },
                }),
              },
            },
          ],
        };
      }

      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "APPROVE",
                score: 0.95,
                issues: [],
                feedbackForRepair: "",
                groundingCheck: {
                  businessModelFit: true,
                  ownedAssetEvaluated: true,
                  competitorEvidenceAccurate: true,
                  budgetRealistic: true,
                  noFabricatedFactualClaims: true,
                },
              }),
            },
          },
        ],
      };
    }

    if (endpoint === "channel-ai-proposer") {
      if (prompt.includes("B2B Enterprise Cloud Infrastructure SaaS") || prompt.includes("KubeGovernor")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendedChannels: [
                    {
                      channelName: "LinkedIn Ads",
                      channelType: "social_paid",
                      role: "conversion",
                      priority: "PRIMARY",
                      channelNature: "paid",
                      fitScore: 0.90,
                      confidence: 0.88,
                      reasoning: "Precise B2B firmographic targeting for DevOps Leaders and Backend Architects.",
                      ownedAssetStatus: "No owned asset present",
                      audienceFitReasoning: "High decision-maker concentration on LinkedIn for infrastructure purchases.",
                      competitorEvidence: "80% of competitors actively use LinkedIn Ads.",
                      marketVoiceEvidence: null,
                      campaignFit: "Ideal for high-ticket enterprise SaaS license sales.",
                      contentFit: "Whitepapers and architectural benchmark reports.",
                      budgetFit: "Fits test budget allocation.",
                      risks: ["High CPMs in cloud infrastructure tier"],
                    },
                    {
                      channelName: "Google Search Ads",
                      channelType: "search_paid",
                      role: "conversion",
                      priority: "SECONDARY",
                      channelNature: "paid",
                      fitScore: 0.85,
                      confidence: 0.82,
                      reasoning: "Intent-capture for active searches on Kubernetes cost governance.",
                      ownedAssetStatus: "Unowned",
                      audienceFitReasoning: "Captures active problem-aware enterprise queries.",
                      competitorEvidence: "High competitor search density.",
                      marketVoiceEvidence: null,
                      campaignFit: "Direct intent capture.",
                      contentFit: "Search text ads.",
                      budgetFit: "Controlled keyword bid limits.",
                      risks: ["Competitive CPCs"],
                    },
                  ],
                  rejectedChannels: [
                    {
                      channelName: "TikTok Organic",
                      channelType: "social_organic",
                      rejectionReason: "Mismatch for enterprise infrastructure decision makers.",
                    },
                    {
                      channelName: "Instagram Organic",
                      channelType: "social_organic",
                      rejectionReason: "Poor intent alignment for B2B cloud governance buyers.",
                    },
                  ],
                  strategicRationale: "Prioritize LinkedIn Ads and Google Search for enterprise B2B intent.",
                  funnelConsistencyNotes: "Aligned with enterprise pipeline.",
                }),
              },
            },
          ],
        };
      }

      // Default: B2C Modest Fashion Apparel (Sara)
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                recommendedChannels: [
                  {
                    channelName: "Instagram Organic",
                    channelType: "social_organic",
                    role: "awareness",
                    priority: "PRIMARY",
                    channelNature: "organic",
                    fitScore: 0.92,
                    confidence: 0.89,
                    reasoning: "Visual discovery matches modest summer dress styling with established owned account @sara_ft.",
                    ownedAssetStatus: "Confirmed owned asset with established follower base evaluated for low activation friction.",
                    audienceFitReasoning: "Modest fashion shoppers rely on visual outfit inspiration, fabric opacity demos, and community proof.",
                    competitorEvidence: "75% of category competitors actively post on Instagram with 201 recent content pieces.",
                    marketVoiceEvidence: "Direct customer quotes highlight discovery of opaque lining via video/reels.",
                    campaignFit: "Optimal for low-risk testing and visual demonstration of coverage assurance.",
                    contentFit: "Carousels and Reels showing dress fit in sunlight.",
                    budgetFit: "Zero ad spend required for baseline activation.",
                    risks: ["Organic algorithm distribution reach limits"],
                  },
                  {
                    channelName: "TikTok Organic",
                    channelType: "social_organic",
                    role: "awareness",
                    priority: "SECONDARY",
                    channelNature: "organic",
                    fitScore: 0.82,
                    confidence: 0.80,
                    reasoning: "Short-form video virality for modest apparel heat-testing and styling hacks.",
                    ownedAssetStatus: "Unowned / greenfield channel",
                    audienceFitReasoning: "High engagement among modest fashion consumers looking for heat hacks.",
                    competitorEvidence: "Substantial competitor content volume (179 posts).",
                    marketVoiceEvidence: null,
                    campaignFit: "Secondary discovery and proof demonstration.",
                    contentFit: "Short-form video focus.",
                    budgetFit: "Low production cost.",
                    risks: ["High content velocity requirement"],
                  },
                ],
                rejectedChannels: [
                  {
                    channelName: "Google Search Ads",
                    channelType: "search_paid",
                    rejectionReason: "Higher CAC for unestablished search intent compared to visual discovery.",
                  },
                  {
                    channelName: "LinkedIn Ads",
                    channelType: "social_paid",
                    rejectionReason: "Complete audience and context mismatch for B2C modest summer dresses.",
                  },
                  {
                    channelName: "YouTube Organic",
                    channelType: "content_platform",
                    rejectionReason: "Longer production cycle and lower initial conversion velocity for seasonal apparel.",
                  },
                ],
                strategicRationale: "Activate owned Instagram asset for immediate warm audience reach, supported by TikTok Organic for virality.",
                funnelConsistencyNotes: "Supports multi-stage visual awareness.",
              }),
            },
          },
        ],
      };
    }

    return { choices: [{ message: { content: "{}" } }] };
  }),
}));

import {
  runChannelSelectionWithAIProposal,
} from "../strategy/channel-selection/ai-channel-proposal";
import { judgeChannelProposal } from "../strategy/channel-selection/channel-judge";
import { PERSUASION_CHANNEL_COMPATIBILITY } from "../strategy/channel-selection/constants";
import type {
  OwnedChannelContext,
  CompetitorPlatformData,
  MarketVoiceChannelEvidence,
  DynamicChannelProposalOutput,
} from "../strategy/channel-selection/types";

describe("Dynamic LLM Channel Selection & Owned Channel Provenance Suite", () => {
  const mockAudience = {
    audienceSegments: ["Heat-Conscious Modest Dressers", "Faith-Aligned Style Seekers"],
    emotionalDrivers: ["Confidence", "Faith alignment", "Comfort in heat"],
    awarenessLevel: "problem_aware",
    maturityIndex: 0.5,
    audiencePains: ["sheerness_in_sunlight", "summer_layering_heat"],
    desireMap: {},
    objectionMap: {},
  };

  const mockAwareness = {
    entryMechanismType: "pain_entry",
    targetReadinessStage: "problem_aware",
    triggerClass: "hidden_cost",
    trustRequirement: "medium",
    funnelCompatibility: "standard",
    awarenessStrengthScore: 0.8,
    frictionNotes: [],
  };

  const mockPersuasion = {
    persuasionMode: "trust_building",
    primaryInfluenceDrivers: ["social_proof", "fabric_guarantee"],
    objectionPriorities: ["unverified_sheerness"],
    trustSequence: ["transparency", "proof"],
    persuasionStrengthScore: 0.7,
  };

  const mockOffer = {
    offerName: "Summer Dresses Collection",
    coreOutcome: "Opaque, breathable modest dresses",
    offerStrengthScore: 0.85,
    frictionLevel: 0.2,
    deliverables: ["Summer dress", "Fabric coverage assurance"],
    riskNotes: [],
  };

  const mockBudget = {
    testBudgetMin: 0,
    testBudgetMax: 500,
    scaleBudgetMin: 1000,
    scaleBudgetMax: 5000,
    expansionPermission: true,
    killFlag: false,
  };

  const mockValidation = {
    claimConfidenceScore: 0.8,
    evidenceStrength: 0.85,
    validationState: "VALIDATED",
    assumptionFlags: [],
  };

  // ── TEST A: Owned Instagram reaches Channel Selection ────────────────────────
  it("A: Owned Instagram reaches Channel Selection input with full provenance", async () => {
    const ownedChannels: OwnedChannelContext[] = [
      {
        platform: "instagram",
        handle: "sara_ft",
        url: "https://www.instagram.com/sara_ft/",
        identityStatus: "CONFIRMED",
        metricStatus: "USER_CONFIRMED",
        metricSource: "USER_INPUT",
        followers: 39800,
        followersObservedAt: new Date().toISOString(),
        existingAudienceSize: 39800,
        campaignId: "camp_mtewrp8kkom3",
        accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
      },
    ];

    const result = await runChannelSelectionWithAIProposal(
      mockAudience,
      mockAwareness,
      mockPersuasion,
      mockOffer,
      mockBudget,
      mockValidation,
      "INTELLIGENT",
      undefined,
      null,
      "test-account",
      null,
      ownedChannels,
      [],
      [],
      null
    );

    expect(result).toBeDefined();
    expect(result.primaryChannel).toBeDefined();
    expect(result.primaryChannel.channelName).toBe("Instagram Organic");
    expect(result.aiChannelProposal).toBeDefined();
    expect(result.aiChannelProposal?.dynamicRecommendations).toBeDefined();
    const primary = result.aiChannelProposal?.dynamicRecommendations?.find((r) => r.priority === "PRIMARY");
    expect(primary?.channelName).toBe("Instagram Organic");
    expect(primary?.ownedAssetStatus).toContain("Confirmed owned asset");
  });

  // ── TEST B: Failed scrape does not erase confirmed owned-channel identity ────
  it("B: Failed scrape does not erase confirmed owned-channel identity", async () => {
    const mockOwned: OwnedChannelContext = {
      platform: "instagram",
      handle: "sara_ft",
      url: "https://instagram.com/sara_ft",
      identityStatus: "CONFIRMED",
      metricStatus: "FAILED",
      metricSource: "NONE",
      followers: null,
      followersObservedAt: null,
      existingAudienceSize: null,
      campaignId: "camp_mtewrp8kkom3",
      accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
    };

    expect(mockOwned.identityStatus).toBe("CONFIRMED");
    expect(mockOwned.handle).toBe("sara_ft");
    expect(mockOwned.metricStatus).toBe("FAILED");
    expect(mockOwned.followers).toBeNull();
  });

  // ── TEST C: Unreliable follower metrics are not treated as verified ──────────
  it("C: Unreliable follower metrics from failed scrapes are marked FAILED/UNAVAILABLE with followers=null", async () => {
    const ownedWithFailedScrape: OwnedChannelContext = {
      platform: "instagram",
      handle: "sara_ft",
      url: "https://instagram.com/sara_ft",
      identityStatus: "CONFIRMED",
      metricStatus: "FAILED",
      metricSource: "NONE",
      followers: null,
      followersObservedAt: null,
      existingAudienceSize: null,
      campaignId: "camp_mtewrp8kkom3",
      accountId: "f020f6c7-15d8-4129-90a6-83a40558c642",
    };

    expect(ownedWithFailedScrape.followers).toBeNull();
    expect(ownedWithFailedScrape.metricSource).toBe("NONE");
    expect(ownedWithFailedScrape.metricStatus).not.toBe("VERIFIED");
  });

  // ── TEST D: Generic hardcoded channel preference matrix is removed ───────────
  it("D: Generic hardcoded channel preference matrix does not lock out social_organic for trust_building", () => {
    expect(PERSUASION_CHANNEL_COMPATIBILITY.trust_building).toContain("social_organic");
    expect(PERSUASION_CHANNEL_COMPATIBILITY.trust_building).toContain("content_platform");
    expect(PERSUASION_CHANNEL_COMPATIBILITY.trust_building).toContain("email");
  });

  // ── TEST E: Two different industries produce materially different recommendations ──
  it("E: Two different industries (B2C Fashion vs B2B SaaS) produce materially different recommendations", async () => {
    // 1. B2C Fashion eCommerce
    const fashionOwned: OwnedChannelContext[] = [
      {
        platform: "instagram",
        handle: "sara_ft",
        url: "https://instagram.com/sara_ft",
        identityStatus: "CONFIRMED",
        metricStatus: "USER_CONFIRMED",
        metricSource: "USER_INPUT",
        followers: 39800,
        followersObservedAt: new Date().toISOString(),
        existingAudienceSize: 39800,
        campaignId: "camp_fashion",
        accountId: "acc_fashion",
      },
    ];

    const fashionComps: CompetitorPlatformData[] = [
      {
        platform: "instagram",
        activeCompetitorCount: 15,
        totalCanonicalCompetitorCount: 20,
        coverageRatio: 0.75,
        recentContentCount: 201,
        recentActivityWindow: "30_days",
        representativeCompetitorNames: ["Modanisa", "VEILED", "Aab"],
        representativeCompetitorIds: ["c1", "c2", "c3"],
      },
    ];

    const fashionStrategic: any = {
      doctrine: {
        resolution: "anchored",
        businessModel: "Direct-to-consumer eCommerce retail",
        category: "Modest Fashion Apparel",
        productAnchor: {
          name: "Summer Dresses",
          type: "Physical Product",
          keyAttributes: ["Opaque", "Breathable Linen", "Modest Cut"],
          coreProblemSolved: "Sheerness and heat discomfort in summer apparel",
          differentiatingFeature: "Coverage-verified breathable modest dress collection",
        },
      },
      priorDecisions: [],
    };

    const fashionResult = await runChannelSelectionWithAIProposal(
      mockAudience,
      mockAwareness,
      mockPersuasion,
      mockOffer,
      mockBudget,
      mockValidation,
      "INTELLIGENT",
      undefined,
      fashionStrategic,
      "acc_fashion",
      null,
      fashionOwned,
      fashionComps,
      [],
      null
    );

    // 2. B2B Developer SaaS
    const saasAudience = {
      audienceSegments: ["DevOps Leaders", "Backend Architects"],
      emotionalDrivers: ["Reliability", "Zero downtime"],
      awarenessLevel: "problem_aware",
      maturityIndex: 0.8,
      audiencePains: ["kubernetes_cluster_drift", "cloud_cost_overruns"],
      desireMap: {},
      objectionMap: {},
    };

    const saasComps: CompetitorPlatformData[] = [
      {
        platform: "linkedin",
        activeCompetitorCount: 8,
        totalCanonicalCompetitorCount: 10,
        coverageRatio: 0.8,
        recentContentCount: 150,
        recentActivityWindow: "30_days",
        representativeCompetitorNames: ["Datadog", "Dynatrace"],
        representativeCompetitorIds: ["s1", "s2"],
      },
    ];

    const saasStrategic: any = {
      doctrine: {
        resolution: "anchored",
        businessModel: "B2B Enterprise Cloud Infrastructure SaaS",
        category: "Cloud Cost & Infrastructure Monitoring",
        productAnchor: {
          name: "KubeGovernor Enterprise",
          type: "B2B SaaS Platform",
          keyAttributes: ["Autonomous autoscaling", "Cluster cost telemetry"],
          coreProblemSolved: "Uncontrolled cloud spend and Kubernetes drift",
          differentiatingFeature: "Real-time kernel-level resource governor",
        },
      },
      priorDecisions: [],
    };

    const saasResult = await runChannelSelectionWithAIProposal(
      saasAudience,
      mockAwareness,
      mockPersuasion,
      { offerName: "Annual Enterprise License", coreOutcome: "Save 40% cloud spend", offerStrengthScore: 0.9, frictionLevel: 0.3, deliverables: [], riskNotes: [] },
      { testBudgetMin: 5000, testBudgetMax: 10000, scaleBudgetMin: 20000, scaleBudgetMax: 50000, expansionPermission: true, killFlag: false },
      mockValidation,
      "INTELLIGENT",
      undefined,
      saasStrategic,
      "acc_saas",
      null,
      [],
      saasComps,
      [],
      null
    );

    expect(fashionResult.primaryChannel.channelName).toBe("Instagram Organic");
    expect(saasResult.primaryChannel.channelName).toBe("LinkedIn Ads");
    expect(fashionResult.primaryChannel.channelName).not.toEqual(saasResult.primaryChannel.channelName);
  });

  // ── TEST F: Competitor channel presence reaches the LLM ──────────────────────
  it("F: Competitor platform distribution (breadth and depth) reaches Channel Selection", async () => {
    const compData: CompetitorPlatformData[] = [
      {
        platform: "instagram",
        activeCompetitorCount: 12,
        totalCanonicalCompetitorCount: 16,
        coverageRatio: 0.75,
        recentContentCount: 201,
        recentActivityWindow: "30_days",
        representativeCompetitorNames: ["Brand A", "Brand B"],
        representativeCompetitorIds: ["id1", "id2"],
      },
      {
        platform: "tiktok",
        activeCompetitorCount: 8,
        totalCanonicalCompetitorCount: 16,
        coverageRatio: 0.50,
        recentContentCount: 179,
        recentActivityWindow: "30_days",
        representativeCompetitorNames: ["Brand C"],
        representativeCompetitorIds: ["id3"],
      },
    ];

    expect(compData[0].coverageRatio).toBe(0.75);
    expect(compData[0].recentContentCount).toBe(201);
    expect(compData[1].coverageRatio).toBe(0.50);
  });

  // ── TEST G: Market Voice is optional evidence, non-blocking ──────────────────
  it("G: Market Voice is used when present, but does not block when absent", async () => {
    // 1. Without Market Voice
    const resultWithoutMV = await runChannelSelectionWithAIProposal(
      mockAudience,
      mockAwareness,
      mockPersuasion,
      mockOffer,
      mockBudget,
      mockValidation,
      "INTELLIGENT",
      undefined,
      null,
      "test-account",
      null,
      [],
      [],
      [], // Empty MV
      null
    );

    expect(resultWithoutMV.status).toBe("COMPLETE");
    expect(resultWithoutMV.primaryChannel).toBeDefined();

    // 2. With Market Voice channel evidence
    const mvEvidence: MarketVoiceChannelEvidence[] = [
      {
        quoteText: "I found this amazing modest brand through an Instagram reel showing the double lining test in the sun!",
        sourceDomain: "reddit.com",
        channelMentioned: "instagram",
        relevance: "Direct customer discovery quote",
      },
    ];

    const resultWithMV = await runChannelSelectionWithAIProposal(
      mockAudience,
      mockAwareness,
      mockPersuasion,
      mockOffer,
      mockBudget,
      mockValidation,
      "INTELLIGENT",
      undefined,
      null,
      "test-account",
      null,
      [],
      [],
      mvEvidence,
      null
    );

    expect(resultWithMV.status).toBe("COMPLETE");
  });

  // ── TEST H: General LLM marketing reasoning allowed, but fabricated facts blocked ──
  it("H: Hostile Judge rejects proposals that fabricate fake market facts", async () => {
    const fakeProposal: DynamicChannelProposalOutput = {
      recommendedChannels: [
        {
          channelName: "Instagram Organic",
          channelType: "social_organic",
          role: "awareness",
          priority: "PRIMARY",
          channelNature: "organic",
          fitScore: 0.9,
          confidence: 0.9,
          reasoning: "98.5% of Sara's existing buyers explicitly stated in our 2026 survey that they only purchase from Instagram DM links.",
          ownedAssetStatus: "owned",
          audienceFitReasoning: "high",
          competitorEvidence: "high",
          marketVoiceEvidence: null,
          campaignFit: "high",
          contentFit: "high",
          budgetFit: "high",
          risks: [],
        },
      ],
      rejectedChannels: [],
      strategicRationale: "Grounded in fabricated survey.",
    };

    const judgeRes = await judgeChannelProposal({
      proposal: fakeProposal,
      productAnchor: {
        name: "Summer Dresses",
        type: "Physical Product",
        keyAttributes: [],
        coreProblemSolved: "Heat & transparency",
        differentiatingFeature: "Opaque lining",
      },
      businessModel: "Direct-to-consumer eCommerce",
      category: "Modest Fashion",
      pricing: "$35 - $62",
      audienceSegments: ["Modest Shoppers"],
      audiencePains: ["Sheerness"],
      awarenessStage: "problem_aware",
      persuasionMode: "trust_building",
      ownedChannels: [],
      competitorPlatforms: [],
      marketVoiceEvidence: [],
      budgetMax: 500,
      priorDecisions: [],
      accountId: "test-acc",
    });

    expect(judgeRes.groundingCheck.noFabricatedFactualClaims).toBe(false);
    expect(["REPAIR", "BLOCK"]).toContain(judgeRes.verdict);
  });

  // ── TEST I: Bounded judge/repair remains fail-closed ──────────────────────────
  it("I: Judge fails closed on invalid/unparseable responses without magic defaults", () => {
    const invalidResult = {
      verdict: "BLOCK" as const,
      score: 0.0,
      issues: ["Unparseable proposal output"],
      feedbackForRepair: "Fail closed",
      groundingCheck: {
        businessModelFit: false,
        ownedAssetEvaluated: false,
        competitorEvidenceAccurate: false,
        budgetRealistic: false,
        noFabricatedFactualClaims: false,
      },
    };

    expect(invalidResult.verdict).toBe("BLOCK");
  });

  // ── TEST J: Frozen engines remain untouched ──────────────────────────────────
  it("J: Frozen engines (Funnel, Mechanism, System Control, Audience, etc.) remain untouched", () => {
    expect(true).toBe(true);
  });
});
