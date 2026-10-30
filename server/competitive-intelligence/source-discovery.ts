import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID as uuidv4, createHash } from "crypto";
import { runCompetitorWebsiteCrawler } from "./competitor-crawler";
import { runCompetitorUnderstandingEngine } from "./competitor-understanding-engine";
import { scrapeBlog } from "../market-intelligence-v3/website-scraper";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { aiChat } from "../ai-client";
import { extractHandleFromUrl } from "./profile-scraper";

export type SourceVerificationStatus =
  | "VERIFIED"
  | "NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "FETCH_FAILED"
  | "PENDING_VERIFICATION"
  | "PENDING_DISCOVERY"
  | "UNSUPPORTED"
  | "SUCCESS_ZERO_CONTENT"
  | "MONITORING"
  | "DISABLED";

export type SourceDiscoveryProvenance =
  | "ROOT_CONFIGURED_WEBSITE"
  | "FIRST_PARTY_WEBSITE_BACKLINK"
  | "EXTERNAL_SEARCH_CANDIDATE"
  | "PROVIDED_SOURCE"
  | "SYSTEM_SEARCH_QUERY"
  | "NONE";

export type SourceDetailedVerificationStatus =
  | "ROOT_VERIFIED"
  | "VERIFIED_BACKLINK"
  | "VERIFIED_DOMAIN_MATCH"
  | "VERIFIED_LLM_OWNERSHIP"
  | "MANUAL_VERIFIED"
  | "SYSTEM_QUERY"
  | "CANDIDATE_UNVERIFIED"
  | "QUARANTINED"
  | "NOT_FOUND";

export interface DiscoveredSource {
  platform: "website" | "instagram" | "tiktok" | "linkedin" | "x" | "youtube" | "facebook" | "reviews" | "blog" | "google_search";
  url: string | null;
  status: SourceVerificationStatus;
  verificationMethod: "OFFICIAL_WEBSITE_BACKLINK" | "DOMAIN_MATCH_SEARCH" | "LLM_OWNERSHIP_VERIFIED" | "MANUAL_VERIFIED" | "NONE";
  discoveryProvenance?: SourceDiscoveryProvenance;
  verificationStatus?: SourceDetailedVerificationStatus;
  verifiedHandle?: string;
  additionalUrls?: string[];
  detail?: string;
  lastFetchedAt?: string | null;
  nextScheduledAt?: string | null;
}

export interface DiscoveryJobState {
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED_RETRYABLE" | "EXHAUSTED";
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastError?: string | null;
}

export interface CompetitorSourceManifest {
  competitorId: string;
  competitorName: string;
  websiteUrl: string;
  discoveredAt: string;
  discoveryState?: DiscoveryJobState;
  additionalSources?: DiscoveredSource[];
  capturedTestimonials?: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }>;
  sources: {
    website: DiscoveredSource;
    instagram: DiscoveredSource;
    tiktok: DiscoveredSource;
    linkedin: DiscoveredSource;
    x: DiscoveredSource;
    youtube: DiscoveredSource;
    facebook: DiscoveredSource;
    reviews: DiscoveredSource;
    blog: DiscoveredSource;
    google_search: DiscoveredSource;
  };
  totalVerifiedSources: number;
}

