/**
 * Canonical External-Data Acquisition Authority
 *
 * Single authoritative service for all external data acquisition across Avyron:
 * - Onboarding & Business Understanding (first-party website crawl)
 * - Competitor Discovery & Source Verification (Google Search & social verification)
 * - Market Intelligence (MIv3) & Strategy Generation (Instagram, TikTok, YouTube, Reviews, Websites)
 * - Market Voice (Reddit, forums, reviews, search quotes)
 * - Watchtower (competitor monitoring)
 * - Performance Loop & Owned Channels (Instagram, YouTube, TikTok owned profiles & posts)
 * - Manual refreshes, recovery runs, and CLI entry points
 *
 * Guarantees:
 * 1. Every consumer request is persisted in `acquisition_requests` (`areq_*`), including
 *    `CACHE_REUSE` and `JOINED_INFLIGHT` coalesced requests.
 * 2. Strict tenant & requirement compatibility guard: never merges requests across
 *    different `accountId`s, incompatible credentials, narrower time windows, or smaller item limits.
 * 3. Durable scraping pool backed by `acquisition_tasks` (`acq_*`) and `acquisition_attempts` (`aatt_*`)
 *    with `FOR UPDATE SKIP LOCKED`, leases, heartbeats, fencing tokens, and configurable
 *    global/provider/actor/tenant concurrency limits.
 * 4. Immediate `provider_run_id` persistence before polling begins, plus crash-window
 *    reconciliation and polling-timeout run resumption (`resumeRunId`) so a restart or
 *    timeout never blindly starts a duplicate paid Apify run.
 * 5. Consistent error classification (`error-contract.ts`) with bounded exponential backoff
 *    and jitter (`next_retry_at`).
 */

import { createHash, randomUUID } from "crypto";
import { db } from "../db";
import {
  acquisitionTasks,
  acquisitionRequests,
  acquisitionAttempts,
  rawAcquisitionObservations,
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorReviews,
  ciSharedProfiles,
  marketVoiceEvidence,
  competitorWebsiteSnapshots,
  websiteSnapshots,
  ownedPosts,
  type AcquisitionTask,
  type AcquisitionRequest,
} from "@shared/schema";
import { eq, and, or, sql, desc, inArray, gte, gt } from "drizzle-orm";
import {
  type AcquisitionErrorCode,
  type TerminalOutcome,
  classifyAcquisitionError,
  computeBoundedBackoffMs,
  sanitizeInputForPersistence,
  sanitizeLogString,
} from "./error-contract";
import {
  runWithAttemptContext,
  ApifyPollingTimeoutError,
} from "./apify-client";

export interface AcquisitionPoolConfig {
  maxGlobalConcurrent: number;
  maxPerProvider: Record<string, number>;
  maxPerActor: Record<string, number>;
  maxPerTenant: number;
  leaseDurationSec: number;
  heartbeatIntervalMs: number;
  maxBatchTasksPerCampaign: number;
  defaultFreshnessTtlSec: number;
  defaultMaxRetries: number;
}

const DEFAULT_POOL_CONFIG: AcquisitionPoolConfig = {
  maxGlobalConcurrent: Number(process.env.ACQ_MAX_GLOBAL_CONCURRENT || 6),
  maxPerProvider: {
    APIFY: Number(process.env.ACQ_MAX_APIFY_CONCURRENT || 4),
    NATIVE_HTTP: Number(process.env.ACQ_MAX_HTTP_CONCURRENT || 4),
  },
  maxPerActor: {
    DEFAULT: Number(process.env.ACQ_MAX_PER_ACTOR_CONCURRENT || 2),
  },
  maxPerTenant: Number(process.env.ACQ_MAX_PER_TENANT_CONCURRENT || 3),
  leaseDurationSec: 600, // 10 minutes
  heartbeatIntervalMs: 20_000, // 20 seconds
  maxBatchTasksPerCampaign: 60,
  defaultFreshnessTtlSec: 6 * 3600, // 6 hours
  defaultMaxRetries: 3,
};

let currentPoolConfig: AcquisitionPoolConfig = { ...DEFAULT_POOL_CONFIG };

export function setAcquisitionPoolConfig(overrides: Partial<AcquisitionPoolConfig>): void {
  currentPoolConfig = {
    ...currentPoolConfig,
    ...overrides,
    maxPerProvider: {
      ...currentPoolConfig.maxPerProvider,
      ...(overrides.maxPerProvider || {}),
    },
    maxPerActor: {
      ...currentPoolConfig.maxPerActor,
      ...(overrides.maxPerActor || {}),
    },
  };
}

export function resetAcquisitionPoolConfig(): void {
  currentPoolConfig = { ...DEFAULT_POOL_CONFIG };
}

export function getAcquisitionPoolConfig(): AcquisitionPoolConfig {
  return currentPoolConfig;
}

export interface CustomAdapterExecutionResult {
  status:
    | "COMPLETED"
    | "EMPTY_CONFIRMED"
    | "EMPTY_INCONCLUSIVE"
    | "PARTIAL_COVERAGE"
    | "SKIPPED_PENDING_CONFIG"
    | "SKIPPED_UNSUPPORTED"
    | "FAILED";
  provider?: string;
  actorId?: string | null;
  providerRunId?: string | null;
  datasetId?: string | null;
  usageUsd?: number | null;
  httpStatus?: number | null;
  itemsStored?: number;
  isConfirmedEmpty?: boolean;
  isPartialCoverage?: boolean;
  nextPageCursor?: string | null;
  normalizedEvidenceIds?: string[];
  rawPayload?: any;
  output?: Record<string, any>;
  error?: string;
  retryAfterMs?: number;
}

export interface AcquisitionRequestInput {
  accountId: string;
  campaignId: string;
  requesterEngine: string;
  trigger: string;
  parentJobId?: string | null;
  strategyVersion?: number | null;
  monitoringCycleId?: string | null;
  performanceCycleId?: string | null;
  entityType: string;
  entityId: string;
  sourceId?: string | null;
  platform: string;
  canonicalUrl?: string | null;
  externalAccountId?: string | null;
  capability: string;
  provider?: string;
  actorId?: string | null;
  priority?: number;
  timeWindowDays?: number | null;
  itemLimit?: number | null;
  freshnessTtlSec?: number | null;
  maxRetries?: number;
  forceRefresh?: boolean;
  cycleToken?: string;
  inputPayload?: Record<string, any>;
  executeInline?: boolean;
  customExecutor?: (ctx: {
    taskId: string;
    attemptId: string;
    fencingToken: number;
    resumeRunId: string | null;
    inputPayload: Record<string, any>;
  }) => Promise<CustomAdapterExecutionResult>;
}

export interface AcquisitionRequestOutcome {
  requestId: string;
  taskId: string;
  attemptId: string | null;
  resolutionType: "NEW_FETCH" | "CACHE_REUSE" | "JOINED_INFLIGHT" | "DEFERRED";
  status: "COMPLETED" | "FAILED" | "SKIPPED" | "DEFERRED" | "CANCELLED" | "PENDING" | "RUNNING";
  terminalOutcome: TerminalOutcome | null;
  errorCode: AcquisitionErrorCode | null;
  errorMessage: string | null;
  provider: string;
  actorId: string | null;
  providerRunId: string | null;
  datasetId: string | null;
  itemsStored: number;
  observationIds: string[];
  normalizedEvidenceIds: string[];
  consumerDeliveryStatus: string;
  usageUsd: number | null;
  output: any;
}

// Registry of custom executors for inline/queued task execution in the current process
const customExecutorRegistry = new Map<
  string,
  NonNullable<AcquisitionRequestInput["customExecutor"]>
>();

// In-flight task completion waiters for coalesced requests in the same process
const inflightTaskWaiters = new Map<string, Array<() => void>>();

function notifyTaskWaiters(taskId: string): void {
  const waiters = inflightTaskWaiters.get(taskId);
  if (waiters) {
    inflightTaskWaiters.delete(taskId);
    for (const w of waiters) {
      try {
        w();
      } catch {}
    }
  }
}

