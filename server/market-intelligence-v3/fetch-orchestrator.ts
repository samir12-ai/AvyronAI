import { db } from "../db";
import { miFetchJobs, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorMetricsSnapshot, miSnapshots, miSignalLogs, miTelemetry } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { fetchCompetitorData, type FetchResult } from "../competitive-intelligence/data-acquisition";
import { computeAllSignals, aggregateMissingFlags } from "./signal-engine";
import { classifyAllIntents, computeDominantMarketIntent } from "./intent-engine";
import { computeTrajectory, deriveTrajectoryDirection, deriveMarketState } from "./trajectory-engine";
import { computeConfidence } from "./confidence-engine";
import { computeAllDominance } from "./dominance-module";
import { computeTokenBudget, applySampling } from "./token-budget";
import { getStoredPostsForMIv3, getStoredCommentsForMIv3 } from "../competitive-intelligence/data-acquisition";
import { computeCompetitorHash } from "./utils";
import { computeVolatilityIndex, buildEntryStrategy, buildDefensiveRisks, buildDeterministicNarrative, persistValidatedSnapshot, ENGINE_VERSION } from "./engine";
import type { CompetitorInput } from "./types";
import { logAudit } from "../audit";
import { acquireStickySession, releaseStickySession, rotateSessionOnBlock, classifyBlock, logProxyTelemetry, getPoolDiagnostics, type StickySessionContext, type BlockClass } from "../competitive-intelligence/proxy-pool-manager";
import { acquireToken, getBucketState } from "../competitive-intelligence/rate-limiter";

const FETCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const INSTAGRAM_PUBLIC_API_POST_CEILING = 12;
const MIN_POSTS_TARGET = 30;
const MIN_COMMENTS_TARGET = 100;
const MAX_RETRIES = 3;
const MAX_PAGES_PER_COMPETITOR = 5;
const MAX_REQUESTS_PER_JOB = 50;
const MAX_RUNTIME_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_COMPETITORS_PER_JOB = 1;
const CONCURRENCY_FEATURE_FLAG = false;

type StopReason = "MAX_PAGES_REACHED" | "MAX_REQUESTS_REACHED" | "MAX_RUNTIME_REACHED" | "COMPLETE" | "ERROR" | "ALL_FAILED" | "COOLDOWN_ACTIVE";

type StageStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED" | "SKIPPED_FETCH_COOLDOWN" | "CACHED_ANALYSIS" | "BLOCKED_INSUFFICIENT_DATA";

interface CompetitorStage {
  competitorId: string;
  competitorName: string;
  POSTS_FETCH: StageStatus;
  COMMENTS_FETCH: StageStatus;
  CTA_ANALYSIS: StageStatus;
  SIGNAL_COMPUTE: StageStatus;
  postsFetched: number;
  commentsFetched: number;
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

interface FetchLimitReason {
  competitorId: string;
  competitorName: string;
  stage: string;
  reason: "RATE_LIMIT" | "PROXY_BLOCKED" | "PRIVATE_ACCOUNT" | "PAGINATION_STOPPED" | "COOLDOWN" | "ERROR" | "INSUFFICIENT_DATA";
  details: string;
}

export interface FetchJobStatus {
  jobId: string;
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "COMPLETE_WITH_COOLDOWN";
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
}

const activeJobs = new Map<string, Promise<void>>();
const creationLocks = new Set<string>();

export async function startFetchJob(accountId: string, campaignId: string): Promise<string> {
  const lockKey = `${accountId}:${campaignId}`;

  if (creationLocks.has(lockKey)) {
    const existingRunning = await db.select().from(miFetchJobs)
      .where(and(
        eq(miFetchJobs.accountId, accountId),
        eq(miFetchJobs.campaignId, campaignId),
        eq(miFetchJobs.status, "RUNNING"),
      ))
      .orderBy(desc(miFetchJobs.createdAt))
      .limit(1);
    if (existingRunning.length > 0) return existingRunning[0].id;
    throw new Error("Job creation already in progress. Please wait.");
  }

  creationLocks.add(lockKey);
  try {
    return await _createAndStartJob(accountId, campaignId, lockKey);
  } finally {
    creationLocks.delete(lockKey);
  }
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

  const existingRunning = await db.select().from(miFetchJobs)
    .where(and(
      eq(miFetchJobs.accountId, accountId),
      eq(miFetchJobs.campaignId, campaignId),
      eq(miFetchJobs.status, "RUNNING"),
    ))
    .orderBy(desc(miFetchJobs.createdAt))
    .limit(1);

  if (existingRunning.length > 0) {
    console.log(`[FetchOrch] Reusing active DB job ${existingRunning[0].id} for ${lockKey}`);
    return existingRunning[0].id;
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

  console.log(`[FetchOrch] Job ${jobId} created for ${competitors.length} competitors`);

  const promise = executeFetchJob(jobId, accountId, campaignId, competitors).catch(err => {
    console.error(`[FetchOrch] Job ${jobId} fatal error:`, err.message);
  }).finally(() => {
    activeJobs.delete(lockKey);
  });
  activeJobs.set(lockKey, promise);

  return jobId;
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
  let stopReason: StopReason = "COMPLETE";

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
      fetchExecuted: false,
    };
  }

