import { db } from "../db";
import {
  ciSharedProfiles,
  ciCompetitors,
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorMetricsSnapshot,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const SHARED_REUSE_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface SharedProfileLookup {
  found: boolean;
  sharedProfileId?: string;
  postCount?: number;
  commentCount?: number;
  followers?: number | null;
  scrapeQuality?: string;
  lastScrapedAt?: Date;
  isStale?: boolean;
}

export async function lookupSharedProfile(
  platform: string,
  normalizedHandle: string,
  minPostsThreshold: number
): Promise<SharedProfileLookup> {
  const [profile] = await db
    .select()
    .from(ciSharedProfiles)
    .where(
      and(
        eq(ciSharedProfiles.platform, platform),
        eq(ciSharedProfiles.normalizedHandle, normalizedHandle)
      )
    )
    .limit(1);

  if (!profile || !profile.lastScrapedAt) {
    return { found: false };
  }

  const elapsed = Date.now() - new Date(profile.lastScrapedAt).getTime();
  const isStale = elapsed >= SHARED_REUSE_WINDOW_MS;
  const hasSufficientData = (profile.postCount ?? 0) >= minPostsThreshold;

  return {
    found: true,
    sharedProfileId: profile.id,
    postCount: profile.postCount ?? 0,
    commentCount: profile.commentCount ?? 0,
    followers: profile.followers,
    scrapeQuality: profile.scrapeQuality ?? "FAST_PASS",
    lastScrapedAt: new Date(profile.lastScrapedAt),
    isStale: isStale || !hasSufficientData,
  };
}

export async function upsertSharedProfile(
  platform: string,
  normalizedHandle: string,
  data: {
    followers: number | null;
    bioText?: string | null;
    linkInBio?: string | null;
    postCount: number;
    commentCount: number;
    scrapeQuality: string;
    fetchMethod: string | null;
  }
): Promise<string> {
  const [existing] = await db
    .select({ id: ciSharedProfiles.id })
    .from(ciSharedProfiles)
    .where(
      and(
        eq(ciSharedProfiles.platform, platform),
        eq(ciSharedProfiles.normalizedHandle, normalizedHandle)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(ciSharedProfiles)
      .set({
        followers: data.followers,
        bioText: data.bioText ?? null,
        linkInBio: data.linkInBio ?? null,
        postCount: data.postCount,
        commentCount: data.commentCount,
        scrapeQuality: data.scrapeQuality,
        fetchMethod: data.fetchMethod,
        lastScrapedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ciSharedProfiles.id, existing.id));

    return existing.id;
  }

  const [created] = await db
    .insert(ciSharedProfiles)
    .values({
      platform,
      normalizedHandle,
      followers: data.followers,
      bioText: data.bioText ?? null,
      linkInBio: data.linkInBio ?? null,
      postCount: data.postCount,
      commentCount: data.commentCount,
      scrapeQuality: data.scrapeQuality,
      fetchMethod: data.fetchMethod,
      lastScrapedAt: new Date(),
    })
    .returning({ id: ciSharedProfiles.id });

  return created.id;
}

export async function linkCompetitorToSharedProfile(
  competitorId: string,
  sharedProfileId: string
): Promise<void> {
  await db
    .update(ciCompetitors)
    .set({ sharedProfileId, updatedAt: new Date() })
    .where(eq(ciCompetitors.id, competitorId));
}

export interface SharedReuseResult {
  postsCollected: number;
  commentsCollected: number;
  followers: number | null;
  engagementRate: number | null;
  postingFrequency: number | null;
  contentMix: string | null;
  ctaCoverage: number;
  ctaTypes: string[];
  hoursAgo: number;
}

export async function reuseFromSharedPool(
  targetCompetitorId: string,
  targetAccountId: string,
  sharedProfileId: string,
  sharedProfile: SharedProfileLookup
): Promise<SharedReuseResult | null> {
  const [sourceCompetitor] = await db
    .select({ id: ciCompetitors.id, accountId: ciCompetitors.accountId })
    .from(ciCompetitors)
    .where(eq(ciCompetitors.sharedProfileId, sharedProfileId))
    .limit(1);

  if (!sourceCompetitor) {
    return null;
  }

  if (sourceCompetitor.id === targetCompetitorId) {
    return null;
  }

  const existingPostCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.competitorId, targetCompetitorId),
        eq(ciCompetitorPosts.accountId, targetAccountId)
      )
    );

  if (Number(existingPostCount[0]?.count ?? 0) > 0) {
    return null;
  }

  const batchId = `shared_reuse_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const sourcePosts = await db
    .select()
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.competitorId, sourceCompetitor.id),
        eq(ciCompetitorPosts.accountId, sourceCompetitor.accountId)
      )
    );

  if (sourcePosts.length === 0) {
    return null;
  }

  const postRows = sourcePosts.map((p) => ({
    competitorId: targetCompetitorId,
    accountId: targetAccountId,
    postId: p.postId,
    permalink: p.permalink,
    mediaType: p.mediaType,
    caption: p.caption,
    likes: p.likes,
    comments: p.comments,
    views: p.views,
    hashtags: p.hashtags,
    timestamp: p.timestamp,
    hasCTA: p.hasCTA,
    ctaType: p.ctaType,
    hasOffer: p.hasOffer,
    shortcode: p.shortcode,
    batchId,
  }));

  const sourcePostIds = new Set(sourcePosts.map((p) => p.postId));

  const sourceComments = await db
    .select()
    .from(ciCompetitorComments)
    .where(
      and(
        eq(ciCompetitorComments.competitorId, sourceCompetitor.id),
        eq(ciCompetitorComments.accountId, sourceCompetitor.accountId)
      )
    );

  const commentRows = sourceComments
    .filter((c) => sourcePostIds.has(c.postId))
    .map((c) => ({
      competitorId: targetCompetitorId,
      accountId: targetAccountId,
      postId: c.postId,
      commentId: c.commentId,
      username: c.username,
      commentText: c.commentText,
      sentiment: c.sentiment,
      timestamp: c.timestamp,
      batchId,
      isSynthetic: c.isSynthetic,
      source: c.source,
    }));

  await db.transaction(async (tx) => {
    for (const row of postRows) {
      await tx.insert(ciCompetitorPosts).values(row).onConflictDoNothing();
    }
    for (const row of commentRows) {
      await tx.insert(ciCompetitorComments).values(row).onConflictDoNothing();
    }
  });

  const latestSourceMetrics = await db
    .select()
    .from(ciCompetitorMetricsSnapshot)
    .where(
      and(
        eq(ciCompetitorMetricsSnapshot.competitorId, sourceCompetitor.id),
        eq(ciCompetitorMetricsSnapshot.accountId, sourceCompetitor.accountId)
      )
    )
    .orderBy(desc(ciCompetitorMetricsSnapshot.createdAt))
    .limit(1);

  const sourceMetrics = latestSourceMetrics[0] ?? null;

  const verifyPosts = await db
    .select({ count: sql<number>`count(*)` })
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.competitorId, targetCompetitorId),
        eq(ciCompetitorPosts.accountId, targetAccountId)
      )
    );
  const verifyComments = await db
    .select({ count: sql<number>`count(*)` })
    .from(ciCompetitorComments)
    .where(
      and(
        eq(ciCompetitorComments.competitorId, targetCompetitorId),
        eq(ciCompetitorComments.accountId, targetAccountId)
      )
    );

  const finalPostCount = Number(verifyPosts[0]?.count ?? 0);
  const finalCommentCount = Number(verifyComments[0]?.count ?? 0);

  await db.insert(ciCompetitorMetricsSnapshot).values({
    competitorId: targetCompetitorId,
    accountId: targetAccountId,
    postsCollected: finalPostCount,
    commentsCollected: finalCommentCount,
    ctaCoverage: sourceMetrics?.ctaCoverage ?? 0,
    ctaTypes: sourceMetrics?.ctaTypes ?? null,
    followers: sharedProfile.followers ?? null,
    engagementRate: sourceMetrics?.engagementRate ?? null,
    postingFrequency: sourceMetrics?.postingFrequency ?? null,
    contentMix: sourceMetrics?.contentMix ?? null,
    lastFetchAt: new Date(),
    fetchMethod: "SHARED_REUSE",
    fetchStatus: "COMPLETE",
    batchId,
  });

  await db
    .update(ciCompetitors)
    .set({
      postsCollected: finalPostCount,
      commentsCollected: finalCommentCount,
      sharedProfileId,
      engagementRatio: sourceMetrics?.engagementRate ?? null,
      postingFrequency: sourceMetrics?.postingFrequency
        ? Math.round(sourceMetrics.postingFrequency)
        : null,
      contentTypeRatio: sourceMetrics?.contentMix ?? null,
      ctaPatterns: sourceMetrics?.ctaTypes ?? null,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ciCompetitors.id, targetCompetitorId));

  const hoursAgo =
    sharedProfile.lastScrapedAt
      ? Math.round(
          (Date.now() - sharedProfile.lastScrapedAt.getTime()) / (60 * 60 * 1000) * 10
        ) / 10
      : 0;

  console.log(
    `[SharedPool] SHARED_REUSE: copied ${finalPostCount} posts + ${finalCommentCount} comments from ${sourceCompetitor.id} → ${targetCompetitorId} (scraped ${hoursAgo}h ago)`
  );

  return {
    postsCollected: finalPostCount,
    commentsCollected: finalCommentCount,
    followers: sharedProfile.followers ?? null,
    engagementRate: sourceMetrics?.engagementRate ?? null,
    postingFrequency: sourceMetrics?.postingFrequency ?? null,
    contentMix: sourceMetrics?.contentMix ?? null,
    ctaCoverage: sourceMetrics?.ctaCoverage ?? 0,
    ctaTypes: sourceMetrics?.ctaTypes ? sourceMetrics.ctaTypes.split(",") : [],
    hoursAgo,
  };
}
