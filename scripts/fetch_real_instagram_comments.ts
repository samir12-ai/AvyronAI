import "dotenv/config";
import { db } from "../server/db";
import { ciCompetitorPosts, ciCompetitorComments } from "@shared/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { scrapeInstagramCommentsViaActor, type CommentActorPostRef } from "../server/acquisition/instagram-comments";
import { createHash } from "crypto";

const ACCOUNT_ID = "f020f6c7-15d8-4129-90a6-83a40558c642";
const CAMPAIGN_ID = "camp_mtewrp8kkom3";

async function main() {
  console.log("=== FETCHING REAL INSTAGRAM COMMENTS VIA APIFY ACTOR ===");

  // Find all posts with permalinks from ci_competitor_posts
  const posts = await db
    .select({
      id: ciCompetitorPosts.id,
      competitorId: ciCompetitorPosts.competitorId,
      permalink: ciCompetitorPosts.permalink,
      comments: ciCompetitorPosts.comments,
      likes: ciCompetitorPosts.likes,
    })
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.accountId, ACCOUNT_ID),
        isNotNull(ciCompetitorPosts.permalink)
      )
    );

  console.log(`Found ${posts.length} posts with permalinks in DB.`);

  // Filter posts that have valid instagram URLs
  const candidatePosts: CommentActorPostRef[] = [];
  const postCompMap = new Map<string, string>();

  for (const p of posts) {
    if (!p.permalink) continue;
    const match = p.permalink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (match && match[1]) {
      const shortcode = match[1];
      if (!candidatePosts.some(cp => cp.shortcode === shortcode)) {
        candidatePosts.push({
          postId: p.id,
          shortcode,
          permalink: `https://www.instagram.com/p/${shortcode}/`,
        });
        postCompMap.set(p.id, p.competitorId);
      }
    }
  }

  console.log(`Extracted ${candidatePosts.length} unique shortcode candidate posts.`);

  // Take top 20 candidate posts across competitors
  const batch = candidatePosts.slice(0, 20);
  console.log(`\nDispatching Apify comment actor on ${batch.length} candidate posts:`);
  batch.forEach((b, i) => console.log(`  [${i + 1}] Post ${b.postId} -> ${b.permalink}`));

  const result = await scrapeInstagramCommentsViaActor({
    posts: batch,
    maxCommentsPerPost: 15,
    budgetMs: 240_000,
  });

  console.log(`\n=== APIFY COMMENT ACTOR RESULT ===`);
  console.log(`  Success: ${result.ok}`);
  console.log(`  Items received: ${result.meta.itemsReceived}`);
  console.log(`  Comments mapped: ${result.meta.commentsMapped}`);
  console.log(`  Cost USD: $${result.meta.estimatedCostUsd}`);
  console.log(`  Duration: ${Math.round(result.meta.durationMs / 1000)}s`);
  if (result.error) console.log(`  Error: ${result.error}`);

  // Persist all returned comments into ci_competitor_comments
  let inserted = 0;
  for (const c of result.comments) {
    const compId = postCompMap.get(c.postId) || "unknown_competitor";
    const commentId = `comm_${createHash("sha256").update(`${c.postId}:${c.commentId || c.text}`).digest("hex").slice(0, 16)}`;

    await db
      .insert(ciCompetitorComments)
      .values({
        id: commentId,
        postId: c.postId,
        competitorId: compId,
        campaignId: CAMPAIGN_ID,
        accountId: ACCOUNT_ID,
        text: c.text,
        author: c.username || "instagram_user",
        likes: c.likesCount ?? null,
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
      })
      .onConflictDoNothing();
    inserted++;
  }

  console.log(`\nPersisted ${inserted} real Instagram comments into ci_competitor_comments!`);

  // Count total in DB
  const [commCount] = await db
    .select({ c: sql<number>`count(*)` })
    .from(ciCompetitorComments)
    .where(eq(ciCompetitorComments.accountId, ACCOUNT_ID));
  console.log(`Total ci_competitor_comments in DB now: ${commCount.c}`);
}

main().catch(console.error);