  function checkRuntimeCeiling(): boolean {
    if (Date.now() - startTime >= MAX_RUNTIME_MS) {
      stopReason = "MAX_RUNTIME_REACHED";
      console.log(`[FetchOrch] HARD CEILING: MAX_RUNTIME ${MAX_RUNTIME_MS}ms reached`);
      return true;
    }
    return false;
  }

  function checkRequestCeiling(): boolean {
    if (totalRequests >= MAX_REQUESTS_PER_JOB) {
      stopReason = "MAX_REQUESTS_REACHED";
      console.log(`[FetchOrch] HARD CEILING: MAX_REQUESTS ${MAX_REQUESTS_PER_JOB} reached`);
      return true;
    }
    return false;
  }

  try {
    let competitorPageCount = 0;

    for (const comp of competitors) {
      if (checkRuntimeCeiling() || checkRequestCeiling()) {
        for (const s of Object.values(stages)) {
          if (s.POSTS_FETCH === "PENDING") {
            s.POSTS_FETCH = "SKIPPED";
            s.COMMENTS_FETCH = "SKIPPED";
            s.CTA_ANALYSIS = "SKIPPED";
            s.SIGNAL_COMPUTE = "SKIPPED";
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
        await acquireToken(accountId, campaignId, `POSTS_FETCH:${comp.name}`);
        totalRequests++;
        const startMs = Date.now();
        try {
          fetchResult = await fetchCompetitorData(comp.id, accountId, attempt > 1, proxyCtx || undefined);
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
            limitReasons.push({
              competitorId: comp.id, competitorName: comp.name,
              stage: "POSTS_FETCH", reason: blockClass === "PROXY_BLOCKED" ? "BLOCKED_BY_PLATFORM" : "ERROR",
              details: `${err.message} (blockClass=${blockClass}, attempts=${attempt - 1})`,
            });
            break;
          }

          if (blockClass === "RATE_LIMIT") {
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
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      if (fetchResult.status === "COOLDOWN") {
        const hoursMatch = fetchResult.message.match(/(\d+)h remaining/);
        const remainingHours = hoursMatch ? parseInt(hoursMatch[1], 10) : undefined;
        const remainingCooldownSeconds = remainingHours ? remainingHours * 3600 : undefined;

        stage.POSTS_FETCH = "SKIPPED_FETCH_COOLDOWN";
        stage.COMMENTS_FETCH = "SKIPPED_FETCH_COOLDOWN";
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

        const coverageMeetsThresholds = fetchResult.postsCollected >= MIN_POSTS_TARGET && fetchResult.commentsCollected >= MIN_COMMENTS_TARGET;

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
          console.log(`[FetchOrch] COVERAGE_VALIDATION_FAILED: Cached analysis blocked for ${comp.name} | posts=${fetchResult.postsCollected}/${MIN_POSTS_TARGET} comments=${fetchResult.commentsCollected}/${MIN_COMMENTS_TARGET} | cooldown active, coverage insufficient for analysis`);
        }

        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "COOLDOWN",
          details: `${fetchResult.message} | existingCoverage: ${fetchResult.postsCollected}p/${fetchResult.commentsCollected}c | thresholdsMet: ${coverageMeetsThresholds}`,
        });
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      if (fetchResult.status === "BLOCKED") {
        stage.POSTS_FETCH = "FAILED";
        stage.COMMENTS_FETCH = "SKIPPED";
        stage.CTA_ANALYSIS = "SKIPPED";
        stage.SIGNAL_COMPUTE = "SKIPPED";
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
      stage.rawFetchedCount = fetchResult.rawFetchedCount;
      stage.paginationPages = fetchResult.paginationPages;
      stage.paginationStopReason = fetchResult.paginationStopReason;
      totalPosts += fetchResult.postsCollected;

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
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "COMMENTS_FETCH", reason: "INSUFFICIENT_DATA",
          details: `Only ${fetchResult.commentsCollected} comments collected (target: ${MIN_COMMENTS_TARGET})`,
        });
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

      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
    }

    const anyAnalysisRan = Object.values(stages).some(
      s => s.SIGNAL_COMPUTE === "COMPLETE" || s.SIGNAL_COMPUTE === "CACHED_ANALYSIS"
    );
    const allCooldown = cooldownCount === competitors.length && competitors.length > 0;
    if (allCooldown) stopReason = "COOLDOWN_ACTIVE";
    const isPartialCoverage = stopReason !== "COMPLETE" && stopReason !== "COOLDOWN_ACTIVE";

    const anyFetchExecuted = Object.values(stages).some(s => s.fetchExecuted === true);
    const snapshotSourceType = anyFetchExecuted ? "FRESH_DATA" : "CACHED_DATA";

    if (anyAnalysisRan) {
      try {
        await persistSnapshotAfterFetch(accountId, campaignId, isPartialCoverage, stopReason, snapshotSourceType, anyFetchExecuted);
        console.log(`[FetchOrch] Snapshot persisted for ${accountId}/${campaignId} | partial=${isPartialCoverage} | allCooldown=${allCooldown} | snapshotSource=${snapshotSourceType} | fetchExecuted=${anyFetchExecuted}`);
      } catch (err: any) {
        console.error(`[FetchOrch] Snapshot persistence failed:`, err.message);
      }
    }

    const durationMs = Date.now() - startTime;
    const allFailed = Object.values(stages).every(s => s.POSTS_FETCH === "FAILED");
    if (allFailed && !allCooldown) stopReason = "ALL_FAILED";

    let snapshotIdCreated: string | null = null;
    if (anyAnalysisRan) {
      try {
        const latestSnap = await db.select({ id: miSnapshots.id }).from(miSnapshots)
          .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.status, "COMPLETE")))
          .orderBy(desc(miSnapshots.createdAt)).limit(1);
        if (latestSnap.length > 0) {
          snapshotIdCreated = latestSnap[0].id;
        }
      } catch { }
    }

    const anyInsufficientData = Object.values(stages).some(
      s => s.postsFetched !== undefined && (s.postsFetched < 30 || (s.commentsFetched || 0) < 100)
    );

    let finalJobStatus: string;
    if (allFailed && !allCooldown) {
      finalJobStatus = "FAILED";
    } else if (allCooldown && anyAnalysisRan) {
      finalJobStatus = "COMPLETE_WITH_COOLDOWN";
    } else if (anyInsufficientData && !allCooldown) {
      finalJobStatus = "PARTIAL_COMPLETE";
    } else {
      finalJobStatus = "COMPLETE";
    }

    const finalStopReason = stopReason !== "COMPLETE" ? stopReason : null;

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

    console.log(`[FetchOrch] Job ${jobId} completed in ${durationMs}ms | posts=${totalPosts} comments=${totalComments} | requests=${totalRequests} | stopReason=${stopReason}`);

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

