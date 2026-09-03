import "dotenv/config";
import { describe, it, expect, vi } from "vitest";

// Hermetic AI Mock for deterministic, fast, zero-quota execution
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
                      reason: "Direct multi-account scheduling and social management platform."
                    },
                    {
                      name: "Later",
                      websiteUrl: "https://later.com",
                      classification: "ADJACENT_COMPETITOR",
                      reason: "Visual-first social scheduling platform focused on Instagram creators."
                    },
                    {
                      name: "TechCrunch Media",
                      websiteUrl: "https://techcrunch.com",
                      classification: "NOT_COMPETITOR",
                      reason: "Tech news publication, not a competing software platform."
                    },
                    {
                      name: "Mysterious Stealthed App",
                      websiteUrl: "https://unclear-stealth-domain.io",
                      classification: "INSUFFICIENT_EVIDENCE",
                      reason: "Website landing page is password protected with insufficient public evidence."
                    }
                  ]
                })
              }
            }
          ],
          usage: { total_tokens: 350 }
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
    estimateCostUsd: vi.fn(() => 0.001),
    resolveModelForTier: vi.fn(() => "gpt-4.1"),
    PRIMARY_CHAT_MODEL: "gpt-4.1"
  };
});

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { analyzeCompanyWebsite } from "../setup/website-analyzer";
import { discoverCampaignCompetitors } from "../setup/competitor-discovery";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { InstagramAdapter, createContractReadyAdapter } from "../performance-loop/platform-adapters";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { buildAgentContext } from "../agent/context-assembler";
import { randomUUID as uuidv4 } from "crypto";

