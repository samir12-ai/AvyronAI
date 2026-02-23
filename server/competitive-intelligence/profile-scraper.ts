import { ProxyAgent } from "undici";

type Browser = any;
type Page = any;

let playwrightChromium: any = null;
async function getChromium(): Promise<any> {
  if (playwrightChromium) return playwrightChromium;
  try {
    const pw = await import("playwright-chromium");
    playwrightChromium = pw.chromium;
    return playwrightChromium;
  } catch {
    try {
      const pw: any = await import("playwright");
      playwrightChromium = pw.chromium;
      return playwrightChromium;
    } catch {
      return null;
    }
  }
}

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

function getProxyConfig(): { url: string; host: string; port: string; username: string; password: string } | null {
  const host = process.env.BRIGHT_DATA_PROXY_HOST;
  const port = process.env.BRIGHT_DATA_PROXY_PORT;
  const username = process.env.BRIGHT_DATA_PROXY_USERNAME;
  const password = process.env.BRIGHT_DATA_PROXY_PASSWORD;
  if (!host || !port || !username || !password) {
    return null;
  }
  return {
    url: `http://${username}:${password}@${host}:${port}`,
    host,
    port,
    username,
    password,
  };
}

function getProxyDispatcher(): ProxyAgent | undefined {
  const proxy = getProxyConfig();
  if (!proxy) return undefined;
  return new ProxyAgent({
    uri: proxy.url,
    requestTls: {
      rejectUnauthorized: false,
    },
  });
}

function randomDelay(): Promise<void> {
  const ms = 1000 + Math.random() * 2000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  collectionMethodUsed: "WEB_API" | "HTML_PARSE" | "HEADLESS_RENDER" | "NONE";
  attempts: string[];
  warnings: string[];
}

export interface ScrapeStats {
  totalRequests: number;
  webApiSuccess: number;
  htmlParseSuccess: number;
  headlessRenderSuccess: number;
  scrapeBlocked: number;
  totalBytesEstimated: number;
  lastReset: number;
}

const scrapeStats: ScrapeStats = {
  totalRequests: 0,
  webApiSuccess: 0,
  htmlParseSuccess: 0,
  headlessRenderSuccess: 0,
  scrapeBlocked: 0,
  totalBytesEstimated: 0,
  lastReset: Date.now(),
};

export function getScrapeStats(): ScrapeStats & { successRate: string; blockedRate: string; bandwidthMB: string } {
  const total = scrapeStats.totalRequests || 1;
  return {
    ...scrapeStats,
    successRate: `${(((scrapeStats.webApiSuccess + scrapeStats.htmlParseSuccess + scrapeStats.headlessRenderSuccess) / total) * 100).toFixed(1)}%`,
    blockedRate: `${((scrapeStats.scrapeBlocked / total) * 100).toFixed(1)}%`,
    bandwidthMB: `${(scrapeStats.totalBytesEstimated / (1024 * 1024)).toFixed(2)} MB`,
  };
}

const MAX_BATCH_SIZE = 10;
let currentBatchCount = 0;
let batchResetTime = Date.now();
const BATCH_WINDOW_MS = 60 * 60 * 1000;

function checkBatchLimit(): boolean {
  if (Date.now() - batchResetTime > BATCH_WINDOW_MS) {
    currentBatchCount = 0;
    batchResetTime = Date.now();
  }
  if (currentBatchCount >= MAX_BATCH_SIZE) {
    return false;
  }
  currentBatchCount++;
  return true;
}

