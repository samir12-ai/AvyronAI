import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  businesses,
  businessProducts,
  campaignSelections,
  campaignOfferings,
  businessUnderstandingSnapshots,
  competitorRelevanceDecisions,
  ciCompetitors,
  miRefreshSchedule,
  strategicPlans,
  planApprovals,
  userPublicProfiles,
  userChannelSnapshots,
  weeklyBusinessInventories,
  clarificationRequests,
  aiUsageLog,
  acquisitionTasks,
  acquisitionRequests,
  accountEntitlements,
} from "@shared/schema";
import {
  PROPOSED_PACKAGE_CATALOG,
  setAccountEntitlementTier,
  checkCampaignActivationEntitlement,
  getCampaignUsageLedger,
} from "../entitlements";
import { persistCompetitorRelevanceDecisions } from "../discovery/competitor-discovery-engine";
import { assembleFactualDossier } from "../performance-loop/source-normalizer";
import {
  runScheduledOwnedChannelRefresh,
  runScheduledPerformanceAndReminderCheck,
  reconcileCompetitorSchedules,
} from "../watchtower/scheduler";
import { runWithAiCampaignContext, getCurrentAiCampaignContext } from "../ai-client";

const TEST_ACCOUNT_ID = "acct_multicampaign_iso_test_01";
const TEST_BUSINESS_ID = "biz_multicampaign_iso_01";
const PRODUCT_A_ID = "prod_iso_custom_songs_b2c";
const PRODUCT_B_ID = "prod_iso_b2b_sonic_branding";
const CAMPAIGN_A_ID = "camp_iso_product_a_uae";
const CAMPAIGN_B_ID = "camp_iso_product_b_ksa";

async function cleanupFixtures() {
  await db.delete(competitorRelevanceDecisions).where(eq(competitorRelevanceDecisions.accountId, TEST_ACCOUNT_ID));
  await db.delete(miRefreshSchedule).where(eq(miRefreshSchedule.accountId, TEST_ACCOUNT_ID));
  await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, TEST_ACCOUNT_ID));
  await db.delete(weeklyBusinessInventories).where(eq(weeklyBusinessInventories.accountId, TEST_ACCOUNT_ID));
  await db.delete(clarificationRequests).where(eq(clarificationRequests.accountId, TEST_ACCOUNT_ID));
  await db.delete(userChannelSnapshots).where(eq(userChannelSnapshots.accountId, TEST_ACCOUNT_ID));
  await db.delete(userPublicProfiles).where(eq(userPublicProfiles.accountId, TEST_ACCOUNT_ID));
  await db.delete(planApprovals).where(eq(planApprovals.accountId, TEST_ACCOUNT_ID));
  await db.delete(strategicPlans).where(eq(strategicPlans.accountId, TEST_ACCOUNT_ID));
  await db.delete(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.accountId, TEST_ACCOUNT_ID));
  await db.delete(campaignOfferings).where(eq(campaignOfferings.accountId, TEST_ACCOUNT_ID));
  await db.delete(acquisitionRequests).where(eq(acquisitionRequests.accountId, TEST_ACCOUNT_ID));
  await db.delete(acquisitionTasks).where(eq(acquisitionTasks.accountId, TEST_ACCOUNT_ID));
  await db.delete(aiUsageLog).where(eq(aiUsageLog.accountId, TEST_ACCOUNT_ID));
  await db.delete(campaignSelections).where(eq(campaignSelections.accountId, TEST_ACCOUNT_ID));
  await db.delete(businessProducts).where(eq(businessProducts.accountId, TEST_ACCOUNT_ID));
  await db.delete(businesses).where(eq(businesses.accountId, TEST_ACCOUNT_ID));
  await db.delete(accountEntitlements).where(eq(accountEntitlements.accountId, TEST_ACCOUNT_ID));
}

