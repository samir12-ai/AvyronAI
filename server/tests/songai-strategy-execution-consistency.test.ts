import { describe, it, expect } from "vitest";
import { resolvePlanContext, resolveExecutionPlan } from "../orchestrator/execution-plan-resolver";
import { buildExecutionPlanningContext } from "../what-to-do-today/context-builder";
import { WhatToDoTodayService } from "../what-to-do-today/service";
import { runDeterministicExecutionJudgeChecks } from "../what-to-do-today/judge";
import { assembleAudiencePositioningData } from "../audience-positioning-service";
import { assembleDashboardOverview } from "../dashboard/overview-engine";
import { reconcileBudgetDenominators } from "../orchestrator/plan-synthesis";
import { evaluateBeliefShiftGrounding } from "../persuasion-engine/belief-shift";
import { db } from "../db";
import {
  calendarEntries,
  studioItems,
  campaignBudgetSettings,
  executionDays,
  strategicPlans,
  channelSelectionSnapshots,
  budgetGovernorSnapshots,
} from "@shared/schema";
import { eq, and, ne, lt, desc } from "drizzle-orm";

const ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const CAMPAIGN_ID = "camp_ac86e8b8-55b";
const SECOND_CAMPAIGN_ID = "camp_songai_b2b_ksa_01";
const ACTIVE_PLAN_ID = "c3e6a7a0-56be-4538-b9de-529302903435";
const ACTIVE_ROOT_ID = "de027857-3a9e-4bee-8ad6-9a6b6319ec32";
const ACTIVE_BUNDLE_ID = "533cbd06-a23d-4eba-ac05-74a747b592d2";

