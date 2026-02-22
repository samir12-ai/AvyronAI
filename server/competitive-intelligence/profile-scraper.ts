// @ts-ignore - playwright types may not be available but runtime works
import { chromium } from "playwright";
type Browser = any;
type Page = any;

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

export interface ScrapedPost {
  postId: string;
  permalink: string;
  mediaType: "REEL" | "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  timestamp: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface ScrapeResult {
  success: boolean;
  posts: ScrapedPost[];
  followers: number | null;
  profileName: string | null;
  collectionMethodUsed: "HTML_PARSE" | "HEADLESS_RENDER" | "NONE";
  attempts: string[];
  warnings: string[];
}

const profileCache = new Map<string, { data: ScrapeResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000;

function normalizeInstagramUrl(url: string): string {
  let handle = url.trim();
  handle = handle.replace(/\/$/, "");
  const match = handle.match(/instagram\.com\/([^\/\?]+)/);
  if (match) handle = match[1];
  handle = handle.replace(/^@/, "");
  return `https://www.instagram.com/${handle}/`;
}

function extractHandleFromUrl(url: string): string {
  const match = url.match(/instagram\.com\/([^\/\?]+)/);
  return match ? match[1] : url.replace(/^@/, "").split("/")[0];
}

function classifyMediaType(node: any): ScrapedPost["mediaType"] {
  if (!node) return "UNKNOWN";
  const typename = node.__typename || node.media_type || "";
  if (typename.includes("Video") || typename.includes("Reel") || typename === "VIDEO") return "REEL";
  if (typename.includes("Sidecar") || typename === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (typename.includes("Image") || typename === "IMAGE") return "IMAGE";
  if (node.is_video === true) return "REEL";
  if (node.edge_sidecar_to_children) return "CAROUSEL";
  return "IMAGE";
}

function parsePostFromGraphQL(node: any, handle: string): ScrapedPost {
  const shortcode = node.shortcode || node.code || "";
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text
    || node.caption?.text
    || node.accessibility_caption
    || null;
  const timestamp = node.taken_at_timestamp || node.taken_at || null;

  return {
    postId: node.id || shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/${handle}/`,
    mediaType: classifyMediaType(node),
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    caption: caption ? String(caption).substring(0, 2000) : null,
    likes: node.edge_media_preview_like?.count ?? node.like_count ?? null,
    comments: node.edge_media_to_comment?.count ?? node.comment_count ?? null,
    views: node.video_view_count ?? node.play_count ?? null,
  };
}

async function attemptHtmlParse(profileUrl: string, handle: string): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null }> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };

  const response = await fetch(profileUrl, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();

  const posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;

  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/s);
  if (sharedDataMatch) {
    try {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const user = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) {
        profileName = user.full_name || user.username || null;
        followers = user.edge_followed_by?.count ?? null;
        const edges = user.edge_owner_to_timeline_media?.edges || [];
        for (const edge of edges.slice(0, 30)) {
          posts.push(parsePostFromGraphQL(edge.node, handle));
        }
      }
    } catch {}
  }

  if (posts.length === 0) {
    const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s);
    if (additionalDataMatch) {
      try {
        const data = JSON.parse(additionalDataMatch[1]);
        const user = data?.graphql?.user || data?.user;
        if (user) {
          profileName = profileName || user.full_name || user.username || null;
          followers = followers ?? user.edge_followed_by?.count ?? null;
          const edges = user.edge_owner_to_timeline_media?.edges || [];
          for (const edge of edges.slice(0, 30)) {
            posts.push(parsePostFromGraphQL(edge.node, handle));
          }
        }
      } catch {}
    }
  }

  if (posts.length === 0) {
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs);
    for (const m of jsonLdMatches) {
      try {
        const ld = JSON.parse(m[1]);
        if (ld?.mainEntity?.interactionStatistic) {
          for (const stat of ld.mainEntity.interactionStatistic) {
            if (stat.interactionType?.includes("Follow")) {
              followers = stat.userInteractionCount ?? followers;
            }
          }
        }
        profileName = profileName || ld?.mainEntity?.name || ld?.name || null;
      } catch {}
    }
  }

  if (posts.length === 0) {
    const metaDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    if (metaDesc) {
      const followerMatch = metaDesc[1].match(/([\d,.]+[KkMm]?)\s*Followers/i);
      if (followerMatch && !followers) {
        const raw = followerMatch[1].replace(/,/g, "");
        if (raw.match(/[Kk]$/)) followers = Math.round(parseFloat(raw) * 1000);
        else if (raw.match(/[Mm]$/)) followers = Math.round(parseFloat(raw) * 1000000);
        else followers = parseInt(raw);
      }
      profileName = profileName || handle;
    }
  }

  return { posts, followers, profileName };
}

async function attemptHeadlessRender(profileUrl: string, handle: string): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null }> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page: Page = await context.newPage();
    await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const posts: any[] = [];
      let followers: number | null = null;
      let profileName: string | null = null;

      const nameEl = document.querySelector("header h2, header span[dir]");
      if (nameEl) profileName = nameEl.textContent?.trim() || null;

      const statEls = document.querySelectorAll("header ul li span, header section ul li span");
      for (const el of statEls) {
        const title = el.getAttribute("title");
        const text = el.textContent || "";
        if (title && /\d/.test(title)) {
          const parent = el.closest("li");
          const parentText = parent?.textContent || "";
          if (parentText.toLowerCase().includes("follower")) {
            followers = parseInt(title.replace(/,/g, ""));
          }
        }
      }

      const postLinks = document.querySelectorAll("article a[href*='/p/'], article a[href*='/reel/'], main a[href*='/p/'], main a[href*='/reel/']");
      const seen = new Set<string>();
      for (const link of postLinks) {
        const href = (link as HTMLAnchorElement).href;
        if (seen.has(href)) continue;
        seen.add(href);
        const isReel = href.includes("/reel/");
        const shortcode = href.match(/\/(p|reel)\/([^\/]+)/)?.[2] || "";
        const img = link.querySelector("img");
        const video = link.querySelector("video");

        posts.push({
          shortcode,
          permalink: href,
          mediaType: isReel || video ? "REEL" : "IMAGE",
          caption: img?.getAttribute("alt") || null,
          timestamp: null,
          likes: null,
          comments: null,
          views: null,
        });

        if (posts.length >= 30) break;
      }

      return { posts, followers, profileName };
    });

    await context.close();

    const scrapedPosts: ScrapedPost[] = data.posts.map((p: any) => ({
      postId: p.shortcode,
      permalink: p.permalink.startsWith("http") ? p.permalink : `https://www.instagram.com${p.permalink}`,
      mediaType: p.mediaType as ScrapedPost["mediaType"],
      timestamp: p.timestamp,
      caption: p.caption ? String(p.caption).substring(0, 2000) : null,
      likes: p.likes,
      comments: p.comments,
      views: p.views,
    }));

    return {
      posts: scrapedPosts,
      followers: data.followers,
      profileName: data.profileName || handle,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function scrapeInstagramProfile(rawUrl: string): Promise<ScrapeResult> {
  const profileUrl = normalizeInstagramUrl(rawUrl);
  const handle = extractHandleFromUrl(rawUrl);

  const cached = profileCache.get(handle);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { ...cached.data, attempts: [...cached.data.attempts, "CACHE_HIT"] };
  }

  const lastRequest = rateLimitMap.get(handle);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const cachedAny = profileCache.get(handle);
    if (cachedAny) return { ...cachedAny.data, attempts: ["RATE_LIMITED", "CACHE_HIT"] };
  }
  rateLimitMap.set(handle, Date.now());

  const attempts: string[] = [];
  const warnings: string[] = [];
  let posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;
  let collectionMethodUsed: ScrapeResult["collectionMethodUsed"] = "NONE";

  attempts.push("HTML_PARSE");
  try {
    const result = await attemptHtmlParse(profileUrl, handle);
    posts = result.posts;
    followers = result.followers;
    profileName = result.profileName;
    if (posts.length > 0) {
      collectionMethodUsed = "HTML_PARSE";
    }
  } catch (err: any) {
    warnings.push(`HTML_PARSE failed: ${err.message}`);
  }

  if (posts.length < 5) {
    attempts.push("HEADLESS_RENDER");
    try {
      const result = await attemptHeadlessRender(profileUrl, handle);
      if (result.posts.length > posts.length) {
        posts = result.posts;
        collectionMethodUsed = "HEADLESS_RENDER";
      }
      if (!followers && result.followers) followers = result.followers;
      if (!profileName && result.profileName) profileName = result.profileName;
    } catch (err: any) {
      warnings.push(`HEADLESS_RENDER failed: ${err.message}`);
    }
  }

  if (posts.length === 0) {
    warnings.push("SCRAPE_BLOCKED");
    collectionMethodUsed = "NONE";
  }

  const result: ScrapeResult = {
    success: posts.length > 0,
    posts: posts.slice(0, 30),
    followers,
    profileName: profileName || handle,
    collectionMethodUsed,
    attempts,
    warnings,
  };

  profileCache.set(handle, { data: result, timestamp: Date.now() });
  return result;
}
