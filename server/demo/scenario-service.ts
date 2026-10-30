/**
 * AVYRON DEMO ENVIRONMENT — Deterministic Scenario & State Service
 *
 * Implements resettable, idempotent recording states (A through F) for
 * Zeytun Atelier — Antep Pistachio Baklava & Kadayif Assortment Box (400g).
 *
 * All writes are fail-closed behind `assertDemoEnvironmentSafe()` and strictly
 * scoped to `DEMO_ACCOUNT_ID` ("acc_demo_zeytun_400g") and `DEMO_CAMPAIGN_ID`
 * ("camp_demo_zeytun_400g"). Zero outbound LLM, Apify, or notification calls
 * ever occur.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ENGINE_PRIORITY_ORDER } from "../orchestrator/priority-matrix";
import { buildRootBundle } from "../root-bundle";
import {
  assertDemoEnvironmentSafe,
  DEMO_ACCOUNT_ID,
  DEMO_BRAND_NAME,
  DEMO_CAMPAIGN_ID,
  DEMO_OFFERING_NAME,
  DEMO_SCENARIO_META,
  DEMO_SCENARIO_ORDER,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_NAME,
  DEMO_WEBSITE_URL,
  DemoScenarioState,
} from "./config";
import {
  buildDemoDifferentiationPillars,
  buildDemoEvidenceUrl,
  buildDemoExecutionTasks,
  buildDemoMonthlyReportPayload,
  buildDemoPerformanceContext,
  buildDemoStrategicPlanJson,
  DEMO_APPROVED_PAINS,
  DEMO_AUDIENCE_SEGMENTS,
  DEMO_BUSINESS_UNDERSTANDING_JSON,
  DEMO_COMPETITORS_DATA,
  DEMO_CONTENT_DNA_LIST,
  DEMO_DESIRES,
  DEMO_EVIDENCE_RECORDS,
  DEMO_IDS,
  DEMO_MECHANISM_SNAPSHOT_DATA,
  DEMO_MI_SNAPSHOT_DATA,
  DEMO_OBJECTIONS,
  DEMO_POSITIONING_SNAPSHOT_DATA,
  DEMO_PROPOSAL_SUMMARY,
  DEMO_REASONING_HYPOTHESES,
  DEMO_WATCHTOWER_EVENT_EVIDENCE,
  DEMO_WATCHTOWER_STRATEGIC_BRIEF,
} from "./fixtures";
import {
  buildComposedDemoExecutionTasks,
  buildComposedDemoStrategicPlanJson,
  DEMO_ADDITIONAL_EVIDENCE_RECORDS,
  DEMO_DEEP_REASONING_SCENARIOS,
  DEMO_PERFORMANCE_LOOP_CASES,
  DEMO_WATCHTOWER_EVENTS_LIST,
  DemoDeepReasoningScenarioId,
} from "./scenarios-extension";

let activeGenerationTimer: NodeJS.Timeout | null = null;
let currentExplicitScenarioState: DemoScenarioState | null = null;

export function clearDemoGenerationTimer() {
  if (activeGenerationTimer) {
    clearTimeout(activeGenerationTimer);
    activeGenerationTimer = null;
  }
}

/**
 * Ensures the synthetic demo user, campaign, website snapshot, selected offering,
 * business understanding snapshot, and 3 tracked competitors exist.
 */
