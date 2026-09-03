/**
 * Dedicated Multi-Platform Comment Acquisition Engine (TikTok & YouTube)
 * 
 * Flow:
 * Canonical Competitor + Verified Source
 * -> Query persisted videos from ci_competitor_posts
 * -> Select bounded batch of recent/relevant video URLs
 * -> Execute dedicated comment-specific scraper actor via Apify
 * -> Persist customer comments into ci_competitor_comments with full lineage:
 *    (competitorId, sourceId, postId, commentId, author, text, timestamp, likes, isSynthetic=false, authorType='customer')
 * -> Emit explicit terminal statuses and exact telemetry:
 *    (commentsReturned, commentsInsertAttempted, commentsInserted, commentsConflictSkipped, commentsAlreadyExisting, finalStoredRows, uniqueEvidenceUnits)
 */

import { db } from "../db";
import { 
  ciCompetitors, 
  competitorSources, 
  ciCompetitorPosts, 
  ciCompetitorComments 
} from "@shared/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { runActorAndGetItems, isApifyAcquisitionConfigured } from "../acquisition/apify-client";

export type CommentFetchStatus = 
  | "SUCCESS" 
  | "SUCCESS_ZERO_COMMENTS" 
  | "PROVIDER_FAILED" 
  | "RATE_LIMITED" 
  | "BLOCKED_BY_PLATFORM" 
  | "TIMEOUT" 
  | "COMMENTS_UNSUPPORTED";

export interface CompetitorCommentTrace {
  competitorId: string;
  competitorName: string;
  platform: "TIKTOK" | "YOUTUBE";
  sourceId: string;
  canonicalUrl: string;
  videosAvailable: number;
  videosAttempted: number;
  status: CommentFetchStatus;
  commentsReturned: number;
  commentsInsertAttempted: number;
  commentsInserted: number;
  commentsConflictSkipped: number;
  commentsAlreadyExisting: number;
  finalStoredRows: number;
  uniqueEvidenceUnits: number;
  durationMs: number;
  error?: string | null;
}

/**
 * Scrapes customer comments for a competitor's persisted TikTok videos.
 */
