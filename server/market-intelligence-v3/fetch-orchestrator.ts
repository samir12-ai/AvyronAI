import { db } from "../db";
import { miFetchJobs, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorMetricsSnapshot, miSnapshots, miSignalLogs, miTelemetry, growthCampaigns, competitorWebData } from "@shared/schema";
import { inArray, eq, and, desc, sql } from "drizzle-orm";
import { fetchCompetitorData, enrichCompetitorWithComments, cleanupExpiredSyntheticComments, type FetchResult, type CollectionMode } from "../competitive-intelligence/data-acquisition";
import { computeAllSignals, aggregateMissingFlags, clusterSemanticSignals } from "./signal-engine";
import { classifyAllIntents, computeDominantMarketIntent } from "./intent-engine";
import { computeTrajectory, deriveTrajectoryDirection, deriveMarketState } from "./trajectory-engine";
import { computeConfidence } from "./confidence-engine";
import { computeAllDominance } from "./dominance-module";
import { computeTokenBudget, applySampling } from "./token-budget";
import { getStoredPostsForMIv3, getStoredCommentsForMIv3 } from "../competitive-intelligence/data-acquisition";
import { computeCompetitorHash } from "./utils";
import { computeVolatilityIndex, buildMarketDiagnosis, buildThreatSignals, buildOpportunitySignals, buildMarketSummary, computeSignalNoiseRatio, computeEvidenceCoverage, persistValidatedSnapshot, ENGINE_VERSION, computeDataFreshnessDays } from "./engine";
import { MI_THRESHOLDS, MI_CONFIDENCE, INSTAGRAM_API_CEILING } from "./constants";
import { computeAllContentDNA } from "./content-dna";
import { computeMarketBaseline, computeAllDeviations, type CalibrationContext } from "./market-baselines";
import { computeSimilarityDiagnosis } from "./similarity-engine";
import type { CompetitorInput, GoalMode } from "./types";
import { scrapeWebsite, scrapeBlog, isWebDataStale } from "./website-scraper";
import { computeSourceAvailability } from "./source-types";
import { applyQualityGate, filterClustersByQuality } from "../shared/signal-quality-gate";
import { logAudit } from "../audit";
import { acquireStickySession, releaseStickySession, rotateSessionOnBlock, classifyBlock, logProxyTelemetry, getPoolDiagnostics, type StickySessionContext, type BlockClass } from "../competitive-intelligence/proxy-pool-manager";
import { acquireToken, getBucketState } from "../competitive-intelligence/rate-limiter";