function buildCanonicalSourceKey(input: {
  sourceId?: string | null;
  canonicalUrl?: string | null;
  externalAccountId?: string | null;
  entityId: string;
}): string {
  const raw = (
    input.sourceId ||
    input.externalAccountId ||
    input.canonicalUrl ||
    input.entityId ||
    "default"
  )
    .trim()
    .toLowerCase();
  if (raw.length > 48) {
    return `${raw.slice(0, 20)}_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
  }
  return raw;
}

export function buildDeterministicTaskKey(input: {
  accountId: string;
  campaignId: string;
  platform: string;
  entityType: string;
  entityId: string;
  capability: string;
  sourceId?: string | null;
  canonicalUrl?: string | null;
  externalAccountId?: string | null;
  cycleToken?: string;
}): string {
  const srcKey = buildCanonicalSourceKey(input);
  const token = input.cycleToken || "canonical";
  const fullKey = `${input.accountId}:${input.campaignId}:${token}:${input.platform.toUpperCase()}:${input.entityType.toUpperCase()}:${input.entityId}:${input.capability.toUpperCase()}:${srcKey}`;
  if (fullKey.length > 220) {
    return `${fullKey.slice(0, 180)}:${createHash("sha256").update(fullKey).digest("hex").slice(0, 24)}`;
  }
  return fullKey;
}

export function inferDefaultProviderAndActor(
  platform: string,
  capability: string
): { provider: string; actorId: string | null } {
  const plat = platform.toUpperCase();
  const cap = capability.toUpperCase();
  if (plat === "COMPETITOR_WEBSITE" || plat === "BUSINESS_WEBSITE" || plat === "WEBSITE") {
    return { provider: "NATIVE_HTTP", actorId: "native-http-crawler" };
  }
  if (plat === "BLOG") {
    return { provider: "NATIVE_HTTP", actorId: "native-blog-rss-crawler" };
  }
  if (plat === "INSTAGRAM" && cap === "COMMENTS") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_INSTAGRAM_COMMENTS_ACTOR_ID || "apify~instagram-comment-scraper",
    };
  }
  if (plat === "INSTAGRAM") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID || "apify~instagram-profile-scraper",
    };
  }
  if (plat === "TIKTOK" && cap === "COMMENTS") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_TIKTOK_COMMENTS_ACTOR_ID || "clockworks~tiktok-comments-scraper",
    };
  }
  if (plat === "TIKTOK") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_TIKTOK_ACTOR_ID || "clockworks~tiktok-scraper",
    };
  }
  if (plat === "YOUTUBE" && cap === "COMMENTS") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_YOUTUBE_COMMENTS_ACTOR_ID || "streamers~youtube-comments-scraper",
    };
  }
  if (plat === "YOUTUBE") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_YOUTUBE_ACTOR_ID || "streamers~youtube-scraper",
    };
  }
  if (plat === "LINKEDIN") {
    if (cap === "PROFILE") {
      return {
        provider: "APIFY",
        actorId: process.env.APIFY_LINKEDIN_COMPANY_ACTOR_ID || "harvestapi~linkedin-company",
      };
    }
    return {
      provider: "APIFY",
      actorId:
        process.env.APIFY_LINKEDIN_COMPANY_POSTS_ACTOR_ID ||
        process.env.APIFY_LINKEDIN_POSTS_ACTOR_ID ||
        "harvestapi~linkedin-company-posts",
    };
  }
  if (plat === "X" || plat === "TWITTER") {
    if (cap === "PROFILE") {
      return {
        provider: "APIFY",
        actorId: process.env.APIFY_X_PROFILE_ACTOR_ID || "apidojo~twitter-user-scraper",
      };
    }
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_X_TWEETS_ACTOR_ID || "apidojo~tweet-scraper",
    };
  }
  if (plat === "FACEBOOK") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_FACEBOOK_POSTS_ACTOR_ID || "apify~facebook-posts-scraper",
    };
  }
  if (plat === "GOOGLE_REVIEWS" || plat === "GOOGLE") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_GOOGLE_MAPS_REVIEWS_ACTOR_ID || "compass~Google-Maps-Reviews-Scraper",
    };
  }
  if (plat === "TRUSTPILOT") {
    return {
      provider: "APIFY",
      actorId:
        process.env.APIFY_TRUSTPILOT_REVIEWS_ACTOR_ID ||
        process.env.APIFY_TRUSTPILOT_ACTOR_ID ||
        "sourabhbgp~trustpilot-scraper",
    };
  }
  if (plat === "TRENDYOL") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_TRENDYOL_REVIEWS_ACTOR_ID || "fatihtahta~trendyol-scraper",
    };
  }
  if (plat === "G2" || plat === "CAPTERRA") {
    return {
      provider: "APIFY",
      actorId:
        process.env.APIFY_G2_REVIEWS_ACTOR_ID ||
        process.env.APIFY_CAPTERRA_REVIEWS_ACTOR_ID ||
        "zen-studio~software-review-scraper",
    };
  }
  if (plat === "REDDIT") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_REDDIT_ACTOR_ID || "trudax~reddit-scraper-lite",
    };
  }
  if (plat === "MARKET_VOICE" || plat === "GOOGLE_SEARCH") {
    return {
      provider: "APIFY",
      actorId: process.env.APIFY_GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper",
    };
  }
  return { provider: "APIFY", actorId: null };
}

/**
 * Checks whether an existing task's parameters satisfy a new request's requirements
 * without violating tenant isolation, credential scope, time window, or item limits.
 */
export function isTaskCompatibleWithRequest(
  existingTask: {
    accountId: string;
    entityType: string;
    entityId: string;
    sourcePlatform: string;
    capability?: string | null;
    taskType: string;
    canonicalUrl?: string | null;
    externalAccountId?: string | null;
    sourceId?: string | null;
    timeWindowDays?: number | null;
    itemLimit?: number | null;
    inputPayload?: any;
  },
  request: AcquisitionRequestInput
): boolean {
  // 1. Strict tenant isolation
  if (existingTask.accountId !== request.accountId) return false;

  // 2. Entity type, platform & capability match
  if (existingTask.entityType.toUpperCase() !== request.entityType.toUpperCase()) return false;
  if (existingTask.sourcePlatform.toUpperCase() !== request.platform.toUpperCase()) return false;
  const existingCap = (existingTask.capability || existingTask.taskType || "").toUpperCase();
  if (existingCap !== request.capability.toUpperCase()) return false;

  // 3. Credential/permission scope isolation
  const existingCredScope = existingTask.inputPayload?.credentialScope || "default";
  const reqCredScope = request.inputPayload?.credentialScope || "default";
  if (existingCredScope !== reqCredScope) return false;

  // 4. Entity & Source identity match:
  // Allow either identical entityId OR identical explicit external source identity (externalAccountId / canonicalUrl)
  // across campaigns within the same accountId (e.g., shared owned social channel or shared competitor domain).
  const existingExplicitSource = (
    existingTask.externalAccountId ||
    existingTask.inputPayload?.handle ||
    existingTask.canonicalUrl ||
    existingTask.inputPayload?.canonicalUrl ||
    existingTask.inputPayload?.websiteUrl ||
    existingTask.inputPayload?.channelUrl ||
    existingTask.inputPayload?.targetUrl ||
    ""
  )
    .trim()
    .toLowerCase();
  const reqExplicitSource = (
    request.externalAccountId ||
    request.inputPayload?.handle ||
    request.canonicalUrl ||
    request.inputPayload?.canonicalUrl ||
    request.inputPayload?.websiteUrl ||
    request.inputPayload?.channelUrl ||
    request.inputPayload?.targetUrl ||
    ""
  )
    .trim()
    .toLowerCase();

  if (existingTask.entityId !== request.entityId) {
    if (!existingExplicitSource || !reqExplicitSource || existingExplicitSource !== reqExplicitSource) {
      return false;
    }
  } else {
    const existingSourceKey = buildCanonicalSourceKey({
      sourceId: existingTask.sourceId || existingTask.inputPayload?.sourceId,
      canonicalUrl:
        existingTask.canonicalUrl ||
        existingTask.inputPayload?.canonicalUrl ||
        existingTask.inputPayload?.websiteUrl ||
        existingTask.inputPayload?.channelUrl ||
        existingTask.inputPayload?.targetUrl,
      externalAccountId: existingTask.externalAccountId || existingTask.inputPayload?.handle,
      entityId: existingTask.entityId,
    });
    const reqSourceKey = buildCanonicalSourceKey(request);
    if (existingSourceKey !== reqSourceKey) return false;
  }

  // 5. Time window compatibility: existing task must cover at least the requested timeWindowDays
  if (request.timeWindowDays != null && request.timeWindowDays > 0) {
    const existingWindow = existingTask.timeWindowDays ?? 0;
    if (existingWindow < request.timeWindowDays) return false;
  }

  // 6. Item limit compatibility: existing task must fetch at least as many items as requested
  if (request.itemLimit != null && request.itemLimit > 0) {
    const existingLimit = existingTask.itemLimit ?? 0;
    if (existingLimit < request.itemLimit) return false;
  }

  return true;
}

/**
 * Queries normalized evidence IDs created or owned by a completed task.
 */
async function resolveNormalizedEvidenceIdsForTask(
  task: AcquisitionTask,
  explicitIds?: string[],
  itemsStored?: number
): Promise<string[]> {
  if (!itemsStored || itemsStored <= 0) {
    return [];
  }
  if (Array.isArray(explicitIds) && explicitIds.length > 0) {
    return explicitIds;
  }
  const plat = task.sourcePlatform.toUpperCase();
  const cap = (task.capability || task.taskType || "").toUpperCase();
  const maxRows = Math.max(1, Math.min(itemsStored, 50));

  try {
    if (
      task.entityType === "COMPETITOR" &&
      ["LINKEDIN", "X", "TWITTER", "INSTAGRAM", "TIKTOK"].includes(plat) &&
      cap === "PROFILE"
    ) {
      const dbPlat = plat === "TWITTER" ? "x" : plat.toLowerCase();
      const rows = await db
        .select({ id: ciSharedProfiles.id })
        .from(ciSharedProfiles)
        .where(eq(ciSharedProfiles.platform, dbPlat))
        .orderBy(desc(ciSharedProfiles.updatedAt))
        .limit(Math.min(maxRows, 5));
      return rows.map((r) => r.id);
    }
    if (
      task.entityType === "COMPETITOR" &&
      ["INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "X", "FACEBOOK", "BLOG", "GOOGLE_SEARCH"].includes(plat) &&
      (cap === "POSTS" || cap === "PROFILE_POSTS" || cap === "SEARCH_QUOTES")
    ) {
      const dbPlat = plat === "GOOGLE_SEARCH" ? "google" : plat.toLowerCase();
      const rows = await db
        .select({ id: ciCompetitorPosts.id })
        .from(ciCompetitorPosts)
        .where(
          and(
            eq(ciCompetitorPosts.accountId, task.accountId),
            eq(ciCompetitorPosts.competitorId, task.entityId),
            eq(ciCompetitorPosts.platform, dbPlat)
          )
        )
        .orderBy(desc(ciCompetitorPosts.createdAt))
        .limit(maxRows);
      return rows.map((r) => r.id);
    }
    if (
      task.entityType === "COMPETITOR" &&
      ["INSTAGRAM", "YOUTUBE", "TIKTOK"].includes(plat) &&
      cap === "COMMENTS"
    ) {
      const platformFilterSql =
        plat === "YOUTUBE"
          ? sql`${ciCompetitorComments.id} LIKE 'comm_yt_%'`
          : plat === "TIKTOK"
            ? sql`${ciCompetitorComments.id} LIKE 'comm_tt_%'`
            : sql`${ciCompetitorComments.id} NOT LIKE 'comm_yt_%' AND ${ciCompetitorComments.id} NOT LIKE 'comm_tt_%'`;
      const rows = await db
        .select({ id: ciCompetitorComments.id })
        .from(ciCompetitorComments)
        .where(
          and(
            eq(ciCompetitorComments.accountId, task.accountId),
            eq(ciCompetitorComments.competitorId, task.entityId),
            platformFilterSql,
            sql`COALESCE(${ciCompetitorComments.filterStatus}, '') NOT LIKE 'QUARANTINED%'`
          )
        )
        .orderBy(desc(ciCompetitorComments.createdAt))
        .limit(maxRows);
      return rows.map((r) => r.id);
    }
    if (
      task.entityType === "COMPETITOR" &&
      ["GOOGLE_REVIEWS", "GOOGLE", "TRUSTPILOT", "TRENDYOL", "G2", "CAPTERRA"].includes(plat) &&
      cap === "REVIEWS"
    ) {
      const reviewPlatform =
        plat === "GOOGLE_REVIEWS" || plat === "GOOGLE"
          ? "google"
          : plat.toLowerCase();
      const rows = await db
        .select({ id: ciCompetitorReviews.id })
        .from(ciCompetitorReviews)
        .where(
          and(
            eq(ciCompetitorReviews.accountId, task.accountId),
            eq(ciCompetitorReviews.competitorId, task.entityId),
            eq(ciCompetitorReviews.platform, reviewPlatform)
          )
        )
        .orderBy(desc(ciCompetitorReviews.createdAt))
        .limit(maxRows);
      return rows.map((r) => r.id);
    }
    if (plat === "MARKET_VOICE" || plat === "REDDIT") {
      const rows = await db
        .select({ id: marketVoiceEvidence.id })
        .from(marketVoiceEvidence)
        .where(
          and(
            eq(marketVoiceEvidence.accountId, task.accountId),
            eq(marketVoiceEvidence.campaignId, task.campaignId)
          )
        )
        .orderBy(desc(marketVoiceEvidence.createdAt))
        .limit(maxRows);
      return rows.map((r) => r.id);
    }
    if (plat === "COMPETITOR_WEBSITE" || (plat === "WEBSITE" && task.entityType === "COMPETITOR")) {
      const rows = await db
        .select({ id: competitorWebsiteSnapshots.id })
        .from(competitorWebsiteSnapshots)
        .where(
          and(
            eq(competitorWebsiteSnapshots.accountId, task.accountId),
            eq(competitorWebsiteSnapshots.competitorId, task.entityId),
            eq(competitorWebsiteSnapshots.status, "COMPLETE")
          )
        )
        .orderBy(desc(competitorWebsiteSnapshots.createdAt))
        .limit(1);
      return rows.map((r) => r.id);
    }
    if (plat === "BUSINESS_WEBSITE" || plat === "WEBSITE") {
      const rows = await db
        .select({ id: websiteSnapshots.id })
        .from(websiteSnapshots)
        .where(
          and(
            eq(websiteSnapshots.accountId, task.accountId),
            eq(websiteSnapshots.campaignId, task.campaignId)
          )
        )
        .orderBy(desc(websiteSnapshots.createdAt))
        .limit(1);
      return rows.map((r) => r.id);
    }
    if (task.entityType === "OWNED") {
      const rows = await db
        .select({ id: ownedPosts.id })
        .from(ownedPosts)
        .where(
          and(
            eq(ownedPosts.accountId, task.accountId),
            eq(ownedPosts.campaignId, task.campaignId),
            eq(ownedPosts.platform, plat.toLowerCase())
          )
        )
        .orderBy(desc(ownedPosts.lastSeenAt))
        .limit(maxRows);
      return rows.map((r) => r.id);
    }
  } catch (err) {
    console.warn(`[AcquisitionAuthority] Non-fatal error resolving evidence IDs for task=${task.id}:`, err);
  }
  return [];
}

/**
 * Stamps lineage (`acquisition_task_id`, `provider_run_id`, `observation_id`) onto newly
 * written normalized evidence rows.
 */
async function stampLineageOnNormalizedEvidence(params: {
  task: AcquisitionTask;
  providerRunId: string | null;
  observationId: string | null;
  evidenceIds: string[];
}): Promise<void> {
  const { task, providerRunId, observationId, evidenceIds } = params;
  if (!evidenceIds || evidenceIds.length === 0) return;

  const plat = task.sourcePlatform.toUpperCase();
  const cap = (task.capability || task.taskType || "").toUpperCase();

  try {
    if (
      task.entityType === "COMPETITOR" &&
      ["INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "X", "FACEBOOK", "BLOG", "GOOGLE_SEARCH"].includes(plat) &&
      (cap === "POSTS" || cap === "PROFILE_POSTS" || cap === "SEARCH_QUOTES")
    ) {
      await db
        .update(ciCompetitorPosts)
        .set({
          acquisitionTaskId: task.id,
          providerRunId: providerRunId || undefined,
          observationId: observationId || undefined,
        })
        .where(and(eq(ciCompetitorPosts.accountId, task.accountId), inArray(ciCompetitorPosts.id, evidenceIds)));
    } else if (
      task.entityType === "COMPETITOR" &&
      ["INSTAGRAM", "YOUTUBE", "TIKTOK"].includes(plat) &&
      cap === "COMMENTS"
    ) {
      await db
        .update(ciCompetitorComments)
        .set({
          acquisitionTaskId: task.id,
          providerRunId: providerRunId || undefined,
          observationId: observationId || undefined,
        })
        .where(and(eq(ciCompetitorComments.accountId, task.accountId), inArray(ciCompetitorComments.id, evidenceIds)));
    } else if (
      task.entityType === "COMPETITOR" &&
      ["GOOGLE_REVIEWS", "GOOGLE", "TRUSTPILOT", "TRENDYOL", "G2", "CAPTERRA"].includes(plat) &&
      cap === "REVIEWS"
    ) {
      await db
        .update(ciCompetitorReviews)
        .set({
          acquisitionTaskId: task.id,
          providerRunId: providerRunId || undefined,
          observationId: observationId || undefined,
        })
        .where(and(eq(ciCompetitorReviews.accountId, task.accountId), inArray(ciCompetitorReviews.id, evidenceIds)));
    } else if (task.entityType === "OWNED") {
      await db
        .update(ownedPosts)
        .set({
          acquisitionTaskId: task.id,
          providerRunId: providerRunId || undefined,
          observationId: observationId || undefined,
        })
        .where(and(eq(ownedPosts.accountId, task.accountId), inArray(ownedPosts.id, evidenceIds)));
    }
  } catch (err) {
    console.warn(`[AcquisitionAuthority] Non-fatal lineage stamp error on task=${task.id}:`, err);
  }
}

/**
 * Checks concurrency limits across global, provider, actor, and tenant scopes.
 */
async function canAcquireConcurrencySlot(params: {
  accountId: string;
  provider: string;
  actorId: string | null;
}): Promise<{ allowed: boolean; reason?: string }> {
  const cfg = currentPoolConfig;
  const runningRows = await db
    .select({
      accountId: acquisitionTasks.accountId,
      provider: acquisitionTasks.provider,
      actorId: acquisitionTasks.actorId,
    })
    .from(acquisitionTasks)
    .where(
      and(
        eq(acquisitionTasks.status, "RUNNING"),
        gt(acquisitionTasks.leasedUntil, new Date())
      )
    );

  if (runningRows.length >= cfg.maxGlobalConcurrent) {
    return { allowed: false, reason: `GLOBAL_CONCURRENCY_LIMIT (${cfg.maxGlobalConcurrent})` };
  }

  const tenantRunning = runningRows.filter((r) => r.accountId === params.accountId).length;
  if (tenantRunning >= cfg.maxPerTenant) {
    return { allowed: false, reason: `TENANT_CONCURRENCY_LIMIT (${cfg.maxPerTenant})` };
  }

  const provLimit = cfg.maxPerProvider[params.provider.toUpperCase()] ?? cfg.maxGlobalConcurrent;
  const provRunning = runningRows.filter((r) => (r.provider || "APIFY").toUpperCase() === params.provider.toUpperCase()).length;
  if (provRunning >= provLimit) {
    return { allowed: false, reason: `PROVIDER_CONCURRENCY_LIMIT (${params.provider}=${provLimit})` };
  }

  if (params.actorId) {
    const actorLimit = cfg.maxPerActor[params.actorId] ?? cfg.maxPerActor.DEFAULT ?? 2;
    const actorRunning = runningRows.filter((r) => r.actorId === params.actorId).length;
    if (actorRunning >= actorLimit) {
      return { allowed: false, reason: `ACTOR_CONCURRENCY_LIMIT (${params.actorId}=${actorLimit})` };
    }
  }

  return { allowed: true };
}

/**
 * Extends a running task's lease and updates `heartbeat_at`.
 */
export async function heartbeatTaskLease(
  taskId: string,
  fencingToken: number,
  leaseDurationSec = currentPoolConfig.leaseDurationSec
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE acquisition_tasks
    SET heartbeat_at = NOW(),
        leased_until = NOW() + (${leaseDurationSec} || ' seconds')::interval,
        updated_at = NOW()
    WHERE id = ${taskId}
      AND fencing_token = ${fencingToken}
      AND status = 'RUNNING'
  `);
  const rowCount = (res as any)?.rowCount ?? 1;
  return rowCount > 0;
}

