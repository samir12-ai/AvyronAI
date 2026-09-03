/**
 * Canonical Campaign Evidence Bundle
 * 
 * Centralized read model that assembles typed, validated, and normalized evidence
 * across all channels for a given campaign and account from canonical database tables:
 * - competitor_sources (source identity authority)
 * - competitor_website_snapshots (web evidence)
 * - ci_competitor_posts (posts: Instagram, TikTok, LinkedIn, X, YouTube)
 * - ci_competitor_comments (customer voice comments: Instagram, TikTok, YouTube)
 * - ci_competitor_reviews (customer voice reviews: Google, Trustpilot)
 * - competitor_post_classifications (post semantic classifications)
 */

import { db } from "../db";
import { 
  competitorSources, 
  competitorWebsiteSnapshots, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  competitorPostClassifications,
  ciCompetitors
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export interface CampaignEvidenceBundle {
  accountId: string;
  campaignId: string;
  assembledAt: string;
  counts: {
    sources: number;
    websiteSnapshots: number;
    posts: number;
    comments: number;
    reviews: number;
    classifications: number;
  };
  sources: Array<typeof competitorSources.$inferSelect>;
  competitors: Array<typeof ciCompetitors.$inferSelect>;
  competitorWebEvidence: Array<typeof competitorWebsiteSnapshots.$inferSelect>;
  competitorPostEvidence: Array<typeof ciCompetitorPosts.$inferSelect>;
  competitorPostSemantics: Array<typeof competitorPostClassifications.$inferSelect>;
  customerVoiceComments: Array<{
    id: string;
    postId: string;
    competitorId: string;
    commentText: string;
    username: string | null;
    likesCount: number | null;
    authorType: string | null;
    platform: string;
    timestamp: Date | null;
  }>;
  customerVoiceReviews: Array<{
    id: string;
    competitorId: string;
    reviewText: string;
    rating: number | null;
    platform: string;
    reviewDate: Date | null;
    authorHash: string | null;
  }>;
  tiktokEvidence: {
    posts: Array<{ id: string; competitorId: string; caption: string | null; views: number | null; likes: number | null; comments: number | null }>;
    comments: Array<{ id: string; postId: string; competitorId: string; text: string; username: string | null; likes: number | null }>;
  };
  linkedinEvidence: Array<{ id: string; competitorId: string; caption: string | null; permalink: string | null }>;
  xEvidence: Array<{ id: string; competitorId: string; caption: string | null; permalink: string | null }>;
  youtubeEvidence: Array<{ id: string; competitorId: string; caption: string | null; permalink: string | null }>;
}

export async function buildCampaignEvidenceBundle(
  accountId: string, 
  campaignId: string
): Promise<CampaignEvidenceBundle> {
  // 1. Fetch current approved campaign competitor memberships from canonical competitor authority
  const compRows = await db
    .select()
    .from(ciCompetitors)
    .where(
      and(
        eq(ciCompetitors.accountId, accountId),
        eq(ciCompetitors.campaignId, campaignId),
        eq(ciCompetitors.isActive, true),
        eq(ciCompetitors.isDemo, false)
      )
    );

  const competitorIds = compRows.map(c => c.id);

  // 2. Fetch canonical competitor sources for those approved competitors
  const sourceRows = competitorIds.length > 0 ? await db
    .select()
    .from(competitorSources)
    .where(
      and(
        eq(competitorSources.accountId, accountId),
        eq(competitorSources.campaignId, campaignId),
        sql`${competitorSources.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`
      )
    ) : [];

  // 3. Fetch website snapshots strictly for approved competitors
  const webRows = competitorIds.length > 0 ? await db
    .select()
    .from(competitorWebsiteSnapshots)
    .where(
      sql`${competitorWebsiteSnapshots.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`
    )
    .orderBy(desc(competitorWebsiteSnapshots.createdAt))
    .limit(300) : [];

  // 4. Fetch posts strictly for approved competitors
  const postRows = competitorIds.length > 0 ? await db
    .select()
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.accountId, accountId),
        sql`${ciCompetitorPosts.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`
      )
    )
    .orderBy(desc(ciCompetitorPosts.createdAt))
    .limit(1000) : [];

  // 5. Fetch comments (customer voice) strictly for approved competitors
  const commentRows = competitorIds.length > 0 ? await db
    .select()
    .from(ciCompetitorComments)
    .where(
      and(
        eq(ciCompetitorComments.accountId, accountId),
        sql`${ciCompetitorComments.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`,
        sql`${ciCompetitorComments.authorType} IS DISTINCT FROM 'owner'`,
        sql`(${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL)`
      )
    )
    .orderBy(desc(ciCompetitorComments.createdAt))
    .limit(2000) : [];

  // 6. Fetch reviews (customer voice) strictly for approved competitors
  const reviewRows = competitorIds.length > 0 ? await db
    .select()
    .from(ciCompetitorReviews)
    .where(
      and(
        eq(ciCompetitorReviews.accountId, accountId),
        sql`${ciCompetitorReviews.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`,
        sql`(${ciCompetitorReviews.isSynthetic} = false OR ${ciCompetitorReviews.isSynthetic} IS NULL)`
      )
    )
    .orderBy(desc(ciCompetitorReviews.createdAt))
    .limit(500) : [];

  // 7. Fetch post classifications
  const postIds = postRows.map(p => p.id);
  const classRows = postIds.length > 0 ? await db
    .select()
    .from(competitorPostClassifications)
    .where(
      sql`${competitorPostClassifications.postId} IN (${sql.join(postIds.slice(0, 500).map(id => sql`${id}`), sql`, `)})`
    ) : [];

  const postPlatformMap = new Map(postRows.map(p => [p.id, p.platform || "instagram"]));

  // Filter typed subsets with real platform provenance
  const validComments = commentRows
    .filter(c => typeof c.commentText === "string" && c.commentText.trim().length > 0)
    .map(c => {
      let platform = postPlatformMap.get(c.postId) || "";
      if (!platform) {
        if (c.postId && (c.postId.includes("tt_") || c.postId.includes("tiktok"))) platform = "tiktok";
        else if (c.postId && (c.postId.includes("yt_") || c.postId.includes("youtube"))) platform = "youtube";
        else if (c.postId && (c.postId.includes("ig_") || c.postId.includes("instagram"))) platform = "instagram";
        else platform = "UNKNOWN";
      }
      return {
        id: c.id,
        postId: c.postId,
        competitorId: c.competitorId,
        commentText: c.commentText!,
        username: c.username,
        likesCount: c.likesCount,
        authorType: c.authorType,
        platform,
        timestamp: c.timestamp,
      };
    });

  const validReviews = reviewRows
    .filter(r => typeof r.reviewText === "string" && r.reviewText.trim().length > 0)
    .map(r => ({
      id: r.id,
      competitorId: r.competitorId,
      reviewText: r.reviewText,
      rating: r.rating,
      platform: r.platform || "reviews",
      reviewDate: r.reviewDate,
      authorHash: r.authorHash,
    }));

  const tiktokPosts = postRows.filter(p => p.platform?.toLowerCase() === "tiktok");
  const linkedinPosts = postRows.filter(p => p.platform?.toLowerCase() === "linkedin");
  const xPosts = postRows.filter(p => p.platform?.toLowerCase() === "x" || p.platform?.toLowerCase() === "twitter");
  const youtubePosts = postRows.filter(p => p.platform?.toLowerCase() === "youtube");

  return {
    accountId,
    campaignId,
    assembledAt: new Date().toISOString(),
    counts: {
      sources: sourceRows.length,
      websiteSnapshots: webRows.length,
      posts: postRows.length,
      comments: validComments.length,
      reviews: validReviews.length,
      classifications: classRows.length,
    },
    sources: sourceRows,
    competitors: compRows,
    competitorWebEvidence: webRows,
    competitorPostEvidence: postRows,
    competitorPostSemantics: classRows,
    customerVoiceComments: validComments,
    customerVoiceReviews: validReviews,
    tiktokEvidence: {
      posts: tiktokPosts.map(p => ({
        id: p.id,
        competitorId: p.competitorId,
        caption: p.caption,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
      })),
      comments: validComments
        .filter(c => c.postId.includes("tt_") || c.postId.includes("tiktok"))
        .map(c => ({
          id: c.id,
          postId: c.postId,
          competitorId: c.competitorId,
          text: c.commentText,
          username: c.username,
          likes: c.likesCount,
        })),
    },
    linkedinEvidence: linkedinPosts.map(p => ({
      id: p.id,
      competitorId: p.competitorId,
      caption: p.caption,
      permalink: p.permalink,
    })),
    xEvidence: xPosts.map(p => ({
      id: p.id,
      competitorId: p.competitorId,
      caption: p.caption,
      permalink: p.permalink,
    })),
    youtubeEvidence: youtubePosts.map(p => ({
      id: p.id,
      competitorId: p.competitorId,
      caption: p.caption,
      permalink: p.permalink,
    })),
  };
}