function safeParseJson(val: string | null | undefined, fallback: any): any {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

const FETCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MIN_POSTS_TARGET = MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR;
const MIN_COMMENTS_TARGET = 50;
const DEFAULT_TIME_WINDOW_DAYS = 60;
const EXPANDED_TIME_WINDOW_DAYS = 120;
const MAX_RETRIES = 3;
const MAX_PAGES_PER_COMPETITOR = 12;
const MAX_REQUESTS_PER_JOB = 120;
const MAX_RUNTIME_MS = 20 * 60 * 1000;
const MAX_CONCURRENT_COMPETITORS_PER_JOB = 1;
const CONCURRENCY_FEATURE_FLAG = false;
export const MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT = 1;
const STAGGER_DELAY_MS = 5000;

const lastJobStartByAccount = new Map<string, number>();

type StopReason = "MAX_PAGES_REACHED" | "MAX_REQUESTS_REACHED" | "MAX_RUNTIME_REACHED" | "COMPLETE" | "ERROR" | "ALL_FAILED" | "COOLDOWN_ACTIVE";

type StageStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED" | "SKIPPED_FETCH_COOLDOWN" | "CACHED_ANALYSIS" | "BLOCKED_INSUFFICIENT_DATA";

type CompetitorFetchStatus = "FETCH_SUCCESS" | "FETCH_FAILED" | "RATE_LIMITED" | "NO_POSTS_FOUND" | "SKIPPED_DUE_TO_BUDGET" | "SKIPPED_DUE_TO_RUNTIME" | "SKIPPED_DUE_TO_PAGES_CEILING" | "COOLDOWN_ACTIVE" | "BLOCKED_BY_PLATFORM" | "PENDING";

interface CompetitorStage {
  competitorId: string;
  competitorName: string;
  POSTS_FETCH: StageStatus;
  COMMENTS_FETCH: StageStatus;
  CTA_ANALYSIS: StageStatus;
  SIGNAL_COMPUTE: StageStatus;
  postsFetched: number;
  commentsFetched: number;
  fetchStatus: CompetitorFetchStatus;
  requestsUsed: number;
  cooldownRemainingHours?: number;
  remainingCooldownSeconds?: number;
  lastFetchTimestamp?: string;
  existingCoverage?: { posts: number; comments: number };
  analysisSource?: "CACHED_DATA" | "FRESH_DATA";
  fetchExecuted: boolean;
  error?: string;
  rawFetchedCount?: number;
  paginationPages?: number;
  paginationStopReason?: string;
}

interface FetchJobDiagnostics {
  competitorCount: number;
  requestsUsed: number;
  requestBudget: number;
  runtimeUsedMs: number;
  runtimeBudget: number;
  coverageRatio: number;
  competitorsTotal: number;
  competitorsProcessed: number;
  competitorsFailed: number;
  competitorsSkipped: number;
  skippedCompetitors: { name: string; reason: CompetitorFetchStatus }[];
  rateLimitEvents: number;
  perCompetitorStatus: { name: string; fetchStatus: CompetitorFetchStatus; requestsUsed: number; postsCollected: number; commentsCollected: number }[];
  perCompetitorRequestCap: number;
}

export function computeDynamicBudgets(competitorCount: number): { requestBudget: number; runtimeBudget: number } {
  const BASE_REQUESTS_PER_COMPETITOR = 10;
  const BASE_RUNTIME_PER_COMPETITOR_MS = 100_000;
  const MIN_RUNTIME_MS = 10 * 60 * 1000;
  const MAX_RUNTIME_CEILING_MS = 25 * 60 * 1000;

  const requestBudget = Math.min(BASE_REQUESTS_PER_COMPETITOR * competitorCount, MAX_REQUESTS_PER_JOB);
  const runtimeBudget = Math.min(
    Math.max(BASE_RUNTIME_PER_COMPETITOR_MS * competitorCount, MIN_RUNTIME_MS),
    MAX_RUNTIME_CEILING_MS
  );

  return { requestBudget, runtimeBudget };
}

interface FetchLimitReason {
  competitorId: string;
  competitorName: string;
  stage: string;
  reason: "RATE_LIMIT" | "PROXY_BLOCKED" | "PRIVATE_ACCOUNT" | "PAGINATION_STOPPED" | "COOLDOWN" | "ERROR" | "INSUFFICIENT_DATA";
  details: string;
}

export interface FetchJobStatus {
  jobId: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "COMPLETE_WITH_COOLDOWN" | "QUEUED";
  stageStatuses: Record<string, CompetitorStage>;
  fetchLimitReasons: FetchLimitReason[];
  totalPostsFetched: number;
  totalCommentsFetched: number;
  competitorCount: number;
  stopReason?: StopReason;
  newSnapshotId?: string;
  totalRequestsMade?: number;
  error?: string;
  durationMs?: number;
  createdAt?: string;
  completedAt?: string;
  collectionMode?: string;
  dataStatus?: string;
  coverage?: {
    competitorsTotal: number;
    competitorsProcessed: number;
    competitorsFailed: number;
    competitorsSkipped: number;
    coverageRatio: number;
  };
  diagnostics?: FetchJobDiagnostics;
}

const activeJobs = new Map<string, Promise<void>>();
const creationLocks = new Set<string>();

export async function startFetchJob(accountId: string, campaignId: string): Promise<string> {
  const lockKey = `${accountId}:${campaignId}`;

  if (creationLocks.has(lockKey)) {
    const existingActive = await db.select().from(miFetchJobs)
      .where(and(
        eq(miFetchJobs.accountId, accountId),
        eq(miFetchJobs.campaignId, campaignId),
        sql`${miFetchJobs.status} IN ('RUNNING', 'QUEUED')`,
      ))
      .orderBy(desc(miFetchJobs.createdAt))
      .limit(1);
    if (existingActive.length > 0) {
      console.log(`[FetchOrch] DEDUP (lock-path): Reusing ${existingActive[0].status} job ${existingActive[0].id} for ${lockKey}`);
      return existingActive[0].id;
    }
    throw new Error("Job creation already in progress. Please wait.");
  }

  creationLocks.add(lockKey);
  try {
    return await _createAndStartJob(accountId, campaignId, lockKey);
  } finally {
    creationLocks.delete(lockKey);
  }
}

export async function getRunningJobCountForAccount(accountId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
    .where(and(
      eq(miFetchJobs.accountId, accountId),
      eq(miFetchJobs.status, "RUNNING"),
    ));
  return Number(result[0]?.count ?? 0);
}

async function _createAndStartJob(accountId: string, campaignId: string, lockKey: string): Promise<string> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  if (competitors.length === 0) {
    throw new Error("No active competitors found for this campaign");
  }

  const competitorInputs: CompetitorInput[] = competitors.map(c => ({
    id: c.id, name: c.name, platform: c.platform, profileLink: c.profileLink,
    businessType: c.businessType, postingFrequency: c.postingFrequency,
    contentTypeRatio: c.contentTypeRatio, engagementRatio: c.engagementRatio,
    ctaPatterns: c.ctaPatterns, discountFrequency: c.discountFrequency,
    hookStyles: c.hookStyles, messagingTone: c.messagingTone,
    socialProofPresence: c.socialProofPresence, posts: [], comments: [],
  }));
  const hash = computeCompetitorHash(competitorInputs);

  const STALE_QUEUED_THRESHOLD_MS = 10 * 60 * 1000;
  const staleQueuedCutoff = new Date(Date.now() - STALE_QUEUED_THRESHOLD_MS);

  const staleQueued = await db.update(miFetchJobs)
    .set({ status: "FAILED", error: "Auto-expired: stuck in QUEUED for >10 minutes", completedAt: new Date() })
    .where(and(
      eq(miFetchJobs.accountId, accountId),
      eq(miFetchJobs.campaignId, campaignId),
      eq(miFetchJobs.status, "QUEUED"),
      sql`${miFetchJobs.createdAt} < ${staleQueuedCutoff}`,
    ))
    .returning({ id: miFetchJobs.id });
  if (staleQueued.length > 0) {
    console.log(`[FetchOrch] STALE_QUEUED_CLEANUP: Expired ${staleQueued.length} stale QUEUED jobs for ${lockKey}: ${staleQueued.map(j => j.id).join(", ")}`);
  }

  const existingActive = await db.select().from(miFetchJobs)
    .where(and(
      eq(miFetchJobs.accountId, accountId),
      eq(miFetchJobs.campaignId, campaignId),
      sql`${miFetchJobs.status} IN ('RUNNING', 'QUEUED')`,
    ))
    .orderBy(desc(miFetchJobs.createdAt))
    .limit(1);

  if (existingActive.length > 0) {
    console.log(`[FetchOrch] DEDUP: Reusing active ${existingActive[0].status} job ${existingActive[0].id} for ${lockKey} (competitorHash=${hash})`);
    return existingActive[0].id;
  }

  const existingDupHash = await db.select().from(miFetchJobs)
    .where(and(
      eq(miFetchJobs.competitorHash, hash),
      sql`${miFetchJobs.status} IN ('RUNNING', 'QUEUED')`,
    ))
    .orderBy(desc(miFetchJobs.createdAt))
    .limit(1);

  if (existingDupHash.length > 0) {
    console.log(`[FetchOrch] DEDUP: Reusing job ${existingDupHash[0].id} with same competitorHash=${hash} (different account/campaign but same competitor set)`);
    return existingDupHash[0].id;
  }

  const runningCount = await getRunningJobCountForAccount(accountId);
  if (runningCount >= MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT) {
    const jobId = `fetch_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const initialStages: Record<string, CompetitorStage> = {};
    for (const c of competitors) {
      initialStages[c.id] = {
        competitorId: c.id,
        competitorName: c.name,
        POSTS_FETCH: "PENDING",
        COMMENTS_FETCH: "PENDING",
        CTA_ANALYSIS: "PENDING",
        SIGNAL_COMPUTE: "PENDING",
        postsFetched: 0,
        commentsFetched: 0,
        fetchExecuted: false,
      };
    }
    await db.insert(miFetchJobs).values({
      id: jobId,
      accountId,
      campaignId,
      competitorHash: hash,
      status: "QUEUED",
      priority: PRIORITY_FAST_PASS,
      stageStatuses: JSON.stringify(initialStages),
      fetchLimitReasons: JSON.stringify([]),
      totalPostsFetched: 0,
      totalCommentsFetched: 0,
      competitorCount: competitors.length,
    });
    console.log(`[FetchOrch] QUEUED job ${jobId} | priority=FAST_PASS(${PRIORITY_FAST_PASS}) | account=${accountId} | runningJobs=${runningCount} >= ceiling=${MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT}`);
    return jobId;
  }

  const lastStart = lastJobStartByAccount.get(accountId);
  if (lastStart) {
    const elapsed = Date.now() - lastStart;
    if (elapsed < STAGGER_DELAY_MS) {
      const waitMs = STAGGER_DELAY_MS - elapsed;
      console.log(`[FetchOrch] Stagger delay ${waitMs}ms for account ${accountId}`);
      await sleep(waitMs);
    }
  }

  const jobId = `fetch_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

  const initialStages: Record<string, CompetitorStage> = {};
  for (const c of competitors) {
    initialStages[c.id] = {
      competitorId: c.id,
      competitorName: c.name,
      POSTS_FETCH: "PENDING",
      COMMENTS_FETCH: "PENDING",
      CTA_ANALYSIS: "PENDING",
      SIGNAL_COMPUTE: "PENDING",
      postsFetched: 0,
      commentsFetched: 0,
      fetchExecuted: false,
    };
  }

  try {
    await db.insert(miFetchJobs).values({
      id: jobId,
      accountId,
      campaignId,
      competitorHash: hash,
      status: "RUNNING",
      stageStatuses: JSON.stringify(initialStages),
      fetchLimitReasons: JSON.stringify([]),
      totalPostsFetched: 0,
      totalCommentsFetched: 0,
      competitorCount: competitors.length,
    });
  } catch (insertErr: any) {
    if (insertErr.code === "23505") {
      const existing = await db.select().from(miFetchJobs)
        .where(and(eq(miFetchJobs.accountId, accountId), eq(miFetchJobs.campaignId, campaignId), eq(miFetchJobs.status, "RUNNING")))
        .orderBy(desc(miFetchJobs.createdAt)).limit(1);
      if (existing.length > 0) {
        console.log(`[FetchOrch] Unique constraint hit — reusing DB job ${existing[0].id}`);
        return existing[0].id;
      }
    }
    throw insertErr;
  }

  lastJobStartByAccount.set(accountId, Date.now());
  console.log(`[FetchOrch] Job ${jobId} created for ${competitors.length} competitors`);

  const promise = executeFetchJob(jobId, accountId, campaignId, competitors).catch(err => {
    console.error(`[FetchOrch] Job ${jobId} fatal error:`, err.message);
  }).finally(() => {
    activeJobs.delete(lockKey);
  });
  activeJobs.set(lockKey, promise);

  return jobId;
}

async function scrapeWebAndBlogForCompetitor(comp: any, accountId: string): Promise<void> {
  try {
    const websiteBlocked = comp.websiteEnrichmentStatus === "ACCESS_BLOCKED";
    const websiteBlockedCooldown = websiteBlocked && comp.websiteScrapedAt && (Date.now() - new Date(comp.websiteScrapedAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
    const websiteFailedRecently = comp.websiteEnrichmentStatus === "FAILED" && comp.websiteScrapedAt && (Date.now() - new Date(comp.websiteScrapedAt).getTime()) < 24 * 60 * 60 * 1000;
    if (comp.websiteUrl && !websiteBlockedCooldown && !websiteFailedRecently && (isWebDataStale(comp.websiteScrapedAt) || comp.websiteEnrichmentStatus === "NONE" || comp.websiteEnrichmentStatus === "FAILED" || (websiteBlocked && !websiteBlockedCooldown))) {
      console.log(`[FetchOrch] Website scrape starting for ${comp.name}: ${comp.websiteUrl}`);
      const extractions = await scrapeWebsite(comp.id, comp.name, comp.websiteUrl);
      const successCount = extractions.filter(e => e.extractionStatus === "COMPLETE").length;

      for (const ext of extractions) {
        await db.insert(competitorWebData).values({
          accountId,
          competitorId: comp.id,
          campaignId: comp.campaignId,
          sourceType: "website",
          sourceUrl: ext.sourceUrl,
          pageType: ext.pageType,
          headlines: JSON.stringify(ext.headlines),
          subheadlines: JSON.stringify(ext.subheadlines),
          ctaLabels: JSON.stringify(ext.ctaLabels),
          offerPhrases: JSON.stringify(ext.offerPhrases),
          pricingAnchors: JSON.stringify(ext.pricingAnchors),
          proofBlocks: JSON.stringify(ext.proofBlocks),
          testimonialBlocks: JSON.stringify(ext.testimonialBlocks),
          guarantees: JSON.stringify(ext.guarantees),
          featureList: JSON.stringify(ext.featureList),
          navigationLinks: JSON.stringify(ext.navigationLinks),
          topicTitles: JSON.stringify(ext.topicTitles || []),
          contentHeadings: JSON.stringify(ext.contentHeadings || []),
          rawTextPreview: ext.rawTextPreview?.slice(0, 3000) || "",
          extractionStatus: ext.extractionStatus,
          extractionError: ext.extractionError || null,
          signalClassification: null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      const hasBlocked = extractions.some(e => e.extractionStatus === "ACCESS_BLOCKED");
      const status = successCount > 0 ? "COMPLETE" : hasBlocked ? "ACCESS_BLOCKED" : "FAILED";
      await db.update(ciCompetitors)
        .set({ websiteEnrichmentStatus: status, websiteScrapedAt: new Date() })
        .where(eq(ciCompetitors.id, comp.id));
      console.log(`[FetchOrch] Website scrape ${status} for ${comp.name}: ${successCount}/${extractions.length} pages`);
    }

    const blogFailedRecently = comp.blogEnrichmentStatus === "FAILED" && comp.blogScrapedAt && (Date.now() - new Date(comp.blogScrapedAt).getTime()) < 24 * 60 * 60 * 1000;
    if (comp.blogUrl && !blogFailedRecently && (isWebDataStale(comp.blogScrapedAt) || comp.blogEnrichmentStatus === "NONE" || comp.blogEnrichmentStatus === "FAILED")) {
      console.log(`[FetchOrch] Blog scrape starting for ${comp.name}: ${comp.blogUrl}`);
      const blogResult = await scrapeBlog(comp.id, comp.name, comp.blogUrl);

      await db.insert(competitorWebData).values({
        accountId,
        competitorId: comp.id,
        campaignId: comp.campaignId,
        sourceType: "blog",
        sourceUrl: blogResult.sourceUrl,
        pageType: "blog_index",
        headlines: null,
        subheadlines: null,
        ctaLabels: null,
        offerPhrases: null,
        pricingAnchors: null,
        proofBlocks: null,
        testimonialBlocks: null,
        guarantees: null,
        featureList: null,
        navigationLinks: null,
        topicTitles: JSON.stringify(blogResult.topicTitles),
        contentHeadings: JSON.stringify(blogResult.contentHeadings),
        rawTextPreview: blogResult.rawTextPreview?.slice(0, 3000) || "",
        extractionStatus: blogResult.extractionStatus,
        extractionError: blogResult.extractionError || null,
        signalClassification: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await db.update(ciCompetitors)
        .set({ blogEnrichmentStatus: blogResult.extractionStatus === "COMPLETE" ? "COMPLETE" : "FAILED", blogScrapedAt: new Date() })
        .where(eq(ciCompetitors.id, comp.id));
      console.log(`[FetchOrch] Blog scrape ${blogResult.extractionStatus} for ${comp.name}`);
    }
  } catch (err: any) {
    console.error(`[FetchOrch] Web/blog scrape error for ${comp.name}:`, err.message);
  }
}

async function executeFetchJob(
  jobId: string,
  accountId: string,
  campaignId: string,
  competitors: any[],
): Promise<void> {
  const startTime = Date.now();
  const stages: Record<string, CompetitorStage> = {};
  const limitReasons: FetchLimitReason[] = [];
  let totalPosts = 0;
  let totalComments = 0;
  let totalRequests = 0;
  let cooldownCount = 0;
  let rateLimitEvents = 0;
  let stopReason: StopReason = "COMPLETE";

  const { requestBudget: dynamicRequestBudget, runtimeBudget: dynamicRuntimeBudget } = computeDynamicBudgets(competitors.length);
  const perCompetitorRequestCap = Math.ceil(dynamicRequestBudget / competitors.length);

  console.log(`[FetchOrch] Dynamic budgets | competitors=${competitors.length} | requestBudget=${dynamicRequestBudget} | runtimeBudget=${dynamicRuntimeBudget}ms | perCompetitorCap=${perCompetitorRequestCap}`);

  const poolBefore = getPoolDiagnostics(accountId);
  console.log(`[FetchOrch] ProxyPool state at job start | account=${accountId} | active=${poolBefore.activeSessions} | quarantined=${poolBefore.quarantinedSessions} | stickyBindings=${poolBefore.stickyBindings}`);

  for (const c of competitors) {
    stages[c.id] = {
      competitorId: c.id,
      competitorName: c.name,
      POSTS_FETCH: "PENDING",
      COMMENTS_FETCH: "PENDING",
      CTA_ANALYSIS: "PENDING",
      SIGNAL_COMPUTE: "PENDING",
      postsFetched: 0,
      commentsFetched: 0,
      fetchStatus: "PENDING",
      requestsUsed: 0,
      fetchExecuted: false,
    };
  }

  function checkRuntimeCeiling(): boolean {
    if (Date.now() - startTime >= dynamicRuntimeBudget) {
      stopReason = "MAX_RUNTIME_REACHED";
      console.log(`[FetchOrch] HARD CEILING: MAX_RUNTIME ${dynamicRuntimeBudget}ms reached`);
      return true;
    }
    return false;
  }

  function checkRequestCeiling(): boolean {
    if (totalRequests >= dynamicRequestBudget) {
      stopReason = "MAX_REQUESTS_REACHED";
      console.log(`[FetchOrch] HARD CEILING: MAX_REQUESTS ${dynamicRequestBudget} reached`);
      return true;
    }
    return false;
  }

  try {
    let competitorPageCount = 0;

    for (const comp of competitors) {
      if (checkRuntimeCeiling() || checkRequestCeiling()) {
        const skipReason: CompetitorFetchStatus = stopReason === "MAX_RUNTIME_REACHED" ? "SKIPPED_DUE_TO_RUNTIME" : "SKIPPED_DUE_TO_BUDGET";
        for (const s of Object.values(stages)) {
          if (s.POSTS_FETCH === "PENDING") {
            s.POSTS_FETCH = "SKIPPED";
            s.COMMENTS_FETCH = "SKIPPED";
            s.CTA_ANALYSIS = "SKIPPED";
            s.SIGNAL_COMPUTE = "SKIPPED";
            s.fetchStatus = skipReason;
          }
        }
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "ERROR",
          details: `Job stopped: ${stopReason}`,
        });
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        break;
      }

      competitorPageCount++;
      if (competitorPageCount > MAX_PAGES_PER_COMPETITOR) {
        stopReason = "MAX_PAGES_REACHED";
        console.log(`[FetchOrch] HARD CEILING: MAX_PAGES_PER_COMPETITOR ${MAX_PAGES_PER_COMPETITOR} reached`);
        for (const s of Object.values(stages)) {
          if (s.POSTS_FETCH === "PENDING") {
            s.POSTS_FETCH = "SKIPPED";
            s.COMMENTS_FETCH = "SKIPPED";
            s.CTA_ANALYSIS = "SKIPPED";
            s.SIGNAL_COMPUTE = "SKIPPED";
            s.fetchStatus = "SKIPPED_DUE_TO_PAGES_CEILING";
          }
        }
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "ERROR",
          details: `Job stopped: ${stopReason}`,
        });
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        break;
      }

      const stage = stages[comp.id];

      stage.POSTS_FETCH = "RUNNING";
      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

      let fetchResult: FetchResult | null = null;
      const compHash = computeCompetitorHash([{
        id: comp.id, name: comp.name, platform: comp.platform,
        profileLink: comp.profileLink, businessType: comp.businessType,
        posts: [], comments: [],
      }]);
      let proxyCtx = acquireStickySession(accountId, campaignId, compHash);
      if (proxyCtx) {
        console.log(`[FetchOrch] Sticky session acquired | competitor=${comp.name} | session=${proxyCtx.session.sessionId} | ipHash=${proxyCtx.session.ipHash}`);
      }

      let attempt = 1;
      while (attempt <= MAX_RETRIES) {
        if (checkRuntimeCeiling() || checkRequestCeiling()) break;
        if (stage.requestsUsed >= perCompetitorRequestCap) {
          console.log(`[FetchOrch] PER_COMPETITOR_CAP: ${comp.name} hit cap of ${perCompetitorRequestCap} requests, moving to next competitor`);
          stage.fetchStatus = "SKIPPED_DUE_TO_BUDGET";
          break;
        }
        await acquireToken(accountId, campaignId, `POSTS_FETCH:${comp.name}`);
        totalRequests++;
        stage.requestsUsed++;
        const startMs = Date.now();
        try {
          fetchResult = await fetchCompetitorData(comp.id, accountId, attempt > 1, proxyCtx || undefined, "FAST_PASS");
          if (proxyCtx) {
            logProxyTelemetry(proxyCtx, "POSTS_FETCH", 200, null, Date.now() - startMs, true);
          }
          break;
        } catch (err: any) {
          const blockClass = classifyBlock(null, err.message);
          if (proxyCtx) {
            logProxyTelemetry(proxyCtx, "POSTS_FETCH", null, blockClass, Date.now() - startMs, false);
          }

          attempt++;
          if (attempt > MAX_RETRIES) {
            stage.POSTS_FETCH = "FAILED";
            stage.error = err.message;
            if (blockClass === "RATE_LIMIT") stage.fetchStatus = "RATE_LIMITED";
            else if (blockClass === "PROXY_BLOCKED") stage.fetchStatus = "BLOCKED_BY_PLATFORM";
            else stage.fetchStatus = "FETCH_FAILED";
            limitReasons.push({
              competitorId: comp.id, competitorName: comp.name,
              stage: "POSTS_FETCH", reason: blockClass === "PROXY_BLOCKED" ? "BLOCKED_BY_PLATFORM" : "ERROR",
              details: `${err.message} (blockClass=${blockClass}, attempts=${attempt - 1})`,
            });
            break;
          }

          if (blockClass === "RATE_LIMIT") {
            rateLimitEvents++;
            const backoffIdx = Math.max(0, Math.min(attempt - 2, 2));
            const backoffMs = [10000, 30000, 60000][backoffIdx];
            console.log(`[FetchOrch] RATE_LIMIT backoff ${backoffMs}ms for ${comp.name} | attempt=${attempt}`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else if (blockClass === "PROXY_BLOCKED") {
            if (proxyCtx) {
              const rotated = rotateSessionOnBlock(proxyCtx, blockClass);
              if (rotated) {
                proxyCtx = rotated;
                console.log(`[FetchOrch] 403/BLOCKED: Session rotated once for ${comp.name} | newSession=${proxyCtx.session.sessionId}`);
              } else {
                console.log(`[FetchOrch] 403/BLOCKED: Rotation exhausted for ${comp.name}, marking PROXY_BLOCKED`);
                stage.POSTS_FETCH = "FAILED";
                stage.error = `PROXY_BLOCKED after rotation failure`;
                limitReasons.push({
                  competitorId: comp.id, competitorName: comp.name,
                  stage: "POSTS_FETCH", reason: "PROXY_BLOCKED",
                  details: `Proxy blocked after rotation failure (attempts=${attempt - 1})`,
                });
                break;
              }
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else if (blockClass === "AUTH_REQUIRED") {
            if (proxyCtx) {
              const rotated = rotateSessionOnBlock(proxyCtx, "PROXY_BLOCKED");
              if (rotated) {
                proxyCtx = rotated;
                console.log(`[FetchOrch] AUTH_REQUIRED: Session rotated for ${comp.name} | newSession=${proxyCtx.session.sessionId}`);
              }
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
          }

          console.log(`[FetchOrch] Retry ${attempt - 1}/${MAX_RETRIES} for ${comp.name} | blockClass=${blockClass}`);
        }
      }

      if (proxyCtx) {
        releaseStickySession(proxyCtx);
      }

      if (!fetchResult) {
        stage.POSTS_FETCH = stage.POSTS_FETCH === "RUNNING" ? "FAILED" : stage.POSTS_FETCH;
        stage.COMMENTS_FETCH = "SKIPPED";
        stage.CTA_ANALYSIS = "SKIPPED";
        stage.SIGNAL_COMPUTE = "SKIPPED";
        if (stage.fetchStatus === "PENDING") stage.fetchStatus = "FETCH_FAILED";
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      if (fetchResult.status === "COOLDOWN") {
        const hoursMatch = fetchResult.message.match(/(\d+)h remaining/);
        const remainingHours = hoursMatch ? parseInt(hoursMatch[1], 10) : undefined;
        const remainingCooldownSeconds = remainingHours ? remainingHours * 3600 : undefined;

        stage.POSTS_FETCH = "SKIPPED_FETCH_COOLDOWN";
        stage.COMMENTS_FETCH = "SKIPPED_FETCH_COOLDOWN";
        stage.fetchStatus = "COOLDOWN_ACTIVE";
        stage.fetchExecuted = false;
        stage.cooldownRemainingHours = remainingHours;
        stage.remainingCooldownSeconds = remainingCooldownSeconds;
        stage.lastFetchTimestamp = new Date().toISOString();
        stage.existingCoverage = { posts: fetchResult.postsCollected, comments: fetchResult.commentsCollected };
        stage.postsFetched = fetchResult.postsCollected;
        stage.commentsFetched = fetchResult.commentsCollected;
        totalPosts += fetchResult.postsCollected;
        totalComments += fetchResult.commentsCollected;

        cooldownCount++;

        const coverageMeetsThresholds = fetchResult.postsCollected >= MIN_POSTS_TARGET;

        if (coverageMeetsThresholds) {
          stage.analysisSource = "CACHED_DATA";

          stage.CTA_ANALYSIS = "RUNNING";
          await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
          stage.CTA_ANALYSIS = "CACHED_ANALYSIS";

          stage.SIGNAL_COMPUTE = "RUNNING";
          await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

          try {
            const posts = await getStoredPostsForMIv3(comp.id, accountId);
            const comments = await getStoredCommentsForMIv3(comp.id, accountId);
            const competitorInput: CompetitorInput = {
              id: comp.id, name: comp.name, platform: comp.platform,
              profileLink: comp.profileLink, businessType: comp.businessType,
              postingFrequency: comp.postingFrequency, contentTypeRatio: comp.contentTypeRatio,
              engagementRatio: comp.engagementRatio, ctaPatterns: comp.ctaPatterns,
              discountFrequency: comp.discountFrequency, hookStyles: comp.hookStyles,
              messagingTone: comp.messagingTone, socialProofPresence: comp.socialProofPresence,
              posts, comments,
            };
            const signalResults = computeAllSignals([competitorInput]);
            console.log(`[FetchOrch] Cached analysis for ${comp.name}: ${signalResults.length} signals from ${posts.length} posts | coverageMeetsThresholds=${coverageMeetsThresholds}`);
            stage.SIGNAL_COMPUTE = "CACHED_ANALYSIS";
          } catch (err: any) {
            console.error(`[FetchOrch] Cached signal compute failed for ${comp.name}:`, err.message);
            stage.SIGNAL_COMPUTE = "FAILED";
            stage.error = `Cached signal compute: ${err.message}`;
          }
        } else {
          stage.CTA_ANALYSIS = "BLOCKED_INSUFFICIENT_DATA";
          stage.SIGNAL_COMPUTE = "BLOCKED_INSUFFICIENT_DATA";
          stage.analysisSource = undefined;
          console.log(`[FetchOrch] COVERAGE_VALIDATION_FAILED: Cached analysis blocked for ${comp.name} | posts=${fetchResult.postsCollected}/${MIN_POSTS_TARGET} | cooldown active, coverage insufficient for analysis`);
        }

        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "COOLDOWN",
          details: `${fetchResult.message} | existingCoverage: ${fetchResult.postsCollected}p/${fetchResult.commentsCollected}c | thresholdsMet: ${coverageMeetsThresholds}`,
        });
        await scrapeWebAndBlogForCompetitor(comp, accountId);
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      if (fetchResult.status === "BLOCKED") {
        stage.POSTS_FETCH = "FAILED";
        stage.COMMENTS_FETCH = "SKIPPED";
        stage.CTA_ANALYSIS = "SKIPPED";
        stage.SIGNAL_COMPUTE = "SKIPPED";
        stage.fetchStatus = "BLOCKED_BY_PLATFORM";
        const reason = classifyBlockReason(fetchResult);
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason, details: fetchResult.message,
        });
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      stage.POSTS_FETCH = "COMPLETE";
      stage.postsFetched = fetchResult.postsCollected;
      stage.analysisSource = "FRESH_DATA";
      stage.fetchExecuted = true;
      stage.fetchStatus = fetchResult.postsCollected > 0 ? "FETCH_SUCCESS" : "NO_POSTS_FOUND";
      stage.rawFetchedCount = fetchResult.rawFetchedCount;
      stage.paginationPages = fetchResult.paginationPages;
      stage.paginationStopReason = fetchResult.paginationStopReason;
      totalPosts += fetchResult.postsCollected;

      try {
        await db.update(ciCompetitors)
          .set({
            analysisLevel: "FAST_PASS",
            enrichmentStatus: "PENDING",
            fetchMethod: "FAST_PASS",
            postsCollected: fetchResult.postsCollected,
            commentsCollected: fetchResult.commentsCollected,
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(ciCompetitors.id, comp.id));
        console.log(`[FetchOrch] FAST_PASS completed | competitor=${comp.name} | analysisLevel=FAST_PASS | enrichmentStatus=PENDING | posts=${fetchResult.postsCollected} | comments=${fetchResult.commentsCollected}`);
      } catch (invErr: any) {
        console.error(`[FetchOrch] Failed to update inventory for ${comp.name}: ${invErr.message}`);
      }

      if (fetchResult.postsCollected < MIN_POSTS_TARGET && (fetchResult.status as string) !== "COOLDOWN") {
        const paginationDetail = fetchResult.paginationStopReason ? ` (pagination: ${fetchResult.paginationStopReason}, ${fetchResult.paginationPages || 1} pages, raw=${fetchResult.rawFetchedCount || 0})` : '';
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "INSUFFICIENT_DATA",
          details: `Only ${fetchResult.postsCollected} posts collected (target: ${MIN_POSTS_TARGET})${paginationDetail}`,
        });
      }

      stage.COMMENTS_FETCH = "RUNNING";
      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

      stage.COMMENTS_FETCH = "COMPLETE";
      stage.commentsFetched = fetchResult.commentsCollected;
      totalComments += fetchResult.commentsCollected;

      if (fetchResult.commentsCollected < MIN_COMMENTS_TARGET) {
        console.log(`[FetchOrch] Comment text below target for ${comp.name} (${fetchResult.commentsCollected}/${MIN_COMMENTS_TARGET}) — continuing without comment text (COMMENT_TEXT_OPTIONAL=true)`);
      }

      stage.CTA_ANALYSIS = "RUNNING";
      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

      stage.CTA_ANALYSIS = "COMPLETE";

      stage.SIGNAL_COMPUTE = "RUNNING";
      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

      try {
        const posts = await getStoredPostsForMIv3(comp.id, accountId);
        const comments = await getStoredCommentsForMIv3(comp.id, accountId);

        const competitorInput: CompetitorInput = {
          id: comp.id, name: comp.name, platform: comp.platform,
          profileLink: comp.profileLink, businessType: comp.businessType,
          postingFrequency: comp.postingFrequency, contentTypeRatio: comp.contentTypeRatio,
          engagementRatio: comp.engagementRatio, ctaPatterns: comp.ctaPatterns,
          discountFrequency: comp.discountFrequency, hookStyles: comp.hookStyles,
          messagingTone: comp.messagingTone, socialProofPresence: comp.socialProofPresence,
          websiteUrl: comp.websiteUrl || null,
          posts, comments,
        };

        const signalResults = computeAllSignals([competitorInput]);
        console.log(`[FetchOrch] Signals computed for ${comp.name}: ${signalResults.length} results`);
        stage.SIGNAL_COMPUTE = "COMPLETE";
      } catch (err: any) {
        console.error(`[FetchOrch] Signal compute failed for ${comp.name}:`, err.message);
        stage.SIGNAL_COMPUTE = "FAILED";
        stage.error = `Signal compute: ${err.message}`;
      }

      await scrapeWebAndBlogForCompetitor(comp, accountId);

      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
    }

    const stageValues = Object.values(stages);
    const competitorsProcessed = stageValues.filter(s => s.fetchStatus === "FETCH_SUCCESS" || s.fetchStatus === "NO_POSTS_FOUND" || s.fetchStatus === "COOLDOWN_ACTIVE").length;
    const competitorsFailed = stageValues.filter(s => s.fetchStatus === "FETCH_FAILED" || s.fetchStatus === "BLOCKED_BY_PLATFORM" || s.fetchStatus === "RATE_LIMITED").length;
    const competitorsSkipped = stageValues.filter(s => s.fetchStatus === "SKIPPED_DUE_TO_BUDGET" || s.fetchStatus === "SKIPPED_DUE_TO_RUNTIME" || s.fetchStatus === "SKIPPED_DUE_TO_PAGES_CEILING" || s.fetchStatus === "PENDING").length;
    const coverageRatio = competitors.length > 0 ? competitorsProcessed / competitors.length : 0;

    const anyAnalysisRan = stageValues.some(
      s => s.SIGNAL_COMPUTE === "COMPLETE" || s.SIGNAL_COMPUTE === "CACHED_ANALYSIS"
    );
    const allCooldown = cooldownCount === competitors.length && competitors.length > 0;
    if (allCooldown) stopReason = "COOLDOWN_ACTIVE";
    const isPartialCoverage = stopReason !== "COMPLETE" && stopReason !== "COOLDOWN_ACTIVE";

    const anyFetchExecuted = stageValues.some(s => s.fetchExecuted === true);
    const snapshotSourceType = anyFetchExecuted ? "FRESH_DATA" : "CACHED_DATA";

    if (anyAnalysisRan) {
      const willRunDeepPass = anyFetchExecuted && !allCooldown;
      const fastPassDataStatus = willRunDeepPass ? "LIVE" : "COMPLETE";
      try {
        await persistSnapshotAfterFetch(accountId, campaignId, isPartialCoverage, stopReason, snapshotSourceType, anyFetchExecuted, fastPassDataStatus as "LIVE" | "ENRICHING" | "COMPLETE", coverageRatio);
        console.log(`[FetchOrch] Snapshot persisted for ${accountId}/${campaignId} | partial=${isPartialCoverage} | allCooldown=${allCooldown} | snapshotSource=${snapshotSourceType} | fetchExecuted=${anyFetchExecuted} | dataStatus=${fastPassDataStatus} | coverageRatio=${coverageRatio.toFixed(2)}`);
      } catch (err: any) {
        console.error(`[FetchOrch] Snapshot persistence failed:`, err.message);
      }

      if (willRunDeepPass) {
        console.log(`[FetchOrch] Fast Pass complete. Auto-queuing Deep Pass for ${accountId}/${campaignId}`);
        queueDeepPass(accountId, campaignId, competitors).catch(err => {
          console.error(`[FetchOrch] Deep Pass auto-queue failed:`, err.message);
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const allFailed = stageValues.every(s => s.POSTS_FETCH === "FAILED");
    if (allFailed && !allCooldown) stopReason = "ALL_FAILED";

    let snapshotIdCreated: string | null = null;
    if (anyAnalysisRan) {
      try {
        const latestSnap = await db.select({ id: miSnapshots.id }).from(miSnapshots)
          .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId), inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"])))
          .orderBy(desc(miSnapshots.createdAt)).limit(1);
        if (latestSnap.length > 0) {
          snapshotIdCreated = latestSnap[0].id;
        }
      } catch { }
    }

    const anyInsufficientData = stageValues.some(
      s => s.postsFetched !== undefined && s.postsFetched < MIN_POSTS_TARGET
    );

    let finalJobStatus: string;
    if (allFailed && !allCooldown) {
      finalJobStatus = "FAILED";
    } else if (allCooldown && anyAnalysisRan) {
      finalJobStatus = "COMPLETE_WITH_COOLDOWN";
    } else if (anyInsufficientData && !allCooldown) {
      finalJobStatus = "PARTIAL_COMPLETE";
      if (stopReason === "COMPLETE") stopReason = "COMPLETE" as StopReason;
    } else {
      finalJobStatus = "COMPLETE";
    }

    const finalStopReason = stopReason !== "COMPLETE" ? stopReason : (anyInsufficientData ? "COMPLETE" : null);

    const skippedCompetitors = stageValues
      .filter(s => s.fetchStatus.startsWith("SKIPPED_"))
      .map(s => ({ name: s.competitorName, reason: s.fetchStatus }));

    const perCompetitorStatus = stageValues.map(s => ({
      name: s.competitorName,
      fetchStatus: s.fetchStatus,
      requestsUsed: s.requestsUsed,
      postsCollected: s.postsFetched,
      commentsCollected: s.commentsFetched,
    }));

    const jobDiagnostics: FetchJobDiagnostics = {
      competitorCount: competitors.length,
      requestsUsed: totalRequests,
      requestBudget: dynamicRequestBudget,
      runtimeUsedMs: durationMs,
      runtimeBudget: dynamicRuntimeBudget,
      coverageRatio,
      competitorsTotal: competitors.length,
      competitorsProcessed,
      competitorsFailed,
      competitorsSkipped,
      skippedCompetitors,
      rateLimitEvents,
      perCompetitorStatus,
      perCompetitorRequestCap,
    };

    console.log(`[FetchOrch] JOB_DIAGNOSTICS: ${JSON.stringify(jobDiagnostics)}`);

    await db.update(miFetchJobs).set({
      status: finalJobStatus,
      stageStatuses: JSON.stringify(stages),
      fetchLimitReasons: JSON.stringify(limitReasons),
      totalPostsFetched: totalPosts,
      totalCommentsFetched: totalComments,
      snapshotIdCreated,
      stopReason: finalStopReason,
      durationMs,
      completedAt: new Date(),
      error: finalStopReason ? `STOP_REASON: ${finalStopReason}` : null,
    }).where(eq(miFetchJobs.id, jobId));

    console.log(`[FetchOrch] Job ${jobId} completed in ${durationMs}ms | posts=${totalPosts} comments=${totalComments} | requests=${totalRequests} | stopReason=${stopReason} | coverage=${competitorsProcessed}/${competitors.length} (${(coverageRatio * 100).toFixed(0)}%)`);

    const rateBucketState = getBucketState(accountId, campaignId);
    console.log(`[FetchOrch] Rate bucket state at job end | tokens=${rateBucketState.tokens}/${rateBucketState.maxBurst} | consumed=${rateBucketState.totalConsumed} | waited=${rateBucketState.totalWaited} | refillMs=${rateBucketState.refillIntervalMs}`);

    logAudit(accountId, "MI_FETCH_JOB_COMPLETE", {
      details: {
        jobId, totalPosts, totalComments, durationMs,
        limitReasons: limitReasons.length,
        totalRequests,
        stopReason,
        cooldownCount,
        status: finalJobStatus,
        rateBucket: rateBucketState,
        coverage: { competitorsTotal: competitors.length, competitorsProcessed, competitorsFailed, competitorsSkipped, coverageRatio },
        diagnostics: jobDiagnostics,
        hardCeilings: {
          maxPagesPerCompetitor: MAX_PAGES_PER_COMPETITOR,
          maxRequestsPerJob: MAX_REQUESTS_PER_JOB,
          maxRuntimeMs: MAX_RUNTIME_MS,
          maxRetries: MAX_RETRIES,
          concurrency: CONCURRENCY_FEATURE_FLAG ? 2 : MAX_CONCURRENT_COMPETITORS_PER_JOB,
        },
      },
    }).catch(() => {});

  } catch (err: any) {
    console.error(`[FetchOrch] Job ${jobId} fatal:`, err.message);
    await db.update(miFetchJobs).set({
      status: "FAILED",
      error: `FATAL: ${err.message} | STOP_REASON: ERROR`,
      stageStatuses: JSON.stringify(stages),
      fetchLimitReasons: JSON.stringify(limitReasons),
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    }).where(eq(miFetchJobs.id, jobId));
  }
}

async function updateJobStages(
  jobId: string,
  stages: Record<string, CompetitorStage>,
  limitReasons: FetchLimitReason[],
  totalPosts: number,
  totalComments: number,
): Promise<void> {
  await db.update(miFetchJobs).set({
    stageStatuses: JSON.stringify(stages),
    fetchLimitReasons: JSON.stringify(limitReasons),
    totalPostsFetched: totalPosts,
    totalCommentsFetched: totalComments,
  }).where(eq(miFetchJobs.id, jobId));
}

function classifyBlockReason(result: FetchResult): "RATE_LIMIT" | "PROXY_BLOCKED" | "PRIVATE_ACCOUNT" | "PAGINATION_STOPPED" | "ERROR" {
  const msg = (result.message || "").toLowerCase();
  if (msg.includes("rate") || msg.includes("429") || msg.includes("throttle")) return "RATE_LIMIT";
  if (msg.includes("proxy") || msg.includes("blocked") || msg.includes("403")) return "PROXY_BLOCKED";
  if (msg.includes("private") || msg.includes("not available")) return "PRIVATE_ACCOUNT";
  if (msg.includes("pagination") || msg.includes("cursor")) return "PAGINATION_STOPPED";
  return "ERROR";
}

async function persistSnapshotAfterFetch(accountId: string, campaignId: string, isPartialCoverage: boolean = false, jobStopReason: StopReason = "COMPLETE", snapshotSource: "FRESH_DATA" | "CACHED_DATA" = "FRESH_DATA", fetchExecuted: boolean = true, dataStatus: "LIVE" | "ENRICHING" | "COMPLETE" = "LIVE", coverageRatio: number = 1.0): Promise<void> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  if (competitors.length === 0) return;

  const campaignRows = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);
  const campaignGoalMode: GoalMode = (campaignRows[0]?.goalMode === "REACH_MODE" ? "REACH_MODE" : "STRATEGY_MODE");

  const competitorInputs: CompetitorInput[] = [];
  for (const c of competitors) {
    const posts = await getStoredPostsForMIv3(c.id, accountId);
    const comments = await getStoredCommentsForMIv3(c.id, accountId);
    competitorInputs.push({
      id: c.id, name: c.name, platform: c.platform, profileLink: c.profileLink,
      businessType: c.businessType, postingFrequency: c.postingFrequency,
      contentTypeRatio: c.contentTypeRatio, engagementRatio: c.engagementRatio,
      ctaPatterns: c.ctaPatterns, discountFrequency: c.discountFrequency,
      hookStyles: c.hookStyles, messagingTone: c.messagingTone,
      socialProofPresence: c.socialProofPresence, posts, comments,
    });
  }

  const competitorHash = computeCompetitorHash(competitorInputs);
  const totalPosts = competitorInputs.reduce((s, c) => s + (c.posts?.length || 0), 0);
  const totalComments = competitorInputs.reduce((s, c) => s + (c.comments?.length || 0), 0);
  const tokenBudget = computeTokenBudget(competitorInputs.length, totalComments, totalPosts);
  const executionMode = tokenBudget.selectedMode;

  for (const comp of competitorInputs) {
    const { sampledPosts, sampledComments } = applySampling(
      comp.posts || [], comp.comments || [], executionMode
    );
    comp.posts = sampledPosts;
    comp.comments = sampledComments;
  }

  const signalResults = computeAllSignals(competitorInputs);
  const contentDnaResults = computeAllContentDNA(competitorInputs);
  console.log(`[FetchOrch] Content DNA computed for ${contentDnaResults.length} competitors in persistSnapshotAfterFetch`);
  const dataFreshnessDays = computeDataFreshnessDays(competitorInputs);
  let confidenceFreshnessDays = dataFreshnessDays;
  if (totalPosts < MIN_POSTS_TARGET && dataFreshnessDays <= DEFAULT_TIME_WINDOW_DAYS) {
    confidenceFreshnessDays = EXPANDED_TIME_WINDOW_DAYS;
    console.log(`[FetchOrch] Dynamic time window expanded to ${EXPANDED_TIME_WINDOW_DAYS} days for confidence (actual freshness=${dataFreshnessDays}d, posts=${totalPosts}/${MIN_POSTS_TARGET})`);
  }
  const intents = classifyAllIntents(signalResults);

  const provisionalIntents = intents.filter(i => i.intentStatus === "PROVISIONAL");
  const finalIntents = intents.filter(i => i.intentStatus === "FINAL");
  if (provisionalIntents.length > 0) {
    console.log(`[FetchOrch] INTENT_STATUS_SUMMARY: ${provisionalIntents.length} PROVISIONAL, ${finalIntents.length} FINAL | provisional=[${provisionalIntents.map(i => `${i.competitorName}:${i.intentStatusReason}`).join(", ")}]`);
  } else {
    console.log(`[FetchOrch] INTENT_STATUS_SUMMARY: all ${intents.length} intents FINAL`);
  }

  const dominantIntent = computeDominantMarketIntent(intents);
  const trajectory = computeTrajectory(signalResults, intents);
  const contentPrimaryMode = totalComments === 0 && totalPosts > 0;
  const confidence = computeConfidence(signalResults, confidenceFreshnessDays, 1.0, contentPrimaryMode);
  const dominanceResults = computeAllDominance(signalResults, confidence, campaignGoalMode);
  let missingFlags = aggregateMissingFlags(signalResults);
  const trajectoryDirection = deriveTrajectoryDirection(trajectory);
  const marketState = deriveMarketState(trajectory, confidence.level);

  if (isPartialCoverage) {
    const coveragePenalty = Math.round((1 - coverageRatio) * 0.5 * 100) / 100;
    confidence.overall = Math.max(0, Math.round((confidence.overall - coveragePenalty) * 100) / 100);
    if (confidence.overall < 0.3) {
      confidence.level = "INSUFFICIENT";
      confidence.guardDecision = "BLOCK";
      confidence.guardReasons = [...(confidence.guardReasons || []), `PARTIAL_COVERAGE: ${jobStopReason} (coverage=${(coverageRatio * 100).toFixed(0)}%)`];
    } else if (confidence.overall < 0.5) {
      confidence.level = "LOW";
      confidence.guardDecision = "DOWNGRADE";
      confidence.guardReasons = [...(confidence.guardReasons || []), `PARTIAL_COVERAGE: ${jobStopReason} (coverage=${(coverageRatio * 100).toFixed(0)}%)`];
    }

    const partialFlags: any = Array.isArray(missingFlags) ? [...missingFlags] : [];
    partialFlags.push({
      type: "PARTIAL_COVERAGE",
      reason: jobStopReason,
      coverageRatio,
      message: `Data collection stopped early due to ${jobStopReason.replace(/_/g, " ").toLowerCase()}. Coverage: ${(coverageRatio * 100).toFixed(0)}% (${Math.round(coverageRatio * competitorInputs.length)}/${competitorInputs.length} competitors).`,
    });
    missingFlags = partialFlags;

    console.log(`[FetchOrch] Partial coverage snapshot: confidence downgraded by ${coveragePenalty} to ${confidence.overall} (${confidence.level}), coverageRatio=${coverageRatio.toFixed(2)}, stopReason=${jobStopReason}`);
  }

  const volatilityIndex = computeVolatilityIndex(signalResults);
  const marketDiagnosis = buildMarketDiagnosis(confidence, trajectory, dominantIntent);
  const marketBaseline = await computeMarketBaseline(accountId, campaignId);
  const snr = computeSignalNoiseRatio(signalResults, confidence);
  const evCov = computeEvidenceCoverage(signalResults, competitorInputs.length);
  const calibrationCtx: CalibrationContext = {
    signalNoiseRatio: snr,
    confidenceScore: confidence.overall,
    postsAnalyzed: evCov.postsAnalyzed,
    competitorCoverage: competitorInputs.length > 0 ? evCov.competitorsWithSufficientData / competitorInputs.length : 0,
  };
  const deviations = computeAllDeviations(trajectory, marketBaseline, calibrationCtx);
  console.log(`[FetchOrch] Baseline calibration: calibrated=${marketBaseline.isCalibrated}, snapshotsUsed=${marketBaseline.snapshotsUsed}, effectiveThreshold=${deviations[0]?.effectiveThreshold?.toFixed(2) ?? "N/A"}`);

  const signalClusters = clusterSemanticSignals(signalResults);
  const totalSemanticSignals = signalResults.reduce((s, r) => s + r.semanticSignals.length, 0);
  console.log(`[FetchOrch] SEMANTIC_SIGNALS | total=${totalSemanticSignals} | clusters=${signalClusters.length} | reinforced=${signalClusters.filter(c => c.reinforcedScore >= 0.3).length}`);

  const qualityGate = applyQualityGate(signalResults, signalClusters);
  console.log(`[FetchOrch] SIGNAL_QUALITY_GATE | ${qualityGate.gateSummary}`);
  const clusterQuality = filterClustersByQuality(signalClusters, qualityGate);

  const gatedClusters = qualityGate.gatePass ? clusterQuality.filteredClusters : signalClusters;
  if (!qualityGate.gatePass) {
    console.log(`[FetchOrch] QUALITY_GATE_DEGRADED | Gate failed — using unfiltered clusters, snapshot will be PARTIAL`);
  }
  const threatSignals = buildThreatSignals(confidence, trajectory, intents, deviations, marketBaseline.isCalibrated, gatedClusters);
  const opportunitySignals = buildOpportunitySignals(confidence, trajectory, intents, deviations, marketBaseline.isCalibrated, gatedClusters);
  const similarityData = computeSimilarityDiagnosis(competitorInputs, signalResults);

  let narrativeSynthesis: string | null = null;
  if (executionMode !== "LIGHT" && confidence.guardDecision !== "BLOCK") {
    try {
      narrativeSynthesis = buildMarketSummary(marketState, trajectoryDirection, dominantIntent, confidence, intents);
    } catch (err) {
      console.error(`[FetchOrch] Narrative synthesis failed:`, err);
    }
  }

  const previousSnapshots = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const previousSnapshot = previousSnapshots[0] || null;
  const newVersion = (previousSnapshot?.version || 0) + 1;

  const { buildWebsiteSignals, buildBlogSignals, buildInstagramSignals, classifyWebsiteSignals, classifyBlogSignals, classifyInstagramSignals, reconcileMultiSourceSignals } = await import("./signal-normalizer");
  const { computeSourceAvailability: buildSourceAvail } = await import("./source-types");
  let multiSourceSignalsJson: string | null = null;
  let sourceAvailabilityJson: string | null = null;
  try {
    const allWebData = await db.select().from(competitorWebData)
      .where(and(eq(competitorWebData.accountId, accountId), eq(competitorWebData.campaignId, campaignId)));

    const perCompetitorMultiSource: Record<string, any> = {};
    for (const c of competitors) {
      const sourceAvail = buildSourceAvail(c);
      const compWebData = allWebData.filter(w => w.competitorId === c.id && w.sourceType === "website" && w.extractionStatus === "COMPLETE");
      const compBlogData = allWebData.find(w => w.competitorId === c.id && w.sourceType === "blog" && w.extractionStatus === "COMPLETE");

      const webExtractions = compWebData.map(w => ({
        competitorId: c.id,
        competitorName: c.name,
        sourceUrl: w.sourceUrl,
        pageType: (w.pageType || "homepage") as any,
        headlines: safeParseJson(w.headlines, []),
        subheadlines: safeParseJson(w.subheadlines, []),
        ctaLabels: safeParseJson(w.ctaLabels, []),
        offerPhrases: safeParseJson(w.offerPhrases, []),
        pricingAnchors: safeParseJson(w.pricingAnchors, []),
        proofBlocks: safeParseJson(w.proofBlocks, []),
        testimonialBlocks: safeParseJson(w.testimonialBlocks, []),
        guarantees: safeParseJson(w.guarantees, []),
        featureList: safeParseJson(w.featureList, []),
        navigationLinks: safeParseJson(w.navigationLinks, []),
        topicTitles: safeParseJson(w.topicTitles, []),
        contentHeadings: safeParseJson(w.contentHeadings, []),
        rawTextPreview: w.rawTextPreview || "",
        extractionStatus: "COMPLETE" as const,
        scrapedAt: w.scrapedAt?.toISOString() || new Date().toISOString(),
      }));

      const blogExtraction = compBlogData ? (() => {
        const topicTitles = safeParseJson(compBlogData.topicTitles, []);
        const contentHeadings = safeParseJson(compBlogData.contentHeadings, []);
        const navLinks = safeParseJson(compBlogData.navigationLinks, []);
        const derivedCategories = navLinks.filter((l: string) => /blog|category|topic|tag/i.test(l)).slice(0, 10);
        return {
          competitorId: c.id,
          competitorName: c.name,
          sourceUrl: compBlogData.sourceUrl,
          topicTitles,
          contentHeadings,
          categories: derivedCategories.length > 0 ? derivedCategories : contentHeadings.slice(0, 5),
          educationalThemes: topicTitles.filter((t: string) => /how|why|what|guide|tips/i.test(t)),
          rawTextPreview: compBlogData.rawTextPreview || "",
          extractionStatus: "COMPLETE" as const,
          scrapedAt: compBlogData.scrapedAt?.toISOString() || new Date().toISOString(),
        };
      })() : null;

      const contentDnaForComp = contentDnaResults.find(d => d.competitorId === c.id) || null;
      const captions = competitorInputs.find(ci => ci.id === c.id)?.posts?.map(p => p.caption) || [];
      const igSignals = buildInstagramSignals(contentDnaForComp, captions);
      const webSignals = buildWebsiteSignals(webExtractions);
      const blogSigs = buildBlogSignals(blogExtraction);

      const classified: any[] = [];
      for (const ext of webExtractions) classified.push(...classifyWebsiteSignals(ext));
      if (blogExtraction) classified.push(...classifyBlogSignals(blogExtraction));
      if (contentDnaForComp) classified.push(...classifyInstagramSignals(contentDnaForComp));

      const reconciled = reconcileMultiSourceSignals(igSignals, webSignals, blogSigs, classified, sourceAvail);
      perCompetitorMultiSource[c.id] = {
        competitorName: c.name,
        ...reconciled,
      };
    }

    const aggregatedAvail = buildSourceAvail({
      profileLink: competitors.some(c => c.profileLink) ? "any" : null,
      websiteUrl: competitors.some(c => c.websiteUrl) ? "any" : null,
      blogUrl: competitors.some(c => c.blogUrl) ? "any" : null,
      postsCollected: totalPosts,
      websiteEnrichmentStatus: competitors.some(c => c.websiteEnrichmentStatus === "COMPLETE") ? "COMPLETE" : "NONE",
      blogEnrichmentStatus: competitors.some(c => c.blogEnrichmentStatus === "COMPLETE") ? "COMPLETE" : "NONE",
    });

    multiSourceSignalsJson = JSON.stringify(perCompetitorMultiSource);
    sourceAvailabilityJson = JSON.stringify(aggregatedAvail);
    console.log(`[FetchOrch] Multi-source signals built | competitors=${Object.keys(perCompetitorMultiSource).length} | sources=${aggregatedAvail.availableSources.join(",")}`);
  } catch (err: any) {
    console.error(`[FetchOrch] Multi-source signal building failed (non-blocking):`, err.message);
  }

  const snapshotPayload = {
    accountId,
    campaignId,
    competitorHash,
    version: newVersion,
    competitorData: JSON.stringify(competitorInputs.map(c => ({ id: c.id, name: c.name }))),
    signalData: JSON.stringify(signalResults),
    intentData: JSON.stringify(intents),
    trajectoryData: JSON.stringify(trajectory),
    dominanceData: JSON.stringify(dominanceResults),
    confidenceData: JSON.stringify(confidence),
    marketState: isPartialCoverage ? "PARTIAL_DATA" : marketState,
    executionMode,
    snapshotSource,
    fetchExecuted,
    multiSourceSignals: multiSourceSignalsJson,
    sourceAvailability: sourceAvailabilityJson,
    telemetry: JSON.stringify({
      executionMode,
      projectedTokens: tokenBudget.projectedTokens,
      actualTokensUsed: 0,
      competitorsCount: competitorInputs.length,
      commentSampleSize: totalComments,
      postSampleSize: totalPosts,
      downgradeReason: isPartialCoverage ? `PARTIAL_COVERAGE:${jobStopReason}` : tokenBudget.downgradeReason,
      postsProcessed: totalPosts,
      commentsProcessed: totalComments,
      refreshReason: "FETCH_JOB_COMPLETE",
      partialCoverage: isPartialCoverage,
      jobStopReason: isPartialCoverage ? jobStopReason : null,
      snapshotSource,
      fetchExecuted,
    }),
    narrativeSynthesis,
    marketDiagnosis,
    threatSignals: JSON.stringify(threatSignals),
    opportunitySignals: JSON.stringify(opportunitySignals),
    missingSignalFlags: JSON.stringify(missingFlags),
    similarityData: JSON.stringify(similarityData),
    contentDnaData: JSON.stringify(contentDnaResults),
    diagnosticsData: JSON.stringify({
      signalQualityGate: {
        gatePass: qualityGate.gatePass,
        totalInput: qualityGate.totalInputSignals,
        passed: qualityGate.passedSignals.length,
        rejected: qualityGate.rejectedSignals.length,
        deduplicated: qualityGate.deduplicatedCount,
        crossValidated: qualityGate.crossValidatedCount,
        averageQuality: qualityGate.averageQuality,
        clusterQuality: {
          original: clusterQuality.originalClusters,
          qualified: clusterQuality.qualifiedClusters,
          mergedDuplicates: clusterQuality.mergedDuplicates,
        },
      },
    }),
    volatilityIndex,
    dataFreshnessDays,
    overallConfidence: confidence.overall,
    confidenceLevel: confidence.level,
    analysisVersion: ENGINE_VERSION,
    status: qualityGate.gatePass ? "COMPLETE" as const : "PARTIAL" as const,
    dataStatus,
    confirmedRuns: (previousSnapshot?.confirmedRuns || 0) + 1,
    previousDirection: trajectoryDirection,
    directionLockedUntil: null,
    goalMode: campaignGoalMode,
  };

  const snapshot = await persistValidatedSnapshot(snapshotPayload, "fetch-orchestrator.persistSnapshotAfterFetch");

  for (const sr of signalResults) {
    await db.insert(miSignalLogs).values({
      snapshotId: snapshot.id,
      competitorId: sr.competitorId,
      signals: JSON.stringify(sr.signals),
      signalCoverageScore: sr.signalCoverageScore,
      sourceReliabilityScore: sr.sourceReliabilityScore,
      sampleSize: sr.sampleSize,
      timeWindowDays: sr.timeWindowDays,
      varianceScore: sr.varianceScore,
      dominantSourceRatio: sr.dominantSourceRatio,
      missingFields: JSON.stringify(sr.missingFields),
    });
  }

  await db.insert(miTelemetry).values({
    snapshotId: snapshot.id,
    executionMode,
    projectedTokens: tokenBudget.projectedTokens,
    actualTokensUsed: 0,
    competitorsCount: competitorInputs.length,
    commentSampleSize: totalComments,
    postSampleSize: totalPosts,
    downgradeReason: tokenBudget.downgradeReason,
    postsProcessed: totalPosts,
    commentsProcessed: totalComments,
    refreshReason: "FETCH_JOB_COMPLETE",
  });

  console.log(`[FetchOrch] Snapshot v${newVersion} persisted (id=${snapshot.id}) for ${accountId}/${campaignId}`);

  logAudit(accountId, "MI_SNAPSHOT_PERSISTED_POST_FETCH", {
    details: {
      snapshotId: snapshot.id,
      version: newVersion,
      competitorCount: competitorInputs.length,
      signalCount: signalResults.length,
      marketState,
      confidence: confidence.overall,
    },
  }).catch(() => {});

  autoSignalCompletion(accountId, campaignId, signalResults, competitorInputs).catch(err => {
    console.error(`[FetchOrch] AUTO_SIGNAL_COMPLETION error: ${err.message}`);
  });
}

async function autoSignalCompletion(accountId: string, campaignId: string, signalResults: any[], competitorInputs: CompetitorInput[]): Promise<void> {
  const deficientCompetitors: { id: string; name: string; missingSignals: string[]; reason: string }[] = [];

  for (const sr of signalResults) {
    const comp = competitorInputs.find(c => c.id === sr.competitorId);
    if (!comp) continue;

    const reasons: string[] = [];
    const postCount = (comp.posts?.length || 0);
    const commentCount = (comp.comments?.length || 0);

    if (postCount < MIN_POSTS_TARGET) {
      reasons.push(`posts=${postCount}/${MIN_POSTS_TARGET}`);
    }
    if (sr.signalCoverageScore < 0.85) {
      reasons.push(`signalCoverage=${sr.signalCoverageScore}/0.85`);
    }
    if (sr.missingFields && sr.missingFields.length > 0) {
      reasons.push(`missingFields=[${sr.missingFields.join(",")}]`);
    }

    if (reasons.length > 0) {
      deficientCompetitors.push({
        id: sr.competitorId,
        name: sr.competitorName,
        missingSignals: sr.missingFields || [],
        reason: reasons.join("; "),
      });
    }
  }

  if (deficientCompetitors.length === 0) {
    console.log(`[FetchOrch] AUTO_SIGNAL_COMPLETION: all competitors have sufficient signals for ${accountId}/${campaignId}`);
    return;
  }

  console.log(`[FetchOrch] AUTO_SIGNAL_COMPLETION: ${deficientCompetitors.length} competitors with signal deficiencies for ${accountId}/${campaignId}`);

  for (const dc of deficientCompetitors) {
    const [existing] = await db.select().from(ciCompetitors).where(eq(ciCompetitors.id, dc.id));
    if (!existing || existing.analysisLevel === "DEEP_PASS") continue;

    console.log(`[FetchOrch] AUTO_SIGNAL_COMPLETION: queuing ${dc.name} for DEEP_PASS enrichment | ${dc.reason}`);

    await db.update(ciCompetitors)
      .set({ enrichmentStatus: "PENDING", updatedAt: new Date() })
      .where(eq(ciCompetitors.id, dc.id));
  }

  for (const dc of deficientCompetitors) {
    const [comp] = await db.select().from(ciCompetitors).where(eq(ciCompetitors.id, dc.id));
    if (comp) {
      const postResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
        .where(and(eq(ciCompetitorPosts.competitorId, dc.id), eq(ciCompetitorPosts.accountId, accountId)));
      const commentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, dc.id), eq(ciCompetitorComments.accountId, accountId)));
      const actualPosts = Number(postResult[0]?.count || 0);
      const actualComments = Number(commentResult[0]?.count || 0);
      await db.update(ciCompetitors)
        .set({ postsCollected: actualPosts, commentsCollected: actualComments, updatedAt: new Date() })
        .where(eq(ciCompetitors.id, dc.id));
      console.log(`[FetchOrch] AUTO_SIGNAL_COMPLETION: inventory refreshed for ${dc.name} | posts=${actualPosts} | comments=${actualComments}`);
    }
  }

  console.log(`[FetchOrch] AUTO_SIGNAL_COMPLETION_COMPLETE: signal deficiency enrichment queued + inventory refreshed for ${accountId}/${campaignId} | deficientCount=${deficientCompetitors.length}`);
}

export async function getFetchJobStatus(jobId: string): Promise<FetchJobStatus | null> {
  const [job] = await db.select().from(miFetchJobs)
    .where(eq(miFetchJobs.id, jobId));

  if (!job) return null;

  const parsedStages = job.stageStatuses ? JSON.parse(job.stageStatuses) : {};
  const stageVals = Object.values(parsedStages) as CompetitorStage[];
  const total = stageVals.length;
  const processed = stageVals.filter((s: CompetitorStage) => s.fetchStatus === "FETCH_SUCCESS" || s.fetchStatus === "NO_POSTS_FOUND" || s.fetchStatus === "COOLDOWN_ACTIVE").length;
  const failed = stageVals.filter((s: CompetitorStage) => s.fetchStatus === "FETCH_FAILED" || s.fetchStatus === "BLOCKED_BY_PLATFORM" || s.fetchStatus === "RATE_LIMITED").length;
  const skipped = stageVals.filter((s: CompetitorStage) => s.fetchStatus?.startsWith("SKIPPED_") || s.fetchStatus === "PENDING").length;

  return {
    jobId: job.id,
    status: job.status as FetchJobStatus["status"],
    stageStatuses: parsedStages,
    fetchLimitReasons: job.fetchLimitReasons ? JSON.parse(job.fetchLimitReasons) : [],
    totalPostsFetched: job.totalPostsFetched || 0,
    totalCommentsFetched: job.totalCommentsFetched || 0,
    competitorCount: job.competitorCount || 0,
    stopReason: (job.stopReason as StopReason) || undefined,
    newSnapshotId: job.snapshotIdCreated || undefined,
    error: job.error || undefined,
    durationMs: job.durationMs || undefined,
    createdAt: job.createdAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    collectionMode: job.collectionMode || "FAST_PASS",
    dataStatus: job.dataStatus || "LIVE",
    coverage: {
      competitorsTotal: total,
      competitorsProcessed: processed,
      competitorsFailed: failed,
      competitorsSkipped: skipped,
      coverageRatio: total > 0 ? processed / total : 0,
    },
  };
}

async function queueDeepPass(accountId: string, campaignId: string, competitors: any[]): Promise<void> {
  const DEEP_PASS_DELAY_MS = 5000;
  console.log(`[FetchOrch] DEEP_PASS enrichment scheduled in ${DEEP_PASS_DELAY_MS}ms for ${accountId}/${campaignId} | ${competitors.length} competitors`);
  await sleep(DEEP_PASS_DELAY_MS);

  const eligibleCompetitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));

  const notReady = eligibleCompetitors.filter(c => !c.lastCheckedAt);
  if (notReady.length > 0) {
    console.log(`[FetchOrch] DEEP_PASS_BLOCKED: ${notReady.length} competitors have not completed FAST_PASS (missing lastCheckedAt). Aborting DEEP_PASS for ${accountId}/${campaignId}. Competitors: ${notReady.map(c => c.name).join(", ")}`);
    return;
  }

  const signalDeficientCompetitors: typeof eligibleCompetitors = [];
  for (const c of eligibleCompetitors) {
    if (c.enrichmentStatus === "ENRICHED") {
      const posts = Number(c.postsCollected || 0);
      const comments = Number(c.commentsCollected || 0);
      const isSignalDeficient = posts < MIN_POSTS_TARGET;
      if (isSignalDeficient) {
        signalDeficientCompetitors.push(c);
        console.log(`[FetchOrch] SIGNAL_DEFICIENCY_ESCALATION: ${c.name} | posts=${posts}/${MIN_POSTS_TARGET} | re-queuing for DEEP_PASS`);
        await db.update(ciCompetitors)
          .set({ enrichmentStatus: "PENDING", updatedAt: new Date() })
          .where(eq(ciCompetitors.id, c.id));
      }
    }
  }

  if (signalDeficientCompetitors.length > 0) {
    console.log(`[FetchOrch] SIGNAL_DEFICIENCY_ESCALATION_SUMMARY: ${signalDeficientCompetitors.length} previously-enriched competitors re-queued due to signal deficiency for ${accountId}/${campaignId}`);
  }

  const refreshedCompetitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));

  const alreadyEnriched = refreshedCompetitors.filter(c => c.enrichmentStatus === "ENRICHED");
  const toEnrich = refreshedCompetitors.filter(c => c.enrichmentStatus !== "ENRICHED");

  if (toEnrich.length === 0) {
    console.log(`[FetchOrch] DEEP_PASS skipped: all ${refreshedCompetitors.length} competitors already enriched for ${accountId}/${campaignId}`);
    return;
  }

  console.log(`[FetchOrch] DEEP_PASS started (ENRICHMENT_ONLY) | ${accountId}/${campaignId} | toEnrich=${toEnrich.length} | alreadyEnriched=${alreadyEnriched.length} | baseline=12 posts per competitor`);

  try {
    await db.update(miSnapshots)
      .set({ dataStatus: "ENRICHING" })
      .where(and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
        inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
      ));
  } catch (err: any) {
    console.error(`[FetchOrch] Failed to set ENRICHING status: ${err.message}`);
  }

  for (const comp of toEnrich) {
    try {
      await db.update(ciCompetitors)
        .set({ enrichmentStatus: "ENRICHING", updatedAt: new Date() })
        .where(eq(ciCompetitors.id, comp.id));
    } catch {}
  }

  const startTime = Date.now();
  let enrichedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const comp of toEnrich) {
    try {
      const baselinePostResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
        .where(and(eq(ciCompetitorPosts.competitorId, comp.id), eq(ciCompetitorPosts.accountId, accountId)));
      const baselinePostCount = Number(baselinePostResult[0]?.count || 0);

      const baselineCommentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, comp.id), eq(ciCompetitorComments.accountId, accountId)));
      const baselineCommentCount = Number(baselineCommentResult[0]?.count || 0);

      console.log(`[FetchOrch] DEEP_PASS enrichment-only for ${comp.name} | posts=${baselinePostCount} (fixed baseline) | comments=${baselineCommentCount} | NO post expansion`);

      const result = await enrichCompetitorWithComments(comp.id, accountId);

      const totalCommentCount = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, comp.id), eq(ciCompetitorComments.accountId, accountId)));
      const deepPassCommentCount = Number(totalCommentCount[0]?.count || 0);

      const realCommentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, comp.id), eq(ciCompetitorComments.accountId, accountId), eq(ciCompetitorComments.isSynthetic, false)));
      const realCommentCount = Number(realCommentResult[0]?.count || 0);
      const syntheticCommentCount = deepPassCommentCount - realCommentCount;

      const enrichmentSucceeded = result.status === "ENRICHED" || result.status === "ALREADY_ENRICHED" || result.status === "REAL_DATA_SUFFICIENT" || result.status === "NO_ELIGIBLE_POSTS";

      let promotionDecision: string;

      if (result.status === "COOLDOWN_ACTIVE") {
        promotionDecision = "SKIPPED_COOLDOWN";
        skippedCount++;
        await db.update(ciCompetitors)
          .set({ enrichmentStatus: "SKIPPED", updatedAt: new Date() })
          .where(eq(ciCompetitors.id, comp.id));
        console.log(`[FetchOrch] competitor skipped (cooldown active) | ${comp.name}`);
      } else if (enrichmentSucceeded) {
        promotionDecision = "PROMOTED";
        enrichedCount++;
        await db.update(ciCompetitors)
          .set({
            analysisLevel: "DEEP_PASS",
            enrichmentStatus: "ENRICHED",
            fetchMethod: "DEEP_PASS",
            postsCollected: baselinePostCount,
            commentsCollected: deepPassCommentCount,
            updatedAt: new Date(),
          })
          .where(eq(ciCompetitors.id, comp.id));
        console.log(`[FetchOrch] competitor promoted to DEEP_PASS | ${comp.name} | analysisLevel=DEEP_PASS | posts=${baselinePostCount} (fixed) | comments=${deepPassCommentCount} (real=${realCommentCount}, synthetic=${syntheticCommentCount}) | status=${result.status} | COMMENT_TEXT_OPTIONAL=true`);
      } else {
        promotionDecision = "ENRICHMENT_FAILED";
        failedCount++;
        await db.update(ciCompetitors)
          .set({ enrichmentStatus: "FAILED", postsCollected: baselinePostCount, commentsCollected: deepPassCommentCount, updatedAt: new Date() })
          .where(eq(ciCompetitors.id, comp.id));
        console.log(`[FetchOrch] DEEP_PASS enrichment failed | ${comp.name} | posts=${baselinePostCount} | comments=${deepPassCommentCount} | status=${result.status}`);
      }

      console.log(`[FetchOrch] DEEP_PASS_DIAGNOSTICS: ${comp.name} | baselinePostCount=${baselinePostCount} | deepPassPostCount=${baselinePostCount} | realCommentCount=${realCommentCount} | syntheticCommentCount=${syntheticCommentCount} | totalCommentCount=${deepPassCommentCount} | promotionDecision=${promotionDecision} | enrichmentResult=${result.status} | postExpansionAttempted=false | postExpansionReason=DISABLED_12_POST_ARCHITECTURE | COMMENT_TEXT_OPTIONAL=true`);
    } catch (err: any) {
      console.error(`[FetchOrch] DEEP_PASS enrichment failed for ${comp.name}: ${err.message}`);
      failedCount++;
      try {
        await db.update(ciCompetitors)
          .set({ enrichmentStatus: "FAILED", updatedAt: new Date() })
          .where(eq(ciCompetitors.id, comp.id));
      } catch {}
    }
  }

  try {
    await persistSnapshotAfterFetch(accountId, campaignId, false, "COMPLETE", "FRESH_DATA", true, "COMPLETE");
    console.log(`[FetchOrch] DEEP_PASS snapshot recomputed (COMPLETE) for ${accountId}/${campaignId} | enriched=${enrichedCount} | failed=${failedCount} | skipped=${skippedCount} | duration=${Date.now() - startTime}ms`);
  } catch (err: any) {
    console.error(`[FetchOrch] DEEP_PASS snapshot persistence failed: ${err.message}`);
  }

  await validateInventoryConsistency(accountId, campaignId);
}