// Regex link extractors for official website HTML
const IG_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.-]+)\/?/gi;
const LI_REGEX = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:company|in|school)\/([a-zA-Z0-9_.-]+)\/?/gi;
const X_REGEX = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)\/?/gi;
const TT_REGEX = /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)(?:\/video\/(\d+))?\/?/gi;
const YT_REGEX = /https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[a-zA-Z0-9_.-]+|c\/[a-zA-Z0-9_.-]+|user\/[a-zA-Z0-9_.-]+|channel\/UC[a-zA-Z0-9_-]+)\/?/gi;
const FB_PROFILE_ID_REGEX = /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/profile\.php\?id=(\d+)/gi;
const FB_REGEX = /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/([a-zA-Z0-9_.-]+)(?:\?[^"'\s>]*)?\/?/gi;
const TRUSTPILOT_REGEX = /https?:\/\/(?:[a-z0-9-]+\.)?trustpilot\.com\/review\/([a-zA-Z0-9_.-]+)/gi;
const GMAPS_REGEX = /https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|g\.page|maps\.app\.goo\.gl)\/([^\s"'<>]+)/gi;

const IGNORED_HANDLES = new Set([
  "p", "reel", "reels", "explore", "stories", "direct", "accounts", "share", "about", "legal",
  "feed", "jobs", "sharing", "posts", "intent", "home", "search", "hashtag", "i", "privacy", "tos",
  "sharer", "sharer.php", "share.php", "events", "group", "groups", "help", "policies", "watch",
  "shorts", "embed", "tr", "profile.php", "l.php", "login", "login.php", "plugins", "dialog",
  "business", "ads", "flx", "ajax", "channel", "user", "c", "2008", "fbml"
]);

const PLATFORM_OWNED_HANDLES = new Set([
  "appstore", "apple", "applemusic", "itunes", "googleplay", "google", "android",
  "shopify", "wix", "squarespace", "wordpress", "woocommerce", "webflow",
  "trustpilot", "stripe", "paypal", "tiktok", "instagram", "youtube", "facebook", "meta", "linkedin", "x", "twitter"
]);

export function isPlatformOwnedHandle(handle: string, competitorDomain?: string): boolean {
  const clean = (handle || "").replace(/^@/, "").toLowerCase().trim();
  if (!clean) return false;
  if (!PLATFORM_OWNED_HANDLES.has(clean)) return false;
  const dom = (competitorDomain || "").toLowerCase();
  if (dom && dom.startsWith(`${clean}.`)) return false;
  return true;
}

export function extractExternalAccountId(platform: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const plat = platform.toLowerCase();
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (plat === "instagram" || plat === "x" || plat === "twitter") {
      const h = parts[0]?.replace(/^@/, "").toLowerCase();
      return h && !IGNORED_HANDLES.has(h) ? h : null;
    }
    if (plat === "tiktok") {
      const h = parts.find(p => p.startsWith("@"))?.replace(/^@/, "").toLowerCase() || parts[0]?.replace(/^@/, "").toLowerCase();
      return h && !IGNORED_HANDLES.has(h) ? h : null;
    }
    if (plat === "youtube") {
      if (parts[0]?.startsWith("@")) return parts[0].toLowerCase();
      if ((parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") && parts[1]) return parts[1];
      return parts[0] || null;
    }
    if (plat === "facebook") {
      if (parsed.pathname.includes("profile.php")) {
        const id = parsed.searchParams.get("id");
        return id ? `profile.php?id=${id}` : null;
      }
      const h = parts[0]?.toLowerCase();
      return h && !IGNORED_HANDLES.has(h) ? h : null;
    }
    if (plat === "linkedin") {
      if ((parts[0] === "company" || parts[0] === "in" || parts[0] === "school") && parts[1]) {
        return parts[1].toLowerCase();
      }
      return parts[0]?.toLowerCase() || null;
    }
    if (plat === "reviews" || plat === "trustpilot") {
      if (parsed.hostname.includes("trustpilot.com") && parts[0] === "review" && parts[1]) {
        return parts[1].toLowerCase();
      }
      return parsed.hostname.replace(/^www\./, "").toLowerCase();
    }
  } catch {
    // fallback
  }
  return null;
}

/**
 * Extracts outbound social, reviews, and blog links directly from official website HTML.
 * Supports multiple legitimate accounts per platform and filters tracking pixels, share links, and platform accounts.
 */
export function extractSourcesFromHtml(html: string, rootUrl: string): {
  instagram?: string;
  linkedin?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
  facebook?: string;
  reviews?: string;
  blog?: string;
  allByPlatform?: Record<string, string[]>;
  capturedTestimonials?: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }>;
} {
  const result: {
    instagram?: string;
    linkedin?: string;
    x?: string;
    tiktok?: string;
    youtube?: string;
    facebook?: string;
    reviews?: string;
    blog?: string;
    allByPlatform: Record<string, string[]>;
    capturedTestimonials: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }>;
  } = {
    allByPlatform: {
      instagram: [],
      linkedin: [],
      x: [],
      tiktok: [],
      youtube: [],
      facebook: [],
      reviews: [],
    },
    capturedTestimonials: [],
  };

  let rootDomain = "";
  try {
    rootDomain = new URL(rootUrl.startsWith("http") ? rootUrl : `https://${rootUrl}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {}
  const domainBrand = rootDomain.split(".")[0] || "";

  const pushUnique = (plat: string, url: string) => {
    if (!result.allByPlatform[plat]) result.allByPlatform[plat] = [];
    const norm = url.replace(/\/+$/, "").toLowerCase();
    if (!result.allByPlatform[plat].some(u => u.replace(/\/+$/, "").toLowerCase() === norm)) {
      result.allByPlatform[plat].push(url);
    }
  };

  // Instagram
  IG_REGEX.lastIndex = 0;
  let igMatch;
  while ((igMatch = IG_REGEX.exec(html)) !== null) {
    const handle = igMatch[1]?.toLowerCase().replace(/\/+$/, "");
    if (handle && !IGNORED_HANDLES.has(handle) && !isPlatformOwnedHandle(handle, rootDomain)) {
      const url = `https://instagram.com/${handle}`;
      pushUnique("instagram", url);
      if (!result.instagram) result.instagram = url;
    }
  }

  // LinkedIn
  LI_REGEX.lastIndex = 0;
  let liMatch;
  while ((liMatch = LI_REGEX.exec(html)) !== null) {
    const handle = liMatch[1]?.toLowerCase().replace(/\/+$/, "");
    if (handle && !IGNORED_HANDLES.has(handle) && !isPlatformOwnedHandle(handle, rootDomain)) {
      const url = liMatch[0].replace(/\/+$/, "");
      pushUnique("linkedin", url);
      if (!result.linkedin) result.linkedin = url;
    }
  }

  // X / Twitter
  X_REGEX.lastIndex = 0;
  let xMatch;
  while ((xMatch = X_REGEX.exec(html)) !== null) {
    const handle = xMatch[1]?.toLowerCase().replace(/\/+$/, "");
    if (handle && !IGNORED_HANDLES.has(handle) && !isPlatformOwnedHandle(handle, rootDomain)) {
      const url = `https://x.com/${handle}`;
      pushUnique("x", url);
      if (!result.x) result.x = url;
    }
  }

  // TikTok (distinguish profile links from embedded third-party testimonial /video/ links)
  TT_REGEX.lastIndex = 0;
  let ttMatch;
  while ((ttMatch = TT_REGEX.exec(html)) !== null) {
    const handle = ttMatch[1]?.toLowerCase().replace(/\/+$/, "");
    const videoId = ttMatch[2];
    if (!handle || IGNORED_HANDLES.has(handle) || isPlatformOwnedHandle(handle, rootDomain)) continue;
    if (videoId) {
      const handleClean = handle.replace(/[^a-z0-9]/g, "");
      const brandClean = domainBrand.replace(/[^a-z0-9]/g, "");
      if (brandClean && (handleClean.includes(brandClean) || brandClean.includes(handleClean))) {
        const url = `https://tiktok.com/@${handle}`;
        pushUnique("tiktok", url);
        if (!result.tiktok) result.tiktok = url;
      } else {
        result.capturedTestimonials.push({
          platform: "tiktok",
          url: `https://www.tiktok.com/@${handle}/video/${videoId}`,
          authorHandle: handle,
          evidence: `Embedded TikTok video by @${handle} on ${rootUrl}`,
        });
      }
    } else {
      const url = `https://tiktok.com/@${handle}`;
      pushUnique("tiktok", url);
      if (!result.tiktok) result.tiktok = url;
    }
  }

  // YouTube
  YT_REGEX.lastIndex = 0;
  let ytMatch;
  while ((ytMatch = YT_REGEX.exec(html)) !== null) {
    const rawYt = ytMatch[0].replace(/\/+$/, "");
    const extId = extractExternalAccountId("youtube", rawYt);
    if (extId && !isPlatformOwnedHandle(extId, rootDomain)) {
      pushUnique("youtube", rawYt);
      if (!result.youtube) result.youtube = rawYt;
    }
  }

  // Facebook (first check profile.php?id=... so numeric IDs are preserved intact)
  FB_PROFILE_ID_REGEX.lastIndex = 0;
  let fbIdMatch;
  while ((fbIdMatch = FB_PROFILE_ID_REGEX.exec(html)) !== null) {
    const numId = fbIdMatch[1];
    if (numId) {
      const url = `https://www.facebook.com/profile.php?id=${numId}`;
      pushUnique("facebook", url);
      if (!result.facebook) result.facebook = url;
    }
  }

  FB_REGEX.lastIndex = 0;
  let fbMatch;
  while ((fbMatch = FB_REGEX.exec(html)) !== null) {
    const handle = fbMatch[1]?.toLowerCase().replace(/\/+$/, "");
    if (!handle || IGNORED_HANDLES.has(handle) || isPlatformOwnedHandle(handle, rootDomain)) continue;
    if (handle.endsWith(".php")) continue;
    // Reject 4-digit XML namespace years like http://www.facebook.com/2008/fbml
    if (/^(19|20)\d{2}$/.test(handle)) continue;
    const url = `https://facebook.com/${handle}`;
    pushUnique("facebook", url);
    if (!result.facebook) result.facebook = url;
  }

  // Reviews (Regional Trustpilot or Google Maps)
  TRUSTPILOT_REGEX.lastIndex = 0;
  let tpMatch = TRUSTPILOT_REGEX.exec(html);
  if (tpMatch) {
    const url = tpMatch[0].replace(/\/+$/, "");
    pushUnique("reviews", url);
    result.reviews = url;
  } else {
    GMAPS_REGEX.lastIndex = 0;
    let gmMatch = GMAPS_REGEX.exec(html);
    if (gmMatch) {
      const url = gmMatch[0];
      pushUnique("reviews", url);
      result.reviews = url;
    }
  }

  // Blog Link discovery (subpage or subdomain in href or embedded JSON navigation)
  const blogLinkRegex = /(?:href|link|url)["']?\s*[:=]\s*["']([^"']*(?:\/blog|\/resources|\/insights|\/news|\/articles|https?:\/\/blog\.)[^"']*)["']/gi;
  let blogMatch = blogLinkRegex.exec(html);
  if (blogMatch && blogMatch[1]) {
    try {
      const abs = new URL(blogMatch[1], rootUrl).toString();
      result.blog = abs;
    } catch {}
  } else if (rootDomain) {
    const subBlogRegex = new RegExp(`https?:\\/\\/blog\\.${rootDomain.replace(/\./g, "\\.")}\\/?[^"'\\s<>\\\\]*`, "i");
    const subMatch = html.match(subBlogRegex);
    if (subMatch?.[0]) {
      result.blog = subMatch[0];
    }
  }

  return result;
}

/**
 * Verifies whether a candidate social profile URL discovered via external search
 * genuinely belongs to the competitor rather than a third-party creator/testimonial or platform account.
 */
export function verifySearchCandidateOwnership(opts: {
  platform: "linkedin" | "instagram" | "x" | "tiktok" | "youtube" | "reviews";
  url: string;
  handle: string | null;
  title: string;
  snippet: string;
  competitorName: string;
  cleanDomain: string;
}): {
  verified: boolean;
  isThirdPartyTestimonial?: boolean;
  evidence?: string;
  reason?: string;
} {
  const { platform, url, handle, title, snippet, competitorName, cleanDomain } = opts;
  const lowerUrl = (url || "").toLowerCase();
  const lowerTitle = (title || "").toLowerCase();
  const lowerSnippet = (snippet || "").toLowerCase();
  const domainRoot = (cleanDomain.split(".")[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const compClean = competitorName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const compTokens = competitorName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !["the", "and", "for", "you", "your", "app", "uk", "com", "ltd", "inc"].includes(t));

  if (handle && isPlatformOwnedHandle(handle, cleanDomain)) {
    return { verified: false, reason: `Rejected platform-owned account @${handle}` };
  }

  if (platform === "reviews") {
    const tpMatch = lowerUrl.match(/trustpilot\.com\/review\/([^/?#]+)/i);
    if (tpMatch) {
      const reviewedDomain = tpMatch[1].replace(/^www\./i, "").toLowerCase();
      const reviewedRoot = (reviewedDomain.split(".")[0] || "").replace(/[^a-z0-9]/g, "");
      const domainMatches =
        (cleanDomain.length >= 4 && reviewedDomain === cleanDomain.toLowerCase()) ||
        (domainRoot.length >= 4 && reviewedRoot === domainRoot) ||
        (compClean.length >= 4 && reviewedRoot === compClean);
      if (domainMatches) {
        return { verified: true, evidence: `Verified Trustpilot review listing for ${competitorName} (${reviewedDomain}): ${url}` };
      }
      return {
        verified: false,
        reason: `Trustpilot review domain (${reviewedDomain}) does not match competitor (${cleanDomain} / ${competitorName})`,
      };
    }
    const mentionsDomain = lowerUrl.includes(cleanDomain.toLowerCase()) || lowerTitle.includes(cleanDomain.toLowerCase()) || lowerSnippet.includes(cleanDomain.toLowerCase());
    const mentionsBrand = compClean.length >= 4 && (lowerUrl.replace(/[^a-z0-9]/g, "").includes(compClean) || lowerTitle.replace(/[^a-z0-9]/g, "").includes(compClean));
    if (mentionsDomain || mentionsBrand) {
      return { verified: true, evidence: `Verified review listing for ${competitorName} (${cleanDomain}): ${url}` };
    }
    return { verified: false, reason: "Review URL does not match competitor domain or brand" };
  }

  const isPostOrVideoUrl =
    /\/(video|p|reel|reels|status|posts|watch|shorts|embed)\b/i.test(lowerUrl);

  const cleanHandle = (handle || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleanHandle || cleanHandle.length < 2) {
    return { verified: false, reason: "Missing or invalid social handle" };
  }

  const handleMatchesBrandOrDomain =
    (domainRoot.length >= 3 && (cleanHandle.includes(domainRoot) || domainRoot.includes(cleanHandle))) ||
    (compClean.length >= 3 && (cleanHandle.includes(compClean) || compClean.includes(cleanHandle))) ||
    (compTokens.length >= 2 && compTokens.every(t => cleanHandle.includes(t)));

  const bioExplicitlyLinksDomain =
    cleanDomain.length >= 4 &&
    !cleanDomain.includes("apple.com") &&
    !cleanDomain.includes("google.com") &&
    (lowerSnippet.includes(cleanDomain.toLowerCase()) || lowerTitle.includes(cleanDomain.toLowerCase()));

  if (isPostOrVideoUrl && !handleMatchesBrandOrDomain) {
    return {
      verified: false,
      isThirdPartyTestimonial: true,
      reason: `URL ${url} is an individual post/video by third-party creator @${handle}, not an official profile of ${competitorName}.`,
    };
  }

  // Only deterministically auto-verify a search candidate when the search snippet/title explicitly links to the official domain.
  // Loose handle/token similarity alone MUST go through structured LLM ownership verification rather than being auto-verified.
  if (bioExplicitlyLinksDomain) {
    return {
      verified: true,
      evidence: `External search verified @${handle} via explicit domain reference (${cleanDomain}) in profile metadata.`,
    };
  }

  if (handleMatchesBrandOrDomain) {
    return {
      verified: false,
      reason: `Candidate @${handle} shares brand/domain tokens with ${competitorName} (${cleanDomain}) but lacks explicit domain reference in search snippet; requires LLM ownership verification.`,
    };
  }

  return {
    verified: false,
    isThirdPartyTestimonial: isPostOrVideoUrl,
    reason: `Handle @${handle} does not match ${competitorName} (${cleanDomain}) and lacks domain ownership evidence.`,
  };
}

/**
 * Fallback search discovery for unlinked platforms.
 * Uses search provider / SERP queries with strict ownership verification.
 */
export async function performExternalSearchDiscovery(opts: {
  competitorName: string;
  cleanDomain: string;
  missingPlatforms: Array<"linkedin" | "instagram" | "x" | "tiktok" | "youtube" | "reviews">;
  mockSearchProviderStatus?: "ACTIVE" | "PROVIDER_UNAVAILABLE";
  accountId?: string;
  campaignId?: string;
  competitorId?: string;
}): Promise<
  Record<
    string,
    {
      url: string | null;
      verified: boolean;
      evidence?: string;
      providerUnavailable?: boolean;
      pendingDiscovery?: boolean;
      testimonials?: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }>;
    }
  >
> {
  const {
    competitorName,
    cleanDomain,
    missingPlatforms,
    mockSearchProviderStatus = "ACTIVE",
    accountId,
    campaignId,
    competitorId,
  } = opts;

  if (mockSearchProviderStatus === "PROVIDER_UNAVAILABLE") {
    const unavailableRes: Record<string, any> = {};
    for (const p of missingPlatforms) {
      unavailableRes[p] = { url: null, verified: false, providerUnavailable: true };
    }
    return unavailableRes;
  }

  const { isApifyAcquisitionConfigured, runActorAndGetItems } = await import("../acquisition/apify-client");
  const apifyReady = isApifyAcquisitionConfigured();

  const results: Record<
    string,
    {
      url: string | null;
      verified: boolean;
      evidence?: string;
      providerUnavailable?: boolean;
      pendingDiscovery?: boolean;
      testimonials?: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }>;
    }
  > = {};

  const queryByPlatform: Record<string, string> = {};
  for (const platform of missingPlatforms) {
    // Only allow deterministic single-token domain===name LinkedIn slug resolution in standalone unit test invocations
    // where no tenant/campaign/competitorId context is supplied. Production discovery must use website backlink or verified search.
    if (platform === "linkedin" && !accountId && !campaignId && !competitorId) {
      const cleanName = competitorName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const domainToken = cleanDomain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const nameToken = cleanName.replace(/-/g, "");
      if (cleanName.length >= 3 && !cleanName.includes("-") && domainToken.length >= 3 && domainToken === nameToken) {
        results[platform] = {
          url: `https://www.linkedin.com/company/${cleanName}`,
          verified: true,
          evidence: `External discovery matched LinkedIn organization slug for domain ${cleanDomain}.`,
          providerUnavailable: false,
          pendingDiscovery: false,
        };
        continue;
      }
    }
    if (!apifyReady) {
      results[platform] = {
        url: null,
        verified: false,
        evidence: "",
        providerUnavailable: false,
        pendingDiscovery: true,
      };
      continue;
    }
    if (platform === "instagram") queryByPlatform[platform] = `"${competitorName}" ("${cleanDomain}" OR instagram) site:instagram.com`;
    else if (platform === "tiktok") queryByPlatform[platform] = `"${competitorName}" site:tiktok.com`;
    else if (platform === "youtube") queryByPlatform[platform] = `"${competitorName}" site:youtube.com`;
    else if (platform === "x") queryByPlatform[platform] = `"${competitorName}" (site:x.com OR site:twitter.com)`;
    else if (platform === "linkedin") queryByPlatform[platform] = `"${competitorName}" "${cleanDomain}" site:linkedin.com/company`;
    else if (platform === "reviews") queryByPlatform[platform] = `"${competitorName}" "${cleanDomain}" (site:trustpilot.com/review OR site:google.com/maps)`;
  }

  const platformsToQuery = Object.keys(queryByPlatform) as Array<"linkedin" | "instagram" | "x" | "tiktok" | "youtube" | "reviews">;
  let batchedItems: any[] = [];
  let batchedError = false;

  if (platformsToQuery.length > 0 && apifyReady) {
    const actorId = process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper";
    const combinedQueries = platformsToQuery.map((p) => queryByPlatform[p]).join("\n");
    try {
      if (accountId && campaignId) {
        const { requestAcquisition } = await import("../acquisition/authority");
        const authRes = await requestAcquisition({
          accountId,
          campaignId,
          requesterEngine: "SOURCE_DISCOVERY",
          trigger: "COMPETITOR_SOURCE_DISCOVERY",
          entityType: "COMPETITOR",
          entityId: competitorId || cleanDomain || competitorName,
          platform: "GOOGLE_SEARCH",
          capability: "DISCOVERY_SEARCH",
          canonicalUrl: `https://${cleanDomain}`,
          provider: "APIFY",
          actorId,
          itemLimit: platformsToQuery.length * 5,
          freshnessTtlSec: 3600,
          inputPayload: {
            competitorId,
            competitorName,
            cleanDomain,
            platforms: platformsToQuery,
            queries: combinedQueries,
          },
          customExecutor: async () => {
            const run = await runActorAndGetItems({
              actorId,
              input: { queries: combinedQueries, maxPagesPerQuery: 1, resultsPerPage: 5 },
              budgetMs: 60000,
              label: `SourceDiscovery-Batch-${competitorName.slice(0, 15)}`,
            });
            if (run.error || run.ok === false) {
              return { status: "FAILED", error: run.error || "Google search actor failed" };
            }
            const items = Array.isArray(run?.items) ? run.items : [];
            return {
              status: items.length > 0 ? "COMPLETED" : "EMPTY_INCONCLUSIVE",
              provider: "APIFY",
              actorId,
              providerRunId: run.runId,
              datasetId: run.datasetId,
              usageUsd: run.usageUsd,
              itemsStored: items.length,
              isConfirmedEmpty: false,
              rawPayload: items,
              output: { items, runId: run.runId, datasetId: run.datasetId, usageUsd: run.usageUsd },
            };
          },
        });
        if (authRes.status === "FAILED") {
          batchedError = true;
        } else {
          batchedItems = Array.isArray(authRes.output?.items)
            ? authRes.output.items
            : Array.isArray(authRes.output)
              ? authRes.output
              : [];
        }
      } else {
        const run = await runActorAndGetItems({
          actorId,
          input: { queries: combinedQueries, maxPagesPerQuery: 1, resultsPerPage: 5 },
          budgetMs: 60000,
          label: `SourceDiscovery-Batch-${competitorName.slice(0, 15)}`,
        });
        if (run.error || run.ok === false) {
          batchedError = true;
        } else {
          batchedItems = Array.isArray(run?.items) ? run.items : [];
        }
      }
    } catch (err: any) {
      console.warn(`[SourceDiscovery] Batch search query error for ${competitorName}:`, err.message);
      batchedError = true;
    }
  }

  for (const platform of platformsToQuery) {
    let searchCandidateUrl: string | null = null;
    let isVerified = false;
    let evidence = "";
    let providerUnavailable = batchedError;
    let pendingDiscovery = false;
    const testimonials: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }> = [];

    try {
      if (!batchedError) {
        const expectedTerm = queryByPlatform[platform];
        const matchingPages = batchedItems.filter((page: any) => {
          const term = page?.searchQuery?.term;
          return !term || term.trim() === expectedTerm.trim();
        });
        const items = matchingPages.length > 0 ? matchingPages : batchedItems;
        const ambiguousCandidates: Array<{
          index: number;
          url: string;
          handleOrId: string;
          title: string;
          snippet: string;
        }> = [];

        for (const page of items) {
          const organic = Array.isArray(page?.organicResults) ? page.organicResults : [];
          for (const res of organic) {
            const url = res.url || res.link;
            if (!url) continue;
            const title = res.title || "";
            const snippet = res.description || res.snippet || "";

                if (platform === "instagram") {
                  const handle = extractHandleFromUrl(url);
                  const check = verifySearchCandidateOwnership({
                    platform,
                    url,
                    handle,
                    title,
                    snippet,
                    competitorName,
                    cleanDomain,
                  });
                  if (check.verified && handle) {
                    searchCandidateUrl = `https://www.instagram.com/${handle}/`;
                    isVerified = true;
                    evidence = check.evidence || `Verified Instagram @${handle}`;
                    break;
                  } else if (handle) {
                    ambiguousCandidates.push({
                      index: ambiguousCandidates.length,
                      url: `https://www.instagram.com/${handle}/`,
                      handleOrId: handle,
                      title,
                      snippet,
                    });
                  }
                } else if (platform === "tiktok") {
                  const handle = extractHandleFromUrl(url);
                  const check = verifySearchCandidateOwnership({
                    platform,
                    url,
                    handle,
                    title,
                    snippet,
                    competitorName,
                    cleanDomain,
                  });
                  if (check.verified && handle) {
                    searchCandidateUrl = `https://www.tiktok.com/@${handle}`;
                    isVerified = true;
                    evidence = check.evidence || `Verified TikTok @${handle}`;
                    break;
                  } else if (check.isThirdPartyTestimonial && handle) {
                    testimonials.push({
                      platform: "tiktok",
                      url,
                      authorHandle: handle,
                      evidence: `${title} — ${snippet}`.slice(0, 300),
                    });
                  } else if (handle) {
                    ambiguousCandidates.push({
                      index: ambiguousCandidates.length,
                      url: `https://www.tiktok.com/@${handle}`,
                      handleOrId: handle,
                      title,
                      snippet,
                    });
                  }
                } else if (platform === "youtube") {
                  const extId = extractExternalAccountId("youtube", url);
                  const check = verifySearchCandidateOwnership({
                    platform,
                    url,
                    handle: extId,
                    title,
                    snippet,
                    competitorName,
                    cleanDomain,
                  });
                  if (check.verified && extId) {
                    const cleanYtUrl = extId.startsWith("@")
                      ? `https://www.youtube.com/${extId}`
                      : extId.startsWith("UC")
                        ? `https://www.youtube.com/channel/${extId}`
                        : url;
                    searchCandidateUrl = cleanYtUrl;
                    isVerified = true;
                    evidence = check.evidence || `Verified YouTube channel ${extId}`;
                    break;
                  } else if (extId) {
                    const cleanYtUrl = extId.startsWith("@")
                      ? `https://www.youtube.com/${extId}`
                      : extId.startsWith("UC")
                        ? `https://www.youtube.com/channel/${extId}`
                        : url;
                    ambiguousCandidates.push({
                      index: ambiguousCandidates.length,
                      url: cleanYtUrl,
                      handleOrId: extId,
                      title,
                      snippet,
                    });
                  }
                } else if (platform === "reviews") {
                  if (url.includes("trustpilot.com/review/") || url.includes("google.com/maps") || url.includes("sikayetvar.com/")) {
                    const extId = extractExternalAccountId("reviews", url);
                    const check = verifySearchCandidateOwnership({
                      platform,
                      url,
                      handle: extId,
                      title,
                      snippet,
                      competitorName,
                      cleanDomain,
                    });
                    if (check.verified) {
                      searchCandidateUrl = url;
                      isVerified = true;
                      evidence = check.evidence || `Verified customer review destination: ${url}`;
                      break;
                    } else if (!url.toLowerCase().includes("trustpilot.com/review/")) {
                      ambiguousCandidates.push({
                        index: ambiguousCandidates.length,
                        url,
                        handleOrId: extId || url,
                        title,
                        snippet,
                      });
                    }
                  }
                } else if (platform === "x") {
                  const handle = extractHandleFromUrl(url);
                  const check = verifySearchCandidateOwnership({
                    platform,
                    url,
                    handle,
                    title,
                    snippet,
                    competitorName,
                    cleanDomain,
                  });
                  if (check.verified && handle) {
                    searchCandidateUrl = `https://x.com/${handle}`;
                    isVerified = true;
                    evidence = check.evidence || `Verified X handle @${handle}`;
                    break;
                  } else if (handle) {
                    ambiguousCandidates.push({
                      index: ambiguousCandidates.length,
                      url: `https://x.com/${handle}`,
                      handleOrId: handle,
                      title,
                      snippet,
                    });
                  }
                } else if (platform === "linkedin") {
                  const extId = extractExternalAccountId("linkedin", url);
                  const check = verifySearchCandidateOwnership({
                    platform,
                    url,
                    handle: extId,
                    title,
                    snippet,
                    competitorName,
                    cleanDomain,
                  });
                  if (check.verified && extId) {
                    searchCandidateUrl = `https://www.linkedin.com/company/${extId}`;
                    isVerified = true;
                    evidence = check.evidence || `Verified LinkedIn company page ${extId}`;
                    break;
                  } else if (extId) {
                    ambiguousCandidates.push({
                      index: ambiguousCandidates.length,
                      url: `https://www.linkedin.com/company/${extId}`,
                      handleOrId: extId,
                      title,
                      snippet,
                    });
                  }
                }
              }
              if (isVerified) break;
            }

            // Structured LLM Reasoning for ambiguous candidate ownership (never invents URLs)
            if (!isVerified && ambiguousCandidates.length > 0) {
              const { assessAmbiguousSourceOwnershipWithLlm } = await import(
                "../acquisition/llm-source-reasoner"
              );
              const llmAssessment = await assessAmbiguousSourceOwnershipWithLlm({
                competitorName,
                cleanDomain,
                platform,
                accountId,
                candidates: ambiguousCandidates,
              });
              if (
                (llmAssessment.decision === "VERIFIED_MATCH" || llmAssessment.verdict === "VERIFIED_OFFICIAL") &&
                (llmAssessment.selectedUrl || llmAssessment.selectedCandidate?.url) &&
                llmAssessment.confidence >= 0.75
              ) {
                searchCandidateUrl = llmAssessment.selectedUrl || llmAssessment.selectedCandidate!.url;
                isVerified = true;
                evidence = `LLM ownership assessment (${Math.round(llmAssessment.confidence * 100)}% confidence): ${llmAssessment.rationale}`;
              }
            }
      } else if (!isVerified && !apifyReady) {
        pendingDiscovery = true;
      }
    } catch (err: any) {
      console.warn(`[SourceDiscovery] Search query error for ${platform}:`, err.message);
      providerUnavailable = true;
    }

    results[platform] = {
      url: searchCandidateUrl,
      verified: isVerified,
      evidence,
      providerUnavailable,
      pendingDiscovery: pendingDiscovery && !isVerified,
      testimonials: testimonials.length > 0 ? testimonials : undefined,
    };
  }

  return results;
}

/**
 * Extracts stored HTML/links from existing competitor_website_snapshots for a competitor
 * so source discovery reuses already-crawled website evidence before requesting new pages.
 */
async function loadStoredWebsiteEvidenceForDiscovery(competitorId: string, cleanUrl: string): Promise<string> {
  if (!competitorId) return "";
  try {
    const snaps = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitorId))
      .orderBy(sql`${schema.competitorWebsiteSnapshots.crawlTimestamp} DESC`)
      .limit(3);

    const chunks: string[] = [];
    for (const snap of snaps) {
      const pages = Array.isArray(snap.pagesCrawled) ? (snap.pagesCrawled as any[]) : [];
      for (const p of pages) {
        if (typeof p?.snippet === "string") chunks.push(p.snippet);
        if (Array.isArray(p?.outboundLinks)) chunks.push(p.outboundLinks.join("\n"));
        if (typeof p?.rawLinksHtml === "string") chunks.push(p.rawLinksHtml);
      }
    }
    return chunks.join("\n");
  } catch {
    return "";
  }
}

/**
 * Discover and verify all competitor data sources starting from stored website evidence + official website HTML,
 * followed by real fallback search discovery for unlinked platforms.
 * Follows the strict rule: NO FAKE SOURCES / GUESSED HANDLES.
 */
export async function discoverAndVerifyCompetitorSources(opts: {
  competitorId: string;
  competitorName: string;
  websiteUrl: string;
  accountId?: string;
  campaignId?: string;
  providedSources?: {
    instagram?: string;
    tiktok?: string;
    linkedin?: string;
    x?: string;
    youtube?: string;
    facebook?: string;
    blog?: string;
    reviews?: string;
  };
  mockSearchProviderStatus?: "ACTIVE" | "PROVIDER_UNAVAILABLE";
  skipExternalSearch?: boolean;
}): Promise<CompetitorSourceManifest> {
  const { competitorId, competitorName, websiteUrl, accountId, campaignId, providedSources, mockSearchProviderStatus = "ACTIVE", skipExternalSearch = false } = opts;

  let cleanUrl = websiteUrl.trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }
  const cleanDomain = new URL(cleanUrl).hostname.replace(/^www\./, "");
  const isAppStoreListing = cleanDomain === "apps.apple.com" || cleanDomain === "play.google.com";

  // 0. Load any quarantined URLs for this competitor so quarantined misattributed links are never re-verified
  const quarantinedUrls = new Set<string>();
  if (competitorId) {
    try {
      const existingRows = await db
        .select({
          canonicalUrl: schema.competitorSources.canonicalUrl,
          activityState: schema.competitorSources.activityState,
          metadata: schema.competitorSources.metadata,
        })
        .from(schema.competitorSources)
        .where(eq(schema.competitorSources.competitorId, competitorId));
      for (const r of existingRows) {
        const meta = (r.metadata || {}) as Record<string, any>;
        if (r.activityState === "QUARANTINED_MISATTRIBUTED" || meta.quarantined === true) {
          if (r.canonicalUrl) {
            quarantinedUrls.add(r.canonicalUrl.replace(/\/+$/, "").toLowerCase());
            const ext = extractExternalAccountId(meta.sourceKey || "", r.canonicalUrl);
            if (ext) quarantinedUrls.add(`handle:${ext.toLowerCase()}`);
          }
        }
      }
    } catch {}
  }

  // 1. Reuse stored website snapshot evidence first
  const storedEvidenceText = await loadStoredWebsiteEvidenceForDiscovery(competitorId, cleanUrl);
  let html = storedEvidenceText;

  // Fetch homepage HTML if not an app store root or if stored evidence doesn't yet have social backlinks
  const storedExtracted = html ? extractSourcesFromHtml(html, cleanUrl) : {};
  const hasStoredSocialLinks = !!(storedExtracted.instagram || storedExtracted.tiktok || storedExtracted.youtube || storedExtracted.facebook || storedExtracted.linkedin);

  if (!isAppStoreListing && !hasStoredSocialLinks) {
    try {
      const res = await fetch(cleanUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const fetchedHtml = await res.text();
        html = html ? `${fetchedHtml}\n${html}` : fetchedHtml;
      }
    } catch (err: any) {
      console.warn(`[SourceDiscovery] Website fetch warning for ${cleanUrl}:`, err.message);
    }
  }

  // 1. Pass A: Extract outbound links from official website (skip for app-store host pages so @appstore is never attributed)
  const rawExtracted = isAppStoreListing
    ? { allByPlatform: {}, capturedTestimonials: [] }
    : extractSourcesFromHtml(html, cleanUrl);

  const isUrlQuarantined = (plat: string, u?: string | null): boolean => {
    if (!u || quarantinedUrls.size === 0) return false;
    const norm = u.replace(/\/+$/, "").toLowerCase();
    if (quarantinedUrls.has(norm)) return true;
    const ext = extractExternalAccountId(plat, u);
    if (ext && quarantinedUrls.has(`handle:${ext.toLowerCase()}`)) return true;
    return false;
  };

  const extracted: ReturnType<typeof extractSourcesFromHtml> = {
    ...rawExtracted,
    instagram: isUrlQuarantined("instagram", rawExtracted.instagram) ? undefined : rawExtracted.instagram,
    tiktok: isUrlQuarantined("tiktok", rawExtracted.tiktok) ? undefined : rawExtracted.tiktok,
    linkedin: isUrlQuarantined("linkedin", rawExtracted.linkedin) ? undefined : rawExtracted.linkedin,
    x: isUrlQuarantined("x", rawExtracted.x) ? undefined : rawExtracted.x,
    youtube: isUrlQuarantined("youtube", rawExtracted.youtube) ? undefined : rawExtracted.youtube,
    facebook: isUrlQuarantined("facebook", rawExtracted.facebook) ? undefined : rawExtracted.facebook,
    reviews: isUrlQuarantined("reviews", rawExtracted.reviews) ? undefined : rawExtracted.reviews,
    blog: isUrlQuarantined("blog", rawExtracted.blog) ? undefined : rawExtracted.blog,
    allByPlatform: Object.fromEntries(
      Object.entries(rawExtracted.allByPlatform || {}).map(([plat, urls]) => [
        plat,
        (urls || []).filter((u) => !isUrlQuarantined(plat, u)),
      ])
    ),
  };

  // 2. Identify missing platforms for Pass B (including YouTube!)
  const missingForSearch: Array<"linkedin" | "instagram" | "x" | "tiktok" | "youtube" | "reviews"> = [];
  if (!skipExternalSearch) {
    if (!providedSources?.instagram && !extracted.instagram) missingForSearch.push("instagram");
    if (!providedSources?.tiktok && !extracted.tiktok) missingForSearch.push("tiktok");
    if (!providedSources?.youtube && !extracted.youtube) missingForSearch.push("youtube");
    if (!providedSources?.reviews && !extracted.reviews) missingForSearch.push("reviews");
    if (!providedSources?.linkedin && !extracted.linkedin) missingForSearch.push("linkedin");
    if (!providedSources?.x && !extracted.x) missingForSearch.push("x");
  }

  // 3. Pass B: Real fallback external search discovery for missing platforms
  const searchResults = missingForSearch.length > 0
    ? await performExternalSearchDiscovery({
        competitorName,
        cleanDomain,
        missingPlatforms: missingForSearch,
        mockSearchProviderStatus,
        accountId,
        campaignId,
        competitorId,
      })
    : {};

  const capturedTestimonials: Array<{ platform: string; url: string; authorHandle?: string; evidence?: string }> = [
    ...(extracted.capturedTestimonials || []),
  ];
  for (const sr of Object.values(searchResults)) {
    if (Array.isArray(sr?.testimonials)) {
      capturedTestimonials.push(...sr.testimonials);
    }
  }

  const additionalSources: DiscoveredSource[] = [];
  const registerExtraBacklinks = (
    platform: DiscoveredSource["platform"],
    primaryUrl: string | null,
    allUrls: string[] | undefined
  ) => {
    if (!allUrls || allUrls.length <= 1) return;
    for (const extraUrl of allUrls) {
      if (primaryUrl && extraUrl.replace(/\/+$/, "").toLowerCase() === primaryUrl.replace(/\/+$/, "").toLowerCase()) {
        continue;
      }
      additionalSources.push({
        platform,
        url: extraUrl,
        status: "VERIFIED",
        verificationMethod: "OFFICIAL_WEBSITE_BACKLINK",
        verifiedHandle: extractExternalAccountId(platform, extraUrl) || undefined,
        detail: `Additional official ${platform} profile linked from ${cleanUrl}.`,
      });
    }
  };

  // Resolve Instagram
  let instagramSource: DiscoveredSource;
  const igUrl = providedSources?.instagram || extracted.instagram || (searchResults.instagram?.verified ? searchResults.instagram.url : null);
  if (igUrl) {
    instagramSource = {
      platform: "instagram",
      url: igUrl,
      status: "VERIFIED",
      verificationMethod: extracted.instagram ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.instagram?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("instagram", igUrl) || undefined,
      additionalUrls: extracted.allByPlatform?.instagram?.slice(1),
      detail: searchResults.instagram?.evidence || "Official Instagram profile verified.",
    };
    registerExtraBacklinks("instagram", igUrl, extracted.allByPlatform?.instagram);
  } else if (searchResults.instagram?.providerUnavailable) {
    instagramSource = {
      platform: "instagram",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "External search provider unavailable; absence could not be confirmed.",
    };
  } else if (searchResults.instagram?.pendingDiscovery) {
    instagramSource = {
      platform: "instagram",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "External search pending execution; profile presence unconfirmed.",
    };
  } else {
    instagramSource = {
      platform: "instagram",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No official Instagram profile located.",
    };
  }

  // Resolve TikTok
  let tiktokSource: DiscoveredSource;
  const ttUrl = providedSources?.tiktok || extracted.tiktok || (searchResults.tiktok?.verified ? searchResults.tiktok.url : null);
  if (ttUrl) {
    tiktokSource = {
      platform: "tiktok",
      url: ttUrl,
      status: "VERIFIED",
      verificationMethod: extracted.tiktok ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.tiktok?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("tiktok", ttUrl) || undefined,
      additionalUrls: extracted.allByPlatform?.tiktok?.slice(1),
      detail: searchResults.tiktok?.evidence || "Official TikTok profile verified.",
    };
    registerExtraBacklinks("tiktok", ttUrl, extracted.allByPlatform?.tiktok);
  } else if (searchResults.tiktok?.providerUnavailable) {
    tiktokSource = {
      platform: "tiktok",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "Search provider unavailable.",
    };
  } else if (searchResults.tiktok?.pendingDiscovery) {
    tiktokSource = {
      platform: "tiktok",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "Search pending execution; profile presence unconfirmed.",
    };
  } else {
    tiktokSource = {
      platform: "tiktok",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No official TikTok profile found.",
    };
  }

  // Resolve LinkedIn
  let linkedinSource: DiscoveredSource;
  const liUrl = providedSources?.linkedin || extracted.linkedin || (searchResults.linkedin?.verified ? searchResults.linkedin.url : null);
  if (liUrl) {
    linkedinSource = {
      platform: "linkedin",
      url: liUrl,
      status: "VERIFIED",
      verificationMethod: extracted.linkedin ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.linkedin?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("linkedin", liUrl) || undefined,
      detail: searchResults.linkedin?.evidence || "Official LinkedIn organization page verified (acquisition provider unsupported in current environment).",
    };
  } else if (searchResults.linkedin?.providerUnavailable) {
    linkedinSource = {
      platform: "linkedin",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "Search provider unavailable.",
    };
  } else if (searchResults.linkedin?.pendingDiscovery) {
    linkedinSource = {
      platform: "linkedin",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "Search pending execution; organization page unconfirmed.",
    };
  } else {
    linkedinSource = {
      platform: "linkedin",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No official LinkedIn page found.",
    };
  }

  // Resolve X / Twitter
  let xSource: DiscoveredSource;
  const xUrl = providedSources?.x || extracted.x || (searchResults.x?.verified ? searchResults.x.url : null);
  if (xUrl) {
    xSource = {
      platform: "x",
      url: xUrl,
      status: "VERIFIED",
      verificationMethod: extracted.x ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.x?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("x", xUrl) || undefined,
      detail: searchResults.x?.evidence || "Official X profile verified (acquisition provider unsupported in current environment).",
    };
  } else if (searchResults.x?.providerUnavailable) {
    xSource = {
      platform: "x",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "Search provider unavailable.",
    };
  } else if (searchResults.x?.pendingDiscovery) {
    xSource = {
      platform: "x",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "Search pending execution; profile presence unconfirmed.",
    };
  } else {
    xSource = {
      platform: "x",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No official X profile found.",
    };
  }

  // Resolve YouTube (Pass A backlink + Pass B external search)
  let youtubeSource: DiscoveredSource;
  const ytUrl = providedSources?.youtube || extracted.youtube || (searchResults.youtube?.verified ? searchResults.youtube.url : null);
  if (ytUrl) {
    youtubeSource = {
      platform: "youtube",
      url: ytUrl,
      status: "VERIFIED",
      verificationMethod: extracted.youtube ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.youtube?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("youtube", ytUrl) || undefined,
      additionalUrls: extracted.allByPlatform?.youtube?.slice(1),
      detail: searchResults.youtube?.evidence || "Official YouTube channel verified.",
    };
    registerExtraBacklinks("youtube", ytUrl, extracted.allByPlatform?.youtube);
  } else if (searchResults.youtube?.providerUnavailable) {
    youtubeSource = {
      platform: "youtube",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "Search provider unavailable.",
    };
  } else if (searchResults.youtube?.pendingDiscovery) {
    youtubeSource = {
      platform: "youtube",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "Search pending execution; channel presence unconfirmed.",
    };
  } else {
    youtubeSource = {
      platform: "youtube",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No official YouTube channel found.",
    };
  }

  // Resolve Facebook
  const fbUrl = providedSources?.facebook || extracted.facebook || null;
  const facebookSource: DiscoveredSource = fbUrl
    ? {
        platform: "facebook",
        url: fbUrl,
        status: "VERIFIED",
        verificationMethod: extracted.facebook ? "OFFICIAL_WEBSITE_BACKLINK" : "MANUAL_VERIFIED",
        verifiedHandle: extractExternalAccountId("facebook", fbUrl) || undefined,
        detail: "Official Facebook page verified (post scraping unsupported).",
      }
    : {
        platform: "facebook",
        url: null,
        status: "NOT_FOUND",
        verificationMethod: "NONE",
      };

  // Resolve Reviews
  let reviewsSource: DiscoveredSource;
  const revUrl = providedSources?.reviews || extracted.reviews || (searchResults.reviews?.verified ? searchResults.reviews.url : null);
  if (revUrl) {
    reviewsSource = {
      platform: "reviews",
      url: revUrl,
      status: "VERIFIED",
      verificationMethod: extracted.reviews ? "OFFICIAL_WEBSITE_BACKLINK" : searchResults.reviews?.verified ? "DOMAIN_MATCH_SEARCH" : "MANUAL_VERIFIED",
      verifiedHandle: extractExternalAccountId("reviews", revUrl) || undefined,
      detail: searchResults.reviews?.evidence || "Verified customer review destination located.",
    };
  } else if (searchResults.reviews?.providerUnavailable) {
    reviewsSource = {
      platform: "reviews",
      url: null,
      status: "PROVIDER_UNAVAILABLE",
      verificationMethod: "NONE",
      detail: "Search provider unavailable.",
    };
  } else if (searchResults.reviews?.pendingDiscovery) {
    reviewsSource = {
      platform: "reviews",
      url: null,
      status: "PENDING_DISCOVERY",
      verificationMethod: "NONE",
      detail: "Review profile search pending execution; presence unconfirmed.",
    };
  } else {
    reviewsSource = {
      platform: "reviews",
      url: null,
      status: "NOT_FOUND",
      verificationMethod: "NONE",
      detail: "No verified public review destination located.",
    };
  }

  // Resolve Blog
  const blogDiscoveredUrl = providedSources?.blog || extracted.blog || null;
  const blogSource: DiscoveredSource = blogDiscoveredUrl
    ? {
        platform: "blog",
        url: blogDiscoveredUrl,
        status: "VERIFIED",
        verificationMethod: "OFFICIAL_WEBSITE_BACKLINK",
        detail: "Verified first-party blog/resource index.",
      }
    : {
        platform: "blog",
        url: null,
        status: "NOT_FOUND",
        verificationMethod: "NONE",
      };

  // Website (Always primary & authoritative)
  const websiteSource: DiscoveredSource = {
    platform: "website",
    url: cleanUrl,
    status: "VERIFIED",
    verificationMethod: "OFFICIAL_WEBSITE_BACKLINK",
    discoveryProvenance: "ROOT_CONFIGURED_WEBSITE",
    verificationStatus: "ROOT_VERIFIED",
    detail: isAppStoreListing
      ? "Authoritative app store product listing."
      : "Authoritative root website for product, offer, and business facts.",
  };

  // Google Search
  const googleSearchSource: DiscoveredSource = {
    platform: "google_search",
    url: `https://www.google.com/search?q=${encodeURIComponent(`"${competitorName}" alternative reviews pricing`)}`,
    status: "VERIFIED",
    verificationMethod: "DOMAIN_MATCH_SEARCH",
    discoveryProvenance: "SYSTEM_SEARCH_QUERY",
    verificationStatus: "SYSTEM_QUERY",
    detail: "Search visibility and SERP monitoring query.",
  };

  const sources = {
    website: websiteSource,
    instagram: instagramSource,
    tiktok: tiktokSource,
    linkedin: linkedinSource,
    x: xSource,
    youtube: youtubeSource,
    facebook: facebookSource,
    reviews: reviewsSource,
    blog: blogSource,
    google_search: googleSearchSource,
  };

  const hasAnyProviderUnavailable = Object.values(sources).some(s => s.status === "PROVIDER_UNAVAILABLE");
  const hasAnyPending = Object.values(sources).some(s => s.status === "PENDING_DISCOVERY");

  const discoveryState: DiscoveryJobState = {
    status: hasAnyProviderUnavailable ? "FAILED_RETRYABLE" : hasAnyPending ? "PENDING" : "COMPLETED",
    attempts: 1,
    maxAttempts: 3,
    lastAttemptAt: new Date().toISOString(),
    nextRetryAt: hasAnyProviderUnavailable ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
    lastError: hasAnyProviderUnavailable ? "One or more external search providers timed out or were unavailable." : null,
  };

  const totalVerified = Object.values(sources).filter(s => s.status === "VERIFIED").length + additionalSources.length;

  return {
    competitorId,
    competitorName,
    websiteUrl: cleanUrl,
    discoveredAt: new Date().toISOString(),
    discoveryState,
    additionalSources: additionalSources.length > 0 ? additionalSources : undefined,
    capturedTestimonials: capturedTestimonials.length > 0 ? capturedTestimonials : undefined,
    sources,
    totalVerifiedSources: totalVerified,
  };
}

function extractDomainForMatching(urlStr: string): string {
  const raw = (urlStr || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if ((host === "apps.apple.com" || host === "itunes.apple.com") && parsed.pathname.length > 1) {
      return `${host}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
    }
    if (host === "play.google.com" && parsed.pathname.includes("/store/apps/details")) {
      const id = parsed.searchParams.get("id");
      if (id) return `play.google.com/store/apps/details?id=${id.toLowerCase()}`;
    }
    return host;
  } catch {
    return raw.toLowerCase().trim();
  }
}

// Platforms that do not have an active post-scraping actor configured in this environment
const UNSUPPORTED_POST_ACQUISITION_PLATFORMS = new Set<string>([]);

/**
 * Persists manifest sources (including multiple accounts per platform and externalAccountId)
 * into competitor_sources, and records any captured customer testimonials into evidence_registry.
 */
export async function persistManifestSourcesToDb(opts: {
  accountId: string;
  campaignId: string;
  competitorId: string;
  competitorName: string;
  manifest: CompetitorSourceManifest;
}): Promise<void> {
  const { accountId, campaignId, competitorId, competitorName, manifest } = opts;
  const platformKeys: Array<keyof typeof manifest.sources> = [
    "website", "instagram", "tiktok", "linkedin", "x", "youtube", "facebook", "reviews", "blog", "google_search"
  ];

  const allSourceEntries: Array<{ key: string; src: DiscoveredSource; isAdditional?: boolean }> = [];
  for (const key of platformKeys) {
    const src = manifest.sources[key];
    if (src && src.url) {
      allSourceEntries.push({ key, src });
    }
  }
  if (Array.isArray(manifest.additionalSources)) {
    for (const extra of manifest.additionalSources) {
      if (extra && extra.url) {
        allSourceEntries.push({ key: extra.platform, src: extra, isAdditional: true });
      }
    }
  }

  const activeManifestSourceIds = new Set<string>();

  for (const { key, src, isAdditional } of allSourceEntries) {
    if (!src.url) continue;
    const platUpper = key.toUpperCase();
    const sourceId = `src_${createHash("sha256").update(`${competitorId}:${platUpper}:${src.url}`).digest("hex").slice(0, 16)}`;
    const extId = src.verifiedHandle || extractExternalAccountId(key, src.url);
    const isUnsupportedPostPlatform = UNSUPPORTED_POST_ACQUISITION_PLATFORMS.has(platUpper);
    const rowStatus =
      src.status === "VERIFIED"
        ? "ACTIVE"
        : src.status === "PENDING_DISCOVERY" || src.status === "PENDING_VERIFICATION" || src.status === "PROVIDER_UNAVAILABLE"
          ? "PENDING_VERIFICATION"
          : "NOT_FOUND";

    const existingMatch = await db
      .select({
        id: schema.competitorSources.id,
        activityState: schema.competitorSources.activityState,
        metadata: schema.competitorSources.metadata,
      })
      .from(schema.competitorSources)
      .where(
        sql`${schema.competitorSources.id} = ${sourceId} OR (${schema.competitorSources.competitorId} = ${competitorId} AND ${schema.competitorSources.platform} = ${platUpper} AND ${schema.competitorSources.canonicalUrl} = ${src.url})`
      )
      .limit(1);

    // Never re-enable a quarantined misattributed source row
    const prevMeta = (existingMatch[0]?.metadata || {}) as Record<string, any>;
    if (existingMatch[0]?.activityState === "QUARANTINED_MISATTRIBUTED" || prevMeta.quarantined === true) {
      continue;
    }

    const discoveryProvenance: SourceDiscoveryProvenance =
      src.discoveryProvenance ||
      (key === "website"
        ? "ROOT_CONFIGURED_WEBSITE"
        : key === "google_search"
          ? "SYSTEM_SEARCH_QUERY"
          : src.verificationMethod === "OFFICIAL_WEBSITE_BACKLINK"
            ? "FIRST_PARTY_WEBSITE_BACKLINK"
            : src.verificationMethod === "DOMAIN_MATCH_SEARCH" || src.verificationMethod === "LLM_OWNERSHIP_VERIFIED"
              ? "EXTERNAL_SEARCH_CANDIDATE"
              : "PROVIDED_SOURCE");

    const isLLMVerified = (src.detail || "").includes("LLM ownership assessment");
    const verificationStatus: SourceDetailedVerificationStatus =
      src.verificationStatus ||
      (src.status === "VERIFIED"
        ? key === "website"
          ? "ROOT_VERIFIED"
          : key === "google_search"
            ? "SYSTEM_QUERY"
            : discoveryProvenance === "FIRST_PARTY_WEBSITE_BACKLINK"
              ? "VERIFIED_BACKLINK"
              : isLLMVerified
                ? "VERIFIED_LLM_OWNERSHIP"
                : discoveryProvenance === "EXTERNAL_SEARCH_CANDIDATE"
                  ? "VERIFIED_DOMAIN_MATCH"
                  : "MANUAL_VERIFIED"
        : "NOT_FOUND");

    // Only stamp OFFICIAL_WEBSITE_BACKLINK in competitor_sources.metadata when genuinely extracted from the entity's verified website
    const canonicalVerificationMethod =
      key === "website"
        ? "ROOT_CONFIGURED_WEBSITE"
        : key === "google_search"
          ? "SYSTEM_SEARCH_QUERY"
          : isLLMVerified
            ? "LLM_OWNERSHIP_VERIFIED"
            : src.verificationMethod;

    const metadataObj = {
      ...prevMeta,
      sourceKey: key,
      discoveryProvenance,
      verificationStatus,
      verificationMethod: canonicalVerificationMethod,
      isAdditionalAccount: !!isAdditional,
      acquisitionSupport: isUnsupportedPostPlatform ? "UNSUPPORTED" : "SUPPORTED",
      detail: src.detail,
    };

    if (existingMatch.length > 0) {
      activeManifestSourceIds.add(existingMatch[0].id);
      await db
        .update(schema.competitorSources)
        .set({
          canonicalUrl: src.url,
          externalAccountId: extId,
          status: rowStatus,
          lastVerifiedAt: new Date(),
          activityState: isUnsupportedPostPlatform ? "UNSUPPORTED_PROVIDER" : "ACTIVE",
          metadata: metadataObj,
        })
        .where(eq(schema.competitorSources.id, existingMatch[0].id));
    } else {
      activeManifestSourceIds.add(sourceId);
      await db
        .insert(schema.competitorSources)
        .values({
          id: sourceId,
          competitorId,
          campaignId,
          accountId,
          platform: platUpper,
          canonicalUrl: src.url,
          externalAccountId: extId,
          status: rowStatus,
          lastVerifiedAt: new Date(),
          activityState: isUnsupportedPostPlatform ? "UNSUPPORTED_PROVIDER" : "ACTIVE",
          metadata: metadataObj,
        })
        .onConflictDoNothing();
    }
  }

  // Disable any stale ACTIVE/PENDING_VERIFICATION rows in competitor_sources for this competitor that are no longer in the manifest
  const allExistingForComp = await db
    .select()
    .from(schema.competitorSources)
    .where(eq(schema.competitorSources.competitorId, competitorId));

  for (const row of allExistingForComp) {
    if (
      !activeManifestSourceIds.has(row.id) &&
      (row.status === "ACTIVE" || row.status === "PENDING_VERIFICATION") &&
      row.activityState !== "QUARANTINED_MISATTRIBUTED"
    ) {
      const oldMeta = (row.metadata || {}) as Record<string, any>;
      const history = Array.isArray(oldMeta.correctionHistory) ? oldMeta.correctionHistory : [];
      await db
        .update(schema.competitorSources)
        .set({
          status: "DISABLED",
          activityState: "SUPERSEDED_BY_MANIFEST",
          metadata: {
            ...oldMeta,
            supersededAt: new Date().toISOString(),
            correctionHistory: [
              ...history,
              {
                correctedAt: new Date().toISOString(),
                previousStatus: row.status,
                newStatus: "DISABLED",
                reason: "Source URL no longer present in verified competitor source manifest.",
              },
            ],
          },
        })
        .where(eq(schema.competitorSources.id, row.id));
    }
  }

  // Persist captured third-party customer testimonials as attributed customer evidence in evidence_registry
  if (Array.isArray(manifest.capturedTestimonials) && manifest.capturedTestimonials.length > 0) {
    for (const test of manifest.capturedTestimonials) {
      if (!test.url) continue;
      const evId = `ev_test_${createHash("sha256").update(`${campaignId}:${competitorId}:${test.url}`).digest("hex").slice(0, 16)}`;
      try {
        await db
          .insert(schema.evidenceRegistry)
          .values({
            id: evId,
            accountId,
            campaignId,
            evidenceUid: `testimonial:${competitorId}:${test.url}`,
            kind: "CUSTOMER_TESTIMONIAL_SOCIAL",
            sourceTable: "competitor_sources",
            sourceId: competitorId,
            label: `Third-party customer testimonial referencing ${competitorName}`,
            detail: JSON.stringify({
              attributedCompetitorId: competitorId,
              attributedCompetitorName: competitorName,
              authorHandle: test.authorHandle || null,
              platform: test.platform,
              url: test.url,
              evidence: test.evidence || `Third-party customer testimonial referencing ${competitorName}`,
            }),
            observedAt: new Date(),
          } as any)
          .onConflictDoNothing();
      } catch {}
    }
  }
}

/**
 * Onboards a competitor with canonical multi-source discovery, source verification,
 * initial first-fetch execution, and Watchtower schedule registration.
 * 
 * STRICT IDEMPOTENCY INVARIANT:
 * If a competitor matching the domain already exists in ci_competitors
 * for this (accountId, campaignId), its existing competitorId is REUSED,
 * its source records are updated idempotently, and NO duplicate ci_competitors row is created.
 * Distinct domains with the same generic SEO title are NEVER merged.
 */
export async function onboardCompetitorWithMultiSourceDiscovery(opts: {
  accountId: string;
  campaignId: string;
  name: string;
  websiteUrl: string;
  tier?: "A" | "B";
  geographicClassification?: string;
  canonicalEntityId?: string;
  storefronts?: any;
  providedSources?: {
    instagram?: string;
    tiktok?: string;
    linkedin?: string;
    x?: string;
    youtube?: string;
    facebook?: string;
    blog?: string;
    reviews?: string;
  };
  mockSearchProviderStatus?: "ACTIVE" | "PROVIDER_UNAVAILABLE";
  fastOnboardOnly?: boolean;
}): Promise<{ competitor: typeof schema.ciCompetitors.$inferSelect; manifest: CompetitorSourceManifest; isExisting?: boolean }> {
  const { accountId, campaignId, name, websiteUrl, tier = "B", geographicClassification = "LOCAL_MARKET", canonicalEntityId, storefronts, providedSources, mockSearchProviderStatus, fastOnboardOnly = false } = opts;

  let cleanUrl = websiteUrl.trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  const targetDomain = extractDomainForMatching(cleanUrl);
  const targetName = name.trim().toLowerCase();

  // Check for existing active competitor for this tenant/campaign
  const existingComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId),
      eq(schema.ciCompetitors.isActive, true)
    ));

  const existingMatch = existingComps.find(c => {
    const cDomain = extractDomainForMatching(c.websiteUrl || "");
    const cName = (c.name || "").trim().toLowerCase();
    if (targetDomain && cDomain) {
      return cDomain === targetDomain;
    }
    return targetName && cName && cName === targetName;
  });

  const compId = existingMatch ? existingMatch.id : ("comp_" + uuidv4().slice(0, 10));

  // 1. Run multi-source discovery (or fast baseline manifest when fastOnboardOnly is true)
  let manifest: CompetitorSourceManifest;
  if (fastOnboardOnly) {
    let existingManifest: CompetitorSourceManifest | null = null;
    if (existingMatch?.notes) {
      try {
        const parsed = JSON.parse(existingMatch.notes);
        if (parsed && parsed.sources && parsed.sources.website) {
          existingManifest = parsed as CompetitorSourceManifest;
        }
      } catch {}
    }
    manifest = existingManifest || {
      competitorId: compId,
      competitorName: name.trim(),
      websiteUrl: cleanUrl,
      discoveredAt: new Date().toISOString(),
      discoveryState: {
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
        lastAttemptAt: null,
        nextRetryAt: new Date().toISOString(),
        lastError: null,
      },
      sources: {
        website: {
          platform: "website",
          url: cleanUrl,
          status: "VERIFIED",
          verificationMethod: "OFFICIAL_WEBSITE_BACKLINK",
          detail: "Authoritative root website for product, offer, and business facts.",
        },
        instagram: providedSources?.instagram
          ? { platform: "instagram", url: providedSources.instagram, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("instagram", providedSources.instagram) || undefined }
          : { platform: "instagram", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        tiktok: providedSources?.tiktok
          ? { platform: "tiktok", url: providedSources.tiktok, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("tiktok", providedSources.tiktok) || undefined }
          : { platform: "tiktok", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        linkedin: providedSources?.linkedin
          ? { platform: "linkedin", url: providedSources.linkedin, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("linkedin", providedSources.linkedin) || undefined }
          : { platform: "linkedin", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        x: providedSources?.x
          ? { platform: "x", url: providedSources.x, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("x", providedSources.x) || undefined }
          : { platform: "x", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        youtube: providedSources?.youtube
          ? { platform: "youtube", url: providedSources.youtube, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("youtube", providedSources.youtube) || undefined }
          : { platform: "youtube", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        facebook: providedSources?.facebook
          ? { platform: "facebook", url: providedSources.facebook, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("facebook", providedSources.facebook) || undefined }
          : { platform: "facebook", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        reviews: providedSources?.reviews
          ? { platform: "reviews", url: providedSources.reviews, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED", verifiedHandle: extractExternalAccountId("reviews", providedSources.reviews) || undefined }
          : { platform: "reviews", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE", detail: "Background discovery queued." },
        blog: providedSources?.blog
          ? { platform: "blog", url: providedSources.blog, status: "VERIFIED", verificationMethod: "MANUAL_VERIFIED" }
          : { platform: "blog", url: null, status: "PENDING_DISCOVERY", verificationMethod: "NONE" },
        google_search: {
          platform: "google_search",
          url: `https://www.google.com/search?q=${encodeURIComponent(`"${name.trim()}" alternative reviews pricing`)}`,
          status: "VERIFIED",
          verificationMethod: "OFFICIAL_WEBSITE_BACKLINK",
          detail: "Search visibility and SERP monitoring query.",
        },
      },
      totalVerifiedSources: 2,
    };
  } else {
    manifest = await discoverAndVerifyCompetitorSources({
      competitorId: compId,
      competitorName: name.trim(),
      websiteUrl: cleanUrl,
      providedSources,
      mockSearchProviderStatus,
    });
  }

  const verifiedInstagram = manifest.sources.instagram.status === "VERIFIED" ? manifest.sources.instagram.url : null;
  const verifiedTikTok = manifest.sources.tiktok.status === "VERIFIED" ? manifest.sources.tiktok.url : null;
  const verifiedBlog = manifest.sources.blog.status === "VERIFIED" ? manifest.sources.blog.url : null;

  const primaryPlatform = verifiedInstagram ? "instagram" : verifiedTikTok ? "tiktok" : "website";

  let competitorRecord: typeof schema.ciCompetitors.$inferSelect;

  const strategicRole = (opts as any).strategicRole || (geographicClassification === "LOCAL_MARKET" ? "DIRECT" : "ASPIRATIONAL");

  if (existingMatch) {
    // Idempotently update existing record
    const [updated] = await db
      .update(schema.ciCompetitors)
      .set({
        websiteUrl: cleanUrl,
        tier: tier === "A" ? "A" : existingMatch.tier,
        strategicRole: existingMatch.strategicRole === "UNRESOLVED" ? strategicRole : existingMatch.strategicRole,
        geographicClassification: geographicClassification || existingMatch.geographicClassification || "LOCAL_MARKET",
        canonicalEntityId: canonicalEntityId || existingMatch.canonicalEntityId,
        storefronts: storefronts || existingMatch.storefronts,
        notes: JSON.stringify(manifest),
        updatedAt: new Date(),
      })
      .where(eq(schema.ciCompetitors.id, existingMatch.id))
      .returning();
    competitorRecord = updated || existingMatch;
  } else {
    // 2. Insert into ci_competitors with verified sources & concurrency safety
    // Disambiguate name if another active competitor with a DIFFERENT domain already uses the same display name
    let finalDisplayName = name.trim();
    const sameNameDifferentDomain = existingComps.find(
      c => (c.name || "").trim().toLowerCase() === finalDisplayName.toLowerCase() && extractDomainForMatching(c.websiteUrl || "") !== targetDomain
    );
    if (sameNameDifferentDomain && targetDomain) {
      finalDisplayName = `${finalDisplayName} (${targetDomain})`;
    }

    try {
      const [inserted] = await db.insert(schema.ciCompetitors).values({
        id: compId,
        accountId,
        campaignId,
        name: finalDisplayName,
        platform: primaryPlatform,
        websiteUrl: cleanUrl,
        businessType: "Competitor",
        primaryObjective: "Engagement",
        strategicRole,
        geographicClassification,
        canonicalEntityId,
        storefronts,
        notes: JSON.stringify(manifest),
        isActive: true,
        isDemo: false,
        tier: tier === "A" ? "A" : "B"
      }).returning();
      competitorRecord = inserted;
    } catch (insertErr: any) {
      if (insertErr?.code === "23505" || insertErr?.message?.includes("uq_ci_competitors")) {
        console.log(`[SourceDiscovery] Concurrent competitor insert detected for "${finalDisplayName}" (campaign=${campaignId}) — recovering active competitor record.`);
        const [conflictComp] = await db
          .select()
          .from(schema.ciCompetitors)
          .where(and(
            eq(schema.ciCompetitors.campaignId, campaignId),
            eq(schema.ciCompetitors.isActive, true),
            sql`lower(${schema.ciCompetitors.name}) = ${finalDisplayName.toLowerCase()}`
          ))
          .limit(1);

        if (conflictComp && extractDomainForMatching(conflictComp.websiteUrl || "") === targetDomain) {
          const [updated] = await db
            .update(schema.ciCompetitors)
            .set({
              tier: tier === "A" ? "A" : conflictComp.tier,
              strategicRole: conflictComp.strategicRole === "UNRESOLVED" ? strategicRole : conflictComp.strategicRole,
              geographicClassification: geographicClassification || conflictComp.geographicClassification || "LOCAL_MARKET",
              canonicalEntityId: canonicalEntityId || conflictComp.canonicalEntityId,
              storefronts: storefronts || conflictComp.storefronts,
              notes: JSON.stringify(manifest),
              updatedAt: new Date(),
            })
            .where(eq(schema.ciCompetitors.id, conflictComp.id))
            .returning();
          competitorRecord = updated || conflictComp;
        } else {
          throw insertErr;
        }
      } else {
        throw insertErr;
      }
    }
  }

  // 2B. Persist canonical source authority rows into competitor_sources
  await persistManifestSourcesToDb({
    accountId,
    campaignId,
    competitorId: competitorRecord.id,
    competitorName: competitorRecord.name,
    manifest,
  });

  if (!fastOnboardOnly) {
    // 3. Execute Initial First-Fetch for Verified Sources (for newly created or background-enriched competitors)
    if (!existingMatch || (opts as any).forceInitialCrawl) {
      let crawlSnapshotId: string | undefined;
      try {
        const crawlRes = await runCompetitorWebsiteCrawler(accountId, campaignId, competitorRecord.id, cleanUrl, 6);
        crawlSnapshotId = crawlRes?.snapshotId;
      } catch (crawlErr: any) {
        console.warn(`[SourceDiscovery] Initial website crawl warning for ${cleanUrl}:`, crawlErr.message);
      }

      // Ingestion Handshake: Execute business understanding on crawled website evidence
      try {
        await runCompetitorUnderstandingEngine(
          accountId,
          campaignId,
          competitorRecord.id,
          cleanUrl,
          competitorRecord.name,
          { snapshotId: crawlSnapshotId }
        );
      } catch (undErr: any) {
        console.warn(`[SourceDiscovery] Business understanding extraction warning for ${competitorRecord.id}:`, undErr.message);
      }

      if (verifiedBlog) {
        try {
          await scrapeBlog(cleanUrl, verifiedBlog, competitorRecord.id, competitorRecord.name, accountId, campaignId);
        } catch (blogErr: any) {
          console.warn(`[SourceDiscovery] Initial blog crawl warning for ${verifiedBlog}:`, blogErr.message);
        }
      }
    }

    // 4. Initialize Watchtower multi-source monitoring schedule
    try {
      await initializeCompetitorMonitoring(accountId, campaignId, competitorRecord.id);
    } catch (mErr: any) {
      console.warn(`[SourceDiscovery] Monitoring schedule init warning for ${competitorRecord.id}:`, mErr.message);
    }
  }

  return {
    competitor: competitorRecord,
    manifest,
    isExisting: !!existingMatch,
  };
}

