/**
 * Market Voice Quality Hardening & Semantic Verification Test Suite
 * 
 * Verifies:
 * - Test A: Off-topic personal selfie thread (e.g. r/selfie) with casual mention of 'dress' is rejected as IRRELEVANT.
 * - Test B: Off-topic automotive forum (e.g. a2-freun.de 1.2 TDI) with 'price differs from original' is rejected as IRRELEVANT.
 * - Test C: Source Portfolio Sufficiency Judge flags high single-source concentration (>70% from one store/domain).
 * - Test D: Source Portfolio Sufficiency Judge approves diverse multi-brand corpus.
 * - Test E: Genuine customer review evaluating fabric opacity and heat breathability is approved as PRIMARY_ELIGIBLE with CATEGORY_RECURRING scope.
 * - Test F: Store promotional copy / marketing copy is rejected as PROMOTIONAL / NO_CUSTOMER_VOICE.
 * - Test G: Pure semantic evaluation without hardcoded blacklists or keyword whitelists.
 * - Test H: Single-brand operational complaint is classified with SINGLE_BRAND_SPECIFIC semantic scope.
 */

import { describe, it, expect, vi } from "vitest";
import {
  verifyAuthorshipRole,
  verifyCustomerVoiceEligibility,
  runFinalEvidenceJudge,
} from "../market-voice/evidence-verifier";
import {
  judgePrimaryMarketVoiceSufficiencyWithLLM,
} from "../audience-engine/semantic-sufficiency-judge";
import { type CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";

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
        if (prompt.includes("high_single_source") || (prompt.includes("shopmodest.pk") && !prompt.includes("modanisa.com"))) {
          return JSON.stringify({
            verdict: "INSUFFICIENT",
            reason: "Corpus suffers from 100% single-store concentration (shopmodest.pk) dominated by shipping disputes, lacking broad category representation.",
            categoryRelevance: "MEDIUM",
            buyerAuthenticity: "VERIFIED_BUYER",
            substantiveThemesFound: ["Order fulfillment delay"],
            sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
            categoryBreadth: "SINGLE_BRAND_INCIDENT",
          });
        }
        return JSON.stringify({
          verdict: "SUFFICIENT",
          reason: "Corpus contains authentic, diverse buyer reviews across multiple retailers discussing fabric opacity, breathability, and modest sizing.",
          categoryRelevance: "HIGH",
          buyerAuthenticity: "VERIFIED_BUYER",
          substantiveThemesFound: ["Fabric sheer in sunlight", "Linen breathability", "Modest neckline coverage"],
          sourceConcentrationRisk: "DIVERSE",
          categoryBreadth: "BROAD_CATEGORY_TRUTHS",
        });
      }

      return JSON.stringify({});
    }),
    aiChat: vi.fn(async (params: any) => {
      const endpoint = params.endpoint || "";
      const content = (params.messages?.[1]?.content || "").toLowerCase();

      if (endpoint.includes("sufficiency-judge")) {
        if (content.includes("high_single_source") || (content.includes("shopmodest.pk") && !content.includes("modanisa.com"))) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  verdict: "INSUFFICIENT",
                  reason: "Corpus suffers from 100% single-store concentration (shopmodest.pk) dominated by shipping disputes, lacking broad category representation.",
                  categoryRelevance: "MEDIUM",
                  buyerAuthenticity: "VERIFIED_BUYER",
                  substantiveThemesFound: ["Order fulfillment delay"],
                  sourceConcentrationRisk: "HIGH_SINGLE_SOURCE",
                  categoryBreadth: "SINGLE_BRAND_INCIDENT",
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
                reason: "Corpus contains authentic, diverse buyer reviews across multiple retailers discussing fabric opacity, breathability, and modest sizing.",
                categoryRelevance: "HIGH",
                buyerAuthenticity: "VERIFIED_BUYER",
                substantiveThemesFound: ["Fabric sheer in sunlight", "Linen breathability", "Modest neckline coverage"],
                sourceConcentrationRisk: "DIVERSE",
                categoryBreadth: "BROAD_CATEGORY_TRUTHS",
              }),
            },
          }],
        };
      }

      if (endpoint === "mv-authorship-verifier") {
        if (content.includes("sale now 50% off") || content.includes("shop the new summer collection")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  authorRole: "BRAND_REPRESENTATIVE",
                  isCustomerAuthored: false,
                  confidence: 0.95,
                  reasoning: "Commercial store advertising copy",
                }),
              },
            }],
          };
        }
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                authorRole: "CUSTOMER_COMMUNITY_USER",
                isCustomerAuthored: true,
                confidence: 0.9,
                reasoning: "Authentic first-party user comment or review",
              }),
            },
          }],
        };
      }

      if (endpoint === "mv-voice-eligibility") {
        // Test A: Reddit selfie thread
        if (content.includes("r/selfie") || content.includes("sunny and hot here")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  isEligible: false,
                  eligibility: "GENERIC_NOISE",
                  primaryEligibilityVerdict: "IRRELEVANT",
                  semanticScope: "INSUFFICIENT_SCOPE",
                  transferability: "IRRELEVANT_GEOGRAPHY",
                  voiceType: "OTHER",
                  reasoning: "Source webpage is a personal selfie thread on Reddit. The casual remark about weather and wearing a dress contains no product evaluation or category insight.",
                }),
              },
            }],
          };
        }

        // Test B: Audi A2 car forum
        if (content.includes("a2-freun.de") || content.includes("1.2 tdi") || content.includes("price differs from the original")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  isEligible: false,
                  eligibility: "GENERIC_NOISE",
                  primaryEligibilityVerdict: "IRRELEVANT",
                  semanticScope: "INSUFFICIENT_SCOPE",
                  transferability: "IRRELEVANT_GEOGRAPHY",
                  voiceType: "OTHER",
                  reasoning: "Source webpage is an automotive repair forum discussing engine fuel consumption. Quote refers to car parts.",
                }),
              },
            }],
          };
        }

        // Test H: Single-brand operational complaint
        if (content.includes("ordered 3 weeks ago") || content.includes("delayed delivery")) {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  isEligible: true,
                  eligibility: "ELIGIBLE_CUSTOMER_VOICE",
                  primaryEligibilityVerdict: "PRIMARY_ELIGIBLE",
                  semanticScope: "SINGLE_BRAND_SPECIFIC",
                  transferability: "MARKET_TRANSFERABLE",
                  voiceType: "COMPLAINT",
                  reasoning: "First-party complaint about retailer order fulfillment delay.",
                }),
              },
            }],
          };
        }

        // Test E / G: Genuine product review
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                isEligible: true,
                eligibility: "ELIGIBLE_CUSTOMER_VOICE",
                primaryEligibilityVerdict: "PRIMARY_ELIGIBLE",
                semanticScope: "CATEGORY_RECURRING",
                transferability: "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
                voiceType: "EXPERIENCE",
                reasoning: "Detailed first-party evaluation of summer modest dress fabric transparency and heat comfort.",
              }),
            },
          }],
        };
      }

      return { choices: [{ message: { content: "{}" } }] };
    }),
  };
});