async function validateInventoryConsistency(accountId: string, campaignId: string): Promise<void> {
  try {
    const competitors = await db.select().from(ciCompetitors)
      .where(and(
        eq(ciCompetitors.accountId, accountId),
        eq(ciCompetitors.campaignId, campaignId),
        eq(ciCompetitors.isActive, true),
      ));

    let inconsistencies = 0;

    for (const comp of competitors) {
      const postResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts)
        .where(and(eq(ciCompetitorPosts.competitorId, comp.id), eq(ciCompetitorPosts.accountId, accountId)));
      const actualPosts = Number(postResult[0]?.count || 0);

      const commentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
        .where(and(eq(ciCompetitorComments.competitorId, comp.id), eq(ciCompetitorComments.accountId, accountId)));
      const actualComments = Number(commentResult[0]?.count || 0);

      if (comp.analysisLevel === "DEEP_PASS") {
        const postsAcceptable = actualPosts >= INSTAGRAM_API_CEILING;
        if (!postsAcceptable) {
          console.log(`[FetchOrch] INVENTORY_INCONSISTENCY: ${comp.name} labeled DEEP_PASS but posts=${actualPosts}/${INSTAGRAM_API_CEILING} — demoting to FAST_PASS/PENDING`);
          await db.update(ciCompetitors)
            .set({
              analysisLevel: "FAST_PASS",
              enrichmentStatus: "PENDING",
              postsCollected: actualPosts,
              commentsCollected: actualComments,
              updatedAt: new Date(),
            })
            .where(eq(ciCompetitors.id, comp.id));
          inconsistencies++;
        }
      }

      if (comp.postsCollected !== actualPosts || comp.commentsCollected !== actualComments) {
        await db.update(ciCompetitors)
          .set({
            postsCollected: actualPosts,
            commentsCollected: actualComments,
            updatedAt: new Date(),
          })
          .where(eq(ciCompetitors.id, comp.id));
      }
    }

    if (inconsistencies > 0) {
      console.log(`[FetchOrch] INVENTORY_VALIDATION: ${accountId}/${campaignId} | ${inconsistencies} inconsistencies corrected out of ${competitors.length} competitors`);
    } else {
      console.log(`[FetchOrch] INVENTORY_VALIDATION: ${accountId}/${campaignId} | all ${competitors.length} competitors consistent`);
    }
  } catch (err: any) {
    console.error(`[FetchOrch] Inventory validation failed: ${err.message}`);
  }
}