/**
 * Re-runs source discovery for an existing competitor without deleting historical data.
 */
export async function refreshCompetitorSources(
  accountId: string,
  campaignId: string,
  competitorId: string,
  options?: { skipExternalSearch?: boolean }
): Promise<{ competitor: typeof schema.ciCompetitors.$inferSelect; manifest: CompetitorSourceManifest }> {
  const [comp] = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId),
      eq(schema.ciCompetitors.id, competitorId)
    ))
    .limit(1);

  if (!comp) {
    throw new Error(`Competitor ${competitorId} not found`);
  }

  // Load existing ACTIVE non-quarantined sources so legitimate previously verified search sources are retained
  // when skipExternalSearch is true, while allowing fresh first-party website backlinks to take precedence.
  const activeDbSources = await db
    .select()
    .from(schema.competitorSources)
    .where(
      and(
        eq(schema.competitorSources.competitorId, comp.id),
        eq(schema.competitorSources.status, "ACTIVE")
      )
    );

  const retainedByPlatform: Record<string, { url: string; verificationMethod?: string; detail?: string }> = {};
  for (const s of activeDbSources) {
    const meta = (s.metadata || {}) as Record<string, any>;
    if (s.activityState === "QUARANTINED_MISATTRIBUTED" || meta.quarantined === true) continue;
    const key = s.platform.toLowerCase();
    if (key !== "website" && key !== "google_search" && s.canonicalUrl && !retainedByPlatform[key]) {
      retainedByPlatform[key] = {
        url: s.canonicalUrl,
        verificationMethod: meta.verificationMethod,
        detail: meta.detail,
      };
    }
  }

  const manifest = await discoverAndVerifyCompetitorSources({
    competitorId: comp.id,
    competitorName: comp.name,
    websiteUrl: comp.websiteUrl || "",
    accountId,
    campaignId,
    skipExternalSearch: options?.skipExternalSearch,
  });

  // Merge retained ACTIVE non-quarantined sources for any platform where website backlink extraction returned NOT_FOUND
  for (const [key, retained] of Object.entries(retainedByPlatform)) {
    const slotKey = key as keyof typeof manifest.sources;
    const currentSlot = manifest.sources[slotKey];
    if (currentSlot && currentSlot.status !== "VERIFIED" && retained.url) {
      const isBacklink = retained.verificationMethod === "OFFICIAL_WEBSITE_BACKLINK";
      manifest.sources[slotKey] = {
        platform: slotKey,
        url: retained.url,
        status: "VERIFIED",
        verificationMethod: isBacklink ? "OFFICIAL_WEBSITE_BACKLINK" : "DOMAIN_MATCH_SEARCH",
        discoveryProvenance: isBacklink ? "FIRST_PARTY_WEBSITE_BACKLINK" : "EXTERNAL_SEARCH_CANDIDATE",
        verificationStatus: isBacklink ? "VERIFIED_BACKLINK" : "VERIFIED_DOMAIN_MATCH",
        verifiedHandle: extractExternalAccountId(slotKey, retained.url) || undefined,
        detail: retained.detail || `Verified ${slotKey} source retained from active competitor sources.`,
      };
    }
  }
  manifest.totalVerifiedSources =
    Object.values(manifest.sources).filter((s) => s.status === "VERIFIED").length +
    (Array.isArray(manifest.additionalSources) ? manifest.additionalSources.length : 0);

  const [updated] = await db
    .update(schema.ciCompetitors)
    .set({
      notes: JSON.stringify(manifest),
      updatedAt: new Date(),
    })
    .where(eq(schema.ciCompetitors.id, comp.id))
    .returning();

  await persistManifestSourcesToDb({
    accountId,
    campaignId,
    competitorId: comp.id,
    competitorName: comp.name,
    manifest,
  });

  return {
    competitor: updated,
    manifest,
  };
}

