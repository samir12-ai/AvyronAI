/**
 * Website/blog acquisition — PROVIDER_PENDING (P-6.12, 2026-07-28).
 *
 * HISTORY: this module used to fetch competitor/user websites through the
 * Bright Data Unlocker (poolFetch, breaker-gated, host-keyed backoff).
 * P-6.12 retired Bright Data entirely; no Apify actor has been selected and
 * live-verified for generic website fetch yet, so this surface fails fast
 * with a machine-readable PROVIDER_PENDING extraction result (see
 * server/acquisition/pending-providers, env slot WEBSITE_SCRAPER_ACTOR_ID).
 * Truthful degradation: extractionStatus="FAILED" with an explicit error —
 * downstream MI treats it exactly like an unreachable site, and NOTHING
 * fabricates page content.
 *
 * Preserved for the future actor integration:
 *  - Seal #5 / F7.2 — the SSRF gate (scrape-safety.resolveSafeUrl) still runs
 *    before anything else, so internal/unsafe URLs are refused even while the
 *    provider is pending (and stay refused when a transport returns).
 *  - The full pure-HTML extraction pipeline (extractPageFromHtml + helpers):
 *    an actor that returns page HTML plugs in directly.
 */
import { resolveSafeUrl } from "../competitive-intelligence/scrape-safety";
import { getWebsiteProviderStatus } from "../acquisition/pending-providers";
import type { WebsiteExtraction, BlogExtraction } from "./source-types";

const MAX_TEXT_PREVIEW = 3000;
const STALE_THRESHOLD_DAYS = 7;

function extractTextContent(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_TEXT_PREVIEW);
}

function extractByTag(html: string, tag: string, limit = 20): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null && results.length < limit) {
    const text = match[1].replace(/&[a-z]+;/gi, " ").trim();
    if (text.length > 3 && text.length < 500) {
      results.push(text);
    }
  }
  return results;
}

function extractHeadlines(html: string): string[] {
  const h1s = extractByTag(html, "h1", 5);
  const h2s = extractByTag(html, "h2", 10);
  return [...h1s, ...h2s];
}

function extractSubheadlines(html: string): string[] {
  return extractByTag(html, "h3", 15);
}

function extractCTALabels(html: string): string[] {
  const buttonRegex = /<button[^>]*>([^<]+)<\/button>/gi;
  const linkCTARegex = /<a[^>]*class="[^"]*(?:btn|cta|button)[^"]*"[^>]*>([^<]+)<\/a>/gi;
  const inputRegex = /<input[^>]*type="submit"[^>]*value="([^"]+)"/gi;

  const results: string[] = [];
  let match;

  while ((match = buttonRegex.exec(html)) !== null && results.length < 15) {
    const text = match[1].trim();
    if (text.length > 1 && text.length < 100) results.push(text);
  }
  while ((match = linkCTARegex.exec(html)) !== null && results.length < 15) {
    const text = match[1].trim();
    if (text.length > 1 && text.length < 100) results.push(text);
  }
  while ((match = inputRegex.exec(html)) !== null && results.length < 15) {
    results.push(match[1].trim());
  }
  return [...new Set(results)];
}

function extractPricingAnchors(html: string): string[] {
  const priceRegex = /(?:\$|USD|€|£)\s?[\d,]+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|year|yr|week))?/gi;
  const results: string[] = [];
  let match;
  while ((match = priceRegex.exec(html)) !== null && results.length < 10) {
    results.push(match[0].trim());
  }
  return results;
}

function extractProofBlocks(html: string): string[] {
  const proofPatterns = [
    /(\d+[,.]?\d*\+?\s*(?:clients?|customers?|users?|businesses?|companies|projects?|brands?))/gi,
    /((?:trusted by|used by|featured in|as seen on|partnered with)[^<.]{5,100})/gi,
    /(\d+\+?\s*(?:years?|months?)\s*(?:experience|in business|of))/gi,
    /((?:certified|accredited|licensed|award)[^<.]{5,80})/gi,
  ];
  const results: string[] = [];
  for (const regex of proofPatterns) {
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 15) {
      const text = sanitizeExtractedText(match[1]);
      if (isCleanText(text)) results.push(text);
    }
  }
  return results;
}

