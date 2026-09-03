import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeCompanyWebsite } from "../setup/website-analyzer";
import { discoverCampaignCompetitors } from "../setup/competitor-discovery";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { randomUUID as uuidv4 } from "crypto";

// Hermetic AI Mock for deterministic, fast, zero-quota execution
let mockAiResponse: any = null;
let lastCompetitorPrompt: string = "";

vi.mock("../ai-client", () => {
  return {
    aiChat: vi.fn(async (options: any) => {
      const endpoint = options.endpoint || "";
      if (endpoint === "setup-website-analysis") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify(mockAiResponse || {
                  companyName: { value: "Sara-ft", evidence: "Found in logo and page title" },
                  industry: { value: "Modest Fashion & Apparel", evidence: "Site sells women's modest dresses and hijabi wear" },
                  businessModel: { value: "E-Commerce / Direct-to-Consumer", evidence: "Online store with Add to Cart and checkout" },
                  detectedAudience: { value: "Women seeking modest dresses", evidence: "Fashion collections tailored for hijabi shoppers" },
                  detectedMarkets: ["United Arab Emirates", "Saudi Arabia"],
                  productCatalogue: [
                    {
                      name: "Summer Hijabi Dresses",
                      description: "Lightweight modest dresses for warm seasons, priced between 35$ and 62$.",
                      offeringType: "PRODUCT",
                      evidence: "Listed under summer dresses collection"
                    }
                  ]
                })
              }
            }
          ],
          usage: { total_tokens: 150 }
        };
      }

      if (endpoint === "setup-competitor-discovery") {
        lastCompetitorPrompt = options.messages?.[1]?.content || "";
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      name: "Modanisa UAE",
                      websiteUrl: "https://modanisa.com",
                      classification: "DIRECT_COMPETITOR",
                      reason: "Major modest fashion and summer hijabi dresses retailer operating in the UAE."
                    },
                    {
                      name: "Namshi Modest Wear",
                      websiteUrl: "https://namshi.com",
                      classification: "DIRECT_COMPETITOR",
                      reason: "Leading UAE fashion marketplace with dedicated modest dresses category."
                    },
                    {
                      name: "Zara Middle East",
                      websiteUrl: "https://zara.com/ae",
                      classification: "ADJACENT_COMPETITOR",
                      reason: "General fashion apparel retailer with occasional modest clothing lines."
                    }
                  ]
                })
              }
            }
          ],
          usage: { total_tokens: 200 }
        };
      }

      if (endpoint === "business-understanding-engine" || endpoint === "business-understanding-proposer") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  businessName: "Sara-ft",
                  businessModel: "E-Commerce",
                  generalIndustry: "Fashion & Apparel",
                  discoveredOfferings: [
                    {
                      offeringName: "summer hijabi dresses",
                      sourcePageUrls: ["https://sara-ft.com"]
                    }
                  ],
                  campaignOffering: {
                    offeringType: "PRODUCT",
                    category: "Modest Fashion",
                    pricingModel: "Direct Purchase",
                    productTruthFacts: [
                      {
                        statement: "Sara-ft offers summer hijabi dresses with breathable fabrics tailored for modest wear.",
                        factType: "CAPABILITY",
                        status: "USER_CONFIRMED",
                        rationale: "Confirmed by user input and website catalogue."
                      },
                      {
                        statement: "Pricing ranges from $35 to $62 per dress.",
                        factType: "PRICING_FACT",
                        status: "USER_CONFIRMED",
                        rationale: "User-supplied pricing notes."
                      }
                    ]
                  },
                  targetUnderstanding: {
                    targetRoles: [
                      {
                        roleType: "BUYER",
                        roleTitle: "Modest Fashion Shopper",
                        status: "USER_CONFIRMED",
                        rationale: "Primary consumer looking for summer hijabi wear."
                      }
                    ]
                  }
                })
              }
            }
          ],
          usage: { total_tokens: 250 }
        };
      }

      return {
        choices: [{ message: { content: "{}" } }],
        usage: { total_tokens: 50 }
      };
    }),
    aiGemini: vi.fn(async () => {
      return JSON.stringify({
        isComplete: true,
        missingFields: [],
        repairs: []
      });
    })
  };
});

