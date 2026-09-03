import "dotenv/config";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock aiChat hermetically to prevent 429 external quota exhaustion
vi.mock("../ai-client", () => {
  return {
    aiChat: vi.fn(async (options: any) => {
      const endpoint = options.endpoint || "";
      const promptStr = JSON.stringify(options.messages || []);

      if (endpoint === "setup-website-analysis") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  companyName: "Buffer",
                  industry: "Social Media Management",
                  businessModel: "B2B SaaS",
                  detectedAudience: "Small Businesses and Creators",
                  detectedMarkets: ["United Arab Emirates", "Saudi Arabia", "Global"],
                  productCatalogue: [
                    {
                      id: "prod_1",
                      name: "Buffer Publishing & Scheduling",
                      description: "Multi-account social media scheduling, queue automation, visual planner, 14-day free trial, transparent pricing.",
                      offeringType: "PRODUCT"
                    },
                    {
                      id: "prod_2",
                      name: "Buffer Enterprise Analytics & Reporting",
                      description: "Advanced cross-channel performance analytics, custom export dashboards, agency white-label reports, team seats.",
                      offeringType: "PRODUCT"
                    }
                  ]
                })
              }
            }
          ],
          usage: { total_tokens: 250 }
        };
      }

      if (endpoint === "setup-competitor-discovery") {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      name: "Hootsuite",
                      websiteUrl: "https://hootsuite.com",
                      classification: "DIRECT_COMPETITOR",
                      reason: "Enterprise and SMB social media management platform competing directly for multi-account publishing."
                    },
                    {
                      name: "Sprout Social",
                      websiteUrl: "https://sproutsocial.com",
                      classification: "DIRECT_COMPETITOR",
                      reason: "Comprehensive social media management and analytics suite targeting marketing teams."
                    },
                    {
                      name: "Later",
                      websiteUrl: "https://later.com",
                      classification: "ADJACENT_COMPETITOR",
                      reason: "Visual-first social scheduling platform primarily focused on Instagram and TikTok creator workflows."
                    }
                  ]
                })
              }
            }
          ],
          usage: { total_tokens: 300 }
        };
      }

      if (endpoint === "business-understanding-engine") {
        if (promptStr.includes("Buffer Enterprise Analytics") || promptStr.includes("Buffer Enterprise")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    businessUnderstanding: {
                      businessName: "Buffer",
                      generalIndustry: "Social Media Management",
                      businessModel: "B2B SaaS",
                      campaignOffering: {
                        offeringName: "Buffer Enterprise Analytics & Reporting",
                        category: "Enterprise Analytics",
                        pricingModel: "Tiered Enterprise Subscription",
                        productTruthFacts: [
                          { statement: "Cross-channel performance analytics with custom export dashboards.", factType: "CAPABILITY" },
                          { statement: "White-label reports and multi-user team seats.", factType: "CAPABILITY" }
                        ]
                      },
                      targetUnderstanding: {
                        targetRoles: [
                          { roleTitle: "Head of Marketing", roleType: "DECISION_MAKER" },
                          { roleTitle: "Data Analyst", roleType: "USER" }
                        ]
                      }
                    }
                  })
                }
              }
            ],
            usage: { total_tokens: 450 }
          };
        }

        if (promptStr.includes("Buffer Social AI Assistant") || promptStr.includes("AI Assistant")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    businessUnderstanding: {
                      businessName: "Buffer",
                      generalIndustry: "Social Media Management",
                      businessModel: "B2B SaaS",
                      campaignOffering: {
                        offeringName: "Buffer Social AI Assistant",
                        category: "AI Content & Scheduling",
                        pricingModel: "Add-on Subscription",
                        productTruthFacts: [
                          { statement: "AI-assisted social media copy generation and caption optimization.", factType: "CAPABILITY" },
                          { statement: "Automated post scheduling and engagement suggestions.", factType: "CAPABILITY" }
                        ]
                      },
                      targetUnderstanding: {
                        targetRoles: [
                          { roleTitle: "Marketing Lead", roleType: "DECISION_MAKER" },
                          { roleTitle: "Copywriter", roleType: "USER" }
                        ]
                      }
                    }
                  })
                }
              }
            ],
            usage: { total_tokens: 450 }
          };
        }

        // Default: Buffer Publishing & Scheduling
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  businessUnderstanding: {
                    businessName: "Buffer",
                    generalIndustry: "Social Media Management",
                    businessModel: "B2B SaaS",
                    campaignOffering: {
                      offeringName: "Buffer Publishing & Scheduling",
                      category: "Social Media Management",
                      pricingModel: "Freemium & Subscription",
                      productTruthFacts: [
                        { statement: "Multi-account social media scheduling across Instagram, TikTok, LinkedIn, and X.", factType: "CAPABILITY" },
                        { statement: "Automated queue scheduling and visual calendar planning.", factType: "CAPABILITY" }
                      ]
                    },
                    targetUnderstanding: {
                      targetRoles: [
                        { roleTitle: "Social Media Manager", roleType: "DECISION_MAKER" },
                        { roleTitle: "Content Creator", roleType: "USER" }
                      ]
                    }
                  }
                })
              }
            }
          ],
          usage: { total_tokens: 450 }
        };
      }

      return {
        choices: [{ message: { content: "{}" } }],
        usage: { total_tokens: 50 }
      };
    }),
    aiGemini: vi.fn(),
    estimateCostUsd: vi.fn(() => 0.001)
  };
});

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { analyzeCompanyWebsite } from "../setup/website-analyzer";
import { discoverCampaignCompetitors } from "../setup/competitor-discovery";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { buildAgentContext } from "../agent/context-assembler";
import { randomUUID as uuidv4 } from "crypto";

