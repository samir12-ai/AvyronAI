import { db } from "../db";
import { ciCompetitorPosts, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import * as https from "https";

const APIFY_API_KEY = process.env.APIFY_API_KEY || "";
const APIFY_TIKTOK_ACTOR = "clockworks/free-tiktok-scraper";

export interface TiktokPost {
  postId: string;
  caption: string;
  hookText?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  hashtags?: string[];
  permalink?: string;
  timestamp?: Date;
}

export interface TiktokScrapedResult {
  competitorId: string;
  postsFetched: number;
  postsInserted: number;
  source: "apify" | "manual" | "unavailable";
  error?: string;
}

function httpsPost(hostname: string, path: string, body: object, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Failed to parse response: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function scrapeTiktokViaApify(handle: string): Promise<TiktokPost[]> {
  if (!APIFY_API_KEY) return [];

  try {
    const runResult = await httpsPost(
      "api.apify.com",
      `/v2/acts/${APIFY_TIKTOK_ACTOR}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=60`,
      { profiles: [handle], resultsPerPage: 30, shouldDownloadVideos: false },
      APIFY_API_KEY,
    );

    if (!Array.isArray(runResult)) return [];

    return runResult.map((item: any) => {
      const caption = (item.text || item.description || "").trim();
      const firstLine = caption.split(/\n/)[0].slice(0, 150);
      return {
        postId: item.id || item.webVideoUrl || String(item.createTime || Date.now()),
        caption,
        hookText: firstLine !== caption ? firstLine : undefined,
        likes: item.diggCount || item.stats?.diggCount,
        comments: item.commentCount || item.stats?.commentCount,
        shares: item.shareCount || item.stats?.shareCount,
        views: item.playCount || item.stats?.playCount,
        hashtags: item.mentions || [],
        permalink: item.webVideoUrl,
        timestamp: item.createTime ? new Date(item.createTime * 1000) : undefined,
      };
    }).filter((p) => p.caption.length > 0);
  } catch (err: any) {
    console.error(`[TiktokScraper] Apify error: ${err.message}`);
    return [];
  }
}

export async function ingestTiktokPosts(
  competitorId: string,
  accountId: string,
  posts: TiktokPost[],
): Promise<{ inserted: number }> {
  let inserted = 0;
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
  }
  return { inserted };
}

export async function scrapeTiktokForCompetitor(
  competitorId: string,
  accountId: string,
): Promise<TiktokScrapedResult> {
  const result: TiktokScrapedResult = {
    competitorId,
    postsFetched: 0,
    postsInserted: 0,
    source: "unavailable",
  };

  const [competitor] = await db.select({ name: ciCompetitors.name, profileLink: ciCompetitors.profileLink })
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

  if (!competitor) {
    result.error = `Competitor not found: ${competitorId}`;
    return result;
  }

  if (!APIFY_API_KEY) {
    result.source = "unavailable";
    result.error = "APIFY_API_KEY not configured — TikTok automated scraping unavailable. Use POST /api/ci/tiktok/:competitorId/ingest to provide TikTok post data manually.";
    console.log(`[TiktokScraper] ${result.error}`);
    return result;
  }

  const handle = extractHandleFromProfileUrl(competitor.profileLink || "") || competitor.name || "";
  if (!handle) {
    result.error = "Could not determine TikTok handle for competitor";
    return result;
  }

  try {
    const posts = await scrapeTiktokViaApify(handle);
    result.postsFetched = posts.length;
    result.source = "apify";

    if (posts.length === 0) {
      result.error = "No TikTok posts found via Apify";
      return result;
    }

    const { inserted } = await ingestTiktokPosts(competitorId, accountId, posts);
    result.postsInserted = inserted;

    console.log(`[TiktokScraper] competitorId=${competitorId} | fetched=${result.postsFetched} | inserted=${result.postsInserted} | source=apify`);
    return result;
  } catch (err: any) {
    result.error = err.message;
    console.error(`[TiktokScraper] ERROR competitorId=${competitorId}: ${err.message}`);
    return result;
  }
}

function extractHandleFromProfileUrl(url: string): string {
  const match = url.match(/tiktok\.com\/@([^/?&]+)/);
  return match ? match[1] : "";
}