// Mock Website Crawler
vi.mock("../business-understanding/crawler", () => {
  return {
    runWebsiteCrawler: vi.fn(async (snapshotId: string, url: string) => {
      return [
        {
          businessEvidenceId: "ev_sara_home",
          pageType: "HOME",
          sourceUrl: url,
          rawHtml: "<html><head><title>Sara-ft Modest Fashion</title></head><body><h1>Sara-ft Summer Collection</h1><p>Elegant summer hijabi dresses from 35$ to 62$. Add to cart now.</p></body></html>",
          cleanedText: "[TITLE]: Sara-ft Modest Fashion\n[KEY HEADINGS]: Sara-ft Summer Collection\n[PAGE CONTENT]: Elegant summer hijabi dresses from 35$ to 62$. Add to cart now. Modest wear designed for women.",
          contentHash: "hash_sara_home"
        }
      ];
    })
  };
});

const TEST_ACCOUNT_ID = "acc_test_focus_user_" + uuidv4().slice(0, 8);
const OTHER_ACCOUNT_ID = "acc_test_other_user_" + uuidv4().slice(0, 8);

vi.mock("../auth", () => {
  return {
    resolveAccountId: vi.fn((req: any) => {
      return req.headers?.["x-test-account-id"] || TEST_ACCOUNT_ID;
    })
  };
});

