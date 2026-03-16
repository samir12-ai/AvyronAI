import { getProxyConfig } from "../competitive-intelligence/proxy-pool-manager";
import type { WebsiteExtraction, BlogExtraction } from "./source-types";

const SCRAPE_TIMEOUT_MS = 30000;
const MAX_PAGES_PER_SITE = 6;
const MAX_TEXT_PREVIEW = 3000;
const STALE_THRESHOLD_DAYS = 7;

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal",
  "169.254.169.254", "metadata", "kubernetes.default",
]);

function validateScrapeUrl(rawUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs allowed");
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked hostname");
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|fc|fd|fe80)/i.test(host)) throw new Error("Private network address blocked");
  if (host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Internal hostname blocked");
  return parsed.toString();
}

interface FetchOptions {
  url: string;
  timeoutMs?: number;
}

async function fetchWithProxy(opts: FetchOptions): Promise<{ html: string; status: number; ok: boolean }> {
  const proxy = getProxyConfig();
  const timeout = opts.timeoutMs || SCRAPE_TIMEOUT_MS;

  const baseHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
  };

  if (proxy) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const { ProxyAgent } = await import("undici");
      const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
      const res = await fetch(opts.url, {
        headers: baseHeaders,
        signal: controller.signal,
        redirect: "follow",
        dispatcher: new ProxyAgent(proxyUrl),
      } as any);
      const html = await res.text();
      return { html, status: res.status, ok: res.ok };
    } catch (proxyErr: any) {
      const isConnectError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|tunnel|socket|proxy/i.test(
        proxyErr.message + (proxyErr.cause?.message || "")
      );
      if (!isConnectError) throw proxyErr;
      console.log(`[WebScraper] Proxy connection failed for ${opts.url}: ${proxyErr.message} — falling back to direct fetch`);
    } finally {
      clearTimeout(timer);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(opts.url, {
      headers: baseHeaders,
      signal: controller.signal,
      redirect: "follow",
    });
    const html = await res.text();
    return { html, status: res.status, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

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
      const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) results.push(text);
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
      const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) results.push(text);
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
      const text = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (text.length > 5) results.push(text);
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

function discoverSubPages(baseUrl: string, html: string): string[] {
  const linkRegex = /href="([^"]*?)"/gi;
  const base = new URL(baseUrl);
  const targetPaths = [/\/pric/i, /\/feature/i, /\/service/i, /\/about/i, /\/solution/i];
  const discovered: string[] = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null && discovered.length < MAX_PAGES_PER_SITE) {
    try {
      const href = match[1];
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

      let fullUrl: string;
      if (href.startsWith("http")) {
        const parsed = new URL(href);
        if (parsed.hostname !== base.hostname) continue;
        fullUrl = href;
      } else if (href.startsWith("/")) {
        const resolved = new URL(href, base.origin);
        if (resolved.hostname !== base.hostname) continue;
        fullUrl = resolved.toString();
      } else {
        continue;
      }

      for (const pattern of targetPaths) {
        if (pattern.test(fullUrl) && !discovered.includes(fullUrl)) {
          discovered.push(fullUrl);
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return discovered.slice(0, MAX_PAGES_PER_SITE - 1);
}

export async function scrapeWebsite(
  competitorId: string,
  competitorName: string,
  websiteUrl: string,
): Promise<WebsiteExtraction[]> {
  const results: WebsiteExtraction[] = [];
  const now = new Date().toISOString();

  let normalizedUrl = websiteUrl.trim();
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  normalizedUrl = validateScrapeUrl(normalizedUrl);

  console.log(`[WebScraper] Starting structured extraction for ${competitorName}: ${normalizedUrl}`);

  try {
    const homeResult = await fetchWithProxy({ url: normalizedUrl });
    if (!homeResult.ok) {
      console.log(`[WebScraper] Homepage fetch failed: HTTP ${homeResult.status}`);
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
        extractionError: `HTTP ${homeResult.status}`,
        scrapedAt: now,
      }];
    }

    const homeExtraction = extractPage(competitorId, competitorName, normalizedUrl, homeResult.html, now);
    results.push(homeExtraction);

    const subPages = discoverSubPages(normalizedUrl, homeResult.html);
    console.log(`[WebScraper] Discovered ${subPages.length} sub-pages for ${competitorName}`);

    for (const pageUrl of subPages) {
      try {
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        const pageResult = await fetchWithProxy({ url: pageUrl });
        if (pageResult.ok) {
          results.push(extractPage(competitorId, competitorName, pageUrl, pageResult.html, now));
        }
      } catch (err: any) {
        console.log(`[WebScraper] Sub-page fetch failed for ${pageUrl}: ${err.message}`);
      }
    }

    console.log(`[WebScraper] Extracted ${results.length} pages for ${competitorName}`);
    return results;
  } catch (err: any) {
    console.log(`[WebScraper] Critical failure for ${competitorName}: ${err.message}`);
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
      extractionError: err.message,
      scrapedAt: now,
    }];
  }
}

function extractPage(
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

export async function scrapeBlog(
  competitorId: string,
  competitorName: string,
  blogUrl: string,
): Promise<BlogExtraction> {
  const now = new Date().toISOString();
  let normalizedUrl = blogUrl.trim();
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  normalizedUrl = validateScrapeUrl(normalizedUrl);

  console.log(`[WebScraper] Blog extraction for ${competitorName}: ${normalizedUrl}`);

  try {
    const result = await fetchWithProxy({ url: normalizedUrl });
    if (!result.ok) {
      return {
        competitorId,
        competitorName,
        sourceUrl: normalizedUrl,
        topicTitles: [],
        contentHeadings: [],
        categories: [],
        educationalThemes: [],
        rawTextPreview: "",
        extractionStatus: "FAILED",
        extractionError: `HTTP ${result.status}`,
        scrapedAt: now,
      };
    }

    const h2s = extractByTag(result.html, "h2", 20);
    const h3s = extractByTag(result.html, "h3", 20);

    const categoryRegex = /<a[^>]*class="[^"]*(?:category|tag|topic)[^"]*"[^>]*>([^<]+)<\/a>/gi;
    const categories: string[] = [];
    let m;
    while ((m = categoryRegex.exec(result.html)) !== null && categories.length < 15) {
      categories.push(m[1].trim());
    }

    const educationalThemes = h2s
      .filter(h => /how|why|what|guide|tips|step|learn|understand|mistake|avoid/i.test(h))
      .slice(0, 15);

    return {
      competitorId,
      competitorName,
      sourceUrl: normalizedUrl,
      topicTitles: h2s,
      contentHeadings: h3s,
      categories: [...new Set(categories)],
      educationalThemes,
      rawTextPreview: extractTextContent(result.html),
      extractionStatus: "COMPLETE",
      scrapedAt: now,
    };
  } catch (err: any) {
    console.log(`[WebScraper] Blog extraction failed for ${competitorName}: ${err.message}`);
    return {
      competitorId,
      competitorName,
      sourceUrl: normalizedUrl,
      topicTitles: [],
      contentHeadings: [],
      categories: [],
      educationalThemes: [],
      rawTextPreview: "",
      extractionStatus: "FAILED",
      extractionError: err.message,
      scrapedAt: now,
    };
  }
}

export function isWebDataStale(scrapedAt: Date | string | null): boolean {
  if (!scrapedAt) return true;
  const age = (Date.now() - new Date(scrapedAt).getTime()) / (1000 * 60 * 60 * 24);
  return age > STALE_THRESHOLD_DAYS;
}
