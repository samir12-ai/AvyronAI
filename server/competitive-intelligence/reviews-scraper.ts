import { db } from "../db";
import { ciCompetitorReviews, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getScrapingConfig, poolFetch, TargetBackoffActiveError, type PoolFetchTarget } from "./proxy-pool-manager";

// 2026-07 Unlocker rebuild: transport goes through the pool manager's
// poolFetch (Bright Data Unlocker REST API). The Unlocker performs its own
// anti-bot solving server-side, which can legitimately take longer than a
// bare proxied fetch — 60s wall-clock ceiling (BRIGHT_DATA_TIMEOUT_MS
// default) is enforced inside the client. Google Maps pages are heavy, so
// keep a slightly tighter per-request budget here.
const SCRAPE_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

export interface ReviewScrapedResult {
  competitorId: string;
  reviewsFetched: number;
  reviewsInserted: number;
  placeId: string | null;
  error?: string;
}

async function fetchViaUnlocker(url: string, target: PoolFetchTarget): Promise<{ html: string; status: number }> {
  const res = await poolFetch(url, { timeoutMs: SCRAPE_TIMEOUT_MS, target });
  const html = await res.text();
  return { html, status: res.status };
}

interface ExtractedReview {
  text: string;
  rating: number;
  time: number;
  authorName?: string;
}

function extractReviewsFromHTML(html: string): ExtractedReview[] {
  const reviews: ExtractedReview[] = [];

  const windowDataMatch = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[[\s\S]*?\]);\s*(?:window\.|;|<\/script>)/);
  if (windowDataMatch) {
    try {
      const parsed = JSON.parse(windowDataMatch[1]);
      const extracted = extractFromAppInitState(parsed);
      if (extracted.length > 0) return extracted;
    } catch {}
  }

  const pbMatch = html.match(/\["https:\/\/www\.google\.[^"]*\/maps\/preview\/review[\s\S]*?\]\s*\]/g);
  if (pbMatch) {
    for (const block of pbMatch) {
      try {
        const parsed = JSON.parse(`[${block}]`);
        const revs = extractFromPbBlocks(parsed);
        reviews.push(...revs);
      } catch {}
    }
    if (reviews.length > 0) return reviews;
  }

  const jsonBlocks = html.match(/\[\[[\s\S]{50,}?\]\]/g) || [];
  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      const revs = deepExtractReviews(parsed);
      reviews.push(...revs);
    } catch {}
  }

  if (reviews.length === 0) {
    const reviewPatterns = [
      /<span[^>]*class="[^"]*review[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
      /data-review-id="[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi,
    ];

    for (const pattern of reviewPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const text = cleanHtml(match[1]);
        if (text.length > 10 && text.length < 5000) {
          const ratingMatch = html.slice(Math.max(0, match.index - 500), match.index + match[0].length + 200)
            .match(/aria-label="(\d)\s*star/i);
          reviews.push({
            text,
            rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
            time: Math.floor(Date.now() / 1000),
          });
        }
      }
    }
  }

  const seen = new Set<string>();
  return reviews.filter(r => {
    if (r.text.length < 5) return false;
    const key = r.text.slice(0, 100).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractFromAppInitState(data: any[]): ExtractedReview[] {
  const reviews: ExtractedReview[] = [];
  const str = JSON.stringify(data);

  const reviewArrays = findReviewArrays(data, 0);
  for (const arr of reviewArrays) {
    const text = findReviewText(arr);
    const rating = findRating(arr);
    const time = findTimestamp(arr);
    const author = findAuthorName(arr);
    if (text && text.length > 5) {
      reviews.push({ text, rating: rating || 0, time: time || Math.floor(Date.now() / 1000), authorName: author });
    }
  }

  return reviews;
}

function findReviewArrays(data: any, depth: number): any[] {
  if (depth > 12 || !data) return [];
  const results: any[] = [];

  if (Array.isArray(data)) {
    const hasTextLikeField = data.some((item, i) =>
      typeof item === "string" && item.length > 20 && item.length < 5000 && i > 0
    );
    const hasRatingLikeField = data.some(item =>
      typeof item === "number" && item >= 1 && item <= 5
    );

    if (hasTextLikeField && hasRatingLikeField && data.length >= 3) {
      results.push(data);
    }

    for (const item of data) {
      results.push(...findReviewArrays(item, depth + 1));
    }
  }

  return results;
}

function findReviewText(arr: any[]): string | null {
  if (!Array.isArray(arr)) return null;

  for (const item of arr) {
    if (typeof item === "string" && item.length > 20 && item.length < 5000) {
      if (!/^https?:\/\//.test(item) && !/^[A-Z]{2,}$/.test(item) && !/^\d+$/.test(item)) {
        return item.trim();
      }
    }
  }

  for (const item of arr) {
    if (Array.isArray(item)) {
      const found = findReviewText(item);
      if (found) return found;
    }
  }

  return null;
}

function findRating(arr: any[]): number | null {
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    if (typeof item === "number" && item >= 1 && item <= 5 && Number.isInteger(item)) {
      return item;
    }
  }
  for (const item of arr) {
    if (Array.isArray(item)) {
      const found = findRating(item);
      if (found) return found;
    }
  }
  return null;
}

function findTimestamp(arr: any[]): number | null {
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    if (typeof item === "number" && item > 1_000_000_000 && item < 2_000_000_000) {
      return item;
    }
  }
  for (const item of arr) {
    if (Array.isArray(item)) {
      const found = findTimestamp(item);
      if (found) return found;
    }
  }
  return null;
}

