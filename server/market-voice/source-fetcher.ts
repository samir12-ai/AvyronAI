import {
  type MarketVoiceDiscoveryResult,
} from "@shared/schema";
import {
  type FetchedSourceResult,
  type FetchedContentItem,
  type FetchExecutionStatus,
} from "@shared/contracts/market-voice";
import { normalizeCanonicalUrl } from "./provider-router";
import { fetchRedditThread } from "./reddit-adapter";

/**
 * Clean and strip HTML tags while preserving block-level paragraph and sentence boundaries.
 */
export function cleanHtmlToText(html: string): string {
  if (!html) return "";

  return html
    // 1. Remove non-content structural elements
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<nav\b[^<]*>([\s\S]*?)<\/nav>/gi, "")
    .replace(/<header\b[^<]*>([\s\S]*?)<\/header>/gi, "")
    .replace(/<footer\b[^<]*>([\s\S]*?)<\/footer>/gi, "")
    .replace(/<aside\b[^<]*>([\s\S]*?)<\/aside>/gi, "")
    .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "")
    .replace(/<noscript\b[^<]*>([\s\S]*?)<\/noscript>/gi, "")
    .replace(/<iframe\b[^<]*>([\s\S]*?)<\/iframe>/gi, "")
    // 2. Replace block elements with double newlines
    .replace(/<\/(p|div|h[1-6]|li|blockquote|article|section|tr|td|table|header|footer)>/gi, "\n\n")
    .replace(/<(p|div|h[1-6]|li|blockquote|article|section|tr|td|table|header|footer)\b[^>]*>/gi, "\n\n")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<hr\s*[\/]?>/gi, "\n\n")
    // 3. Strip all remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // 4. Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    // 5. Normalize whitespace while PRESERVING newlines
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits extracted clean text into bounded, structurally intact content chunks.
 * Never drops long valid text blocks solely because of total page or paragraph length.
 */
export function chunkTextBlocks(
  text: string,
  maxChunkChars: number = 1000,
  minChunkChars: number = 30
): string[] {
  if (!text || text.trim().length < minChunkChars) return [];

  const rawBlocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length >= minChunkChars);

  const chunks: string[] = [];

  for (const block of rawBlocks) {
    if (block.length <= maxChunkChars) {
      chunks.push(block);
      continue;
    }

    // Paragraph is longer than maxChunkChars -> split on sentence boundaries
    const sentences = block.split(/(?<=[.?!])\s+/);
    let currentChunk = "";

    for (const sentence of sentences) {
      if ((currentChunk + " " + sentence).trim().length <= maxChunkChars) {
        currentChunk = (currentChunk + " " + sentence).trim();
      } else {
        if (currentChunk.length >= minChunkChars) {
          chunks.push(currentChunk);
        }
        currentChunk = sentence.trim();
      }
    }

    if (currentChunk.length >= minChunkChars) {
      chunks.push(currentChunk);
    } else if (currentChunk.length > 0 && chunks.length > 0) {
      // Append leftover short sentence to previous chunk if within bounds
      const last = chunks[chunks.length - 1];
      if ((last + " " + currentChunk).length <= maxChunkChars * 1.2) {
        chunks[chunks.length - 1] = (last + " " + currentChunk).trim();
      } else {
        chunks.push(currentChunk);
      }
    }
  }

  return chunks;
}

/**
 * Extracts structured customer reviews and Q&A from application/ld+json scripts before stripping tags.
 */
export function extractJsonLdReviewsAndQA(html: string): string[] {
  const extracted: string[] = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item["@type"] === "Review" && item.reviewBody) {
          extracted.push(item.reviewBody.trim());
        } else if (Array.isArray(item.review)) {
          for (const rev of item.review) {
            if (rev && rev.reviewBody) extracted.push(rev.reviewBody.trim());
          }
        } else if (item["@type"] === "Question" && (item.text || item.name)) {
          const qText = item.text || item.name;
          const aText = item.acceptedAnswer?.text || item.suggestedAnswer?.text;
          if (qText) extracted.push(aText ? `Q: ${qText}\nA: ${aText}` : qText);
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }
  return extracted;
}

/**
 * Fetches real destination source content for a persisted discovery result.
 * 
 * Rules:
 * 1. NEVER treat search snippets or titles as evidence.
 * 2. Fetch destination content directly.
 * 3. Extract individual comments, posts, and review items.
 * 4. Handle provider/walled-garden capability mismatches honestly.
 */
