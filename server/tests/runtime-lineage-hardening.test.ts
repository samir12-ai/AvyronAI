import "dotenv/config";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

// Import canonical resolvers and production engines
import { 
  resolveCurrentBusinessUnderstanding, 
  resolveCurrentBusinessUnderstandingOrThrow 
} from "../business-understanding/resolver";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { seedDoctrine } from "../orchestrator/doctrine-seed";
import { runOrchestrator } from "../orchestrator/index";
import { WhatToDoTodayService } from "../what-to-do-today/service";
import { getOutstandingExecutionExpectations } from "../performance-loop/wtdt-execution-contract";
import { commitNewStrategyRootVersion } from "../adaptive/root-versioner";

// Mock AI client at provider transport boundary for fast, deterministic, zero-quota execution
vi.mock("../ai-client", () => {
  return {
    aiChat: vi.fn(async (options: any) => {
      const endpoint = options.endpoint || "";
      const promptStr = JSON.stringify(options.messages || []);

      if (endpoint === "business-understanding-engine" || promptStr.includes("Business Intelligence Engine")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  businessName: "EcoStyle Apparel",
                  businessModel: "DTC Sustainable Fashion",
                  generalIndustry: "Apparel & Retail",
                  discoveredOfferings: [
                    { offeringName: "Organic Linen Summer Dresses", sourcePageUrls: ["https://ecostyle.test/dresses"] }
                  ],
                  campaignOffering: {
                    offeringType: "PRODUCT",
                    category: "Women's Sustainable Dresses",
                    pricingModel: "Direct Purchase",
                    productTruthFacts: [
                      {
                        statement: "100% GOTS certified organic french linen construction",
                        factType: "CAPABILITY",
                        status: "USER_CONFIRMED",
                        rationale: "Established by verified product specification."
                      },
                      {
                        statement: "Zero synthetic dyes or microplastics in finishing process",
                        factType: "CAPABILITY",
                        status: "USER_CONFIRMED",
                        rationale: "Confirmed sustainable fabric treatment."
                      },
                      {
                        statement: "Machine washable cold with zero shrinkage guarantee",
                        factType: "USE_CASE",
                        status: "WEBSITE_ESTABLISHED",
                        rationale: "Care guidelines on product page."
                      },
                      {
                        statement: "Transparent pricing tier at $128 with carbon-neutral shipping",
                        factType: "PRICING_FACT",
                        status: "USER_CONFIRMED",
                        rationale: "Direct pricing established on checkout."
                      }
                    ]
                  },
                  targetUnderstanding: {
                    targetRoles: [
                      {
                        roleType: "BUYER",
                        roleTitle: "Eco-Conscious Professional Women",
                        status: "USER_CONFIRMED",
                        rationale: "Primary purchasing demographic seeking breathable sustainable summer workwear."
                      },
                      {
                        roleType: "USER",
                        roleTitle: "Warm Weather Commuters",
                        status: "WEBSITE_ESTABLISHED",
                        rationale: "Daily wearers in high heat and humidity environments."
                      }
                    ]
                  }
                })
              }
            }
          ],
          usage: { total_tokens: 450 }
        };
      }

      // Default mock for downstream reasoning / LLM steps
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "SUCCESS",
                passed: true,
                score: 0.92,
                reasoning: "Validated against grounded evidence."
              })
            }
          }
        ],
        usage: { total_tokens: 200 }
      };
    }),
    aiGemini: vi.fn(async () => {
      return { text: "Verified grounded analysis." };
    })
  };
});

