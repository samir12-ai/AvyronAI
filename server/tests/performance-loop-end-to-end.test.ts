import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { parseLinkedInIdentity } from "../acquisition/multi-source-providers";
import { scrapeUserChannels } from "../user-channel-scraper";
import { LinkedInAdapter, WebsiteAdapter, ManualTruthAdapter } from "../performance-loop/platform-adapters";
import { assembleFactualDossier } from "../performance-loop/source-normalizer";
import { translatePerformanceToBll } from "../performance-loop/bll";
import {
  evaluateAndPersistBusinessExecutionState,
  submitClarificationAnswer,
  validateAndNormalizeBaselineAnswer,
  BaselineValidationError,
} from "../performance-loop/execution-intelligence";
import {
  getOrCreateWeeklyInventory,
  submitWeeklyInventoryMetrics,
  formatWeeklyInventoryHistoryRow,
  WeeklyInventoryValidationError,
} from "../performance-loop/weekly-inventory-engine";
import {
  setCampaignClockOverride,
  clearAllCampaignClockOverrides,
} from "../performance-loop/clock";
import { syncNotificationsForCampaign } from "../notifications-routes";
import {
  waitForFetchJobTerminalOutcome,
  runScheduledCampaignDownstreamHandoff,
  runScheduledPerformanceAndReminderCheck,
  getUnifiedScheduleHealth,
} from "../watchtower/scheduler";

const FIXTURE_ACCOUNT_ID = "test_acc_perf_loop_e2e";
const FIXTURE_CAMPAIGN_ID = "test_camp_perf_loop_e2e";
const FIXTURE_PLAN_ID = "test_plan_perf_loop_e2e";

