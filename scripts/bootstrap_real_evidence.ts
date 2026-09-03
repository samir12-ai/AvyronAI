import "dotenv/config";
import { db } from "../server/db";
import { 
  ciCompetitors, 
  competitorSources, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews,
  competitorPostClassifications 
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { scrapeInstagramViaApify } from "../server/competitive-intelligence/instagram-apify-scraper";
import { scrapeInstagramCommentsViaActor, type CommentActorPostRef } from "../server/acquisition/instagram-comments";
import { scrapeTiktokViaApify } from "../server/competitive-intelligence/tiktok-apify-scraper";
import { fetchGoogleSearchEvidence } from "../server/acquisition/multi-source-providers";
import { classifyCompetitorPost } from "../server/competitor-post-classifier/classifier";
import { createHash } from "crypto";

const ACCOUNT_ID = "f020f6c7-15d8-4129-90a6-83a40558c642";
const CAMPAIGN_ID = "camp_mtewrp8kkom3";

const APPROVED_COMPETITORS = [
  { name: "Amar Beirut", domain: "amar-beirut.com", igHandle: "amar_beirutt", tiktokHandle: null },
  { name: "Abayas Boutique", domain: "abayasboutique.com", igHandle: "abayasboutique", tiktokHandle: "abayasboutique" },
  { name: "Abayaboutiquelb", domain: "instagram.com/_abayaboutiquelb", igHandle: "_abayaboutiquelb", tiktokHandle: null },
  { name: "Modern Hijabi", domain: "modernhijabi.com", igHandle: "modernhijabi", tiktokHandle: null },
  { name: "Modern Abayati", domain: "modern-abayati.com", igHandle: "modern_abayati", tiktokHandle: null },
  { name: "Niswa Fashion", domain: "niswafashion.com", igHandle: "niswafashion", tiktokHandle: null },
  { name: "Abayas Online", domain: "abayabuth.com", igHandle: "abayabuth", tiktokHandle: null },
  { name: "BNAH", domain: "nouralhouda.com.au", igHandle: "nouralhouda", tiktokHandle: null },
  { name: "Aab", domain: "aabcollection.com", igHandle: "aabcollection", tiktokHandle: null },
  { name: "Lameeramoda", domain: "lameeramoda.com", igHandle: "lameeramoda", tiktokHandle: null },
  { name: "Guava Lebanon", domain: "guavaonlineshop.com", igHandle: "guavalebanon", tiktokHandle: null },
  { name: "Online Shopping in Lebanon", domain: "shopwithabc.com", igHandle: "shopwithabc", tiktokHandle: null },
];

async function main() {
  console.log("============================================================");
  console.log("AVYRON — SARA-FT REAL MULTI-SOURCE EVIDENCE BOOTSTRAP");
  console.log(`Account: ${ACCOUNT_ID} | Campaign: ${CAMPAIGN_ID}`);
  console.log("============================================================\n");

  // Step 1: Query and map canonical competitor IDs
  const allComps = await db
    .select()
    .from(ciCompetitors)
    .where(eq(ciCompetitors.accountId, ACCOUNT_ID));

  console.log(`Found ${allComps.length} competitor records in DB.`);

  const canonicalCompMap: Array<{
    info: typeof APPROVED_COMPETITORS[0];
    dbRow: typeof allComps[0];
  }> = [];

  for (const approved of APPROVED_COMPETITORS) {
    const matched = allComps.find(c => 
      c.name.toLowerCase().includes(approved.name.toLowerCase()) ||
      (c.websiteUrl && c.websiteUrl.toLowerCase().includes(approved.domain.toLowerCase())) ||
      (c.profileLink && approved.igHandle && c.profileLink.toLowerCase().includes(approved.igHandle.toLowerCase()))
    );

    if (matched) {
      canonicalCompMap.push({ info: approved, dbRow: matched });
    }
  }

  console.log(`Mapped ${canonicalCompMap.length}/12 approved competitors to canonical DB entities.\n`);

  // Step 2: Populate competitor_sources table
  console.log("--- 1. PERSISTING CANONICAL SOURCE ROWS INTO competitor_sources ---");
  let sourcesPersisted = 0;

  for (const { info, dbRow } of canonicalCompMap) {
    let manifest: any = {};
    if (dbRow.notes) {
      try { manifest = JSON.parse(dbRow.notes); } catch {}
    }
    const sources = manifest.sources || {};

    const channels = [
      { key: "website", platform: "WEBSITE", url: dbRow.websiteUrl || sources.website?.url },
      { key: "instagram", platform: "INSTAGRAM", url: dbRow.profileLink || (info.igHandle ? `https://instagram.com/${info.igHandle}` : null) },
      { key: "tiktok", platform: "TIKTOK", url: dbRow.tiktokUrl || (info.tiktokHandle ? `https://tiktok.com/@${info.tiktokHandle}` : null) },
      { key: "reviews", platform: "REVIEWS", url: dbRow.googleMapsUrl || sources.reviews?.url },
      { key: "blog", platform: "BLOG", url: dbRow.blogUrl || sources.blog?.url },
      { key: "google_search", platform: "GOOGLE_SEARCH", url: sources.google_search?.url },
      { key: "linkedin", platform: "LINKEDIN", url: sources.linkedin?.url },
    ];

    for (const ch of channels) {
      if (!ch.url) continue;
      const srcStatus = (sources[ch.key]?.status === "VERIFIED" || ch.url) ? "ACTIVE" : "NOT_FOUND";
      const sourceId = `src_${createHash("sha256").update(`${dbRow.id}:${ch.platform}:${ch.url}`).digest("hex").slice(0, 16)}`;

      await db
        .insert(competitorSources)
        .values({
          id: sourceId,
          competitorId: dbRow.id,
          campaignId: CAMPAIGN_ID,
          accountId: ACCOUNT_ID,
          platform: ch.platform,
          canonicalUrl: ch.url,
          status: srcStatus,
          lastVerifiedAt: new Date(),
          activityState: "ACTIVE",
          metadata: {
            sourceKey: ch.key,
            verificationMethod: sources[ch.key]?.verificationMethod || "BOOTSTRAP",
          },
        })
        .onConflictDoUpdate({
          target: [competitorSources.id],
          set: {
            canonicalUrl: ch.url,
            status: srcStatus,
            lastVerifiedAt: new Date(),
          },
        });
      sourcesPersisted++;
    }
  }

  const [srcCountRes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(competitorSources)
    .where(eq(competitorSources.accountId, ACCOUNT_ID));
  console.log(`competitor_sources table populated: ${srcCountRes.count} total rows in DB.\n`);

  // Step 3: Run Apify for Instagram profiles and comments
  console.log("--- 2. RUNNING REAL APIFY ACQUISITION ---");
  const postsToScrapeComments: CommentActorPostRef[] = [];
  let totalIgPostsFetched = 0;
  let totalTiktokFetched = 0;

  for (const { info, dbRow } of canonicalCompMap) {
    // 3A. Instagram
    if (info.igHandle) {
      console.log(`\n[IG Fetch] Competitor: ${info.name} (@${info.igHandle})`);
      try {
        const igRes = await scrapeInstagramViaApify(info.igHandle, 12);
        console.log(`  IG Scraper result: ${igRes.posts.length} posts returned (followers: ${igRes.followers})`);
        
        for (const post of igRes.posts) {
          const postId = post.postId || `post_ig_${createHash("sha256").update(`${dbRow.id}:${post.permalink || post.timestamp}`).digest("hex").slice(0, 16)}`;
          
          await db
            .insert(ciCompetitorPosts)
            .values({
              id: postId,
              competitorId: dbRow.id,
              campaignId: CAMPAIGN_ID,
              accountId: ACCOUNT_ID,
              platform: "instagram",
              caption: post.caption || null,
              mediaType: post.mediaType || "IMAGE",
              likes: post.likes ?? null,
              comments: post.comments ?? null,
              views: post.views ?? null,
              permalink: post.permalink || null,
              timestamp: post.timestamp ? new Date(post.timestamp) : new Date(),
            })
            .onConflictDoUpdate({
              target: [ciCompetitorPosts.id],
              set: {
                caption: post.caption || null,
                mediaType: post.mediaType || "IMAGE",
                likes: post.likes ?? null,
                comments: post.comments ?? null,
                views: post.views ?? null,
                permalink: post.permalink || null,
              },
            });
          totalIgPostsFetched++;

          if (post.permalink && (post.comments === null || post.comments > 0)) {
            postsToScrapeComments.push({
              postId,
              shortcode: post.shortcode || post.permalink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1] || null,
              permalink: post.permalink,
            });
          }
        }
      } catch (err: any) {
        console.warn(`  IG Scrape error for @${info.igHandle}: ${err.message}`);
      }
    }

    // 3B. TikTok
    if (info.tiktokHandle) {
      console.log(`\n[TikTok Fetch] Competitor: ${info.name} (@${info.tiktokHandle})`);
      try {
        const ttPosts = await scrapeTiktokViaApify(info.tiktokHandle);
        console.log(`  TikTok Scraper result: ${ttPosts.length} posts returned`);
        for (const post of ttPosts) {
          const postId = post.postId || `post_tt_${createHash("sha256").update(`${dbRow.id}:${post.postId}`).digest("hex").slice(0, 16)}`;
          await db
            .insert(ciCompetitorPosts)
            .values({
              id: postId,
              competitorId: dbRow.id,
              campaignId: CAMPAIGN_ID,
              accountId: ACCOUNT_ID,
              platform: "tiktok",
              caption: post.caption || null,
              mediaType: "VIDEO",
              likes: post.likes ?? null,
              comments: post.comments ?? null,
              views: post.views ?? null,
              timestamp: post.timestamp ? new Date(post.timestamp) : new Date(),
            })
            .onConflictDoUpdate({
              target: [ciCompetitorPosts.id],
              set: {
                caption: post.caption || null,
                likes: post.likes ?? null,
                comments: post.comments ?? null,
                views: post.views ?? null,
              },
            });
          totalTiktokFetched++;

          // Insert embedded comments if present
          if (post.topComments && post.topComments.length > 0) {
            for (const c of post.topComments) {
              const commentId = `comm_tt_${createHash("sha256").update(`${postId}:${c.text}`).digest("hex").slice(0, 16)}`;
              await db
                .insert(ciCompetitorComments)
                .values({
                  id: commentId,
                  postId,
                  competitorId: dbRow.id,
                  campaignId: CAMPAIGN_ID,
                  accountId: ACCOUNT_ID,
                  text: c.text,
                  author: c.username || "tiktok_user",
                  likes: c.likes ?? null,
                  timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
                })
                .onConflictDoNothing();
            }
          }
        }
      } catch (err: any) {
        console.warn(`  TikTok Scrape error for @${info.tiktokHandle}: ${err.message}`);
      }
    }
  }

  // Step 4: Run Instagram Comments Actor
  console.log(`\n--- 3. FETCHING INSTAGRAM COMMENTS (Target: ${postsToScrapeComments.length} posts) ---`);
  let totalCommentsPersisted = 0;
  if (postsToScrapeComments.length > 0) {
    const batch = postsToScrapeComments.slice(0, 15);
    console.log(`Executing apify~instagram-comment-scraper on ${batch.length} posts...`);
    try {
      const commRes = await scrapeInstagramCommentsViaActor({
        posts: batch,
        maxCommentsPerPost: 10,
        budgetMs: 180_000,
      });

      console.log(`Comment scraper run ok: ${commRes.ok}, itemsReceived: ${commRes.meta.itemsReceived}, comments: ${commRes.comments.length}`);
      for (const c of commRes.comments) {
        const postRow = await db.query.ciCompetitorPosts.findFirst({
          where: eq(ciCompetitorPosts.id, c.postId),
        });

        await db
          .insert(ciCompetitorComments)
          .values({
            id: `comm_${c.commentId}`,
            postId: c.postId,
            competitorId: postRow?.competitorId || canonicalCompMap[0].dbRow.id,
            campaignId: CAMPAIGN_ID,
            accountId: ACCOUNT_ID,
            text: c.text,
            author: c.username || "instagram_user",
            likes: c.likesCount,
            timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
          })
          .onConflictDoNothing();
        totalCommentsPersisted++;
      }
    } catch (err: any) {
      console.warn(`Comment actor run failed: ${err.message}`);
    }
  }

  // Step 5: Run Google Search Evidence
  console.log(`\n--- 4. FETCHING GOOGLE SEARCH MARKET EVIDENCE ---`);
  try {
    const googleRes = await fetchGoogleSearchEvidence({
      query: "Sara-ft summer hijabi dresses Lebanon competitor reviews pricing",
      campaignId: CAMPAIGN_ID,
      accountId: ACCOUNT_ID,
      competitorId: canonicalCompMap[0]?.dbRow.id,
      maxResults: 8,
    });
    console.log(`Google Search evidence fetched: ${googleRes.items.length} items (raw: ${googleRes.report.rawCount})`);
  } catch (err: any) {
    console.warn(`Google Search fetch error: ${err.message}`);
  }

  // Step 6: Run Post Classification on unclassified posts
  console.log(`\n--- 5. RUNNING COMPETITOR POST CLASSIFICATION ---`);
  const postsToClassify = await db
    .select()
    .from(ciCompetitorPosts)
    .where(eq(ciCompetitorPosts.accountId, ACCOUNT_ID))
    .limit(30);

  console.log(`Classifying ${postsToClassify.length} competitor posts...`);
  let classifiedCount = 0;

  for (const p of postsToClassify) {
    if (!p.caption || p.caption.trim().length === 0) continue;
    try {
      const classification = await classifyCompetitorPost(
        {
          id: p.id,
          competitorId: p.competitorId,
          caption: p.caption,
          hookText: null,
          hashtags: null,
          mediaType: p.mediaType,
          likes: p.likes,
          comments: p.comments,
          views: p.views,
          permalink: p.permalink,
        },
        ACCOUNT_ID,
      );

      await db
        .insert(competitorPostClassifications)
        .values({
          postId: classification.postId,
          competitorId: classification.competitorId,
          primaryHook: classification.primaryHook,
          hookArchetype: classification.hookArchetype,
          primaryAngle: classification.primaryAngle,
          narrative: classification.narrative,
          ctaType: classification.ctaType,
          offerType: classification.offerType,
          emotionalTrigger: classification.emotionalTrigger,
          awarenessStage: classification.awarenessStage,
          positioningStyle: classification.positioningStyle,
          contentFormatIntent: classification.contentFormatIntent,
          primaryGoal: classification.primaryGoal,
          coreMarketingPromise: classification.coreMarketingPromise,
          confidenceScore: classification.confidenceScore,
          classifierVersion: classification.classifierVersion,
          classifiedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            competitorPostClassifications.postId,
            competitorPostClassifications.classifierVersion,
          ],
          set: {
            primaryHook: classification.primaryHook,
            hookArchetype: classification.hookArchetype,
            primaryAngle: classification.primaryAngle,
            narrative: classification.narrative,
            ctaType: classification.ctaType,
            offerType: classification.offerType,
            emotionalTrigger: classification.emotionalTrigger,
            awarenessStage: classification.awarenessStage,
            positioningStyle: classification.positioningStyle,
            contentFormatIntent: classification.contentFormatIntent,
            primaryGoal: classification.primaryGoal,
            coreMarketingPromise: classification.coreMarketingPromise,
            confidenceScore: classification.confidenceScore,
            classifiedAt: new Date(),
          },
        });
      classifiedCount++;
      process.stdout.write(".");
    } catch (err: any) {
      console.warn(`\nClassification error on post ${p.id}: ${err.message}`);
    }
  }

  console.log(`\nClassified ${classifiedCount} posts successfully.\n`);

  // Final Summary Query
  const [postsTotal] = await db.select({ c: sql<number>`count(*)` }).from(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, ACCOUNT_ID));
  const [commTotal] = await db.select({ c: sql<number>`count(*)` }).from(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, ACCOUNT_ID));
  const [revTotal] = await db.select({ c: sql<number>`count(*)` }).from(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, ACCOUNT_ID));
  const [classTotal] = await db.select({ c: sql<number>`count(*)` }).from(competitorPostClassifications);
  const [srcTotal] = await db.select({ c: sql<number>`count(*)` }).from(competitorSources).where(eq(competitorSources.accountId, ACCOUNT_ID));

  console.log("============================================================");
  console.log("BOOTSTRAP DATA TOTALS IN DATABASE");
  console.log(`  competitor_sources: ${srcTotal.c}`);
  console.log(`  ci_competitor_posts: ${postsTotal.c}`);
  console.log(`  ci_competitor_comments: ${commTotal.c}`);
  console.log(`  ci_competitor_reviews: ${revTotal.c}`);
  console.log(`  competitor_post_classifications: ${classTotal.c}`);
  console.log("============================================================");
}

main().catch(console.error);