const GLOBAL_MAX_CONCURRENT_JOBS = 3;
const QUEUE_PROCESSOR_INTERVAL_MS = 30000;
const PER_ACCOUNT_JOB_BUDGET_PER_HOUR = 4;
const BACKPRESSURE_QUEUE_THRESHOLD = 20;
const MAX_PROMOTIONS_PER_MINUTE = 6;

const PRIORITY_FAST_PASS = 0;
const PRIORITY_DEEP_PASS = 5;
const PRIORITY_BACKGROUND = 10;

const accountJobTracker = new Map<string, { count: number; resetAt: number }>();
const promotionTracker = { count: 0, windowStart: Date.now() };

function checkAccountBudget(accountId: string): boolean {
  const now = Date.now();
  const tracker = accountJobTracker.get(accountId);
  if (!tracker || now > tracker.resetAt) {
    accountJobTracker.set(accountId, { count: 0, resetAt: now + 3600000 });
    return true;
  }
  return tracker.count < PER_ACCOUNT_JOB_BUDGET_PER_HOUR;
}

function incrementAccountBudget(accountId: string): void {
  const tracker = accountJobTracker.get(accountId);
  if (tracker) tracker.count++;
}

async function getGlobalRunningJobCount(): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
    .where(eq(miFetchJobs.status, "RUNNING"));
  return Number(result[0]?.count ?? 0);
}

