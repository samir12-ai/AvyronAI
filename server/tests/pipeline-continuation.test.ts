import "dotenv/config";
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  resolveContinuationPlan,
  prepareContinuationState,
  classifyProviderInterruption,
  withContinuationLock,
  STAGE_DISPLAY_NAMES,
} from "../orchestrator/continuation";
import { hydrateRequiredUpstreamForResume } from "../orchestrator/resume-hydration";
import { StrategyExperienceService } from "../strategy-experience/service";
import { registerStrategyExperienceRoutes } from "../strategy-experience/routes";
import {
  isBillingOrQuotaExhaustedError,
  isProviderTechnicalFailureError,
  resetProviderCircuitBreakerForContinuation,
  getProviderCircuitBreakerState,
} from "../ai-client";
import { generateWithRepair } from "../shared/llm-reliability/reliability-runner";
import * as aiClientModule from "../ai-client";
import * as orchestratorModule from "../orchestrator";
import * as laneGrouperModule from "../shared/lane-grouper";

describe("Pipeline Continuation & Recovery Verification Suite", { timeout: 60_000 }, () => {
  const testRunSuffix = randomUUID().slice(0, 8);
  const testAccountId = `acc_cont_verify_${testRunSuffix}`;
  const testCampaignId = `camp_cont_verify_${testRunSuffix}`;
  const testSourceJobId = `orch_source_${testRunSuffix}`;
  const testRetryJob1Id = `orch_retry1_${testRunSuffix}`;
  const testRetryJob2Id = `orch_retry2_${testRunSuffix}`;
  const testRootId = `root_cont_${testRunSuffix}`;
  const testContextFingerprint = `fp_songai_${testRunSuffix}`;
  const testCompetitorHash = `ch_${testRunSuffix}`;

  const snapIds = {
    mi: `mi_snap_${testRunSuffix}`,
    miBg: `mi_bgsnap_${testRunSuffix}`,
    aud: `aud_snap_${testRunSuffix}`,
    diff: `diff_snap_${testRunSuffix}`,
    pos: `pos_snap_${testRunSuffix}`,
    mech: `mech_snap_${testRunSuffix}`,
    offer: `offer_snap_${testRunSuffix}`,
    aware: `aware_snap_${testRunSuffix}`,
    funnel: `funnel_snap_${testRunSuffix}`,
    pers: `pers_snap_${testRunSuffix}`,
    integ: `integ_snap_${testRunSuffix}`,
    sv: `sv_snap_${testRunSuffix}`,
    cs: `cs_snap_${testRunSuffix}`,
    bg: `bg_snap_${testRunSuffix}`,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(laneGrouperModule, "runLaneGrouper").mockResolvedValue([
      {
        laneId: "lane_core_1",
        title: "Personalized Song Gift Delivery Confidence",
        primaryPainId: "pain_delivery_1",
        supportingPainIds: [],
        segmentIds: ["seg_gift_buyers"],
        confidence: 0.92,
      },
    ] as any);
  });

  async function cleanupIsolatedTestState() {
    await db.delete(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, testAccountId));
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.accountId, testAccountId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.accountId, testAccountId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.accountId, testAccountId));
    await Promise.all([
      db.delete(schema.strategicPlans).where(eq(schema.strategicPlans.accountId, testAccountId)),
      db.delete(schema.budgetGovernorSnapshots).where(eq(schema.budgetGovernorSnapshots.accountId, testAccountId)),
      db.delete(schema.channelSelectionSnapshots).where(eq(schema.channelSelectionSnapshots.accountId, testAccountId)),
      db.delete(schema.strategyValidationSnapshots).where(eq(schema.strategyValidationSnapshots.accountId, testAccountId)),
      db.delete(schema.integritySnapshots).where(eq(schema.integritySnapshots.accountId, testAccountId)),
      db.delete(schema.persuasionSnapshots).where(eq(schema.persuasionSnapshots.accountId, testAccountId)),
      db.delete(schema.funnelSnapshots).where(eq(schema.funnelSnapshots.accountId, testAccountId)),
      db.delete(schema.awarenessSnapshots).where(eq(schema.awarenessSnapshots.accountId, testAccountId)),
      db.delete(schema.offerSnapshots).where(eq(schema.offerSnapshots.accountId, testAccountId)),
      db.delete(schema.strategyRoots).where(eq(schema.strategyRoots.accountId, testAccountId)),
      db.delete(schema.mechanismSnapshots).where(eq(schema.mechanismSnapshots.accountId, testAccountId)),
      db.delete(schema.positioningSnapshots).where(eq(schema.positioningSnapshots.accountId, testAccountId)),
      db.delete(schema.differentiationSnapshots).where(eq(schema.differentiationSnapshots.accountId, testAccountId)),
      db.delete(schema.audienceSnapshots).where(eq(schema.audienceSnapshots.accountId, testAccountId)),
      db.delete(schema.miSnapshots).where(eq(schema.miSnapshots.accountId, testAccountId)),
      db.delete(schema.strategicPainDecisions).where(eq(schema.strategicPainDecisions.accountId, testAccountId)),
      db.delete(schema.targetAssessments).where(eq(schema.targetAssessments.accountId, testAccountId)),
      db.delete(schema.productAssessments).where(eq(schema.productAssessments.accountId, testAccountId)),
      db.execute(sql`DELETE FROM ael_snapshots WHERE account_id = ${testAccountId}`),
      db.delete(schema.evidenceManifests).where(eq(schema.evidenceManifests.accountId, testAccountId)),
      db.delete(schema.orchestratorJobs).where(eq(schema.orchestratorJobs.accountId, testAccountId)),
      db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId)),
      db.delete(schema.businessDataLayer).where(eq(schema.businessDataLayer.accountId, testAccountId)),
      db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.accountId, testAccountId)),
      db.delete(schema.growthCampaigns).where(eq(schema.growthCampaigns.id, testCampaignId)),
    ]);
  }

  afterAll(async () => {
    await cleanupIsolatedTestState();
  });

  async function seedInterruptedCampaignFixture(opts?: {
    positioningProposalStatus?: "PROPOSED" | "EVIDENCE_BACKED";
    omitOfferSnapshot?: boolean;
  }) {
    await cleanupIsolatedTestState();

    const t0 = new Date(Date.now() - 600_000);
    const t1 = new Date(Date.now() - 300_000);
    const t2 = new Date(Date.now() - 120_000);

    await db.insert(schema.growthCampaigns).values({
      id: testCampaignId,
      accountId: testAccountId,
      name: "Initial Campaign (Isolated Clone)",
      objective: "GROWTH",
      status: "ACTIVE",
      industry: "Digital Custom Music",
    } as any);

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: testCampaignId,
      selectedCampaignName: "Initial Campaign (Isolated Clone)",
      campaignGoalType: "conversions",
      campaignLocation: "United States",
    } as any);

    await db.insert(schema.businessDataLayer).values({
      accountId: testAccountId,
      campaignId: testCampaignId,
      businessLocation: "United States",
      businessType: "Custom Music Service",
      coreOffer: "Personalized Songs",
      heroProduct: "Personalized Songs",
      priceRange: "$49 - $99",
      targetAudienceAge: "25-54",
      targetAudienceSegment: "Gift buyers seeking emotional custom songs",
      monthlyBudget: "$500",
      funnelObjective: "CONVERSIONS",
      primaryConversionChannel: "WEBSITE",
    } as any);

    await db.insert(schema.campaignOfferings).values({
      id: `off_${testRunSuffix}`,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Personalized Songs",
      sourceInputEvidenceId: `oie_${testRunSuffix}`,
    } as any);

    // 1. Frozen Evidence Manifest for original source run
    await db.insert(schema.evidenceManifests).values({
      id: `em_${testRunSuffix}`,
      accountId: testAccountId,
      campaignId: testCampaignId,
      orchestrationJobId: testSourceJobId,
      contextFingerprint: testContextFingerprint,
      status: "FROZEN",
      includedPostIds: ["post_1"],
      includedMarketVoiceIds: [`mve_${testRunSuffix}`],
    } as any);

    // 2. Original interrupted orchestrator job (Stages 01-13 SUCCESS/PARTIAL, Stage 14 ERROR)
    const posStatus = opts?.positioningProposalStatus === "PROPOSED" ? "PARTIAL" : "SUCCESS";
    const sourceSections = [
      { id: "market_intelligence", name: "Market Intelligence", status: "SUCCESS", summary: "18 competitors analyzed" },
      { id: "market_voice", name: "Primary Market Voice", status: "SUCCESS", summary: "213 verified buyer quotes" },
      { id: "audience", name: "Audience Engine", status: "SUCCESS", summary: "Buyer segments & pains validated" },
      { id: "differentiation", name: "Differentiation Engine", status: "SUCCESS", summary: "3 differentiation pillars" },
      {
        id: "positioning",
        name: "Positioning Engine",
        status: posStatus,
        summary: "Positioning hypothesis ready",
        ...(opts?.positioningProposalStatus ? { proposalStatus: opts.positioningProposalStatus } : {}),
      },
      { id: "mechanism", name: "Mechanism Engine", status: "SUCCESS", summary: "Mechanism & Strategy Root locked" },
      { id: "offer", name: "Offer Engine", status: "SUCCESS", summary: "Primary offer validated" },
      { id: "awareness", name: "Awareness Engine", status: "SUCCESS", summary: "Awareness route calibrated" },
      { id: "funnel", name: "Funnel Engine", status: "SUCCESS", summary: "Buyer journey stages mapped" },
      { id: "persuasion", name: "Persuasion Engine", status: "SUCCESS", summary: "Persuasion route verified" },
      { id: "integrity", name: "Integrity Engine", status: "SUCCESS", summary: "Cross-engine coherence verified" },
      { id: "statistical_validation", name: "Statistical Validation", status: "SUCCESS", summary: "Statistical validation complete" },
      { id: "channel_selection", name: "Channel Selection", status: "SUCCESS", summary: "Primary channel selected" },
      {
        id: "budget_governor",
        name: "Budget Governor",
        status: "ERROR",
        summary: "AI call failed after 2 attempts: 429 You have no credits remaining. Please add credits to continue.",
        failureCategory: "BILLING_EXHAUSTED",
      },
      { id: "iteration", name: "Iteration Engine", status: "PENDING", summary: null },
      { id: "retention", name: "Retention Engine", status: "PENDING", summary: null },
    ];

    await db.insert(schema.orchestratorJobs).values([
      {
        id: testSourceJobId,
        blueprintId: "orchestrator-v2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        status: "BLOCKED",
        error: "429 You have no credits remaining. Please add credits to continue.",
        sectionStatuses: JSON.stringify(sourceSections),
        createdAt: t0,
        completedAt: t0,
      },
      {
        id: testRetryJob1Id,
        blueprintId: "orchestrator-v2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        status: "BLOCKED",
        error: "Blocked at resume_hydration: Resume from budget_governor missing required upstream inputs: integrity",
        sectionStatuses: JSON.stringify(sourceSections),
        createdAt: t1,
        completedAt: t1,
      },
      {
        id: testRetryJob2Id,
        blueprintId: "orchestrator-v2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        status: "BLOCKED",
        error:
          "Blocked at resume_hydration: Resume from budget_governor missing required upstream inputs: strategy_root:no_active_root, offer, awareness, funnel:lane_mismatch_or_invalidated, persuasion:lane_mismatch_or_invalidated",
        sectionStatuses: JSON.stringify(sourceSections),
        createdAt: t2,
        completedAt: t2,
      },
    ] as any);

    // 3. Stage 01 MI snapshot + background MI snapshot with identical competitorHash
    await db.insert(schema.miSnapshots).values([
      {
        id: snapIds.mi,
        accountId: testAccountId,
        campaignId: testCampaignId,
        jobId: testSourceJobId,
        engineVersion: 3,
        status: "COMPLETE",
        competitorHash: testCompetitorHash,
        signalData: JSON.stringify([{ id: "sig_1", text: "Verified gift song signal" }]),
        multiSourceSignals: JSON.stringify({ competitorsAnalyzed: 18 }),
        telemetry: JSON.stringify({ contentHash: testCompetitorHash }),
        createdAt: t0,
      },
      {
        id: snapIds.miBg,
        accountId: testAccountId,
        campaignId: testCampaignId,
        jobId: `persist:${testAccountId}:${Date.now()}`,
        engineVersion: 3,
        status: "COMPLETE",
        competitorHash: testCompetitorHash,
        signalData: JSON.stringify([{ id: "sig_1", text: "Verified gift song signal" }]),
        multiSourceSignals: JSON.stringify({ competitorsAnalyzed: 18 }),
        telemetry: JSON.stringify({ contentHash: testCompetitorHash }),
        createdAt: t1,
      },
    ] as any);

    // 4. Stage 02 Market Voice (with full discovery lineage)
    const mvJobId = `mv_job_${testRunSuffix}`;
    const mvIntentId = `mv_int_${testRunSuffix}`;
    const mvResId = `mv_res_${testRunSuffix}`;
    const offeringId = `off_${testRunSuffix}`;

    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: mvJobId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      status: "COMPLETED",
    } as any);

    await db.insert(schema.marketVoiceSearchIntents).values({
      id: mvIntentId,
      discoveryJobId: mvJobId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      query: "custom song gift review",
      intentCategory: "CUSTOMER_EXPERIENCE",
      marketScope: "TARGET_MARKET",
      targetPlatform: "REDDIT",
      status: "COMPLETED",
    } as any);

    await db.insert(schema.marketVoiceDiscoveryResults).values({
      id: mvResId,
      searchIntentId: mvIntentId,
      discoveryJobId: mvJobId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      url: "https://reddit.com/r/gifts/comments/songai_test",
      canonicalUrl: "https://reddit.com/r/gifts/comments/songai_test",
      sourcePlatform: "reddit",
      discoveredType: "COMMUNITY_POST",
      verificationStatus: "VERIFIED_CUSTOMER_SOURCE",
    } as any);

    await db.insert(schema.marketVoiceEvidence).values({
      id: `mve_${testRunSuffix}`,
      discoveryResultId: mvResId,
      searchIntentId: mvIntentId,
      discoveryJobId: mvJobId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offeringId,
      verbatimText: "I needed a custom anniversary song delivered on time without sounding robotic.",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "TARGET_MARKET",
      platform: "reddit",
      externalUrl: "https://reddit.com/r/gifts/comments/songai_test",
      eligibilityVerdict: "ELIGIBLE",
    } as any);

    // 5. Stage 03 Audience + AEL snapshot
    const audienceResult = {
      status: "COMPLETE",
      productDna: {
        productName: "Personalized Songs",
        offeringName: "Personalized Songs",
        category: "Custom Digital Music",
      },
      audienceSegments: [
        {
          id: "seg_gift_buyers",
          name: "Milestone Gift Buyers",
          pains: [{ painId: "pain_delivery_1", claimId: "pain_delivery_1", description: "Fear of generic AI lyrics and missed gift occasion deadlines" }],
        },
      ],
      audiencePains: [
        {
          id: "pain_delivery_1",
          painId: "pain_delivery_1",
          name: "Generic AI Lyrics & Delivery Anxiety",
          description: "Fear of generic AI lyrics and missed gift occasion deadlines",
        },
      ],
    };

    await db.insert(schema.audienceSnapshots).values({
      id: snapIds.aud,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "COMPLETE",
      audienceSegments: JSON.stringify(audienceResult.audienceSegments),
      audiencePains: JSON.stringify(audienceResult.audiencePains),
      structuredSignals: JSON.stringify({
        pain_clusters: [{ label: "Fear of generic AI lyrics and missed gift occasion deadlines", confidence: 0.91, evidence: ["reddit quote"] }],
        desire_clusters: [],
        pattern_clusters: [],
        root_causes: [],
        psychological_drivers: [],
      }),
      targetCoverage: JSON.stringify({
        status: "COVERED",
        evaluations: [{ painId: "pain_delivery_1", decision: "COVERED" }],
      }),
      desireMap: "[]",
      objectionMap: JSON.stringify([{ objection: "Will it sound like a real vocalist?" }]),
      transformationMap: "[]",
      emotionalDrivers: "[]",
      segmentDensity: "[]",
      awarenessLevel: "{}",
      maturityIndex: "{}",
      audienceIntentDistribution: "{}",
      inputSummary: "{}",
      result: JSON.stringify(audienceResult),
      createdAt: t0,
    } as any);

    await db.execute(sql`
      INSERT INTO ael_snapshots (
        id, account_id, campaign_id, job_id,
        root_causes, causal_chains, buying_barriers,
        package, is_partial, partial_reason
      ) VALUES (
        ${`ael_${testRunSuffix}`}, ${testAccountId}, ${testCampaignId}, ${testSourceJobId},
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        ${JSON.stringify({ summary: "Enriched Songai audience & market package" })}::jsonb,
        false, null
      )
    `);

    // 6. Stage 04 Differentiation
    const diffResult = {
      status: "COMPLETE",
      pillars: [{ id: "pil_1", name: "Story-Accurate Custom Lyric Craft", pillarName: "Story-Accurate Custom Lyric Craft", evidence: ["Verified lyric review"] }],
      claimStructures: [{ id: "clm_1", claim: "Custom story-verified lyrics before final mastering" }],
      proofArchitecture: [{ proofType: "demonstration", description: "Before/after story-to-song sample" }],
    };
    await db.insert(schema.differentiationSnapshots).values({
      id: snapIds.diff,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "COMPLETE",
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationPillars: JSON.stringify(diffResult.pillars),
      claimStructures: JSON.stringify(diffResult.claimStructures),
      proofArchitecture: JSON.stringify(diffResult.proofArchitecture),
      inputHash: "diff_hash",
      result: JSON.stringify(diffResult),
      createdAt: t0,
    } as any);

    // 7. Stage 05 Positioning (supports PROPOSED hypothesis or COMPLETE)
    const isProposed = opts?.positioningProposalStatus === "PROPOSED";
    const posResult = {
      status: isProposed ? "PARTIAL" : "COMPLETE",
      proposalStatus: isProposed ? "PROPOSED" : "EVIDENCE_BACKED",
      epistemicStatus: isProposed ? "PROPOSED" : "EVIDENCE_BACKED",
      contrastAxis: "Generic Novelty Audio Templates vs Story-Verified Custom Song Craft",
      territories: [
        {
          id: "ter_1",
          name: "Story-Verified Custom Song Craft",
          territoryName: "Story-Verified Custom Song Craft",
          targetSegmentId: "seg_gift_buyers",
          proposalStatus: isProposed ? "PROPOSED" : "EVIDENCE_BACKED",
        },
      ],
      selectedPainRoles: {
        core: { painId: "pain_delivery_1", classification: "CORE_PURCHASE" },
      },
    };
    await db.insert(schema.positioningSnapshots).values({
      id: snapIds.pos,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: isProposed ? "PARTIAL" : "COMPLETE",
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      contrastAxis: posResult.contrastAxis,
      territory: JSON.stringify(posResult.territories[0]),
      territories: JSON.stringify(posResult.territories),
      differentiationVector: JSON.stringify([]),
      proofSignals: JSON.stringify([]),
      strategyCards: JSON.stringify([]),
      inputHash: "pos_hash",
      result: JSON.stringify(posResult),
      createdAt: t0,
    } as any);

    // 8. Stage 06 Mechanism + Strategy Root (spuriously marked REVIEW_REQUIRED by background MI persist)
    const mechResult = {
      status: "COMPLETE",
      primaryMechanism: {
        mechanismName: "Guided Memory-to-Lyric Studio Workflow",
        mechanismType: "process",
        steps: ["Capture recipient memories", "Draft custom lyrics", "Deliver studio master"],
      },
    };
    await db.insert(schema.mechanismSnapshots).values({
      id: snapIds.mech,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "COMPLETE",
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      primaryMechanism: JSON.stringify(mechResult.primaryMechanism),
      inputHash: "mech_hash",
      result: JSON.stringify(mechResult),
      createdAt: t0,
    } as any);

    await db.insert(schema.strategyRoots).values({
      id: testRootId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      runId: testSourceJobId,
      status: "REVIEW_REQUIRED", // Spuriously flipped by background MI persist with same competitorHash
      primaryAxis: "Story-Verified Custom Song Craft",
      contrastAxisText: posResult.contrastAxis,
      approvedPromise: "Custom studio song crafted from your real memories",
      approvedClaim: "Custom story-verified lyrics before final mastering",
      approvedMechanism: JSON.stringify({ name: "Guided Memory-to-Lyric Studio Workflow", type: "process" }),
      approvedLanes: JSON.stringify([
        {
          laneId: "lane_core_1",
          id: "lane_core_1",
          title: "Personalized Song Gift Delivery Confidence",
          primaryPainId: "pain_delivery_1",
          primaryCorePainId: "pain_delivery_1",
          segmentIds: ["seg_gift_buyers"],
        },
      ]),
      brandSpine: JSON.stringify({
        umbrellaPositionName: "Story-Verified Custom Song Craft",
        contrastAxis: posResult.contrastAxis,
      }),
      approvedAudiencePains: JSON.stringify([
        {
          painId: "pain_delivery_1",
          canonical: "Fear of generic AI lyrics and missed gift occasion deadlines",
          classification: "CORE_PURCHASE",
          rank: 1,
          eligible: true,
          allowedUses: ["positioning", "mechanism", "offer_core", "funnel"],
        },
      ]),
      approvedObjections: JSON.stringify(["Will it sound like a real vocalist?"]),
      approvedProofTypes: JSON.stringify(["demonstration"]),
      approvedClaims: JSON.stringify([{ claim: "Custom story-verified lyrics before final mastering" }]),
      approvedPositioningContext: JSON.stringify({ territoryName: "Story-Verified Custom Song Craft" }),
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      mechanismSnapshotId: snapIds.mech,
      rootHash: `rh_${testRunSuffix}`,
      createdAt: t0,
    } as any);

    // 9. Stage 07 Offer (unless omitted for Scenario 5)
    if (!opts?.omitOfferSnapshot) {
      const offerResult = {
        status: "COMPLETE",
        primaryOffer: {
          offerName: "The Songai Flagship Personalized Song",
          coreOutcome: "A broadcast-quality custom song tailored to your recipient's story",
          priceStructure: "$49 one-time digital master",
          guarantee: "Lyric accuracy revision guarantee",
        },
        selectedPainRoles: {
          core: { painId: "pain_delivery_1" },
          objections: [],
        },
      };
      await db.insert(schema.offerSnapshots).values({
        id: snapIds.offer,
        accountId: testAccountId,
        campaignId: testCampaignId,
        jobId: testSourceJobId,
        strategyRootId: testRootId,
        miSnapshotId: snapIds.mi,
        audienceSnapshotId: snapIds.aud,
        positioningSnapshotId: snapIds.pos,
        differentiationSnapshotId: snapIds.diff,
        mechanismSnapshotId: snapIds.mech,
        engineVersion: 1,
        status: "COMPLETE",
        statusMessage: "Review required: upstream mi engine regenerated, invalidating offer snapshot.",
        primaryOffer: JSON.stringify(offerResult.primaryOffer),
        inputHash: "offer_hash",
        result: JSON.stringify(offerResult),
        createdAt: t0,
      } as any);
    }

    // 10. Stage 08 Awareness
    const awareResult = {
      status: "COMPLETE",
      primaryRoute: {
        routeName: "Occasion-Triggered Story Showcase",
        entryStage: "problem_aware",
      },
    };
    await db.insert(schema.awarenessSnapshots).values({
      id: snapIds.aware,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      strategyRootId: testRootId,
      offerSnapshotId: snapIds.offer,
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      engineVersion: 1,
      status: "COMPLETE",
      statusMessage: "Review required: upstream mi engine regenerated, invalidating awareness snapshot.",
      primaryRoute: JSON.stringify(awareResult.primaryRoute),
      inputHash: "aware_hash",
      result: JSON.stringify(awareResult),
      createdAt: t0,
    } as any);

    // 11. Stage 09 Funnel (with legacy strategyRootId = null to verify backfill & hydration)
    const funnelResult = {
      status: "COMPLETE",
      laneId: "lane_core_1",
      primaryFunnel: {
        laneId: "lane_core_1",
        funnelName: "Memory-to-Song Interactive Preview Funnel",
        journeyName: "Memory-to-Song Interactive Preview Funnel",
        whyThisJourney: "Gift buyers need to hear vocal quality and see lyric personalization before checkout.",
        stages: [
          {
            stageId: "top",
            stageName: "Emotional Reaction Discovery",
            goal: "Demonstrate real recipient reactions",
            buyerState: "Searching for a meaningful milestone gift",
            coreMessage: "Turn your favorite shared memories into a studio-quality custom song",
            contentAction: "Short-form reaction & lyric story comparison",
            proof: ["Audio sample comparison"],
            cta: "Start Your Song Story",
          },
        ],
      },
    };
    await db.insert(schema.funnelSnapshots).values({
      id: snapIds.funnel,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      strategyRootId: null, // Simulates legacy null strategyRootId bug from orch_1792157565442_wvv883
      laneId: "lane_core_1",
      offerSnapshotId: snapIds.offer,
      awarenessSnapshotId: snapIds.aware,
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      engineVersion: 1,
      status: "COMPLETE",
      statusMessage: "Review required: upstream mi engine regenerated, invalidating funnel snapshot.",
      primaryFunnel: JSON.stringify(funnelResult.primaryFunnel),
      inputHash: "funnel_hash",
      result: JSON.stringify(funnelResult),
      createdAt: t0,
    } as any);

    // 12. Stage 10 Persuasion
    const persResult = {
      status: "COMPLETE",
      laneId: "lane_core_1",
      primaryRoute: {
        routeName: "Audio Proof & Lyric Transparency",
        mode: "Proof-Led Decision Acceleration",
        coreBeliefTransformation: {
          currentBelief: "Custom online songs sound robotic and generic",
          desiredBelief: "Songai crafts studio-grade songs anchored in your real memories",
        },
        trustStrategy: {
          buyerRiskState: "Skeptical of AI audio quality",
          trustDeficit: "Fear of wasting money on a cheesy gift",
          transferMechanismName: "Side-by-Side Story-to-Song Audio Sample",
          proofArtifact: "Unedited customer memory prompt + finished song master",
          primaryCialdiniPrinciple: "social_proof",
          principleRationale: "Verified gift recipient reactions remove emotional risk",
        },
        objections: [
          {
            objectionId: "obj_1",
            objection: "Will it sound like a real vocalist?",
            response: "Listen to full-length unedited genre masters before ordering",
            requiredProof: "Full-length studio sample",
          },
        ],
      },
    };
    await db.insert(schema.persuasionSnapshots).values({
      id: snapIds.pers,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      strategyRootId: testRootId,
      laneId: "lane_core_1",
      awarenessSnapshotId: snapIds.aware,
      integritySnapshotId: snapIds.integ,
      funnelSnapshotId: snapIds.funnel,
      offerSnapshotId: snapIds.offer,
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      engineVersion: 1,
      status: "COMPLETE",
      primaryRoute: JSON.stringify(persResult.primaryRoute),
      inputHash: "pers_hash",
      result: JSON.stringify(persResult),
      createdAt: t0,
    } as any);

    // 13. Stage 11 Integrity (with legacy strategyRootId = null to verify fix for Retry #1 failure)
    const integResult = {
      status: "COMPLETE",
      confidenceScore: 88,
      safeToExecute: true,
      stabilityResult: { stable: true },
      structuralWarnings: [],
    };
    await db.insert(schema.integritySnapshots).values({
      id: snapIds.integ,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      strategyRootId: null, // Simulates legacy null strategyRootId bug from orch_1792157565442_wvv883
      funnelSnapshotId: snapIds.funnel,
      offerSnapshotId: snapIds.offer,
      miSnapshotId: snapIds.mi,
      audienceSnapshotId: snapIds.aud,
      positioningSnapshotId: snapIds.pos,
      differentiationSnapshotId: snapIds.diff,
      safeToExecute: true,
      overallIntegrityScore: 88,
      engineVersion: 1,
      status: "COMPLETE",
      confidenceScore: 88,
      stabilityResult: JSON.stringify({ stable: true }),
      structuralWarnings: "[]",
      inputHash: "integ_hash",
      result: JSON.stringify(integResult),
      createdAt: t0,
    } as any);

    // 14. Stage 12 Statistical Validation
    const svResult = {
      status: "COMPLETE",
      validationState: "PROVISIONAL",
      claimConfidenceScore: 84,
      claimValidations: [{ claim: "Custom story-verified lyrics", result: "SUPPORTED" }],
    };
    await db.insert(schema.strategyValidationSnapshots).values({
      id: snapIds.sv,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "COMPLETE",
      validationState: "PROVISIONAL",
      claimConfidenceScore: 84,
      inputHash: "sv_hash",
      result: JSON.stringify(svResult),
      createdAt: t0,
    } as any);

    // 15. Stage 13 Channel Selection
    const csResult = {
      status: "COMPLETE",
      proposedPrimary: "Instagram Reels",
      secondary: "TikTok Organic",
      primaryChannel: {
        channelName: "Instagram Reels",
        role: "Emotional gift reaction discovery",
      },
      secondaryChannel: {
        channelName: "TikTok Organic",
        role: "Story-to-lyric behind-the-scenes proof",
      },
    };
    await db.insert(schema.channelSelectionSnapshots).values({
      id: snapIds.cs,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "COMPLETE",
      primaryChannel: JSON.stringify(csResult.primaryChannel),
      secondaryChannel: JSON.stringify(csResult.secondaryChannel),
      inputHash: "cs_hash",
      result: JSON.stringify(csResult),
      createdAt: t0,
    } as any);

    // 16. Stage 14 Budget Governor (recorded as ERROR in sectionStatuses of original job)
    await db.insert(schema.budgetGovernorSnapshots).values({
      id: snapIds.bg,
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      engineVersion: 1,
      status: "BUDGET_NOT_PROVIDED",
      decision: JSON.stringify({ action: "hold", reasoning: "No monthly budget configured yet" }),
      allocations: "[]",
      inputHash: "bg_hash",
      result: JSON.stringify({
        status: "BUDGET_NOT_PROVIDED",
        decision: { action: "hold", reasoning: "No monthly budget configured yet" },
        allocations: [],
      }),
      createdAt: t0,
    } as any);
  }

  it("Scenario 1 & 2: Resolves interrupted campaign across failed retries, heals spurious REVIEW_REQUIRED & null strategyRootId after restart, and hydrates all 13 upstream stages with full provenance", async () => {
    await seedInterruptedCampaignFixture();

    // Simulate server restart: clear in-memory circuit breakers
    resetProviderCircuitBreakerForContinuation();

    const plan = await resolveContinuationPlan(testAccountId, testCampaignId);

    expect(plan.canContinue).toBe(true);
    // Must look past testRetryJob1Id and testRetryJob2Id ("Blocked at resume_hydration") to find testSourceJobId
    expect(plan.sourceJobId).toBe(testSourceJobId);
    expect(plan.latestJobId).toBe(testRetryJob2Id);
    expect(plan.spuriousRootInvalidationDetected).toBe(true);
    expect(plan.resumeFromStage).toBe("budget_governor");
    expect(plan.resumeFromStageLabel).toBe("Budget Allocation");
    expect(plan.reusedStages).toHaveLength(13);
    expect(plan.remainingStages.map((s) => s.engineId)).toEqual([
      "budget_governor",
      "iteration",
      "retention",
    ]);
    expect(plan.explanation).toBe(
      "Continue from Budget Allocation. 13 completed stages will be reused."
    );
    expect(plan.interruptionDiagnostics?.category).toBe("BILLING_EXHAUSTED");
    expect(plan.interruptionDiagnostics?.isTechnicalInterruption).toBe(true);
    expect(plan.interruptionDiagnostics?.isBillingExhausted).toBe(true);
    expect(plan.executionLineage).toHaveLength(3);

    // Verify every reused stage carries explicit provenance
    for (const stage of plan.reusedStages) {
      expect(stage.wasReused).toBe(true);
      expect(stage.sourceJobId).toBe(testSourceJobId);
      expect(stage.accountId).toBe(testAccountId);
      expect(stage.campaignId).toBe(testCampaignId);
      expect(stage.offeringName).toBe("Personalized Songs");
      expect(stage.targetMarket).toBe("United States");
      expect(stage.contextFingerprint).toBe(testContextFingerprint);
      expect(stage.snapshotId).toBeTruthy();
    }

    // Prepare continuation state (heals spurious REVIEW_REQUIRED root and backfills strategyRootId on funnel & integrity)
    await prepareContinuationState(plan);

    const [healedRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.id, testRootId));
    expect(healedRoot.status).toBe("ACTIVE");

    const [healedInteg] = await db
      .select()
      .from(schema.integritySnapshots)
      .where(eq(schema.integritySnapshots.id, snapIds.integ));
    expect(healedInteg.strategyRootId).toBe(testRootId);

    const [healedFunnel] = await db
      .select()
      .from(schema.funnelSnapshots)
      .where(eq(schema.funnelSnapshots.id, snapIds.funnel));
    expect(healedFunnel.strategyRootId).toBe(testRootId);
    expect(healedFunnel.statusMessage).toBeNull();

    // Now run hydrateRequiredUpstreamForResume for a new continuation job ID (different from testSourceJobId!)
    const newContinuationJobId = `orch_cont_${testRunSuffix}`;
    const ctx: any = {
      sourceJobId: plan.sourceJobId,
      reusedSnapshotIds: plan.reusedSnapshotIds,
      contextFingerprint: plan.contextFingerprint,
      offeringId: plan.offeringId,
      offeringName: plan.offeringName,
      targetMarket: plan.targetMarket,
    };

    const hydration = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "budget_governor",
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: newContinuationJobId,
      ctx,
      sourceJobId: plan.sourceJobId,
      reusedSnapshotIds: plan.reusedSnapshotIds,
      contextFingerprint: plan.contextFingerprint,
      offeringId: plan.offeringId,
      offeringName: plan.offeringName,
      targetMarket: plan.targetMarket,
    });

    expect(hydration.gaps).toEqual([]);
    expect(hydration.hydrated).toEqual(
      expect.arrayContaining([
        "market_intelligence",
        "audience",
        "differentiation",
        "positioning",
        "mechanism",
        "strategy_root",
        "offer",
        "awareness",
        "funnel",
        "persuasion",
        "integrity",
        "statistical_validation",
        "channel_selection",
      ])
    );

    // Verify provenance on hydrated outputs in ctx.previousResults
    for (const engineId of [
      "market_intelligence",
      "audience",
      "differentiation",
      "positioning",
      "mechanism",
      "offer",
      "awareness",
      "funnel",
      "persuasion",
      "integrity",
      "statistical_validation",
      "channel_selection",
    ]) {
      const stepRes = ctx.previousResults.get(engineId);
      expect(stepRes).toBeDefined();
      expect(stepRes.output?._provenance?.wasReused).toBe(true);
      expect(stepRes.output?._provenance?.sourceJobId).toBe(testSourceJobId);
      expect(stepRes.output?._provenance?.contextFingerprint).toBe(testContextFingerprint);
      expect(stepRes.output?._provenance?.offeringName).toBe("Personalized Songs");
    }
  });

  it("Scenario 3: Provider billing/quota interruption is classified as BILLING_EXHAUSTED technical failure (never retried or converted into semantic rejection), and circuit breaker resets on continuation", async () => {
    const creditError = new Error(
      '429 {"error":{"message":"You have no credits remaining. Please add credits to continue.","type":"insufficient_quota"}}'
    );
    (creditError as any).status = 429;

    expect(isBillingOrQuotaExhaustedError(creditError)).toBe(true);
    expect(isProviderTechnicalFailureError(creditError)).toBe(true);

    const diag = classifyProviderInterruption(creditError.message, "channel_selection");
    expect(diag.category).toBe("BILLING_EXHAUSTED");
    expect(diag.isTechnicalInterruption).toBe(true);
    expect(diag.isBillingExhausted).toBe(true);

    // Verify generateWithRepair (reliability-runner) does NOT retry billing exhaustion
    let callCount = 0;
    await expect(
      generateWithRepair({
        engineName: "test_engine",
        touchpointName: "test_billing_no_retry",
        authoritativeInput: {},
        generate: async () => {
          callCount++;
          throw creditError;
        },
        judge: async () => ({ valid: true }),
        repair: async (_input, cand) => cand,
        config: { maxRepairs: 2, maxTechnicalRetries: 2 },
      })
    ).rejects.toThrow(/no credits remaining/i);
    expect(callCount).toBe(1);

    // Verify channel-judge rethrows billing/provider technical failure instead of returning semantic verdict: "BLOCK"
    vi.spyOn(aiClientModule, "aiChat").mockRejectedValueOnce(creditError);
    const { judgeChannelProposal } = await import("../strategy/channel-selection/channel-judge");
    await expect(
      judgeChannelProposal({
        proposal: {
          primaryChannel: { channelName: "Instagram Reels", role: "PRIMARY", reason: "High visual gift discovery" },
          secondaryChannels: [],
          avoidedChannels: [],
        } as any,
        productAnchor: null,
        businessModel: "B2C Digital Service",
        category: "Custom Music",
        pricing: "$49",
        audienceSegments: ["Milestone Gift Buyers"],
        audiencePains: ["Fear of generic AI lyrics"],
        awarenessStage: "PROBLEM_AWARE",
        persuasionMode: "DEMONSTRATION",
        ownedChannels: [],
        competitorPlatforms: [],
        marketVoiceEvidence: [],
        budgetMax: 500,
        priorDecisions: [],
        accountId: testAccountId,
      })
    ).rejects.toThrow(/no credits remaining/i);

    // Verify circuit breaker state resets cleanly on user-initiated continuation
    resetProviderCircuitBreakerForContinuation();
    const cbState = getProviderCircuitBreakerState();
    expect(cbState.openaiCircuitBroken).toBe(false);
    expect(cbState.geminiCircuitBroken).toBe(false);
  });

  it("Scenario 4: Preserves approved PROPOSED / STRATEGIC_HYPOTHESIS positioning across continuation without rejecting or overwriting it", async () => {
    await seedInterruptedCampaignFixture({ positioningProposalStatus: "PROPOSED" });

    const plan = await resolveContinuationPlan(testAccountId, testCampaignId);
    expect(plan.canContinue).toBe(true);

    const posStage = plan.reusedStages.find((s) => s.engineId === "positioning");
    expect(posStage).toBeDefined();
    expect(posStage?.proposalStatus).toBe("PROPOSED");
    expect(posStage?.wasReused).toBe(true);

    await prepareContinuationState(plan);

    const ctx: any = {};
    const hydration = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "budget_governor",
      accountId: testAccountId,
      campaignId: testCampaignId,
      jobId: `orch_pos_prop_${testRunSuffix}`,
      ctx,
      sourceJobId: plan.sourceJobId,
      reusedSnapshotIds: plan.reusedSnapshotIds,
      contextFingerprint: plan.contextFingerprint,
      offeringName: plan.offeringName,
      targetMarket: plan.targetMarket,
    });

    expect(hydration.gaps).toEqual([]);
    const posHydrated = ctx.previousResults.get("positioning");
    expect(posHydrated?.output?.proposalStatus).toBe("PROPOSED");
    expect(posHydrated?.output?._provenance?.proposalStatus).toBe("PROPOSED");
    expect(posHydrated?.output?._provenance?.wasReused).toBe(true);
  });

  it("Scenario 5: Walks backward to earliest missing prerequisite stage (offer) when an upstream snapshot is missing", async () => {
    await seedInterruptedCampaignFixture({ omitOfferSnapshot: true });

    const plan = await resolveContinuationPlan(testAccountId, testCampaignId, {
      fromStage: "budget_governor",
    });

    expect(plan.canContinue).toBe(true);
    expect(plan.resumeFromStage).toBe("offer");
    expect(plan.resumeFromStageLabel).toBe(STAGE_DISPLAY_NAMES.offer);
    expect(plan.missingPrerequisite).not.toBeNull();
    expect(plan.missingPrerequisite?.engineId).toBe("offer");
    expect(plan.reusedStages.map((s) => s.engineId)).toEqual([
      "market_intelligence",
      "market_voice",
      "audience",
      "differentiation",
      "positioning",
      "mechanism",
    ]);
    expect(plan.explanation).toContain("Continue from Offer Construction (earliest affected prerequisite)");
  });

  it("Scenario 6: Protects against incompatible context changes (offering, target market, or contextFingerprint mismatch)", async () => {
    await seedInterruptedCampaignFixture();

    const mismatchPlan = await resolveContinuationPlan(testAccountId, testCampaignId, {
      expectedOfferingName: "B2B Corporate Jingle Retainer",
      expectedTargetMarket: "Japan",
      expectedContextFingerprint: "incompatible_fingerprint_999",
    });

    expect(mismatchPlan.canContinue).toBe(false);
    expect(mismatchPlan.reusedStages).toHaveLength(0);
    expect(mismatchPlan.missingPrerequisite?.engineId).toBe("market_intelligence");
    expect(mismatchPlan.invalidatedStages.length).toBeGreaterThan(0);
    expect(mismatchPlan.invalidatedStages[0].invalidatedBy).toBe("CONTEXT_CHANGE");
    expect(mismatchPlan.explanation).toContain("Cannot reuse previous snapshots because campaign context changed");
  });

  it("Scenario 7 & 8 & 11: Prevents duplicate concurrent continuation jobs, keeps full regeneration separate, executes Express routes, and completes continuation without duplicate draft plans", async () => {
    await seedInterruptedCampaignFixture({ positioningProposalStatus: "PROPOSED" });

    // Mock runOrchestrator so continuation completes deterministically offline and synthesizes a DRAFT plan
    const runOrchestratorSpy = vi
      .spyOn(orchestratorModule, "runOrchestrator")
      .mockImplementation(async (cfg: any) => {
        const planId = `plan_cont_${randomUUID().slice(0, 8)}`;
        // Supersede any existing DRAFT plans for this campaign/account (matching plan-synthesis.ts behavior)
        await db
          .update(schema.strategicPlans)
          .set({ status: "SUPERSEDED", isDesignatedActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.strategicPlans.accountId, cfg.accountId),
              eq(schema.strategicPlans.campaignId, cfg.campaignId),
              eq(schema.strategicPlans.status, "DRAFT")
            )
          );

        await db.insert(schema.strategicPlans).values({
          id: planId,
          accountId: cfg.accountId,
          blueprintId: "orchestrator-v2",
          campaignId: cfg.campaignId,
          jobId: cfg.preassignedJobId,
          planJson: JSON.stringify({
            strategicSummary: {
              strategy: "Story-Verified Custom Song Craft Growth Plan",
              targetAudience: "Milestone Gift Buyers",
              growthObjective: "Qualified custom song orders",
              rationale: "Grounded in 13 reused upstream stages and completed budget/iteration/retention.",
            },
            positioningProposalStatus: "PROPOSED",
            _provenance: {
              sourceJobId: cfg.sourceJobId,
              reusedSnapshotIds: cfg.reusedSnapshotIds,
              contextFingerprint: cfg.contextFingerprint,
              offeringName: cfg.offeringName,
              targetMarket: cfg.targetMarket,
              positioningProposalStatus: "PROPOSED",
            },
          }),
          planSummary: "Story-Verified Custom Song Craft Growth Plan",
          status: "DRAFT",
          executionStatus: "IDLE",
        } as any);

        await db
          .update(schema.orchestratorJobs)
          .set({
            status: "COMPLETED",
            planId,
            completedAt: new Date(),
          })
          .where(eq(schema.orchestratorJobs.id, cfg.preassignedJobId));

        return {
          jobId: cfg.preassignedJobId,
          status: "COMPLETED",
          planId,
          results: {},
          durationMs: 120,
        } as any;
      });

    // Insert an old stale DRAFT plan first to verify continuation supersedes it instead of leaving duplicate DRAFT plans
    await db.insert(schema.strategicPlans).values({
      id: `plan_old_draft_${testRunSuffix}`,
      accountId: testAccountId,
      blueprintId: "orchestrator-v2",
      campaignId: testCampaignId,
      jobId: testSourceJobId,
      planJson: "{}",
      planSummary: "Old incomplete draft",
      status: "DRAFT",
      executionStatus: "IDLE",
    } as any);

    // Scenario 7: Fire two concurrent continuePipeline requests simultaneously
    const [res1, res2] = await Promise.all([
      StrategyExperienceService.continuePipeline(testCampaignId, testAccountId),
      StrategyExperienceService.continuePipeline(testCampaignId, testAccountId),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.jobId).toBeTruthy();
    expect(res2.jobId).toBe(res1.jobId);
    expect(runOrchestratorSpy).toHaveBeenCalledTimes(1);

    // Wait for the async runOrchestrator promise DB writes to settle
    let progress = await StrategyExperienceService.getRunProgress(res1.jobId!, testAccountId);
    for (let i = 0; i < 40 && progress?.status === "RUNNING"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      progress = await StrategyExperienceService.getRunProgress(res1.jobId!, testAccountId);
    }

    // Verify run progress includes wasReused: true and sourceJobId on the 13 reused stages
    expect(progress).not.toBeNull();
    expect(progress?.status).toBe("COMPLETED");
    const reusedStagesInProgress = progress!.stages.filter((s) => s.wasReused);
    expect(reusedStagesInProgress).toHaveLength(13);
    const posStageProgress = progress!.stages.find((s) => s.id === "positioning");
    expect(posStageProgress?.wasReused).toBe(true);
    expect(posStageProgress?.proposalStatus).toBe("PROPOSED");

    // Verify previous failed jobs are preserved in orchestrator_jobs for diagnostics
    const allJobs = await db
      .select()
      .from(schema.orchestratorJobs)
      .where(eq(schema.orchestratorJobs.campaignId, testCampaignId));
    expect(allJobs.map((j) => j.id)).toEqual(
      expect.arrayContaining([testSourceJobId, testRetryJob1Id, testRetryJob2Id, res1.jobId!])
    );

    // Verify only ONE active/draft plan exists (old draft was superseded)
    const draftPlans = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.campaignId, testCampaignId),
          eq(schema.strategicPlans.status, "DRAFT")
        )
      );
    expect(draftPlans).toHaveLength(1);
    expect(draftPlans[0].id).toBe(progress?.planId);

    // Scenario 8: Verify explicit Full Regeneration starts from Stage 01 (fromStage: null)
    const fullRegen = await StrategyExperienceService.generateStrategy(testCampaignId, testAccountId, {
      forceRefresh: true,
      recoveryMode: "FULL_REFRESH",
    });
    expect(fullRegen.success).toBe(true);
    expect(fullRegen.recoveryMode).toBe("FULL_REFRESH");
    expect(fullRegen.fromStage).toBeNull();

    // Scenario 11: Verify Express routes GET /api/strategy/continuation-plan/:campaignId
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.accountId = testAccountId;
      req.userId = "user_test_1";
      next();
    });
    registerStrategyExperienceRoutes(app);

    const server = app.listen(0);
    try {
      const addr = server.address() as { port: number };
      const planRes = await fetch(
        `http://127.0.0.1:${addr.port}/api/strategy/continuation-plan/${encodeURIComponent(testCampaignId)}`
      );
      expect(planRes.status).toBe(200);
      const planBody = await planRes.json();
      expect(planBody.campaignId).toBe(testCampaignId);
      expect(planBody.accountId).toBe(testAccountId);
    } finally {
      server.close();
    }
  });

  it("Scenario 9: Read-only verification of production campaign camp_ac86e8b8-55b resolves source run orch_1792157565442_wvv883 and 13 reusable stages", async () => {
    const prodAccountId = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
    const prodCampaignId = "camp_ac86e8b8-55b";

    const [prodJob] = await db
      .select()
      .from(schema.orchestratorJobs)
      .where(eq(schema.orchestratorJobs.campaignId, prodCampaignId))
      .limit(1);

    if (!prodJob) {
      // Skip only if running in an empty CI DB without the local campaign
      return;
    }

    const plan = await resolveContinuationPlan(prodAccountId, prodCampaignId);
    expect(plan.canContinue).toBe(true);
    expect(plan.sourceJobId).toBe("orch_1792157565442_wvv883");
    expect(plan.strategyRootId).toBe("cf708e0a-16c3-4b55-a3de-135168ef16fe");
    expect(plan.resumeFromStage).toBe("budget_governor");
    expect(plan.resumeFromStageLabel).toBe("Budget Allocation");
    expect(plan.reusedStages).toHaveLength(13);
    expect(plan.explanation).toBe(
      "Continue from Budget Allocation. 13 completed stages will be reused."
    );
  });
});
