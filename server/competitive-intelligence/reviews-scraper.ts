/**
 * Google reviews acquisition — PROVIDER_PENDING (P-6.12, 2026-07-28).
 *
 * HISTORY: this module used to fetch Google Maps/SERP pages through the
 * Bright Data Unlocker (poolFetch). That transport is fully retired:
 *  - Raw Google Maps HTML was permanently refused by the provider
 *    (GOOGLE_RAW_HTML_UNSUPPORTED, verified live 2026-07-09).
 *  - The SERP-zone two-step flow (search → knowledge.fid → /reviews?fid=)
 *    required a separate SERP API product that was never provisioned.
 *
 * P-6.12 removed Bright Data entirely. No Apify actor has been selected and
 * live-verified for Google review TEXTS yet, so this surface is in an
 * explicit PROVIDER_PENDING state (see server/acquisition/pending-providers):
 * calls fail fast with a machine-readable error and NOTHING fabricates data.
 *
 * Preserved for the future actor integration:
 *  - persistExtractedReviews() — the full persistence layer with the
 *    Seal #5 / F7.6 (reviewIdHash) and F7.7 (authorHash, no plaintext names)
 *    guarantees intact.
 *  - The SERP JSON parsers + URL builders behind _reviewsSerpTestHooks, so
 *    the live-verification harness keeps exercising the real parser.
 */
import { db } from "../db";
import { ciCompetitorReviews, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getGoogleReviewsProviderStatus } from "../acquisition/pending-providers";

export interface ReviewScrapedResult {
  competitorId: string;
  reviewsFetched: number;
  reviewsInserted: number;
  placeId: string | null;
  error?: string;
}

/**
 * Phase 4 live-verification finding (2026-07-09), retained as the historical
 * record of WHY review-text scraping could not stay on the old transport:
 * Bright Data disabled raw-HTML unlocking for Google domains zone-wide, and
 * parsed brd_json mode carries no review texts. This constant is no longer
 * emitted by any live path (the transport it classified is gone) but remains
 * exported for consumers/tests that reference the error class.
 */
export const GOOGLE_RAW_HTML_UNSUPPORTED =
  "GOOGLE_RAW_HTML_UNSUPPORTED: Bright Data Unlocker refuses raw Google Maps HTML (provider requires parsed brd_json mode, which carries no review texts). Review scraping is unavailable on the current Bright Data product — a SERP API zone is required for review texts.";

export interface ExtractedReview {
  text: string;
  rating: number;
  time: number;
  authorName?: string;
}