const profileCache = new Map<string, { data: ScrapeResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000;

function normalizeInstagramUrl(url: string): string {
  let handle = url.trim();
  handle = handle.split("?")[0].split("#")[0];
  handle = handle.replace(/\/$/, "");
  const match = handle.match(/instagram\.com\/([^\/\?#]+)/);
  if (match) handle = match[1];
  handle = handle.replace(/^@/, "").toLowerCase();
  return `https://www.instagram.com/${handle}/`;
}

function extractHandleFromUrl(url: string): string {
  let cleaned = url.trim().split("?")[0].split("#")[0];
  const match = cleaned.match(/instagram\.com\/([^\/\?#]+)/);
  return (match ? match[1] : url.replace(/^@/, "").split("/")[0]).toLowerCase();
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

async function attemptWebProfileApi(handle: string): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesReceived: number }> {
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${handle}/`,
  };

  const dispatcher = getProxyDispatcher();
  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  console.log(`[CI Scraper] WEB_API: Fetching web_profile_info for ${handle} ${dispatcher ? "via Bright Data proxy" : "direct"}`);

  const response = await fetch(apiUrl, fetchOptions);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const bytesReceived = Buffer.byteLength(text, "utf-8");

  console.log(`[CI Scraper] WEB_API: Received ${(bytesReceived / 1024).toFixed(1)} KB for ${handle}`);

  const data = JSON.parse(text);
  const user = data?.data?.user;
  if (!user) throw new Error("No user data in API response");

  const profileName = user.full_name || user.username || handle;
  const followers = user.edge_followed_by?.count ?? null;

  const edges = user.edge_owner_to_timeline_media?.edges || [];
  const posts: ScrapedPost[] = [];
  for (const edge of edges.slice(0, 30)) {
    posts.push(parsePostFromGraphQL(edge.node, handle));
  }

  console.log(`[CI Scraper] WEB_API: Extracted ${posts.length} posts, ${followers ?? "unknown"} followers for ${handle}`);

  return { posts, followers, profileName, bytesReceived };
}

async function attemptHtmlPageParse(profileUrl: string, handle: string): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesReceived: number }> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };

  const dispatcher = getProxyDispatcher();
  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  console.log(`[CI Scraper] HTML_PARSE: Fetching ${profileUrl}`);

  const response = await fetch(profileUrl, fetchOptions);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const bytesReceived = Buffer.byteLength(html, "utf-8");

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

  return { posts, followers, profileName, bytesReceived };
}

async function attemptHeadlessRender(profileUrl: string, handle: string): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesEstimated: number }> {
  const chromiumModule = await getChromium();
  if (!chromiumModule) throw new Error("Playwright not available");

  const proxy = getProxyConfig();
  let browser: Browser | null = null;

  try {
    const baseArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
    if (proxy) {
      baseArgs.push("--ignore-certificate-errors");
    }

    const launchOptions: any = {
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: baseArgs,
    };

    if (proxy) {
      launchOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      };
      console.log(`[CI Scraper] HEADLESS_RENDER: Launching with Bright Data proxy for ${handle}`);
    } else {
      console.log(`[CI Scraper] HEADLESS_RENDER: Launching direct (no proxy) for ${handle}`);
    }

    browser = await chromiumModule.launch(launchOptions);

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page: Page = await context.newPage();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const posts: any[] = [];
      let followers: number | null = null;
      let profileName: string | null = null;

      const nameEl = document.querySelector("header h2, header span[dir]");
      if (nameEl) profileName = nameEl.textContent?.trim() || null;

      const statEls = document.querySelectorAll("header ul li span, header section ul li span");
      for (let i = 0; i < statEls.length; i++) {
        const el = statEls[i];
        const title = el.getAttribute("title");
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
      for (let i = 0; i < postLinks.length; i++) {
        const link = postLinks[i] as HTMLAnchorElement;
        const href = link.href;
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

    const bytesEstimated = scrapedPosts.length * 500 + 50000;
    console.log(`[CI Scraper] HEADLESS_RENDER: Found ${scrapedPosts.length} posts for ${handle}, ~${(bytesEstimated / 1024).toFixed(1)} KB estimated`);

    return {
      posts: scrapedPosts,
      followers: data.followers,
      profileName: data.profileName || handle,
      bytesEstimated,
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
    console.log(`[CI Scraper] CACHE_HIT for ${handle}`);
    return { ...cached.data, attempts: [...cached.data.attempts, "CACHE_HIT"] };
  }

  const lastRequest = rateLimitMap.get(handle);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const cachedAny = profileCache.get(handle);
    if (cachedAny) return { ...cachedAny.data, attempts: ["RATE_LIMITED", "CACHE_HIT"] };
  }
  rateLimitMap.set(handle, Date.now());

  if (!checkBatchLimit()) {
    console.log(`[CI Scraper] BATCH_LIMIT reached (${MAX_BATCH_SIZE} profiles/hour). Returning cached or blocked.`);
    const cachedFallback = profileCache.get(handle);
    if (cachedFallback) return { ...cachedFallback.data, attempts: ["BATCH_LIMIT", "CACHE_HIT"] };
    return {
      success: false,
      posts: [],
      followers: null,
      profileName: handle,
      collectionMethodUsed: "NONE",
      attempts: ["BATCH_LIMIT"],
      warnings: ["BATCH_LIMIT_EXCEEDED: Testing phase limits scraping to 10 profiles per hour."],
    };
  }

  scrapeStats.totalRequests++;
  const attempts: string[] = [];
  const warnings: string[] = [];
  let posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;
  let collectionMethodUsed: ScrapeResult["collectionMethodUsed"] = "NONE";

  const proxyAvailable = !!getProxyConfig();
  if (!proxyAvailable) {
    console.warn("[CI Scraper] WARNING: No Bright Data proxy configured. Scraping without proxy may trigger rate limits.");
  }

  await randomDelay();

  attempts.push("WEB_API");
  try {
    const result = await attemptWebProfileApi(handle);
    posts = result.posts;
    followers = result.followers;
    profileName = result.profileName;
    scrapeStats.totalBytesEstimated += result.bytesReceived;
    if (posts.length > 0) {
      collectionMethodUsed = "WEB_API";
      scrapeStats.webApiSuccess++;
      console.log(`[CI Scraper] WEB_API SUCCESS: ${posts.length} posts, ${followers ?? "unknown"} followers for ${handle}`);
    }
  } catch (err: any) {
    console.log(`[CI Scraper] WEB_API failed for ${handle}: ${err.message}, trying HTML_PARSE...`);
    attempts.push("HTML_PARSE");
    try {
      const result = await attemptHtmlPageParse(profileUrl, handle);
      posts = result.posts;
      followers = result.followers;
      profileName = result.profileName;
      scrapeStats.totalBytesEstimated += result.bytesReceived;
      if (posts.length > 0) {
        collectionMethodUsed = "HTML_PARSE";
        scrapeStats.htmlParseSuccess++;
        console.log(`[CI Scraper] HTML_PARSE SUCCESS: ${posts.length} posts for ${handle}`);
      } else {
        console.log(`[CI Scraper] HTML_PARSE: Page loaded but no post data extracted for ${handle}`);
      }
    } catch (err2: any) {
      warnings.push(`WEB_API failed: ${err.message} | HTML_PARSE failed: ${err2.message}`);
      console.log(`[CI Scraper] HTML_PARSE FAILED for ${handle}: ${err2.message}`);
    }
  }

  if (posts.length < 5) {
    await randomDelay();
    attempts.push("HEADLESS_RENDER");
    try {
      const result = await attemptHeadlessRender(profileUrl, handle);
      scrapeStats.totalBytesEstimated += result.bytesEstimated;
      if (result.posts.length > posts.length) {
        posts = result.posts;
        collectionMethodUsed = "HEADLESS_RENDER";
        scrapeStats.headlessRenderSuccess++;
        console.log(`[CI Scraper] HEADLESS_RENDER SUCCESS: ${posts.length} posts for ${handle}`);
      }
      if (!followers && result.followers) followers = result.followers;
      if (!profileName && result.profileName) profileName = result.profileName;
    } catch (err: any) {
      warnings.push(`HEADLESS_RENDER failed: ${err.message}`);
      console.log(`[CI Scraper] HEADLESS_RENDER FAILED for ${handle}: ${err.message}`);
    }
  }

  if (posts.length === 0) {
    warnings.push("SCRAPE_BLOCKED");
    collectionMethodUsed = "NONE";
    scrapeStats.scrapeBlocked++;
    console.log(`[CI Scraper] SCRAPE_BLOCKED: All methods failed for ${handle}`);
  }

  const stats = getScrapeStats();
  console.log(`[CI Scraper] Stats: total=${stats.totalRequests}, success=${stats.successRate}, blocked=${stats.blockedRate}, bandwidth=${stats.bandwidthMB}`);

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