function checkPromotionRateGate(): boolean {
  const now = Date.now();
  if (now - promotionTracker.windowStart > 60000) {
    promotionTracker.count = 0;
    promotionTracker.windowStart = now;
  }
  return promotionTracker.count < MAX_PROMOTIONS_PER_MINUTE;
}

function recordPromotion(): void {
  promotionTracker.count++;
}

const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000;

const STALE_QUEUED_GLOBAL_THRESHOLD_MS = 15 * 60 * 1000;

async function recoverStaleRunningJobs(): Promise<number> {
  const now = new Date();
  const staleRunningThreshold = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  const staleQueuedThreshold = new Date(Date.now() - STALE_QUEUED_GLOBAL_THRESHOLD_MS);

  const staleRunning = await db.update(miFetchJobs)
    .set({ status: "FAILED", error: "Auto-recovered: stuck in RUNNING for >30 minutes", completedAt: now })
    .where(and(
      eq(miFetchJobs.status, "RUNNING"),
      sql`${miFetchJobs.createdAt} < ${staleRunningThreshold}`,
    ))
    .returning({ id: miFetchJobs.id });
  if (staleRunning.length > 0) {
    console.log(`[QueueProcessor] STALE_RECOVERY: Auto-recovered ${staleRunning.length} stuck RUNNING jobs: ${staleRunning.map(j => j.id).join(", ")}`);
  }

  const staleQueued = await db.update(miFetchJobs)
    .set({ status: "FAILED", error: "Auto-expired: stuck in QUEUED for >15 minutes", completedAt: now })
    .where(and(
      eq(miFetchJobs.status, "QUEUED"),
      sql`${miFetchJobs.createdAt} < ${staleQueuedThreshold}`,
    ))
    .returning({ id: miFetchJobs.id });
  if (staleQueued.length > 0) {
    console.log(`[QueueProcessor] STALE_QUEUED_RECOVERY: Expired ${staleQueued.length} stuck QUEUED jobs: ${staleQueued.map(j => j.id).join(", ")}`);
  }

  return staleRunning.length + staleQueued.length;
}

