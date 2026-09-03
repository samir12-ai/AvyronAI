import "dotenv/config";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { runOrchestrator } from "../orchestrator/index";
import { WhatToDoTodayService } from "../what-to-do-today/service";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { resolveCurrentBusinessUnderstanding } from "../business-understanding/resolver";

describe("Production Orchestrator E2E Real Pipeline Test Suite", { timeout: 180000 }, () => {
  const E2E_ACCOUNT_ID = `acc_e2e_${Date.now()}`;
  const E2E_CAMPAIGN_ID = `camp_e2e_${Date.now()}`;
  const E2E_FAIL_CAMPAIGN_ID = `camp_e2e_fail_${Date.now()}`;
  const OFFERING_ID = `off_e2e_${Date.now()}`;
  const EVIDENCE_ID = `ev_e2e_${Date.now()}`;

  beforeAll(async () => {
    // 1. Seed Campaign in growth_campaigns & campaign_selections
    await db.insert(schema.growthCampaigns).values([
      {
        id: E2E_CAMPAIGN_ID,
        name: "EcoStyle E2E Verification Campaign",
        stage: "active",
        businessProfile: "EcoStyle 100% Organic Linen Sustainable Apparel",
      },
      {
        id: E2E_FAIL_CAMPAIGN_ID,
        name: "Empty Fail-Closed Campaign",
        stage: "active",
        businessProfile: "Empty Campaign for Fail-Closed Gate Proof",
      }
    ]);

    await db.insert(schema.campaignSelections).values([
      {
        id: `sel_e2e_${Date.now()}_1`,
        accountId: E2E_ACCOUNT_ID,
        selectedCampaignId: E2E_CAMPAIGN_ID,
        selectedCampaignName: "EcoStyle E2E Verification Campaign",
        campaignGoalType: "conversions",
        campaignLocation: "United States",
      },
      {
        id: `sel_e2e_${Date.now()}_2`,
        accountId: E2E_ACCOUNT_ID,
        selectedCampaignId: E2E_FAIL_CAMPAIGN_ID,
        selectedCampaignName: "Empty Fail-Closed Campaign",
        campaignGoalType: "conversions",
        campaignLocation: "United States",
      }
    ]);

    // 2. Seed Hero Product Offering & Input Evidence
    await db.insert(schema.offeringInputEvidence).values({
      id: EVIDENCE_ID,
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      campaignOfferingId: OFFERING_ID,
      rawOfferingName: "Organic Linen Summer Dresses",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING] 100% GOTS certified organic french linen summer dress. Machine washable cold, zero microplastics, transparent pricing at $128.",
      contentHash: "HASH_E2E_EV",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(schema.campaignOfferings).values({
      id: OFFERING_ID,
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      offeringName: "Organic Linen Summer Dresses",
      sourceInputEvidenceId: EVIDENCE_ID,
    });

    // 3. Seed First-Party Website Snapshot
    await db.insert(schema.websiteSnapshots).values({
      id: `ws_e2e_${Date.now()}`,
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      rootUrl: "https://ecostyle.test",
      pagesCrawled: [
        {
          pageType: "HOME",
          sourceUrl: "https://ecostyle.test",
          businessEvidenceId: `ev_web_e2e_1`,
          cleanedText: "EcoStyle crafts 100% GOTS certified organic french linen dresses with reinforced double stitching, tailored for hot and humid climates."
        },
        {
          pageType: "PRODUCT",
          sourceUrl: "https://ecostyle.test/summer-dress",
          businessEvidenceId: `ev_web_e2e_2`,
          cleanedText: "Breathable all-day wear with deep functional pockets, pre-washed for zero shrinkage, available in sizes XS-3XL at $128."
        }
      ],
      contentHash: "HASH_E2E_WS",
      status: "SUCCESS"
    });

    // 4. Generate Canonical Business Understanding Snapshot
    await runBusinessUnderstandingEngine(E2E_ACCOUNT_ID, E2E_CAMPAIGN_ID, OFFERING_ID);

    // 5. Seed Competitors and Rich Market Evidence
    const comp1Id = `comp_e2e_1_${Date.now()}`;
    const comp2Id = `comp_e2e_2_${Date.now()}`;

    await db.insert(schema.ciCompetitors).values([
      {
        id: comp1Id,
        accountId: E2E_ACCOUNT_ID,
        campaignId: E2E_CAMPAIGN_ID,
        name: "FastFashion Co",
        profileLink: "https://instagram.com/fastfashionco",
        businessType: "Fast Fashion Retailer",
        primaryObjective: "Direct E-commerce Sales",
        tier: "A",
        contentTypeRatio: "70% video, 30% image",
        engagementRatio: 0.024,
        postingFrequency: 2,
        isActive: true,
        isDemo: false,
      },
      {
        id: comp2Id,
        accountId: E2E_ACCOUNT_ID,
        campaignId: E2E_CAMPAIGN_ID,
        name: "LuxeLinen Studio",
        profileLink: "https://instagram.com/luxelinenstudio",
        businessType: "Luxury Resort Wear",
        primaryObjective: "High AOV Sales",
        tier: "A",
        contentTypeRatio: "50% video, 50% image",
        engagementRatio: 0.038,
        postingFrequency: 1,
        isActive: true,
        isDemo: false,
      }
    ]);

    // Competitor Posts
    const post1Id = `post_e2e_1_${Date.now()}`;
    const post2Id = `post_e2e_2_${Date.now()}`;
    const rawPost1Id = `p_post_1_${Date.now()}`;
    const rawPost2Id = `p_post_2_${Date.now()}`;

    await db.insert(schema.ciCompetitorPosts).values([
      {
        id: post1Id,
        competitorId: comp1Id,
        accountId: E2E_ACCOUNT_ID,
        postId: rawPost1Id,
        permalink: "https://instagram.com/p/post1",
        platform: "instagram",
        caption: "Beat the heat in our synthetic blend summer dresses! On sale today for $39.",
        likes: 1200,
        comments: 85,
        views: 15000,
      },
      {
        id: post2Id,
        competitorId: comp2Id,
        accountId: E2E_ACCOUNT_ID,
        postId: rawPost2Id,
        permalink: "https://instagram.com/p/post2",
        platform: "instagram",
        caption: "Luxe linen elegance for high-end resort getaways. Dry clean only.",
        likes: 2500,
        comments: 140,
        views: 45000,
      }
    ]);

    // Competitor Comments (Voice of Customer Evidence)
    await db.insert(schema.ciCompetitorComments).values([
      {
        id: `comm_e2e_1_${Date.now()}`,
        postId: rawPost1Id,
        competitorId: comp1Id,
        accountId: E2E_ACCOUNT_ID,
        username: "@sweatystudent",
        commentText: "Polyester blends are unwearable in 95-degree humidity! I am soaking in sweat after 10 minutes outside.",
        authorType: "audience",
        filterStatus: "ACCEPTED",
      },
      {
        id: `comm_e2e_2_${Date.now()}`,
        postId: rawPost1Id,
        competitorId: comp1Id,
        accountId: E2E_ACCOUNT_ID,
        username: "@ecowarrior",
        commentText: "Cheap synthetic fabric pills after one wash and leaches microplastics into the water cycle.",
        authorType: "audience",
        filterStatus: "ACCEPTED",
      },
      {
        id: `comm_e2e_3_${Date.now()}`,
        postId: rawPost2Id,
        competitorId: comp2Id,
        accountId: E2E_ACCOUNT_ID,
        username: "@busyworkingmom",
        commentText: "Dry-clean only linen is completely impractical for daily wear. I need real linen that can go in the washing machine.",
        authorType: "audience",
        filterStatus: "ACCEPTED",
      },
      {
        id: `comm_e2e_4_${Date.now()}`,
        postId: rawPost2Id,
        competitorId: comp2Id,
        accountId: E2E_ACCOUNT_ID,
        username: "@urbanprofessional",
        commentText: "Why do dress brands make linen garments without pockets? It makes walking into meetings so awkward.",
        authorType: "audience",
        filterStatus: "ACCEPTED",
      }
    ]);

    // Seed Business Data Layer
    await db.insert(schema.businessDataLayer).values({
      id: `bdl_e2e_${Date.now()}`,
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      businessLocation: "United States",
      businessType: "DTC Sustainable Apparel",
      priceRange: "$100-$150",
      targetAudienceAge: "25-45",
      targetAudienceSegment: "Eco-Conscious Professional Women",
      monthlyBudget: "$5,000",
      funnelObjective: "Direct E-commerce Conversions",
      primaryConversionChannel: "Instagram / Meta",
      heroProduct: "Organic Linen Summer Dresses",
    });
  }, 180000);

  // =========================================================================
  // TEST 1: FULL PRODUCTION ORCHESTRATOR E2E RUN & CANONICAL DB LINEAGE
  // =========================================================================

  it("1. Executes full orchestrator DAG through real production path and persists complete authority lineage", async () => {
    console.log(`[E2E] Running full orchestrator for campaign ${E2E_CAMPAIGN_ID}...`);

    const stageOrder: string[] = [];
    const result = await runOrchestrator({
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      forceRefresh: true,
      onProgress: (evt) => {
        if (evt.engineId && !stageOrder.includes(evt.engineId)) {
          stageOrder.push(evt.engineId);
        }
      }
    });

    console.log(`[E2E] Orchestrator finished with status: ${result.status} in ${result.durationMs}ms`);

    // Verify Orchestrator completed successfully
    expect(result.status).toBe("COMPLETED");
    expect(result.jobId).toBeTruthy();
    expect(result.planId).toBeTruthy();
    expect(result.completedEngines.length).toBeGreaterThanOrEqual(10);

    // Verify Engine Execution Ordering
    expect(stageOrder).toContain("market_intelligence");
    expect(stageOrder).toContain("audience");
    expect(stageOrder).toContain("differentiation");
    expect(stageOrder).toContain("positioning");
    expect(stageOrder).toContain("mechanism");
    expect(stageOrder).toContain("offer");
    expect(stageOrder).toContain("funnel");
    expect(stageOrder).toContain("persuasion");

    // =======================================================================
    // REAL DB LINEAGE & SNAPSHOT INSPECTION
    // =======================================================================

    // A. Business Understanding Authority
    const bu = await resolveCurrentBusinessUnderstanding({
      accountId: E2E_ACCOUNT_ID,
      campaignId: E2E_CAMPAIGN_ID,
      campaignOfferingId: OFFERING_ID
    });
    expect(bu).not.toBeNull();
    expect(bu?.status).toBe("COMPLETE");
    expect(bu?.offeringInputEvidenceId).toBe(EVIDENCE_ID);

    // B. Market Intelligence Snapshot
    const [miSnap] = await db
      .select()
      .from(schema.miSnapshots)
      .where(eq(schema.miSnapshots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.miSnapshots.createdAt))
      .limit(1);
    expect(miSnap).toBeTruthy();

    // C. Audience Snapshot
    const [audSnap] = await db
      .select()
      .from(schema.audienceSnapshots)
      .where(eq(schema.audienceSnapshots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.audienceSnapshots.createdAt))
      .limit(1);
    expect(audSnap).toBeTruthy();

    // D. Target Assessments & Product Assessments
    const targetAss = await db
      .select()
      .from(schema.targetAssessments)
      .where(eq(schema.targetAssessments.campaignId, E2E_CAMPAIGN_ID));
    expect(targetAss.length).toBeGreaterThan(0);

    const prodAss = await db
      .select()
      .from(schema.productAssessments)
      .where(eq(schema.productAssessments.campaignId, E2E_CAMPAIGN_ID));
    expect(prodAss.length).toBeGreaterThan(0);
    expect(prodAss[0].campaignOfferingId).toBe(OFFERING_ID);

    // E. Strategic Pain Decisions
    const painDecisions = await db
      .select()
      .from(schema.strategicPainDecisions)
      .where(eq(schema.strategicPainDecisions.campaignId, E2E_CAMPAIGN_ID));
    expect(painDecisions.length).toBeGreaterThan(0);

    // F. Differentiation Snapshot
    const [diffSnap] = await db
      .select()
      .from(schema.differentiationSnapshots)
      .where(eq(schema.differentiationSnapshots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.differentiationSnapshots.createdAt))
      .limit(1);
    expect(diffSnap).toBeTruthy();

    // G. Positioning Snapshot
    const [posSnap] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(eq(schema.positioningSnapshots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.positioningSnapshots.createdAt))
      .limit(1);
    expect(posSnap).toBeTruthy();

    // H. Strategy Root (Locked Canonical Strategic Authority)
    const [strategyRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);
    expect(strategyRoot).toBeTruthy();
    expect(strategyRoot.status).toBe("ACTIVE");
    expect(strategyRoot.brandSpine).toBeTruthy();
    expect(strategyRoot.approvedAudiencePains).toBeTruthy();
    expect(strategyRoot.approvedMechanism).toBeTruthy();
    expect(strategyRoot.approvedLanes).toBeTruthy();

    // I. Offer Snapshot (Bound to Strategy Root)
    const [offerSnap] = await db
      .select()
      .from(schema.offerSnapshots)
      .where(eq(schema.offerSnapshots.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.offerSnapshots.createdAt))
      .limit(1);
    expect(offerSnap).toBeTruthy();
    expect(offerSnap.strategyRootId).toBe(strategyRoot.id);

    // J. Funnel Snapshots (Multi-Lane Fanout)
    const funnelSnaps = await db
      .select()
      .from(schema.funnelSnapshots)
      .where(eq(schema.funnelSnapshots.campaignId, E2E_CAMPAIGN_ID));
    expect(funnelSnaps.length).toBeGreaterThan(0);
    expect(funnelSnaps[0].strategyRootId).toBe(strategyRoot.id);

    // K. Persuasion Snapshots (Multi-Lane Fanout)
    const persSnaps = await db
      .select()
      .from(schema.persuasionSnapshots)
      .where(eq(schema.persuasionSnapshots.campaignId, E2E_CAMPAIGN_ID));
    expect(persSnaps.length).toBeGreaterThan(0);

    // L. Strategic Plan (Synthesized from Strategy Root)
    const [strategicPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.campaignId, E2E_CAMPAIGN_ID))
      .orderBy(desc(schema.strategicPlans.createdAt))
      .limit(1);
    expect(strategicPlan).toBeTruthy();
    expect(strategicPlan.status).toBe("DRAFT");
    expect(strategicPlan.planJson).toBeTruthy();
  });

  // =========================================================================
  // TEST 2: WHAT TO DO TODAY GENERATION AGAINST REAL STRATEGY ROOT & PLAN
  // =========================================================================

  it("2. Generates What To Do Today daily plan bound to real Strategy Root and Strategic Plan", async () => {
    const today = new Date().toISOString().split("T")[0];
    const todayPlan = await WhatToDoTodayService.getOrCreateTodayPlan(E2E_CAMPAIGN_ID, today);

    expect(todayPlan).toBeTruthy();
    expect(todayPlan.campaignId).toBe(E2E_CAMPAIGN_ID);
    expect(todayPlan.strategyRootId).toBeTruthy();
    expect(todayPlan.strategicPlanId).toBeTruthy();
    expect(todayPlan.tasks.length).toBeGreaterThan(0);

    // Verify DB records in execution_days
    const [dayInDb] = await db
      .select()
      .from(schema.executionDays)
      .where(and(eq(schema.executionDays.campaignId, E2E_CAMPAIGN_ID), eq(schema.executionDays.businessDate, today)))
      .limit(1);
    expect(dayInDb).toBeTruthy();
    expect(dayInDb.strategyRootId).toBe(todayPlan.strategyRootId);
  });

  // =========================================================================
  // TEST 3: FAIL-CLOSED BEHAVIOR WITH INSUFFICIENT EVIDENCE
  // =========================================================================

  it("3. Fails closed when evidence is insufficient without generating fake Strategy Roots or Plans", async () => {
    // Campaign B has no website snapshots, no offering, and no competitor evidence
    console.log(`[E2E] Running fail-closed test for campaign ${E2E_FAIL_CAMPAIGN_ID}...`);

    let errorThrown = false;
    try {
      await runOrchestrator({
        accountId: E2E_ACCOUNT_ID,
        campaignId: E2E_FAIL_CAMPAIGN_ID,
        forceRefresh: true,
      });
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).toMatch(/FAIL-CLOSED|No Business Understanding|PIPELINE_INCOMPLETE/i);
    }

    // Verify that NO Strategy Root and NO Strategic Plan were created for the fail-closed campaign
    const roots = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.campaignId, E2E_FAIL_CAMPAIGN_ID));
    expect(roots.length).toBe(0);

    const plans = await db
      .select()
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.campaignId, E2E_FAIL_CAMPAIGN_ID));
    expect(plans.length).toBe(0);
  });
});