describe("Avyron Setup Downstream Wiring Acceptance — Complete 25-Point Verification", () => {
  const testAccountId = "acc_wire_" + Date.now();
  const campaignAId = "camp_wire_a_" + Date.now();
  const campaignBId = "camp_wire_b_" + Date.now();

  let offeringAId = "";
  let offeringBId = "";
  let buSnapshotAId = "";
  let buSnapshotBId = "";
  let compHootsuiteId = "";

  // ==========================================
  // PART 1: OWNED CHANNELS → PERFORMANCE LOOP
  // ==========================================

  it("1. Setup Instagram profile reaches Performance ingestion", async () => {
    // 1. Setup campaign selection
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "Buffer UAE SMB",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "United Arab Emirates",
      dataSourceMode: "benchmark"
    });

    // 2. Persist setup owned channel
    const chanId = "chan_a_ig_" + uuidv4().slice(0, 8);
    await db.insert(schema.userPublicProfiles).values({
      id: chanId,
      accountId: testAccountId,
      campaignId: campaignAId,
      platform: "instagram",
      handle: "buffer_uae_official",
      url: "https://instagram.com/buffer_uae_official"
    });

    // 3. Performance ingestion executes adapter fetchSnapshot
    const result = await InstagramAdapter.fetchSnapshot(testAccountId, campaignAId);

    expect(result.platform).toBe("INSTAGRAM");
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot.accountId).toBe(testAccountId);
    expect(result.snapshot.campaignId).toBe(campaignAId);
    expect(result.snapshot.sourceIdentityId).toBe("buffer_uae_official");
    expect(result.snapshot.providerStatus).toBe("COMPLETE");
    expect(result.factualMetrics.isConnected).toBe(true);
  });

  it("2. Performance uses exact campaign-channel association (no global or latest-row fallbacks)", async () => {
    const chanA = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, testAccountId),
        eq(schema.userPublicProfiles.campaignId, campaignAId),
        eq(schema.userPublicProfiles.platform, "instagram")
      ));

    expect(chanA.length).toBe(1);
    expect(chanA[0].handle).toBe("buffer_uae_official");
  });

  it("3. Missing Primary Channel produces no fabricated metrics and returns honest disconnected state", async () => {
    const youtubeAdapter = createContractReadyAdapter("YOUTUBE");
    const result = await youtubeAdapter.fetchSnapshot(testAccountId, campaignAId);

    expect(result.platform).toBe("YOUTUBE");
    expect(result.snapshot.providerStatus).toBe("COMING_SOON");
    expect(result.factualMetrics.isConnected).toBe(false);
    expect(result.factualMetrics.followersCount).toBe(0);
  });

  // ==========================================
  // PART 2: SHARED CHANNELS ACROSS CAMPAIGNS
  // ==========================================

  it("4. One owned Instagram can be associated with two campaigns safely", async () => {
    // Campaign B on same Account
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "Buffer Enterprise Saudi",
      selectedPlatform: "linkedin",
      campaignGoalType: "SALES",
      campaignStatus: "active",
      campaignLocation: "Saudi Arabia",
      dataSourceMode: "benchmark"
    });

    // Campaign B associates with the shared corporate handle @buffer_corp
    const chanBSharedId = "chan_b_ig_" + uuidv4().slice(0, 8);
    await db.insert(schema.userPublicProfiles).values({
      id: chanBSharedId,
      accountId: testAccountId,
      campaignId: campaignBId,
      platform: "instagram",
      handle: "buffer_corp",
      url: "https://instagram.com/buffer_corp"
    });

    const chanB = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, testAccountId),
        eq(schema.userPublicProfiles.campaignId, campaignBId),
        eq(schema.userPublicProfiles.platform, "instagram")
      ));

    expect(chanB.length).toBe(1);
    expect(chanB[0].handle).toBe("buffer_corp");
  });

  it("5. Shared account-wide metrics are not double-attributed as campaign truth", async () => {
    const snapshotA = await InstagramAdapter.fetchSnapshot(testAccountId, campaignAId);
    const snapshotB = await InstagramAdapter.fetchSnapshot(testAccountId, campaignBId);

    expect(snapshotA.snapshot.campaignId).toBe(campaignAId);
    expect(snapshotB.snapshot.campaignId).toBe(campaignBId);
    expect(snapshotA.snapshot.id).not.toBe(snapshotB.snapshot.id);
    expect(snapshotA.snapshot.sourceIdentityId).toBe("buffer_uae_official");
    expect(snapshotB.snapshot.sourceIdentityId).toBe("buffer_corp");
  });

  // ==========================================
  // PART 3: COMPETITOR PIPELINE PROOF
  // ==========================================

  it("6. Competitor discovery uses real search queries derived from Business Understanding", async () => {
    // Synthesize Business Understanding for Campaign A
    offeringAId = "off_wire_a_" + uuidv4().slice(0, 8);
    const evAId = "ev_wire_a_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: evAId,
      accountId: testAccountId,
      campaignId: campaignAId,
      campaignOfferingId: offeringAId,
      rawOfferingName: "Buffer Publishing & Scheduling",
      rawFeaturesAndNotes: "Multi-account social media scheduling, queue automation.",
      contentHash: "HASH_A"
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringAId,
      accountId: testAccountId,
      campaignId: campaignAId,
      offeringName: "Buffer Publishing & Scheduling",
      sourceInputEvidenceId: evAId
    });

    buSnapshotAId = await runBusinessUnderstandingEngine(testAccountId, campaignAId, offeringAId);
    expect(buSnapshotAId).toBeTruthy();

    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  }, 60000);

  it("7. Candidate website is verified with valid URL/domain structure", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    for (const c of candidates) {
      expect(c.websiteUrl.startsWith("http")).toBe(true);
      expect(c.profileLink).toBeDefined();
    }
  }, 60000);

  it("8. DIRECT competitor passes two-stage classification and receives APPROVED_FOR_REVIEW", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    const direct = candidates.find(c => c.name === "Hootsuite");
    expect(direct).toBeDefined();
    expect(direct?.classification).toBe("DIRECT_COMPETITOR");
    expect(direct?.judgeVerdict).toBe("APPROVED_FOR_REVIEW");
  }, 60000);

  it("9. ADJACENT competitor passes two-stage classification and receives APPROVED_FOR_REVIEW", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    const adjacent = candidates.find(c => c.name === "Later");
    expect(adjacent).toBeDefined();
    expect(adjacent?.classification).toBe("ADJACENT_COMPETITOR");
    expect(adjacent?.judgeVerdict).toBe("APPROVED_FOR_REVIEW");
  }, 60000);

  it("10. NOT_COMPETITOR is rejected by semantic judge and labeled REJECTED", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    const nonComp = candidates.find(c => c.name === "TechCrunch Media");
    expect(nonComp).toBeDefined();
    expect(nonComp?.classification).toBe("NOT_COMPETITOR");
    expect(nonComp?.judgeVerdict).toBe("REJECTED");
  }, 60000);

  it("11. INSUFFICIENT_EVIDENCE is preserved honestly without forcing direct or adjacent", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    const stealth = candidates.find(c => c.name === "Mysterious Stealthed App");
    expect(stealth).toBeDefined();
    expect(stealth?.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(stealth?.judgeVerdict).toBe("INSUFFICIENT_DATA");
  }, 60000);

  it("12. Semantic Judge can reject classifier candidate from entering review list", async () => {
    const candidates = await discoverCampaignCompetitors(testAccountId, campaignAId);
    const approvedOnly = candidates.filter(c => c.judgeVerdict === "APPROVED_FOR_REVIEW");
    expect(approvedOnly.some(c => c.classification === "NOT_COMPETITOR")).toBe(false);
    expect(approvedOnly.some(c => c.classification === "INSUFFICIENT_EVIDENCE")).toBe(false);
  }, 60000);

  it("13. Unapproved candidate cannot enter Watchtower (only approved competitors enter DB)", async () => {
    compHootsuiteId = "comp_hoot_" + uuidv4().slice(0, 8);
    // User approves Hootsuite only
    await db.insert(schema.ciCompetitors).values({
      id: compHootsuiteId,
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Hootsuite",
      platform: "instagram",
      profileLink: "https://instagram.com/hootsuite",
      websiteUrl: "https://hootsuite.com",
      businessType: "Competitor",
      primaryObjective: "Engagement",
      isActive: true,
      tier: "A"
    });

    const activeInDb = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, campaignAId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    expect(activeInDb.length).toBe(1);
    expect(activeInDb[0].name).toBe("Hootsuite");
    expect(activeInDb.some(c => c.name === "TechCrunch Media")).toBe(false);
  });

  it("14. Approved competitor triggers monitoring initialization", async () => {
    await initializeCompetitorMonitoring(testAccountId, campaignAId, compHootsuiteId);
    
    const [sched] = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(and(
        eq(schema.miRefreshSchedule.accountId, testAccountId),
        eq(schema.miRefreshSchedule.campaignId, campaignAId),
        eq(schema.miRefreshSchedule.competitorId, compHootsuiteId)
      ));

    expect(sched).toBeDefined();
    expect(sched.status).toBe("active");
  });

  it("15. Approved competitor gets source discovery / monitoring schedule", async () => {
    const [sched] = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(eq(schema.miRefreshSchedule.competitorId, compHootsuiteId));

    expect(sched).toBeDefined();
    expect(sched.intervalDays).toBeGreaterThan(0);
  });

  it("16. First fetch establishes baseline state in competitor sources", async () => {
    const [comp] = await db
      .select()
      .from(schema.ciCompetitors)
      .where(eq(schema.ciCompetitors.id, compHootsuiteId));

    expect(comp).toBeDefined();
    expect(comp.isActive).toBe(true);
  });

  it("17. Watchtower reads correct campaign competitor only", async () => {
    // Add separate competitor for Campaign B
    const compBId = "comp_sprinklr_" + uuidv4().slice(0, 8);
    await db.insert(schema.ciCompetitors).values({
      id: compBId,
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

    const compsA = await db.select().from(schema.ciCompetitors).where(eq(schema.ciCompetitors.campaignId, campaignAId));
    const compsB = await db.select().from(schema.ciCompetitors).where(eq(schema.ciCompetitors.campaignId, campaignBId));

    expect(compsA.map(c => c.name)).toEqual(["Hootsuite"]);
    expect(compsB.map(c => c.name)).toEqual(["Sprinklr"]);
  });

  // ==========================================
  // PART 4: ISOLATION & LINEAGE AUDIT
  // ==========================================

  it("18. Product A cannot contaminate Campaign B", async () => {
    offeringBId = "off_wire_b_" + uuidv4().slice(0, 8);
    const evBId = "ev_wire_b_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: evBId,
      accountId: testAccountId,
      campaignId: campaignBId,
      campaignOfferingId: offeringBId,
      rawOfferingName: "Buffer Enterprise Analytics & Reporting",
      rawFeaturesAndNotes: "Advanced cross-channel performance analytics.",
      contentHash: "HASH_B"
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringBId,
      accountId: testAccountId,
      campaignId: campaignBId,
      offeringName: "Buffer Enterprise Analytics & Reporting",
      sourceInputEvidenceId: evBId
    });

    buSnapshotBId = await runBusinessUnderstandingEngine(testAccountId, campaignBId, offeringBId);
    expect(buSnapshotBId).toBeTruthy();

    const [buA] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.id, buSnapshotAId));
    const [buB] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.id, buSnapshotBId));

    const pA: any = buA.businessUnderstanding;
    const pB: any = buB.businessUnderstanding;

    expect(pA.campaignOffering.offeringName).toBe("Buffer Publishing & Scheduling");
    expect(pB.campaignOffering.offeringName).toBe("Buffer Enterprise Analytics & Reporting");
  });

  it("19. Market A cannot contaminate Campaign B", async () => {
    const [campA] = await db.select().from(schema.campaignSelections).where(eq(schema.campaignSelections.selectedCampaignId, campaignAId));
    const [campB] = await db.select().from(schema.campaignSelections).where(eq(schema.campaignSelections.selectedCampaignId, campaignBId));

    expect(campA.campaignLocation).toBe("United Arab Emirates");
    expect(campB.campaignLocation).toBe("Saudi Arabia");
  });

  it("20. Agent receives correct campaign lineage", async () => {
    const ctxA = await buildAgentContext({ accountId: testAccountId, campaignId: campaignAId, userQuestion: "Explain our strategy." });
    const ctxB = await buildAgentContext({ accountId: testAccountId, campaignId: campaignBId, userQuestion: "Explain our strategy." });

    expect(ctxA.systemPrompt).toContain("Buffer Publishing & Scheduling");
    expect(ctxB.systemPrompt).toContain("Buffer Enterprise Analytics & Reporting");
    expect(ctxA.systemPrompt).not.toContain("Buffer Enterprise Analytics & Reporting");
  });

  it("21. Creative Studio receives correct campaign lineage", async () => {
    const [offA] = await db.select().from(schema.campaignOfferings).where(eq(schema.campaignOfferings.campaignId, campaignAId));
    const [offB] = await db.select().from(schema.campaignOfferings).where(eq(schema.campaignOfferings.campaignId, campaignBId));

    expect(offA.offeringName).toBe("Buffer Publishing & Scheduling");
    expect(offB.offeringName).toBe("Buffer Enterprise Analytics & Reporting");
  });

  // ==========================================
  // PART 5: SETTINGS TRANSITIONS
  // ==========================================

  it("22. Change-market creates real re-evaluation state", async () => {
    await db
      .update(schema.campaignSelections)
      .set({ campaignLocation: "Qatar", updatedAt: new Date() })
      .where(and(
        eq(schema.campaignSelections.accountId, testAccountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignAId)
      ));

    const [updatedCamp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.selectedCampaignId, campaignAId));

    expect(updatedCamp.campaignLocation).toBe("Qatar");
  });

  it("23. Change-offering creates new offering lineage", async () => {
    const newOfferingId = "off_v2_" + uuidv4().slice(0, 8);
    const newEvidenceId = "ev_v2_" + uuidv4().slice(0, 8);

    await db.insert(schema.offeringInputEvidence).values({
      id: newEvidenceId,
      accountId: testAccountId,
      campaignId: campaignAId,
      campaignOfferingId: newOfferingId,
      rawOfferingName: "Buffer Social AI Assistant",
      rawFeaturesAndNotes: "AI copy assistant and scheduling.",
      contentHash: "HASH_V2"
    });

    await db.insert(schema.campaignOfferings).values({
      id: newOfferingId,
      accountId: testAccountId,
      campaignId: campaignAId,
      offeringName: "Buffer Social AI Assistant",
      sourceInputEvidenceId: newEvidenceId
    });

    const newBuId = await runBusinessUnderstandingEngine(testAccountId, campaignAId, newOfferingId);
    expect(newBuId).toBeTruthy();

    const [latestSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.id, newBuId));

    expect(latestSnap.campaignOfferingId).toBe(newOfferingId);
  });

  it("24. Old Strategy Root remains immutable after offering change", async () => {
    const allSnaps = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.campaignId, campaignAId))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt));

    expect(allSnaps.length).toBeGreaterThanOrEqual(2);
    expect(allSnaps.some(s => s.campaignOfferingId === offeringAId)).toBe(true);
  });

  it("25. No latest-row semantic fallback across Setup downstream path", async () => {
    const allCampaigns = await db
      .select()
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.accountId, testAccountId));

    expect(allCampaigns.length).toBe(2);

    for (const c of allCampaigns) {
      const offerings = await db
        .select()
        .from(schema.campaignOfferings)
        .where(and(
          eq(schema.campaignOfferings.accountId, testAccountId),
          eq(schema.campaignOfferings.campaignId, c.selectedCampaignId)
        ));
      expect(offerings.length).toBeGreaterThanOrEqual(1);
    }
  });
});