export async function ensureDemoBaseSetup() {
  assertDemoEnvironmentSafe();

  // 1. Synthetic Demo User
  await db
    .insert(schema.users)
    .values({
      id: DEMO_USER_ID,
      username: "zeytun_atelier_demo",
      password: "demo_isolated_no_login_hash",
      email: DEMO_USER_EMAIL,
      accountId: DEMO_ACCOUNT_ID,
      hasSeenIntro: true,
      subscriptionStatus: "active",
      planType: "pro",
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        accountId: DEMO_ACCOUNT_ID,
        hasSeenIntro: true,
        subscriptionStatus: "active",
        planType: "pro",
      },
    });

  // 2. Synthetic Demo Growth Campaign
  await db
    .insert(schema.growthCampaigns)
    .values({
      id: DEMO_CAMPAIGN_ID,
      name: `${DEMO_BRAND_NAME} — 400g Assortment Box`,
      stage: "06_READY",
      budget: 4500,
      isActive: true,
      productAnchor: DEMO_OFFERING_NAME,
    })
    .onConflictDoUpdate({
      target: schema.growthCampaigns.id,
      set: {
        name: `${DEMO_BRAND_NAME} — 400g Assortment Box`,
        stage: "06_READY",
        budget: 4500,
        isActive: true,
        productAnchor: DEMO_OFFERING_NAME,
      },
    });

  // 3. Campaign Selection for DEMO_ACCOUNT_ID
  await db
    .delete(schema.campaignSelections)
    .where(eq(schema.campaignSelections.accountId, DEMO_ACCOUNT_ID));

  await db.insert(schema.campaignSelections).values({
    accountId: DEMO_ACCOUNT_ID,
    selectedCampaignId: DEMO_CAMPAIGN_ID,
    selectedCampaignName: `${DEMO_BRAND_NAME} — 400g Assortment Box`,
    selectedPlatform: "instagram",
    campaignGoalType: "sales",
    campaignStatus: "active",
    campaignLocation: "United States",
    dataSourceMode: "SIMULATED",
  });

  // 4. First-Party Website Snapshot
  await db
    .delete(schema.websiteSnapshots)
    .where(
      and(
        eq(schema.websiteSnapshots.accountId, DEMO_ACCOUNT_ID),
        eq(schema.websiteSnapshots.campaignId, DEMO_CAMPAIGN_ID),
      ),
    );

  await db.insert(schema.websiteSnapshots).values({
    id: DEMO_IDS.websiteSnapshotId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    rootUrl: DEMO_WEBSITE_URL,
    pagesCrawled: [
      {
        evidenceId: "ev_web_zeytun_01",
        pageType: "PRODUCT",
        url: `${DEMO_WEBSITE_URL}/products/antep-pistachio-baklava-kadayif-400g-tin`,
        title: `${DEMO_OFFERING_NAME} — $32.00 USD`,
        snippet:
          "Zeytun Atelier — Antep Pistachio Baklava & Kadayif Assortment Box (400g / 18 pieces). Crafted in our New York atelier with 38% early-harvest Boz Antep pistachio by weight (152g pure pistachio), 100% sheep-milk clarified butter (sade yağ), and a 24% micro-brix natural beet-sugar infusion. Priced at $32.00 USD per 400g nitrogen-flushed lacquered tin, or $60.00 USD for the 2-Tin Host Bundle with Free 2-Day US Air Shipping.",
      },
      {
        evidenceId: "ev_web_zeytun_02",
        pageType: "POLICIES",
        url: `${DEMO_WEBSITE_URL}/pages/freshness-allergens-and-shipping`,
        title: "Freshness Boundaries, Allergens & 2-Day Air Dispatch",
        snippet:
          "Zero preservatives or artificial humectants: ambient crunch window is strictly 10 days after opening the nitrogen seal (45 days sealed). Contains pistachio tree nuts, wheat gluten, and clarified sheep-milk dairy butter. Dispatched via 2-day air across the United States.",
      },
    ],
    contentHash: "hash_demo_zeytun_website_v1",
    status: "COMPLETE",
  });

  // 5. Selected Campaign Offering
  await db
    .delete(schema.campaignOfferings)
    .where(
      and(
        eq(schema.campaignOfferings.accountId, DEMO_ACCOUNT_ID),
        eq(schema.campaignOfferings.campaignId, DEMO_CAMPAIGN_ID),
      ),
    );

  await db.insert(schema.campaignOfferings).values({
    id: DEMO_IDS.offeringId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    offeringName: DEMO_OFFERING_NAME,
    sourceInputEvidenceId: "ev_web_zeytun_01",
  });

  // 6. User Public Profile
  await db
    .delete(schema.userPublicProfiles)
    .where(
      and(
        eq(schema.userPublicProfiles.accountId, DEMO_ACCOUNT_ID),
        eq(schema.userPublicProfiles.campaignId, DEMO_CAMPAIGN_ID),
      ),
    );

  await db.insert(schema.userPublicProfiles).values({
    id: DEMO_IDS.userProfileId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    platform: "instagram",
    handle: "@zeytunatelier",
    url: "https://instagram.com/zeytunatelier",
  });

  // 7. Business Understanding Snapshot
  await db
    .delete(schema.businessUnderstandingSnapshots)
    .where(
      and(
        eq(schema.businessUnderstandingSnapshots.accountId, DEMO_ACCOUNT_ID),
        eq(schema.businessUnderstandingSnapshots.campaignId, DEMO_CAMPAIGN_ID),
      ),
    );

  await db.insert(schema.businessUnderstandingSnapshots).values({
    id: DEMO_IDS.buSnapshotId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    websiteSnapshotId: DEMO_IDS.websiteSnapshotId,
    offeringInputEvidenceId: "ev_web_zeytun_01",
    campaignOfferingId: DEMO_IDS.offeringId,
    version: 1,
    businessUnderstanding: DEMO_BUSINESS_UNDERSTANDING_JSON,
    status: "COMPLETE",
  });

  // 8. Competitors, Competitor Website Snapshots, Understanding Snapshots, Posts & Classifications
  const compIds = DEMO_COMPETITORS_DATA.map((c) => c.id);
  for (const comp of DEMO_COMPETITORS_DATA) {
    for (const post of comp.posts) {
      await db
        .delete(schema.competitorPostClassifications)
        .where(eq(schema.competitorPostClassifications.postId, post.id));
    }
    await db
      .delete(schema.ciCompetitorPosts)
      .where(eq(schema.ciCompetitorPosts.competitorId, comp.id));
  }

  await db
    .delete(schema.miRefreshSchedule)
    .where(eq(schema.miRefreshSchedule.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.competitorUnderstandingSnapshots)
    .where(eq(schema.competitorUnderstandingSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.competitorWebsiteSnapshots)
    .where(eq(schema.competitorWebsiteSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.ciCompetitors)
    .where(eq(schema.ciCompetitors.campaignId, DEMO_CAMPAIGN_ID));

  const now = new Date();
  const nextRefresh = new Date(now.getTime() + 3 * 24 * 3600 * 1000);

  for (const comp of DEMO_COMPETITORS_DATA) {
    // CRITICAL: isDemo must be false so settings-routes and market-intelligence-service
    // do not filter out the tracked competitors in the demo campaign.
    await db.insert(schema.ciCompetitors).values({
      id: comp.id,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      name: comp.name,
      handle: comp.handle,
      platform: comp.platform,
      businessType: comp.businessType,
      primaryObjective: "sales",
      websiteUrl: comp.websiteUrl,
      isDemo: false,
      isActive: true,
      tier: comp.tier,
      strategicRole: comp.strategicRole,
      followersCount: comp.followersCount,
      engagementRate: comp.engagementRate,
      postingFrequency: Math.round(comp.postingFrequency),
      postsCollected: comp.postsCollected,
      dataFreshnessDays: comp.dataFreshnessDays,
      lastScrapedAt: now,
    });

    const webSnapId = `cwsnap_${comp.id}`;
    await db.insert(schema.competitorWebsiteSnapshots).values({
      id: webSnapId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      competitorId: comp.id,
      websiteUrl: comp.websiteUrl,
      pagesCrawled: comp.pagesCrawled,
      contentHash: `hash_${comp.id}_v1`,
      status: "COMPLETE",
    });

    await db.insert(schema.competitorUnderstandingSnapshots).values({
      id: `cusnap_${comp.id}`,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      competitorId: comp.id,
      competitorWebsiteSnapshotId: webSnapId,
      status: "COMPLETE",
      competitorUnderstanding: comp.understanding,
    });

    await db.insert(schema.miRefreshSchedule).values({
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      competitorId: comp.id,
      nextRefreshAt: nextRefresh,
      intervalDays: 3,
      status: "active",
      lastRefreshAt: now,
    });

    for (const post of comp.posts) {
      await db.insert(schema.ciCompetitorPosts).values({
        id: post.id,
        competitorId: comp.id,
        accountId: DEMO_ACCOUNT_ID,
        postId: post.externalPostId,
        permalink: post.permalink,
        mediaType: post.postType === "reel" ? "VIDEO" : "CAROUSEL_ALBUM",
        caption: post.caption,
        likes: post.likes,
        comments: post.comments,
        views: post.views,
        timestamp: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
        platform: "instagram",
        hookText: post.hookText,
      });

      await db.insert(schema.competitorPostClassifications).values({
        postId: post.id,
        competitorId: comp.id,
        primaryHook: post.classification.primaryHook,
        primaryAngle: post.classification.hookArchetype,
        hookArchetype: "CURIOSITY_GAP",
        narrative: "BEFORE_AFTER",
        ctaType: "SHOP_NOW",
        offerType: comp.id === DEMO_IDS.competitors.kervansaray ? "DISCOUNT" : "PRODUCT_LAUNCH",
        emotionalTrigger: comp.id === DEMO_IDS.competitors.kervansaray ? "CURIOSITY" : "TRUST",
        awarenessStage: "PRODUCT_AWARE",
        positioningStyle: comp.id === DEMO_IDS.competitors.serbetcihan ? "ASPIRATIONAL" : "AUTHORITY",
        contentFormatIntent: post.postType === "reel" ? "PRODUCT_DEMO" : "PROMOTIONAL",
        primaryGoal: "CONVERSION",
        confidenceScore: 0.92,
        classifierVersion: "competitor-post-v2",
        classifiedAt: now,
      });
    }
  }

  return { compIds };
}

/**
 * Deletes all downstream strategy, Watchtower, reasoning, performance, WTDT,
 * and monthly report rows for the isolated demo campaign only.
 */
export async function clearDownstreamDemoArtifacts() {
  assertDemoEnvironmentSafe();

  await db
    .delete(schema.monthlyReports)
    .where(eq(schema.monthlyReports.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.dailyExecutionTasks)
    .where(eq(schema.dailyExecutionTasks.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.executionChannelCoverage)
    .where(eq(schema.executionChannelCoverage.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.executionDays)
    .where(eq(schema.executionDays.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.performanceContexts)
    .where(eq(schema.performanceContexts.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.businessExecutionStates)
    .where(eq(schema.businessExecutionStates.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyChangeAcknowledgements)
    .where(eq(schema.strategyChangeAcknowledgements.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyAdaptationOutcomes)
    .where(eq(schema.strategyAdaptationOutcomes.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyAdaptationLineages)
    .where(eq(schema.strategyAdaptationLineages.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyChangeProposals)
    .where(eq(schema.strategyChangeProposals.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.adaptiveDecisions)
    .where(eq(schema.adaptiveDecisions.campaignId, DEMO_CAMPAIGN_ID));
  const allCaseIds = [
    DEMO_IDS.reasoningCaseId,
    ...DEMO_DEEP_REASONING_SCENARIOS.map((s) => s.reasoningCaseId),
  ];
  await db
    .delete(schema.reasoningHypotheses)
    .where(inArray(schema.reasoningHypotheses.reasoningCaseId, allCaseIds));
  await db
    .delete(schema.reasoningCases)
    .where(eq(schema.reasoningCases.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.watchtowerStrategicBriefs)
    .where(eq(schema.watchtowerStrategicBriefs.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.pipelineChangeEvents)
    .where(eq(schema.pipelineChangeEvents.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategicPlans)
    .where(eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.rootBundles)
    .where(eq(schema.rootBundles.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyRoots)
    .where(eq(schema.strategyRoots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.orchestratorJobs)
    .where(eq(schema.orchestratorJobs.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategyDecisions)
    .where(eq(schema.strategyDecisions.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.strategicPainDecisions)
    .where(eq(schema.strategicPainDecisions.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.mechanismSnapshots)
    .where(eq(schema.mechanismSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.differentiationSnapshots)
    .where(eq(schema.differentiationSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.positioningSnapshots)
    .where(eq(schema.positioningSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.audienceSnapshots)
    .where(eq(schema.audienceSnapshots.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.marketVoiceEvidence)
    .where(eq(schema.marketVoiceEvidence.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.miFetchJobs)
    .where(eq(schema.miFetchJobs.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.miSnapshots)
    .where(eq(schema.miSnapshots.campaignId, DEMO_CAMPAIGN_ID));
}

/**
 * Seeds the upstream analytical snapshots (Market Intelligence, Customer Voice,
 * Audience, Positioning, Differentiation, Mechanism, and Pain Decisions).
 */
async function seedUpstreamSnapshots(jobId: string, diffVersion: 1 | 2 = 1) {
  const now = new Date();
  const compIds = DEMO_COMPETITORS_DATA.map((c) => c.id);

  // 1. MI Snapshot & Fetch Job
  await db
    .insert(schema.miSnapshots)
    .values({
      id: DEMO_IDS.miSnapshotId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      jobId,
      version: 1,
      includedCompetitorIds: JSON.stringify(compIds),
      marketState: DEMO_MI_SNAPSHOT_DATA.marketState,
      contentDnaData: JSON.stringify(DEMO_CONTENT_DNA_LIST),
      opportunitySignals: JSON.stringify(DEMO_MI_SNAPSHOT_DATA.opportunitySignals),
      threatSignals: JSON.stringify(DEMO_MI_SNAPSHOT_DATA.threatSignals),
      marketDiagnosis: DEMO_MI_SNAPSHOT_DATA.marketDiagnosis,
      dataFreshnessDays: 1,
      overallConfidence: 0.91,
      confidenceLevel: "HIGH",
      status: "COMPLETE",
      dataStatus: "SUFFICIENT",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.miFetchJobs)
    .values({
      id: DEMO_IDS.miFetchJobId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      status: "DONE",
      totalPostsFetched: 6,
      competitorCount: 3,
      snapshotIdCreated: DEMO_IDS.miSnapshotId,
      completedAt: now,
    })
    .onConflictDoNothing();

  // 2. Customer Voice Evidence (marketVoiceEvidence)
  const customerReviews = [
    ...DEMO_EVIDENCE_RECORDS,
    ...DEMO_ADDITIONAL_EVIDENCE_RECORDS,
  ].filter((r) => r.sourceType === "CUSTOMER_REVIEW");
  for (const rev of customerReviews) {
    await db
      .insert(schema.marketVoiceEvidence)
      .values({
        id: rev.id,
        discoveryResultId: `dres_${rev.id}`,
        searchIntentId: `sint_${rev.id}`,
        discoveryJobId: `djob_${DEMO_CAMPAIGN_ID}`,
        accountId: DEMO_ACCOUNT_ID,
        campaignId: DEMO_CAMPAIGN_ID,
        campaignOfferingId: DEMO_IDS.offeringId,
        verbatimText: `${rev.title} — "${rev.verbatimText}"`,
        platform: rev.platform,
        externalUrl: buildDemoEvidenceUrl(rev.domainSlug, rev.id),
        publishedAt: new Date(rev.publishedAt),
        geography: "United States",
        language: "en",
        eligibilityVerdict: "ELIGIBLE",
      })
      .onConflictDoNothing();
  }

  // 3. Audience Snapshot
  await db
    .insert(schema.audienceSnapshots)
    .values({
      id: DEMO_IDS.audienceSnapshotId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      jobId,
      miSnapshotId: DEMO_IDS.miSnapshotId,
      audiencePains: JSON.stringify(
        DEMO_APPROVED_PAINS.map((p) => ({
          id: p.painId,
          painId: p.painId,
          pain: p.canonical,
          canonical: p.canonical,
          originalStatement: p.originalStatement,
          experience: p.experience,
          commercialImpact: p.commercialImpact,
          whyWeCanSolveIt: p.whyWeCanSolveIt,
          severity: p.severity,
          classification: p.classification,
          productFit: p.productFit,
          evidence: p.evidence,
        })),
      ),
      desireMap: JSON.stringify(DEMO_DESIRES),
      objectionMap: JSON.stringify(DEMO_OBJECTIONS),
      audienceSegments: JSON.stringify(DEMO_AUDIENCE_SEGMENTS),
      structuredSignals: JSON.stringify({
        productFitConclusion: "STRONG_DIRECT_FIT",
        verifiedCapabilitiesMatched: 3,
        honoredBoundariesCount: 3,
      }),
    })
    .onConflictDoUpdate({
      target: schema.audienceSnapshots.id,
      set: {
        audiencePains: JSON.stringify(
          DEMO_APPROVED_PAINS.map((p) => ({
            id: p.painId,
            painId: p.painId,
            pain: p.canonical,
            canonical: p.canonical,
            originalStatement: p.originalStatement,
            experience: p.experience,
            commercialImpact: p.commercialImpact,
            whyWeCanSolveIt: p.whyWeCanSolveIt,
            severity: p.severity,
            classification: p.classification,
            productFit: p.productFit,
            evidence: p.evidence,
          })),
        ),
        desireMap: JSON.stringify(DEMO_DESIRES),
        objectionMap: JSON.stringify(DEMO_OBJECTIONS),
        audienceSegments: JSON.stringify(DEMO_AUDIENCE_SEGMENTS),
      },
    });

  // 4. Strategic Pain Decisions
  for (const pain of DEMO_APPROVED_PAINS) {
    await db
      .insert(schema.strategicPainDecisions)
      .values({
        id: `spd_${pain.painId}`,
        jobId,
        campaignId: DEMO_CAMPAIGN_ID,
        accountId: DEMO_ACCOUNT_ID,
        painId: pain.painId,
        finalClassification: pain.classification,
        status: "APPROVED",
        reason: `Verified strong direct product fit with ${DEMO_OFFERING_NAME} (${pain.productFit}).`,
        payload: {
          painId: pain.painId,
          canonical: pain.canonical,
          originalStatement: pain.originalStatement,
          severity: pain.severity,
          productFit: pain.productFit,
          evidence: pain.evidence,
        },
      })
      .onConflictDoNothing();
  }

  // 5. Positioning Snapshot
  await db
    .insert(schema.positioningSnapshots)
    .values({
      id: DEMO_IDS.positioningSnapshotId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      jobId,
      miSnapshotId: DEMO_IDS.miSnapshotId,
      audienceSnapshotId: DEMO_IDS.audienceSnapshotId,
      status: "COMPLETE",
      territory: DEMO_POSITIONING_SNAPSHOT_DATA.territory,
      contrastAxis: DEMO_POSITIONING_SNAPSHOT_DATA.contrastAxis,
      narrativeDirection: DEMO_POSITIONING_SNAPSHOT_DATA.narrativeDirection,
      strategyCards: JSON.stringify(DEMO_POSITIONING_SNAPSHOT_DATA.strategyCards),
      territories: JSON.stringify(DEMO_POSITIONING_SNAPSHOT_DATA.territories),
      confidenceScore: 0.92,
    })
    .onConflictDoNothing();

  // 6. Differentiation Snapshot
  const diffSnapId =
    diffVersion === 2
      ? DEMO_IDS.differentiationSnapshotIdV2
      : DEMO_IDS.differentiationSnapshotIdV1;
  await db
    .insert(schema.differentiationSnapshots)
    .values({
      id: diffSnapId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      jobId,
      miSnapshotId: DEMO_IDS.miSnapshotId,
      audienceSnapshotId: DEMO_IDS.audienceSnapshotId,
      positioningSnapshotId: DEMO_IDS.positioningSnapshotId,
      status: "COMPLETE",
      differentiationPillars: JSON.stringify(
        buildDemoDifferentiationPillars(diffVersion),
      ),
      authorityMode: "VERIFIED_CAPABILITY",
      confidenceScore: 0.93,
    })
    .onConflictDoNothing();

  // 7. Mechanism Snapshot
  await db
    .insert(schema.mechanismSnapshots)
    .values({
      id: DEMO_IDS.mechanismSnapshotId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      jobId,
      positioningSnapshotId: DEMO_IDS.positioningSnapshotId,
      differentiationSnapshotId: diffSnapId,
      status: "COMPLETE",
      primaryMechanism: JSON.stringify(DEMO_MECHANISM_SNAPSHOT_DATA),
      confidenceScore: 0.91,
    })
    .onConflictDoNothing();

  // 8. Strategy Decisions (for Audience & Positioning screen)
  await db
    .insert(schema.strategyDecisions)
    .values({
      id: "sdec_demo_zeytun_001",
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      trigger: "Customer Voice & Competitor Catalog Synthesis",
      action:
        "Anchor positioning on 38% Boz Antep Pistachio weight (152g) & 24% micro-brix beet-sugar crunch vs 50%+ glucose-syrup gift boxes.",
      reason:
        "Directly resolves #1 buyer pain (syrup-logged 400g trays) using verified first-party product truth.",
      status: "ACTIVE",
    })
    .onConflictDoNothing();
}

/**
 * Seeds Strategy Plan v1 (orchestrator job, strategy root, root bundle, strategic plan,
 * execution tasks, performance context, and baseline monthly report).
 */
async function seedStrategyV1Artifacts(opts: { planApproved: boolean }) {
  const planJson = buildDemoStrategicPlanJson(1);
  const baselineTasks = buildComposedDemoExecutionTasks([]);
  (planJson as any).weeklyActionPlan = baselineTasks.map((t, idx) => ({
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][idx % 5],
    taskId: t.id,
    title: t.title,
    channel: t.platform,
    priority: t.priority,
    laneTitle: t.laneTitle,
    objective: t.description,
  }));
  const completedSections = ENGINE_PRIORITY_ORDER.map((e) => ({
    id: e.id,
    name: e.name,
    status: "SUCCESS",
    summary: `${e.name} verified for ${DEMO_OFFERING_NAME}`,
  }));

  await seedUpstreamSnapshots(DEMO_IDS.orchJobIdV1, 1);

  // 1. Ensure Orchestrator Job v1 exists before child foreign keys, mark COMPLETED at the very end
  await db
    .insert(schema.orchestratorJobs)
    .values({
      id: DEMO_IDS.orchJobIdV1,
      blueprintId: "orchestrator-v2",
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      status: "RUNNING",
      sectionStatuses: JSON.stringify(completedSections),
    })
    .onConflictDoNothing();

  // 2. Strategy Root v1
  await db.insert(schema.strategyRoots).values({
    id: DEMO_IDS.strategyRootIdV1,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    runId: DEMO_IDS.orchJobIdV1,
    rootHash: "hash_demo_zeytun_root_v1",
    primaryAxis: planJson.brandSpine.umbrellaPositionName,
    contrastAxisText: planJson.brandSpine.contrastAxis,
    approvedMechanism: JSON.stringify(planJson.mechanism),
    approvedAudiencePains: JSON.stringify(DEMO_APPROVED_PAINS),
    approvedDesires: JSON.stringify(DEMO_DESIRES),
    approvedTransformation:
      "From risking soggy, glucose-logged baklava gift trays to presenting a nitrogen-sealed 400g tin with 152g (38%) Boz pistachio and audible 40-layer crunch.",
    approvedClaim: planJson.differentiationPillars[0].claim,
    approvedClaims: JSON.stringify(
      planJson.differentiationPillars.map((p) => p.claim),
    ),
    approvedPromise: planJson.brandSpine.primaryPromise,
    approvedObjections: JSON.stringify(DEMO_OBJECTIONS),
    approvedProofTypes: JSON.stringify([
      "Macro Cross-Section Cut-Open Video",
      "Printed Batch Roast Card (152g Boz Pistachio / 96g Syrup / 152g Pastry)",
      "Nitrogen-Flushed Seal & Honeycomb Divider Tray",
    ]),
    approvedPositioningContext: JSON.stringify(planJson.positioning),
    miSnapshotId: DEMO_IDS.miSnapshotId,
    audienceSnapshotId: DEMO_IDS.audienceSnapshotId,
    positioningSnapshotId: DEMO_IDS.positioningSnapshotId,
    differentiationSnapshotId: DEMO_IDS.differentiationSnapshotIdV1,
    mechanismSnapshotId: DEMO_IDS.mechanismSnapshotId,
    status: "ACTIVE",
    brandSpine: planJson.brandSpine,
    approvedLanes: planJson.approvedLanes,
  });

  // 3. Root Bundle v1 (using buildRootBundle so detectStaleness is false)
  const builtBundle = await buildRootBundle(DEMO_CAMPAIGN_ID, DEMO_ACCOUNT_ID);
  await db.insert(schema.rootBundles).values({
    id: DEMO_IDS.rootBundleIdV1,
    campaignId: DEMO_CAMPAIGN_ID,
    accountId: DEMO_ACCOUNT_ID,
    version: 1,
    businessRoots: JSON.stringify(builtBundle.businessRoots),
    funnelRoots: JSON.stringify(builtBundle.funnelRoots),
    contentRoots: JSON.stringify(builtBundle.contentRoots),
    executionRoots: JSON.stringify(builtBundle.executionRoots),
    mathRoots: JSON.stringify(builtBundle.mathRoots),
    strategyHash: builtBundle.strategyHash,
    sourceSnapshot: JSON.stringify({
      ...builtBundle.sourceSnapshot,
      strategyRootId: DEMO_IDS.strategyRootIdV1,
    }),
    status: "active",
    lockedAt: new Date(),
  });

  // 4. Strategic Plan v1
  await db.insert(schema.strategicPlans).values({
    id: DEMO_IDS.strategicPlanIdV1,
    accountId: DEMO_ACCOUNT_ID,
    blueprintId: "orchestrator-v2",
    campaignId: DEMO_CAMPAIGN_ID,
    jobId: DEMO_IDS.orchJobIdV1,
    planJson: JSON.stringify(planJson),
    planSummary: planJson.strategicSummary.headline,
    status: opts.planApproved ? "APPROVED" : "DRAFT",
    executionStatus: opts.planApproved ? "APPROVED_READY" : "PENDING_APPROVAL",
    approvedAt: opts.planApproved ? new Date() : null,
    approvedBy: opts.planApproved ? DEMO_USER_ID : null,
    isDesignatedActive: opts.planApproved,
    designatedAt: opts.planApproved ? new Date() : null,
    rootBundleId: DEMO_IDS.rootBundleIdV1,
    rootBundleVersion: 1,
    version: 1,
  });

  // 5. Execution Days & What To Do Today Tasks (v1)
  const todayStr = new Date().toISOString().split("T")[0];
  const tasksV1 = baselineTasks;
  await db.insert(schema.executionDays).values({
    id: DEMO_IDS.execDayIdV1,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    businessDate: todayStr,
    strategyRootId: DEMO_IDS.strategyRootIdV1,
    rootBundleId: DEMO_IDS.rootBundleIdV1,
    strategicPlanId: DEMO_IDS.strategicPlanIdV1,
    planningContextId: DEMO_IDS.perfContextIdV1,
    dailyMission:
      "Execute Strategy v1 launch actions for the 400g Antep Pistachio Baklava & Kadayif Assortment Tin ($32 USD).",
    executionRationale:
      "Lead with 38% (152g) Boz pistachio weight, 100% clarified butter ghee, and nitrogen-sealed 18-piece tin proof across Meta Reels and high-intent Google Search.",
    status: "ACTIVE",
    generationVersion: 1,
  });

  const seedNow = new Date();
  for (let idx = 0; idx < tasksV1.length; idx++) {
    const t = tasksV1[idx];
    await db.insert(schema.dailyExecutionTasks).values({
      id: t.id,
      executionDayId: DEMO_IDS.execDayIdV1,
      campaignId: DEMO_CAMPAIGN_ID,
      strategyRootId: DEMO_IDS.strategyRootIdV1,
      laneId: t.laneId,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
      status: t.status,
      channel: t.channel,
      channelRole: t.channelRole,
      objective: t.description,
      reason: t.whyItMatters,
      expectedOutcome: t.expectedOutcome || t.whyItMatters,
      sourceAuthority: t.sourceAuthority,
      estimatedEffort: `${t.estimatedMinutes} min`,
      sequenceOrder: idx + 1,
      executionApproach: t.productionBlueprint.scriptOutline.join(" -> "),
      proofRequired:
        "152g (38%) Boz Pistachio batch card & 100% clarified butter ghee",
      ctaDestination:
        "https://zeytun-atelier.demo.invalid/products/antep-400g-assortment",
      productionBlueprint: t.productionBlueprint,
      completedAt: t.status === "DONE" ? seedNow : null,
    });
  }

  // 6. Business Execution State & Performance Context (v1)
  const perfCtxV1 = buildDemoPerformanceContext(1);
  await db.insert(schema.businessExecutionStates).values({
    id: "bstate_demo_zeytun_v1",
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    mode: "OPTIMIZE",
    primaryBottleneck: "CONVERSION",
    evidenceSummary: perfCtxV1.currentReality,
    evidenceRefIds: perfCtxV1.evidenceRefIds,
    confidence: "HIGH",
    freshness: "FRESH",
    status: "ACTIVE",
    reason: perfCtxV1.currentReality,
  });

  await db.insert(schema.performanceContexts).values({
    id: perfCtxV1.id,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    businessExecutionStateId: "bstate_demo_zeytun_v1",
    mode: perfCtxV1.mode,
    currentReality: perfCtxV1.currentReality,
    primaryBottleneck: perfCtxV1.primaryBottleneck,
    weakestSignals: perfCtxV1.weakestSignals,
    proofGaps: perfCtxV1.proofGaps,
    strongestSignals: perfCtxV1.strongestSignals,
    activeChannels: perfCtxV1.activeChannels,
    recentTrend: perfCtxV1.recentTrend,
    confidence: perfCtxV1.confidence,
    freshness: perfCtxV1.freshness,
    evidenceRefIds: perfCtxV1.evidenceRefIds,
  });

  // 7. Monthly Report (v1 baseline)
  const reportPayloadV1 = buildDemoMonthlyReportPayload(1);
  await db.insert(schema.monthlyReports).values({
    id: DEMO_IDS.monthlyReportId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    reportPeriodYear: 2026,
    reportPeriodMonth: 10,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-31T23:59:59.000Z"),
    timezone: "UTC",
    status: "IN_PROGRESS",
    strategyRootIds: [DEMO_IDS.strategyRootIdV1],
    rootBundleVersions: [1],
    strategicPlanIds: [DEMO_IDS.strategicPlanIdV1],
    watchtowerEventIds: [],
    reasoningCaseIds: [],
    adaptiveDecisionIds: [],
    strategyChangeProposalIds: [],
    strategyAdaptationLineageIds: [],
    executionDayIds: [DEMO_IDS.execDayIdV1],
    executionTaskIds: tasksV1.map((t) => t.id),
    sourceMetricIds: [DEMO_IDS.perfContextIdV1],
    reportPayload: reportPayloadV1,
  });

  // 8. Finalize Orchestrator Job v1 as COMPLETED once all v1 artifacts exist
  await db
    .update(schema.orchestratorJobs)
    .set({
      status: "COMPLETED",
      sectionStatuses: JSON.stringify(completedSections),
      planJson: JSON.stringify(planJson),
      planId: DEMO_IDS.strategicPlanIdV1,
      durationMs: 9400,
      completedAt: new Date(),
    })
    .where(eq(schema.orchestratorJobs.id, DEMO_IDS.orchJobIdV1));
}

/**
 * Seeds all 10 meaningful Watchtower events (`pce_demo_wt_01` .. `pce_demo_wt_10`)
 * and their 10 corresponding `watchtower_strategic_briefs` (State D — Recording Baseline).
 */
async function seedWatchtowerMarketChangeEvent() {
  const nowMs = Date.now();
  const HOUR = 3600 * 1000;
  const severityMap: Record<string, string> = {
    major: "high",
    medium: "medium",
    low: "low",
  };

  for (const evt of DEMO_WATCHTOWER_EVENTS_LIST) {
    const firstObserved = new Date(nowMs - evt.createdAtOffsetHours * HOUR);
    const validatedAt =
      evt.validatedAtOffsetHours !== null
        ? new Date(nowMs - evt.validatedAtOffsetHours * HOUR)
        : null;
    const updatedAt = validatedAt || firstObserved;
    const briefId = `wsb_${evt.id.replace(/^pce_/, "")}`;

    // JSON payload parsed by the Reasoning / Watchtower read surfaces.
    const evidencePayload = {
      title: evt.title,
      confidence: evt.confidence,
      competitorName: evt.competitorName,
      categoryLabel: evt.categoryLabel,
      productReferenced: evt.productReferenced,
      segmentName: evt.segmentName,
      laneId: evt.laneId,
      laneTitle: evt.laneTitle,
      beforeState: evt.beforeState,
      afterState: evt.afterState,
      prev: evt.beforeState,
      curr: evt.afterState,
      notes: evt.evidenceNotes,
      evidenceIds: evt.evidenceIds,
      evidenceUrls: evt.evidenceUrls,
      businessRelevance: evt.businessRelevance,
      actionabilityType: evt.actionabilityType,
      nextActionLabel: evt.nextActionLabel,
      linkedScenarioId: evt.linkedScenarioId,
      simulated: true,
    };

    await db
      .insert(schema.pipelineChangeEvents)
      .values({
        id: evt.id,
        runId: evt.runId,
        accountId: DEMO_ACCOUNT_ID,
        campaignId: DEMO_CAMPAIGN_ID,
        baselineSnapshotId: `cwsnap_${evt.competitorId}`,
        currentSnapshotId: `cwsnap_${evt.competitorId}`,
        changeDimension: evt.changeDimension,
        severity: severityMap[evt.severity] || "medium",
        evidence: JSON.stringify(evidencePayload),
        competitorId: evt.competitorId,
        kind: evt.kind,
        status: evt.status,
        createdAt: firstObserved,
        validatedAt: evt.status === "confirmed" ? validatedAt : null,
        updatedAt,
        scope: "single_competitor",
        scopeCompetitorCount: 1,
      })
      .onConflictDoNothing();

    // First observations (candidates) stay in the Watchtower trace without a strategic brief.
    if (evt.status !== "confirmed") continue;

    await db
      .insert(schema.watchtowerStrategicBriefs)
      .values({
        id: briefId,
        eventId: evt.id,
        accountId: DEMO_ACCOUNT_ID,
        campaignId: DEMO_CAMPAIGN_ID,
        competitorId: evt.competitorId,
        status: "ready",
        brief: evt.strategicBrief,
        evidenceRegistry: {
          eventId: evt.id,
          evidenceIds: evt.evidenceIds,
        },
        contextLineage: {
          strategyRootId: DEMO_IDS.strategyRootIdV1,
          rootBundleVersion: 1,
        },
        sourceVersions: {
          promptVersion: "1.0",
          generatorVersion: "1.0",
          judgeVersion: "1.0",
          evidenceVersion: "1.0",
        },
        modelProposedConfidence: evt.confidence,
        finalValidatedConfidence: evt.confidence,
        isLatest: true,
        completedAt: updatedAt,
      })
      .onConflictDoNothing();
  }
}

/**
 * Opens or retrieves the Deep Reasoning investigation for one of the 3 actionable
 * Watchtower events (`pce_demo_wt_01`, `pce_demo_wt_02`, `pce_demo_wt_03`) or
 * scenario IDs (`SCENARIO_A_PRICE`, `SCENARIO_B_GIFTING`, `SCENARIO_C_PACKSIZE`).
 *
 * IMPORTANT: Does NOT apply the strategy patch yet! Leaves the proposal in
 * `PENDING_USER_APPROVAL` so the user clicks the Approve/Apply button during recording.
 */
export async function investigateDemoScenario(eventIdOrScenarioId: string) {
  assertDemoEnvironmentSafe();

  const scenario = DEMO_DEEP_REASONING_SCENARIOS.find(
    (s) =>
      s.eventId === eventIdOrScenarioId ||
      s.scenarioId === eventIdOrScenarioId ||
      s.proposalId === eventIdOrScenarioId ||
      s.reasoningCaseId === eventIdOrScenarioId,
  );

  if (!scenario) {
    throw new Error(
      `No actionable Deep Reasoning scenario configured for "${eventIdOrScenarioId}". Actionable events are pce_demo_wt_01 (Scenario A), pce_demo_wt_02 (Scenario B), and pce_demo_wt_03 (Scenario C).`,
    );
  }

  // Resolve current active strategy root, bundle, and plan so sequential investigations link to the current version
  const [activePlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.strategicPlans.version), desc(schema.strategicPlans.createdAt))
    .limit(1);

  const [activeRoot] = await db
    .select()
    .from(schema.strategyRoots)
    .where(eq(schema.strategyRoots.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.strategyRoots.createdAt))
    .limit(1);

  const [activeBundle] = await db
    .select()
    .from(schema.rootBundles)
    .where(eq(schema.rootBundles.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.rootBundles.version))
    .limit(1);

  const currentRootId = activeRoot?.id || DEMO_IDS.strategyRootIdV1;
  const currentBundleId = activeBundle?.id || DEMO_IDS.rootBundleIdV1;
  const currentVersion = activePlan?.version || activeBundle?.version || 1;
  const currentPlanId = activePlan?.id || DEMO_IDS.strategicPlanIdV1;

  // Check if proposal already exists
  const [existingProposal] = await db
    .select()
    .from(schema.strategyChangeProposals)
    .where(eq(schema.strategyChangeProposals.id, scenario.proposalId))
    .limit(1);

  if (existingProposal) {
    // Ensure if it's still PENDING_USER_APPROVAL that its root pointers match the current active version
    if (existingProposal.status === "PENDING_USER_APPROVAL") {
      await db
        .update(schema.strategyChangeProposals)
        .set({
          currentStrategyRootId: currentRootId,
          currentRootBundleId: currentBundleId,
          currentRootBundleVersion: currentVersion,
          currentStrategicPlanId: currentPlanId,
        })
        .where(eq(schema.strategyChangeProposals.id, scenario.proposalId));
    }

    return {
      success: true,
      alreadyInvestigated: true,
      scenarioId: scenario.scenarioId,
      eventId: scenario.eventId,
      reasoningCaseId: scenario.reasoningCaseId,
      adaptiveDecisionId: scenario.adaptiveDecisionId,
      proposalId: scenario.proposalId,
      proposalStatus: existingProposal.status,
      currentStrategyVersion: currentVersion,
      scenario,
    };
  }

  const now = new Date();

  // 1. Insert Reasoning Case
  await db
    .insert(schema.reasoningCases)
    .values({
      id: scenario.reasoningCaseId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      strategyRootId: currentRootId,
      strategyRootVersion: currentVersion,
      status: "DECIDED",
      marketEventIds: [scenario.eventId],
      performanceWarningIds: [`sig_perf_bottleneck_${DEMO_IDS.perfContextIdV1}`],
      evidenceIds: scenario.evidenceIds,
      openedAt: new Date(now.getTime() - 60 * 1000),
      resolvedAt: now,
    })
    .onConflictDoNothing();

  // 2. Insert Reasoning Hypotheses
  for (const hyp of scenario.hypotheses) {
    await db
      .insert(schema.reasoningHypotheses)
      .values({
        id: hyp.id,
        reasoningCaseId: scenario.reasoningCaseId,
        hypothesisType: hyp.hypothesisType,
        explanation: hyp.explanation,
        supportingEvidenceIds: hyp.supportingEvidenceIds,
        contradictingEvidenceIds: hyp.contradictingEvidenceIds,
        confidence: hyp.confidence,
        status: hyp.status,
      })
      .onConflictDoNothing();
  }

  // 3. Insert Adaptive Decision
  await db
    .insert(schema.adaptiveDecisions)
    .values({
      id: scenario.adaptiveDecisionId,
      reasoningCaseId: scenario.reasoningCaseId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      strategyRootId: currentRootId,
      strategyRootVersion: currentVersion,
      decisionType: "STRATEGY_CHANGE_REQUIRED",
      affectedAuthority: scenario.affectedAuthority,
      affectedLaneIds: scenario.affectedLaneIds,
      affectedEntityIds: scenario.affectedLaneIds,
      evidenceIds: scenario.evidenceIds,
      confidence: 0.92,
      rationale: scenario.whyResponseWarranted,
      metadata: {
        scenarioId: scenario.scenarioId,
        eventId: scenario.eventId,
        affectedLaneIds: scenario.affectedLaneIds,
        secondaryAuthorities: scenario.affectedAuthorities.slice(1),
      },
    })
    .onConflictDoNothing();

  // 4. Insert Pending Strategy Change Proposal
  await db
    .insert(schema.strategyChangeProposals)
    .values({
      id: scenario.proposalId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      reasoningCaseId: scenario.reasoningCaseId,
      adaptiveDecisionId: scenario.adaptiveDecisionId,
      currentStrategyRootId: currentRootId,
      currentRootBundleId: currentBundleId,
      currentRootBundleVersion: currentVersion,
      currentStrategicPlanId: currentPlanId,
      decisionType: "STRATEGY_CHANGE_REQUIRED",
      affectedAuthorities: scenario.affectedAuthorities,
      affectedLaneIds: scenario.affectedLaneIds,
      summary: scenario.proposalSummary,
      whyNow: scenario.whyResponseWarranted,
      evidenceSummary: scenario.whatChanged,
      expectedImpact: scenario.expectedImpact,
      potentialDependentAuthorities: scenario.potentialDependentAuthorities,
      preservedAuthorities: scenario.preservedAuthorities,
      status: "PENDING_USER_APPROVAL",
      metadata: {
        scenarioId: scenario.scenarioId,
        eventId: scenario.eventId,
        title: scenario.title,
        affectedStrategicAssumption: scenario.affectedStrategicAssumption,
        relevantAudience: scenario.relevantAudience,
        relevantOffering: scenario.relevantOffering,
        relevantLaneTitle: scenario.relevantLaneTitle,
        proposedResponse: scenario.proposedResponse,
        tradeOffs: scenario.tradeOffs,
        beforeAfterPatchPreview: scenario.beforeAfterPatchPreview,
        unchangedExplanation: scenario.unchangedExplanation,
        affectedLaneIds: scenario.affectedLaneIds,
        affectedLaneNames: [scenario.relevantLaneTitle],
        potentialDependentAuthorities: scenario.potentialDependentAuthorities,
        preservedAuthorities: scenario.preservedAuthorities,
      },
    })
    .onConflictDoNothing();

  // 5. Update Watchtower Event evidence metadata to reflect investigation opened
  const [wtRow] = await db
    .select()
    .from(schema.pipelineChangeEvents)
    .where(eq(schema.pipelineChangeEvents.id, scenario.eventId))
    .limit(1);
  if (wtRow) {
    try {
      const parsedEv =
        typeof wtRow.evidence === "string"
          ? JSON.parse(wtRow.evidence)
          : wtRow.evidence || {};
      parsedEv.investigationStatus = "INVESTIGATED_PENDING_APPROVAL";
      parsedEv.proposalId = scenario.proposalId;
      parsedEv.reasoningCaseId = scenario.reasoningCaseId;
      await db
        .update(schema.pipelineChangeEvents)
        .set({ evidence: JSON.stringify(parsedEv), updatedAt: now })
        .where(eq(schema.pipelineChangeEvents.id, scenario.eventId));
    } catch {}
  }

  return {
    success: true,
    alreadyInvestigated: false,
    scenarioId: scenario.scenarioId,
    eventId: scenario.eventId,
    reasoningCaseId: scenario.reasoningCaseId,
    adaptiveDecisionId: scenario.adaptiveDecisionId,
    proposalId: scenario.proposalId,
    proposalStatus: "PENDING_USER_APPROVAL",
    currentStrategyVersion: currentVersion,
    scenario,
  };
}

/**
 * Seeds all 3 Deep Reasoning scenarios in `PENDING_USER_APPROVAL` (State E).
 */
async function seedInvestigationAndPendingProposal() {
  for (const scenario of DEMO_DEEP_REASONING_SCENARIOS) {
    await investigateDemoScenario(scenario.scenarioId);
  }
}

/**
 * Approves a specific demo Strategy Change Proposal (`prop_demo_zeytun_001`,
 * `prop_demo_zeytun_002`, or `prop_demo_zeytun_003`) and applies its exact patch
 * on top of all previously applied demo scenarios (`v1 -> v2 -> v3 -> v4`).
 *
 * - Idempotent on repeated clicks (`ALREADY_APPLIED`).
 * - Preserves earlier applied scenario changes when multiple scenarios are approved sequentially.
 * - Updates any remaining `PENDING_USER_APPROVAL` proposals so they never become stale.
 * - Sets adaptation outcome status to `MONITORING` (does NOT manufacture immediate performance results).
 */
export async function approveDemoScenarioProposal(
  proposalId: string,
  opts: { includeSimulatedFollowUpOutcome?: boolean } = {},
) {
  assertDemoEnvironmentSafe();

  const [proposal] = await db
    .select()
    .from(schema.strategyChangeProposals)
    .where(
      and(
        eq(schema.strategyChangeProposals.id, proposalId),
        eq(schema.strategyChangeProposals.campaignId, DEMO_CAMPAIGN_ID),
      ),
    )
    .limit(1);

  if (!proposal) {
    throw new Error(`Demo proposal "${proposalId}" not found.`);
  }

  const scenario =
    DEMO_DEEP_REASONING_SCENARIOS.find((s) => s.proposalId === proposalId) ||
    DEMO_DEEP_REASONING_SCENARIOS[0];

  // Idempotency guard: prevent duplicate application on repeated clicks
  if (proposal.status === "APPLIED" || proposal.status === "APPROVED") {
    return {
      status: "ALREADY_APPLIED",
      executionStatus: "ALREADY_APPLIED",
      proposalId,
      scenarioId: scenario.scenarioId,
      appliedVersion: proposal.appliedNewBundleVersion || 2,
      message: `Scenario "${scenario.title}" was already approved and applied to Strategy v${proposal.appliedNewBundleVersion || 2}.`,
    };
  }

  // Determine ordered list of already-applied scenarios + this newly approved scenario
  const existingAppliedRows = await db
    .select()
    .from(schema.strategyChangeProposals)
    .where(
      and(
        eq(schema.strategyChangeProposals.campaignId, DEMO_CAMPAIGN_ID),
        eq(schema.strategyChangeProposals.status, "APPLIED"),
      ),
    )
    .orderBy(asc(schema.strategyChangeProposals.appliedAt));

  const appliedScenarios: DemoDeepReasoningScenarioId[] = [];
  for (const row of existingAppliedRows) {
    const matched = DEMO_DEEP_REASONING_SCENARIOS.find((s) => s.proposalId === row.id);
    if (matched && !appliedScenarios.includes(matched.scenarioId)) {
      appliedScenarios.push(matched.scenarioId);
    }
  }
  if (!appliedScenarios.includes(scenario.scenarioId)) {
    appliedScenarios.push(scenario.scenarioId);
  }

  // Find current active root & version before superseding
  const [previousPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.strategicPlans.version), desc(schema.strategicPlans.createdAt))
    .limit(1);

  const [previousRoot] = await db
    .select()
    .from(schema.strategyRoots)
    .where(eq(schema.strategyRoots.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.strategyRoots.createdAt))
    .limit(1);

  const previousRootId = previousRoot?.id || DEMO_IDS.strategyRootIdV1;
  const previousVersion = previousPlan?.version || 1;
  const newVersion = 1 + appliedScenarios.length; // v2, v3, or v4

  const now = new Date();
  const composedPlanJson = buildComposedDemoStrategicPlanJson(appliedScenarios);
  const composedTasks = buildComposedDemoExecutionTasks(appliedScenarios);

  const newJobId =
    newVersion === 2 ? DEMO_IDS.orchJobIdV2 : `orch_demo_zeytun_v${newVersion}`;
  const newRootId =
    newVersion === 2 ? DEMO_IDS.strategyRootIdV2 : `sroot_demo_zeytun_v${newVersion}`;
  const newBundleId =
    newVersion === 2 ? DEMO_IDS.rootBundleIdV2 : `rbun_demo_zeytun_v${newVersion}`;
  const newPlanId =
    newVersion === 2 ? DEMO_IDS.strategicPlanIdV2 : `splan_demo_zeytun_v${newVersion}`;
  const newExecDayId =
    newVersion === 2 ? DEMO_IDS.execDayIdV2 : `eday_demo_zeytun_v${newVersion}`;

  const completedSections = ENGINE_PRIORITY_ORDER.map((e) => ({
    id: e.id,
    name: e.name,
    status: "SUCCESS",
    summary: `${e.name} verified for Strategy v${newVersion}`,
  }));

  const hasA = appliedScenarios.includes("SCENARIO_A_PRICE");
  const diffSnapId = hasA
    ? DEMO_IDS.differentiationSnapshotIdV2
    : DEMO_IDS.differentiationSnapshotIdV1;

  if (hasA) {
    await db
      .insert(schema.differentiationSnapshots)
      .values({
        id: DEMO_IDS.differentiationSnapshotIdV2,
        accountId: DEMO_ACCOUNT_ID,
        campaignId: DEMO_CAMPAIGN_ID,
        jobId: newJobId,
        miSnapshotId: DEMO_IDS.miSnapshotId,
        audienceSnapshotId: DEMO_IDS.audienceSnapshotId,
        positioningSnapshotId: DEMO_IDS.positioningSnapshotId,
        status: "COMPLETE",
        differentiationPillars: JSON.stringify(buildDemoDifferentiationPillars(2)),
        authorityMode: "VERIFIED_CAPABILITY",
        confidenceScore: 0.95,
      })
      .onConflictDoNothing();
  }

  // 1. Insert Orchestrator Job for newVersion
  await db
    .insert(schema.orchestratorJobs)
    .values({
      id: newJobId,
      blueprintId: "orchestrator-v2",
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      status: "COMPLETED",
      sectionStatuses: JSON.stringify(completedSections),
      planJson: JSON.stringify(composedPlanJson),
      planId: newPlanId,
      durationMs: 3800,
      completedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.orchestratorJobs.id,
      set: {
        status: "COMPLETED",
        planJson: JSON.stringify(composedPlanJson),
        planId: newPlanId,
        completedAt: now,
      },
    });

  // 2. Supersede previous Strategy Roots and insert new Strategy Root
  await db
    .update(schema.strategyRoots)
    .set({ status: "SUPERSEDED" })
    .where(eq(schema.strategyRoots.campaignId, DEMO_CAMPAIGN_ID));

  await db
    .insert(schema.strategyRoots)
    .values({
      id: newRootId,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      runId: newJobId,
      rootHash: `hash_demo_zeytun_root_v${newVersion}_${appliedScenarios.join("_")}`,
      primaryAxis: composedPlanJson.brandSpine.umbrellaPositionName,
      contrastAxisText: composedPlanJson.brandSpine.contrastAxis,
      approvedMechanism: JSON.stringify(composedPlanJson.mechanism),
      approvedAudiencePains: JSON.stringify(DEMO_APPROVED_PAINS),
      approvedDesires: JSON.stringify(DEMO_DESIRES),
      approvedTransformation: composedPlanJson.strategicSummary.headline,
      approvedClaim: composedPlanJson.differentiationPillars[0].claim,
      approvedClaims: JSON.stringify(
        composedPlanJson.differentiationPillars.map((p: any) => p.claim),
      ),
      approvedPromise: composedPlanJson.brandSpine.primaryPromise,
      approvedObjections: JSON.stringify(DEMO_OBJECTIONS),
      approvedProofTypes: JSON.stringify([
        "Macro Cross-Section Cut-Open Video",
        "Printed Batch Roast Card (152g Boz Pistachio / 96g Syrup / 152g Pastry)",
        ...(hasA ? ["40g Host Preview Tasting Sleeve on $60 2-Tin Bundle"] : []),
        ...(appliedScenarios.includes("SCENARIO_B_GIFTING")
          ? ["Instant Self-Serve Printed Gift Note Card + Free 2-Day Air Dispatch"]
          : []),
        ...(appliedScenarios.includes("SCENARIO_C_PACKSIZE")
          ? ["18-Piece (Serves 6–9) vs 36-Piece (Serves 12–16) Host Serving Guide"]
          : []),
      ]),
      approvedPositioningContext: JSON.stringify(composedPlanJson.positioning),
      miSnapshotId: DEMO_IDS.miSnapshotId,
      audienceSnapshotId: DEMO_IDS.audienceSnapshotId,
      positioningSnapshotId: DEMO_IDS.positioningSnapshotId,
      differentiationSnapshotId: diffSnapId,
      mechanismSnapshotId: DEMO_IDS.mechanismSnapshotId,
      status: "ACTIVE",
      brandSpine: composedPlanJson.brandSpine,
      approvedLanes: composedPlanJson.approvedLanes,
    })
    .onConflictDoUpdate({
      target: schema.strategyRoots.id,
      set: {
        status: "ACTIVE",
        primaryAxis: composedPlanJson.brandSpine.umbrellaPositionName,
        contrastAxisText: composedPlanJson.brandSpine.contrastAxis,
        approvedTransformation: composedPlanJson.strategicSummary.headline,
        approvedClaim: composedPlanJson.differentiationPillars[0].claim,
        approvedClaims: JSON.stringify(
          composedPlanJson.differentiationPillars.map((p: any) => p.claim),
        ),
        brandSpine: composedPlanJson.brandSpine,
        approvedLanes: composedPlanJson.approvedLanes,
      },
    });

  // 3. Supersede previous Root Bundles and insert new Root Bundle
  await db
    .update(schema.rootBundles)
    .set({ status: "stale" })
    .where(eq(schema.rootBundles.campaignId, DEMO_CAMPAIGN_ID));

  const builtBundle = await buildRootBundle(DEMO_CAMPAIGN_ID, DEMO_ACCOUNT_ID);
  await db
    .insert(schema.rootBundles)
    .values({
      id: newBundleId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      version: newVersion,
      businessRoots: JSON.stringify(builtBundle.businessRoots),
      funnelRoots: JSON.stringify(builtBundle.funnelRoots),
      contentRoots: JSON.stringify(builtBundle.contentRoots),
      executionRoots: JSON.stringify(builtBundle.executionRoots),
      mathRoots: JSON.stringify(builtBundle.mathRoots),
      strategyHash: builtBundle.strategyHash,
      sourceSnapshot: JSON.stringify({
        ...builtBundle.sourceSnapshot,
        strategyRootId: newRootId,
        appliedScenarios,
      }),
      status: "active",
      lockedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.rootBundles.id,
      set: {
        version: newVersion,
        status: "active",
        lockedAt: now,
      },
    });

  // 4. Supersede previous Strategic Plans and insert new Approved Strategic Plan
  await db
    .update(schema.strategicPlans)
    .set({ status: "SUPERSEDED", isDesignatedActive: false })
    .where(eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID));

  await db
    .insert(schema.strategicPlans)
    .values({
      id: newPlanId,
      accountId: DEMO_ACCOUNT_ID,
      blueprintId: "orchestrator-v2",
      campaignId: DEMO_CAMPAIGN_ID,
      jobId: newJobId,
      planJson: JSON.stringify(composedPlanJson),
      planSummary: composedPlanJson.strategicSummary.headline,
      status: "APPROVED",
      executionStatus: "APPROVED_READY",
      approvedAt: now,
      approvedBy: DEMO_USER_ID,
      isDesignatedActive: true,
      designatedAt: now,
      rootBundleId: newBundleId,
      rootBundleVersion: newVersion,
      version: newVersion,
    })
    .onConflictDoUpdate({
      target: schema.strategicPlans.id,
      set: {
        planJson: JSON.stringify(composedPlanJson),
        planSummary: composedPlanJson.strategicSummary.headline,
        status: "APPROVED",
        executionStatus: "APPROVED_READY",
        approvedAt: now,
        isDesignatedActive: true,
        rootBundleId: newBundleId,
        rootBundleVersion: newVersion,
        version: newVersion,
      },
    });

  // 5. Mark the approved Proposal as APPLIED
  await db
    .update(schema.strategyChangeProposals)
    .set({
      status: "APPLIED",
      reviewedAt: now,
      appliedAt: now,
      appliedNewRootId: newRootId,
      appliedNewBundleVersion: newVersion,
    })
    .where(eq(schema.strategyChangeProposals.id, proposalId));

  // 6. Keep any OTHER pending proposals connected to the new active Root/Bundle/Plan
  // so sequential approvals in any order never fail with PROPOSAL_STALE
  await db
    .update(schema.strategyChangeProposals)
    .set({
      currentStrategyRootId: newRootId,
      currentRootBundleId: newBundleId,
      currentRootBundleVersion: newVersion,
      currentStrategicPlanId: newPlanId,
    })
    .where(
      and(
        eq(schema.strategyChangeProposals.campaignId, DEMO_CAMPAIGN_ID),
        eq(schema.strategyChangeProposals.status, "PENDING_USER_APPROVAL"),
      ),
    );

  // 7. Update Watchtower Event evidence metadata to reflect applied status
  const [wtRow] = await db
    .select()
    .from(schema.pipelineChangeEvents)
    .where(eq(schema.pipelineChangeEvents.id, scenario.eventId))
    .limit(1);
  if (wtRow) {
    try {
      const parsedEv =
        typeof wtRow.evidence === "string"
          ? JSON.parse(wtRow.evidence)
          : wtRow.evidence || {};
      parsedEv.investigationStatus = "APPLIED";
      parsedEv.appliedStrategyVersion = newVersion;
      parsedEv.proposalId = scenario.proposalId;
      parsedEv.reasoningCaseId = scenario.reasoningCaseId;
      await db
        .update(schema.pipelineChangeEvents)
        .set({ evidence: JSON.stringify(parsedEv), updatedAt: now })
        .where(eq(schema.pipelineChangeEvents.id, scenario.eventId));
    } catch {}
  }

  // 8. Insert Lineage & Adaptation Outcome
  await db
    .insert(schema.strategyAdaptationLineages)
    .values({
      id: scenario.lineageId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      previousRootId,
      previousRootVersion: previousVersion,
      newRootId,
      newRootVersion: newVersion,
      triggerReasoningCaseId: scenario.reasoningCaseId,
      triggerAdaptiveDecisionId: scenario.adaptiveDecisionId,
      changedAuthorities: scenario.affectedAuthorities,
      preservedAuthorities: scenario.preservedAuthorities,
      sourceEventIds: [scenario.eventId],
      sourcePerformanceWarningIds: [
        `sig_perf_bottleneck_${DEMO_IDS.perfContextIdV1}`,
      ],
      evidenceIds: scenario.evidenceIds,
    })
    .onConflictDoNothing();

  const isFollowUpPreset = Boolean(opts.includeSimulatedFollowUpOutcome);
  await db
    .insert(schema.strategyAdaptationOutcomes)
    .values({
      id: scenario.outcomeId,
      campaignId: DEMO_CAMPAIGN_ID,
      accountId: DEMO_ACCOUNT_ID,
      adaptiveDecisionId: scenario.adaptiveDecisionId,
      reasoningCaseId: scenario.reasoningCaseId,
      status: isFollowUpPreset ? "EVALUATED" : "MONITORING",
      outcomeClassification: isFollowUpPreset
        ? "POSITIVE_ALIGNMENT"
        : "PENDING_OBSERVATION",
      confidence: 0.91,
      summary: isFollowUpPreset
        ? "SIMULATED FOLLOW-UP OBSERVATION (Days 1–14 Post-Adaptation): Following deployment of the '152g Boz Pistachio vs $25 Syrup Box' proof and the 40g Host Preview Tasting Sleeve on $60 2-tin bundles, simulated PDP-to-cart rate rose from 6.8% to 10.4% and 2-Tin Bundle share increased from 31% to 44% ($21.40 blended CPA). Note: Observed correlation in synthetic demo window; distinguished from isolated causal proof."
        : `Post-approval monitoring active (14-day window for Strategy v${newVersion}). Patch "${scenario.title}" has been applied to the active strategy and daily tasks; outcome evaluation will unlock after post-deployment observation.`,
      previousRootId,
      previousRootVersion: previousVersion,
      newRootId,
      newRootVersion: newVersion,
      changedAuthorities: scenario.affectedAuthorities,
      observationWindowDays: 14,
      evaluatedAt: isFollowUpPreset ? now : null,
    })
    .onConflictDoNothing();

  // 9. Refresh Execution Days & What To Do Today Tasks for newVersion
  await db
    .delete(schema.dailyExecutionTasks)
    .where(eq(schema.dailyExecutionTasks.campaignId, DEMO_CAMPAIGN_ID));
  await db
    .delete(schema.executionDays)
    .where(eq(schema.executionDays.campaignId, DEMO_CAMPAIGN_ID));

  const todayStr = new Date().toISOString().split("T")[0];
  await db.insert(schema.executionDays).values({
    id: newExecDayId,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    businessDate: todayStr,
    strategyRootId: newRootId,
    rootBundleId: newBundleId,
    strategicPlanId: newPlanId,
    planningContextId: DEMO_IDS.perfContextIdV1,
    dailyMission: `Strategy v${newVersion} Active (${appliedScenarios.length} adaptation${appliedScenarios.length > 1 ? "s" : ""} applied): Execute updated creative, PDP, and channel tasks.`,
    executionRationale: scenario.proposedResponse,
    status: "ACTIVE",
    generationVersion: newVersion,
  });

  for (let idx = 0; idx < composedTasks.length; idx++) {
    const t = composedTasks[idx];
    await db.insert(schema.dailyExecutionTasks).values({
      id: `${t.id}_v${newVersion}`,
      executionDayId: newExecDayId,
      campaignId: DEMO_CAMPAIGN_ID,
      strategyRootId: newRootId,
      laneId: t.laneId,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
      status: t.status,
      channel: t.channel,
      channelRole: t.channelRole,
      objective: t.description,
      reason: t.whyItMatters,
      expectedOutcome: t.expectedOutcome || t.whyItMatters,
      sourceAuthority: t.sourceAuthority || scenario.affectedAuthority,
      estimatedEffort: `${t.estimatedMinutes} min`,
      sequenceOrder: idx + 1,
      executionApproach: t.productionBlueprint.scriptOutline.join(" -> "),
      proofRequired:
        "152g (38%) Boz Pistachio batch card, 2-Day Air freshness seal, and Serving-Count Guide",
      ctaDestination:
        "https://zeytun-atelier.demo.invalid/products/antep-400g-assortment",
      productionBlueprint: t.productionBlueprint,
      completedAt: t.status === "DONE" ? now : null,
    });
  }

  return {
    status: "SUCCESS",
    executionStatus: "STRATEGY_UPDATED",
    proposalId,
    scenarioId: scenario.scenarioId,
    eventId: scenario.eventId,
    appliedScenarios,
    previousVersion,
    newVersion,
    materiallyChangedAuthorities: scenario.affectedAuthorities,
    revalidatedAuthorities: scenario.potentialDependentAuthorities,
    reassembledAuthorities: ["PLAN_SYNTHESIS"],
    preservedAuthorities: scenario.preservedAuthorities,
    changedAuthorities: scenario.affectedAuthorities,
    newRoot: { id: newRootId, version: newVersion },
    newPlan: {
      planId: newPlanId,
      planVersion: newVersion,
      headline: composedPlanJson.strategicSummary.headline,
    },
    beforeAfterPatchPreview: scenario.beforeAfterPatchPreview,
    executionSignals: [],
    summary: `Strategy v${newVersion} activated (${scenario.title}): Updated ${scenario.affectedAuthorities.join(", ")} and refreshed What To Do Today tasks while preserving ${scenario.preservedAuthorities.slice(0, 4).join(", ")}.`,
  };
}

/**
 * Transitions from State E to State F (preset Simulated Follow-Up state in Demo Control Panel).
 */
export async function applyDemoProposalAndFollowUp() {
  assertDemoEnvironmentSafe();
  await investigateDemoScenario("SCENARIO_A_PRICE");
  await approveDemoScenarioProposal(DEMO_IDS.proposalId, {
    includeSimulatedFollowUpOutcome: true,
  });

  const now = new Date();
  const perfCtxV2 = buildDemoPerformanceContext(2);
  await db
    .insert(schema.businessExecutionStates)
    .values({
      id: "bstate_demo_zeytun_v2",
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      mode: "OPTIMIZE",
      primaryBottleneck: "NONE",
      evidenceSummary: perfCtxV2.currentReality,
      evidenceRefIds: perfCtxV2.evidenceRefIds,
      confidence: "HIGH",
      freshness: "FRESH",
      status: "ACTIVE",
      reason: perfCtxV2.currentReality,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.performanceContexts)
    .values({
      id: perfCtxV2.id,
      accountId: DEMO_ACCOUNT_ID,
      campaignId: DEMO_CAMPAIGN_ID,
      businessExecutionStateId: "bstate_demo_zeytun_v2",
      mode: perfCtxV2.mode,
      currentReality: perfCtxV2.currentReality,
      primaryBottleneck: perfCtxV2.primaryBottleneck,
      weakestSignals: perfCtxV2.weakestSignals,
      proofGaps: perfCtxV2.proofGaps,
      strongestSignals: perfCtxV2.strongestSignals,
      activeChannels: perfCtxV2.activeChannels,
      recentTrend: perfCtxV2.recentTrend,
      confidence: perfCtxV2.confidence,
      freshness: perfCtxV2.freshness,
      evidenceRefIds: perfCtxV2.evidenceRefIds,
    })
    .onConflictDoNothing();

  const reportPayloadV2 = buildDemoMonthlyReportPayload(2);
  await db
    .update(schema.monthlyReports)
    .set({
      strategyRootIds: [DEMO_IDS.strategyRootIdV1, DEMO_IDS.strategyRootIdV2],
      rootBundleVersions: [1, 2],
      strategicPlanIds: [DEMO_IDS.strategicPlanIdV1, DEMO_IDS.strategicPlanIdV2],
      watchtowerEventIds: [DEMO_IDS.watchtowerEventId],
      reasoningCaseIds: [DEMO_IDS.reasoningCaseId],
      adaptiveDecisionIds: [DEMO_IDS.adaptiveDecisionId],
      strategyChangeProposalIds: [DEMO_IDS.proposalId],
      strategyAdaptationLineageIds: [DEMO_IDS.lineageId],
      executionDayIds: [DEMO_IDS.execDayIdV1, DEMO_IDS.execDayIdV2],
      sourceMetricIds: [DEMO_IDS.perfContextIdV1, DEMO_IDS.perfContextIdV2],
      reportPayload: reportPayloadV2,
      updatedAt: now,
    })
    .where(eq(schema.monthlyReports.id, DEMO_IDS.monthlyReportId));

  currentExplicitScenarioState = "SIMULATED_FOLLOW_UP";
}

/**
 * Starts a deterministic simulated 15-stage generation run (State B)
 * that progresses through ENGINE_PRIORITY_ORDER every ~650ms and completes
 * into State C (`STRATEGY_READY`).
 */
export async function startSimulatedDemoGeneration() {
  assertDemoEnvironmentSafe();
  clearDemoGenerationTimer();

  await ensureDemoBaseSetup();
  await clearDownstreamDemoArtifacts();
  await seedUpstreamSnapshots(DEMO_IDS.orchJobIdV1, 1);

  currentExplicitScenarioState = "GENERATION";

  const initialStatuses = ENGINE_PRIORITY_ORDER.map((e, idx) => ({
    id: e.id,
    name: e.name,
    status: idx === 0 ? "RUNNING" : "PENDING",
    summary:
      idx === 0
        ? "Synthesizing US 400g baklava & confectionery competitor baselines..."
        : null,
  }));

  await db.insert(schema.orchestratorJobs).values({
    id: DEMO_IDS.orchJobIdV1,
    blueprintId: "orchestrator-v2",
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    status: "RUNNING",
    sectionStatuses: JSON.stringify(initialStatuses),
  });

  let completedStageIndex = 0;

  const advanceNextStage = async () => {
    try {
      completedStageIndex += 1;

      if (completedStageIndex < ENGINE_PRIORITY_ORDER.length) {
        const updatedStatuses = ENGINE_PRIORITY_ORDER.map((e, idx) => {
          if (idx < completedStageIndex) {
            return {
              id: e.id,
              name: e.name,
              status: "SUCCESS",
              summary: `${e.name} verified for ${DEMO_OFFERING_NAME}`,
            };
          }
          if (idx === completedStageIndex) {
            return {
              id: e.id,
              name: e.name,
              status: "RUNNING",
              summary: `Running ${e.name} against verified 400g product facts & competitor evidence...`,
            };
          }
          return {
            id: e.id,
            name: e.name,
            status: "PENDING",
            summary: null,
          };
        });

        await db
          .update(schema.orchestratorJobs)
          .set({ sectionStatuses: JSON.stringify(updatedStatuses) })
          .where(eq(schema.orchestratorJobs.id, DEMO_IDS.orchJobIdV1));

        activeGenerationTimer = setTimeout(advanceNextStage, 650);
      } else {
        // Finalize into State C (STRATEGY_READY, awaiting interactive approval)
        activeGenerationTimer = null;
        await seedStrategyV1Artifacts({ planApproved: false });
        currentExplicitScenarioState = "STRATEGY_READY";
      }
    } catch (err) {
      console.error("[DemoScenarioService] Error advancing simulated stage:", err);
      activeGenerationTimer = null;
    }
  };

  activeGenerationTimer = setTimeout(advanceNextStage, 650);

  return {
    success: true,
    status: "RUNNING",
    jobId: DEMO_IDS.orchJobIdV1,
    campaignId: DEMO_CAMPAIGN_ID,
    message: "Simulated deterministic strategy generation started.",
  };
}

/**
 * Interactive approval of the generated Strategy Plan v1 in State C.
 */
export async function approveDemoStrategyPlan(planId?: string) {
  assertDemoEnvironmentSafe();
  const targetPlanId = planId || DEMO_IDS.strategicPlanIdV1;
  const now = new Date();

  await db
    .update(schema.strategicPlans)
    .set({
      status: "APPROVED",
      executionStatus: "APPROVED_READY",
      approvedAt: now,
      approvedBy: DEMO_USER_ID,
      isDesignatedActive: true,
      designatedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.strategicPlans.id, targetPlanId),
        eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID),
      ),
    );

  await db
    .update(schema.strategyRoots)
    .set({ status: "ACTIVE" })
    .where(eq(schema.strategyRoots.id, DEMO_IDS.strategyRootIdV1));

  return {
    success: true,
    planId: targetPlanId,
    status: "APPROVED",
    executionStatus: "APPROVED_READY",
    isDesignatedActive: true,
    approvedAt: now.toISOString(),
  };
}

/**
 * Applies any of the 6 resettable recording states (A through F) idempotently.
 */
export async function applyDemoScenarioState(targetState: DemoScenarioState) {
  assertDemoEnvironmentSafe();
  clearDemoGenerationTimer();

  if (targetState === "GENERATION") {
    await startSimulatedDemoGeneration();
    return getDemoStatus();
  }

  await ensureDemoBaseSetup();
  await clearDownstreamDemoArtifacts();

  if (targetState === "READY_TO_GENERATE") {
    currentExplicitScenarioState = "READY_TO_GENERATE";
    return getDemoStatus();
  }

  if (targetState === "STRATEGY_READY") {
    await seedStrategyV1Artifacts({ planApproved: false });
    currentExplicitScenarioState = "STRATEGY_READY";
    return getDemoStatus();
  }

  if (targetState === "MARKET_CHANGE_DETECTED") {
    await seedStrategyV1Artifacts({ planApproved: true });
    await seedWatchtowerMarketChangeEvent();
    currentExplicitScenarioState = "MARKET_CHANGE_DETECTED";
    return getDemoStatus();
  }

  if (targetState === "INVESTIGATION_AND_RESPONSE") {
    await seedStrategyV1Artifacts({ planApproved: true });
    await seedWatchtowerMarketChangeEvent();
    await seedInvestigationAndPendingProposal();
    currentExplicitScenarioState = "INVESTIGATION_AND_RESPONSE";
    return getDemoStatus();
  }

  if (targetState === "SIMULATED_FOLLOW_UP") {
    await seedStrategyV1Artifacts({ planApproved: true });
    await seedWatchtowerMarketChangeEvent();
    await applyDemoProposalAndFollowUp();
    currentExplicitScenarioState = "SIMULATED_FOLLOW_UP";
    return getDemoStatus();
  }

  return getDemoStatus();
}

/**
 * Inspects current DB state for the demo campaign and returns a complete
 * status object for the Demo Control Panel and verification endpoints.
 */
export async function getDemoStatus() {
  const env = assertDemoEnvironmentSafe();

  const [latestJob] = await db
    .select()
    .from(schema.orchestratorJobs)
    .where(eq(schema.orchestratorJobs.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.orchestratorJobs.createdAt))
    .limit(1);

  const [latestPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(eq(schema.strategicPlans.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(desc(schema.strategicPlans.version), desc(schema.strategicPlans.createdAt))
    .limit(1);

  const wtEvents = await db
    .select()
    .from(schema.pipelineChangeEvents)
    .where(eq(schema.pipelineChangeEvents.campaignId, DEMO_CAMPAIGN_ID));

  const allProposals = await db
    .select()
    .from(schema.strategyChangeProposals)
    .where(eq(schema.strategyChangeProposals.campaignId, DEMO_CAMPAIGN_ID))
    .orderBy(asc(schema.strategyChangeProposals.createdAt));

  const pendingProposals = allProposals.filter(
    (p) => p.status === "PENDING_USER_APPROVAL",
  );
  const appliedProposals = allProposals.filter((p) => p.status === "APPLIED");

  let derivedState: DemoScenarioState = "READY_TO_GENERATE";
  if (latestJob?.status === "RUNNING") {
    derivedState = "GENERATION";
  } else if (
    currentExplicitScenarioState === "SIMULATED_FOLLOW_UP" &&
    latestPlan &&
    latestPlan.version >= 2
  ) {
    derivedState = "SIMULATED_FOLLOW_UP";
  } else if (appliedProposals.length > 0 || pendingProposals.length > 0) {
    derivedState = "INVESTIGATION_AND_RESPONSE";
  } else if (wtEvents.length > 0) {
    derivedState = "MARKET_CHANGE_DETECTED";
  } else if (latestPlan) {
    derivedState = "STRATEGY_READY";
  } else {
    derivedState = "READY_TO_GENERATE";
  }

  const deepReasoningScenarios = DEMO_DEEP_REASONING_SCENARIOS.map((s) => {
    const matchedProp = allProposals.find((p) => p.id === s.proposalId);
    return {
      scenarioId: s.scenarioId,
      eventId: s.eventId,
      proposalId: s.proposalId,
      reasoningCaseId: s.reasoningCaseId,
      title: s.title,
      status: matchedProp
        ? matchedProp.status
        : wtEvents.some((e) => e.id === s.eventId)
        ? "PENDING_INVESTIGATION"
        : "NOT_SEEDED",
      appliedVersion: matchedProp?.appliedNewBundleVersion || null,
    };
  });

  return {
    demoMode: true,
    isolatedDbHost: env.dbHost,
    isolatedDbName: env.dbName,
    accountId: DEMO_ACCOUNT_ID,
    campaignId: DEMO_CAMPAIGN_ID,
    userId: DEMO_USER_ID,
    userName: DEMO_USER_NAME,
    brandName: DEMO_BRAND_NAME,
    offeringName: DEMO_OFFERING_NAME,
    priceUsd: 32,
    monthlyBudgetUsd: 4500,
    currentState: derivedState,
    currentScenarioState: derivedState,
    scenarioMeta: DEMO_SCENARIO_META[derivedState],
    currentScenarioMeta: DEMO_SCENARIO_META[derivedState],
    allScenarios: DEMO_SCENARIO_META,
    scenarioCatalog: DEMO_SCENARIO_META,
    scenarioOrder: DEMO_SCENARIO_ORDER,
    activeJobId: latestJob?.id || null,
    activeJobStatus: latestJob?.status || null,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          stageIndex: 0,
          currentStage: null,
        }
      : null,
    activePlanId: latestPlan?.id || null,
    planStatus: latestPlan?.status || null,
    activePlanStatus: latestPlan?.status || null,
    planVersion: latestPlan?.version || null,
    activePlanVersion: latestPlan?.version || null,
    activeRootVersion: latestPlan?.rootBundleVersion || latestPlan?.version || null,
    isPlanApproved: latestPlan?.status === "APPROVED",
    watchtowerEventId: wtEvents[0]?.id || null,
    watchtowerEventsCount: wtEvents.length,
    historicalPerformanceCasesCount: DEMO_PERFORMANCE_LOOP_CASES.length,
    pendingProposalId: pendingProposals[0]?.id || null,
    pendingProposalsCount: pendingProposals.length,
    appliedProposalsCount: appliedProposals.length,
    deepReasoningScenarios,
  };
}