export async function fetchSourceContent(
  result: MarketVoiceDiscoveryResult,
  options: { timeoutMs?: number; customFetch?: typeof fetch } = {}
): Promise<FetchedSourceResult> {
  const timeoutMs = options.timeoutMs || 15000;
  const fetchFn = options.customFetch || fetch;
  const rawUrl = result.url || result.canonicalUrl;
  const canonicalUrl = normalizeCanonicalUrl(rawUrl);

  // 1. Reddit Destinations
  if (canonicalUrl.includes("reddit.com/r/")) {
    return fetchRedditSource(result, canonicalUrl, timeoutMs);
  }

  // 2. Trustpilot Review Destinations
  if (canonicalUrl.includes("trustpilot.com/review/") || canonicalUrl.includes("trustpilot.com/")) {
    return fetchTrustpilotSource(result, canonicalUrl, timeoutMs);
  }

  // 3. Google Maps / Place Review Destinations
  if (canonicalUrl.includes("google.com/maps/place") || canonicalUrl.includes("maps.google.com/")) {
    return fetchGoogleReviewsSource(result, canonicalUrl, timeoutMs);
  }

  // 4. Walled Garden Social Destinations without native page scraper (Instagram, TikTok, Pinterest)
  if (
    canonicalUrl.includes("instagram.com/") ||
    canonicalUrl.includes("tiktok.com/") ||
    canonicalUrl.includes("pinterest.com/")
  ) {
    const metadata: any = result.metadata || {};
    if (metadata.rawPostText || metadata.caption) {
      const text = metadata.rawPostText || metadata.caption;
      return {
        discoveryResultId: result.id,
        url: rawUrl,
        canonicalUrl,
        sourcePlatform: result.sourcePlatform,
        fetchStatus: "FETCHED",
        pageTitle: result.title || "",
        contentItems: [
          {
            itemId: result.externalItemId || canonicalUrl,
            sourceUrl: canonicalUrl,
            sourcePlatform: result.sourcePlatform,
            verbatimText: text,
            authorIdentifier: result.metadata?.author || null,
            publishedAt: result.createdAt ? new Date(result.createdAt) : null,
          },
        ],
      };
    }

    return {
      discoveryResultId: result.id,
      url: rawUrl,
      canonicalUrl,
      sourcePlatform: result.sourcePlatform,
      fetchStatus: "FETCH_CAPABILITY_MISSING",
      contentItems: [],
      error: `Destination on ${canonicalUrl} requires authenticated app/scraper session.`,
    };
  }

  // 5. Open Web / Forums / Static Pages / Google Destination URLs
  return fetchWebSource(result, canonicalUrl, timeoutMs, fetchFn);
}

/**
 * Fetches Reddit thread and individual comments using the canonical Reddit adapter.
 */
async function fetchRedditSource(
  result: MarketVoiceDiscoveryResult,
  canonicalUrl: string,
  timeoutMs: number
): Promise<FetchedSourceResult> {
  const threadBudgetMs = Math.max(timeoutMs, 60000);
  const threadRes = await fetchRedditThread(canonicalUrl, 25, threadBudgetMs);

  return {
    discoveryResultId: result.id,
    url: result.url,
    canonicalUrl,
    sourcePlatform: "reddit",
    fetchStatus: threadRes.fetchStatus,
    pageTitle: threadRes.postTitle || result.title || "",
    contentItems: threadRes.contentItems,
    error: threadRes.error || null,
  };
}

/**
 * Fetches Trustpilot review destinations using the canonical Trustpilot Apify provider.
 */
async function fetchTrustpilotSource(
  result: MarketVoiceDiscoveryResult,
  canonicalUrl: string,
  timeoutMs: number
): Promise<FetchedSourceResult> {
  try {
    const { fetchReviewsViaApify } = await import("../acquisition/multi-source-providers");
    const budgetMs = Math.max(timeoutMs, 60000);
    const resp = await fetchReviewsViaApify({
      targetUrl: canonicalUrl,
      platformType: "trustpilot",
      campaignId: result.campaignId,
      accountId: result.accountId,
      maxReviews: 25,
      budgetMs,
    });

    if (resp.report.error && resp.reviews.length === 0) {
      return {
        discoveryResultId: result.id,
        url: result.url,
        canonicalUrl,
        sourcePlatform: "trustpilot",
        fetchStatus: "FETCH_FAILED",
        contentItems: [],
        error: resp.report.error,
      };
    }

    const contentItems: FetchedContentItem[] = resp.reviews.map((r, idx) => ({
      itemId: `tp_${idx + 1}_${canonicalUrl.slice(-10)}`,
      sourceUrl: canonicalUrl,
      sourcePlatform: "trustpilot",
      verbatimText: r.text,
      authorIdentifier: r.authorName || null,
      publishedAt: r.time ? new Date(r.time * 1000) : (result.createdAt ? new Date(result.createdAt) : null),
      likesCount: r.rating || 5,
    }));

    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: "trustpilot",
      fetchStatus: contentItems.length > 0 ? "FETCHED" : "SOURCE_UNAVAILABLE",
      pageTitle: result.title || "Trustpilot Reviews",
      contentItems,
    };
  } catch (err: any) {
    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: "trustpilot",
      fetchStatus: "FETCH_FAILED",
      contentItems: [],
      error: err.message || "Failed to fetch Trustpilot reviews via Apify",
    };
  }
}

