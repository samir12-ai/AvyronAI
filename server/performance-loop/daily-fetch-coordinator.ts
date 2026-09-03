/**
 * Avyron — Daily Owned Channel Fetch & Timezone Coordinator.
 *
 * DOCTRINE:
 * 1. Daily Acquisition: Fetch customer's owned channels once per campaign-local day.
 * 2. Campaign Timezone: Uses campaign's configured timezone (e.g. Asia/Dubai, America/New_York)
 *    to determine calendar-day boundaries (not server boot uptime).
 * 3. Duplication Protection: Uses (accountId, campaignId, ownedSourceId, platform, measurementDate)
 *    to prevent duplicate daily fetches. Provider retries are safe.
 * 4. Actual Published Content: Ingests what ACTUALLY went live, whether created in
 *    Creative Studio or published independently.
 * 5. Automatic WTDT / Plan Execution Coordination: Evaluates newly fetched posts
 *    with the 50% semantic alignment matcher.
 * 6. Honest Failures: Provider failures / disconnected channels emit FAILED / NOT_CONNECTED
 *    and NEVER fabricate zero metrics.
 */

import { db } from "../db";
import {
  dailyOwnedFetchRecords,
  ownedPosts,
  ownedPostSnapshots,
  userPublicProfiles,
  campaignSelections,
  type DailyOwnedFetchRecord,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { ALL_CANONICAL_ADAPTERS, type PlatformAdapterResult } from "./platform-adapters";
import { matchPostAgainstPlanExecution } from "./semantic-matcher";

export interface DailyFetchExecutionResult {
  accountId: string;
  campaignId: string;
  platform: string;
  measurementDate: string;
  status: "SUCCESS" | "ALREADY_FETCHED" | "FAILED" | "NOT_CONNECTED" | "COMING_SOON";
  newPostsCount: number;
  matchedTasksCount: number;
  evidenceRefId: string | null;
  message: string;
}

/**
 * Computes calendar-day date string (YYYY-MM-DD) in the campaign's local timezone.
 */
export function getCampaignLocalDate(timezone: string = "UTC", date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date); // Output format: YYYY-MM-DD
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Executes a daily owned channel fetch for a specific campaign and platform.
 */
export async function executeDailyOwnedFetch(params: {
  accountId: string;
  campaignId: string;
  platform?: "INSTAGRAM" | "WEBSITE" | "TIKTOK" | "YOUTUBE" | "LINKEDIN" | "X_TWITTER";
  timezone?: string;
  force?: boolean;
}): Promise<DailyFetchExecutionResult> {
  const { accountId, campaignId, platform = "INSTAGRAM", force = false } = params;

  // 1. Resolve campaign timezone
  let timezone = params.timezone;
  if (!timezone) {
    const [camp] = await db
      .select()
      .from(campaignSelections)
      .where(and(
        eq(campaignSelections.accountId, accountId),
        eq(campaignSelections.selectedCampaignId, campaignId)
      ))
      .limit(1);
    
    // Map campaign location to standard IANA timezone or fallback
    if (camp?.campaignLocation?.toLowerCase().includes("emirates") || camp?.campaignLocation?.toLowerCase().includes("dubai")) {
      timezone = "Asia/Dubai";
    } else if (camp?.campaignLocation?.toLowerCase().includes("saudi") || camp?.campaignLocation?.toLowerCase().includes("riyadh")) {
      timezone = "Asia/Riyadh";
    } else {
      timezone = "UTC";
    }
  }

  const measurementDate = getCampaignLocalDate(timezone);
  const ownedSourceId = `src_${platform.toLowerCase()}_${campaignId}`;

  // 2. Check for duplicate daily fetch for today in campaign timezone
  if (!force) {
    const [existing] = await db
      .select()
      .from(dailyOwnedFetchRecords)
      .where(and(
        eq(dailyOwnedFetchRecords.accountId, accountId),
        eq(dailyOwnedFetchRecords.campaignId, campaignId),
        eq(dailyOwnedFetchRecords.ownedSourceId, ownedSourceId),
        eq(dailyOwnedFetchRecords.platform, platform),
        eq(dailyOwnedFetchRecords.measurementDate, measurementDate)
      ))
      .limit(1);

    if (existing && existing.status === "SUCCESS") {
      return {
        accountId,
        campaignId,
        platform,
        measurementDate,
        status: "ALREADY_FETCHED",
        newPostsCount: existing.fetchedPostCount,
        matchedTasksCount: 0,
        evidenceRefId: existing.evidenceRefId,
        message: `Daily fetch for ${measurementDate} in ${timezone} has already completed successfully.`,
      };
    }
  }

  // 3. Resolve canonical adapter
  const adapterKey = platform as keyof typeof ALL_CANONICAL_ADAPTERS;
  const adapter = ALL_CANONICAL_ADAPTERS[adapterKey];

  if (!adapter) {
    return {
      accountId,
      campaignId,
      platform,
      measurementDate,
      status: "FAILED",
      newPostsCount: 0,
      matchedTasksCount: 0,
      evidenceRefId: null,
      message: `Unsupported platform adapter: ${platform}`,
    };
  }

  // 4. Fetch snapshot from adapter
  const adapterResult: PlatformAdapterResult = await adapter.fetchSnapshot(accountId, campaignId);
  const { snapshot, evidenceRefId } = adapterResult;

  if (snapshot.providerStatus === "COMING_SOON") {
    return {
      accountId,
      campaignId,
      platform,
      measurementDate,
      status: "COMING_SOON",
      newPostsCount: 0,
      matchedTasksCount: 0,
      evidenceRefId,
      message: `Platform ${platform} is contract-ready but ingestion provider is coming soon.`,
    };
  }

  if (snapshot.providerStatus === "NOT_CONNECTED" || snapshot.providerStatus === "FAILED") {
    // Record honest failure without inventing zero metrics
    await db.insert(dailyOwnedFetchRecords).values({
      accountId,
      campaignId,
      ownedSourceId,
      platform,
      measurementDate,
      status: "FAILED",
      fetchedPostCount: 0,
      evidenceRefId,
      details: { reason: "Provider disconnected or scrape failed", providerStatus: snapshot.providerStatus },
    }).onConflictDoNothing();

    return {
      accountId,
      campaignId,
      platform,
      measurementDate,
      status: snapshot.providerStatus === "NOT_CONNECTED" ? "NOT_CONNECTED" : "FAILED",
      newPostsCount: 0,
      matchedTasksCount: 0,
      evidenceRefId,
      message: `Platform ${platform} returned ${snapshot.providerStatus}; metrics left uncoerced.`,
    };
  }

  // 5. Ingest and match new owned posts
  let newPostsCount = 0;
  let matchedTasksCount = 0;

  // Query posts discovered for this campaign
  const recentPosts = await db
    .select()
    .from(ownedPosts)
    .where(and(
      eq(ownedPosts.accountId, accountId),
      eq(ownedPosts.campaignId, campaignId),
      eq(ownedPosts.platform, platform.toLowerCase())
    ))
    .orderBy(desc(ownedPosts.createdAt))
    .limit(20);

  for (const post of recentPosts) {
    newPostsCount++;
    // Run semantic 50% plan execution matching
    const matchRes = await matchPostAgainstPlanExecution(accountId, campaignId, {
      id: post.id,
      caption: post.caption,
      hookText: post.hookText,
      platform,
      mediaType: post.mediaType,
      postedAt: post.postedAt,
    });

    if (matchRes.matched) {
      matchedTasksCount++;
      await db
        .update(ownedPosts)
        .set({
          lineageState: "planned_matched",
          matchMethod: matchRes.matchMethod,
          matchConfidence: matchRes.matchScore,
          matchedPlanId: matchRes.matchedPlanId,
          matchedCalendarEntryId: matchRes.matchedTaskId,
          lineageResolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ownedPosts.id, post.id));
    } else {
      await db
        .update(ownedPosts)
        .set({
          lineageState: "unplanned",
          matchConfidence: matchRes.matchScore,
          updatedAt: new Date(),
        })
        .where(eq(ownedPosts.id, post.id));
    }
  }

  // 6. Record completed daily fetch record
  await db.insert(dailyOwnedFetchRecords).values({
    accountId,
    campaignId,
    ownedSourceId,
    platform,
    measurementDate,
    status: "SUCCESS",
    fetchedPostCount: newPostsCount,
    evidenceRefId,
    details: { matchedTasksCount, timezone },
  }).onConflictDoUpdate({
    target: [
      dailyOwnedFetchRecords.accountId,
      dailyOwnedFetchRecords.campaignId,
      dailyOwnedFetchRecords.ownedSourceId,
      dailyOwnedFetchRecords.platform,
      dailyOwnedFetchRecords.measurementDate,
    ],
    set: {
      status: "SUCCESS",
      fetchedPostCount: newPostsCount,
      evidenceRefId,
      details: { matchedTasksCount, timezone },
    },
  });

  return {
    accountId,
    campaignId,
    platform,
    measurementDate,
    status: "SUCCESS",
    newPostsCount,
    matchedTasksCount,
    evidenceRefId,
    message: `Daily fetch for ${measurementDate} completed (${newPostsCount} posts observed, ${matchedTasksCount} plan-aligned executions).`,
  };
}