export async function scrapeTikTokCommentsForCompetitor(opts: {
  competitorId: string;
  competitorName: string;
  sourceId: string;
  canonicalUrl: string;
  accountId: string;
  maxVideosToAttempt?: number;
  budgetMs?: number;
}): Promise<CompetitorCommentTrace> {
  const {
    competitorId,
    competitorName,
    sourceId,
    canonicalUrl,
    accountId,
    maxVideosToAttempt = 5,
    budgetMs = 90_000,
  } = opts;

  const startedAt = Date.now();

  // 1. Query existing stored comments in DB before fetch
  const preExisting = await db.select({ 
    id: ciCompetitorComments.id, 
    commentText: ciCompetitorComments.commentText 
  }).from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      eq(ciCompetitorComments.source, "tiktok_scrape")
    ));

  const existingIdSet = new Set(preExisting.map(r => r.id));
  const existingTexts = new Set(preExisting.map(r => (r.commentText || "").trim().toLowerCase()));
  const commentsAlreadyExisting = preExisting.length;

  // 2. Query persisted TikTok videos for this competitor
  const posts = await db.select().from(ciCompetitorPosts)
    .where(and(
      eq(ciCompetitorPosts.competitorId, competitorId),
      eq(ciCompetitorPosts.accountId, accountId),
      eq(ciCompetitorPosts.platform, "tiktok")
    ));

  const validPosts = posts.filter(p => p.permalink && p.permalink.includes("tiktok.com"));
  const videosAvailable = validPosts.length;

  if (videosAvailable === 0) {
    return {
      competitorId,
      competitorName,
      platform: "TIKTOK",
      sourceId,
      canonicalUrl,
      videosAvailable: 0,
      videosAttempted: 0,
      status: "SUCCESS_ZERO_COMMENTS",
      commentsReturned: 0,
      commentsInsertAttempted: 0,
      commentsInserted: 0,
      commentsConflictSkipped: 0,
      commentsAlreadyExisting,
      finalStoredRows: commentsAlreadyExisting,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: "No persisted TikTok videos available for comment extraction",
    };
  }

  const selectedPosts = validPosts.slice(0, maxVideosToAttempt);
  const targetUrls = selectedPosts.map(p => p.permalink!);
  const postMapByUrl = new Map(selectedPosts.map(p => [p.permalink!, p]));

  let commentsReturned = 0;
  let commentsInsertAttempted = 0;
  let commentsInserted = 0;
  let commentsConflictSkipped = 0;
  const seenCommentKeys = new Set<string>();
  const fetchedDatasetUrls = new Set<string>();

  try {
    const result = await runActorAndGetItems({
      actorId: "clockworks~free-tiktok-scraper",
      input: {
        postURLs: targetUrls,
        commentsPerPost: 20,
        maxComments: 20,
      },
      budgetMs,
      label: `TikTok-Comments-${competitorName.slice(0, 15)}`,
    });

    for (const item of result.items) {
      let rawCommentsList: any[] = [];
      if (Array.isArray(item.comments) && item.comments.length > 0) {
        rawCommentsList = item.comments;
      } else if (item.commentsDatasetUrl && !fetchedDatasetUrls.has(item.commentsDatasetUrl)) {
        fetchedDatasetUrls.add(item.commentsDatasetUrl);
        try {
          const cRes = await fetch(item.commentsDatasetUrl);
          if (cRes.ok) {
            const cItems = await cRes.json();
            if (Array.isArray(cItems)) {
              rawCommentsList = cItems;
            }
          }
        } catch (fetchErr: any) {
          console.warn(`[TikTokCommentFetch] Failed to fetch comments dataset:`, fetchErr.message);
        }
      }

      const matchedPost = postMapByUrl.get(item.submittedVideoUrl || item.webVideoUrl || item.input) || selectedPosts[0];
      const parentPostId = matchedPost?.postId || item.id || "unknown_post";

      for (const rawC of rawCommentsList) {
        const commentId = String(rawC.cid || rawC.id || `${parentPostId}_${commentsReturned}`);
        const text = (rawC.text || "").trim();
        if (!text) continue;

        // Ensure we only process each distinct comment ID once per scrape run
        const uniqueKey = `${parentPostId}:${commentId}`;
        if (seenCommentKeys.has(uniqueKey)) continue;
        seenCommentKeys.add(uniqueKey);

        commentsReturned++;

        const username = rawC.uniqueId || rawC.nickName || rawC.authorMeta?.name || null;
        const timestamp = rawC.createTimeISO 
          ? new Date(rawC.createTimeISO) 
          : (rawC.createTime ? new Date(rawC.createTime * 1000) : new Date());
        const likes = typeof rawC.diggCount === "number" ? rawC.diggCount : 0;
        const dbId = `comm_tt_${competitorId}_${commentId}`.slice(0, 60);

        commentsInsertAttempted++;

        if (existingIdSet.has(dbId)) {
          commentsConflictSkipped++;
          continue;
        }

        try {
          await db.insert(ciCompetitorComments).values({
            id: dbId,
            competitorId,
            accountId,
            postId: parentPostId,
            commentId,
            username,
            commentText: text,
            likesCount: likes,
            timestamp,
            isSynthetic: false,
            source: "tiktok_scrape",
            authorType: "customer",
            platform: "tiktok",
            batchId: `tt_comm_${Date.now()}`,
          } as any).onConflictDoNothing();
          
          commentsInserted++;
          existingIdSet.add(dbId);
          existingTexts.add(text.toLowerCase());
        } catch (insertErr: any) {
          console.warn(`[TikTokCommentFetch] Failed to persist comment ${commentId}:`, insertErr.message);
        }
      }
    }

    return {
      competitorId,
      competitorName,
      platform: "TIKTOK",
      sourceId,
      canonicalUrl,
      videosAvailable,
      videosAttempted: selectedPosts.length,
      status: commentsReturned > 0 || commentsAlreadyExisting > 0 ? "SUCCESS" : "SUCCESS_ZERO_COMMENTS",
      commentsReturned,
      commentsInsertAttempted,
      commentsInserted,
      commentsConflictSkipped,
      commentsAlreadyExisting,
      finalStoredRows: existingIdSet.size,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err: any) {
    return {
      competitorId,
      competitorName,
      platform: "TIKTOK",
      sourceId,
      canonicalUrl,
      videosAvailable,
      videosAttempted: selectedPosts.length,
      status: "PROVIDER_FAILED",
      commentsReturned: 0,
      commentsInsertAttempted: 0,
      commentsInserted: 0,
      commentsConflictSkipped: 0,
      commentsAlreadyExisting,
      finalStoredRows: commentsAlreadyExisting,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

/**
 * Scrapes customer comments for a competitor's persisted YouTube videos.
 */
export async function scrapeYouTubeCommentsForCompetitor(opts: {
  competitorId: string;
  competitorName: string;
  sourceId: string;
  canonicalUrl: string;
  accountId: string;
  maxVideosToAttempt?: number;
  budgetMs?: number;
}): Promise<CompetitorCommentTrace> {
  const {
    competitorId,
    competitorName,
    sourceId,
    canonicalUrl,
    accountId,
    maxVideosToAttempt = 5,
    budgetMs = 90_000,
  } = opts;

  const startedAt = Date.now();

  // 1. Query existing stored comments in DB before fetch
  const preExisting = await db.select({ 
    id: ciCompetitorComments.id, 
    commentText: ciCompetitorComments.commentText 
  }).from(ciCompetitorComments)
    .where(and(
      eq(ciCompetitorComments.competitorId, competitorId),
      eq(ciCompetitorComments.accountId, accountId),
      eq(ciCompetitorComments.source, "youtube_scrape")
    ));

  const existingIdSet = new Set(preExisting.map(r => r.id));
  const existingTexts = new Set(preExisting.map(r => (r.commentText || "").trim().toLowerCase()));
  const commentsAlreadyExisting = preExisting.length;

  // 2. Query persisted YouTube videos for this competitor
  const posts = await db.select().from(ciCompetitorPosts)
    .where(and(
      eq(ciCompetitorPosts.competitorId, competitorId),
      eq(ciCompetitorPosts.accountId, accountId),
      eq(ciCompetitorPosts.platform, "youtube")
    ));

  const validPosts = posts.filter(p => p.permalink && p.permalink.includes("youtube.com"));
  const videosAvailable = validPosts.length;

  if (videosAvailable === 0) {
    return {
      competitorId,
      competitorName,
      platform: "YOUTUBE",
      sourceId,
      canonicalUrl,
      videosAvailable: 0,
      videosAttempted: 0,
      status: "SUCCESS_ZERO_COMMENTS",
      commentsReturned: 0,
      commentsInsertAttempted: 0,
      commentsInserted: 0,
      commentsConflictSkipped: 0,
      commentsAlreadyExisting,
      finalStoredRows: commentsAlreadyExisting,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: "No persisted YouTube videos available for comment extraction",
    };
  }

  const selectedPosts = validPosts.slice(0, maxVideosToAttempt);
  const targetUrls = selectedPosts.map(p => ({ url: p.permalink! }));
  const postMapByUrl = new Map(selectedPosts.map(p => [p.permalink!, p]));

  let commentsReturned = 0;
  let commentsInsertAttempted = 0;
  let commentsInserted = 0;
  let commentsConflictSkipped = 0;
  const seenCommentKeys = new Set<string>();

  try {
    const result = await runActorAndGetItems({
      actorId: "streamers~youtube-scraper",
      input: {
        startUrls: targetUrls,
        maxResults: selectedPosts.length,
        maxComments: 20,
      },
      budgetMs,
      label: `YouTube-Comments-${competitorName.slice(0, 15)}`,
    });

    for (const item of result.items) {
      if (item.error === "NO_COMMENTS" || item.note?.includes("No comments found")) {
        continue;
      }

      const rawCommentsList = Array.isArray(item.comments) ? item.comments : [];
      const matchedPost = postMapByUrl.get(item.url || item.input) || selectedPosts[0];
      const parentPostId = matchedPost?.postId || item.id || "unknown_yt_video";

      for (const rawC of rawCommentsList) {
        const commentId = String(rawC.id || rawC.commentId || `${parentPostId}_${commentsReturned}`);
        const text = (rawC.text || rawC.comment || "").trim();
        if (!text) continue;

        const uniqueKey = `${parentPostId}:${commentId}`;
        if (seenCommentKeys.has(uniqueKey)) continue;
        seenCommentKeys.add(uniqueKey);

        commentsReturned++;

        const username = rawC.author || rawC.authorName || rawC.channelTitle || null;
        const timestamp = rawC.publishedAt || rawC.date ? new Date(rawC.publishedAt || rawC.date) : new Date();
        const likes = typeof rawC.likes === "number" ? rawC.likes : (typeof rawC.voteCount === "number" ? rawC.voteCount : 0);
        const dbId = `comm_yt_${competitorId}_${commentId}`.slice(0, 60);

        commentsInsertAttempted++;

        if (existingIdSet.has(dbId)) {
          commentsConflictSkipped++;
          continue;
        }

        try {
          await db.insert(ciCompetitorComments).values({
            id: dbId,
            competitorId,
            accountId,
            postId: parentPostId,
            commentId,
            username,
            commentText: text,
            likesCount: likes,
            timestamp,
            isSynthetic: false,
            source: "youtube_scrape",
            authorType: "customer",
            platform: "youtube",
            batchId: `yt_comm_${Date.now()}`,
          } as any).onConflictDoNothing();
          
          commentsInserted++;
          existingIdSet.add(dbId);
          existingTexts.add(text.toLowerCase());
        } catch (insertErr: any) {
          console.warn(`[YouTubeCommentFetch] Failed to persist comment ${commentId}:`, insertErr.message);
        }
      }
    }

    return {
      competitorId,
      competitorName,
      platform: "YOUTUBE",
      sourceId,
      canonicalUrl,
      videosAvailable,
      videosAttempted: selectedPosts.length,
      status: commentsReturned > 0 || commentsAlreadyExisting > 0 ? "SUCCESS" : "SUCCESS_ZERO_COMMENTS",
      commentsReturned,
      commentsInsertAttempted,
      commentsInserted,
      commentsConflictSkipped,
      commentsAlreadyExisting,
      finalStoredRows: existingIdSet.size,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err: any) {
    return {
      competitorId,
      competitorName,
      platform: "YOUTUBE",
      sourceId,
      canonicalUrl,
      videosAvailable,
      videosAttempted: selectedPosts.length,
      status: "PROVIDER_FAILED",
      commentsReturned: 0,
      commentsInsertAttempted: 0,
      commentsInserted: 0,
      commentsConflictSkipped: 0,
      commentsAlreadyExisting,
      finalStoredRows: commentsAlreadyExisting,
      uniqueEvidenceUnits: existingTexts.size,
      durationMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

/**
 * Executes comment acquisition across all verified TikTok and YouTube sources for a campaign.
 */
export async function executeCampaignCommentAcquisition(
  accountId: string,
  campaignId: string
): Promise<{
  tiktokTraces: CompetitorCommentTrace[];
  youtubeTraces: CompetitorCommentTrace[];
  totalCommentsInserted: number;
}> {
  const activeComps = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const activeCompMap = new Map(activeComps.map(c => [c.id, c.name]));
  const activeCompIds = activeComps.map(c => c.id);

  if (activeCompIds.length === 0) {
    return { tiktokTraces: [], youtubeTraces: [], totalCommentsInserted: 0 };
  }

  const sources = await db.select().from(competitorSources)
    .where(and(
      eq(competitorSources.accountId, accountId),
      eq(competitorSources.campaignId, campaignId),
      eq(competitorSources.status, "ACTIVE"),
      inArray(competitorSources.competitorId, activeCompIds)
    ));

  const tiktokSources = sources.filter(s => s.platform === "TIKTOK");
  const youtubeSources = sources.filter(s => s.platform === "YOUTUBE");

  const tiktokTraces: CompetitorCommentTrace[] = [];
  const youtubeTraces: CompetitorCommentTrace[] = [];
  let totalCommentsInserted = 0;

  // 1. Process TikTok Sources
  for (const src of tiktokSources) {
    const compName = activeCompMap.get(src.competitorId) || src.competitorId;
    console.log(`[CommentAcquisition] Fetching TikTok comments for ${compName} (${src.canonicalUrl})...`);
    const trace = await scrapeTikTokCommentsForCompetitor({
      competitorId: src.competitorId,
      competitorName: compName,
      sourceId: src.id,
      canonicalUrl: src.canonicalUrl,
      accountId,
    });
    tiktokTraces.push(trace);
    totalCommentsInserted += trace.commentsInserted;
  }

  // 2. Process YouTube Sources
  for (const src of youtubeSources) {
    const compName = activeCompMap.get(src.competitorId) || src.competitorId;
    console.log(`[CommentAcquisition] Fetching YouTube comments for ${compName} (${src.canonicalUrl})...`);
    const trace = await scrapeYouTubeCommentsForCompetitor({
      competitorId: src.competitorId,
      competitorName: compName,
      sourceId: src.id,
      canonicalUrl: src.canonicalUrl,
      accountId,
    });
    youtubeTraces.push(trace);
    totalCommentsInserted += trace.commentsInserted;
  }

  return {
    tiktokTraces,
    youtubeTraces,
    totalCommentsInserted,
  };
}