async function cleanupFixture() {
  await db.delete(schema.notifications).where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.pipelineUserTruth).where(eq(schema.pipelineUserTruth.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.weeklyBusinessInventories).where(eq(schema.weeklyBusinessInventories.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.clarificationRequests).where(eq(schema.clarificationRequests.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.businessExecutionStates).where(eq(schema.businessExecutionStates.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.performanceContexts).where(eq(schema.performanceContexts.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.ownedSourceSnapshots).where(eq(schema.ownedSourceSnapshots.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.ownedPostSnapshots).where(eq(schema.ownedPostSnapshots.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.ownedPosts).where(eq(schema.ownedPosts.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.userChannelSnapshots).where(eq(schema.userChannelSnapshots.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.pipelineEvalWindows).where(eq(schema.pipelineEvalWindows.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.planApprovals).where(eq(schema.planApprovals.planId, FIXTURE_PLAN_ID));
  await db.delete(schema.strategicPlans).where(eq(schema.strategicPlans.campaignId, FIXTURE_CAMPAIGN_ID));
  await db.delete(schema.miFetchJobs).where(eq(schema.miFetchJobs.campaignId, FIXTURE_CAMPAIGN_ID));
}

describe("Performance Loop End-to-End & Regression Suite", () => {
  beforeAll(async () => {
    await cleanupFixture();

    const anchorDate = new Date("2026-10-24T10:00:00.000Z");
    await db.insert(schema.strategicPlans).values({
      id: FIXTURE_PLAN_ID,
      accountId: FIXTURE_ACCOUNT_ID,
      blueprintId: "test_bp_perf_loop_e2e",
      campaignId: FIXTURE_CAMPAIGN_ID,
      planJson: JSON.stringify({ summary: "Fixture Strategy Plan" }),
      status: "APPROVED",
      version: 1,
      createdAt: anchorDate,
      updatedAt: anchorDate,
    });
    await db.insert(schema.planApprovals).values({
      id: "test_approval_perf_loop_e2e",
      accountId: FIXTURE_ACCOUNT_ID,
      planId: FIXTURE_PLAN_ID,
      decision: "APPROVED",
      createdAt: anchorDate,
    });
    await db.insert(schema.websiteSnapshots).values({
      id: "test_websnap_perf_loop_e2e",
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      rootUrl: "https://example-song-fixture.com/",
      crawlStatus: "COMPLETE",
      preliminaryExtraction: {
        primaryOffering: "Custom AI Songs",
      },
    });
    await db.insert(schema.campaignOfferings).values({
      id: "test_off_perf_loop_e2e",
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      offeringName: "Custom AI Songs",
      sourceInputEvidenceId: "test_off_ev_perf_loop_e2e",
    });
  });

  afterAll(async () => {
    await cleanupFixture();
  });

  it("1. Normalizes LinkedIn company and personal URLs while rejecting generic root paths", () => {
    const compFull = parseLinkedInIdentity("https://www.linkedin.com/company/the-songai/posts/?feedView=all");
    expect(compFull.valid).toBe(true);
    expect(compFull.kind).toBe("company");
    expect(compFull.slug).toBe("the-songai");
    expect(compFull.handle).toBe("company/the-songai");
    expect(compFull.canonicalUrl).toBe("https://www.linkedin.com/company/the-songai");

    const personalFull = parseLinkedInIdentity("https://linkedin.com/in/jane-doe-founder/");
    expect(personalFull.valid).toBe(true);
    expect(personalFull.kind).toBe("profile");
    expect(personalFull.slug).toBe("jane-doe-founder");
    expect(personalFull.handle).toBe("in/jane-doe-founder");
    expect(personalFull.canonicalUrl).toBe("https://www.linkedin.com/in/jane-doe-founder");

    const shorthandComp = parseLinkedInIdentity("company/acme-music");
    expect(shorthandComp.valid).toBe(true);
    expect(shorthandComp.kind).toBe("company");
    expect(shorthandComp.slug).toBe("acme-music");

    for (const invalidInput of [
      "https://linkedin.com/company",
      "https://www.linkedin.com/company/",
      "https://linkedin.com/in",
      "company",
      "in",
      "",
    ]) {
      const parsed = parseLinkedInIdentity(invalidInput);
      expect(parsed.valid).toBe(false);
    }
  });

  it("2. Never erases a saved LinkedIn URL/handle when identity is unresolved or scraping fails", async () => {
    await db.insert(schema.userPublicProfiles).values({
      id: "test_chan_li_unresolved",
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      platform: "linkedin",
      handle: "company",
      url: "https://linkedin.com/company",
    });

    await scrapeUserChannels(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, ["linkedin"]);

    const [profileAfter] = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(eq(schema.userPublicProfiles.id, "test_chan_li_unresolved"));

    expect(profileAfter).toBeDefined();
    expect(profileAfter.url).toBe("https://linkedin.com/company");
    expect(profileAfter.handle).toBe("company");

    const [liSnap] = await db
      .select()
      .from(schema.userChannelSnapshots)
      .where(
        and(
          eq(schema.userChannelSnapshots.campaignId, FIXTURE_CAMPAIGN_ID),
          eq(schema.userChannelSnapshots.platform, "linkedin")
        )
      );
    expect(liSnap).toBeDefined();
    const snapData = JSON.parse(liSnap.snapshotData!);
    expect(snapData.scrapeStatus).toBe("SKIPPED");
    expect(snapData.identityStatus).toBe("UNRESOLVED");
  }, 60000);

  it("3. Wires LinkedIn through Adapter -> Dossier -> Reasoner -> BLL without inventing unavailable analytics", async () => {
    const unresolvedAdapterRes = await LinkedInAdapter.fetchSnapshot(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(unresolvedAdapterRes.snapshot.providerStatus).toBe("IDENTITY_UNRESOLVED");
    expect(unresolvedAdapterRes.factualMetrics.channelLifecycleState).toBe("IDENTITY_UNRESOLVED");
    expect(unresolvedAdapterRes.factualMetrics.isConnected).toBe(false);
    expect(unresolvedAdapterRes.factualMetrics.totalReach).toBeNull();
    expect(unresolvedAdapterRes.factualMetrics.totalImpressions).toBeNull();

    await db
      .update(schema.userPublicProfiles)
      .set({
        handle: "company/songai-fixture",
        url: "https://www.linkedin.com/company/songai-fixture",
      })
      .where(eq(schema.userPublicProfiles.id, "test_chan_li_unresolved"));

    await db.insert(schema.userChannelSnapshots).values({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      platform: "linkedin",
      handle: "company/songai-fixture",
      snapshotData: JSON.stringify({
        platform: "linkedin",
        handle: "company/songai-fixture",
        url: "https://www.linkedin.com/company/songai-fixture",
        accountType: "company",
        identityStatus: "CONFIRMED",
        scrapeStatus: "SUCCESS",
        followers: 420,
        postCount: 2,
        fetchedWindowPostCount: 2,
        storedHistoricalPostCount: 2,
      }),
    });

    await db.insert(schema.ownedPosts).values([
      {
        id: "test_li_post_1",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        ownedProfileId: "test_chan_li_unresolved",
        platform: "linkedin",
        postId: "urn:li:activity:7001",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7001",
        caption: "Launching our new personalized song studio for corporate milestones.",
        mediaType: "article",
        postedAt: new Date("2026-10-25T12:00:00Z"),
        firstSeenAt: new Date("2026-10-25T13:00:00Z"),
        lastSeenAt: new Date("2026-10-25T13:00:00Z"),
        lineageState: "unmatched",
      },
      {
        id: "test_li_post_2",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        ownedProfileId: "test_chan_li_unresolved",
        platform: "linkedin",
        postId: "urn:li:activity:7002",
        permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7002",
        caption: "Behind the scenes of custom songwriting with AI + human vocals.",
        mediaType: "video",
        postedAt: new Date("2026-10-26T12:00:00Z"),
        firstSeenAt: new Date("2026-10-26T13:00:00Z"),
        lastSeenAt: new Date("2026-10-26T13:00:00Z"),
        lineageState: "unmatched",
      },
    ]);

    await db.insert(schema.ownedPostSnapshots).values([
      {
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        ownedPostId: "test_li_post_1",
        checkpoint: "discovery",
        observedAt: new Date("2026-10-26T14:00:00Z"),
        likes: 28,
        comments: 6,
        views: null,
        followersAtObservation: 420,
      },
      {
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        ownedPostId: "test_li_post_2",
        checkpoint: "discovery",
        observedAt: new Date("2026-10-26T14:00:00Z"),
        likes: 19,
        comments: 4,
        views: null,
        followersAtObservation: 420,
      },
    ]);

    const dossier = await assembleFactualDossier({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    expect(dossier.websiteFact?.hasProductOffering).toBe(true);
    expect(dossier.websiteFact?.offeringName).toBe("Custom AI Songs");

    expect(dossier.linkedInFact?.isConnected).toBe(true);
    expect(dossier.linkedInFact?.providerStatus).toBe("COMPLETE");
    expect(dossier.linkedInFact?.channelLifecycleState).toBe("FETCHED");
    expect(dossier.linkedInFact?.totalPostsObserved).toBe(2);
    expect(dossier.linkedInFact?.followersCount).toBe(420);
    expect(dossier.linkedInFact?.totalEngagement).toBe(57);
    expect(dossier.linkedInFact?.totalViews).toBeNull();
  }, 60000);

  it("4, 5 & 7. Reuses PENDING clarification request, enforces 48h deduplicated reminder policy, treats unknown as not-zero, and persists answers cleanly", async () => {
    const eval1 = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    const eval2 = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });

    expect(eval1.clarificationRequest).toBeDefined();
    expect(eval2.clarificationRequest).toBeDefined();
    expect(eval2.clarificationRequest?.id).toBe(eval1.clarificationRequest?.id);
    expect(eval2.clarificationRequest?.missingFactType).toBe("business_operating_baseline");
    expect(eval2.clarificationRequest?.answerType).toBe("STRUCTURED_BASELINE");

    const bllPresentation = translatePerformanceToBll(
      eval2.executionState,
      eval2.performanceContext,
      eval2.clarificationRequest
    );
    const liCoverage = bllPresentation.dataCoverage.find((c) => c.sourceName === "LinkedIn");
    expect(liCoverage).toBeDefined();
    expect(liCoverage?.status).toBe("CONNECTED");

    expect(eval2.dossier.manualTruthFact?.hasUserTruth).toBe(false);
    expect(eval2.dossier.manualTruthFact?.historicalCustomerCount).toBeUndefined();
    expect(eval2.dossier.linkedInFact?.totalPostsObserved).toBe(2);

    const requestId = eval1.clarificationRequest!.id;

    // A) <48h: 0 reminders
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, new Date(Date.now() + 2 * 3600 * 1000));
    let [reqCheck] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(reqCheck.reminderCount).toBe(0);

    // B) +49h: Reminder #1
    const plus49h = new Date(new Date(reqCheck.createdAt).getTime() + 49 * 3600 * 1000);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, plus49h);
    [reqCheck] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(reqCheck.reminderCount).toBe(1);

    // C) +60h (<48h since Reminder #1): deduplicated, still 1
    const plus60h = new Date(new Date(reqCheck.createdAt).getTime() + 60 * 3600 * 1000);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, plus60h);
    [reqCheck] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(reqCheck.reminderCount).toBe(1);

    // D) +100h (>=48h since Reminder #1): Reminder #2
    const plus100h = new Date(new Date(reqCheck.createdAt).getTime() + 100 * 3600 * 1000);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, plus100h);
    [reqCheck] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(reqCheck.reminderCount).toBe(2);

    // E) +160h: bounded repeat policy caps at 2
    const plus160h = new Date(new Date(reqCheck.createdAt).getTime() + 160 * 3600 * 1000);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, plus160h);
    [reqCheck] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(reqCheck.reminderCount).toBe(2);

    // Submit a zero-customer baseline answer and verify it does NOT fabricate conversions=1 or leads=10
    const submitRes = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      clarificationRequestId: requestId,
      structuredAnswer: {
        operatingMonths: 2,
        hasHistoricalPaidCustomers: false,
        historicalPaidCustomersCount: 0,
        historicalLeadsCount: 0,
      },
    });

    const [answeredRow] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, requestId));
    expect(answeredRow.status).toBe("ANSWERED");
    expect(submitRes.clarificationRequest).toBeNull();
    expect(submitRes.dossier.manualTruthFact?.hasUserTruth).toBe(true);
    expect(submitRes.dossier.manualTruthFact?.historicalCustomerCount).toBe(0);
    expect(submitRes.dossier.manualTruthFact?.operatingHistoryMonths).toBe(2);
    expect(submitRes.executionState.mode).toBe("BUILD");

    // Verify 7-day weekly inventory submission updates commercial truth cleanly without double counting
    const invBefore = await getOrCreateWeeklyInventory(
      FIXTURE_ACCOUNT_ID,
      FIXTURE_CAMPAIGN_ID,
      new Date("2026-10-28T10:00:00.000Z")
    );
    expect(invBefore.planId).toBe(FIXTURE_PLAN_ID);
    expect(invBefore.status).toBe("WAITING_FOR_USER");
    expect(invBefore.isWindowInProgress).toBe(true);

    const invAfter = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: invBefore.inventoryId,
      nowOverride: new Date("2026-10-28T10:05:00.000Z"),
      metrics: {
        leads: 14,
        payingCustomers: 3,
        revenue: 450,
        spend: 90,
      },
    });
    expect(invAfter.saved).toBe(true);
    expect(invAfter.evaluationStatus).toBe("COMPLETED");
    expect(invAfter.windowCompletionSemantics).toBe("IN_PROGRESS_AS_OF");
    expect(invAfter.inventory.status).toBe("PARTIAL");

    const postInvEval = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    // Historical baseline customer count remains 0 (not overwritten by weekly window!)
    expect(postInvEval.dossier.manualTruthFact?.historicalPayingCustomersCount).toBe(0);
    // Weekly window conversions are 3
    expect(postInvEval.dossier.manualTruthFact?.weeklyWindow?.conversionsCount).toBe(3);
    expect(postInvEval.dossier.manualTruthFact?.weeklyWindow?.leadsCount).toBe(14);
    expect(postInvEval.dossier.manualTruthFact?.historicalCustomerCount).toBe(3);
    expect(postInvEval.dossier.manualTruthFact?.historicalLeadCount).toBe(14);
    expect(postInvEval.dossier.manualTruthFact?.salesRevenue).toBe(450);
    expect(postInvEval.dossier.manualTruthFact?.adSpend).toBe(90);
    expect(postInvEval.executionState.mode).toBe("OPTIMIZE");
  }, 120000);

  it("8. Validates baseline operating duration units, rejects contradictions, and preserves unknown counts for Yes-without-count", async () => {
    // Unit normalization
    const norm6m = validateAndNormalizeBaselineAnswer({
      operatingDurationMonths: "6months",
      hasHistoricalPayingCustomers: false,
    });
    expect(norm6m.normalizedStructured.operatingMonths).toBe(6);
    expect(norm6m.normalizedStructured.hasHistoricalPaidCustomers).toBe(false);
    expect(norm6m.normalizedStructured.historicalPaidCustomersCount).toBe(0);

    const normYears = validateAndNormalizeBaselineAnswer({
      operatingDurationMonths: "1.5 years",
      hasHistoricalPayingCustomers: true,
      historicalPayingCustomersCount: null,
      historicalLeadsCount: "",
    });
    expect(normYears.normalizedStructured.operatingMonths).toBe(18);
    expect(normYears.normalizedStructured.hasHistoricalPaidCustomers).toBe(true);
    // "Yes, had customers" with no count MUST remain null (unknown count), never an invented number
    expect(normYears.normalizedStructured.historicalPaidCustomersCount).toBeNull();
    expect(normYears.normalizedStructured.historicalLeadsCount).toBeNull();

    // Contradiction: "No customers" with positive customer count
    expect(() =>
      validateAndNormalizeBaselineAnswer({
        operatingDurationMonths: 6,
        hasHistoricalPayingCustomers: false,
        historicalPayingCustomersCount: 5,
      })
    ).toThrowError(BaselineValidationError);

    // Contradiction: "Yes, had customers" with 0 customer count
    expect(() =>
      validateAndNormalizeBaselineAnswer({
        operatingDurationMonths: 6,
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: 0,
      })
    ).toThrowError(BaselineValidationError);

    // Invalid non-numeric operating duration
    expect(() =>
      validateAndNormalizeBaselineAnswer({
        operatingDurationMonths: "six-ishxyz",
        hasHistoricalPayingCustomers: false,
      })
    ).toThrowError(BaselineValidationError);
  });

  it("9. Separates historical baseline figures from 7-day weekly window outcomes and updates weekly windows idempotently without duplication", async () => {
    // Clear previous truth and clarification rows on fixture
    await db.delete(schema.pipelineUserTruth).where(eq(schema.pipelineUserTruth.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.clarificationRequests).where(eq(schema.clarificationRequests.campaignId, FIXTURE_CAMPAIGN_ID));

    const evalInit = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    expect(evalInit.clarificationRequest).toBeDefined();
    const reqId = evalInit.clarificationRequest!.id;

    // 1. Submit baseline with "6months", Yes + 15 historical customers, 40 historical leads
    const baselineRes = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      clarificationRequestId: reqId,
      structuredAnswer: {
        operatingDurationMonths: "6months",
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: 15,
        historicalLeadsCount: 40,
      },
    });
    expect(baselineRes.saved).toBe(true);
    expect(baselineRes.evaluationStatus).toBe("COMPLETED");
    expect(baselineRes.dossier.manualTruthFact?.operatingHistoryMonths).toBe(6);
    expect(baselineRes.dossier.manualTruthFact?.historicalPayingCustomersCount).toBe(15);
    expect(baselineRes.dossier.manualTruthFact?.historicalLeadsCount).toBe(40);

    // 2. Submit 7-day window metrics with explicit zero adSpend (0), positive leads (3) & conversions (1), and null (unknown) revenue
    const inv = await getOrCreateWeeklyInventory(
      FIXTURE_ACCOUNT_ID,
      FIXTURE_CAMPAIGN_ID,
      new Date("2026-10-28T12:00:00.000Z")
    );
    const weekSub1 = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: inv.inventoryId,
      nowOverride: new Date("2026-10-28T12:00:00.000Z"),
      metrics: {
        leads: 3,
        payingCustomers: 1,
        revenue: null,
        adSpend: 0,
      },
    });
    expect(weekSub1.saved).toBe(true);
    expect(weekSub1.dossier?.manualTruthFact?.operatingHistoryMonths).toBe(6);
    expect(weekSub1.dossier?.manualTruthFact?.historicalPayingCustomersCount).toBe(15);
    expect(weekSub1.dossier?.manualTruthFact?.historicalLeadsCount).toBe(40);
    expect(weekSub1.dossier?.manualTruthFact?.weeklyWindow?.leadsCount).toBe(3);
    expect(weekSub1.dossier?.manualTruthFact?.weeklyWindow?.conversionsCount).toBe(1);
    expect(weekSub1.dossier?.manualTruthFact?.weeklyWindow?.revenueAmount).toBeNull();
    expect(weekSub1.dossier?.manualTruthFact?.weeklyWindow?.adSpendAmount).toBe(0);

    // 3. Submit a correction to the SAME 7-day window (leads=5, conversions=null unknown, revenue=250, adSpend=null unknown)
    const weekSub2 = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: inv.inventoryId,
      nowOverride: new Date("2026-10-28T14:00:00.000Z"),
      metrics: {
        leads: 5,
        payingCustomers: null,
        conversions: null,
        revenue: 250,
        spend: null,
        adSpend: null,
      },
    });
    expect(weekSub2.saved).toBe(true);
    // Verify only 1 pipeline_user_truth row exists for this windowId (updated in place, no duplicate rows)
    const windowTruthRows = await db
      .select()
      .from(schema.pipelineUserTruth)
      .where(
        and(
          eq(schema.pipelineUserTruth.campaignId, FIXTURE_CAMPAIGN_ID),
          eq(schema.pipelineUserTruth.windowId, inv.windowId!)
        )
      );
    expect(windowTruthRows.length).toBe(1);
    expect(windowTruthRows[0].totalLeads).toBe(5);
    expect(windowTruthRows[0].payingCustomers).toBeNull();
    const sub2Metrics = weekSub2.inventory.submittedMetrics as any;
    expect(sub2Metrics.leads).toBe(5);
    expect(sub2Metrics.payingCustomers).toBeNull();
    expect(sub2Metrics.revenue).toBe(250);
    expect(sub2Metrics.adSpend).toBeNull();

    // Historical baseline figures remain untouched (15 customers, 40 leads)
    expect(weekSub2.dossier?.manualTruthFact?.historicalPayingCustomersCount).toBe(15);
    expect(weekSub2.dossier?.manualTruthFact?.historicalLeadsCount).toBe(40);
  }, 120000);

  it("10. Separates in-window published posts from historical posts and handles in-progress vs completed 7-day window rollover once", async () => {
    // Insert a historical post published BEFORE the 7-day window (2026-09-15) with 5,000 views
    await db.insert(schema.ownedPosts).values({
      id: "test_li_post_historical",
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      ownedProfileId: "test_chan_li_unresolved",
      platform: "linkedin",
      postId: "urn:li:activity:6000",
      permalink: "https://www.linkedin.com/feed/update/urn:li:activity:6000",
      caption: "Historical post from September before the active window.",
      mediaType: "video",
      postedAt: new Date("2026-09-15T12:00:00Z"),
      firstSeenAt: new Date("2026-09-15T13:00:00Z"),
      lastSeenAt: new Date("2026-09-15T13:00:00Z"),
      lineageState: "unmatched",
    });
    await db.insert(schema.ownedPostSnapshots).values({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      ownedPostId: "test_li_post_historical",
      checkpoint: "discovery",
      observedAt: new Date("2026-09-15T14:00:00Z"),
      likes: 100,
      comments: 20,
      views: 5000,
      followersAtObservation: 400,
    });

    const invMidWeek = await getOrCreateWeeklyInventory(
      FIXTURE_ACCOUNT_ID,
      FIXTURE_CAMPAIGN_ID,
      new Date("2026-10-28T15:00:00.000Z")
    );
    expect(invMidWeek.windowIndex).toBe(0);
    expect(invMidWeek.isWindowInProgress).toBe(true);
    // 2 posts were published in [Oct 24, Oct 31], while 3 total posts (including Sept 15) are stored historically
    expect(invMidWeek.automaticMetrics.windowPostsPublished).toBe(2);
    expect(invMidWeek.automaticMetrics.storedHistoricalPostsCount).toBe(3);
    expect(invMidWeek.automaticMetrics.windowPublishedPostsViews).toBeNull(); // LinkedIn posts in window have views=null (not fabricated as 0)
    expect(invMidWeek.automaticMetrics.cumulativeHistoricalViews).toBe(5000);
    expect(invMidWeek.automaticMetrics.windowPublishedPostsEngagement).toBe(57);
    expect(invMidWeek.automaticMetrics.cumulativeHistoricalEngagement).toBe(177);

    // Finalize window #0 after periodEnd (2026-10-31T10:00:00Z)
    const afterPeriodEnd = new Date("2026-10-31T11:00:00.000Z");
    const completedRes = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: invMidWeek.inventoryId,
      nowOverride: afterPeriodEnd,
      metrics: {
        leads: 6,
        payingCustomers: 2,
        revenue: 300,
        adSpend: 50,
      },
    });
    expect(completedRes.windowCompletionSemantics).toBe("COMPLETED");
    expect(completedRes.inventory.status).toBe("COMPLETED");

    // Verify eval window #0 is now closed
    const [win0] = await db
      .select()
      .from(schema.pipelineEvalWindows)
      .where(eq(schema.pipelineEvalWindows.id, invMidWeek.windowId!));
    expect(win0.state).toBe("closed");

    // Next call after periodEnd rolls over to window #1 (Oct 31 -> Nov 7) once
    const invNext1 = await getOrCreateWeeklyInventory(
      FIXTURE_ACCOUNT_ID,
      FIXTURE_CAMPAIGN_ID,
      new Date("2026-10-31T12:00:00.000Z")
    );
    expect(invNext1.windowIndex).toBe(1);
    expect(invNext1.status).toBe("WAITING_FOR_USER");

    const invNext2 = await getOrCreateWeeklyInventory(
      FIXTURE_ACCOUNT_ID,
      FIXTURE_CAMPAIGN_ID,
      new Date("2026-11-01T12:00:00.000Z")
    );
    expect(invNext2.inventoryId).toBe(invNext1.inventoryId);
    expect(invNext2.windowIndex).toBe(1);
  }, 120000);

  it("11. Preserves saved answers when downstream evaluation fails and succeeds on retry without duplicating records or mutating active strategy", async () => {
    // Create a fresh pending clarification request to test downstream failure recovery
    await db.delete(schema.pipelineUserTruth).where(eq(schema.pipelineUserTruth.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.clarificationRequests).where(eq(schema.clarificationRequests.campaignId, FIXTURE_CAMPAIGN_ID));

    const evalPending = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    const reqId = evalPending.clarificationRequest!.id;

    // Simulate downstream failure after save
    const deferredClarify = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      clarificationRequestId: reqId,
      simulateDownstreamFailure: true,
      structuredAnswer: {
        operatingDurationMonths: 8,
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: null, // unknown count
        historicalLeadsCount: 25,
      },
    });
    expect(deferredClarify.saved).toBe(true);
    expect(deferredClarify.evaluationStatus).toBe("DEFERRED_ERROR");
    expect(deferredClarify.evaluationError).toContain("Simulated downstream Performance evaluation failure");

    // Verify the answer WAS persisted in DB and reminder was cleared
    const [savedReq] = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.id, reqId));
    expect(savedReq.status).toBe("ANSWERED");
    expect(savedReq.nextReminderAt).toBeNull();

    // Retry the same clarification submission without failure
    const retryClarify = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      clarificationRequestId: reqId,
      structuredAnswer: {
        operatingDurationMonths: 8,
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: null,
        historicalLeadsCount: 25,
      },
    });
    expect(retryClarify.saved).toBe(true);
    expect(retryClarify.evaluationStatus).toBe("COMPLETED");
    expect(retryClarify.dossier?.manualTruthFact?.operatingHistoryMonths).toBe(8);
    expect(retryClarify.dossier?.manualTruthFact?.hasHistoricalPaidCustomers).toBe(true);
    expect(retryClarify.dossier?.manualTruthFact?.historicalPayingCustomersCount).toBeNull();
    expect(retryClarify.dossier?.manualTruthFact?.historicalLeadsCount).toBe(25);

    // Ensure no duplicate clarification_requests rows were created on retry
    const allClarRows = await db
      .select()
      .from(schema.clarificationRequests)
      .where(eq(schema.clarificationRequests.campaignId, FIXTURE_CAMPAIGN_ID));
    expect(allClarRows.length).toBe(1);
    expect(allClarRows[0].status).toBe("ANSWERED");

    // Verify active strategy plan remained untouched
    const [planAfter] = await db
      .select()
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.id, FIXTURE_PLAN_ID));
    expect(planAfter.status).toBe("APPROVED");
    expect(planAfter.version).toBe(1);
  }, 120000);

  it("6. Enforces scheduler terminal-outcome handoff (defers while RUNNING/QUEUED and rejects FAILED jobs)", async () => {
    const runningJobId = "test_fetch_job_running";
    await db.insert(schema.miFetchJobs).values({
      id: runningJobId,
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      competitorHash: "hash_test",
      status: "RUNNING",
      stageStatuses: "{}",
      fetchLimitReasons: "[]",
      totalPostsFetched: 0,
      totalCommentsFetched: 0,
      competitorCount: 1,
    });

    const deferredRes = await runScheduledCampaignDownstreamHandoff(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, {
      skipBoss: true,
    });
    expect(deferredRes.deferredUntilTerminal).toBe(true);
    expect(deferredRes.executionStateId).toBeNull();

    await db
      .update(schema.miFetchJobs)
      .set({ status: "FAILED", completedAt: new Date(), error: "Transport error" })
      .where(eq(schema.miFetchJobs.id, runningJobId));

    const failedOutcome = await waitForFetchJobTerminalOutcome(runningJobId, FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, {
      timeoutMs: 1000,
      pollIntervalMs: 50,
    });
    expect(failedOutcome.terminal).toBe(true);
    expect(failedOutcome.status).toBe("FAILED");

    const failedHandoff = await runScheduledCampaignDownstreamHandoff(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, {
      jobId: runningJobId,
      skipBoss: true,
    });
    expect(failedHandoff.deferredUntilTerminal).toBe(true);
    expect(failedHandoff.executionStateId).toBeNull();

    await db
      .update(schema.miFetchJobs)
      .set({ status: "COMPLETE", completedAt: new Date(), error: null })
      .where(eq(schema.miFetchJobs.id, runningJobId));

    const completeHandoff = await runScheduledCampaignDownstreamHandoff(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID, {
      jobId: runningJobId,
      skipBoss: true,
    });
    expect(completeHandoff.deferredUntilTerminal).toBe(false);
    expect(completeHandoff.terminalJobStatus).toBe("COMPLETE");
    expect(completeHandoff.executionStateId).toBeTruthy();
  }, 120000);

  it("12. Verifies full lifecycle UX state machine (pending baseline -> submit -> edit, open weekly -> partial save -> period end due + reminder timing from periodEnd -> final submit -> history edit & scheduler idempotency)", async () => {
    clearAllCampaignClockOverrides();
    await db.delete(schema.notifications).where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.pipelineUserTruth).where(eq(schema.pipelineUserTruth.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.weeklyBusinessInventories).where(eq(schema.weeklyBusinessInventories.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.clarificationRequests).where(eq(schema.clarificationRequests.campaignId, FIXTURE_CAMPAIGN_ID));
    await db.delete(schema.pipelineEvalWindows).where(eq(schema.pipelineEvalWindows.campaignId, FIXTURE_CAMPAIGN_ID));

    // Step A: Controlled clock at Day 2 of Window #0 (2026-10-26T10:00:00Z; Window #0 is 2026-10-24T10:00:00Z -> 2026-10-31T10:00:00Z)
    const tDay2 = new Date("2026-10-26T10:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tDay2);

    const evalInitial = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    expect(evalInitial.clarificationRequest).toBeDefined();
    expect(evalInitial.clarificationRequest?.status).toBe("PENDING");
    const baselineId = evalInitial.clarificationRequest!.id;

    // Open weekly period before periodEnd -> no automatic due state and NO premature WEEKLY_INVENTORY_DUE notification
    const invOpen = await getOrCreateWeeklyInventory(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(invOpen.windowIndex).toBe(0);
    expect(invOpen.isWindowInProgress).toBe(true);
    expect(invOpen.isDue).toBe(false);
    expect(invOpen.lifecycleState).toBe("OPEN_IN_PROGRESS");

    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    const notifsAtOpen = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
    // Baseline notification exists, but NO weekly inventory due notification exists while period is open
    expect(notifsAtOpen.some((n) => n.type === "PERFORMANCE_CLARIFICATION_REQUIRED" && !n.isRead)).toBe(true);
    expect(notifsAtOpen.some((n) => n.type === "WEEKLY_INVENTORY_DUE")).toBe(false);

    // Step B: Submit pending baseline -> disappears from pending, notification marked read, stays hidden on subsequent evaluations
    const baselineSaved = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      clarificationRequestId: baselineId,
      structuredAnswer: {
        operatingDurationMonths: 12,
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: 20,
        historicalLeadsCount: 80,
      },
    });
    expect(baselineSaved.saved).toBe(true);
    expect(baselineSaved.clarificationRequest).toBeNull();

    const notifsAfterBaseline = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
    expect(
      notifsAfterBaseline.filter(
        (n) => n.type === "PERFORMANCE_CLARIFICATION_REQUIRED" && !n.isRead
      ).length
    ).toBe(0);

    // Subsequent evaluation must NOT reopen or recreate baseline request
    const evalAfterBaseline = await evaluateAndPersistBusinessExecutionState({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
    });
    expect(evalAfterBaseline.clarificationRequest).toBeNull();

    // Step C: Explicitly edit saved baseline -> updates structured answer & _editedAt, keeps status ANSWERED
    const tDay2Edit = new Date("2026-10-26T14:30:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tDay2Edit);
    const baselineEdited = await submitClarificationAnswer({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      clarificationRequestId: baselineId,
      structuredAnswer: {
        operatingDurationMonths: 14,
        hasHistoricalPayingCustomers: true,
        historicalPayingCustomersCount: 24,
        historicalLeadsCount: 95,
      },
    });
    expect(baselineEdited.saved).toBe(true);
    expect(baselineEdited.answeredClarification.status).toBe("ANSWERED");
    expect((baselineEdited.answeredClarification.structuredAnswer as any).operatingDurationMonths).toBe(14);
    expect((baselineEdited.answeredClarification.structuredAnswer as any).historicalPayingCustomersCount).toBe(24);
    expect((baselineEdited.answeredClarification.structuredAnswer as any)._editedAt).toBe(tDay2Edit.toISOString());

    // Step D: Optional mid-week partial update -> saves PARTIAL, sets lastUpdatedThrough, keeps final check-in scheduled for periodEnd
    const tMidWeek = new Date("2026-10-28T16:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tMidWeek);
    const partialRes = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: invOpen.inventoryId,
      metrics: {
        leads: 9,
        conversions: 2,
        revenue: 360,
        adSpend: 45,
        notes: "Mid-week progress snapshot",
      },
    });
    expect(partialRes.saved).toBe(true);
    expect(partialRes.windowCompletionSemantics).toBe("IN_PROGRESS_AS_OF");
    expect(partialRes.inventory.status).toBe("PARTIAL");

    const invAfterPartial = await getOrCreateWeeklyInventory(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(invAfterPartial.inventoryId).toBe(invOpen.inventoryId);
    expect(invAfterPartial.status).toBe("PARTIAL");
    expect(invAfterPartial.isWindowInProgress).toBe(true);
    expect(invAfterPartial.isDue).toBe(false);
    expect(invAfterPartial.lifecycleState).toBe("PARTIAL_SAVED_IN_PROGRESS");
    expect(invAfterPartial.lastUpdatedThrough).toBe(tMidWeek.toISOString());
    expect(invAfterPartial.nextCheckInDueAt).toBe("2026-10-31T10:00:00.000Z");

    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    const notifsMidWeek = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
    expect(notifsMidWeek.some((n) => n.type === "WEEKLY_INVENTORY_DUE")).toBe(false);

    // Step E: Period ends (2026-10-31T10:05:00Z >= periodEnd) -> Partial save does NOT cancel end-of-period check-in!
    // One due card and one WEEKLY_INVENTORY_DUE notification appear; reminder timer starts from periodEnd (not createdAt)
    const tPeriodEnded = new Date("2026-10-31T10:05:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tPeriodEnded);

    const invDue = await getOrCreateWeeklyInventory(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(invDue.inventoryId).toBe(invOpen.inventoryId);
    expect(invDue.windowIndex).toBe(0);
    expect(invDue.isWindowInProgress).toBe(false);
    expect(invDue.isDue).toBe(true);
    expect(invDue.lifecycleState).toBe("DUE_AWAITING_FINAL");

    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    const notifsAtDue = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID),
          eq(schema.notifications.type, "WEEKLY_INVENTORY_DUE")
        )
      );
    expect(notifsAtDue.length).toBe(1);
    expect(notifsAtDue[0].isRead).toBe(false);

    // Verify reminder timing starts from periodEnd (2026-10-31T10:00:00Z), NOT inventory createdAt:
    // At +24h after periodEnd (2026-11-01T10:00:00Z, which is >7 days after row creation), still 0 reminders!
    const tPlus24hAfterDue = new Date("2026-11-01T10:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tPlus24hAfterDue);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    let [invReminderRow] = await db
      .select()
      .from(schema.weeklyBusinessInventories)
      .where(eq(schema.weeklyBusinessInventories.id, invOpen.inventoryId));
    expect(invReminderRow.reminderCount).toBe(0);

    // At +49h after periodEnd (2026-11-02T11:00:00Z) -> Reminder #1
    const tPlus49hAfterDue = new Date("2026-11-02T11:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tPlus49hAfterDue);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    [invReminderRow] = await db
      .select()
      .from(schema.weeklyBusinessInventories)
      .where(eq(schema.weeklyBusinessInventories.id, invOpen.inventoryId));
    expect(invReminderRow.reminderCount).toBe(1);

    // At +98h after periodEnd (2026-11-04T12:00:00Z) -> Reminder #2 (max 2)
    const tPlus98hAfterDue = new Date("2026-11-04T12:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tPlus98hAfterDue);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    [invReminderRow] = await db
      .select()
      .from(schema.weeklyBusinessInventories)
      .where(eq(schema.weeklyBusinessInventories.id, invOpen.inventoryId));
    expect(invReminderRow.reminderCount).toBe(2);

    // At +150h after periodEnd -> still capped at 2
    const tPlus150hAfterDue = new Date("2026-11-06T16:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tPlus150hAfterDue);
    await syncNotificationsForCampaign(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    [invReminderRow] = await db
      .select()
      .from(schema.weeklyBusinessInventories)
      .where(eq(schema.weeklyBusinessInventories.id, invOpen.inventoryId));
    expect(invReminderRow.reminderCount).toBe(2);

    // Step F: Final submission for Window #0 (at 2026-11-01T12:00:00Z, during Window #1 [Oct 31 -> Nov 7])
    const tFinalSubmit = new Date("2026-11-01T12:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tFinalSubmit);
    const finalSubRes = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: invOpen.inventoryId,
      metrics: {
        leads: 18,
        conversions: 5,
        revenue: 900,
        adSpend: 110,
        notes: "Final Window #0 numbers",
      },
    });
    expect(finalSubRes.saved).toBe(true);
    expect(finalSubRes.windowCompletionSemantics).toBe("COMPLETED");
    expect(finalSubRes.inventory.status).toBe("COMPLETED");

    // Due notification and reminders for Window #0 are resolved (marked read)
    const window0Notifs = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.campaignId, FIXTURE_CAMPAIGN_ID));
    expect(window0Notifs.filter((n) => !n.isRead).length).toBe(0);

    // Next reporting period (Window #1: Oct 31 -> Nov 7) is now scheduled and open (not due)
    const invNextWindow = await getOrCreateWeeklyInventory(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(invNextWindow.windowIndex).toBe(1);
    expect(invNextWindow.status).toBe("WAITING_FOR_USER");
    expect(invNextWindow.isWindowInProgress).toBe(true);
    expect(invNextWindow.isDue).toBe(false);
    expect(invNextWindow.nextCheckInDueAt).toBe("2026-11-07T10:00:00.000Z");

    // Step G: Completed Window #0 is in History and can be edited without reopening it as due
    const tEditHistory = new Date("2026-11-02T09:00:00.000Z");
    setCampaignClockOverride(FIXTURE_CAMPAIGN_ID, tEditHistory);
    const historyEditRes = await submitWeeklyInventoryMetrics({
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      inventoryId: invOpen.inventoryId,
      metrics: {
        leads: 21,
        conversions: 6,
        revenue: 1080,
        adSpend: 110,
        notes: "Audited final Window #0 numbers",
      },
    });
    expect(historyEditRes.saved).toBe(true);
    expect(historyEditRes.isEditedHistory).toBe(true);
    expect(historyEditRes.inventory.status).toBe("COMPLETED");
    const formattedHistory = formatWeeklyInventoryHistoryRow(historyEditRes.inventory, "UTC");
    expect(formattedHistory.userMetrics.leads).toBe(21);
    expect(formattedHistory.userMetrics.conversions).toBe(6);
    expect(formattedHistory.userMetrics.revenue).toBe(1080);
    expect(formattedHistory.editedAt).toBe(tEditHistory.toISOString());

    // Active weekly inventory is STILL Window #1 (not reopened to Window #0)
    const activeAfterHistoryEdit = await getOrCreateWeeklyInventory(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(activeAfterHistoryEdit.windowIndex).toBe(1);
    expect(activeAfterHistoryEdit.isDue).toBe(false);

    // Step H: Repeated scheduler cycles do not duplicate requests or notifications
    await runScheduledPerformanceAndReminderCheck(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    await runScheduledPerformanceAndReminderCheck(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    const schedHealth = await getUnifiedScheduleHealth(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(schedHealth.baselineClarification.status).toBe("COMPLETED_ONE_TIME");
    expect(schedHealth.weeklyPeriodMetrics.status).toBe("IN_PROGRESS_SCHEDULED");
    expect(schedHealth.weeklyPeriodMetrics.isDue).toBe(false);
    expect(schedHealth.unansweredReminderPolicy.status).toBe("IDLE_ALL_ANSWERED");

    clearAllCampaignClockOverrides();
  }, 120000);

  it("13. Protects live Songai campaign from clock overrides, fabrications, or strategy mutations and reconciles premature open-period notifications", async () => {
    const songaiCampaignId = "camp_ac86e8b8-55b";

    // Clock override on live Songai must be rejected
    expect(() => setCampaignClockOverride(songaiCampaignId, new Date())).toThrowError(
      /Controlled clock override is prohibited on live campaign/
    );

    const [songaiPlanBefore] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.campaignId, songaiCampaignId),
          eq(schema.strategicPlans.status, "APPROVED")
        )
      );

    if (songaiPlanBefore) {
      const [songaiBaselineBefore] = await db
        .select()
        .from(schema.clarificationRequests)
        .where(eq(schema.clarificationRequests.campaignId, songaiCampaignId));

      const [songaiInvBefore] = await db
        .select()
        .from(schema.weeklyBusinessInventories)
        .where(eq(schema.weeklyBusinessInventories.campaignId, songaiCampaignId));

      // Reconcile notifications via normal application logic
      await syncNotificationsForCampaign(songaiPlanBefore.accountId, songaiCampaignId);

      // Verify Songai's open weekly inventory (ending 2026-10-31) has NO premature WEEKLY_INVENTORY_DUE notification
      const songaiWeeklyNotifs = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.campaignId, songaiCampaignId),
            eq(schema.notifications.type, "WEEKLY_INVENTORY_DUE")
          )
        );
      expect(songaiWeeklyNotifs.length).toBe(0);

      // Verify Songai's baseline request, reporting dates, and approved strategy were NOT fabricated or altered
      const [songaiPlanAfter] = await db
        .select()
        .from(schema.strategicPlans)
        .where(eq(schema.strategicPlans.id, songaiPlanBefore.id));
      expect(songaiPlanAfter.version).toBe(songaiPlanBefore.version);
      expect(songaiPlanAfter.status).toBe("APPROVED");

      if (songaiBaselineBefore) {
        const [songaiBaselineAfter] = await db
          .select()
          .from(schema.clarificationRequests)
          .where(eq(schema.clarificationRequests.id, songaiBaselineBefore.id));
        expect(songaiBaselineAfter.status).toBe(songaiBaselineBefore.status);
        expect(songaiBaselineAfter.userAnswer).toBe(songaiBaselineBefore.userAnswer);
      }

      if (songaiInvBefore) {
        const [songaiInvAfter] = await db
          .select()
          .from(schema.weeklyBusinessInventories)
          .where(eq(schema.weeklyBusinessInventories.id, songaiInvBefore.id));
        expect(new Date(songaiInvAfter.periodStart).toISOString()).toBe(
          new Date(songaiInvBefore.periodStart).toISOString()
        );
        expect(new Date(songaiInvAfter.periodEnd).toISOString()).toBe(
          new Date(songaiInvBefore.periodEnd).toISOString()
        );
      }
    }
  });
});
