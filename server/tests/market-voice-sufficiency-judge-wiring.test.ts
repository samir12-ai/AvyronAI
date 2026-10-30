import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  judgePrimaryMarketVoiceSufficiencyWithLLM,
  SufficiencyJudgeContext,
} from "../audience-engine/semantic-sufficiency-judge";
import * as aiClient from "../ai-client";
import type { CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";

vi.mock("../ai-client", () => ({
  aiGemini: vi.fn(),
  aiChat: vi.fn(),
}));

describe("Primary Market Voice Sufficiency Judge — OpenAI Canonical Wiring", () => {
  const dummyContext: SufficiencyJudgeContext = {
    heroProduct: "Modest Summer Dresses",
    businessName: "Sara-ft",
    category: "Women's Fashion",
    market: "UAE",
  };

  const dummyUnits: CustomerEvidenceUnit[] = [
    {
      id: "unit-1",
      platform: "reddit",
      text: "The fabric on most modest summer dresses is too synthetic and traps heat in 45C Dubai summer.",
      author: "fashion_lover_dxb",
      sentiment: "NEGATIVE",
      origin: "MARKET_VOICE",
      verificationProvenance: {
        sourceUrl: "https://reddit.com/r/dubai/comments/123",
        verifiedAt: "2026-09-05T12:00:00Z",
      },
    },
    {
      id: "unit-2",
      platform: "trustpilot",
      text: "Breathable linen blends with opaque lining are nearly impossible to find without layering multiple pieces.",
      author: "modest_reviewer",
      sentiment: "NEGATIVE",
      origin: "MARKET_VOICE",
      verificationProvenance: {
        sourceUrl: "https://trustpilot.com/review/sara-ft",
        verifiedAt: "2026-09-05T12:05:00Z",
      },
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("A & B: calls canonical aiChat (OpenAI) with gpt-4.1-mini and never calls aiGemini", async () => {
    const chatMock = vi.mocked(aiClient.aiChat).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "SUFFICIENT",
              reason: "Corpus contains authentic buyer feedback on fabric breathability and lining opacity in summer.",
              categoryRelevance: "HIGH",
              buyerAuthenticity: "VERIFIED_BUYER",
              sourceConcentrationRisk: "DIVERSE",
              categoryBreadth: "BROAD_CATEGORY_TRUTHS",
              substantiveThemesFound: ["Breathability in high heat", "Lining opacity without overheating"],
            }),
          },
        },
      ],
    } as any);

    const result = await judgePrimaryMarketVoiceSufficiencyWithLLM(dummyUnits, dummyContext, "acc_test_123");

    // A: aiGemini is NOT called
    expect(vi.mocked(aiClient.aiGemini)).not.toHaveBeenCalled();

    // B: aiChat received canonical OpenAI parameters
    expect(chatMock).toHaveBeenCalledTimes(1);
    const callArg = chatMock.mock.calls[0][0] as any;
    expect(callArg).toBeDefined();
    expect(callArg.model).toBe("gpt-4.1-mini");
    expect(callArg.messages).toHaveLength(2);
    expect(callArg.messages[0].role).toBe("system");
    expect(callArg.messages[0].content).toContain("Modest Summer Dresses");
    expect(callArg.messages[1].role).toBe("user");
    expect(callArg.messages[1].content).toContain("Evaluate the following primary customer evidence corpus");
    expect(callArg.response_format?.type).toBe("json_object");
    expect(callArg.temperature).toBe(0.1);
    expect(callArg.accountId).toBe("acc_test_123");
    expect(callArg.endpoint).toBe("audience-primary-market-voice-sufficiency-judge");

    // C: valid OpenAI JSON produces SUFFICIENT verdict
    expect(result.isSufficient).toBe(true);
    expect(result.verdict).toBe("SUFFICIENT");
    expect(result.categoryRelevance).toBe("HIGH");
    expect(result.buyerAuthenticity).toBe("VERIFIED_BUYER");
    expect(result.substantiveThemesFound).toHaveLength(2);
  });

  it("D: malformed semantic output enters bounded repair using aiChat", async () => {
    const chatMock = vi.mocked(aiClient.aiChat)
      // Attempt 1: Invalid schema verdict (e.g. MAYBE)
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "MAYBE",
                reason: "Not sure yet.",
                categoryRelevance: "MEDIUM",
                buyerAuthenticity: "MIXED",
              }),
            },
          },
        ],
      } as any)
      // Attempt 2 (Repair): Valid schema verdict
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "SUFFICIENT",
                reason: "Repaired: Corpus demonstrates verified buyer pain points around summer fabrics.",
                categoryRelevance: "HIGH",
                buyerAuthenticity: "VERIFIED_BUYER",
                sourceConcentrationRisk: "DIVERSE",
                categoryBreadth: "BROAD_CATEGORY_TRUTHS",
                substantiveThemesFound: ["Breathability in high heat"],
              }),
            },
          },
        ],
      } as any);

    const result = await judgePrimaryMarketVoiceSufficiencyWithLLM(dummyUnits, dummyContext, "acc_test_123");

    expect(chatMock).toHaveBeenCalledTimes(2);
    // Second call is repair
    const repairCallArg = chatMock.mock.calls[1][0] as any;
    expect(repairCallArg.endpoint).toBe("audience-primary-market-voice-sufficiency-judge-repair");
    expect(repairCallArg.temperature).toBe(0.0);
    expect(repairCallArg.model).toBe("gpt-4.1-mini");

    expect(result.isSufficient).toBe(true);
    expect(result.verdict).toBe("SUFFICIENT");
  });

  it("E: provider failure remains fail-closed without fabricating synthetic success", async () => {
    const providerError = new Error("OpenAI rate limit exceeded (429)");
    vi.mocked(aiClient.aiChat).mockRejectedValue(providerError);

    const result = await judgePrimaryMarketVoiceSufficiencyWithLLM(dummyUnits, dummyContext, "acc_test_123");

    expect(result.isSufficient).toBe(false);
    expect(result.verdict).toBe("INSUFFICIENT");
    expect(result.reason).toContain("PRIMARY_MARKET_VOICE_INCOMPLETE");
  });

  it("TEST A & C: insertion-order distortion and single merchant dominance are prevented by structural sampler", async () => {
    // 60 store-specific rows inserted first
    const storeRows: CustomerEvidenceUnit[] = Array.from({ length: 60 }, (_, i) => ({
      evidenceId: `store-unit-${i}`,
      origin: "MARKET_VOICE",
      platform: "trustpilot",
      text: `Store specific shipping dispute order #${1000 + i}`,
      author: `user_${i}`,
      semanticScope: "SINGLE_BRAND_SPECIFIC",
      transferability: "BRAND_SPECIFIC",
      eligibilityVerdict: "ELIGIBLE",
      verificationProvenance: {
        sourceUrl: "https://www.trustpilot.com/review/problematic-store.com",
        isVerified: true,
      },
      rawEvidenceReference: { table: "market_voice_evidence", id: `mve_store_${i}` },
      accountId: "acc_1",
      campaignId: "camp_1",
      acquiredAt: new Date().toISOString(),
      authorType: "COMMUNITY_USER",
    }));

    // 40 category recurring rows inserted last
    const categoryRows: CustomerEvidenceUnit[] = Array.from({ length: 40 }, (_, i) => ({
      evidenceId: `cat-unit-${i}`,
      origin: "MARKET_VOICE",
      platform: "reddit",
      text: `Category insight regarding fabric breathability and heat resistance #${i}`,
      author: `reddit_user_${i}`,
      semanticScope: "CATEGORY_RECURRING",
      transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
      eligibilityVerdict: "ELIGIBLE",
      verificationProvenance: {
        sourceUrl: `https://www.reddit.com/r/modestdress/comments/test_${i}`,
        isVerified: true,
      },
      rawEvidenceReference: { table: "market_voice_evidence", id: `mve_cat_${i}` },
      accountId: "acc_1",
      campaignId: "camp_1",
      acquiredAt: new Date().toISOString(),
      authorType: "COMMUNITY_USER",
    }));

    const fullCorpus = [...storeRows, ...categoryRows];

    const chatMock = vi.mocked(aiClient.aiChat).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        verdict: "SUFFICIENT",
        reason: "Broad category truths around fabric breathability are present.",
        categoryRelevance: "HIGH",
        buyerAuthenticity: "VERIFIED_BUYER",
        sourceConcentrationRisk: "DIVERSE",
        categoryBreadth: "BROAD_CATEGORY_TRUTHS",
        substantiveThemesFound: ["Fabric breathability"],
      }) } }],
    } as any);

    await judgePrimaryMarketVoiceSufficiencyWithLLM(fullCorpus, dummyContext, "acc_test_123");

    expect(chatMock).toHaveBeenCalledTimes(1);
    const callArg = chatMock.mock.calls[0][0] as any;
    const userPrompt = callArg.messages[1].content;

    // Assert broad category items (inserted last in array) are preserved in prompt
    expect(userPrompt).toContain("Scope: CATEGORY_RECURRING");
    expect(userPrompt).toContain("Category insight regarding fabric breathability");
    // Assert single store does not crowd out category evidence
    expect(userPrompt).toContain("r/modestdress");
  });

  it("TEST B: every serialized evidence item preserves canonical semantic metadata", async () => {
    const chatMock = vi.mocked(aiClient.aiChat).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        verdict: "SUFFICIENT",
        reason: "Metadata verified.",
        categoryRelevance: "HIGH",
        buyerAuthenticity: "VERIFIED_BUYER",
        sourceConcentrationRisk: "DIVERSE",
        categoryBreadth: "BROAD_CATEGORY_TRUTHS",
        substantiveThemesFound: ["Fabric breathability"],
      }) } }],
    } as any);

    const testUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "unit-meta-1",
        origin: "MARKET_VOICE",
        platform: "reddit",
        text: "Linen is essential for hot weather modest wear.",
        author: "modest_expert",
        semanticScope: "CATEGORY_RECURRING",
        transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        eligibilityVerdict: "ELIGIBLE",
        verificationProvenance: {
          sourceUrl: "https://www.reddit.com/r/modestdress/comments/xyz",
          isVerified: true,
        },
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_1" },
        accountId: "acc_1",
        campaignId: "camp_1",
        acquiredAt: new Date().toISOString(),
        authorType: "COMMUNITY_USER",
      },
    ];

    await judgePrimaryMarketVoiceSufficiencyWithLLM(testUnits, dummyContext, "acc_test_123");

    const callArg = chatMock.mock.calls[0][0] as any;
    const userPrompt = callArg.messages[1].content;

    expect(userPrompt).toContain("Scope: CATEGORY_RECURRING");
    expect(userPrompt).toContain("Transferability: GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH");
    expect(userPrompt).toContain("Eligibility: ELIGIBLE");
    expect(userPrompt).toContain("Source Entity: r/modestdress");
    expect(userPrompt).toContain("Platform: reddit");
  });

  it("TEST D: mirrored evidence across multiple URLs does not gain duplicate representation", async () => {
    const duplicateReviewText = "This dress shrank after one cold wash and became unwearable.";

    const mirrorUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "unit-us-mirror",
        origin: "MARKET_VOICE",
        platform: "trustpilot",
        text: duplicateReviewText,
        author: "reviewer_1",
        semanticScope: "SINGLE_BRAND_SPECIFIC",
        transferability: "BRAND_SPECIFIC",
        eligibilityVerdict: "ELIGIBLE",
        verificationProvenance: {
          sourceUrl: "https://www.trustpilot.com/review/brand.com",
          isVerified: true,
        },
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_us" },
        accountId: "acc_1",
        campaignId: "camp_1",
        acquiredAt: new Date().toISOString(),
        authorType: "COMMUNITY_USER",
      },
      {
        evidenceId: "unit-au-mirror",
        origin: "MARKET_VOICE",
        platform: "trustpilot",
        text: duplicateReviewText, // Exact same verbatim quote
        author: "reviewer_1",
        semanticScope: "SINGLE_BRAND_SPECIFIC",
        transferability: "BRAND_SPECIFIC",
        eligibilityVerdict: "ELIGIBLE",
        verificationProvenance: {
          sourceUrl: "https://au.trustpilot.com/review/brand.com?page=2",
          isVerified: true,
        },
        rawEvidenceReference: { table: "market_voice_evidence", id: "mve_au" },
        accountId: "acc_1",
        campaignId: "camp_1",
        acquiredAt: new Date().toISOString(),
        authorType: "COMMUNITY_USER",
      },
    ];

    const chatMock = vi.mocked(aiClient.aiChat).mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        verdict: "INSUFFICIENT",
        reason: "Only single duplicate review.",
        categoryRelevance: "LOW",
        buyerAuthenticity: "VERIFIED_BUYER",
        sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
        categoryBreadth: "SINGLE_BRAND_INCIDENT",
        substantiveThemesFound: [],
      }) } }],
    } as any);

    await judgePrimaryMarketVoiceSufficiencyWithLLM(mirrorUnits, dummyContext, "acc_test_123");

    const callArg = chatMock.mock.calls[0][0] as any;
    const systemPrompt = callArg.messages[0].content;
    const userPrompt = callArg.messages[1].content;

    // Telemetry reflects 2 raw units but only 1 deduplicated unit
    expect(systemPrompt).toContain('"totalRawPrimaryUnits": 2');
    expect(systemPrompt).toContain('"totalDeduplicatedUnits": 1');

    // Prompt contains the quote only once
    const matches = userPrompt.split(duplicateReviewText).length - 1;
    expect(matches).toBe(1);
  });
});

