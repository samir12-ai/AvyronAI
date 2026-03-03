import { db } from "../db";
import { miFetchJobs, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorMetricsSnapshot } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { fetchCompetitorData, type FetchResult } from "../competitive-intelligence/data-acquisition";
import { computeAllSignals } from "./signal-engine";
import { getStoredPostsForMIv3, getStoredCommentsForMIv3 } from "../competitive-intelligence/data-acquisition";
import { computeCompetitorHash } from "./utils";
import type { CompetitorInput } from "./types";
import { logAudit } from "../audit";

const FETCH_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MIN_POSTS_TARGET = 30;
const MIN_COMMENTS_TARGET = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

type StageStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED";

interface CompetitorStage {
  competitorId: string;
  competitorName: string;
  POSTS_FETCH: StageStatus;
  COMMENTS_FETCH: StageStatus;
  CTA_ANALYSIS: StageStatus;
  SIGNAL_COMPUTE: StageStatus;
  postsFetched: number;
  commentsFetched: number;
  error?: string;
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
  status: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
  stageStatuses: Record<string, CompetitorStage>;
  fetchLimitReasons: FetchLimitReason[];
  totalPostsFetched: number;
  totalCommentsFetched: number;
  competitorCount: number;
  error?: string;
  durationMs?: number;
  createdAt?: string;
  completedAt?: string;
}

const activeJobs = new Map<string, Promise<void>>();

export async function startFetchJob(accountId: string, campaignId: string): Promise<string> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)));

  if (competitors.length === 0) {
    throw new Error("No active competitors found for this account");
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

  const lockKey = `${accountId}:${campaignId}`;

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
    };
  }

  try {
    for (const comp of competitors) {
      const stage = stages[comp.id];

      stage.POSTS_FETCH = "RUNNING";
      await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);

      let fetchResult: FetchResult | null = null;
      let retries = 0;

      while (retries <= MAX_RETRIES) {
        try {
          fetchResult = await fetchCompetitorData(comp.id, accountId, retries > 0);
          break;
        } catch (err: any) {
          retries++;
          if (retries > MAX_RETRIES) {
            stage.POSTS_FETCH = "FAILED";
            stage.error = err.message;
            limitReasons.push({
              competitorId: comp.id, competitorName: comp.name,
              stage: "POSTS_FETCH", reason: "ERROR", details: err.message,
            });
            break;
          }
          const delay = RETRY_BASE_MS * Math.pow(2, retries - 1);
          console.log(`[FetchOrch] Retry ${retries}/${MAX_RETRIES} for ${comp.name} in ${delay}ms`);
          await sleep(delay);
        }
      }

      if (!fetchResult) {
        stage.POSTS_FETCH = "FAILED";
        stage.COMMENTS_FETCH = "SKIPPED";
        stage.CTA_ANALYSIS = "SKIPPED";
        stage.SIGNAL_COMPUTE = "SKIPPED";
        await updateJobStages(jobId, stages, limitReasons, totalPosts, totalComments);
        continue;
      }

      if (fetchResult.status === "COOLDOWN") {
        stage.POSTS_FETCH = "COMPLETE";
        stage.COMMENTS_FETCH = "COMPLETE";
        stage.CTA_ANALYSIS = "COMPLETE";
        stage.SIGNAL_COMPUTE = "SKIPPED";
        stage.postsFetched = fetchResult.postsCollected;
        stage.commentsFetched = fetchResult.commentsCollected;
        totalPosts += fetchResult.postsCollected;
        totalComments += fetchResult.commentsCollected;
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "COOLDOWN",
          details: fetchResult.message,
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
      totalPosts += fetchResult.postsCollected;

      if (fetchResult.postsCollected < MIN_POSTS_TARGET && fetchResult.status !== "COOLDOWN") {
        limitReasons.push({
          competitorId: comp.id, competitorName: comp.name,
          stage: "POSTS_FETCH", reason: "INSUFFICIENT_DATA",
          details: `Only ${fetchResult.postsCollected} posts collected (target: ${MIN_POSTS_TARGET})`,
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

    const durationMs = Date.now() - startTime;
    const hasAnyFailure = Object.values(stages).some(s =>
      s.POSTS_FETCH === "FAILED" && s.COMMENTS_FETCH === "SKIPPED"
    );
    const allFailed = Object.values(stages).every(s => s.POSTS_FETCH === "FAILED");

    await db.update(miFetchJobs).set({
      status: allFailed ? "FAILED" : "COMPLETE",
      stageStatuses: JSON.stringify(stages),
      fetchLimitReasons: JSON.stringify(limitReasons),
      totalPostsFetched: totalPosts,
      totalCommentsFetched: totalComments,
      durationMs,
      completedAt: new Date(),
    }).where(eq(miFetchJobs.id, jobId));

    console.log(`[FetchOrch] Job ${jobId} completed in ${durationMs}ms | posts=${totalPosts} comments=${totalComments}`);

    logAudit(accountId, "MI_FETCH_JOB_COMPLETE", {
      details: {
        jobId, totalPosts, totalComments, durationMs,
        limitReasons: limitReasons.length,
        status: allFailed ? "FAILED" : "COMPLETE",
      },
    }).catch(() => {});

  } catch (err: any) {
    console.error(`[FetchOrch] Job ${jobId} fatal:`, err.message);
    await db.update(miFetchJobs).set({
      status: "FAILED",
      error: err.message,
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
    error: job.error || undefined,
    durationMs: job.durationMs || undefined,
    createdAt: job.createdAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