function dedupeReviews(reviews: ExtractedReview[]): ExtractedReview[] {
  const seen = new Set<string>();
  return reviews.filter(r => {
    if (r.text.length < 5) return false;
    const key = r.text.slice(0, 100).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

/**
 * Parse a SERP-style parsed-JSON reviews payload. Shapes vary by provider and
 * endpoint, so extract defensively: look for arrays of review-like objects
 * under any key, read the common field aliases, and fall back to the generic
 * deep-walk. Verified/tuned against live SERP output during Phase 4-SERP;
 * retained because a future reviews actor emitting review-object JSON can
 * reuse it directly.
 */
function extractReviewsFromSerpJson(body: string): ExtractedReview[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const reviews: ExtractedReview[] = [];
  for (const rv of collectSerpReviewObjects(parsed, 0)) {
    const textRaw = rv.review_text ?? rv.text ?? rv.snippet ?? rv.comment ?? rv.body ?? rv.review;
    if (typeof textRaw !== "string" || textRaw.trim().length < 5) continue;

    const ratingRaw = rv.rating ?? rv.stars ?? rv.score ?? rv.star_rating;
    let rating = 0;
    if (typeof ratingRaw === "number") rating = Math.round(ratingRaw);
    else if (typeof ratingRaw === "string") rating = Math.round(parseFloat(ratingRaw)) || 0;

    const authorRaw =
      rv.author_name ?? rv.author ?? rv.name ?? rv.user_name ??
      (rv.user && typeof rv.user === "object" ? (rv.user as any).name : undefined);
    const authorName = typeof authorRaw === "string" && authorRaw.length < 120 ? authorRaw : undefined;

    const dateRaw =
      rv.iso_date ?? rv.date ?? rv.review_datetime_utc ?? rv.review_date ?? rv.time ?? rv.timestamp;

    reviews.push({ text: textRaw.trim(), rating, time: coerceReviewTime(dateRaw), authorName });
  }

  if (reviews.length > 0) return dedupeReviews(reviews);
  // Unknown nesting — fall back to the numeric-array heuristic walker.
  return dedupeReviews(deepExtractReviews(parsed));
}

/** Walk parsed SERP JSON collecting plain objects that look like a review. */
function collectSerpReviewObjects(data: unknown, depth: number): Record<string, any>[] {
  if (depth > 8 || !data || typeof data !== "object") return [];
  const out: Record<string, any>[] = [];

  if (Array.isArray(data)) {
    for (const item of data) out.push(...collectSerpReviewObjects(item, depth + 1));
    return out;
  }

  const obj = data as Record<string, any>;
  const hasText =
    typeof obj.review_text === "string" || typeof obj.snippet === "string" ||
    typeof obj.comment === "string" ||
    (typeof obj.text === "string" && ("rating" in obj || "stars" in obj || "score" in obj));
  if (hasText) out.push(obj);

  for (const key of Object.keys(obj)) out.push(...collectSerpReviewObjects(obj[key], depth + 1));
  return out;
}

/** Coerce a SERP date field (ISO string | epoch s | epoch ms) to epoch seconds. */
function coerceReviewTime(raw: unknown): number {
  if (typeof raw === "number") {
    if (raw > 1_000_000_000 && raw < 2_000_000_000) return raw;
    if (raw >= 1_000_000_000_000) return Math.floor(raw / 1000);
  }
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * SERP-style Google search URL (parsed-JSON mode). Retained for the test
 * harness; no live transport calls this anymore.
 */
function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1`;
}

/**
 * SERP-style Google reviews endpoint URL. `fid` (Feature ID) comes from a
 * prior search's `knowledge.fid`. Retained for the test harness; no live
 * transport calls this anymore.
 */
function buildGoogleReviewsUrl(fid: string, opts?: { hl?: string; sort?: string }): string {
  const hl = opts?.hl ?? "en";
  const sort = opts?.sort ?? "newestFirst";
  return `https://www.google.com/reviews?fid=${encodeURIComponent(fid)}&brd_json=1&hl=${hl}&sort=${sort}`;
}

/** Google Feature ID shape: `0x<hex>:0x<hex>`. */
const FID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

/**
 * Read the business Feature ID from a parsed SERP *search* response —
 * `knowledge.fid`, falling back to the local-pack `organic[0].fid`. Returns
 * null when neither is present (truthful degradation, no fabrication).
 */
function extractFidFromSerpSearch(body: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const kFid = parsed?.knowledge?.fid;
  if (typeof kFid === "string" && FID_RE.test(kFid)) return kFid;
  const oFid = Array.isArray(parsed?.organic) ? parsed.organic[0]?.fid : undefined;
  if (typeof oFid === "string" && FID_RE.test(oFid)) return oFid;
  return null;
}

/**
 * Persistence layer for extracted reviews — the piece a future reviews actor
 * plugs into. Guarantees preserved:
 *   Seal #5 / F7.6 — review IDs are sha256(placeId|author|fullText|time)
 *   truncated to 16 hex chars (survives review-text edits; uniqueness from
 *   the author+time tuple).
 *   Seal #5 / F7.7 — author NAME is never persisted; only sha256(name)
 *   truncated to 12 hex chars (`authorHash`) for dedup/pattern analysis.
 */
export async function persistExtractedReviews(
  competitorId: string,
  accountId: string,
  campaignId: string,
  placeId: string | null,
  reviews: ExtractedReview[],
): Promise<number> {
  const { reviewIdHash, authorHash } = await import("./scrape-safety");
  let inserted = 0;
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
    inserted++;
  }
  return inserted;
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

  // Ownership scoping stays live even while the provider is pending — a
  // caller probing another tenant's competitor still gets "not found".
  const [competitor] = await db.select({ name: ciCompetitors.name, url: ciCompetitors.profileLink })
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));

  if (!competitor) {
    result.error = `Competitor not found: ${competitorId} (campaignId=${campaignId})`;
    return result;
  }

  // P-6.12 — Bright Data retired; no verified Apify actor for Google review
  // texts yet. Fail fast with a machine-readable class (B4 — explicit
  // classification over hidden ambiguity). No fabrication, no silent empty.
  const provider = getGoogleReviewsProviderStatus();
  result.error = `PROVIDER_PENDING: Google reviews acquisition has no active provider (${provider.envSlot}${provider.actorId ? `=${provider.actorId} — not yet implemented/verified` : " not set"}). ${provider.detail}`;
  console.warn(`[ReviewsScraper] ${result.error} (competitorId=${competitorId})`);
  return result;
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
    // PROVIDER_PENDING short-circuits inside scrapeReviewsForCompetitor; no
    // pacing sleep needed since nothing hits the network.
    results.push(await scrapeReviewsForCompetitor(comp.id, accountId, campaignId));
  }
  return results;
}

/**
 * Test-only surface for the live SERP verification harness. Lets the harness
 * exercise the REAL SERP JSON parser + URL builders instead of a copy, so what
 * it validates is exactly what production runs. Not for product code.
 */
export const _reviewsSerpTestHooks = {
  extractReviewsFromSerpJson,
  extractFidFromSerpSearch,
  buildGoogleSearchUrl,
  buildGoogleReviewsUrl,
};