describe("Avyron Runtime Lineage, History & E2E Hardening Suite", () => {
  const TEST_ACCOUNT_ID = `acc_audit_${Date.now()}`;
  const TEST_CAMPAIGN_A = `camp_audit_a_${Date.now()}`;
  const TEST_CAMPAIGN_B = `camp_audit_b_${Date.now()}`;

  beforeAll(async () => {
    // Seed initial test campaigns in growth_campaigns & campaign_selections
    await db.insert(schema.growthCampaigns).values([
      {
        id: TEST_CAMPAIGN_A,
        name: "EcoStyle Summer Campaign",
        stage: "active",
        businessProfile: "EcoStyle Sustainable Apparel",
      },
      {
        id: TEST_CAMPAIGN_B,
        name: "Secondary Winter Campaign",
        stage: "active",
        businessProfile: "Secondary Brand Context",
      }
    ]);

    await db.insert(schema.campaignSelections).values([
      {
        id: `sel_${Date.now()}_1`,
        accountId: TEST_ACCOUNT_ID,
        selectedCampaignId: TEST_CAMPAIGN_A,
        selectedCampaignName: "EcoStyle Summer Campaign",
        campaignGoalType: "conversions",
        campaignLocation: "United States",
      },
      {
        id: `sel_${Date.now()}_2`,
        accountId: TEST_ACCOUNT_ID,
        selectedCampaignId: TEST_CAMPAIGN_B,
        selectedCampaignName: "Secondary Winter Campaign",
        campaignGoalType: "conversions",
        campaignLocation: "United Kingdom",
      }
    ]);
  });

  // =========================================================================
  // 1. BUSINESS UNDERSTANDING: CURRENT AUTHORITY SELECTION & IMMUTABILITY
  // =========================================================================

  it("1.1. Resolves Business Understanding strictly bound to CURRENT canonical offering evidence", async () => {
    const offeringId = `off_${Date.now()}_1`;
    const evidenceId1 = `ev_${Date.now()}_crawler`;

    // A. Seed initial crawler evidence
    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId1,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      campaignOfferingId: offeringId,
      rawOfferingName: "Dresses",
      rawFeaturesAndNotes: "Crawler discovered generic dress category.",
      contentHash: "HASH_1",
      authorityType: "CRAWLER_DISCOVERED",
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      offeringName: "Dresses",
      sourceInputEvidenceId: evidenceId1,
    });

    await db.insert(schema.websiteSnapshots).values({
      id: `ws_${Date.now()}_1`,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      rootUrl: "https://ecostyle.test",
      pagesCrawled: [
        {
          pageType: "HOME",
          sourceUrl: "https://ecostyle.test",
          businessEvidenceId: `ev_web_${Date.now()}`,
          cleanedText: "EcoStyle offers 100% GOTS certified organic french linen dresses made for hot summers."
        }
      ],
      contentHash: "HASH_WS1",
      status: "SUCCESS"
    });

    // B. Run BU engine for initial crawler evidence
    const snapId1 = await runBusinessUnderstandingEngine(TEST_ACCOUNT_ID, TEST_CAMPAIGN_A, offeringId);
    expect(snapId1).toBeTruthy();

    // Verify resolver returns snapId1
    const resolvedInitial = await resolveCurrentBusinessUnderstanding({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
    });
    expect(resolvedInitial).not.toBeNull();
    expect(resolvedInitial?.snapshotId).toBe(snapId1);
    expect(resolvedInitial?.offeringInputEvidenceId).toBe(evidenceId1);

    // C. User updates offering to USER_CONFIRMED: "Organic Linen Summer Dresses" (ev2)
    const evidenceId2 = `ev_${Date.now()}_user`;
    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId2,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      campaignOfferingId: offeringId,
      rawOfferingName: "Organic Linen Summer Dresses",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING] 100% organic linen summer dress collection.",
      contentHash: "HASH_2",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    // Update campaign_offerings to point to new evidenceId2
    await db.update(schema.campaignOfferings)
      .set({
        offeringName: "Organic Linen Summer Dresses",
        sourceInputEvidenceId: evidenceId2,
      })
      .where(eq(schema.campaignOfferings.id, offeringId));

    // D. CRITICAL: Before new BU runs, resolver MUST FAIL CLOSED (returns null, does NOT use snapId1)
    const resolvedDuringTransition = await resolveCurrentBusinessUnderstanding({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
    });
    expect(resolvedDuringTransition).toBeNull();

    // Verify resolveCurrentBusinessUnderstandingOrThrow throws FAIL-CLOSED error
    await expect(
      resolveCurrentBusinessUnderstandingOrThrow({
        accountId: TEST_ACCOUNT_ID,
        campaignId: TEST_CAMPAIGN_A,
      })
    ).rejects.toThrow(/FAIL-CLOSED/);

    // E. Run BU engine for new confirmed evidence
    const snapId2 = await runBusinessUnderstandingEngine(TEST_ACCOUNT_ID, TEST_CAMPAIGN_A, offeringId);
    expect(snapId2).toBeTruthy();
    expect(snapId2).not.toBe(snapId1);

    // F. Verify resolver now returns snapId2
    const resolvedNew = await resolveCurrentBusinessUnderstanding({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
    });
    expect(resolvedNew).not.toBeNull();
    expect(resolvedNew?.snapshotId).toBe(snapId2);
    expect(resolvedNew?.offeringInputEvidenceId).toBe(evidenceId2);
    expect(resolvedNew?.offeringName).toBe("Organic Linen Summer Dresses");
    expect(resolvedNew?.authorityType).toBe("USER_CONFIRMED");

    // G. Verify historical snapshot snapId1 remains in DB completely preserved
    const [snap1InDb] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.id, snapId1));
    expect(snap1InDb).toBeTruthy();
    expect(snap1InDb.offeringInputEvidenceId).toBe(evidenceId1);
  });

  // =========================================================================
  // 2. CROSS-CAMPAIGN AND MULTI-OFFERING TENANT ISOLATION
  // =========================================================================

  it("2.1. Strict isolation between Campaign A and Campaign B", async () => {
    const offeringIdB = `off_${Date.now()}_b`;
    const evidenceIdB = `ev_${Date.now()}_b`;

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceIdB,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_B,
      campaignOfferingId: offeringIdB,
      rawOfferingName: "Winter Coats",
      rawFeaturesAndNotes: "Wool coats collection.",
      contentHash: "HASH_B",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringIdB,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_B,
      offeringName: "Winter Coats",
      sourceInputEvidenceId: evidenceIdB,
    });

    await db.insert(schema.websiteSnapshots).values({
      id: `ws_${Date.now()}_b`,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_B,
      rootUrl: "https://wintercoats.test",
      pagesCrawled: [
        {
          pageType: "HOME",
          sourceUrl: "https://wintercoats.test",
          businessEvidenceId: `ev_web_b_${Date.now()}`,
          cleanedText: "Premium winter wool coats designed for extreme cold."
        }
      ],
      contentHash: "HASH_WSB",
      status: "SUCCESS"
    });

    const snapIdB = await runBusinessUnderstandingEngine(TEST_ACCOUNT_ID, TEST_CAMPAIGN_B, offeringIdB);
    expect(snapIdB).toBeTruthy();

    const buA = await resolveCurrentBusinessUnderstandingOrThrow({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
    });
    const buB = await resolveCurrentBusinessUnderstandingOrThrow({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_B,
    });

    expect(buA.campaignOfferingId).not.toBe(buB.campaignOfferingId);
    expect(buA.offeringName).toBe("Organic Linen Summer Dresses");
    expect(buB.offeringName).toBe("Winter Coats");
    expect(buA.snapshotId).not.toBe(buB.snapshotId);
  });

  // =========================================================================
  // 3. DOCTRINE SEEDING WITH CURRENT AUTHORITY
  // =========================================================================

  it("3.1. seedDoctrine seeds SSC with the exact current canonical snapshot", async () => {
    const ctx: any = { ssc: {} };
    await seedDoctrine(ctx, TEST_CAMPAIGN_A, TEST_ACCOUNT_ID);

    expect(ctx.ssc.doctrine).toBeTruthy();
    expect(ctx.ssc.doctrine.businessUnderstanding).toBeTruthy();
    expect(ctx.ssc.doctrine.businessUnderstanding.campaignOffering.offeringType).toBe("PRODUCT");
    expect(ctx.ssc.doctrine.businessUnderstanding.campaignOffering.productTruthFacts.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // 4. WHAT TO DO TODAY EXECUTION CONTRACT INTEGRATION
  // =========================================================================

  it("4.1. WTDT Execution Contract reads expectations cleanly without mutation", async () => {
    const executionDayId = `exec_day_${Date.now()}`;
    const rootId = `root_${Date.now()}`;
    const planId = `plan_${Date.now()}`;

    await db.insert(schema.executionDays).values({
      id: executionDayId,
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      businessDate: new Date().toISOString().split("T")[0],
      strategyRootId: rootId,
      rootBundleId: `bundle_${Date.now()}`,
      strategicPlanId: planId,
      dailyMission: "Drive Consideration Proof on French Linen Quality",
      status: "ACTIVE",
    });

    const taskId = `task_${Date.now()}_1`;
    await db.insert(schema.dailyExecutionTasks).values({
      id: taskId,
      executionDayId: executionDayId,
      campaignId: TEST_CAMPAIGN_A,
      accountId: TEST_ACCOUNT_ID,
      strategyRootId: rootId,
      strategicPlanId: planId,
      laneId: "lane_eco_summer_1",
      taskType: "CONTENT_PRODUCTION",
      title: "Publish Instagram Reel on 100% French Linen Durability",
      description: "Demonstrate fabric breathability in direct summer heat.",
      channel: "INSTAGRAM",
      objective: "PROVE_DIFFERENTIATION",
      priority: "MUST_DO",
      status: "PLANNED",
      requiredQuantity: 1,
      matchedQuantity: 0,
      remainingQuantity: 1,
      executionLifecycleState: "NOT_YET_DUE",
      productionBlueprint: {
        targetAudience: "Eco-Conscious Professional Women",
        offerContext: "$128 Summer French Linen Dress",
        funnelRole: "CONSIDERATION_PROOF"
      }
    });

    const expectations = await getOutstandingExecutionExpectations(TEST_ACCOUNT_ID, TEST_CAMPAIGN_A);
    expect(expectations.length).toBeGreaterThan(0);
    const matchedTask = expectations.find(e => e.taskId === taskId);
    expect(matchedTask).toBeTruthy();
    expect(matchedTask?.channel).toBe("INSTAGRAM");
    expect(matchedTask?.audience).toBe("Eco-Conscious Professional Women");
    expect(matchedTask?.funnelRole).toBe("CONSIDERATION_PROOF");
    expect(matchedTask?.executionLifecycleState).toBe("NOT_YET_DUE");
  });

  // =========================================================================
  // 5. SARA-FT CURRENT VS HISTORICAL READBACK
  // =========================================================================

  it("5.1. Sara-ft readback separates historical Summer crawler BU from current summer dresses BU", async () => {
    const saraAccountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
    const saraCampaignId = "camp_mtewrp8kkom3";
    const saraOfferingId = "off_70677f8f-1";

    const saraCurrentBU = await resolveCurrentBusinessUnderstanding({
      accountId: saraAccountId,
      campaignId: saraCampaignId,
      campaignOfferingId: saraOfferingId,
    });

    expect(saraCurrentBU).not.toBeNull();
    expect(saraCurrentBU?.offeringName).toBe("summer dresses");
    expect(saraCurrentBU?.offeringInputEvidenceId).toBe("ev_c1310dff-a");
    expect(saraCurrentBU?.authorityType).toBe("USER_CONFIRMED");
    expect(saraCurrentBU?.status).toBe("COMPLETE");

    // Verify historical snapshot f3b6aa63-9371-4dd2-ada7-1e0b90e66a20 still exists in DB
    const [historicalSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.id, "f3b6aa63-9371-4dd2-ada7-1e0b90e66a20"));

    expect(historicalSnap).toBeTruthy();
    expect(historicalSnap.offeringInputEvidenceId).toBe("ev_3df52138-4");
  });

  // =========================================================================
  // 6. ADAPTIVE ROOT VERSIONER IMMUTABILITY
  // =========================================================================

  it("6.1. Root Versioner commits new root version v+1 preserving unchanged authorities", () => {
    const previousRoot = {
      id: "root_v1_orig",
      version: 1,
      authorityArtifactIds: {
        BUSINESS_UNDERSTANDING: "bu_snap_1",
        AUDIENCE: "aud_snap_1",
        POSITIONING: "pos_snap_1",
        DIFFERENTIATION: "diff_snap_1",
        MECHANISM: "mech_snap_1",
      },
      primaryAxis: "sustainable_french_linen",
      approvedLanes: [{ laneId: "lane_1", title: "Eco Professionals" }]
    };

    const commitResult = commitNewStrategyRootVersion({
      accountId: TEST_ACCOUNT_ID,
      campaignId: TEST_CAMPAIGN_A,
      previousRoot: previousRoot as any,
      adaptiveDecisionId: "dec_adapt_001",
      reasoningCaseId: "case_001",
      changedAuthorityArtifacts: {
        DIFFERENTIATION: "diff_snap_2_new"
      },
      currentActiveVersion: 1
    });

    expect(commitResult.newRoot.version).toBe(2);
    expect(commitResult.newRoot.previousRootId).toBe("root_v1_orig");
    expect(commitResult.newRoot.previousRootVersion).toBe(1);
    expect(commitResult.newRoot.authorityArtifactIds["DIFFERENTIATION"]).toBe("diff_snap_2_new");
    // Preserved authorities remain identical
    expect(commitResult.newRoot.authorityArtifactIds["AUDIENCE"]).toBe("aud_snap_1");
    expect(commitResult.newRoot.authorityArtifactIds["POSITIONING"]).toBe("pos_snap_1");
    expect(commitResult.newRoot.authorityArtifactIds["MECHANISM"]).toBe("mech_snap_1");
    expect(commitResult.changedAuthorities).toContain("DIFFERENTIATION");
    expect(commitResult.preservedAuthorities).toContain("AUDIENCE");
    expect(commitResult.preservedAuthorities).toContain("POSITIONING");
  });
});