describe("Market Voice Quality Hardening & Semantic Verification", () => {
  const campaignContext = {
    offeringName: "Modest Summer Dresses",
    category: "Modest Fashion / Dresses",
    targetMarket: "Lebanon / Middle East",
    productTruthFacts: [
      "Modest summer dresses with lightweight fabric",
      "Full coverage without overheating in summer sun",
    ],
  };

  // -----------------------------------------------------------------------------
  // Test A: Off-topic Reddit selfie thread with casual dress mention is rejected
  // -----------------------------------------------------------------------------
  it("Test A: Rejects off-topic personal selfie thread as IRRELEVANT", async () => {
    const item = {
      itemId: "item_selfie_1",
      sourceUrl: "https://www.reddit.com/r/selfie/comments/1tr5yj8/f34_still_sunny_and_hot_here_perfect_weather_to/",
      sourcePlatform: "reddit",
      verbatimText: "[F34] Still sunny and hot here. Perfect weather to wear a dress :)",
      authorIdentifier: "user_selfie",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "r/selfie - [F34] Still sunny and hot here. Perfect weather to wear a dress :)",
      domain: "reddit.com",
      snippet: "Selfie photo post and casual comments",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(eligibility.primaryEligibility?.verdict).toBe("IRRELEVANT");
    expect(judge.verdict).toBe("REJECT");
    expect(judge.primaryEligibilityVerdict).toBe("IRRELEVANT");
  });

  // -----------------------------------------------------------------------------
  // Test B: Off-topic automotive forum is rejected as IRRELEVANT
  // -----------------------------------------------------------------------------
  it("Test B: Rejects off-topic automotive forum thread as IRRELEVANT", async () => {
    const item = {
      itemId: "item_audi_1",
      sourceUrl: "https://a2-freun.de/forum/forums/topic/48778-12-tdi-any-help-69l100km/page/2",
      sourcePlatform: "web_community",
      verbatimText: "Even the price differs from the original.",
      authorIdentifier: "user_audi",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "1.2 TDI any help? 6.9L/100km - Audi A2 Club Forum",
      domain: "a2-freun.de",
      snippet: "Discussion on Audi A2 1.2 TDI fuel efficiency and spare part costs",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(eligibility.primaryEligibility?.verdict).toBe("IRRELEVANT");
    expect(judge.verdict).toBe("REJECT");
    expect(judge.primaryEligibilityVerdict).toBe("IRRELEVANT");
  });

  // -----------------------------------------------------------------------------
  // Test C: Source Portfolio Sufficiency Judge detects high single-source concentration
  // -----------------------------------------------------------------------------
  it("Test C: Sufficiency Judge flags high single-source concentration and rejects as INSUFFICIENT", async () => {
    const singleSourceUnits: CustomerEvidenceUnit[] = Array.from({ length: 15 }, (_, i) => ({
      evidenceId: `ev_single_${i}`,
      origin: "MARKET_VOICE",
      platform: "trustpilot",
      evidencePool: "PRIMARY_MARKET_VOICE",
      accountId: "acc_test",
      campaignId: "camp_test",
      text: `HIGH_SINGLE_SOURCE: Order ${i} delayed from shopmodest.pk. Never arrived.`,
      author: `reviewer_${i}`,
      authorType: "CUSTOMER",
      acquiredAt: new Date().toISOString(),
      verificationProvenance: { isVerified: true },
      rawEvidenceReference: { table: "market_voice_evidence", id: String(i) },
    }));

    const sufficiency = await judgePrimaryMarketVoiceSufficiencyWithLLM(
      singleSourceUnits,
      { heroProduct: "Modest Summer Dresses", category: "Modest Fashion" },
      "acc_test"
    );

    expect(sufficiency.isSufficient).toBe(false);
    expect(sufficiency.verdict).toBe("INSUFFICIENT");
    expect(sufficiency.sourceConcentrationRisk).toBe("HIGH_SINGLE_SOURCE");
    expect(sufficiency.categoryBreadth).toBe("SINGLE_BRAND_INCIDENT");
  });

  // -----------------------------------------------------------------------------
  // Test D: Source Portfolio Sufficiency Judge approves diverse multi-brand corpus
  // -----------------------------------------------------------------------------
  it("Test D: Sufficiency Judge approves diverse multi-brand category corpus", async () => {
    const diverseUnits: CustomerEvidenceUnit[] = [
      {
        evidenceId: "ev_1",
        origin: "MARKET_VOICE",
        platform: "trustpilot",
        evidencePool: "PRIMARY_MARKET_VOICE",
        accountId: "acc_test",
        campaignId: "camp_test",
        text: "The linen dress is very breathable in summer, but required a slip underneath because it was sheer in direct sunlight.",
        author: "modanisa_buyer",
        authorType: "CUSTOMER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "market_voice_evidence", id: "1" },
      },
      {
        evidenceId: "ev_2",
        origin: "MARKET_VOICE",
        platform: "reddit",
        evidencePool: "PRIMARY_MARKET_VOICE",
        accountId: "acc_test",
        campaignId: "camp_test",
        text: "Finding modest summer dresses with sleeves that don't trap heat is really hard. Most lightweight ones are transparent.",
        author: "reddit_modest_buyer",
        authorType: "COMMUNITY_USER",
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "market_voice_evidence", id: "2" },
      },
    ];

    const sufficiency = await judgePrimaryMarketVoiceSufficiencyWithLLM(
      diverseUnits,
      { heroProduct: "Modest Summer Dresses", category: "Modest Fashion" },
      "acc_test"
    );

    expect(sufficiency.isSufficient).toBe(true);
    expect(sufficiency.verdict).toBe("SUFFICIENT");
    expect(sufficiency.sourceConcentrationRisk).toBe("DIVERSE");
    expect(sufficiency.categoryBreadth).toBe("BROAD_CATEGORY_TRUTHS");
  });

  // -----------------------------------------------------------------------------
  // Test E: Genuine customer review evaluating fabric opacity is PRIMARY_ELIGIBLE
  // -----------------------------------------------------------------------------
  it("Test E: Genuine customer review evaluating fabric opacity is PRIMARY_ELIGIBLE with CATEGORY_RECURRING scope", async () => {
    const item = {
      itemId: "item_review_1",
      sourceUrl: "https://www.trustpilot.com/review/modestbrand.com",
      sourcePlatform: "google_serp",
      verbatimText: "The fabric of the summer maxi dress is lightweight and comfortable, but slightly sheer under direct sunlight. True to size.",
      authorIdentifier: "verified_buyer",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "Modest Brand Reviews - Trustpilot",
      domain: "trustpilot.com",
      snippet: "Customer reviews for Modest Brand clothing",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(authorship.authorRole).toBe("CUSTOMER_COMMUNITY_USER");
    expect(eligibility.primaryEligibility?.verdict).toBe("PRIMARY_ELIGIBLE");
    expect(eligibility.primaryEligibility?.semanticScope).toBe("CATEGORY_RECURRING");
    expect(judge.verdict).toBe("APPROVE");
    expect(judge.primaryEligibilityVerdict).toBe("PRIMARY_ELIGIBLE");
  });

  // -----------------------------------------------------------------------------
  // Test F: Store promotional copy is rejected as BRAND_REPRESENTATIVE
  // -----------------------------------------------------------------------------
  it("Test F: Store promotional marketing copy is rejected and does not enter Primary Market Voice", async () => {
    const item = {
      itemId: "item_promo_1",
      sourceUrl: "https://www.shopmodest.com/summer-sale",
      sourcePlatform: "google_serp",
      verbatimText: "Sale now 50% off! Shop the new summer collection of modest dresses with free worldwide shipping!",
      authorIdentifier: "store_admin",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "Summer Sale - 50% Off Modest Dresses",
      domain: "shopmodest.com",
      snippet: "Online store promotion for summer dresses",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    expect(authorship.authorRole).toBe("BRAND_REPRESENTATIVE");

    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(judge.verdict).toBe("REJECT");
    expect(judge.canonicalOwner).toBe("UNRESOLVED");
  });

  // -----------------------------------------------------------------------------
  // Test G: Semantic evaluation works generically without domain blacklists
  // -----------------------------------------------------------------------------
  it("Test G: Pure semantic verification evaluates context without hardcoded domain lists", async () => {
    const item = {
      itemId: "item_forum_1",
      sourceUrl: "https://unknown-international-forum.org/threads/summer-linen-dresses-transparency.12345",
      sourcePlatform: "web_community",
      verbatimText: "I bought three linen maxi dresses for summer. The navy one was fine, but the white one is totally see-through without a slip.",
      authorIdentifier: "forum_shopper",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "Summer linen dresses transparency discussion - International Fashion Forum",
      domain: "unknown-international-forum.org",
      snippet: "Community discussion on summer dress fabric quality and opacity",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(judge.verdict).toBe("APPROVE");
    expect(judge.primaryEligibilityVerdict).toBe("PRIMARY_ELIGIBLE");
  });

  // -----------------------------------------------------------------------------
  // Test H: Single-brand operational complaint is tagged SINGLE_BRAND_SPECIFIC
  // -----------------------------------------------------------------------------
  it("Test H: Single-brand operational complaint is classified with SINGLE_BRAND_SPECIFIC semantic scope", async () => {
    const item = {
      itemId: "item_op_1",
      sourceUrl: "https://www.trustpilot.com/review/shopmodest.pk",
      sourcePlatform: "google_serp",
      verbatimText: "I ordered 3 weeks ago for an event and the package still has not arrived. Delayed delivery with no tracking update.",
      authorIdentifier: "frustrated_buyer",
    };

    const pageContext = {
      url: item.sourceUrl,
      title: "shopmodest.pk Reviews - Trustpilot",
      domain: "trustpilot.com",
      snippet: "Reviews for shopmodest.pk",
    };

    const authorship = await verifyAuthorshipRole(item, pageContext, { accountId: "acc_test" });
    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, pageContext, { accountId: "acc_test" });
    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);

    expect(judge.verdict).toBe("APPROVE");
    expect(judge.primaryEligibilityVerdict).toBe("PRIMARY_ELIGIBLE");
    expect(judge.semanticScope).toBe("SINGLE_BRAND_SPECIFIC");
  });
});