function findAuthorName(arr: any[]): string | undefined {
  if (!Array.isArray(arr)) return undefined;
  for (const item of arr) {
    if (typeof item === "string" && item.length > 1 && item.length < 60) {
      if (!/^https?:\/\//.test(item) && !/^\d+$/.test(item) && item.length < 40) {
        return item;
      }
    }
  }
  return undefined;
}

function extractFromPbBlocks(data: any): ExtractedReview[] {
  return deepExtractReviews(data);
}

function deepExtractReviews(data: any, depth = 0): ExtractedReview[] {
  if (depth > 15 || !data) return [];
  const reviews: ExtractedReview[] = [];

  if (Array.isArray(data)) {
    if (data.length >= 3) {
      let textCandidate: string | null = null;
      let ratingCandidate: number | null = null;
      let timeCandidate: number | null = null;

      for (const item of data) {
        if (typeof item === "string" && item.length > 20 && item.length < 5000 && !textCandidate) {
          if (!/^https?:\/\//.test(item)) textCandidate = item;
        }
        if (typeof item === "number" && item >= 1 && item <= 5 && Number.isInteger(item)) {
          ratingCandidate = item;
        }
        if (typeof item === "number" && item > 1_000_000_000 && item < 2_000_000_000) {
          timeCandidate = item;
        }
      }

      if (textCandidate && ratingCandidate) {
        reviews.push({
          text: textCandidate.trim(),
          rating: ratingCandidate,
          time: timeCandidate || Math.floor(Date.now() / 1000),
        });
      }
    }

    for (const item of data) {
      reviews.push(...deepExtractReviews(item, depth + 1));
    }
  }

  return reviews;
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildGoogleMapsSearchUrl(query: string): string {
  const encoded = encodeURIComponent(query + " reviews");
  return `https://www.google.com/maps/search/${encoded}`;
}

function buildGoogleMapsPlaceUrl(placeIdentifier: string): string {
  const encoded = encodeURIComponent(placeIdentifier);
  return `https://www.google.com/maps/place/${encoded}`;
}

function extractPlaceIdFromHtml(html: string): string | null {
  const ftidMatch = html.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  if (ftidMatch) return ftidMatch[0];

  const ludocrIdMatch = html.match(/ludocid[=:](\d+)/);
  if (ludocrIdMatch) return `ludocid:${ludocrIdMatch[1]}`;

  const cidMatch = html.match(/cid[=:](\d+)/);
  if (cidMatch) return `cid:${cidMatch[1]}`;

  return `search_${Date.now()}`;
}

export async function scrapeReviewsForCompetitor(
  competitorId: string,
  accountId: string,
  campaignId: string,
): Promise<ReviewScrapedResult> {
  const result: ReviewScrapedResult = {
    competitorId,
    reviewsFetched: 0,
    reviewsInserted: 0,
    placeId: null,
  };

  if (!getScrapingConfig()) {
    result.error = "SCRAPING_UNCONFIGURED: Bright Data Unlocker API not configured — reviews scraping unavailable. Set BRIGHT_DATA_API_KEY and BRIGHT_DATA_ZONE.";
    console.error(`[ReviewsScraper] ${result.error}`);
    return result;
  }

  try {
    const [competitor] = await db.select({ name: ciCompetitors.name, url: ciCompetitors.profileLink })
      .from(ciCompetitors)
      .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));

    if (!competitor) {
      result.error = `Competitor not found: ${competitorId} (campaignId=${campaignId})`;
      return result;
    }

    const searchQuery = competitor.name || competitor.url || competitorId;
    let reviews: ExtractedReview[] = [];
    let placeId: string | null = null;
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const searchUrl = attempt === 0
          ? buildGoogleMapsSearchUrl(searchQuery)
          : buildGoogleMapsPlaceUrl(searchQuery);

        console.log(`[ReviewsScraper] Attempt ${attempt + 1}/${MAX_RETRIES + 1} for "${searchQuery}" via Unlocker API`);
        // T006 — adaptive backoff identity: search-query-keyed within the
        // reviews pool.
        const { html, status } = await fetchViaUnlocker(searchUrl, {
          accountId,
          platform: "reviews",
          targetKey: searchQuery,
        });

        if (status === 403 || status === 429) {
          lastError = `HTTP ${status} — blocked or rate limited`;
          console.warn(`[ReviewsScraper] ${lastError}, attempt ${attempt + 1}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
          }
          continue;
        }

        if (status !== 200) {
          lastError = `HTTP ${status}`;
          console.warn(`[ReviewsScraper] Unexpected status ${status} for "${searchQuery}"`);
          continue;
        }

        placeId = extractPlaceIdFromHtml(html);
        reviews = extractReviewsFromHTML(html);

        if (reviews.length > 0) {
          console.log(`[ReviewsScraper] Extracted ${reviews.length} reviews for "${searchQuery}" from Google Maps`);
          break;
        }

        lastError = "No reviews found in HTML response";
        console.warn(`[ReviewsScraper] ${lastError} for "${searchQuery}" (html length: ${html.length})`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
      } catch (err: any) {
        // T006 — cooling target cannot recover within this loop; stop early.
        if (err instanceof TargetBackoffActiveError) {
          lastError = err.message;
          console.warn(`[ReviewsScraper] ${err.message} — aborting retry loop for "${searchQuery}"`);
          break;
        }
        const safeMsg = (err.message || "").replace(/\/\/[^@]+@/g, "//***@");
        lastError = safeMsg;
        console.error(`[ReviewsScraper] Proxy fetch error: ${safeMsg}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
      }
    }

    result.placeId = placeId;
    result.reviewsFetched = reviews.length;

    if (reviews.length === 0) {
      result.error = `No reviews extracted after ${MAX_RETRIES + 1} attempts: ${lastError}`;
      return result;
    }

    // Seal #5 / F7.6 — review IDs are sha256(placeId|author|fullText|time)
    // truncated to 16 hex chars. This survives review-text edits made AFTER
    // the previous prefix-based ID was generated (Google reviewers can edit
    // the first 20 chars without changing review identity). Uniqueness comes
    // from the (author + time) tuple in the hash input.
    // Seal #5 / F7.7 — author NAME is never persisted. We store sha256(name)
    // truncated to 12 hex chars (`authorHash`) for dedup + reviewer-pattern
    // analysis. This is one-way; we cannot recover the name.
    const { reviewIdHash, authorHash } = await import("./scrape-safety");
    for (const review of reviews) {
      const reviewId = reviewIdHash(placeId || "unknown", review.authorName || "anonymous", review.text, review.time);
      const existing = await db.select({ id: ciCompetitorReviews.id })
        .from(ciCompetitorReviews)
        .where(sql`${ciCompetitorReviews.competitorId} = ${competitorId} AND ${ciCompetitorReviews.reviewId} = ${reviewId}`)
        .limit(1);

      if (existing.length > 0) continue;

      await db.insert(ciCompetitorReviews).values({
        id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        competitorId,
        accountId,
        campaignId,
        reviewId,
        reviewText: review.text,
        rating: review.rating,
        platform: "google",
        reviewDate: review.time ? new Date(review.time * 1000) : null,
        isSynthetic: false,
        authorHash: review.authorName ? authorHash(review.authorName) : null,
      });
      result.reviewsInserted++;
    }

    console.log(`[ReviewsScraper] competitorId=${competitorId} | fetched=${result.reviewsFetched} | inserted=${result.reviewsInserted} | source=proxy`);
    return result;
  } catch (err: any) {
    const safeMsg = (err.message || "").replace(/\/\/[^@]+@/g, "//***@");
    result.error = safeMsg;
    console.error(`[ReviewsScraper] ERROR competitorId=${competitorId}: ${safeMsg}`);
    return result;
  }
}

export async function scrapeReviewsForCampaign(
  accountId: string,
  campaignId: string,
): Promise<ReviewScrapedResult[]> {
  const competitors = await db.select({ id: ciCompetitors.id })
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  const results: ReviewScrapedResult[] = [];
  for (const comp of competitors) {
    const result = await scrapeReviewsForCompetitor(comp.id, accountId, campaignId);
    results.push(result);
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
  }
  return results;
}