async function persistSnapshotAfterFetch(accountId: string, campaignId: string, isPartialCoverage: boolean = false, jobStopReason: StopReason = "COMPLETE", snapshotSource: "FRESH_DATA" | "CACHED_DATA" = "FRESH_DATA", fetchExecuted: boolean = true): Promise<void> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  if (competitors.length === 0) return;

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
  const dataFreshnessDays = signalResults.length > 0 ? Math.max(...signalResults.map(r => r.timeWindowDays || 0)) : 0;
  const intents = classifyAllIntents(signalResults);
  const dominantIntent = computeDominantMarketIntent(intents);
  const trajectory = computeTrajectory(signalResults, intents);
  const confidence = computeConfidence(signalResults, dataFreshnessDays);
  const dominanceResults = computeAllDominance(signalResults, confidence);
  let missingFlags = aggregateMissingFlags(signalResults);
  const trajectoryDirection = deriveTrajectoryDirection(trajectory);
  const marketState = deriveMarketState(trajectory, confidence.level);

  if (isPartialCoverage) {
    const PARTIAL_CONFIDENCE_PENALTY = 0.3;
    confidence.overall = Math.max(0, Math.round((confidence.overall - PARTIAL_CONFIDENCE_PENALTY) * 100) / 100);
    if (confidence.overall < 0.3) {
      confidence.level = "INSUFFICIENT";
      confidence.guardDecision = "BLOCK";
      confidence.guardReasons = [...(confidence.guardReasons || []), `PARTIAL_COVERAGE: ${jobStopReason}`];
    } else if (confidence.overall < 0.5) {
      confidence.level = "LOW";
      confidence.guardDecision = "DOWNGRADE";
      confidence.guardReasons = [...(confidence.guardReasons || []), `PARTIAL_COVERAGE: ${jobStopReason}`];
    }

    const partialFlags: any = Array.isArray(missingFlags) ? [...missingFlags] : [];
    partialFlags.push({
      type: "PARTIAL_COVERAGE",
      reason: jobStopReason,
      message: `Data collection stopped early due to ${jobStopReason.replace(/_/g, " ").toLowerCase()}. Coverage is incomplete.`,
    });
    missingFlags = partialFlags;

    console.log(`[FetchOrch] Partial coverage snapshot: confidence downgraded to ${confidence.overall} (${confidence.level}), stopReason=${jobStopReason}`);
  }

  const volatilityIndex = computeVolatilityIndex(signalResults);
  const entryStrategy = buildEntryStrategy(confidence, trajectory, dominantIntent);
  const defensiveRisks = buildDefensiveRisks(confidence, trajectory, intents);

  let narrativeSynthesis: string | null = null;
  if (executionMode !== "LIGHT" && confidence.guardDecision !== "BLOCK") {
    try {
      narrativeSynthesis = buildDeterministicNarrative(marketState, trajectoryDirection, dominantIntent, confidence, intents);
    } catch (err) {
      console.error(`[FetchOrch] Narrative synthesis failed:`, err);
    }
  }

  const previousSnapshots = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      eq(miSnapshots.status, "COMPLETE"),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const previousSnapshot = previousSnapshots[0] || null;
  const newVersion = (previousSnapshot?.version || 0) + 1;

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
    entryStrategy,
    defensiveRisks: JSON.stringify(defensiveRisks),
    missingSignalFlags: JSON.stringify(missingFlags),
    volatilityIndex,
    dataFreshnessDays,
    overallConfidence: confidence.overall,
    confidenceLevel: confidence.level,
    analysisVersion: ENGINE_VERSION,
    status: "COMPLETE" as const,
    confirmedRuns: (previousSnapshot?.confirmedRuns || 0) + 1,
    previousDirection: trajectoryDirection,
    directionLockedUntil: null,
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
}

export async function getFetchJobStatus(jobId: string): Promise<FetchJobStatus | null> {
  const [job] = await db.select().from(miFetchJobs)
    .where(eq(miFetchJobs.id, jobId));

  if (!job) return null;

  return {
    jobId: job.id,
    status: job.status as FetchJobStatus["status"],
    stageStatuses: job.stageStatuses ? JSON.parse(job.stageStatuses) : {},
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
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