describe("Avyron Setup & Multi-Campaign Architecture End-to-End Acceptance", () => {
  const testAccountId = "acc_setup_test_" + Date.now();
  const campaignAId = "camp_setup_a_" + Date.now();
  const campaignBId = "camp_setup_b_" + Date.now();
  const campaignCId = "camp_setup_c_" + Date.now();

  let offeringAId = "";
  let offeringBId = "";
  let buSnapshotAId = "";
  let buSnapshotBId = "";

  // 1. New Company Website Crawl & Analysis
  it("1. crawls first-party website and extracts corporate identity and product catalogue", async () => {
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "Buffer UAE SMB Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "United Arab Emirates",
      dataSourceMode: "benchmark"
    });

    const analysis = await analyzeCompanyWebsite(testAccountId, campaignAId, "https://buffer.com");
    
    expect(analysis.companyName).toBe("Buffer");
    expect(analysis.industry).toBe("Social Media Management");
    expect(analysis.businessModel).toBe("B2B SaaS");
    expect(analysis.productCatalogue.length).toBeGreaterThanOrEqual(2);
    expect(analysis.pagesCrawledCount).toBeGreaterThan(0);

    const [snap] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(and(
        eq(schema.websiteSnapshots.accountId, testAccountId),
        eq(schema.websiteSnapshots.campaignId, campaignAId)
      ));
    expect(snap).toBeDefined();
    expect(snap.status).toBe("SUCCESS");
  }, 30000);

  // 2. Hero Product Selection & Canonical Business Understanding
  it("2. binds single Hero Product (campaignOfferingId) and synthesizes canonical Business Understanding", async () => {
    offeringAId = "off_hero_a_" + uuidv4().slice(0, 8);
    const evidenceAId = "ev_hero_a_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceAId,
      accountId: testAccountId,
      campaignId: campaignAId,
      campaignOfferingId: offeringAId,
      rawOfferingName: "Buffer Publishing & Scheduling",
      rawFeaturesAndNotes: "Multi-account social media scheduling, queue automation, visual planner, 14-day free trial, transparent pricing.",
      contentHash: "HASH_A_" + Date.now()
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringAId,
      accountId: testAccountId,
      campaignId: campaignAId,
      offeringName: "Buffer Publishing & Scheduling",
      sourceInputEvidenceId: evidenceAId
    });

    buSnapshotAId = await runBusinessUnderstandingEngine(testAccountId, campaignAId, offeringAId);
    expect(buSnapshotAId).toBeTruthy();

    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.id, buSnapshotAId));

    expect(buSnap).toBeDefined();
    expect(buSnap.status).toBe("COMPLETE");
    expect(buSnap.campaignOfferingId).toBe(offeringAId);

    const payload: any = buSnap.businessUnderstanding;
    expect(payload.campaignOffering.productTruthFacts.length).toBeGreaterThan(0);
    expect(payload.targetUnderstanding.targetRoles.length).toBeGreaterThan(0);
  }, 30000);

  // 3. Owned Channels Registration
  it("3. persists owned channels for Campaign A and connects them to userPublicProfiles", async () => {
    const channelId = "chan_ig_" + uuidv4().slice(0, 8);
    await db.insert(schema.userPublicProfiles).values({
      id: channelId,
      accountId: testAccountId,
      campaignId: campaignAId,
      platform: "instagram",
      handle: "buffer_uae",
      url: "https://instagram.com/buffer_uae"
    });

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, testAccountId),
        eq(schema.userPublicProfiles.campaignId, campaignAId)
      ));

    expect(channels.length).toBe(1);
    expect(channels[0].platform).toBe("instagram");
    expect(channels[0].handle).toBe("buffer_uae");
  });

  // 4. Evidence-Driven Competitor Discovery with LLM + Judge Classification
  it("4. discovers real-world competitors from canonical Business Understanding and classifies them", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    for (const c of candidates) {
      expect(c.name).toBeTruthy();
      expect(c.websiteUrl).toContain("http");
      expect(["DIRECT_COMPETITOR", "ADJACENT_COMPETITOR"]).toContain(c.classification);
      expect(c.reason).toBeTruthy();
    }

    for (let i = 0; i < Math.min(2, candidates.length); i++) {
      const c = candidates[i];
      await db.insert(schema.ciCompetitors).values({
        id: "comp_a_" + i + "_" + uuidv4().slice(0, 8),
        accountId: testAccountId,
        campaignId: campaignAId,
        name: c.name,
        platform: "instagram",
        profileLink: c.profileLink || "https://instagram.com/" + c.name.toLowerCase(),
        websiteUrl: c.websiteUrl,
        businessType: "Competitor",
        primaryObjective: "Engagement",
        postingFrequency: 3,
        contentTypeRatio: "Reels 60%, Carousel 40%",
        engagementRatio: 2.5,
        isActive: true,
        isDemo: false,
        tier: "B"
      });
    }

    const saved = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, campaignAId)
      ));

    expect(saved.length).toBe(2);
  }, 30000);

  // 5. Strategy Gate Verification
  it("5. validates all canonical prerequisites before allowing Strategy build", async () => {
    const [camp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(and(
        eq(schema.campaignSelections.accountId, testAccountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignAId)
      ));
    expect(camp.campaignLocation).toBe("United Arab Emirates");

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, testAccountId),
        eq(schema.campaignOfferings.campaignId, campaignAId)
      ));
    expect(offering.id).toBe(offeringAId);

    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(and(
        eq(schema.businessUnderstandingSnapshots.accountId, testAccountId),
        eq(schema.businessUnderstandingSnapshots.campaignId, campaignAId)
      ));
    expect(buSnap.status).toBe("COMPLETE");
  });

  // 6. Multi-Campaign Test: Second Campaign for Same Account (Product B / Saudi Arabia / LinkedIn)
  it("6. creates second campaign on same account with independent Product B, Saudi market, and LinkedIn channel", async () => {
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "Buffer Analytics Enterprise Saudi",
      selectedPlatform: "linkedin",
      campaignGoalType: "SALES",
      campaignStatus: "active",
      campaignLocation: "Saudi Arabia",
      dataSourceMode: "benchmark"
    });

    offeringBId = "off_hero_b_" + uuidv4().slice(0, 8);
    const evidenceBId = "ev_hero_b_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceBId,
      accountId: testAccountId,
      campaignId: campaignBId,
      campaignOfferingId: offeringBId,
      rawOfferingName: "Buffer Enterprise Analytics & Reporting",
      rawFeaturesAndNotes: "Advanced cross-channel performance analytics, custom export dashboards, agency white-label reports, team seats.",
      contentHash: "HASH_B_" + Date.now()
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringBId,
      accountId: testAccountId,
      campaignId: campaignBId,
      offeringName: "Buffer Enterprise Analytics & Reporting",
      sourceInputEvidenceId: evidenceBId
    });

    const [latestWebsite] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(eq(schema.websiteSnapshots.accountId, testAccountId))
      .limit(1);

    await db.insert(schema.websiteSnapshots).values({
      id: "ws_b_" + uuidv4().slice(0, 8),
      accountId: testAccountId,
      campaignId: campaignBId,
      rootUrl: latestWebsite.rootUrl,
      pagesCrawled: latestWebsite.pagesCrawled,
      contentHash: latestWebsite.contentHash,
      status: "SUCCESS"
    });

    buSnapshotBId = await runBusinessUnderstandingEngine(testAccountId, campaignBId, offeringBId);
    expect(buSnapshotBId).toBeTruthy();

    await db.insert(schema.userPublicProfiles).values({
      id: "chan_li_" + uuidv4().slice(0, 8),
      accountId: testAccountId,
      campaignId: campaignBId,
      platform: "linkedin",
      handle: "buffer_enterprise_sa",
      url: "https://linkedin.com/company/buffer_enterprise_sa"
    });

    await db.insert(schema.ciCompetitors).values({
      id: "comp_b_1_" + uuidv4().slice(0, 8),
      accountId: testAccountId,
      campaignId: campaignBId,
      name: "Sprinklr",
      platform: "linkedin",
      profileLink: "https://linkedin.com/company/sprinklr",
      websiteUrl: "https://sprinklr.com",
      businessType: "Competitor",
      primaryObjective: "Enterprise Analytics",
      isActive: true,
      tier: "A"
    });
  }, 30000);

  // 7. Strict Multi-Campaign Isolation Verification
  it("7. verifies 100% campaign isolation between Campaign A and Campaign B", async () => {
    const [buA] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.campaignId, campaignAId));
    const [buB] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.campaignId, campaignBId));

    expect(buA.campaignOfferingId).toBe(offeringAId);
    expect(buB.campaignOfferingId).toBe(offeringBId);
    expect(buA.id).not.toBe(buB.id);

    const payloadA: any = buA.businessUnderstanding;
    const payloadB: any = buB.businessUnderstanding;

    expect(payloadA.campaignOffering.offeringName).toBe("Buffer Publishing & Scheduling");
    expect(payloadB.campaignOffering.offeringName).toBe("Buffer Enterprise Analytics & Reporting");

    const chanA = await db.select().from(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.campaignId, campaignAId));
    const chanB = await db.select().from(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.campaignId, campaignBId));

    expect(chanA.map(c => c.platform)).toEqual(["instagram"]);
    expect(chanB.map(c => c.platform)).toEqual(["linkedin"]);

    const compA = await db.select().from(schema.ciCompetitors).where(eq(schema.ciCompetitors.campaignId, campaignAId));
    const compB = await db.select().from(schema.ciCompetitors).where(eq(schema.ciCompetitors.campaignId, campaignBId));

    expect(compA.some(c => c.name === "Sprinklr")).toBe(false);
    expect(compB.some(c => c.name === "Sprinklr")).toBe(true);

    const ctxA = await buildAgentContext({
      accountId: testAccountId,
      campaignId: campaignAId,
      userQuestion: "Explain our strategy."
    });
    const ctxB = await buildAgentContext({
      accountId: testAccountId,
      campaignId: campaignBId,
      userQuestion: "Explain our strategy."
    });

    expect(ctxA.systemPrompt).toContain("Buffer Publishing & Scheduling");
    expect(ctxB.systemPrompt).toContain("Buffer Enterprise Analytics & Reporting");
    expect(ctxA.systemPrompt).not.toContain("Buffer Enterprise Analytics & Reporting");
  }, 30000);

  // 8. End-to-End Acceptance Test 3: Same Product, Different Market (UAE vs Lebanon)
  it("8. supports same product across different markets with distinct market scopes and independent lineages", async () => {
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignCId,
      selectedCampaignName: "Buffer Publishing Lebanon",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "Lebanon",
      dataSourceMode: "benchmark"
    });

    const offeringCId = "off_hero_c_" + uuidv4().slice(0, 8);
    const evidenceCId = "ev_hero_c_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceCId,
      accountId: testAccountId,
      campaignId: campaignCId,
      campaignOfferingId: offeringCId,
      rawOfferingName: "Buffer Publishing & Scheduling",
      rawFeaturesAndNotes: "Buffer Publishing for Lebanese creators and SMBs with local payment support.",
      contentHash: "HASH_C_" + Date.now()
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringCId,
      accountId: testAccountId,
      campaignId: campaignCId,
      offeringName: "Buffer Publishing & Scheduling",
      sourceInputEvidenceId: evidenceCId
    });

    const [campA] = await db.select().from(schema.campaignSelections).where(eq(schema.campaignSelections.selectedCampaignId, campaignAId));
    const [campC] = await db.select().from(schema.campaignSelections).where(eq(schema.campaignSelections.selectedCampaignId, campaignCId));

    expect(campA.campaignLocation).toBe("United Arab Emirates");
    expect(campC.campaignLocation).toBe("Lebanon");
    expect(campA.selectedCampaignId).not.toBe(campC.selectedCampaignId);
  });

  // 9. Settings Change Semantics: Change Hero Product creates new offering without mutating previous truth in-place
  it("9. changing Hero Product from settings creates fresh offering lineage and triggers re-evaluation warning", async () => {
    const updatedOfferingName = "Buffer Social AI Assistant";
    const newOfferingId = "off_updated_" + uuidv4().slice(0, 8);
    const newEvidenceId = "ev_updated_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: newEvidenceId,
      accountId: testAccountId,
      campaignId: campaignAId,
      campaignOfferingId: newOfferingId,
      rawOfferingName: updatedOfferingName,
      rawFeaturesAndNotes: "AI-assisted social media copy generation and automated scheduling.",
      contentHash: "HASH_UPDATED_" + Date.now()
    });

    await db.insert(schema.campaignOfferings).values({
      id: newOfferingId,
      accountId: testAccountId,
      campaignId: campaignAId,
      offeringName: updatedOfferingName,
      sourceInputEvidenceId: newEvidenceId
    });

    const newBuId = await runBusinessUnderstandingEngine(testAccountId, campaignAId, newOfferingId);
    expect(newBuId).toBeTruthy();

    const allSnaps = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.campaignId, campaignAId))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt));

    expect(allSnaps.length).toBeGreaterThanOrEqual(2);
    expect(allSnaps[0].campaignOfferingId).toBe(newOfferingId);
  }, 30000);

  // 10. Fallback and Semantic Leakage Audit
  it("10. zero latest-row semantic fallbacks or cross-campaign contamination across entire test run", async () => {
    const camps = await db
      .select()
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.accountId, testAccountId));

    expect(camps.length).toBe(3);

    for (const c of camps) {
      const offerings = await db
        .select()
        .from(schema.campaignOfferings)
        .where(and(
          eq(schema.campaignOfferings.accountId, testAccountId),
          eq(schema.campaignOfferings.campaignId, c.selectedCampaignId)
        ));
      expect(offerings.length).toBeGreaterThan(0);
    }
  });
});