function extractTestimonials(html: string): string[] {
  const testimonialRegex = /<(?:blockquote|div)[^>]*class="[^"]*(?:testimonial|review|quote)[^"]*"[^>]*>([\s\S]*?)<\/(?:blockquote|div)>/gi;
  const quoteRegex = /[""]([^""]{20,300})[""]/g;

  const results: string[] = [];
  let match;
  while ((match = testimonialRegex.exec(html)) !== null && results.length < 10) {
    const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text.length > 20) results.push(text.slice(0, 300));
  }
  if (results.length < 3) {
    while ((match = quoteRegex.exec(html)) !== null && results.length < 10) {
      const text = match[1].trim();
      if (text.length > 30 && text.length < 300) results.push(text);
    }
  }
  return results;
}

function extractGuarantees(html: string): string[] {
  const guaranteePatterns = [
    /((?:money[- ]?back|satisfaction|full refund|risk[- ]?free|no[- ]?risk)[^<.]{5,100})/gi,
    /((?:\d+[- ]?day\s*(?:guarantee|trial|refund))[^<.]{0,80})/gi,
    /((?:free trial|free consultation|free audit|free demo|free assessment)[^<.]{0,60})/gi,
  ];
  const results: string[] = [];
  for (const regex of guaranteePatterns) {
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 10) {
      const text = sanitizeExtractedText(match[1]);
      if (isCleanText(text)) results.push(text);
    }
  }
  return results;
}

function extractFeatureList(html: string): string[] {
  const liRegex = /<li[^>]*>([^<]{5,150})<\/li>/gi;
  const results: string[] = [];
  let match;
  while ((match = liRegex.exec(html)) !== null && results.length < 20) {
    const text = match[1].trim();
    if (text.length > 5) results.push(text);
  }
  return results;
}

function extractNavigationLinks(html: string): string[] {
  const navRegex = /<nav[^>]*>([\s\S]*?)<\/nav>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi;
  const results: string[] = [];
  let match;

  while ((match = navRegex.exec(html)) !== null) {
    let linkMatch;
    while ((linkMatch = linkRegex.exec(match[1])) !== null && results.length < 20) {
      const text = linkMatch[2].trim();
      if (text.length > 1 && text.length < 50) results.push(text);
    }
  }
  return results;
}

function sanitizeExtractedText(raw: string): string {
  return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function isCleanText(text: string): boolean {
  const { sanitizeWebsiteBlock } = require("../shared/text-sanitizer");
  if (text.length <= 5 || text.length >= 200) return false;
  const result = sanitizeWebsiteBlock(text, "general");
  return result.text.length > 0;
}

function extractOfferPhrases(html: string): string[] {
  const offerPatterns = [
    /((?:get started|sign up|book a call|schedule|start your|try for free|get your|claim your)[^<.]{0,80})/gi,
    /((?:limited time|exclusive|special offer|bonus|discount|save \d+%)[^<.]{0,80})/gi,
    /((?:everything you need|all[- ]in[- ]one|complete solution|done[- ]for[- ]you)[^<.]{0,80})/gi,
  ];
  const results: string[] = [];
  for (const regex of offerPatterns) {
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 15) {
      const text = sanitizeExtractedText(match[1]);
      if (isCleanText(text)) results.push(text);
    }
  }
  return results;
}