/**
 * Atomically claims a specific task or the next eligible task in the queue.
 * Respects `next_retry_at <= NOW()`, active leases (`leased_until < NOW()`),
 * and fair scheduling (`priority DESC, COALESCE(next_retry_at, created_at) ASC`).
 */
export async function claimAuthorityTask(params: {
  workerId: string;
  campaignId?: string;
  specificTaskId?: string;
  leaseDurationSec?: number;
}): Promise<{ task: AcquisitionTask; fencingToken: number } | null> {
  const leaseSec = params.leaseDurationSec ?? currentPoolConfig.leaseDurationSec;

  const whereClause = params.specificTaskId
    ? sql`id = ${params.specificTaskId}
          AND (status = 'PENDING' OR status = 'DEFERRED' OR (status = 'RUNNING' AND leased_until < NOW()))
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          AND retry_count <= max_retries`
    : params.campaignId
      ? sql`campaign_id = ${params.campaignId}
            AND (status = 'PENDING' OR (status = 'RUNNING' AND leased_until < NOW()))
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
            AND retry_count <= max_retries`
      : sql`(status = 'PENDING' OR (status = 'RUNNING' AND leased_until < NOW()))
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
            AND retry_count <= max_retries`;

  const query = sql`
    UPDATE acquisition_tasks
    SET status = 'RUNNING',
        lease_owner = ${params.workerId},
        heartbeat_at = NOW(),
        leased_until = NOW() + (${leaseSec} || ' seconds')::interval,
        fencing_token = fencing_token + 1,
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM acquisition_tasks
      WHERE ${whereClause}
      ORDER BY priority DESC, COALESCE(next_retry_at, created_at) ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;

  const result = await db.execute(query);
  const rows = (result as any)?.rows || (result as any) || [];
  if (rows.length === 0) return null;

  const raw = rows[0];
  const [hydrated] = await db
    .select()
    .from(acquisitionTasks)
    .where(eq(acquisitionTasks.id, raw.id))
    .limit(1);

  if (!hydrated) return null;
  return { task: hydrated, fencingToken: hydrated.fencingToken };
}

/**
 * Fans out task outcome to all non-cancelled `acquisition_requests` rows joined to `taskId`.
 */
async function fanOutOutcomeToRequests(params: {
  taskId: string;
  attemptId: string | null;
  status: "COMPLETED" | "FAILED" | "SKIPPED" | "DEFERRED";
  terminalOutcome: TerminalOutcome;
  errorCode: AcquisitionErrorCode | null;
  errorMessage: string | null;
  provider: string;
  actorId: string | null;
  providerRunId: string | null;
  datasetId: string | null;
  itemsStored: number;
  observationIds: string[];
  normalizedEvidenceIds: string[];
  consumerDeliveryStatus: string;
  usageUsd: number | null;
  retryDecision?: string | null;
}): Promise<void> {
  await db
    .update(acquisitionRequests)
    .set({
      attemptId: params.attemptId,
      status: params.status,
      terminalOutcome: params.terminalOutcome,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage ? sanitizeLogString(params.errorMessage) : null,
      retryDecision: params.retryDecision || null,
      provider: params.provider,
      actorId: params.actorId,
      providerRunId: params.providerRunId,
      datasetId: params.datasetId,
      itemsStored: params.itemsStored,
      observationIds: params.observationIds,
      normalizedEvidenceIds: params.normalizedEvidenceIds,
      consumerDeliveryStatus: params.consumerDeliveryStatus,
      usageUsd: sql`CASE WHEN ${acquisitionRequests.resolutionType} = 'NEW_FETCH' THEN ${params.usageUsd} ELSE NULL END`,
      completedAt: new Date(),
      deliveredAt: params.consumerDeliveryStatus === "DELIVERED" ? new Date() : null,
    })
    .where(
      and(
        eq(acquisitionRequests.taskId, params.taskId),
        sql`${acquisitionRequests.status} != 'CANCELLED'`
      )
    );
}

/**
 * Executes a claimed task inside the canonical authority lifecycle:
 * - Heartbeat timer
 * - Attempt record (`acquisition_attempts`)
 * - Immediate `provider_run_id` persistence via `runWithAttemptContext`
 * - Crash-window reconciliation & `resumeRunId` support
 * - Raw observation persistence (`raw_acquisition_observations`)
 * - Normalized evidence lineage stamping
 * - Bounded retry scheduling (`next_retry_at`) or terminal fan-out
 */
export async function executeClaimedAuthorityTask(
  claim: { task: AcquisitionTask; fencingToken: number },
  workerId: string,
  options: { forceRefresh?: boolean; orchestrationJobId?: string } = {}
): Promise<{
  status: "COMPLETED" | "FAILED" | "SKIPPED" | "RETRY_SCHEDULED";
  attemptId: string;
  terminalOutcome: TerminalOutcome;
  errorCode: AcquisitionErrorCode | null;
  errorMessage: string | null;
  providerRunId: string | null;
  datasetId: string | null;
  itemsStored: number;
  observationIds: string[];
  normalizedEvidenceIds: string[];
  usageUsd: number | null;
  output: any;
}> {
  const { task, fencingToken } = claim;
  const startMs = Date.now();
  const attemptId = `aatt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const attemptNumber = (task.retryCount || 0) + 1;

  const inferred = inferDefaultProviderAndActor(
    task.sourcePlatform,
    task.capability || task.taskType
  );
  let provider = task.provider || inferred.provider;
  let actorId = task.actorId || inferred.actorId;

  // Check if a previous attempt crashed in 'STARTING' without recording provider_run_id
  let reconcileStartedAfterIso: string | null = null;
  if (!task.providerRunId && attemptNumber > 1) {
    const prevAttempts = await db
      .select()
      .from(acquisitionAttempts)
      .where(eq(acquisitionAttempts.taskId, task.id))
      .orderBy(desc(acquisitionAttempts.startedAt))
      .limit(1);
    const prev = prevAttempts[0];
    if (prev && prev.status === "STARTING" && prev.startedAt) {
      reconcileStartedAfterIso = prev.startedAt.toISOString();
    }
  }

  // Insert attempt row
  const sanitizedInput = sanitizeInputForPersistence((task.inputPayload || {}) as Record<string, any>);
  const inputHash = createHash("sha256").update(JSON.stringify(sanitizedInput)).digest("hex");
  await db.insert(acquisitionAttempts).values({
    id: attemptId,
    taskId: task.id,
    accountId: task.accountId,
    campaignId: task.campaignId,
    attemptNumber,
    provider,
    actorId,
    providerRunId: task.providerRunId || null,
    status: "STARTING",
    inputHash,
    sanitizedInput,
  });

  // Start periodic lease heartbeat
  const heartbeatTimer = setInterval(() => {
    heartbeatTaskLease(task.id, fencingToken).catch(() => {});
  }, currentPoolConfig.heartbeatIntervalMs);

  let capturedRunId: string | null = task.providerRunId || null;
  let capturedDatasetId: string | null = task.datasetId || null;
  let capturedUsageUsd: number | null = task.usageUsd ?? null;

  try {
    const customExec = customExecutorRegistry.get(task.id);

    const execResult = await runWithAttemptContext(
      {
        taskId: task.id,
        attemptId,
        resumeRunId: task.providerRunId || null,
        reconcileStartedAfterIso,
        onRunStarted: async ({ runId, actorId: startedActorId, defaultDatasetId }) => {
          capturedRunId = runId;
          if (startedActorId) actorId = startedActorId;
          if (defaultDatasetId) capturedDatasetId = defaultDatasetId;
          // Immediately persist provider_run_id BEFORE polling begins!
          await db
            .update(acquisitionAttempts)
            .set({
              providerRunId: runId,
              datasetId: capturedDatasetId || undefined,
              actorId: actorId || undefined,
              status: "POLLING",
            })
            .where(eq(acquisitionAttempts.id, attemptId));

          await db
            .update(acquisitionTasks)
            .set({
              providerRunId: runId,
              datasetId: capturedDatasetId || undefined,
              actorId: actorId || undefined,
              updatedAt: new Date(),
            })
            .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));

          await db
            .update(acquisitionRequests)
            .set({
              providerRunId: runId,
              datasetId: capturedDatasetId || undefined,
              actorId: actorId || undefined,
              attemptId,
              status: "RUNNING",
            })
            .where(
              and(
                eq(acquisitionRequests.taskId, task.id),
                sql`${acquisitionRequests.status} != 'CANCELLED'`
              )
            );
        },
        onRunCompleted: async (runResult) => {
          if (runResult.runId) capturedRunId = runResult.runId;
          if (runResult.datasetId) capturedDatasetId = runResult.datasetId;
          if (runResult.actorId) actorId = runResult.actorId;
          if (typeof runResult.usageUsd === "number") {
            capturedUsageUsd = (capturedUsageUsd ?? 0) + runResult.usageUsd;
          }
        },
      },
      async (): Promise<CustomAdapterExecutionResult> => {
        if (customExec) {
          return await customExec({
            taskId: task.id,
            attemptId,
            fencingToken,
            resumeRunId: task.providerRunId || null,
            inputPayload: (task.inputPayload || {}) as Record<string, any>,
          });
        }

        // Standard provider-registry dispatch
        const { dispatchAcquisitionTask } = await import(
          "../competitive-intelligence/provider-registry"
        );
        const dispatchRes = await dispatchAcquisitionTask(task, {
          forceRefresh: options.forceRefresh ?? true,
          orchestrationJobId: options.orchestrationJobId,
        });

        const out = (dispatchRes.output || {}) as Record<string, any>;
        const itemsStored =
          typeof out.itemsStored === "number"
            ? out.itemsStored
            : typeof out.postsStored === "number"
              ? out.postsStored
              : typeof out.postsCollected === "number"
                ? out.postsCollected
                : typeof out.postsCount === "number"
                  ? out.postsCount
                  : typeof out.acceptedCount === "number"
                    ? out.acceptedCount
                    : typeof out.commentsStored === "number"
                      ? out.commentsStored
                      : typeof out.commentsCollected === "number"
                        ? out.commentsCollected
                        : typeof out.commentsGenerated === "number"
                          ? out.commentsGenerated
                          : typeof out.reviewsStored === "number"
                            ? out.reviewsStored
                            : typeof out.count === "number"
                              ? out.count
                              : typeof out.quotesStored === "number"
                                ? out.quotesStored
                                : typeof out.extractedEvidenceCount === "number"
                                  ? out.extractedEvidenceCount
                                  : typeof out.pagesCrawled === "number"
                                    ? out.pagesCrawled
                                    : typeof out.itemsCount === "number"
                                      ? out.itemsCount
                                      : typeof out.snapshotId === "string" &&
                                          out.snapshotId !== "none" &&
                                          out.status !== "INCOMPLETE" &&
                                          out.status !== "FAILED"
                                        ? 1
                                        : 0;

        const isPartialCoverage = out.isPartialCoverage === true;
        // Requirement #1: An actor returning zero items does NOT prove that the source contains no content.
        // Only classify as CONFIRMED_EMPTY_SOURCE when the adapter explicitly sets isConfirmedEmpty === true
        // from positive source metadata (e.g., totalCount === 0) or retrieved post timestamps outside window.
        const isConfirmedEmpty = out.isConfirmedEmpty === true;

        return {
          status:
            dispatchRes.status === "COMPLETED"
              ? itemsStored === 0
                ? isConfirmedEmpty
                  ? "EMPTY_CONFIRMED"
                  : isPartialCoverage
                    ? "PARTIAL_COVERAGE"
                    : "EMPTY_INCONCLUSIVE"
                : "COMPLETED"
              : dispatchRes.status,
          provider,
          actorId: out.actorId || actorId,
          providerRunId: out.runId || capturedRunId,
          datasetId: out.datasetId || capturedDatasetId,
          usageUsd: typeof out.usageUsd === "number" ? out.usageUsd : capturedUsageUsd,
          itemsStored,
          normalizedEvidenceIds: Array.isArray(out.persistedIds) && out.persistedIds.length > 0 ? out.persistedIds : undefined,
          isConfirmedEmpty,
          isPartialCoverage,
          output: out,
          rawPayload: out,
          error: dispatchRes.error,
        };
      }
    );

    if (execResult.provider) provider = execResult.provider;
    if (execResult.actorId) actorId = execResult.actorId;
    if (execResult.providerRunId) capturedRunId = execResult.providerRunId;
    if (execResult.datasetId) capturedDatasetId = execResult.datasetId;
    if (typeof execResult.usageUsd === "number") capturedUsageUsd = execResult.usageUsd;

    // Check fencing token before committing results
    const [currentTaskRow] = await db
      .select({ fencingToken: acquisitionTasks.fencingToken, status: acquisitionTasks.status })
      .from(acquisitionTasks)
      .where(eq(acquisitionTasks.id, task.id))
      .limit(1);

    if (!currentTaskRow || currentTaskRow.fencingToken !== fencingToken) {
      throw new Error(`FENCING_TOKEN_REJECTED: stale worker fencingToken=${fencingToken}`);
    }

    if (
      execResult.status === "SKIPPED_PENDING_CONFIG" ||
      execResult.status === "SKIPPED_UNSUPPORTED"
    ) {
      const durationMs = Date.now() - startMs;
      await db
        .update(acquisitionAttempts)
        .set({
          status: "SKIPPED",
          errorCode: "MISSING_ACTOR_OR_UNSUPPORTED",
          errorMessage: execResult.error || execResult.status,
          durationMs,
          completedAt: new Date(),
        })
        .where(eq(acquisitionAttempts.id, attemptId));

      await db
        .update(acquisitionTasks)
        .set({
          status: "SKIPPED",
          terminalOutcome: "MISSING_ACTOR_OR_UNSUPPORTED",
          errorCode: "MISSING_ACTOR_OR_UNSUPPORTED",
          errorMessage: execResult.error || execResult.status,
          outputSummary: execResult.output || { status: execResult.status },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));

      await fanOutOutcomeToRequests({
        taskId: task.id,
        attemptId,
        status: "SKIPPED",
        terminalOutcome: "MISSING_ACTOR_OR_UNSUPPORTED",
        errorCode: "MISSING_ACTOR_OR_UNSUPPORTED",
        errorMessage: execResult.error || execResult.status,
        provider,
        actorId,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        itemsStored: 0,
        observationIds: [],
        normalizedEvidenceIds: [],
        consumerDeliveryStatus: "SKIPPED_UNSUPPORTED",
        usageUsd: capturedUsageUsd,
      });

      customExecutorRegistry.delete(task.id);
      notifyTaskWaiters(task.id);
      return {
        status: "SKIPPED",
        attemptId,
        terminalOutcome: "MISSING_ACTOR_OR_UNSUPPORTED",
        errorCode: "MISSING_ACTOR_OR_UNSUPPORTED",
        errorMessage: execResult.error || execResult.status,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        itemsStored: 0,
        observationIds: [],
        normalizedEvidenceIds: [],
        usageUsd: capturedUsageUsd,
        output: execResult.output,
      };
    }

    if (execResult.status === "FAILED") {
      const err: any = new Error(execResult.error || "Adapter returned FAILED");
      if (execResult.httpStatus) err.httpStatus = execResult.httpStatus;
      if (execResult.retryAfterMs) err.retryAfterMs = execResult.retryAfterMs;
      throw err;
    }

    // Success / Confirmed Empty / Partial Coverage path
    const itemsStored = execResult.itemsStored ?? 0;
    const isConfirmedEmpty =
      execResult.status === "EMPTY_CONFIRMED" || execResult.isConfirmedEmpty === true;
    const isPartialCoverage =
      execResult.status === "PARTIAL_COVERAGE" || execResult.isPartialCoverage === true;

    const decision = classifyAcquisitionError({
      itemsCount: itemsStored,
      isConfirmedEmpty,
      isPartialCoverage,
      httpStatus: execResult.httpStatus ?? 200,
    });

    // Persist raw observation row
    const obsId = `robs_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const rawPayloadObj = execResult.rawPayload ?? execResult.output ?? { itemsStored };
    const rawJsonStr = JSON.stringify(rawPayloadObj);
    const contentHash = createHash("sha256").update(rawJsonStr).digest("hex");

    await db.insert(rawAcquisitionObservations).values({
      id: obsId,
      accountId: task.accountId,
      campaignId: task.campaignId,
      taskId: task.id,
      attemptId,
      providerRunId: capturedRunId,
      entityType: task.entityType,
      entityId: task.entityId,
      sourceId: task.sourceId || null,
      platform: task.sourcePlatform,
      capability: task.capability || task.taskType,
      canonicalUrl: task.canonicalUrl || null,
      contentHash,
      itemCount: itemsStored,
      rawPayload: rawPayloadObj,
      coverageStatus:
        itemsStored === 0
          ? isConfirmedEmpty
            ? "EMPTY_CONFIRMED"
            : isPartialCoverage
              ? "PARTIAL"
              : "EMPTY_INCONCLUSIVE"
          : isPartialCoverage
            ? "PARTIAL"
            : "COMPLETE",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    const normalizedEvidenceIds = await resolveNormalizedEvidenceIdsForTask(
      task,
      execResult.normalizedEvidenceIds,
      itemsStored
    );

    await stampLineageOnNormalizedEvidence({
      task,
      providerRunId: capturedRunId,
      observationId: obsId,
      evidenceIds: normalizedEvidenceIds,
    });

    const outSummaryObj = (execResult.output || {}) as Record<string, any>;
    const rawItemCount =
      typeof outSummaryObj.rawCount === "number" ? outSummaryObj.rawCount : itemsStored;
    const acceptedItemCount =
      typeof outSummaryObj.acceptedCount === "number" ? outSummaryObj.acceptedCount : itemsStored;

    const durationMs = Date.now() - startMs;
    await db
      .update(acquisitionAttempts)
      .set({
        status: "SUCCEEDED",
        provider,
        actorId,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        rawItemCount,
        acceptedItemCount,
        usageUsd: capturedUsageUsd,
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(acquisitionAttempts.id, attemptId));

    const enrichedOutput = {
      ...(execResult.output || {}),
      itemsStored,
      observationIds: [obsId],
      normalizedEvidenceIds,
      providerRunId: capturedRunId,
      datasetId: capturedDatasetId,
      usageUsd: capturedUsageUsd,
      terminalOutcome: decision.terminalOutcome,
    };

    await db
      .update(acquisitionTasks)
      .set({
        status: "COMPLETED",
        provider,
        actorId,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        usageUsd: capturedUsageUsd,
        terminalOutcome: decision.terminalOutcome,
        errorCode: decision.errorCode,
        errorMessage: null,
        paginationCursor: execResult.nextPageCursor
          ? { cursor: execResult.nextPageCursor }
          : task.paginationCursor,
        outputSummary: enrichedOutput,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));

    const deliveryStatus =
      itemsStored > 0
        ? "DELIVERED"
        : isConfirmedEmpty
          ? "EMPTY_CONFIRMED"
          : "EMPTY_INCONCLUSIVE";

    await fanOutOutcomeToRequests({
      taskId: task.id,
      attemptId,
      status: "COMPLETED",
      terminalOutcome: decision.terminalOutcome,
      errorCode: decision.errorCode,
      errorMessage: null,
      provider,
      actorId,
      providerRunId: capturedRunId,
      datasetId: capturedDatasetId,
      itemsStored,
      observationIds: [obsId],
      normalizedEvidenceIds,
      consumerDeliveryStatus: deliveryStatus,
      usageUsd: capturedUsageUsd,
    });

    customExecutorRegistry.delete(task.id);
    notifyTaskWaiters(task.id);

    return {
      status: "COMPLETED",
      attemptId,
      terminalOutcome: decision.terminalOutcome,
      errorCode: decision.errorCode,
      errorMessage: null,
      providerRunId: capturedRunId,
      datasetId: capturedDatasetId,
      itemsStored,
      observationIds: [obsId],
      normalizedEvidenceIds,
      usageUsd: capturedUsageUsd,
      output: enrichedOutput,
    };
  } catch (err: any) {
    if (err instanceof ApifyPollingTimeoutError && err.runId) {
      capturedRunId = err.runId;
    }

    const decision = classifyAcquisitionError({
      error: err,
      httpStatus: err?.httpStatus ?? null,
      retryAfterMs: err?.retryAfterMs ?? null,
    });

    const durationMs = Date.now() - startMs;
    const sanitizedErr = sanitizeLogString(err?.message || String(err));

    await db
      .update(acquisitionAttempts)
      .set({
        status: "FAILED",
        provider,
        actorId,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        errorCode: decision.errorCode || "ACQUISITION_FAILED",
        errorMessage: sanitizedErr,
        retryDecision: decision.retryable ? "RETRY_BACKOFF" : "TERMINAL_NO_RETRY",
        usageUsd: capturedUsageUsd,
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(acquisitionAttempts.id, attemptId));

    const maxRetries = task.maxRetries ?? currentPoolConfig.defaultMaxRetries;
    const nextRetryCount = (task.retryCount || 0) + 1;
    const canRetry = decision.retryable && nextRetryCount <= maxRetries;

    if (canRetry) {
      const backoffMs = computeBoundedBackoffMs(nextRetryCount, decision);
      const nextRetryAt = new Date(Date.now() + backoffMs);

      // Note: On ApifyPollingTimeoutError, `capturedRunId` stays on `provider_run_id` so the next
      // retry resumes polling that run instead of starting a new paid run!
      // For other errors where the Apify run itself failed terminally, clear `provider_run_id`
      // so the next retry starts a fresh run.
      const preserveRunIdForResume =
        err instanceof ApifyPollingTimeoutError || decision.errorCode === "TIMEOUT"
          ? capturedRunId
          : null;

      await db
        .update(acquisitionTasks)
        .set({
          status: "PENDING",
          leaseOwner: null,
          leasedUntil: null,
          retryCount: nextRetryCount,
          nextRetryAt,
          provider,
          actorId,
          providerRunId: preserveRunIdForResume,
          errorCode: decision.errorCode,
          errorMessage: sanitizedErr,
          updatedAt: new Date(),
        })
        .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));

      await db
        .update(acquisitionRequests)
        .set({
          attemptId,
          errorCode: decision.errorCode,
          errorMessage: sanitizedErr,
          retryDecision: `RETRY_SCHEDULED_${backoffMs}MS`,
          providerRunId: capturedRunId,
        })
        .where(
          and(
            eq(acquisitionRequests.taskId, task.id),
            sql`${acquisitionRequests.status} != 'CANCELLED'`
          )
        );

      return {
        status: "RETRY_SCHEDULED",
        attemptId,
        terminalOutcome: decision.terminalOutcome,
        errorCode: decision.errorCode,
        errorMessage: sanitizedErr,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        itemsStored: 0,
        observationIds: [],
        normalizedEvidenceIds: [],
        usageUsd: capturedUsageUsd,
        output: { nextRetryAt: nextRetryAt.toISOString(), backoffMs },
      };
    }

    // Terminal failure: either non-retryable error class or max_retries exhausted
    await db
      .update(acquisitionTasks)
      .set({
        status: "FAILED",
        leaseOwner: null,
        leasedUntil: null,
        retryCount: nextRetryCount,
        provider,
        actorId,
        providerRunId: capturedRunId,
        datasetId: capturedDatasetId,
        usageUsd: capturedUsageUsd,
        terminalOutcome: decision.terminalOutcome,
        errorCode: decision.errorCode || "ACQUISITION_FAILED",
        errorMessage: sanitizedErr,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));

    await fanOutOutcomeToRequests({
      taskId: task.id,
      attemptId,
      status: "FAILED",
      terminalOutcome: decision.terminalOutcome,
      errorCode: decision.errorCode || "ACQUISITION_FAILED",
      errorMessage: sanitizedErr,
      provider,
      actorId,
      providerRunId: capturedRunId,
      datasetId: capturedDatasetId,
      itemsStored: 0,
      observationIds: [],
      normalizedEvidenceIds: [],
      consumerDeliveryStatus: "FAILED",
      usageUsd: capturedUsageUsd,
      retryDecision: decision.retryable ? "MAX_RETRIES_EXHAUSTED" : "NON_RETRYABLE_TERMINAL",
    });

    customExecutorRegistry.delete(task.id);
    notifyTaskWaiters(task.id);

    return {
      status: "FAILED",
      attemptId,
      terminalOutcome: decision.terminalOutcome,
      errorCode: decision.errorCode || "ACQUISITION_FAILED",
      errorMessage: sanitizedErr,
      providerRunId: capturedRunId,
      datasetId: capturedDatasetId,
      itemsStored: 0,
      observationIds: [],
      normalizedEvidenceIds: [],
      usageUsd: capturedUsageUsd,
      output: null,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

/**
 * Cancels an individual consumer's acquisition request (`areq_*`).
 * Shared work (`acq_*`) is only cancelled if NO other active consumer requests remain attached to it.
 */
export async function cancelAcquisitionRequest(requestId: string): Promise<{
  requestCancelled: boolean;
  underlyingTaskCancelled: boolean;
}> {
  const [reqRow] = await db
    .select()
    .from(acquisitionRequests)
    .where(eq(acquisitionRequests.id, requestId))
    .limit(1);

  if (!reqRow) {
    return { requestCancelled: false, underlyingTaskCancelled: false };
  }

  await db
    .update(acquisitionRequests)
    .set({
      status: "CANCELLED",
      consumerDeliveryStatus: "CANCELLED",
      completedAt: new Date(),
    })
    .where(eq(acquisitionRequests.id, requestId));

  if (!reqRow.taskId) {
    return { requestCancelled: true, underlyingTaskCancelled: false };
  }

  const remainingActive = await db
    .select({ id: acquisitionRequests.id })
    .from(acquisitionRequests)
    .where(
      and(
        eq(acquisitionRequests.taskId, reqRow.taskId),
        inArray(acquisitionRequests.status, ["PENDING", "RUNNING"])
      )
    );

  if (remainingActive.length === 0) {
    await db
      .update(acquisitionTasks)
      .set({
        status: "CANCELLED",
        leaseOwner: null,
        leasedUntil: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(acquisitionTasks.id, reqRow.taskId),
          inArray(acquisitionTasks.status, ["PENDING", "RUNNING", "DEFERRED"])
        )
      );
    customExecutorRegistry.delete(reqRow.taskId);
    notifyTaskWaiters(reqRow.taskId);
    return { requestCancelled: true, underlyingTaskCancelled: true };
  }

  return { requestCancelled: true, underlyingTaskCancelled: false };
}

/**
 * Canonical entry point for requesting any external data acquisition across Avyron.
 * Records WHO requested the data in `acquisition_requests`, evaluates freshness-aware
 * cache reuse (`CACHE_REUSE`) and in-flight coalescing (`JOINED_INFLIGHT`), or schedules
 * and executes a durable `acquisition_tasks` item.
 */
export async function requestAcquisition(
  input: AcquisitionRequestInput
): Promise<AcquisitionRequestOutcome> {
  const requestId = `areq_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const freshnessTtlSec = input.freshnessTtlSec ?? currentPoolConfig.defaultFreshnessTtlSec;
  const inferred = inferDefaultProviderAndActor(input.platform, input.capability);
  const provider = input.provider || inferred.provider;
  const actorId = input.actorId !== undefined ? input.actorId : inferred.actorId;
  const executeInline = input.executeInline !== false;

  const sanitizedPayload = sanitizeInputForPersistence({
    ...(input.inputPayload || {}),
    sourceId: input.sourceId || input.inputPayload?.sourceId || null,
    canonicalUrl: input.canonicalUrl || input.inputPayload?.canonicalUrl || null,
    handle: input.externalAccountId || input.inputPayload?.handle || null,
  });

  // 1. Always record the consumer request first
  await db.insert(acquisitionRequests).values({
    id: requestId,
    accountId: input.accountId,
    campaignId: input.campaignId,
    requesterEngine: input.requesterEngine,
    trigger: input.trigger,
    parentJobId: input.parentJobId || null,
    strategyVersion: input.strategyVersion ?? null,
    monitoringCycleId: input.monitoringCycleId || null,
    performanceCycleId: input.performanceCycleId || null,
    entityType: input.entityType.toUpperCase(),
    entityId: input.entityId,
    sourceId: input.sourceId || null,
    platform: input.platform.toUpperCase(),
    canonicalUrl: input.canonicalUrl || null,
    externalAccountId: input.externalAccountId || null,
    capability: input.capability.toUpperCase(),
    timeWindowDays: input.timeWindowDays ?? null,
    itemLimit: input.itemLimit ?? null,
    freshnessTtlSec,
    resolutionType: "NEW_FETCH",
    status: "PENDING",
    provider,
    actorId,
    consumerDeliveryStatus: "PENDING",
  });

  // 2. Check for Freshness-Aware Cache Reuse (if not forceRefresh)
  if (!input.forceRefresh && freshnessTtlSec > 0) {
    const cutoff = new Date(Date.now() - freshnessTtlSec * 1000);
    const recentCompleted = await db
      .select()
      .from(acquisitionTasks)
      .where(
        and(
          eq(acquisitionTasks.accountId, input.accountId),
          eq(acquisitionTasks.entityType, input.entityType.toUpperCase()),
          eq(acquisitionTasks.sourcePlatform, input.platform.toUpperCase()),
          eq(acquisitionTasks.status, "COMPLETED"),
          gte(acquisitionTasks.completedAt, cutoff)
        )
      )
      .orderBy(desc(acquisitionTasks.completedAt))
      .limit(25);

    // Do not reuse INCONCLUSIVE_ZERO_RESULT tasks from cache — an inconclusive 0-item run does not prove
    // the source is empty and should allow fresh acquisition when requested.
    const compatibleCached = recentCompleted.find(
      (t) =>
        t.terminalOutcome !== "INCONCLUSIVE_ZERO_RESULT" &&
        isTaskCompatibleWithRequest(t, input)
    );

    if (compatibleCached) {
      const out = (compatibleCached.outputSummary || {}) as Record<string, any>;
      const itemsStored = typeof out.itemsStored === "number" ? out.itemsStored : 0;
      const observationIds = Array.isArray(out.observationIds) ? out.observationIds : [];
      const normalizedEvidenceIds =
        itemsStored > 0
          ? Array.isArray(out.normalizedEvidenceIds)
            ? out.normalizedEvidenceIds
            : await resolveNormalizedEvidenceIdsForTask(compatibleCached, undefined, itemsStored)
          : [];
      const terminalOutcome: TerminalOutcome =
        (compatibleCached.terminalOutcome as TerminalOutcome) ||
        (itemsStored > 0 ? "SUCCESS_WITH_CONTENT" : "CONFIRMED_EMPTY_SOURCE");
      const cachedDeliveryStatus =
        itemsStored > 0
          ? "DELIVERED"
          : terminalOutcome === "CONFIRMED_EMPTY_SOURCE"
            ? "EMPTY_CONFIRMED"
            : "EMPTY_INCONCLUSIVE";

      const existingConsumers = Array.isArray(compatibleCached.sharedConsumerCampaignIds)
        ? (compatibleCached.sharedConsumerCampaignIds as string[])
        : [];
      const sharedConsumers = Array.from(
        new Set([compatibleCached.campaignId, ...existingConsumers, input.campaignId])
      );

      if (compatibleCached.campaignId !== input.campaignId) {
        await db
          .update(acquisitionTasks)
          .set({
            sharedConsumerCampaignIds: sharedConsumers,
            attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
            updatedAt: new Date(),
          })
          .where(eq(acquisitionTasks.id, compatibleCached.id));
      }

      await db
        .update(acquisitionRequests)
        .set({
          taskId: compatibleCached.id,
          resolutionType: "CACHE_REUSE",
          dataReuseStatus: "REUSED_FROM_CACHE",
          attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
          sharedConsumerCampaignIds: sharedConsumers,
          status: "COMPLETED",
          terminalOutcome,
          provider: compatibleCached.provider || provider,
          actorId: compatibleCached.actorId || actorId,
          providerRunId: compatibleCached.providerRunId || null,
          datasetId: compatibleCached.datasetId || null,
          itemsStored,
          observationIds,
          normalizedEvidenceIds,
          consumerDeliveryStatus: cachedDeliveryStatus,
          usageUsd: null,
          completedAt: new Date(),
          deliveredAt: new Date(),
        })
        .where(eq(acquisitionRequests.id, requestId));

      return {
        requestId,
        taskId: compatibleCached.id,
        attemptId: null,
        resolutionType: "CACHE_REUSE",
        status: "COMPLETED",
        terminalOutcome,
        errorCode: null,
        errorMessage: null,
        provider: compatibleCached.provider || provider,
        actorId: compatibleCached.actorId || actorId,
        providerRunId: compatibleCached.providerRunId || null,
        datasetId: compatibleCached.datasetId || null,
        itemsStored,
        observationIds,
        normalizedEvidenceIds,
        consumerDeliveryStatus: cachedDeliveryStatus,
        usageUsd: null,
        output: out,
      };
    }
  }

  // 3. Check for Compatible In-Flight Task (`JOINED_INFLIGHT`)
  const activeCandidates = await db
    .select()
    .from(acquisitionTasks)
    .where(
      and(
        eq(acquisitionTasks.accountId, input.accountId),
        eq(acquisitionTasks.entityType, input.entityType.toUpperCase()),
        eq(acquisitionTasks.sourcePlatform, input.platform.toUpperCase()),
        inArray(acquisitionTasks.status, ["PENDING", "RUNNING"])
      )
    )
    .orderBy(desc(acquisitionTasks.createdAt))
    .limit(25);

  const compatibleInflight = activeCandidates.find((t) =>
    isTaskCompatibleWithRequest(t, input)
  );

  if (compatibleInflight) {
    const existingConsumers = Array.isArray(compatibleInflight.sharedConsumerCampaignIds)
      ? (compatibleInflight.sharedConsumerCampaignIds as string[])
      : [];
    const sharedConsumers = Array.from(
      new Set([compatibleInflight.campaignId, ...existingConsumers, input.campaignId])
    );

    if (compatibleInflight.campaignId !== input.campaignId) {
      await db
        .update(acquisitionTasks)
        .set({
          sharedConsumerCampaignIds: sharedConsumers,
          attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
          updatedAt: new Date(),
        })
        .where(eq(acquisitionTasks.id, compatibleInflight.id));
    }

    await db
      .update(acquisitionRequests)
      .set({
        taskId: compatibleInflight.id,
        resolutionType: "JOINED_INFLIGHT",
        dataReuseStatus: "REUSED_FROM_CACHE",
        attributionPolicy: "ORIGINATING_CAMPAIGN_ONCE",
        sharedConsumerCampaignIds: sharedConsumers,
        status: compatibleInflight.status,
      })
      .where(eq(acquisitionRequests.id, requestId));

    if (!executeInline) {
      return {
        requestId,
        taskId: compatibleInflight.id,
        attemptId: null,
        resolutionType: "JOINED_INFLIGHT",
        status: compatibleInflight.status as any,
        terminalOutcome: null,
        errorCode: null,
        errorMessage: null,
        provider,
        actorId,
        providerRunId: compatibleInflight.providerRunId || null,
        datasetId: compatibleInflight.datasetId || null,
        itemsStored: 0,
        observationIds: [],
        normalizedEvidenceIds: [],
        consumerDeliveryStatus: "PENDING",
        usageUsd: null,
        output: null,
      };
    }

    // Wait for the in-flight task to finish (or claim it if it is PENDING / lease expired)
    await waitForOrExecuteTaskInline(compatibleInflight.id, input);
    return await buildOutcomeFromRequestRecord(requestId, compatibleInflight.id);
  }

  // 4. Create a new durable task in `acquisition_tasks`
  const cycleToken = input.cycleToken || (input.forceRefresh ? `refresh_${Date.now()}_${randomUUID().slice(0, 6)}` : "canonical");
  const taskKey = buildDeterministicTaskKey({
    accountId: input.accountId,
    campaignId: input.campaignId,
    platform: input.platform,
    entityType: input.entityType,
    entityId: input.entityId,
    capability: input.capability,
    sourceId: input.sourceId,
    canonicalUrl: input.canonicalUrl,
    externalAccountId: input.externalAccountId,
    cycleToken,
  });

  const taskId = `acq_${createHash("sha256").update(`${taskKey}:${randomUUID().slice(0, 8)}`).digest("hex").slice(0, 16)}`;

  if (input.customExecutor) {
    customExecutorRegistry.set(taskId, input.customExecutor);
  }

  await db
    .insert(acquisitionTasks)
    .values({
      id: taskId,
      campaignId: input.campaignId,
      accountId: input.accountId,
      sourcePlatform: input.platform.toUpperCase(),
      entityType: input.entityType.toUpperCase(),
      entityId: input.entityId,
      sourceId: input.sourceId || null,
      canonicalUrl: input.canonicalUrl || null,
      externalAccountId: input.externalAccountId || null,
      capability: input.capability.toUpperCase(),
      provider,
      actorId,
      taskKey: `${taskKey}:${taskId}`,
      taskType: input.capability.toUpperCase(),
      status: "PENDING",
      priority: input.priority ?? 100,
      maxRetries: input.maxRetries ?? currentPoolConfig.defaultMaxRetries,
      timeWindowDays: input.timeWindowDays ?? null,
      itemLimit: input.itemLimit ?? null,
      freshnessTtlSec,
      inputPayload: sanitizedPayload,
    });

  await db
    .update(acquisitionRequests)
    .set({
      taskId,
    })
    .where(eq(acquisitionRequests.id, requestId));

  if (!executeInline) {
    return {
      requestId,
      taskId,
      attemptId: null,
      resolutionType: "NEW_FETCH",
      status: "PENDING",
      terminalOutcome: null,
      errorCode: null,
      errorMessage: null,
      provider,
      actorId,
      providerRunId: null,
      datasetId: null,
      itemsStored: 0,
      observationIds: [],
      normalizedEvidenceIds: [],
      consumerDeliveryStatus: "PENDING",
      usageUsd: null,
      output: null,
    };
  }

  await waitForOrExecuteTaskInline(taskId, input);
  return await buildOutcomeFromRequestRecord(requestId, taskId);
}