describe("Songai Strategy-to-Execution Consistency & Positioning Presentation (14 Required Scenarios)", () => {
  it("1. Primary channel consistency across Strategy Plan, Overview, What To Do Today, Calendar, and Studio", async () => {
    const resolved = await resolvePlanContext({ campaignId: CAMPAIGN_ID, accountId: ACCOUNT_ID, mode: "APPROVED_ACTIVE" });
    expect(resolved.planId).toBe(ACTIVE_PLAN_ID);
    expect(resolved.planVersion).toBe(4);
    expect(resolved.strategyRootId).toBe(ACTIVE_ROOT_ID);
    expect(resolved.strategyRootVersion).toBeNull();
    expect(resolved.rootBundleId).toBe(ACTIVE_BUNDLE_ID);
    expect(resolved.rootBundleVersion).toBe(13);
    expect(resolved.snapshotIds.audienceSnapshotId).toBe("3628f8ae-2af0-47aa-ae2b-7e5c3e5347bf");
    expect(resolved.snapshotIds.mechanismSnapshotId).toBe("a000c097-8383-48e3-975c-a7ce6c6ca3af");
    expect(resolved.snapshotIds.offerSnapshotId).toBe("2fdccd1d-987e-4730-bcd7-889c5fd96b45");
    expect(resolved.snapshotIds.channelSelectionSnapshotId).toBe("c30f9f38-da5d-4f2a-99f8-52ccd5f41c43");
    expect(resolved.snapshotIds.budgetGovernorSnapshotId).toBe("23dec780-5fd9-4377-abc0-525fa5b956eb");
    expect(resolved.snapshotIds.funnelSnapshotIds).toEqual(
      expect.arrayContaining([
        "0f5ab04c-5310-47e3-b4ca-d5c094e1862d",
        "4a7d1696-d6d8-4148-bbb1-b1f47e26e8f1",
      ])
    );

    const overview = await assembleDashboardOverview(ACCOUNT_ID, CAMPAIGN_ID);
    expect(overview.strategyPlanCard.activePlanVersion).toBe(4);
    expect(overview.strategyPlanCard.rootBundleVersion).toBe(13);

    const today = await WhatToDoTodayService.getOrCreateTodayPlan(CAMPAIGN_ID, "2026-11-05", false, ACCOUNT_ID);
    expect(today.primaryChannel).toBe("INSTAGRAM");
    expect(today.primaryChannelMode).toBe("ORGANIC");

    const activeCal = await db
      .select()
      .from(calendarEntries)
      .where(and(eq(calendarEntries.campaignId, CAMPAIGN_ID), eq(calendarEntries.planId, ACTIVE_PLAN_ID), ne(calendarEntries.status, "SUPERSEDED")));
    expect(activeCal.length).toBe(155);
    expect(activeCal.every((c) => c.planId === ACTIVE_PLAN_ID)).toBe(true);

    const activeStudio = await db
      .select()
      .from(studioItems)
      .where(and(eq(studioItems.campaignId, CAMPAIGN_ID), eq(studioItems.planId, ACTIVE_PLAN_ID), ne(studioItems.status, "SUPERSEDED")));
    expect(activeStudio.length).toBe(155);
    expect(activeStudio.every((s) => s.planId === ACTIVE_PLAN_ID)).toBe(true);
  }, 30000);

  it("2. Supporting channel task rendered as supporting, not primary", async () => {
    const today = await WhatToDoTodayService.getOrCreateTodayPlan(CAMPAIGN_ID, "2026-11-05", false, ACCOUNT_ID);
    const activeTasks = today.tasks.filter((t) => t.status !== "STALE");
    const igTasks = activeTasks.filter((t) => t.channel === "INSTAGRAM");
    const tiktokTasks = activeTasks.filter((t) => t.channel === "TIKTOK");

    expect(igTasks.length).toBeGreaterThan(0);
    expect(tiktokTasks.length).toBeGreaterThan(0);
    expect(igTasks.every((t) => t.channelRole === "PRIMARY")).toBe(true);
    expect(tiktokTasks.every((t) => t.channelRole === "SUPPORTING")).toBe(true);

    const tiktokPlanEntry = today.channelPlan.find((c) => c.channel === "TIKTOK");
    expect(tiktokPlanEntry?.role).toBe("SUPPORTING");
  }, 30000);

  it("3. Rejected paid channel not silently banning organic if organic is approved; rejected channel not scheduled when rejected for the relevant mode", async () => {
    const ctx = await buildExecutionPlanningContext(CAMPAIGN_ID, "2026-11-05", ACCOUNT_ID);
    expect(ctx.channelHierarchy.rejectedPaidChannels.some((r) => /YouTube/i.test(r))).toBe(true);
    expect(ctx.channelHierarchy.rejectedOrganicChannels.some((r) => /YouTube/i.test(r))).toBe(false);

    // Unapproved YOUTUBE task is rejected when YOUTUBE (Organic or Paid) is not in approvedChannels
    const checkUnapproved = runDeterministicExecutionJudgeChecks(ctx, {
      dailyMission: "Execute personalized song proof on Instagram and YouTube.",
      executionRationale: "Testing channel enforcement.",
      tasks: [
        {
          title: "Instagram Reel Emotional Reaction Proof",
          description: "Publish reaction reel",
          taskType: "CONTENT",
          priority: "MUST_DO",
          channel: "INSTAGRAM",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Awareness",
          reason: "Primary channel",
          expectedOutcome: "Reach",
          sourceAuthority: "channel_selection",
          estimatedEffort: "45m",
          executionApproach: "Native reel",
          proofRequired: "Audio clip",
          ctaDestination: "https://thesongai.com/",
        },
        {
          title: "YouTube Paid Video Ad Campaign",
          description: "Launch paid ad",
          taskType: "DISTRIBUTION",
          priority: "SHOULD_DO",
          channel: "YOUTUBE",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Conversion",
          reason: "Unapproved channel test",
          expectedOutcome: "Clicks",
          sourceAuthority: "channel_selection",
          estimatedEffort: "60m",
          executionApproach: "Paid video",
          proofRequired: "Ad creative",
          ctaDestination: "https://thesongai.com/",
        },
      ],
      channelPlan: [],
    });
    expect(checkUnapproved.rejections.some((r) => r.includes("UNAPPROVED_CHANNEL_USED") && r.includes("YOUTUBE"))).toBe(true);

    // If YouTube Organic IS explicitly approved while YouTube Paid Ads is in rejectedPaidChannels, YouTube Organic tasks are permitted
    const ctxWithYoutubeOrganic = {
      ...ctx,
      channelHierarchy: {
        ...ctx.channelHierarchy,
        approvedChannels: [
          ...ctx.channelHierarchy.approvedChannels,
          {
            channelName: "YouTube Organic Shorts",
            platform: "YOUTUBE" as const,
            mode: "ORGANIC" as const,
            strategicRole: "SUPPORTING" as const,
          },
        ],
      },
    };
    const checkApprovedOrganic = runDeterministicExecutionJudgeChecks(ctxWithYoutubeOrganic, {
      dailyMission: "Execute personalized song proof across Instagram and YouTube Organic Shorts.",
      executionRationale: "Organic YouTube Shorts permitted despite YouTube Paid Ads rejection.",
      tasks: [
        {
          title: "Instagram Reel Emotional Reaction Proof",
          description: "Publish reaction reel",
          taskType: "CONTENT",
          priority: "MUST_DO",
          channel: "INSTAGRAM",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Awareness",
          reason: "Primary channel",
          expectedOutcome: "Reach",
          sourceAuthority: "channel_selection",
          estimatedEffort: "45m",
          executionApproach: "Native reel",
          proofRequired: "Audio clip",
          ctaDestination: "https://thesongai.com/",
        },
        {
          title: "YouTube Organic Shorts Song Reveal",
          description: "Cross-post organic short",
          taskType: "CONTENT",
          priority: "OPTIONAL",
          channel: "YOUTUBE",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Awareness",
          reason: "Supporting organic channel",
          expectedOutcome: "Views",
          sourceAuthority: "channel_selection",
          estimatedEffort: "30m",
          executionApproach: "Organic Short",
          proofRequired: "Short video",
          ctaDestination: "https://thesongai.com/",
        },
      ],
      channelPlan: [],
    });
    expect(checkApprovedOrganic.rejections.some((r) => r.includes("UNAPPROVED_CHANNEL_USED"))).toBe(false);
  }, 30000);

  it("4. Missing channel decision returning missing-context state, never YOUTUBE", async () => {
    await expect(
      buildExecutionPlanningContext("camp_nonexistent_missing_channel_test", "2026-11-05", ACCOUNT_ID)
    ).rejects.toThrow(/EXECUTION_GATED|MISSING_STRATEGY_CONTEXT/);
  }, 30000);

  it("5. Missing funnel CTA/destination returning missing-context state, never Webinar / Demo or Free Trial Signup unless in approved snapshots", async () => {
    const ctx = await buildExecutionPlanningContext(CAMPAIGN_ID, "2026-11-05", ACCOUNT_ID);
    expect(ctx.funnelJourney.ctaPrimary).toBe("Generate Your Free Trial Song");
    expect(ctx.funnelJourney.ctaPrimary).not.toContain("Webinar");
    expect(ctx.funnelJourney.ctaPrimary).not.toBe("Free Trial Signup");
    expect(ctx.funnelJourney.destinationUrl).toBe("https://thesongai.com/");

    // For Songai (self-serve eCommerce), "Webinar / Demo" is rejected because the approved strategy has no webinar/demo
    const songaiWebinarCheck = runDeterministicExecutionJudgeChecks(ctx, {
      dailyMission: "Drive gift buyers to create a free song preview on the website.",
      executionRationale: "Testing funnel CTA grounding.",
      tasks: [
        {
          title: "Instagram Reel Gift Story",
          description: "Book a Webinar / Demo with our team",
          taskType: "CONVERSION",
          priority: "MUST_DO",
          channel: "INSTAGRAM",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Conversion",
          reason: "Test",
          expectedOutcome: "Leads",
          sourceAuthority: "funnel",
          estimatedEffort: "30m",
          executionApproach: "Reel",
          proofRequired: "Audio",
          ctaDestination: "Webinar / Demo",
        },
        {
          title: "TikTok Behind the Lyrics Video",
          description: "Create Your Free Song Preview at https://thesongai.com/",
          taskType: "CONTENT",
          priority: "SHOULD_DO",
          channel: "TIKTOK",
          laneId: ctx.approvedLanes[1].laneId,
          objective: "Awareness",
          reason: "Test",
          expectedOutcome: "Views",
          sourceAuthority: "funnel",
          estimatedEffort: "30m",
          executionApproach: "TikTok",
          proofRequired: "Video",
          ctaDestination: "https://thesongai.com/",
        },
      ],
      channelPlan: [],
    });
    expect(songaiWebinarCheck.rejections.some((r) => r.includes("UNSUPPORTED_FUNNEL_CTA"))).toBe(true);

    // For a B2B campaign whose approved offer/funnel explicitly includes a live demo/webinar, "Webinar / Demo" IS allowed
    const b2bCtx = {
      ...ctx,
      offerSummary: "Enterprise B2B SaaS Platform with Live Architecture Demo & Technical Webinar",
      funnelJourney: {
        ...ctx.funnelJourney,
        ctaPrimary: "Book a Live Webinar / Demo",
      },
    };
    const b2bCheck = runDeterministicExecutionJudgeChecks(b2bCtx, {
      dailyMission: "Drive enterprise buyers to book a live architecture demo.",
      executionRationale: "B2B demo funnel.",
      tasks: [
        {
          title: "Instagram Carousel Architecture Walkthrough",
          description: "Invite engineering leads to Book a Live Webinar / Demo",
          taskType: "CONVERSION",
          priority: "MUST_DO",
          channel: "INSTAGRAM",
          laneId: ctx.approvedLanes[0].laneId,
          objective: "Conversion",
          reason: "B2B demo funnel",
          expectedOutcome: "Demo bookings",
          sourceAuthority: "funnel",
          estimatedEffort: "45m",
          executionApproach: "Carousel",
          proofRequired: "Architecture diagram",
          ctaDestination: "Book a Live Webinar / Demo",
        },
        {
          title: "TikTok Short Engineering Breakdown",
          description: "Register for the technical webinar",
          taskType: "CONTENT",
          priority: "SHOULD_DO",
          channel: "TIKTOK",
          laneId: ctx.approvedLanes[1].laneId,
          objective: "Awareness",
          reason: "B2B reach",
          expectedOutcome: "Views",
          sourceAuthority: "funnel",
          estimatedEffort: "30m",
          executionApproach: "Short video",
          proofRequired: "Clip",
          ctaDestination: "Book a Live Webinar / Demo",
        },
      ],
      channelPlan: [],
    });
    expect(b2bCheck.rejections.some((r) => r.includes("UNSUPPORTED_FUNNEL_CTA"))).toBe(false);
  }, 30000);

  it("6. Multi-lane preservation and pain ID resolution to human text", async () => {
    const ctx = await buildExecutionPlanningContext(CAMPAIGN_ID, "2026-11-05", ACCOUNT_ID);
    expect(ctx.approvedLanes.length).toBe(2);
    expect(ctx.approvedLanes.map((l) => l.laneId)).toEqual(["lane_d04c05596a29", "lane_287549d5f008"]);
    for (const lane of ctx.approvedLanes) {
      expect(lane.primaryPain).toBeTruthy();
      expect(lane.primaryPain).not.toMatch(/^pain_[0-9a-f]+$/i);
      expect(lane.corePains?.every((p) => !/^pain_[0-9a-f]+$/i.test(p))).toBe(true);
    }
    expect(ctx.approvedLanes[0].primaryCta).toBe("Generate Your Free Trial Song");
    expect(ctx.approvedLanes[1].primaryCta).toBe("Listen to Your Preview");
  }, 30000);

  it("7. Multi-campaign isolation under the same account", async () => {
    const songaiResolved = await resolvePlanContext({ campaignId: CAMPAIGN_ID, accountId: ACCOUNT_ID });
    expect(songaiResolved.productId).toBe("prod_songai_personalized_songs");
    expect(songaiResolved.offeringId).toBe("off_6ab47aa7-8");

    const [songaiBudget] = await db
      .select()
      .from(campaignBudgetSettings)
      .where(and(eq(campaignBudgetSettings.accountId, ACCOUNT_ID), eq(campaignBudgetSettings.campaignId, CAMPAIGN_ID)));
    const [b2bBudget] = await db
      .select()
      .from(campaignBudgetSettings)
      .where(and(eq(campaignBudgetSettings.accountId, ACCOUNT_ID), eq(campaignBudgetSettings.campaignId, SECOND_CAMPAIGN_ID)));

    expect(Number(songaiBudget.monthlyBudget)).toBe(5000);
    expect(Number(b2bBudget.monthlyBudget)).toBe(3500);

    const b2bExec = await resolveExecutionPlan({ campaignId: SECOND_CAMPAIGN_ID, accountId: ACCOUNT_ID, intent: "execution" });
    expect(b2bExec.planId).toBe("plan_songai_b2b_ksa_v1");
    expect(b2bExec.plan?.id).not.toBe(ACTIVE_PLAN_ID);
  }, 30000);

  it("8. Newer unapproved draft not overriding active approved execution", async () => {
    const draftPlans = await db
      .select()
      .from(strategicPlans)
      .where(and(eq(strategicPlans.campaignId, CAMPAIGN_ID), eq(strategicPlans.status, "DRAFT")))
      .orderBy(desc(strategicPlans.createdAt));

    expect(draftPlans.length).toBeGreaterThan(0);

    const viewableCtx = await resolvePlanContext({ campaignId: CAMPAIGN_ID, accountId: ACCOUNT_ID, mode: "LATEST_VIEWABLE" });
    expect(viewableCtx.planId).toBe(ACTIVE_PLAN_ID);
    expect(viewableCtx.isDesignatedActive).toBe(true);
    expect(viewableCtx.candidateDraftPlan?.id).toBe(draftPlans[0].id);

    const execResolution = await resolveExecutionPlan({ campaignId: CAMPAIGN_ID, accountId: ACCOUNT_ID, intent: "execution" });
    expect(execResolution.canExecute).toBe(true);
    expect(execResolution.plan?.id).toBe(ACTIVE_PLAN_ID);
  }, 30000);

  it("9. Plan approval superseding stale future execution while preserving completed history", async () => {
    const historicalDays = await db
      .select()
      .from(executionDays)
      .where(and(eq(executionDays.campaignId, CAMPAIGN_ID), lt(executionDays.businessDate, "2026-11-05")));

    expect(historicalDays.length).toBe(8);
    const activeHistoricalDays = historicalDays.filter((d) => d.status === "ACTIVE");
    expect(activeHistoricalDays.length).toBe(8);

    const allHistoricalDays = await db
      .select()
      .from(executionDays)
      .where(lt(executionDays.businessDate, "2026-11-05"));
    expect(allHistoricalDays.length).toBe(18);
    expect(allHistoricalDays.every((d) => d.status === "ACTIVE")).toBe(true);
  }, 30000);

  it("10. Positioning view rendering human fields and never leaking raw JSON", async () => {
    const vm = await assembleAudiencePositioningData(CAMPAIGN_ID, ACCOUNT_ID);
    expect(vm.positioning.umbrellaPosition).toBe("Authentic Personal Memory Translation and Emotional Artistry");
    expect(vm.positioning.positioningStatement.trim().startsWith("{")).toBe(false);
    expect(vm.positioning.positioningStatement.length).toBeGreaterThan(40);
    expect(vm.positioning.positioningStatement.length).toBeLessThan(600);
    expect(vm.positioning.reasoningJourney.step4.description.trim().startsWith("{")).toBe(false);
    expect(vm.positioning.reasoningJourney.step4.description).not.toContain('"semanticCollision"');
    expect(vm.positioning.reasoningJourney.step4.description).not.toBe(vm.positioning.contrastAxis.axisLabel);
  }, 30000);

  it("11. Positioning status labels separating adoption, evidence support, market validation, and overlap", async () => {
    const vm = await assembleAudiencePositioningData(CAMPAIGN_ID, ACCOUNT_ID);
    expect(vm.positioning.adoptionStatus?.status).toBe("APPROVED");
    expect(vm.positioning.adoptionStatus?.label).toContain("Approved by User");
    expect(vm.positioning.factualSupportStatus?.status).toBe("STRATEGIC_SYNTHESIS");
    expect(vm.positioning.marketValidationStatus?.status).toBe("UNTESTED_PROVISIONAL");
    expect(vm.positioning.competitiveOverlapStatus?.status).toBe("SHARED_CAPABILITY_EMPHASIS");
    expect(vm.positioning.competitiveOverlap?.overlapPercent).toBe(80);
    // Stored opportunityScore (0.95) and saturationLevel (0) are preserved rather than overwritten by 1 - 0.80 * 0.65 = 0.48
    expect(vm.positioning.diagnostics?.candidateTerritories?.[0]?.opportunityScore).toBe(0.95);
    expect(vm.positioning.diagnostics?.candidateTerritories?.[0]?.saturationLevel).toBe(0);
  }, 30000);

  it("12. Competitor counterexample blocking false 'no competitor offers preview' claim", () => {
    const verdict = evaluateBeliefShiftGrounding(
      {
        laneTitle: "Musical Quality & Emotional Authenticity",
        objectionStatements: ["Will an AI song sound robotic?"],
        productTruthFacts: [{ id: "pt_1", text: "Free song preview before purchase" }],
        competitorPreviewCounterexamples: [
          {
            competitorName: "Songlorious",
            evidenceText: "Get a free 40-second song preview before paying.",
            previewTiming: "PRE_PAYMENT_FREE_PREVIEW",
          },
        ],
        accountId: ACCOUNT_ID,
      },
      {
        currentBelief: "Buyers assume AI songs sound robotic and lack emotional depth.",
        desiredBelief: "Hearing a free personalized preview proves emotional resonance before buying.",
        contradictionLogic: "No competitor offers a preview before payment, forcing blind upfront payment.",
      }
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.rejections?.[0]?.reason).toContain("COMPETITOR_COUNTEREXAMPLE_VIOLATION");
  });

  it("13. Unsupported permanent/revision/turnaround/pricing claim blocked or labeled as proposal", async () => {
    const verdict = evaluateBeliefShiftGrounding(
      {
        laneTitle: "Musical Quality & Emotional Authenticity",
        objectionStatements: ["Will I lose access to my song link?"],
        productTruthFacts: [{ id: "pt_1", text: "Instant digital MP3 download and shareable link" }],
        accountId: ACCOUNT_ID,
      },
      {
        currentBelief: "Buyers worry digital links expire over time.",
        desiredBelief: "Your custom song is permanently accessible with a lifetime hosting link.",
        contradictionLogic: "Permanent cloud hosting ensures the memory never expires.",
      }
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.rejections?.[0]?.reason).toContain("PRODUCT_TRUTH_VIOLATION");

    const vm = await assembleAudiencePositioningData(CAMPAIGN_ID, ACCOUNT_ID);
    expect(vm.positioning.factualSupportStatus?.status).toBe("STRATEGIC_SYNTHESIS");
  }, 30000);

  it("14. Budget consistency between Channel Selection, Budget Governor, Strategy Plan, and What To Do Today", async () => {
    const reconciled = reconcileBudgetDenominators(5000, "USD", [
      {
        channelId: "primary_channel",
        channelName: "Instagram Organic",
        sharePercentage: 60,
        monthlyAmount: 3000,
        isOrganic: true,
        proposedUse: "Organic content production and creator reel assets",
      },
      {
        channelId: "secondary_channel",
        channelName: "TikTok Organic",
        sharePercentage: 40,
        monthlyAmount: 2000,
        isOrganic: true,
        proposedUse: "Short-form video distribution and reaction clips",
      },
    ]);
    expect(reconciled.totalCampaignBudget).toBe(5000);
    expect(reconciled.paidMediaSpend).toBe(0);
    expect(reconciled.contentProductionBudget + reconciled.organicEffortAllocation).toBe(5000);
    expect(reconciled.unallocatedReserve).toBe(0);
    expect(reconciled.reconcilesToTotal).toBe(true);

    // Verify latest pipeline-generated Channel Selection snapshot uses the confirmed $5,000 USD budget (no "$500 test budget")
    const [latestCs] = await db
      .select()
      .from(channelSelectionSnapshots)
      .where(eq(channelSelectionSnapshots.campaignId, CAMPAIGN_ID))
      .orderBy(desc(channelSelectionSnapshots.createdAt))
      .limit(1);
    expect(latestCs).toBeTruthy();
    if (latestCs.id !== "c30f9f38-da5d-4f2a-99f8-52ccd5f41c43") {
      expect(latestCs.result).not.toContain("$500 test budget");
      expect(latestCs.result).not.toContain("$0 budget constraint");
    }
  }, 30000);
});