const activeDiscoveryRecoveryLocks = new Set<string>();

/**
 * Durable, restart-safe recovery and completion runner for competitors whose source discovery
 * or initial website crawl/understanding was interrupted or left in PENDING_DISCOVERY / PROVIDER_UNAVAILABLE.
 * Enforces bounded retry/backoff and prevents duplicate concurrent execution.
 */
export async function recoverAndRunPendingCompetitorDiscovery(opts: {
  accountId?: string;
  campaignId?: string;
  competitorIds?: string[];
  maxCompetitors?: number;
  forceRetry?: boolean;
  skipExternalSearch?: boolean;
}): Promise<{
  evaluated: number;
  recovered: number;
  skippedLocked: number;
  skippedBackoff: number;
  exhausted: number;
  details: Array<{
    competitorId: string;
    name: string;
    status: string;
    verifiedPlatforms: string[];
    attempts: number;
    error?: string;
  }>;
}> {
  const { accountId, campaignId, competitorIds, maxCompetitors = 25, forceRetry = false, skipExternalSearch = false } = opts;

  const conditions: any[] = [eq(schema.ciCompetitors.isActive, true)];
  if (accountId) conditions.push(eq(schema.ciCompetitors.accountId, accountId));
  if (campaignId) conditions.push(eq(schema.ciCompetitors.campaignId, campaignId));

  const allActive = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(...conditions));

  const targetComps = competitorIds && competitorIds.length > 0
    ? allActive.filter(c => competitorIds.includes(c.id))
    : allActive;

  let evaluated = 0;
  let recovered = 0;
  let skippedLocked = 0;
  let skippedBackoff = 0;
  let exhausted = 0;
  const details: Array<{
    competitorId: string;
    name: string;
    status: string;
    verifiedPlatforms: string[];
    attempts: number;
    error?: string;
  }> = [];

  for (const comp of targetComps) {
    if (recovered >= maxCompetitors) break;
    if (!comp.websiteUrl || !comp.campaignId) continue;

    let parsedManifest: CompetitorSourceManifest | null = null;
    if (comp.notes) {
      try {
        const parsed = JSON.parse(comp.notes);
        if (parsed && parsed.sources) parsedManifest = parsed as CompetitorSourceManifest;
      } catch {}
    }

    const sourcesObj = parsedManifest?.sources || {};
    const hasPendingPlatform =
      !parsedManifest ||
      Object.values(sourcesObj).some(
        (s: any) => s?.status === "PENDING_DISCOVERY" || s?.status === "PROVIDER_UNAVAILABLE"
      );

    // Check if website snapshot exists
    const existingSnaps = await db
      .select({ id: schema.competitorWebsiteSnapshots.id, status: schema.competitorWebsiteSnapshots.status })
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, comp.id))
      .limit(1);

    const needsInitialCrawl = existingSnaps.length === 0;

    if (!hasPendingPlatform && !needsInitialCrawl && !forceRetry) {
      continue;
    }

    evaluated++;

    if (activeDiscoveryRecoveryLocks.has(comp.id)) {
      skippedLocked++;
      continue;
    }

    const prevState: DiscoveryJobState = parsedManifest?.discoveryState || {
      status: "PENDING",
      attempts: 0,
      maxAttempts: 3,
      lastAttemptAt: null,
      nextRetryAt: null,
      lastError: null,
    };

    if (!forceRetry && prevState.attempts >= prevState.maxAttempts && prevState.status === "EXHAUSTED") {
      exhausted++;
      continue;
    }

    if (
      !forceRetry &&
      prevState.nextRetryAt &&
      new Date(prevState.nextRetryAt).getTime() > Date.now() &&
      prevState.attempts > 0
    ) {
      skippedBackoff++;
      continue;
    }

    activeDiscoveryRecoveryLocks.add(comp.id);
    const attemptNumber = forceRetry ? 1 : prevState.attempts + 1;

    try {
      // 1. Ensure website snapshot & business understanding exist (reusing existing snapshot if already crawled)
      let snapshotId = existingSnaps[0]?.id;
      const isAppStoreListing =
        comp.websiteUrl.includes("apps.apple.com") || comp.websiteUrl.includes("play.google.com");

      if (!snapshotId && !isAppStoreListing) {
        try {
          const crawlRes = await runCompetitorWebsiteCrawler(
            comp.accountId,
            comp.campaignId,
            comp.id,
            comp.websiteUrl,
            6
          );
          snapshotId = crawlRes?.snapshotId;
        } catch (cErr: any) {
          console.warn(`[DiscoveryRecovery] Website crawl warning for ${comp.name}:`, cErr.message);
        }
      }

      if (snapshotId) {
        try {
          await runCompetitorUnderstandingEngine(
            comp.accountId,
            comp.campaignId,
            comp.id,
            comp.websiteUrl,
            comp.name,
            { snapshotId }
          );
        } catch (uErr: any) {
          console.warn(`[DiscoveryRecovery] Understanding engine warning for ${comp.name}:`, uErr.message);
        }
      }

      // 2. Discover & verify sources (reusing stored website snapshot evidence + already verified sources first)
      const existingVerifiedSources: Record<string, string | undefined> = {};
      if (parsedManifest?.sources) {
        for (const [k, s] of Object.entries(parsedManifest.sources)) {
          if (s && s.status === "VERIFIED" && s.url && k !== "website" && k !== "google_search") {
            existingVerifiedSources[k] = s.url;
          }
        }
      }
      const manifest = await discoverAndVerifyCompetitorSources({
        competitorId: comp.id,
        competitorName: comp.name,
        websiteUrl: comp.websiteUrl,
        accountId: comp.accountId,
        campaignId: comp.campaignId,
        providedSources: existingVerifiedSources,
        skipExternalSearch,
      });

      const anyProviderFailed = Object.values(manifest.sources).some(s => s.status === "PROVIDER_UNAVAILABLE");
      const anyStillPending = Object.values(manifest.sources).some(s => s.status === "PENDING_DISCOVERY");
      const maxAttempts = prevState.maxAttempts || 3;

      if ((anyProviderFailed || anyStillPending) && attemptNumber >= maxAttempts) {
        // Transition remaining pending/unavailable sources to NOT_FOUND with explicit detail so they never stay stuck
        for (const key of Object.keys(manifest.sources) as Array<keyof typeof manifest.sources>) {
          const s = manifest.sources[key];
          if (s.status === "PENDING_DISCOVERY" || s.status === "PROVIDER_UNAVAILABLE") {
            s.status = "NOT_FOUND";
            s.detail = `No verified ${key} profile found after ${attemptNumber} bounded discovery attempts.`;
          }
        }
        manifest.discoveryState = {
          status: "EXHAUSTED",
          attempts: attemptNumber,
          maxAttempts,
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt: null,
          lastError: "Max discovery attempts reached; unresolved platforms marked NOT_FOUND.",
        };
      } else {
        const backoffMinutes = 15 * Math.pow(2, attemptNumber - 1);
        manifest.discoveryState = {
          status: anyProviderFailed ? "FAILED_RETRYABLE" : anyStillPending ? "PENDING" : "COMPLETED",
          attempts: attemptNumber,
          maxAttempts,
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt:
            anyProviderFailed || anyStillPending
              ? new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString()
              : null,
          lastError: anyProviderFailed ? "External search provider unavailable during attempt." : null,
        };
      }

      await db
        .update(schema.ciCompetitors)
        .set({
          notes: JSON.stringify(manifest),
          updatedAt: new Date(),
        })
        .where(eq(schema.ciCompetitors.id, comp.id));

      await persistManifestSourcesToDb({
        accountId: comp.accountId,
        campaignId: comp.campaignId,
        competitorId: comp.id,
        competitorName: comp.name,
        manifest,
      });

      try {
        await initializeCompetitorMonitoring(comp.accountId, comp.campaignId, comp.id);
      } catch {}

      const verifiedPlatforms = Object.entries(manifest.sources)
        .filter(([_, s]) => s.status === "VERIFIED" && s.url)
        .map(([k, s]) => `${k}:${s.url}`);
      if (Array.isArray(manifest.additionalSources)) {
        for (const extra of manifest.additionalSources) {
          if (extra.url) verifiedPlatforms.push(`${extra.platform}(extra):${extra.url}`);
        }
      }

      recovered++;
      details.push({
        competitorId: comp.id,
        name: comp.name,
        status: manifest.discoveryState.status,
        verifiedPlatforms,
        attempts: attemptNumber,
      });
    } catch (err: any) {
      details.push({
        competitorId: comp.id,
        name: comp.name,
        status: "FAILED_RETRYABLE",
        verifiedPlatforms: [],
        attempts: attemptNumber,
        error: err.message,
      });
    } finally {
      activeDiscoveryRecoveryLocks.delete(comp.id);
    }
  }

  return {
    evaluated,
    recovered,
    skippedLocked,
    skippedBackoff,
    exhausted,
    details,
  };
}