async function waitForOrExecuteTaskInline(
  taskId: string,
  input: AcquisitionRequestInput
): Promise<void> {
  const workerId = `inline-worker-${randomUUID().slice(0, 8)}`;
  const maxWaitMs = 240_000;
  const startWait = Date.now();

  while (Date.now() - startWait < maxWaitMs) {
    const [taskRow] = await db
      .select()
      .from(acquisitionTasks)
      .where(eq(acquisitionTasks.id, taskId))
      .limit(1);

    if (!taskRow) break;
    if (["COMPLETED", "FAILED", "SKIPPED", "CANCELLED", "DEFERRED"].includes(taskRow.status)) {
      break;
    }

    // Check if task is claimable (PENDING or expired lease) and retry window is ready
    const now = Date.now();
    const retryReady = !taskRow.nextRetryAt || taskRow.nextRetryAt.getTime() <= now;
    const leaseExpired = !taskRow.leasedUntil || taskRow.leasedUntil.getTime() < now;

    if ((taskRow.status === "PENDING" || (taskRow.status === "RUNNING" && leaseExpired)) && retryReady) {
      const slot = await canAcquireConcurrencySlot({
        accountId: taskRow.accountId,
        provider: taskRow.provider || "APIFY",
        actorId: taskRow.actorId || null,
      });

      if (slot.allowed) {
        const claimed = await claimAuthorityTask({
          workerId,
          specificTaskId: taskId,
        });
        if (claimed) {
          const execRes = await executeClaimedAuthorityTask(claimed, workerId, {
            forceRefresh: input.forceRefresh,
            orchestrationJobId: input.parentJobId || undefined,
          });
          if (execRes.status !== "RETRY_SCHEDULED") {
            break;
          }
          // If retry was scheduled with a short backoff (e.g. in tests or transient error), wait for nextRetryAt
          const backoffWait = Math.min(execRes.output?.backoffMs || 200, 5000);
          await new Promise((r) => setTimeout(r, backoffWait + 20));
          continue;
        }
      }
    }

    // Wait on in-process notification or poll tick
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 150);
      const list = inflightTaskWaiters.get(taskId) || [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      inflightTaskWaiters.set(taskId, list);
    });
  }
}

