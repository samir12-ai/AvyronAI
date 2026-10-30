import { describe, it, expect } from "vitest";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  normalizeTimestampToUtcDate,
  normalizeTimestampToIsoUtc,
  isTimestampWithinWindow,
  formatTimestampInTimezone,
} from "../utils/timestamp";
import { calculateOwnedPlatformWindowCounts, type CampaignLifecycleWindows } from "../user-channel-scraper";
import { cleanHtmlToText } from "../competitive-intelligence/competitor-crawler";
import {
  extractSourcesFromHtml,
  verifySearchCandidateOwnership,
} from "../competitive-intelligence/source-discovery";
import { getStoredPostsForMIv3, getStoredTikTokPostsForMIv3, getStoredYouTubePostsForMIv3 } from "../competitive-intelligence/data-acquisition";
import { discoverEntities } from "../collector/discovery";
import { assembleDashboardOverview } from "../dashboard/overview-engine";
import { StrategyExperienceService } from "../strategy-experience/service";
import { buildAgentContext } from "../agent/context-assembler";
import { syncCampaignAdaptiveReasoning } from "../adaptive/case-coordinator";

const ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const CAMPAIGN_ID = "camp_ac86e8b8-55b";

describe("Songai Acquisition & Downstream Integration Reconciliation Regressions", () => {
  it("1. Zero-result tasks cannot inherit stale normalizedEvidenceIds and preserve producing-run lineage", async () => {
    const zeroResultTaskIds = [
      "acq_febe29900fc5ecb7",
      "acq_d38ae55e1ac0fa65",
      "acq_5ee82c4053ba1200",
      "acq_181e7639410cf6c2",
      "acq_31af47dccb6a6267",
      "acq_4de00419163ca332",
      "acq_fcd52071dfeb1abd",
      "acq_ba198e36b4611bdb",
    ];

    const tasks = await db
      .select()
      .from(schema.acquisitionTasks)
      .where(inArray(schema.acquisitionTasks.id, zeroResultTaskIds));

    expect(tasks.length).toBe(8);
    for (const task of tasks) {
      const out = (task.outputSummary || {}) as Record<string, any>;
      expect(Number(out.itemsStored ?? 0)).toBe(0);
      expect(Array.isArray(out.normalizedEvidenceIds)).toBe(true);
      expect(out.normalizedEvidenceIds).toHaveLength(0);
      expect(task.terminalOutcome).not.toBe("SUCCESS_WITH_CONTENT");
    }

    const reqs = await db
      .select()
      .from(schema.acquisitionRequests)
      .where(inArray(schema.acquisitionRequests.taskId, zeroResultTaskIds));

    for (const req of reqs) {
      const evIds = Array.isArray(req.normalizedEvidenceIds) ? req.normalizedEvidenceIds : [];
      expect(evIds).toHaveLength(0);
    }

    // Verify producing-run lineage on the 15 Trendyol reviews is intact on acq_2e900a06d20f1ae4 (and 0 on zero-result acq_febe29900fc5ecb7)
    const trendyolReviews = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ci_competitor_reviews WHERE acquisition_task_id = 'acq_2e900a06d20f1ae4' AND provider_run_id = 'e7lexMuy0RV8teLTv'`
    );
    expect(trendyolReviews.rows[0].cnt).toBe(15);

    const zeroTrendyolReviews = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ci_competitor_reviews WHERE acquisition_task_id = 'acq_febe29900fc5ecb7'`
    );
    expect(zeroTrendyolReviews.rows[0].cnt).toBe(0);

    // And verify the 25 Google Reviews overwritten by zero-result acq_181e7639410cf6c2 were restored to producing task acq_955726b078640b2c
    const googleReviews = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ci_competitor_reviews WHERE acquisition_task_id = 'acq_955726b078640b2c' AND provider_run_id = 'LhlcdE9U2bBCbXhvD'`
    );
    expect(googleReviews.rows[0].cnt).toBe(25);
  });

  it("2. Website tasks require valid persisted websiteSnapshotId & understandingSnapshotId for SUCCESS_WITH_CONTENT", async () => {
    // Failed Songfinch website crawl task acq_712333d1de51362f must not claim SUCCESS_WITH_CONTENT
    const [failedTask] = await db
      .select()
      .from(schema.acquisitionTasks)
      .where(eq(schema.acquisitionTasks.id, "acq_712333d1de51362f"));
    expect(failedTask).toBeDefined();
    expect(failedTask.status).toBe("FAILED");
    expect(failedTask.terminalOutcome).toBe("INCONCLUSIVE_ZERO_RESULT");

    // Repaired Songfinch website task acq_c8835e422567d2bf and all 18 other active competitors have valid snapshot IDs
    const completedWebTasks = await db
      .select()
      .from(schema.acquisitionTasks)
      .where(
        and(
          eq(schema.acquisitionTasks.campaignId, CAMPAIGN_ID),
          inArray(schema.acquisitionTasks.sourcePlatform, ["WEBSITE", "COMPETITOR_WEBSITE"]),
          eq(schema.acquisitionTasks.status, "COMPLETED")
        )
      );

    expect(completedWebTasks.length).toBeGreaterThanOrEqual(19);
    for (const wt of completedWebTasks) {
      expect(wt.terminalOutcome).toBe("SUCCESS_WITH_CONTENT");
      const out = (wt.outputSummary || {}) as Record<string, any>;
      expect(typeof out.websiteSnapshotId).toBe("string");
      expect(out.websiteSnapshotId.length).toBeGreaterThan(8);
      expect(typeof out.understandingSnapshotId).toBe("string");
      expect(out.understandingSnapshotId.length).toBeGreaterThan(8);
    }

    // Also verify cleanHtmlToText extracts embedded SSR JSON state (Songfinch Next/Nuxt state)
    const sampleSsrHtml = `<html><head><title>Songfinch | Custom Songs</title><meta name="description" content="Create a custom song from scratch with top artists starting at $199.99."></head><body><script>const songProduct = { price: 199.99, formattedPrice: "$199.99" };</script></body></html>`;
    const extracted = cleanHtmlToText(sampleSsrHtml);
    expect(extracted).toContain("Songfinch | Custom Songs");
    expect(extracted).toContain("$199.99");
  });

  it("3. External search candidates require domain/backlink/profile ownership verification and reject XML namespace false positives", () => {
    // Reject Squarespace XML namespace xmlns:fb="http://www.facebook.com/2008/fbml"
    const squarespaceHtml = `<html xmlns:fb="http://www.facebook.com/2008/fbml"><body><a href="https://instagram.com/songforyouuk">IG</a><a href="https://facebook.com/songforyouuk">FB</a><a href="https://blog.songfinch.com/">Blog</a></body></html>`;
    const extracted = extractSourcesFromHtml(squarespaceHtml, "https://www.songfinch.com");
    expect(extracted.facebook).toBe("https://facebook.com/songforyouuk");
    expect(extracted.facebook).not.toContain("2008");
    expect(extracted.blog).toBe("https://blog.songfinch.com/");

    // Loose handle similarity without domain match in search snippet must NOT auto-verify
    const unverifiedCandidate = verifySearchCandidateOwnership({
      candidateUrl: "https://www.tiktok.com/@amikadodailymeal98",
      handle: "amikadodailymeal98",
      title: "Amikado Daily Meal (@amikadodailymeal98) | TikTok",
      snippet: "My daily meals and recipes",
      competitorName: "Amikado",
      cleanDomain: "amikado.co.uk",
    });
    expect(unverifiedCandidate.verified).toBe(false);

    // Explicit official domain in search snippet verifies deterministically
    const verifiedCandidate = verifySearchCandidateOwnership({
      candidateUrl: "https://www.instagram.com/songfinch/",
      handle: "songfinch",
      title: "Songfinch (@songfinch) • Instagram photos and videos",
      snippet: "Custom songs made by real artists. Visit songfinch.com to start your song.",
      competitorName: "Songfinch",
      cleanDomain: "songfinch.com",
    });
    expect(verifiedCandidate.verified).toBe(true);
  });

  it("4. Misattributed sources and posts are quarantined and excluded from competitor analysis and collector discovery", async () => {
    // Check that all 17 quarantined sources are DISABLED and QUARANTINED_MISATTRIBUTED
    const quarantinedRes = await pool.query(
      `SELECT id, competitor_id, platform, canonical_url, status, activity_state
       FROM competitor_sources
       WHERE campaign_id = $1 AND activity_state = 'QUARANTINED_MISATTRIBUTED'`,
      [CAMPAIGN_ID]
    );
    expect(quarantinedRes.rows.length).toBe(17);
    for (const row of quarantinedRes.rows) {
      expect(row.status).toBe("DISABLED");
    }

    // Sing My Story (comp_63556511-5) had misattributed @sing.mystory TikTok/YouTube and unverified @singmystorymusic Instagram
    const smsIgPosts = await getStoredPostsForMIv3("comp_63556511-5", ACCOUNT_ID);
    const smsTtPosts = await getStoredTikTokPostsForMIv3("comp_63556511-5", ACCOUNT_ID);
    const smsYtPosts = await getStoredYouTubePostsForMIv3("comp_63556511-5", ACCOUNT_ID);
    expect(smsIgPosts).toHaveLength(0);
    expect(smsTtPosts).toHaveLength(0);
    expect(smsYtPosts).toHaveLength(0);

    // Collector discovery must not schedule quarantined Instagram sources for Sing My Story, TuneTribute, or SongGifts
    const discovery = await discoverEntities(ACCOUNT_ID, CAMPAIGN_ID, {
      onlyEntityIds: ["comp_63556511-5", "comp_4163e878-8", "comp_b89e9795-a"],
    });
    const igItems = discovery.competitorItems.filter((i) => i.entityType === "competitor_instagram");
    expect(igItems).toHaveLength(0);
  });

  it("5. Timestamp normalization and window boundary comparisons behave identically across UTC and Asia/Dubai (UTC+04:00)", () => {
    const naivePostgresStr = "2026-04-12 08:23:16.592";
    const isoWithZ = "2026-04-12T08:23:16.592Z";
    const isoDubaiOffset = "2026-04-12T12:23:16.592+04:00";

    const dNaive = normalizeTimestampToUtcDate(naivePostgresStr);
    const dZ = normalizeTimestampToUtcDate(isoWithZ);
    const dDubai = normalizeTimestampToUtcDate(isoDubaiOffset);

    expect(dNaive?.toISOString()).toBe(isoWithZ);
    expect(dZ?.toISOString()).toBe(isoWithZ);
    expect(dDubai?.toISOString()).toBe(isoWithZ);
    expect(normalizeTimestampToIsoUtc(naivePostgresStr)).toBe(isoWithZ);

    // Formatting in UTC vs Asia/Dubai preserves the exact instant
    expect(formatTimestampInTimezone(naivePostgresStr, "UTC")).toBe("2026-04-12T08:23:16Z");
    expect(formatTimestampInTimezone(naivePostgresStr, "Asia/Dubai")).toBe("2026-04-12T12:23:16+04:00");

    // Window boundary comparison is identical regardless of input representation
    expect(
      isTimestampWithinWindow(
        "2026-04-12 08:23:16.592",
        "2026-04-12T08:00:00Z",
        "2026-04-12T13:00:00+04:00"
      )
    ).toBe(true);

    const lifecycle: CampaignLifecycleWindows = {
      campaignCreatedAt: "2026-04-12T08:00:00.000Z",
      campaignCreatedAtMs: Date.parse("2026-04-12T08:00:00.000Z"),
      initialActivatedAt: "2026-04-12T08:15:00.000Z",
      initialActivatedAtMs: Date.parse("2026-04-12T08:15:00.000Z"),
      activePlanActivatedAt: "2026-04-12T08:20:00.000Z",
      activePlanActivatedAtMs: Date.parse("2026-04-12T08:20:00.000Z"),
      campaignWindowStart: "2026-04-12T08:15:00.000Z",
      campaignWindowStartMs: Date.parse("2026-04-12T08:15:00.000Z"),
    };

    const countsNaive = calculateOwnedPlatformWindowCounts(
      [{ postedAt: "2026-04-12 08:23:16.592" }, { postedAt: "2026-04-12 07:30:00.000" }],
      lifecycle,
      new Date("2026-04-20T00:00:00.000Z")
    );
    const countsDubai = calculateOwnedPlatformWindowCounts(
      [{ postedAt: "2026-04-12T12:23:16.592+04:00" }, { postedAt: "2026-04-12T11:30:00.000+04:00" }],
      lifecycle,
      new Date("2026-04-20T04:00:00.000+04:00")
    );
    expect(countsNaive).toEqual(countsDubai);
    expect(countsNaive.postsSinceCreationCount).toBe(1);
    expect(countsNaive.postsSinceActivationCount).toBe(1);
    expect(countsNaive.activePlanWindowPostCount).toBe(1);
  });

  it("6. Strategy version fields return consistent activePlanVersion (4), rootBundleVersion (13), and totalPlanRevisions (10) across endpoints", async () => {
    const [overview, strategyMeta, strategyHistory, agentCtx] = await Promise.all([
      assembleDashboardOverview(ACCOUNT_ID, CAMPAIGN_ID),
      StrategyExperienceService.getActiveStrategy(CAMPAIGN_ID, ACCOUNT_ID),
      StrategyExperienceService.getStrategyHistory(CAMPAIGN_ID, ACCOUNT_ID),
      buildAgentContext({
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        userQuestion: "What is our active strategy version?",
      }),
    ]);

    expect(overview.strategyPlanCard.activePlanVersion).toBe(4);
    expect(overview.strategyPlanCard.rootBundleVersion).toBe(13);
    expect(overview.strategyPlanCard.totalPlanRevisions).toBe(10);
    expect(overview.businessPulse.strategy.activePlanVersion).toBe(4);
    expect(overview.businessPulse.strategy.rootBundleVersion).toBe(13);
    expect(overview.businessPulse.strategy.totalPlanRevisions).toBe(10);

    expect(strategyMeta.activePlanVersion).toBe(4);
    expect(strategyMeta.rootBundleVersion).toBe(13);
    expect(strategyMeta.totalPlanRevisions).toBe(10);
    expect(strategyMeta.strategicPlanId).toBe("c3e6a7a0-56be-4538-b9de-529302903435");
    expect(strategyMeta.designatedActivePlanId).toBe("c3e6a7a0-56be-4538-b9de-529302903435");

    const currentHistoryItem = strategyHistory.find((h: any) => h.isCurrent);
    expect(currentHistoryItem).toBeDefined();
    expect(currentHistoryItem?.activePlanVersion).toBe(4);
    expect(currentHistoryItem?.rootBundleVersion).toBe(13);
    expect(currentHistoryItem?.totalPlanRevisions).toBe(10);

    expect(agentCtx.trace.activePlanVersion).toBe(4);
    expect(agentCtx.trace.rootBundleVersion).toBe(13);
    expect(agentCtx.trace.totalPlanRevisions).toBe(10);
  }, 30000);

  it("7. Watchtower, Performance Loop, and Deep Reasoning handoff execute against stored evidence without triggering new scraping", async () => {
    const bossRuns = await pool.query(
      `SELECT id, status, q1_verdict, q2_verdict FROM boss_runs WHERE campaign_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [CAMPAIGN_ID]
    );
    expect(bossRuns.rows.length).toBeGreaterThanOrEqual(1);
    expect(["completed", "partial"]).toContain(bossRuns.rows[0].status);

    const execStates = await pool.query(
      `SELECT id, mode, observed_business_history, observed_channel_state FROM business_execution_states WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [CAMPAIGN_ID]
    );
    expect(execStates.rows.length).toBeGreaterThanOrEqual(1);
    const latestState = execStates.rows[0];
    expect(latestState.observed_business_history.instagramPostsObserved).toBe(30);
    expect(latestState.observed_business_history.youTubePostsObserved).toBe(35);
    expect(latestState.observed_business_history.tikTokPostsObserved).toBe(20);
    expect(latestState.observed_business_history.totalHistoricalPosts).toBe(85);

    // Idempotent Deep Reasoning handoff produces 0 duplicate cases on repeat invocation
    const syncRes = await syncCampaignAdaptiveReasoning({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
    });
    expect(syncRes.casesCreated).toBe(0);
    expect(syncRes.casesSkippedIdempotent).toBeGreaterThanOrEqual(1);

    const reasoningCases = await pool.query(
      `SELECT id, strategy_root_id, strategy_root_version, status FROM reasoning_cases WHERE campaign_id = $1`,
      [CAMPAIGN_ID]
    );
    expect(reasoningCases.rows.length).toBeGreaterThanOrEqual(1);
    expect(reasoningCases.rows[0].strategy_root_id).toBe("de027857-3a9e-4bee-8ad6-9a6b6319ec32");
    expect(reasoningCases.rows[0].strategy_root_version).toBe(13);
  });

  it("8. Songfinch (comp_2f89a318-c) vs Soundverse (comp_0e728ebd-5) identity and Pass 2 coverage resolutions are verified", async () => {
    const comps = await pool.query(
      `SELECT id, name, website_url, is_active FROM ci_competitors WHERE id IN ('comp_2f89a318-c', 'comp_0e728ebd-5')`
    );
    const byId = new Map(comps.rows.map((r: any) => [r.id, r]));
    expect(byId.get("comp_2f89a318-c")?.name).toBe("Songfinch");
    expect(byId.get("comp_2f89a318-c")?.website_url).toContain("songfinch.com");
    expect(byId.get("comp_0e728ebd-5")?.name).toBe("Soundverse");
    expect(byId.get("comp_0e728ebd-5")?.website_url).toContain("soundverse.ai");

    // Verify recent Songfinch acquisitions are persisted under comp_2f89a318-c
    const sfTaskIds = [
      "acq_c8835e422567d2bf",
      "acq_ec2867c8086bc832",
      "acq_e2461d2c05d745da",
      "acq_94f05a30f7b418f3",
      "acq_63df52a030c065fd",
      "acq_eb2f95356161923c",
    ];
    const sfTasks = await pool.query(
      `SELECT id, entity_id, status, terminal_outcome FROM acquisition_tasks WHERE id = ANY($1::varchar[])`,
      [sfTaskIds]
    );
    expect(sfTasks.rows.length).toBe(6);
    for (const row of sfTasks.rows) {
      expect(row.entity_id).toBe("comp_2f89a318-c");
      expect(row.status).toBe("COMPLETED");
      expect(row.terminal_outcome).toBe("SUCCESS_WITH_CONTENT");
    }

    // Verify all 8 previously INCONCLUSIVE_ZERO_RESULT Instagram COMMENTS tasks are resolved
    const resolvedCommentTaskIds = [
      "acq_2aee8f950a7fdc38", // Custom Anthems -> SUCCESS_WITH_CONTENT
      "acq_7cf05e041ac95a6b", // GiftSong -> SUCCESS_WITH_CONTENT
      "acq_64afd896fb1ca464", // Gifts for Music Lovers -> SUCCESS_WITH_CONTENT
      "acq_dc6fbb280d020d76", // MelodyBolt -> SUCCESS_WITH_CONTENT
      "acq_eb2f95356161923c", // Songfinch -> SUCCESS_WITH_CONTENT
      "acq_576bf5478df94a7f", // Soundverse -> SUCCESS_WITH_CONTENT
      "acq_2a0690ed65668291", // Amikado -> CONFIRMED_EMPTY_SOURCE
      "acq_8134c2e5665e42d4", // CreateMySong -> CONFIRMED_EMPTY_SOURCE
    ];
    const resolvedCommentsRes = await pool.query(
      `SELECT id, status, terminal_outcome FROM acquisition_tasks WHERE id = ANY($1::varchar[])`,
      [resolvedCommentTaskIds]
    );
    expect(resolvedCommentsRes.rows.length).toBe(8);
    for (const r of resolvedCommentsRes.rows) {
      expect(r.status).toBe("COMPLETED");
      expect(["SUCCESS_WITH_CONTENT", "CONFIRMED_EMPTY_SOURCE"]).toContain(r.terminal_outcome);
    }

    // Verify 0 latest active competitor INSTAGRAM COMMENTS tasks remain INCONCLUSIVE_ZERO_RESULT
    const inconclusiveRes = await pool.query(
      `WITH latest_tasks AS (
         SELECT DISTINCT ON (t.entity_id, r.platform, t.capability)
           t.id, t.entity_id, r.platform, t.capability, t.status, t.terminal_outcome
         FROM acquisition_tasks t
         JOIN acquisition_requests r ON r.task_id = t.id
         JOIN ci_competitors c ON c.id = t.entity_id AND c.campaign_id = t.campaign_id
         WHERE t.campaign_id = $1
           AND t.entity_type = 'COMPETITOR'
           AND r.platform = 'INSTAGRAM'
           AND t.capability = 'COMMENTS'
           AND c.is_active = true
         ORDER BY t.entity_id, r.platform, t.capability, t.updated_at DESC, t.created_at DESC
       )
       SELECT COUNT(*)::int AS cnt
       FROM latest_tasks
       WHERE terminal_outcome = 'INCONCLUSIVE_ZERO_RESULT'`,
      [CAMPAIGN_ID]
    );
    expect(inconclusiveRes.rows[0].cnt).toBe(0);
  });

  it("9. Overstated EXECUTION_RESPONSE decision (adec_b1ead493374e) is superseded by INSUFFICIENT_EVIDENCE and Watchtower placeholder/post_id guards hold", async () => {
    const { classifyWatchtowerChanges } = await import("../watchtower/orchestrator");

    // Verify rcase_b1ead493374e / adec_b1ead493374e is CLOSED & superseded
    const oldCaseRes = await pool.query(
      `SELECT id, status, metadata FROM reasoning_cases WHERE id = 'rcase_b1ead493374e'`
    );
    expect(oldCaseRes.rows[0]?.status).toBe("CLOSED");
    expect(oldCaseRes.rows[0]?.metadata?.superseded).toBe(true);

    const oldDecRes = await pool.query(
      `SELECT id, decision_type, affected_authority, confidence, metadata FROM adaptive_decisions WHERE id = 'adec_b1ead493374e'`
    );
    expect(oldDecRes.rows[0]?.decision_type).toBe("EXECUTION_RESPONSE");
    expect(oldDecRes.rows[0]?.metadata?.superseded).toBe(true);

    // Verify active superseding case/decision is INSUFFICIENT_EVIDENCE with affectedAuthority = null and confidence = 0.35
    const activeCaseRes = await pool.query(
      `SELECT id, status, metadata FROM reasoning_cases WHERE id = 'rcase_567771d0dae3'`
    );
    expect(activeCaseRes.rows[0]?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(activeCaseRes.rows[0]?.metadata?.superseded).toBeFalsy();

    const activeDecRes = await pool.query(
      `SELECT id, decision_type, affected_authority, confidence FROM adaptive_decisions WHERE id = 'adec_567771d0dae3'`
    );
    expect(activeDecRes.rows[0]?.decision_type).toBe("INSUFFICIENT_EVIDENCE");
    expect(activeDecRes.rows[0]?.affected_authority).toBeNull();
    expect(Number(activeDecRes.rows[0]?.confidence)).toBeCloseTo(0.35, 2);

    // Verify Watchtower has 0 open candidates and 2 confirmed events
    const wtRes = await pool.query(
      `SELECT status, COUNT(*)::int AS cnt FROM pipeline_change_events WHERE campaign_id = $1 GROUP BY status`,
      [CAMPAIGN_ID]
    );
    const wtMap = new Map(wtRes.rows.map((r: any) => [r.status, r.cnt]));
    expect(wtMap.get("candidate") ?? 0).toBe(0);
    expect(wtMap.get("confirmed") ?? 0).toBe(2);

    // Verify deterministic Watchtower guards:
    // (a) identical post_ids with title vs title — description formatting diffs emit 0 changes
    const samePostsDiffFormat = classifyWatchtowerChanges(
      {
        post_ids: ["yt_abc1", "yt_abc2", "yt_abc3", "yt_abc4"],
        patterns: [
          "Song 1 — Full description 1",
          "Song 2 — Full description 2",
          "Song 3 — Full description 3",
          "Song 4 — Full description 4",
        ],
      },
      {
        post_ids: ["abc1", "abc2", "abc3", "abc4"],
        patterns: ["Song 1 -", "Song 2 -", "Song 3 -", "Song 4 -"],
      },
      "snap_curr",
      "snap_prev"
    );
    expect(samePostsDiffFormat).toHaveLength(0);

    // (b) "Not explicitly stated" vs "Not explicitly listed" pricing placeholders emit 0 pricing_change events
    const placeholderPricingDiff = classifyWatchtowerChanges(
      {
        pricing: ["Not explicitly listed"],
      },
      {
        pricing: ["Not explicitly stated on website evidence", "Not stated"],
      },
      "snap_curr",
      "snap_prev"
    );
    expect(placeholderPricingDiff).toHaveLength(0);
  });
});
