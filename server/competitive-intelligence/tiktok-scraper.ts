import { db } from "../db";
import { ciCompetitorPosts, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getProxyConfig } from "./proxy-pool-manager";

const TIKTOK_SCRAPE_TIMEOUT_MS = 45000;
const MAX_RETRIES = 2;

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
  source: "proxy" | "manual" | "unavailable";
  error?: string;
}

const MOBILE_USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
];

const DESKTOP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function pickUA(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

async function fetchViaProxy(url: string, headers: Record<string, string>): Promise<{ html: string; status: number }> {
  const proxy = getProxyConfig();
  if (!proxy) throw new Error("Bright Data proxy not configured");

  const { ProxyAgent } = await import("undici");
  const country = process.env.BRIGHT_DATA_PROXY_COUNTRY || "us";
  const isWebUnlocker = proxy.port === "33335";
  const proxyUsername = isWebUnlocker
    ? proxy.username
    : `${proxy.username}-country-${country}`;
  const proxyUrl = `http://${proxyUsername}:${proxy.password}@${proxy.host}:${proxy.port}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIKTOK_SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
      dispatcher: new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } }),
    } as any);
    const html = await res.text();
    return { html, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

function extractRehydrationData(html: string): any | null {
  const rehydrationMatch = html.match(/<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (rehydrationMatch) {
    try {
      return JSON.parse(rehydrationMatch[1]);
    } catch {}
  }

  const sigaMatch = html.match(/<script\s+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigaMatch) {
    try {
      return JSON.parse(sigaMatch[1]);
    } catch {}
  }

  const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      return JSON.parse(nextDataMatch[1]);
    } catch {}
  }

  return null;
}

function extractPostsFromRehydration(data: any, handle: string): TiktokPost[] {
  const posts: TiktokPost[] = [];

  const defaultScope = data?.["__DEFAULT_SCOPE__"];
  if (defaultScope) {
    const userDetail = defaultScope["webapp.user-detail"];
    const userModule = defaultScope["webapp.user-video"];
    const itemModule = defaultScope["webapp.video-detail"];

    const videoList = userModule?.videoList || [];
    for (const video of videoList) {
      const post = parseVideoItem(video, handle);
      if (post) posts.push(post);
    }

    if (posts.length === 0 && itemModule?.itemInfo?.itemStruct) {
      const post = parseVideoItem(itemModule.itemInfo.itemStruct, handle);
      if (post) posts.push(post);
    }
  }

  if (posts.length === 0 && data?.ItemModule) {
    for (const key of Object.keys(data.ItemModule)) {
      const item = data.ItemModule[key];
      const post = parseVideoItem(item, handle);
      if (post) posts.push(post);
    }
  }

  if (posts.length === 0) {
    const items = findVideoItems(data);
    for (const item of items) {
      const post = parseVideoItem(item, handle);
      if (post) posts.push(post);
    }
  }

  return posts;
}

function findVideoItems(obj: any, depth = 0): any[] {
  if (!obj || depth > 8 || typeof obj !== "object") return [];
  const results: any[] = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object" && (item.desc !== undefined || item.description !== undefined) && (item.id || item.video)) {
        results.push(item);
      } else {
        results.push(...findVideoItems(item, depth + 1));
      }
    }
    return results;
  }

  if (obj.desc !== undefined && (obj.id || obj.video) && obj.stats) {
    return [obj];
  }

  for (const key of Object.keys(obj)) {
    if (["ItemModule", "videoList", "itemList", "items", "videos"].includes(key)) {
      results.push(...findVideoItems(obj[key], depth + 1));
    }
  }

  if (results.length === 0) {
    for (const key of Object.keys(obj)) {
      results.push(...findVideoItems(obj[key], depth + 1));
    }
  }

  return results;
}

function parseVideoItem(item: any, handle: string): TiktokPost | null {
  if (!item || typeof item !== "object") return null;

  const caption = (item.desc || item.description || item.text || "").trim();
  if (!caption) return null;

  const postId = item.id || item.video?.id || String(item.createTime || Date.now());
  const firstLine = caption.split(/\n/)[0].slice(0, 150);

  const stats = item.stats || item.statsV2 || {};
  const likes = toNum(stats.diggCount ?? stats.likeCount ?? item.diggCount);
  const comments = toNum(stats.commentCount ?? item.commentCount);
  const shares = toNum(stats.shareCount ?? item.shareCount);
  const views = toNum(stats.playCount ?? item.playCount);

  const hashtagObjs = item.textExtra || item.challenges || [];
  const hashtags = hashtagObjs
    .map((h: any) => h.hashtagName || h.title || "")
    .filter((h: string) => h.length > 0);

  const permalink = item.webVideoUrl ||
    (item.id ? `https://www.tiktok.com/@${handle}/video/${item.id}` : undefined);

  const createTime = item.createTime;
  const timestamp = createTime
    ? new Date(typeof createTime === "number" && createTime < 1e12 ? createTime * 1000 : createTime)
    : undefined;

  return {
    postId,
    caption,
    hookText: firstLine !== caption ? firstLine : undefined,
    likes,
    comments,
    shares,
    views,
    hashtags: hashtags.length > 0 ? hashtags : undefined,
    permalink,
    timestamp,
  };
}

function toNum(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

async function scrapeTiktokViaProxy(handle: string): Promise<TiktokPost[]> {
  const proxy = getProxyConfig();
  if (!proxy) {
    console.warn("[TiktokScraper] No Bright Data proxy configured — cannot scrape TikTok");
    return [];
  }

  const profileUrl = `https://www.tiktok.com/@${handle}`;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ua = attempt === 0 ? pickUA(DESKTOP_USER_AGENTS) : pickUA(MOBILE_USER_AGENTS);
      const headers: Record<string, string> = {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      };

      console.log(`[TiktokScraper] Attempt ${attempt + 1}/${MAX_RETRIES + 1} for @${handle} via proxy`);
      const { html, status } = await fetchViaProxy(profileUrl, headers);

      if (status === 403 || status === 429) {
        lastError = `HTTP ${status} — blocked or rate limited`;
        console.warn(`[TiktokScraper] ${lastError} for @${handle}, attempt ${attempt + 1}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
        }
        continue;
      }

      if (status !== 200) {
        lastError = `HTTP ${status}`;
        console.warn(`[TiktokScraper] Unexpected status ${status} for @${handle}`);
        continue;
      }

      if (html.length < 500) {
        lastError = "Response too small — likely a challenge page";
        console.warn(`[TiktokScraper] ${lastError} for @${handle}`);
        continue;
      }

      const data = extractRehydrationData(html);
      if (!data) {
        lastError = "No rehydration data found in HTML";
        console.warn(`[TiktokScraper] ${lastError} for @${handle} (html length: ${html.length})`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
        continue;
      }

      const posts = extractPostsFromRehydration(data, handle);
      console.log(`[TiktokScraper] Extracted ${posts.length} posts for @${handle} from rehydration data`);
      return posts;
    } catch (err: any) {
      const safeMsg = (err.message || "").replace(/\/\/[^@]+@/g, "//***@");
      lastError = safeMsg;
      console.error(`[TiktokScraper] Proxy fetch error for @${handle}: ${safeMsg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }
  }

  console.error(`[TiktokScraper] All ${MAX_RETRIES + 1} attempts failed for @${handle}: ${lastError}`);
  return [];
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

  const proxy = getProxyConfig();
  if (!proxy) {
    result.source = "unavailable";
    result.error = "Bright Data proxy not configured — TikTok scraping unavailable. Set BRIGHT_DATA_PROXY_HOST/PORT/USERNAME/PASSWORD or use POST /api/ci/tiktok/:competitorId/ingest to provide data manually.";
    console.log(`[TiktokScraper] ${result.error}`);
    return result;
  }

  const handle = extractHandleFromProfileUrl(competitor.profileLink || "") || competitor.name || "";
  if (!handle) {
    result.error = "Could not determine TikTok handle for competitor";
    return result;
  }

  try {
    const posts = await scrapeTiktokViaProxy(handle);
    result.postsFetched = posts.length;
    result.source = "proxy";

    if (posts.length === 0) {
      result.error = "No TikTok posts extracted — profile may be private, empty, or blocked";
      return result;
    }

    const { inserted } = await ingestTiktokPosts(competitorId, accountId, posts);
    result.postsInserted = inserted;

    console.log(`[TiktokScraper] competitorId=${competitorId} | fetched=${result.postsFetched} | inserted=${result.postsInserted} | source=proxy`);
    return result;
  } catch (err: any) {
    const safeMsg = (err.message || "").replace(/\/\/[^@]+@/g, "//***@");
    result.error = safeMsg;
    console.error(`[TiktokScraper] ERROR competitorId=${competitorId}: ${safeMsg}`);
    return result;
  }
}

function extractHandleFromProfileUrl(url: string): string {
  const match = url.match(/tiktok\.com\/@([^/?&]+)/);
  return match ? match[1] : "";
}