/**
 * Fetches Google Maps / Place review destinations using the canonical Google Reviews Apify provider.
 */
async function fetchGoogleReviewsSource(
  result: MarketVoiceDiscoveryResult,
  canonicalUrl: string,
  timeoutMs: number
): Promise<FetchedSourceResult> {
  try {
    const { fetchReviewsViaApify } = await import("../acquisition/multi-source-providers");
    const budgetMs = Math.max(timeoutMs, 60000);
    const resp = await fetchReviewsViaApify({
      targetUrl: canonicalUrl,
      platformType: "google_maps",
      campaignId: result.campaignId,
      accountId: result.accountId,
      maxReviews: 25,
      budgetMs,
    });

    if (resp.report.error && resp.reviews.length === 0) {
      return {
        discoveryResultId: result.id,
        url: result.url,
        canonicalUrl,
        sourcePlatform: "google_maps",
        fetchStatus: "FETCH_FAILED",
        contentItems: [],
        error: resp.report.error,
      };
    }

    const contentItems: FetchedContentItem[] = resp.reviews.map((r, idx) => ({
      itemId: `gmaps_${idx + 1}_${canonicalUrl.slice(-10)}`,
      sourceUrl: canonicalUrl,
      sourcePlatform: "google_maps",
      verbatimText: r.text,
      authorIdentifier: r.authorName || null,
      publishedAt: r.time ? new Date(r.time * 1000) : (result.createdAt ? new Date(result.createdAt) : null),
      likesCount: r.rating || 5,
    }));

    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: "google_maps",
      fetchStatus: contentItems.length > 0 ? "FETCHED" : "SOURCE_UNAVAILABLE",
      pageTitle: result.title || "Google Reviews",
      contentItems,
    };
  } catch (err: any) {
    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: "google_maps",
      fetchStatus: "FETCH_FAILED",
      contentItems: [],
      error: err.message || "Failed to fetch Google Reviews via Apify",
    };
  }
}

/**
 * Fetches Open Web HTML pages (Forums, Articles, Reviews, E-Commerce, Q&A).
 */
async function fetchWebSource(
  result: MarketVoiceDiscoveryResult,
  canonicalUrl: string,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<FetchedSourceResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetchFn(canonicalUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AvyronMarketVoice/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return {
        discoveryResultId: result.id,
        url: result.url,
        canonicalUrl,
        sourcePlatform: result.sourcePlatform,
        fetchStatus: "FETCH_FAILED",
        contentItems: [],
        error: `Web server returned HTTP ${resp.status}`,
      };
    }

    const html = await resp.text();
    const text = cleanHtmlToText(html);

    if (!text || text.length < 50) {
      return {
        discoveryResultId: result.id,
        url: result.url,
        canonicalUrl,
        sourcePlatform: result.sourcePlatform,
        fetchStatus: "SOURCE_UNAVAILABLE",
        rawHtml: html.slice(0, 1000),
        contentItems: [],
        error: "Page returned insufficient text content.",
      };
    }

    // Extract title
    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? cleanHtmlToText(titleMatch[1]) : result.title || "";

    const contentItems: FetchedContentItem[] = [];

    // Extract structured JSON-LD reviews and Q&A where present
    const jsonLdItems = extractJsonLdReviewsAndQA(html);
    for (let i = 0; i < Math.min(jsonLdItems.length, 10); i++) {
      contentItems.push({
        itemId: `jsonld_${i + 1}_${canonicalUrl.slice(-10)}`,
        sourceUrl: canonicalUrl,
        sourcePlatform: result.sourcePlatform,
        verbatimText: jsonLdItems[i],
        authorIdentifier: null,
        publishedAt: result.createdAt ? new Date(result.createdAt) : null,
      });
    }

    const chunks = chunkTextBlocks(text, 1000, 30);

    for (let i = 0; i < Math.min(chunks.length, 15); i++) {
      contentItems.push({
        itemId: `web_${i + 1}_${canonicalUrl.slice(-10)}`,
        sourceUrl: canonicalUrl,
        sourcePlatform: result.sourcePlatform,
        verbatimText: chunks[i],
        authorIdentifier: null,
        publishedAt: result.createdAt ? new Date(result.createdAt) : null,
      });
    }

    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: result.sourcePlatform,
      fetchStatus: contentItems.length > 0 ? "FETCHED" : "SOURCE_UNAVAILABLE",
      rawHtml: html.slice(0, 2000),
      pageTitle,
      contentItems,
    };
  } catch (err: any) {
    return {
      discoveryResultId: result.id,
      url: result.url,
      canonicalUrl,
      sourcePlatform: result.sourcePlatform,
      fetchStatus: "FETCH_FAILED",
      contentItems: [],
      error: err.message || "Failed to fetch web source destination",
    };
  }
}