async function processJobQueue(): Promise<void> {
  try {
    await recoverStaleRunningJobs();

    const globalRunning = await getGlobalRunningJobCount();
    if (globalRunning >= GLOBAL_MAX_CONCURRENT_JOBS) {
      return;
    }

    if (!checkPromotionRateGate()) {
      console.log(`[QueueProcessor] RATE_GATE: ${promotionTracker.count} promotions in current minute window, max=${MAX_PROMOTIONS_PER_MINUTE}, deferring`);
      return;
    }

    const queueDepth = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
      .where(eq(miFetchJobs.status, "QUEUED"));
    const totalQueued = Number(queueDepth[0]?.count ?? 0);

    if (totalQueued > BACKPRESSURE_QUEUE_THRESHOLD) {
      console.log(`[QueueProcessor] BACKPRESSURE: queue depth ${totalQueued} exceeds threshold ${BACKPRESSURE_QUEUE_THRESHOLD}, limiting to 1 promotion this cycle`);
    }

    const slotsAvailable = totalQueued > BACKPRESSURE_QUEUE_THRESHOLD
      ? 1
      : GLOBAL_MAX_CONCURRENT_JOBS - globalRunning;

    const queuedJobs = await db.select().from(miFetchJobs)
      .where(eq(miFetchJobs.status, "QUEUED"))
      .orderBy(miFetchJobs.priority, miFetchJobs.createdAt)
      .limit(slotsAvailable);

    if (queuedJobs.length === 0) return;

    for (const job of queuedJobs) {
      const accountRunning = await getRunningJobCountForAccount(job.accountId);
      if (accountRunning >= MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT) {
        continue;
      }

      if (!checkAccountBudget(job.accountId)) {
        console.log(`[QueueProcessor] Account ${job.accountId} exceeded hourly budget (${PER_ACCOUNT_JOB_BUDGET_PER_HOUR}/hr), skipping job ${job.id}`);
        continue;
      }

      const competitors = await db.select().from(ciCompetitors)
        .where(and(eq(ciCompetitors.accountId, job.accountId), eq(ciCompetitors.campaignId, job.campaignId), eq(ciCompetitors.isActive, true)));

      if (competitors.length === 0) {
        await db.update(miFetchJobs).set({ status: "FAILED", error: "No active competitors", completedAt: new Date() }).where(eq(miFetchJobs.id, job.id));
        continue;
      }

      if (!checkPromotionRateGate()) {
        console.log(`[QueueProcessor] RATE_GATE: reached ${MAX_PROMOTIONS_PER_MINUTE} promotions/min mid-cycle, stopping promotions`);
        break;
      }

      const promoted = await db.update(miFetchJobs)
        .set({ status: "RUNNING" })
        .where(and(eq(miFetchJobs.id, job.id), eq(miFetchJobs.status, "QUEUED")))
        .returning({ id: miFetchJobs.id });

      if (promoted.length === 0) {
        console.log(`[QueueProcessor] Job ${job.id} already promoted by another process, skipping`);
        continue;
      }

      incrementAccountBudget(job.accountId);
      recordPromotion();

      const lockKey = `${job.accountId}:${job.campaignId}`;
      console.log(`[QueueProcessor] Atomically promoted QUEUED→RUNNING job ${job.id} | priority=${job.priority} | account=${job.accountId} | globalSlots=${slotsAvailable}`);

      const promise = executeFetchJob(job.id, job.accountId, job.campaignId, competitors).catch(err => {
        console.error(`[QueueProcessor] Job ${job.id} fatal error:`, err.message);
      }).finally(() => {
        activeJobs.delete(lockKey);
      });
      activeJobs.set(lockKey, promise);
    }
  } catch (err: any) {
    console.error(`[QueueProcessor] Error processing queue:`, err.message);
  }
}