function detectPageType(url: string, html: string): WebsiteExtraction["pageType"] {
  const lowerUrl = url.toLowerCase();
  if (/\/pric/i.test(lowerUrl)) return "pricing";
  if (/\/feature|\/service|\/solution/i.test(lowerUrl)) return "features";
  if (/\/about/i.test(lowerUrl)) return "about";
  if (/\/blog/i.test(lowerUrl)) return "blog_index";
  if (/\/landing|\/lp\//i.test(lowerUrl)) return "landing";

  const lowerHtml = html.slice(0, 5000).toLowerCase();
  if (lowerHtml.includes("pricing") && lowerHtml.includes("plan")) return "pricing";

  return "homepage";
}

/**
 * Pure HTML → structured extraction. This is the piece a future website
 * actor plugs into: fetch HTML however the actor does, then call this.
 */
export function extractPageFromHtml(
  competitorId: string,
  competitorName: string,
  url: string,
  html: string,
  now: string,
): WebsiteExtraction {
  const pageType = detectPageType(url, html);

  return {
    competitorId,
    competitorName,
    sourceUrl: url,
    pageType,
    headlines: extractHeadlines(html),
    subheadlines: extractSubheadlines(html),
    ctaLabels: extractCTALabels(html),
    offerPhrases: extractOfferPhrases(html),
    pricingAnchors: extractPricingAnchors(html),
    proofBlocks: extractProofBlocks(html),
    testimonialBlocks: extractTestimonials(html),
    guarantees: extractGuarantees(html),
    featureList: extractFeatureList(html),
    navigationLinks: extractNavigationLinks(html),
    topicTitles: extractByTag(html, "h2", 10),
    contentHeadings: extractByTag(html, "h3", 15),
    rawTextPreview: extractTextContent(html),
    extractionStatus: "COMPLETE",
    scrapedAt: now,
  };
}

function providerPendingError(): string {
  const provider = getWebsiteProviderStatus();
  return `PROVIDER_PENDING: website acquisition has no active provider (${provider.envSlot}${provider.actorId ? `=${provider.actorId} — not yet implemented/verified` : " not set"}). ${provider.detail}`;
}

export async function scrapeWebsite(
  competitorId: string,
  competitorName: string,
  websiteUrl: string,
  accountId?: string,
): Promise<WebsiteExtraction[]> {
  const now = new Date().toISOString();

  let normalizedUrl = websiteUrl.trim();
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // F7.2 — SSRF gate stays live while the provider is pending: unsafe/internal
  // URLs are refused with their own error class, not a PROVIDER_PENDING one.
  try {
    await resolveSafeUrl(normalizedUrl);
  } catch (err: any) {
    return [{
      competitorId,
      competitorName,
      sourceUrl: normalizedUrl,
      pageType: "homepage",
      headlines: [],
      subheadlines: [],
      ctaLabels: [],
      offerPhrases: [],
      pricingAnchors: [],
      proofBlocks: [],
      testimonialBlocks: [],
      guarantees: [],
      featureList: [],
      navigationLinks: [],
      topicTitles: [],
      contentHeadings: [],
      rawTextPreview: "",
      extractionStatus: "FAILED",
      extractionError: err?.message ?? String(err),
      scrapedAt: now,
    }];
  }

  const error = providerPendingError();
  console.warn(`[WebScraper] ${error} (url=${normalizedUrl}, competitor=${competitorName})`);
  return [{
    competitorId,
    competitorName,
    sourceUrl: normalizedUrl,
    pageType: "homepage",
    headlines: [],
    subheadlines: [],
    ctaLabels: [],
    offerPhrases: [],
    pricingAnchors: [],
    proofBlocks: [],
    testimonialBlocks: [],
    guarantees: [],
    featureList: [],
    navigationLinks: [],
    topicTitles: [],
    contentHeadings: [],
    rawTextPreview: "",
    extractionStatus: "FAILED",
    extractionError: error,
    scrapedAt: now,
  }];
}

export async function scrapeBlog(
  competitorId: string,
  competitorName: string,
  blogUrl: string,
  accountId?: string,
): Promise<BlogExtraction> {
  const now = new Date().toISOString();
  let normalizedUrl = blogUrl.trim();
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const emptyResult = (extractionError: string): BlogExtraction => ({
    competitorId,
    competitorName,
    sourceUrl: normalizedUrl,
    topicTitles: [],
    contentHeadings: [],
    categories: [],
    educationalThemes: [],
    rawTextPreview: "",
    extractionStatus: "FAILED",
    extractionError,
    scrapedAt: now,
  });

  // F7.2 — SSRF gate stays live while the provider is pending.
  try {
    await resolveSafeUrl(normalizedUrl);
  } catch (err: any) {
    return emptyResult(err?.message ?? String(err));
  }

  const error = providerPendingError();
  console.warn(`[WebScraper] ${error} (blogUrl=${normalizedUrl}, competitor=${competitorName})`);
  return emptyResult(error);
}

export function isWebDataStale(scrapedAt: Date | string | null): boolean {
  if (!scrapedAt) return true;
  const age = (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24);
  return age > STALE_THRESHOLD_DAYS;
}