describe("Multi-Campaign Support & Product Isolation (14-Point Verification)", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SAFETY_GUARD: Refusing to run multi-campaign fixture test in NODE_ENV=production.");
    }
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("1 & 2. Creates a second campaign under the same business reusing verified company facts while isolating product facts and campaign choices", async () => {
    // Provision isolated test entitlement (4 active campaigns)
    await setAccountEntitlementTier(TEST_ACCOUNT_ID, "test_isolated", {
      isTestEntitlement: true,
      notes: "14-point verification fixture",
    });

    // Create Business with verified company-level facts
    await db.insert(businesses).values({
      id: TEST_BUSINESS_ID,
      accountId: TEST_ACCOUNT_ID,
      name: "Harmonia Studio Labs",
      websiteUrl: "https://harmoniasound.example.com",
      canonicalDomain: "harmoniasound.example.com",
      industry: "Music & Audio Production",
      businessModel: "Hybrid B2C Digital & B2B Studio Agency",
      verifiedCompanyFacts: {
        companyName: "Harmonia Studio Labs",
        websiteUrl: "https://harmoniasound.example.com",
        industry: "Music & Audio Production",
        companySummary: "Studio collective producing custom consumer songs and enterprise sonic branding.",
        reusableBrandIdentity: true,
      },
      sourceWebsiteSnapshotId: "snap_web_harmonia_01",
    });

    // Product A: B2C Consumer Personalized Gift Songs (Digital Product)
    await db.insert(businessProducts).values({
      id: PRODUCT_A_ID,
      accountId: TEST_ACCOUNT_ID,
      businessId: TEST_BUSINESS_ID,
      name: "Custom Occasion Gift Songs",
      productType: "DIGITAL_PRODUCT",
      description: "Personalized songs for birthdays, weddings, and anniversaries delivered in 24 hours.",
      productUrl: "https://harmoniasound.example.com/gift-songs",
      verifiedCapabilities: ["24-hour delivery", "Custom lyrics from consumer quiz", "MP3 + lyric video"],
      pricingModel: "$79 one-time digital download",
      purchaseModel: "Self-serve e-commerce checkout",
      sourceEvidenceIds: ["ev_prod_a_01"],
      reviewStatus: "CONFIRMED",
    });

    // Product B: B2B Enterprise Sonic Branding & Audio Mnemonics (Service Offering — no e-commerce page required)
    await db.insert(businessProducts).values({
      id: PRODUCT_B_ID,
      accountId: TEST_ACCOUNT_ID,
      businessId: TEST_BUSINESS_ID,
      name: "Enterprise Sonic Branding & Broadcast Audio",
      productType: "SERVICE",
      description: "Bespoke sonic logos, retail soundscapes, and broadcast audio packages for enterprise brands.",
      productUrl: null,
      documentationUrls: ["https://harmoniasound.example.com/docs/sonic-branding-deck.pdf"],
      verifiedCapabilities: ["Multi-market broadcast buyout licensing", "Dolby Atmos mastering", "Brand sonic guidelines"],
      pricingModel: "Retainer & project packages starting at $8,500",
      purchaseModel: "Consultative B2B proposal & invoice",
      sourceEvidenceIds: ["ev_prod_b_01"],
      reviewStatus: "CONFIRMED",
    });

    // Create Campaign A (UAE, B2C Sales, $1,500/mo budget)
    await db.insert(campaignSelections).values({
      accountId: TEST_ACCOUNT_ID,
      businessId: TEST_BUSINESS_ID,
      productId: PRODUCT_A_ID,
      selectedCampaignId: CAMPAIGN_A_ID,
      selectedCampaignName: "Harmonia — Custom Gift Songs (UAE)",
      selectedPlatform: "meta",
      campaignGoalType: "SALES",
      campaignStatus: "active",
      campaignLocation: "United Arab Emirates",
      targetMarket: "United Arab Emirates",
      setupStatus: "COMPLETED",
      setupStep: "06_READY",
      isSelected: false,
    });

    // Create Campaign B (Saudi Arabia, B2B Leads, $6,000/mo budget) under the same business without re-entering company basics
    await db.insert(campaignSelections).values({
      accountId: TEST_ACCOUNT_ID,
      businessId: TEST_BUSINESS_ID,
      productId: PRODUCT_B_ID,
      selectedCampaignId: CAMPAIGN_B_ID,
      selectedCampaignName: "Harmonia — Enterprise Sonic Branding (KSA)",
      selectedPlatform: "linkedin",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "Saudi Arabia",
      targetMarket: "Saudi Arabia",
      setupStatus: "COMPLETED",
      setupStep: "06_READY",
      isSelected: true,
    });

    // Store distinct Business Understanding snapshots for Campaign A & Campaign B
    await db.insert(businessUnderstandingSnapshots).values([
      {
        id: "bu_snap_camp_a",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        businessId: TEST_BUSINESS_ID,
        productId: PRODUCT_A_ID,
        websiteSnapshotId: "snap_web_harmonia_01",
        businessUnderstanding: {
          companyName: "Harmonia Studio Labs",
          websiteUrl: "https://harmoniasound.example.com",
          industry: "Music & Audio Production",
          businessModel: "B2C Digital Product",
          selectedOfferingSummary: "Custom Occasion Gift Songs ($79 one-time digital download)",
          targetMarket: "United Arab Emirates",
        } as any,
        companyFacts: {
          companyName: "Harmonia Studio Labs",
          websiteUrl: "https://harmoniasound.example.com",
          inheritedFromBusinessId: TEST_BUSINESS_ID,
        },
        productFacts: {
          productId: PRODUCT_A_ID,
          offeringName: "Custom Occasion Gift Songs",
          productType: "DIGITAL_PRODUCT",
          pricingModel: "$79 one-time digital download",
          purchaseModel: "Self-serve e-commerce checkout",
        },
        campaignChoices: {
          campaignId: CAMPAIGN_A_ID,
          targetMarket: "United Arab Emirates",
          campaignGoalType: "SALES",
          monthlyBudget: 1500,
        },
        evidenceProvenance: {
          companySnapshotStatus: "REUSED_FROM_CACHE",
          productEvidenceStatus: "NEWLY_ACQUIRED",
        },
        inputSnapshotVersion: "bu_v2_prod_a_uae",
      },
      {
        id: "bu_snap_camp_b",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        businessId: TEST_BUSINESS_ID,
        productId: PRODUCT_B_ID,
        websiteSnapshotId: "snap_web_harmonia_01",
        businessUnderstanding: {
          companyName: "Harmonia Studio Labs",
          websiteUrl: "https://harmoniasound.example.com",
          industry: "Music & Audio Production",
          businessModel: "B2B Service Agency",
          selectedOfferingSummary: "Enterprise Sonic Branding & Broadcast Audio ($8,500+ consultative B2B service)",
          targetMarket: "Saudi Arabia",
        } as any,
        companyFacts: {
          companyName: "Harmonia Studio Labs",
          websiteUrl: "https://harmoniasound.example.com",
          inheritedFromBusinessId: TEST_BUSINESS_ID,
        },
        productFacts: {
          productId: PRODUCT_B_ID,
          offeringName: "Enterprise Sonic Branding & Broadcast Audio",
          productType: "SERVICE",
          pricingModel: "Retainer & project packages starting at $8,500",
          purchaseModel: "Consultative B2B proposal & invoice",
        },
        campaignChoices: {
          campaignId: CAMPAIGN_B_ID,
          targetMarket: "Saudi Arabia",
          campaignGoalType: "LEADS",
          monthlyBudget: 6000,
        },
        evidenceProvenance: {
          companySnapshotStatus: "REUSED_FROM_CACHE",
          productEvidenceStatus: "NEWLY_ACQUIRED",
        },
        inputSnapshotVersion: "bu_v2_prod_b_ksa",
      },
    ]);

    const [buA] = await db
      .select()
      .from(businessUnderstandingSnapshots)
      .where(eq(businessUnderstandingSnapshots.campaignId, CAMPAIGN_A_ID));
    const [buB] = await db
      .select()
      .from(businessUnderstandingSnapshots)
      .where(eq(businessUnderstandingSnapshots.campaignId, CAMPAIGN_B_ID));

    expect(buA.businessId).toBe(TEST_BUSINESS_ID);
    expect(buB.businessId).toBe(TEST_BUSINESS_ID);
    expect(buA.productId).toBe(PRODUCT_A_ID);
    expect(buB.productId).toBe(PRODUCT_B_ID);
    expect((buA.productFacts as any).pricingModel).toBe("$79 one-time digital download");
    expect((buB.productFacts as any).pricingModel).toContain("$8,500");
    expect((buA.campaignChoices as any).targetMarket).toBe("United Arab Emirates");
    expect((buB.campaignChoices as any).targetMarket).toBe("Saudi Arabia");
  });

  it("3 & 4. Evaluates fresh competitor relevance per campaign: rejects Campaign A-only competitor in Campaign B, and accepts shared competitor only with product-specific offering & monitored URLs", async () => {
    // Persist relevance decisions for Campaign A (Custom Occasion Gift Songs - B2C)
    await persistCompetitorRelevanceDecisions({
      accountId: TEST_ACCOUNT_ID,
      campaignId: CAMPAIGN_A_ID,
      businessId: TEST_BUSINESS_ID,
      productId: PRODUCT_A_ID,
      offeringName: "Custom Occasion Gift Songs",
      targetMarket: "United Arab Emirates",
      candidates: [
        {
          name: "Songfinch Consumer Gifts",
          websiteUrl: "https://songfinch.example.com",
          domain: "songfinch.example.com",
          canonicalEntityId: "ce_songfinch",
          classification: "DIRECT_COMPETITOR",
          competitorType: "DIRECT",
          competingOffering: "Custom consumer occasion songs ($199)",
          servesBuyerNeed: true,
          buyerNeedRationale: "Directly serves consumer gift buyers seeking personalized songs.",
          geographicClassification: "CROSS_BORDER_SERVING_MARKET",
          geographicReasoning: "Delivers digital custom songs to UAE consumers.",
          monitoredProductUrls: ["https://songfinch.example.com/occasions"],
          dataReuseStatus: "NEWLY_ACQUIRED",
          judgeVerdict: "APPROVED",
          relevanceReason: "Direct B2C personalized song competitor.",
        } as any,
        {
          name: "MassiveMusic Sonic Agency",
          websiteUrl: "https://massivemusic.example.com",
          domain: "massivemusic.example.com",
          canonicalEntityId: "ce_massivemusic",
          classification: "IRRELEVANT",
          competitorType: "EXCLUDED",
          competingOffering: "NONE",
          servesBuyerNeed: false,
          buyerNeedRationale: "Enterprise sonic branding agency; does not sell $79 consumer occasion gift songs.",
          geographicClassification: "LOCAL_MARKET",
          monitoredProductUrls: [],
          dataReuseStatus: "EXCLUDED_IRRELEVANT_OR_STALE",
          judgeVerdict: "REJECTED",
          judgeReason: "No competing offering for consumer gift songs.",
        } as any,
        {
          name: "AudioVerse Multi-Division",
          websiteUrl: "https://audioverse.example.com",
          domain: "audioverse.example.com",
          canonicalEntityId: "ce_audioverse_shared",
          classification: "DIRECT_COMPETITOR",
          competitorType: "DIRECT",
          competingOffering: "AudioVerse Personal Song Studio (B2C division)",
          servesBuyerNeed: true,
          buyerNeedRationale: "Has a dedicated B2C gift song product line competing with Product A.",
          geographicClassification: "LOCAL_MARKET",
          monitoredProductUrls: ["https://audioverse.example.com/personal-gift-songs"],
          dataReuseStatus: "NEWLY_ACQUIRED",
          judgeVerdict: "APPROVED",
          relevanceReason: "Competes via its B2C Personal Song Studio offering.",
        } as any,
      ],
    });

    // Persist relevance decisions for Campaign B (Enterprise Sonic Branding - B2B)
    await persistCompetitorRelevanceDecisions({
      accountId: TEST_ACCOUNT_ID,
      campaignId: CAMPAIGN_B_ID,
      businessId: TEST_BUSINESS_ID,
      productId: PRODUCT_B_ID,
      offeringName: "Enterprise Sonic Branding & Broadcast Audio",
      targetMarket: "Saudi Arabia",
      candidates: [
        {
          name: "Songfinch Consumer Gifts",
          websiteUrl: "https://songfinch.example.com",
          domain: "songfinch.example.com",
          canonicalEntityId: "ce_songfinch",
          classification: "IRRELEVANT",
          competitorType: "EXCLUDED",
          competingOffering: "NONE",
          servesBuyerNeed: false,
          buyerNeedRationale: "Consumer gift song marketplace; lacks B2B sonic branding, broadcast buyout, or enterprise audio services.",
          geographicClassification: "UNVERIFIED",
          monitoredProductUrls: [],
          dataReuseStatus: "EXCLUDED_IRRELEVANT_OR_STALE",
          judgeVerdict: "REJECTED",
          judgeReason: "Monitored in Campaign A, but lacks any competing B2B sonic branding offering for Campaign B.",
        } as any,
        {
          name: "MassiveMusic Sonic Agency",
          websiteUrl: "https://massivemusic.example.com",
          domain: "massivemusic.example.com",
          canonicalEntityId: "ce_massivemusic",
          classification: "DIRECT_COMPETITOR",
          competitorType: "DIRECT",
          competingOffering: "Enterprise Sonic Branding & Sonic Identity Architecture",
          servesBuyerNeed: true,
          buyerNeedRationale: "Directly serves enterprise CMOs in GCC/KSA with sonic logos and broadcast audio.",
          geographicClassification: "CROSS_BORDER_SERVING_MARKET",
          monitoredProductUrls: ["https://massivemusic.example.com/sonic-branding"],
          dataReuseStatus: "NEWLY_ACQUIRED",
          judgeVerdict: "APPROVED",
          relevanceReason: "Direct B2B sonic branding agency serving MENA/KSA.",
        } as any,
        {
          name: "AudioVerse Multi-Division",
          websiteUrl: "https://audioverse.example.com",
          domain: "audioverse.example.com",
          canonicalEntityId: "ce_audioverse_shared",
          classification: "DIRECT_COMPETITOR",
          competitorType: "DIRECT",
          competingOffering: "AudioVerse Enterprise Sonic Identity Suite (B2B division)",
          servesBuyerNeed: true,
          buyerNeedRationale: "Revalidated for Campaign B: offers a separate B2B Enterprise Sonic Identity service.",
          geographicClassification: "CROSS_BORDER_SERVING_MARKET",
          monitoredProductUrls: ["https://audioverse.example.com/enterprise-sonic-branding"],
          dataReuseStatus: "REVALIDATED",
          judgeVerdict: "APPROVED",
          relevanceReason: "Separate relevance decision for its B2B Enterprise Sonic Identity division.",
        } as any,
      ],
    });

    const decisionsA = await db
      .select()
      .from(competitorRelevanceDecisions)
      .where(eq(competitorRelevanceDecisions.campaignId, CAMPAIGN_A_ID));
    const decisionsB = await db
      .select()
      .from(competitorRelevanceDecisions)
      .where(eq(competitorRelevanceDecisions.campaignId, CAMPAIGN_B_ID));

    const songfinchInA = decisionsA.find((d) => d.candidateDomain === "songfinch.example.com");
    const songfinchInB = decisionsB.find((d) => d.candidateDomain === "songfinch.example.com");
    expect(songfinchInA?.decisionVerdict).toBe("INCLUDED");
    expect(songfinchInB?.decisionVerdict).toBe("EXCLUDED");
    expect(songfinchInB?.servesBuyerNeed).toBe(false);

    const massiveInA = decisionsA.find((d) => d.candidateDomain === "massivemusic.example.com");
    const massiveInB = decisionsB.find((d) => d.candidateDomain === "massivemusic.example.com");
    expect(massiveInA?.decisionVerdict).toBe("EXCLUDED");
    expect(massiveInB?.decisionVerdict).toBe("INCLUDED");

    const sharedInA = decisionsA.find((d) => d.candidateDomain === "audioverse.example.com");
    const sharedInB = decisionsB.find((d) => d.candidateDomain === "audioverse.example.com");
    expect(sharedInA?.decisionVerdict).toBe("INCLUDED");
    expect(sharedInB?.decisionVerdict).toBe("INCLUDED");
    expect(sharedInA?.competingOffering).toContain("B2C");
    expect(sharedInB?.competingOffering).toContain("B2B");
    expect(sharedInB?.dataReuseStatus).toBe("REVALIDATED");
    expect(sharedInA?.monitoredProductUrls).toEqual(["https://audioverse.example.com/personal-gift-songs"]);
    expect(sharedInB?.monitoredProductUrls).toEqual(["https://audioverse.example.com/enterprise-sonic-branding"]);
  });

  it("5 & 6. Isolates approved strategies, active plans, positioning, and audiences per campaign without cloning", async () => {
    // Both Campaign A and Campaign B can have their own active APPROVED plan simultaneously within the same account
    await db.insert(strategicPlans).values([
      {
        id: "plan_iso_camp_a_v1",
        accountId: TEST_ACCOUNT_ID,
        blueprintId: "orchestrator-v2",
        campaignId: CAMPAIGN_A_ID,
        version: 1,
        status: "APPROVED",
        isDesignatedActive: true,
        planJson: JSON.stringify({
          productFocus: "Custom Occasion Gift Songs",
          targetMarket: "United Arab Emirates",
          audienceLane: "Last-minute romantic & milestone gift shoppers in Dubai/Abu Dhabi",
          positioning: "Studio-quality personalized song delivered in 24 hours for $79",
          offer: "24h Express Gift Song + Lyric Video Bundle",
          channels: ["instagram", "tiktok"],
        }),
      },
      {
        id: "plan_iso_camp_b_v1",
        accountId: TEST_ACCOUNT_ID,
        blueprintId: "orchestrator-v2",
        campaignId: CAMPAIGN_B_ID,
        version: 1,
        status: "APPROVED",
        isDesignatedActive: true,
        planJson: JSON.stringify({
          productFocus: "Enterprise Sonic Branding & Broadcast Audio",
          targetMarket: "Saudi Arabia",
          audienceLane: "Enterprise CMOs, Brand Directors, and Ad Agencies in Riyadh/Jeddah",
          positioning: "Full-buyout culturally resonant sonic identity systems for Vision 2030 brands",
          offer: "Sonic Audit + Executive Sonic Identity Workshop ($8,500+)",
          channels: ["linkedin", "youtube"],
        }),
      },
    ]);

    const [planA] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, "plan_iso_camp_a_v1"));
    const [planB] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, "plan_iso_camp_b_v1"));

    expect(planA.status).toBe("APPROVED");
    expect(planB.status).toBe("APPROVED");
    expect(planA.isDesignatedActive).toBe(true);
    expect(planB.isDesignatedActive).toBe(true);

    const parsedA = JSON.parse(planA.planJson!);
    const parsedB = JSON.parse(planB.planJson!);
    expect(parsedA.audienceLane).not.toBe(parsedB.audienceLane);
    expect(parsedA.positioning).not.toBe(parsedB.positioning);
    expect(parsedA.offer).not.toBe(parsedB.offer);
  });

  it("7 & 8. Shares an owned social channel without duplicate scraping and keeps sales/performance attribution separate across campaigns", async () => {
    // Both campaigns connect the same verified company Instagram account (@harmoniasound)
    await db.insert(userPublicProfiles).values([
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        platform: "instagram",
        handle: "harmoniasound",
        url: "https://www.instagram.com/harmoniasound",
      },
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        platform: "instagram",
        handle: "harmoniasound",
        url: "https://www.instagram.com/harmoniasound",
      },
    ]);

    // Single shared provider task in acquisition_tasks with CACHE_REUSE for Campaign B
    await db.insert(acquisitionTasks).values({
      id: "acq_task_shared_ig_01",
      accountId: TEST_ACCOUNT_ID,
      campaignId: CAMPAIGN_A_ID,
      productId: PRODUCT_A_ID,
      sourcePlatform: "INSTAGRAM",
      entityType: "OWNED",
      entityId: "owned_instagram_harmoniasound",
      capability: "PROFILE_AND_POSTS",
      provider: "APIFY",
      actorId: "apify/instagram-profile-scraper",
      externalAccountId: "harmoniasound",
      canonicalUrl: "https://www.instagram.com/harmoniasound",
      taskKey: "ig_harmoniasound_shared",
      taskType: "PROFILE_AND_POSTS",
      status: "SUCCESS_WITH_CONTENT",
      usageUsd: 0.045,
      sharedConsumerCampaignIds: [CAMPAIGN_A_ID, CAMPAIGN_B_ID],
      attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
      dataReuseStatus: "NEWLY_ACQUIRED",
      completedAt: new Date(),
    });

    await db.insert(acquisitionRequests).values([
      {
        id: "acq_req_camp_a_ig",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        productId: PRODUCT_A_ID,
        requesterEngine: "OWNED_CHANNEL_SCRAPER",
        trigger: "MANUAL_SETUP",
        entityType: "OWNED",
        entityId: "owned_instagram_harmoniasound",
        platform: "INSTAGRAM",
        capability: "PROFILE_AND_POSTS",
        externalAccountId: "harmoniasound",
        canonicalUrl: "https://www.instagram.com/harmoniasound",
        resolutionType: "FRESH_FETCH",
        status: "COMPLETED",
        taskId: "acq_task_shared_ig_01",
        usageUsd: 0.045,
        sharedConsumerCampaignIds: [CAMPAIGN_A_ID, CAMPAIGN_B_ID],
        attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
        dataReuseStatus: "NEWLY_ACQUIRED",
      },
      {
        id: "acq_req_camp_b_ig",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        productId: PRODUCT_B_ID,
        requesterEngine: "OWNED_CHANNEL_SCRAPER",
        trigger: "MANUAL_SETUP",
        entityType: "OWNED",
        entityId: "owned_instagram_harmoniasound",
        platform: "INSTAGRAM",
        capability: "PROFILE_AND_POSTS",
        externalAccountId: "harmoniasound",
        canonicalUrl: "https://www.instagram.com/harmoniasound",
        resolutionType: "CACHE_REUSE",
        status: "COMPLETED",
        taskId: "acq_task_shared_ig_01",
        usageUsd: null, // Counted once on originating campaign!
        sharedConsumerCampaignIds: [CAMPAIGN_A_ID, CAMPAIGN_B_ID],
        attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
        dataReuseStatus: "REUSED_FROM_CACHE",
      },
    ]);

    const sharedSnapshotPayload = JSON.stringify({
      scrapeStatus: "SUCCESS",
      followersCount: 14200,
      postsCount: 5,
      recentPosts: [
        { id: "post_1", caption: "Birthday song for Sara", likesCount: 120, commentsCount: 14 },
        { id: "post_2", caption: "Anniversary gift reaction", likesCount: 230, commentsCount: 19 },
        { id: "post_3", caption: "Studio behind the scenes", likesCount: 95, commentsCount: 8 },
      ],
    });

    await db.insert(userChannelSnapshots).values([
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        platform: "instagram",
        handle: "harmoniasound",
        followersCount: 14200,
        postsCount: 3,
        scrapeSuccess: true,
        snapshotData: sharedSnapshotPayload,
      },
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        platform: "instagram",
        handle: "harmoniasound",
        followersCount: 14200,
        postsCount: 3,
        scrapeSuccess: true,
        snapshotData: sharedSnapshotPayload,
      },
    ]);

    // Separate weekly check-in sales/revenue for Campaign A vs Campaign B (never duplicated across campaigns)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    await db.insert(weeklyBusinessInventories).values([
      {
        id: "winv_camp_a_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        windowId: "win_camp_a_1",
        windowIndex: 1,
        periodStart: weekAgo,
        periodEnd: now,
        periodLabel: "Window 1 (UAE B2C)",
        submittedMetrics: {
          leads: 42,
          payingCustomers: 18,
          revenue: 1422,
          adSpend: 350,
        },
        currency: "USD",
        status: "COMPLETED",
        submittedAt: now,
      },
      {
        id: "winv_camp_b_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        windowId: "win_camp_b_1",
        windowIndex: 1,
        periodStart: weekAgo,
        periodEnd: now,
        periodLabel: "Window 1 (KSA B2B)",
        submittedMetrics: {
          leads: 6,
          payingCustomers: 1,
          revenue: 9500,
          adSpend: 1200,
        },
        currency: "USD",
        status: "COMPLETED",
        submittedAt: now,
      },
    ]);

    const dossierA = await assembleFactualDossier({ accountId: TEST_ACCOUNT_ID, campaignId: CAMPAIGN_A_ID });
    const dossierB = await assembleFactualDossier({ accountId: TEST_ACCOUNT_ID, campaignId: CAMPAIGN_B_ID });

    // Sales & weekly check-ins are strictly isolated per campaign
    expect(dossierA.manualTruthFact?.weeklyPayingCustomers).toBe(18);
    expect(dossierA.manualTruthFact?.weeklyRevenue).toBe(1422);
    expect(dossierB.manualTruthFact?.weeklyPayingCustomers).toBe(1);
    expect(dossierB.manualTruthFact?.weeklyRevenue).toBe(9500);

    // Shared channel attribution clearly marks shared account followers & unlinked posts
    expect(dossierA.sharedChannelAttribution?.hasSharedChannelsAcrossCampaigns).toBe(true);
    expect(dossierA.sharedChannelAttribution?.sharedChannels[0]?.channelScopeLabel).toBe("SHARED_ACCOUNT_CHANNEL");
    expect(dossierA.sharedChannelAttribution?.sharedChannels[0]?.platform).toBe("instagram");
    expect(dossierB.sharedChannelAttribution?.hasSharedChannelsAcrossCampaigns).toBe(true);
  }, 30000);

  it("9 & 10. Switches campaigns and retains selected campaign across reload without cross-campaign cache bleed", async () => {
    // Select Campaign B by updating selectedAt to a newer timestamp
    const t1 = new Date(Date.now() - 10000);
    const t2 = new Date();
    await db
      .update(campaignSelections)
      .set({ selectedAt: t1 })
      .where(and(eq(campaignSelections.accountId, TEST_ACCOUNT_ID), eq(campaignSelections.selectedCampaignId, CAMPAIGN_A_ID)));
    await db
      .update(campaignSelections)
      .set({ selectedAt: t2 })
      .where(and(eq(campaignSelections.accountId, TEST_ACCOUNT_ID), eq(campaignSelections.selectedCampaignId, CAMPAIGN_B_ID)));

    const [latestBefore] = await db
      .select()
      .from(campaignSelections)
      .where(eq(campaignSelections.accountId, TEST_ACCOUNT_ID))
      .orderBy(desc(campaignSelections.selectedAt))
      .limit(1);
    expect(latestBefore?.selectedCampaignId).toBe(CAMPAIGN_B_ID);

    // Switch selection to Campaign A
    const t3 = new Date(Date.now() + 10000);
    await db
      .update(campaignSelections)
      .set({ selectedAt: t3 })
      .where(and(eq(campaignSelections.accountId, TEST_ACCOUNT_ID), eq(campaignSelections.selectedCampaignId, CAMPAIGN_A_ID)));

    // Verify reload query returns Campaign A (and never overwrites Campaign B's row)
    const rowsAfter = await db
      .select()
      .from(campaignSelections)
      .where(eq(campaignSelections.accountId, TEST_ACCOUNT_ID))
      .orderBy(desc(campaignSelections.selectedAt));
    expect(rowsAfter.length).toBe(2);
    expect(rowsAfter[0]?.selectedCampaignId).toBe(CAMPAIGN_A_ID);
    expect(rowsAfter[0]?.productId).toBe(PRODUCT_A_ID);
    expect(rowsAfter[0]?.campaignLocation).toBe("United Arab Emirates");
    expect(rowsAfter[1]?.selectedCampaignId).toBe(CAMPAIGN_B_ID);
    expect(rowsAfter[1]?.productId).toBe(PRODUCT_B_ID);
    expect(rowsAfter[1]?.campaignLocation).toBe("Saudi Arabia");
  }, 15000);

  it("11. Pausing Campaign B stops its recurring scheduled work while Campaign A continues normally", async () => {
    await db.insert(ciCompetitors).values([
      {
        id: "comp_iso_a_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        name: "Songfinch Consumer Gifts",
        businessType: "DIRECT",
        primaryObjective: "SALES",
        isActive: true,
      },
      {
        id: "comp_iso_b_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        name: "MassiveMusic Sonic Agency",
        businessType: "DIRECT",
        primaryObjective: "LEADS",
        isActive: true,
      },
    ]);

    await db.insert(miRefreshSchedule).values([
      {
        id: "sched_iso_a_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        competitorId: "comp_iso_a_1",
        intervalDays: 3,
        nextRefreshAt: new Date(Date.now() + 86400000),
        status: "active",
      },
      {
        id: "sched_iso_b_1",
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        competitorId: "comp_iso_b_1",
        intervalDays: 3,
        nextRefreshAt: new Date(Date.now() + 86400000),
        status: "active",
      },
    ]);

    // Pause Campaign B
    await db
      .update(campaignSelections)
      .set({ campaignStatus: "paused" })
      .where(and(eq(campaignSelections.accountId, TEST_ACCOUNT_ID), eq(campaignSelections.selectedCampaignId, CAMPAIGN_B_ID)));

    await reconcileCompetitorSchedules();

    const [schedA] = await db.select().from(miRefreshSchedule).where(eq(miRefreshSchedule.id, "sched_iso_a_1"));
    const [schedB] = await db.select().from(miRefreshSchedule).where(eq(miRefreshSchedule.id, "sched_iso_b_1"));
    expect(schedA.status).toBe("active");
    expect(schedB.status).toBe("paused");

    const ownedRefreshB = await runScheduledOwnedChannelRefresh(TEST_ACCOUNT_ID, CAMPAIGN_B_ID);
    expect(ownedRefreshB.executed).toBe(false);
    expect(ownedRefreshB.reason).toBe("CAMPAIGN_PAUSED_OR_ARCHIVED");

    const perfCheckB = await runScheduledPerformanceAndReminderCheck(TEST_ACCOUNT_ID, CAMPAIGN_B_ID);
    expect(perfCheckB.evaluated).toBe(false);

    // Re-activate Campaign B for subsequent tests
    await db
      .update(campaignSelections)
      .set({ campaignStatus: "active" })
      .where(and(eq(campaignSelections.accountId, TEST_ACCOUNT_ID), eq(campaignSelections.selectedCampaignId, CAMPAIGN_B_ID)));
  });

  it("12. Attributes AI & Apify usage per campaign, counts shared provider charges once, and preserves UNKNOWN cost as null (never 0)", async () => {
    // Verify AsyncLocalStorage campaign context propagation
    const capturedContext = await runWithAiCampaignContext(
      { accountId: TEST_ACCOUNT_ID, campaignId: CAMPAIGN_A_ID, operationType: "strategy_orchestration", runId: "run_iso_a" },
      async () => getCurrentAiCampaignContext()
    );
    expect(capturedContext?.campaignId).toBe(CAMPAIGN_A_ID);
    expect(capturedContext?.operationType).toBe("strategy_orchestration");

    // Insert AI usage rows for Campaign A (1 measured, 1 unknown cost) and Campaign B
    await db.insert(aiUsageLog).values([
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        endpoint: "gemini.generateContent",
        operationType: "competitor_relevance",
        provider: "gemini",
        model: "gemini-2.5-flash",
        maxTokens: 4000,
        estimatedTokens: 3200,
        inputTokens: 2400,
        outputTokens: 800,
        costUsd: 0.0042,
        costStatus: "CALCULATED",
        providerCallId: "gemini_call_a_1",
        attributionPolicy: "DIRECT_CAMPAIGN",
      },
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_A_ID,
        endpoint: "chat.completions",
        operationType: "legacy_eval",
        provider: "openai",
        model: "custom-unpriced-model",
        maxTokens: 2000,
        estimatedTokens: 1500,
        costUsd: null, // Missing cost must be NULL / UNKNOWN, never 0
        costStatus: "UNKNOWN",
        attributionPolicy: "DIRECT_CAMPAIGN",
      },
      {
        accountId: TEST_ACCOUNT_ID,
        campaignId: CAMPAIGN_B_ID,
        endpoint: "chat.completions",
        operationType: "strategy_orchestration",
        provider: "openai",
        model: "gpt-4o",
        maxTokens: 8000,
        estimatedTokens: 8500,
        inputTokens: 6000,
        outputTokens: 2500,
        costUsd: 0.04,
        costStatus: "CALCULATED",
        providerCallId: "openai_call_b_1",
        attributionPolicy: "DIRECT_CAMPAIGN",
      },
    ]);

    const ledgerA = await getCampaignUsageLedger(TEST_ACCOUNT_ID, CAMPAIGN_A_ID);
    const ledgerB = await getCampaignUsageLedger(TEST_ACCOUNT_ID, CAMPAIGN_B_ID);

    // Campaign A originated the shared Instagram scrape ($0.045) + AI call ($0.0042) + 1 UNKNOWN AI call
    expect(ledgerA.acquisitionUsage.knownOriginatingCostUsd).toBeCloseTo(0.045, 5);
    expect(ledgerA.aiUsage.knownBilledCostUsd).toBeCloseTo(0.0042, 5);
    expect(ledgerA.aiUsage.unknownCostCallCount).toBe(1);
    expect(ledgerA.aiUsage.costStatus).toBe("PARTIAL_UNKNOWN");

    // Campaign B reused the Instagram scrape via CACHE_REUSE -> billed $0 additional on Campaign B (no double-counting!)
    expect(ledgerB.acquisitionUsage.cacheReuseCount).toBe(1);
    expect(ledgerB.acquisitionUsage.sharedConsumerReuseCount).toBe(1);
    expect(ledgerB.acquisitionUsage.knownOriginatingCostUsd).toBe(0);
    expect(ledgerB.aiUsage.knownBilledCostUsd).toBeCloseTo(0.04, 5);
  });

  it("13. Enforces configurable package entitlements (Starter: $199/1, Growth: $399/2, Agency: $699/4)", async () => {
    expect(PROPOSED_PACKAGE_CATALOG.starter.monthlyPriceUsd).toBe(199);
    expect(PROPOSED_PACKAGE_CATALOG.starter.maxActiveCampaigns).toBe(1);
    expect(PROPOSED_PACKAGE_CATALOG.growth.monthlyPriceUsd).toBe(399);
    expect(PROPOSED_PACKAGE_CATALOG.growth.maxActiveCampaigns).toBe(2);
    expect(PROPOSED_PACKAGE_CATALOG.agency.monthlyPriceUsd).toBe(699);
    expect(PROPOSED_PACKAGE_CATALOG.agency.maxActiveCampaigns).toBe(4);

    // Currently TEST_ACCOUNT_ID has 2 active campaigns (CAMPAIGN_A_ID and CAMPAIGN_B_ID).
    // Switch tier to Starter (1 active campaign limit) -> creating a 3rd active campaign must be blocked:
    await setAccountEntitlementTier(TEST_ACCOUNT_ID, "starter");
    const starterCheck = await checkCampaignActivationEntitlement(TEST_ACCOUNT_ID, "camp_new_third");
    expect(starterCheck.allowed).toBe(false);
    expect(starterCheck.entitlement.maxActiveCampaigns).toBe(1);
    expect(starterCheck.entitlement.currentActiveCampaigns).toBe(2);

    // Switch tier to Growth (2 active campaigns limit) -> existing Campaign B is allowed, 3rd campaign is blocked:
    await setAccountEntitlementTier(TEST_ACCOUNT_ID, "growth");
    const growthExistingCheck = await checkCampaignActivationEntitlement(TEST_ACCOUNT_ID, CAMPAIGN_B_ID);
    expect(growthExistingCheck.allowed).toBe(true);
    const growthThirdCheck = await checkCampaignActivationEntitlement(TEST_ACCOUNT_ID, "camp_new_third");
    expect(growthThirdCheck.allowed).toBe(false);

    // Switch tier to Agency (4 active campaigns limit) -> 3rd campaign is allowed:
    await setAccountEntitlementTier(TEST_ACCOUNT_ID, "agency");
    const agencyThirdCheck = await checkCampaignActivationEntitlement(TEST_ACCOUNT_ID, "camp_new_third");
    expect(agencyThirdCheck.allowed).toBe(true);
    expect(agencyThirdCheck.entitlement.maxActiveCampaigns).toBe(4);
  });

  it("14. Preserves existing Songai campaign (camp_ac86e8b8-55b), owner, active approved strategy plan, and approval records intact", async () => {
    const [songaiSelection] = await db
      .select()
      .from(campaignSelections)
      .where(eq(campaignSelections.selectedCampaignId, "camp_ac86e8b8-55b"));

    expect(songaiSelection).toBeDefined();
    expect(songaiSelection.accountId).toBe("ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f");
    expect(songaiSelection.businessId).toBe("biz_songai_ce5c11b9");
    expect(songaiSelection.productId).toBe("prod_songai_personalized_songs");

    const [songaiPlan] = await db
      .select()
      .from(strategicPlans)
      .where(eq(strategicPlans.id, "c3e6a7a0-56be-4538-b9de-529302903435"));

    expect(songaiPlan).toBeDefined();
    expect(songaiPlan.campaignId).toBe("camp_ac86e8b8-55b");
    expect(songaiPlan.status).toBe("APPROVED");
    expect(songaiPlan.version).toBe(4);
    expect(songaiPlan.isDesignatedActive).toBe(true);

    const [songaiApproval] = await db
      .select()
      .from(planApprovals)
      .where(eq(planApprovals.id, "6659f930-e3d8-4b8a-86c1-de562857a69c"));

    expect(songaiApproval).toBeDefined();
    expect(songaiApproval.planId).toBe("c3e6a7a0-56be-4538-b9de-529302903435");
    expect(songaiApproval.accountId).toBe("ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f");
  });
});