let queueProcessorHandle: ReturnType<typeof setInterval> | null = null;

let deepPassRecoveryRunning = false;

async function recoverStuckDeepPass(): Promise<void> {
  if (deepPassRecoveryRunning) return;
  deepPassRecoveryRunning = true;

  try {
    await db.execute(sql`
      UPDATE ci_competitors SET analysis_level = 'DEEP_PASS', enrichment_status = 'ENRICHED',
        posts_collected = (SELECT COUNT(*) FROM ci_competitor_posts WHERE competitor_id = ci_competitors.id AND account_id = ci_competitors.account_id),
        comments_collected = (SELECT COUNT(*) FROM ci_competitor_comments WHERE competitor_id = ci_competitors.id AND account_id = ci_competitors.account_id),
        updated_at = NOW()
      WHERE is_active = true AND analysis_level = 'FAST_PASS'
        AND enrichment_status != 'ENRICHED'
        AND (SELECT COUNT(*) FROM ci_competitor_posts WHERE competitor_id = ci_competitors.id AND account_id = ci_competitors.account_id) >= ${INSTAGRAM_API_CEILING}
    `);

    const stuckCompetitors = await db.execute(sql`
      SELECT c.id, c.name, c.account_id, c.campaign_id,
        (SELECT COUNT(*) FROM ci_competitor_posts WHERE competitor_id = c.id AND account_id = c.account_id) as post_count,
        (SELECT COUNT(*) FROM ci_competitor_comments WHERE competitor_id = c.id AND account_id = c.account_id) as comment_count
      FROM ci_competitors c
      WHERE c.is_active = true
        AND c.analysis_level = 'FAST_PASS'
        AND c.enrichment_status NOT IN ('ENRICHED', 'ENRICHING')
        AND c.last_checked_at IS NOT NULL
        AND (SELECT COUNT(*) FROM ci_competitor_posts WHERE competitor_id = c.id AND account_id = c.account_id) > 0
    `);

    const rows = stuckCompetitors.rows || [];

    if (rows.length > 0) {
      console.log(`[DeepPassRecovery] Found ${rows.length} competitors stuck at FAST_PASS with posts needing enrichment`);

      for (const row of rows) {
        try {
          await db.execute(sql`UPDATE ci_competitors SET enrichment_status = 'ENRICHING', updated_at = NOW() WHERE id = ${row.id}`);

          const baselinePostCount = Number(row.post_count || 0);
          const baselineCommentCount = Number(row.comment_count || 0);

          console.log(`[DeepPassRecovery] Enrichment-only for ${row.name} | posts=${baselinePostCount} (fixed) | comments=${baselineCommentCount} | NO post expansion`);

          const result = await enrichCompetitorWithComments(row.id as string, row.account_id as string);
          const enrichOk = result.status === "ENRICHED" || result.status === "ALREADY_ENRICHED" || result.status === "REAL_DATA_SUFFICIENT" || result.status === "NO_ELIGIBLE_POSTS";

          const finalCommentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
            .where(and(eq(ciCompetitorComments.competitorId, row.id as string), eq(ciCompetitorComments.accountId, row.account_id as string)));
          const finalComments = Number(finalCommentResult[0]?.count || 0);

          const realCommentResult = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments)
            .where(and(eq(ciCompetitorComments.competitorId, row.id as string), eq(ciCompetitorComments.accountId, row.account_id as string), eq(ciCompetitorComments.isSynthetic, false)));
          const realComments = Number(realCommentResult[0]?.count || 0);

          let promotionDecision: string;

          if (enrichOk) {
            promotionDecision = "PROMOTED";
            await db.execute(sql`UPDATE ci_competitors SET analysis_level = 'DEEP_PASS', enrichment_status = 'ENRICHED', fetch_method = 'DEEP_PASS', posts_collected = ${baselinePostCount}, comments_collected = ${finalComments}, updated_at = NOW() WHERE id = ${row.id}`);
            console.log(`[DeepPassRecovery] Promoted ${row.name} to DEEP_PASS | posts=${baselinePostCount} (fixed) | comments=${finalComments} (real=${realComments}) | status=${result.status} | COMMENT_TEXT_OPTIONAL=true`);
          } else {
            promotionDecision = "ENRICHMENT_FAILED";
            await db.execute(sql`UPDATE ci_competitors SET enrichment_status = 'FAILED', posts_collected = ${baselinePostCount}, comments_collected = ${finalComments}, updated_at = NOW() WHERE id = ${row.id}`);
            console.log(`[DeepPassRecovery] Enrichment failed for ${row.name} | comments=${finalComments} | status=${result.status}`);
          }

          console.log(`[DeepPassRecovery] DEEP_PASS_DIAGNOSTICS: ${row.name} | baselinePostCount=${baselinePostCount} | realCommentCount=${realComments} | totalCommentCount=${finalComments} | promotionDecision=${promotionDecision} | enrichmentResult=${result.status} | postExpansionAttempted=false | COMMENT_TEXT_OPTIONAL=true`);
        } catch (err: any) {
          console.error(`[DeepPassRecovery] Failed to enrich ${row.name}: ${err.message}`);
          try { await db.execute(sql`UPDATE ci_competitors SET enrichment_status = 'FAILED', updated_at = NOW() WHERE id = ${row.id}`); } catch {}
        }
      }
    }

    const campaignGroups = new Map<string, { accountId: string; campaignId: string }>();
    for (const row of rows) {
      const key = `${row.account_id}:${row.campaign_id}`;
      if (!campaignGroups.has(key)) {
        campaignGroups.set(key, { accountId: row.account_id as string, campaignId: row.campaign_id as string });
      }
    }

    const staleSnapshots = await db.execute(sql`
      SELECT DISTINCT s.account_id, s.campaign_id, s.data_freshness_days
      FROM mi_snapshots s
      WHERE s.status = 'COMPLETE'
        AND s.data_freshness_days > ${MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS}
        AND s.created_at > NOW() - INTERVAL '7 days'
        AND EXISTS (
          SELECT 1 FROM ci_competitor_posts p
          JOIN ci_competitors c ON c.id = p.competitor_id
          WHERE c.campaign_id = s.campaign_id AND c.account_id = s.account_id AND c.is_active = true
          AND p.timestamp > NOW() - INTERVAL '30 days'
        )
    `);

    const staleRows = staleSnapshots.rows || [];
    for (const row of staleRows) {
      const key = `${row.account_id}:${row.campaign_id}`;
      if (!campaignGroups.has(key)) {
        campaignGroups.set(key, { accountId: row.account_id as string, campaignId: row.campaign_id as string });
        console.log(`[DeepPassRecovery] Stale freshness detected for ${key} (stored=${row.data_freshness_days}d). Scheduling recompute.`);
      }
    }

    for (const { accountId, campaignId } of campaignGroups.values()) {
      try {
        await persistSnapshotAfterFetch(accountId, campaignId, false, "COMPLETE", "FRESH_DATA", true, "COMPLETE");
        console.log(`[DeepPassRecovery] Snapshot recomputed for ${accountId}/${campaignId}`);
      } catch (err: any) {
        console.error(`[DeepPassRecovery] Snapshot recompute failed for ${accountId}/${campaignId}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[DeepPassRecovery] Error:`, err.message);
  } finally {
    deepPassRecoveryRunning = false;
  }
}

export function startQueueProcessor(): void {
  if (queueProcessorHandle) return;
  queueProcessorHandle = setInterval(processJobQueue, QUEUE_PROCESSOR_INTERVAL_MS);
  console.log(`[QueueProcessor] Started — interval=${QUEUE_PROCESSOR_INTERVAL_MS}ms, globalMax=${GLOBAL_MAX_CONCURRENT_JOBS}, perAccountBudget=${PER_ACCOUNT_JOB_BUDGET_PER_HOUR}/hr`);

  setTimeout(async () => {
    try {
      const orphaned = await db.update(miFetchJobs)
        .set({ status: "QUEUED", error: null })
        .where(eq(miFetchJobs.status, "RUNNING"))
        .returning({ id: miFetchJobs.id });
      if (orphaned.length > 0) {
        console.log(`[QueueProcessor] STARTUP_RECOVERY: Reset ${orphaned.length} orphaned RUNNING→QUEUED: ${orphaned.map(j => j.id).join(", ")}`);
      }
    } catch (err: any) {
      console.error(`[QueueProcessor] STARTUP_RECOVERY error:`, err.message);
    }
  }, 5000);

  setTimeout(() => recoverStuckDeepPass(), 15000);

  setTimeout(async () => {
    try {
      const result = await cleanupExpiredSyntheticComments();
      if (result.deleted > 0 || result.diagnostics.highChurnCompetitors.length > 0) {
        console.log(`[SyntheticLifecycle] Cleanup complete: ${result.deleted} expired, ${result.reEnriched} re-enriched, ${result.competitorsAffected.length} competitors affected, cooldownBlocked=${result.diagnostics.cooldownBlockedCount}, realSufficient=${result.diagnostics.realDataSufficientCount}, highChurn=${result.diagnostics.highChurnCompetitors.length}`);
      }
    } catch (err: any) {
      console.error(`[SyntheticLifecycle] Cleanup error: ${err.message}`);
    }
  }, 30000);
}

export function stopQueueProcessor(): void {
  if (queueProcessorHandle) {
    clearInterval(queueProcessorHandle);
    queueProcessorHandle = null;
  }
}

export async function getQueueDiagnostics(): Promise<{
  globalRunning: number;
  globalMaxConcurrent: number;
  queuedJobs: number;
  perAccountBudget: number;
  accountTrackers: Record<string, { count: number; resetIn: number }>;
  health: {
    backpressureActive: boolean;
    backpressureThreshold: number;
    promotionsThisMinute: number;
    maxPromotionsPerMinute: number;
    rateGateActive: boolean;
    queueProcessorRunning: boolean;
  };
}> {
  const globalRunning = await getGlobalRunningJobCount();
  const queued = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
    .where(eq(miFetchJobs.status, "QUEUED"));
  const totalQueued = Number(queued[0]?.count ?? 0);

  const trackers: Record<string, { count: number; resetIn: number }> = {};
  const now = Date.now();
  for (const [acct, t] of accountJobTracker) {
    trackers[acct] = { count: t.count, resetIn: Math.max(0, Math.round((t.resetAt - now) / 1000)) };
  }

  const minuteElapsed = now - promotionTracker.windowStart > 60000;
  const currentPromotions = minuteElapsed ? 0 : promotionTracker.count;

  return {
    globalRunning,
    globalMaxConcurrent: GLOBAL_MAX_CONCURRENT_JOBS,
    queuedJobs: totalQueued,
    perAccountBudget: PER_ACCOUNT_JOB_BUDGET_PER_HOUR,
    accountTrackers: trackers,
    health: {
      backpressureActive: totalQueued > BACKPRESSURE_QUEUE_THRESHOLD,
      backpressureThreshold: BACKPRESSURE_QUEUE_THRESHOLD,
      promotionsThisMinute: currentPromotions,
      maxPromotionsPerMinute: MAX_PROMOTIONS_PER_MINUTE,
      rateGateActive: currentPromotions >= MAX_PROMOTIONS_PER_MINUTE,
      queueProcessorRunning: queueProcessorHandle !== null,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