async function buildOutcomeFromRequestRecord(
  requestId: string,
  taskId: string
): Promise<AcquisitionRequestOutcome> {
  const [reqRow] = await db
    .select()
    .from(acquisitionRequests)
    .where(eq(acquisitionRequests.id, requestId))
    .limit(1);

  const [taskRow] = await db
    .select()
    .from(acquisitionTasks)
    .where(eq(acquisitionTasks.id, taskId))
    .limit(1);

  const out = (taskRow?.outputSummary || {}) as Record<string, any>;

  return {
    requestId,
    taskId,
    attemptId: reqRow?.attemptId || null,
    resolutionType: (reqRow?.resolutionType as any) || "NEW_FETCH",
    status: (reqRow?.status as any) || (taskRow?.status as any) || "FAILED",
    terminalOutcome: (reqRow?.terminalOutcome as TerminalOutcome) || (taskRow?.terminalOutcome as TerminalOutcome) || null,
    errorCode: (reqRow?.errorCode as AcquisitionErrorCode) || (taskRow?.errorCode as AcquisitionErrorCode) || null,
    errorMessage: reqRow?.errorMessage || taskRow?.errorMessage || null,
    provider: reqRow?.provider || taskRow?.provider || "APIFY",
    actorId: reqRow?.actorId || taskRow?.actorId || null,
    providerRunId: reqRow?.providerRunId || taskRow?.providerRunId || null,
    datasetId: reqRow?.datasetId || taskRow?.datasetId || null,
    itemsStored: reqRow?.itemsStored ?? out.itemsStored ?? 0,
    observationIds: (reqRow?.observationIds as string[]) || out.observationIds || [],
    normalizedEvidenceIds: (reqRow?.normalizedEvidenceIds as string[]) || out.normalizedEvidenceIds || [],
    consumerDeliveryStatus: reqRow?.consumerDeliveryStatus || "PENDING",
    usageUsd:
      reqRow?.resolutionType && reqRow.resolutionType !== "NEW_FETCH"
        ? null
        : reqRow?.usageUsd ?? taskRow?.usageUsd ?? null,
    output: out,
  };
}