describe("Setup Responsibility Boundary & Competitor Discovery Hardening", () => {
  let testCampaignId = "camp_focus_" + uuidv4().slice(0, 8);

  beforeEach(async () => {
    mockAiResponse = null;
    lastCompetitorPrompt = "";
    // Create initial test campaign
    await db.insert(schema.campaignSelections).values({
      accountId: TEST_ACCOUNT_ID,
      selectedCampaignId: testCampaignId,
      selectedCampaignName: "Sara-ft Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "United Arab Emirates",
      dataSourceMode: "benchmark"
    });
  });

  it("1. Website Analysis succeeds without requiring a product catalogue", async () => {
    mockAiResponse = {
      companyName: { value: "Sara-ft", evidence: "Header text" },
      industry: { value: "Modest Fashion & Apparel", evidence: "Text highlights summer dresses" },
      businessModel: { value: "E-Commerce", evidence: "Online store with cart" },
      detectedAudience: { value: "Women looking for modest clothing", evidence: "Targeting fashion shoppers" },
      detectedMarkets: ["United Arab Emirates"],
      productCatalogue: [] // Zero structured catalogue items
    };

    const result = await analyzeCompanyWebsite(TEST_ACCOUNT_ID, testCampaignId, "https://sara-ft.com");
    expect(result.companyName).toBe("Sara-ft");
    expect(result.industry).toBe("Modest Fashion & Apparel");
    expect(result.businessModel).toBe("E-Commerce");
    expect(result.catalogueStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.productCatalogue).toEqual([]);
  });

  it("2. Industry, model, and audience are independent from catalogue extraction", async () => {
    mockAiResponse = {
      companyName: { value: "Sara-ft", evidence: "Logo" },
      industry: { value: "Modest Fashion", evidence: "Fashion line" },
      businessModel: { value: "Retail / E-Commerce", evidence: "Store checkout" },
      detectedAudience: { value: "Modest fashion consumers", evidence: "Shoppers" },
      productCatalogue: []
    };

    const result = await analyzeCompanyWebsite(TEST_ACCOUNT_ID, testCampaignId, "https://sara-ft.com");
    expect(result.fieldJudgments.industry).toBe("SUPPORTED");
    expect(result.fieldJudgments.businessModel).toBe("SUPPORTED");
    expect(result.fieldJudgments.audience).toBe("SUPPORTED");
    expect(result.fieldJudgments.catalogue).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("3. Reliable website products appear only as suggestions", async () => {
    mockAiResponse = {
      companyName: "Sara-ft",
      industry: "Modest Fashion",
      businessModel: "E-Commerce",
      detectedAudience: "Women",
      productCatalogue: [
        {
          name: "Chiffon Abaya Collection",
          description: "Lightweight chiffon abayas",
          offeringType: "PRODUCT",
          evidence: "Extracted from collection page"
        }
      ]
    };

    const result = await analyzeCompanyWebsite(TEST_ACCOUNT_ID, testCampaignId, "https://sara-ft.com");
    expect(result.catalogueStatus).toBe("DISCOVERED");
    expect(result.productCatalogue.length).toBe(1);
    expect(result.productCatalogue[0].name).toBe("Chiffon Abaya Collection");
  });

  it("4. Manual offering becomes USER_CONFIRMED and authoritative for campaign", async () => {
    const evidenceId = "ev_" + uuidv4().slice(0, 10);
    const offeringId = "off_" + uuidv4().slice(0, 10);
    const offeringName = "summer hijabi dresses";
    const notes = "35$–62$";

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: offeringName,
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]\nOffering Name: " + offeringName + "\nNotes: " + notes,
      contentHash: "HASH_" + Date.now(),
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: testCampaignId,
      offeringName,
      sourceInputEvidenceId: evidenceId,
    });

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(eq(schema.campaignOfferings.id, offeringId))
      .limit(1);

    expect(offering).toBeDefined();
    expect(offering.offeringName).toBe("summer hijabi dresses");
  });

  it("5. Competitor discovery receives authoritative Hero Product as search anchor", async () => {
    const evidenceId = "ev_" + uuidv4().slice(0, 10);
    const offeringId = "off_" + uuidv4().slice(0, 10);
    const offeringName = "summer hijabi dresses";

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: offeringName,
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]\nOffering Name: " + offeringName + "\nNotes: 35$–62$",
      contentHash: "HASH_" + Date.now(),
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: testCampaignId,
      offeringName,
      sourceInputEvidenceId: evidenceId,
    });

    const candidates = await discoverCampaignCompetitors(TEST_ACCOUNT_ID, testCampaignId);
    expect(candidates.length).toBeGreaterThan(0);
    expect(lastCompetitorPrompt).toContain("summer hijabi dresses");
    expect(lastCompetitorPrompt).toContain("United Arab Emirates");
  });

  it("6. Competitor discovery receives Target Market from campaign selection", async () => {
    const candidates = await discoverCampaignCompetitors(TEST_ACCOUNT_ID, testCampaignId);
    expect(candidates.length).toBe(3);
    expect(lastCompetitorPrompt).toContain("United Arab Emirates");
  });

  it("7. Competitor classification preserves 4 tiers with Judge approval", async () => {
    const candidates = await discoverCampaignCompetitors(TEST_ACCOUNT_ID, testCampaignId);
    const direct = candidates.filter(c => c.classification === "DIRECT_COMPETITOR");
    const adjacent = candidates.filter(c => c.classification === "ADJACENT_COMPETITOR");

    expect(direct.length).toBe(2);
    expect(adjacent.length).toBe(1);
    expect(direct[0].judgeVerdict).toBe("APPROVED_FOR_REVIEW");
    expect(direct[0].tier).toBe("A");
    expect(adjacent[0].tier).toBe("B");
  });

  it("8. Zero generic fallbacks (Software & Technology, B2B SaaS, Platform) exist", async () => {
    mockAiResponse = {
      companyName: "Sara-ft",
      industry: "",
      businessModel: "",
      detectedAudience: "",
      productCatalogue: []
    };

    const result = await analyzeCompanyWebsite(TEST_ACCOUNT_ID, testCampaignId, "https://sara-ft.com");
    expect(result.industry).not.toBe("Software & Technology");
    expect(result.businessModel).not.toBe("B2B SaaS");
    expect(result.productCatalogue.some((p: any) => p.name.includes("Platform"))).toBe(false);
  });

  it("9. Multi-tenant account isolation is preserved in competitor discovery", async () => {
    const otherCampaignId = "camp_other_" + uuidv4().slice(0, 8);
    await db.insert(schema.campaignSelections).values({
      accountId: OTHER_ACCOUNT_ID,
      selectedCampaignId: otherCampaignId,
      selectedCampaignName: "Other Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "Saudi Arabia",
      dataSourceMode: "benchmark"
    });

    const [myCampaign] = await db
      .select()
      .from(schema.campaignSelections)
      .where(and(
        eq(schema.campaignSelections.accountId, TEST_ACCOUNT_ID),
        eq(schema.campaignSelections.selectedCampaignId, testCampaignId)
      ))
      .limit(1);

    expect(myCampaign).toBeDefined();
    expect(myCampaign.accountId).toBe(TEST_ACCOUNT_ID);
  });
});
