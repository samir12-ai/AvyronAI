/**
 * TikTok competitor acquisition — Apify-only (P-6.12, 2026-07-28).
 *
 * HISTORY: this module used to scrape TikTok profile HTML through the Bright
 * Data Unlocker (poolFetch + __UNIVERSAL_DATA_FOR_REHYDRATION__ parsing) with
 * Apify as fallback. P-6.12 removed the Bright Data transport entirely — the
 * Unlocker fetch, the HTML rehydration parsers, and the fallback choreography
 * no longer exist. Apify (tiktok-apify-scraper.ts) is the single transport.
 *
 * Preserved seals:
 *   Seal #5 / F7.3 — degraded (transport failed) is kept distinct from
 *   healthy-empty (run completed, 0 posts). A completed Apify run with zero
 *   posts is NOT degraded.
 *   P-6.12 Phase 7 — comments pass through the unified acquisition filter
 *   (server/acquisition/comment-filter) before persisting; rejects are never
 *   stored, every rejection is counted by reason.
 */
import { db } from "../db";
import { ciCompetitorPosts, ciCompetitorComments, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export interface TiktokComment {
  commentId: string;
  username: string;
  text: string;
  likes?: number;
  replyCount?: number;
  timestamp?: Date;
}

export interface TiktokPost {
  postId: string;
  caption: string;
  hookText?: string;
  hookSource?: "transcript" | "caption_proxy";
  transcript?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  hashtags?: string[];
  permalink?: string;
  timestamp?: Date;
  topComments?: TiktokComment[];
}

export interface TiktokScrapedResult {
  competitorId: string;
  postsFetched: number;
  postsInserted: number;
  commentsInserted: number;
  /** "brightdata" is a legacy literal — kept only so historical DB rows /
   *  consumers type-check; new runs emit "apify" | "manual" | "unavailable". */
  source: "brightdata" | "apify" | "manual" | "unavailable";
  error?: string;
  /** F7.3 — true when network/auth failed; distinguishes from genuinely-empty profile. */
  degraded?: boolean;
  /** F7.3 — machine-readable reason for downstream gates. Post-P-6.12 runs
   *  emit only NO_HANDLE | NO_SOURCE_CONFIGURED | APIFY_FAIL; the other
   *  literals are legacy (pre-migration snapshots may still carry them). */
  degradedReason?: "APIFY_FAIL" | "NO_SOURCE_CONFIGURED" | "NO_HANDLE";
}

/**
 * Seal #5 / F7.3 — discriminated-union return so the caller can tell
 * "the network failed" apart from "the profile is genuinely empty".
 * Legacy reason literals retained for consumers that match on them.
 */
export type TiktokFetchOutcome =
  | { ok: true; posts: TiktokPost[]; source: "brightdata" | "apify" }
  | { ok: false; reason: "PROXY_UNAVAILABLE" | "NETWORK_FAIL" | "AUTH" | "PARSE_FAIL" | "ALL_RETRIES_EXHAUSTED" | "BREAKER_OPEN" | "BOTH_SOURCES_DOWN"; details?: string };

export async function ingestTiktokPosts(
  competitorId: string,
  accountId: string,
  posts: TiktokPost[],
  dataSource: "brightdata" | "apify" | "manual" = "apify",
  ownerHandle?: string,
): Promise<{ inserted: number; commentsInserted: number }> {
  let inserted = 0;
  let commentsInserted = 0;

  // P-6.12 Phase 7 — unified comment filter with DB-seeded dedup.
  const { filterComments, formatFilterStats } = await import("../acquisition/comment-filter");
  const seenCommentIds = new Set<string>();
  const existingCRows = await db.select({ commentId: ciCompetitorComments.commentId })
    .from(ciCompetitorComments)
    .where(and(eq(ciCompetitorComments.competitorId, competitorId), eq(ciCompetitorComments.accountId, accountId)));
  for (const r of existingCRows) {
    if (r.commentId) seenCommentIds.add(r.commentId);
  }
  const filterCtx = { ownerHandles: ownerHandle ? [ownerHandle] : [], seenCommentIds };

  for (const post of posts) {
    const existing = await db.select({ id: ciCompetitorPosts.id })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} = ${competitorId} AND ${ciCompetitorPosts.postId} = ${post.postId}`)
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(ciCompetitorPosts).values({
      id: `tkt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      competitorId,
      accountId,
      postId: post.postId,
      caption: post.caption,
      hookText: post.hookText || null,
      hookSource: post.hookSource || null,
      transcript: post.transcript || null,
      likes: post.likes || null,
      comments: post.comments || null,
      views: post.views || null,
      hashtags: post.hashtags?.join(" ") || null,
      permalink: post.permalink || null,
      timestamp: post.timestamp || null,
      platform: "tiktok",
      hasCTA: false,
      hasOffer: false,
    });
    inserted++;

    if (post.topComments && post.topComments.length > 0) {
      const { accepted, stats } = filterComments(
        post.topComments.map(c => ({
          commentId: c.commentId,
          username: c.username || null,
          text: c.text,
          likes: c.likes,
          replyCount: c.replyCount,
          timestamp: c.timestamp,
        })),
        filterCtx,
      );
      if (stats.rejected > 0 || stats.accepted > 0) {
        console.log(`[TiktokScraper] COMMENT_FILTER post=${post.postId}: ${formatFilterStats(stats)}`);
      }

      for (const { comment, decision } of accepted) {
        await db.insert(ciCompetitorComments).values({
          id: `ttc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          competitorId,
          accountId,
          postId: post.postId,
          commentId: comment.commentId,
          username: comment.username,
          commentText: comment.text,
          sentiment: null,
          timestamp: comment.timestamp || null,
          isSynthetic: false,
          source: dataSource === "apify" ? "tiktok_apify" : "tiktok_scraped",
          authorType: decision.authorType,
          likesCount: comment.likes ?? null,
          repliesCount: comment.replyCount ?? null,
          filterStatus: decision.status,
          filterReason: decision.reason,
        }).onConflictDoNothing();
        commentsInserted++;
      }
    }
  }

  return { inserted, commentsInserted };
}

export async function scrapeTiktokForCompetitor(
  competitorId: string,
  accountId: string,
  campaignId?: string,
): Promise<TiktokScrapedResult> {
  const result: TiktokScrapedResult = {
    competitorId,
    postsFetched: 0,
    postsInserted: 0,
    commentsInserted: 0,
    source: "unavailable",
    // F7.3 — degraded flag on snapshot. True when the run COMPLETED but with
    // network/auth failure (no posts to ingest because we couldn't reach the
    // platform). False when the run completed successfully — even if 0 posts
    // were returned (genuinely empty/private profile).
    degraded: false,
  };

  const whereConditions = [eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)];
  if (campaignId) {
    whereConditions.push(eq(ciCompetitors.campaignId, campaignId));
  }

  const [competitor] = await db.select({ name: ciCompetitors.name, profileLink: ciCompetitors.profileLink, tiktokUrl: ciCompetitors.tiktokUrl })
    .from(ciCompetitors)
    .where(and(...whereConditions));

  if (!competitor) {
    result.error = `Competitor not found: ${competitorId}`;
    return result;
  }

  const handle = extractHandleFromProfileUrl(competitor.tiktokUrl || "") || extractHandleFromProfileUrl(competitor.profileLink || "") || competitor.name || "";
  if (!handle) {
    result.error = "Could not determine TikTok handle for competitor";
    result.degraded = true;
    result.degradedReason = "NO_HANDLE";
    return result;
  }

  // P-6.12: Apify is the ONLY TikTok transport. No Bright Data, no fallback.
  const { isApifyConfigured, scrapeTiktokViaApify } = await import("./tiktok-apify-scraper");

  if (!isApifyConfigured()) {
    result.source = "unavailable";
    // F7.3 — DEGRADED, not "empty profile". A coverage gate must not treat
    // this as a successful 0-post fetch and write empty signals.
    result.degraded = true;
    result.degradedReason = "NO_SOURCE_CONFIGURED";
    result.error = "No TikTok scraping source configured — APIFY_API_KEY not set";
    console.log(`[TiktokScraper] DEGRADED reason=${result.degradedReason} | ${result.error}`);
    return result;
  }

  try {
    const posts = await scrapeTiktokViaApify(handle);
    result.postsFetched = posts.length;
    result.source = "apify";

    if (posts.length === 0) {
      // F7.3 — Apify completed cleanly with 0 posts. NOT degraded — this is a
      // genuine empty/private profile result. We successfully reached the platform.
      result.error = "Apify returned no TikTok posts — profile may be private, empty, or not found";
      result.degraded = false;
      return result;
    }

    const { inserted, commentsInserted } = await ingestTiktokPosts(competitorId, accountId, posts, "apify", handle);
    result.postsInserted = inserted;
    result.commentsInserted = commentsInserted;

    console.log(`[TiktokScraper] competitorId=${competitorId} | campaignId=${campaignId || "unscoped"} | fetched=${result.postsFetched} | inserted=${result.postsInserted} | comments=${result.commentsInserted} | source=apify`);
    return result;
  } catch (err: any) {
    // F7.3 — Apify network/auth error → DEGRADED so coverage gates don't
    // promote 0 posts to "empty profile signal". Sanitize provider-side
    // status tokens so downstream block-detectors (substring "403"/"429")
    // never misread an Apify API error as a TikTok platform block.
    const safeMsg = (err.message || "unknown").replace(/\b(403|429)\b/g, "4xx").replace(/rate.?limit(ed)?/gi, "throttled");
    result.degraded = true;
    result.degradedReason = "APIFY_FAIL";
    result.error = `Apify scrape failed: ${safeMsg}`;
    console.error(`[TiktokScraper] DEGRADED reason=${result.degradedReason} competitorId=${competitorId} | campaignId=${campaignId || "unscoped"}: ${safeMsg}`);
    return result;
  }
}

function extractHandleFromProfileUrl(url: string): string {
  const match = url.match(/tiktok\.com\/@([^/?&]+)/);
  return match ? match[1] : "";
}
