import { db } from "../db";
import { ciCompetitorReviews, ciCompetitors } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import * as https from "https";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const GOOGLE_PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

export interface ReviewScrapedResult {
  competitorId: string;
  reviewsFetched: number;
  reviewsInserted: number;
  placeId: string | null;
  error?: string;
}

function httpsGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Failed to parse JSON: " + data.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

async function findPlaceId(query: string): Promise<string | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const encoded = encodeURIComponent(query);
  const url = `${GOOGLE_PLACES_BASE}/findplacefromtext/json?input=${encoded}&inputtype=textquery&fields=place_id&key=${GOOGLE_MAPS_API_KEY}`;
  const result = await httpsGet(url);
  if (result.status !== "OK" || !result.candidates?.length) return null;
  return result.candidates[0].place_id || null;
}

async function fetchPlaceReviews(placeId: string): Promise<{ text: string; rating: number; time: number }[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];
  const url = `${GOOGLE_PLACES_BASE}/details/json?place_id=${placeId}&fields=reviews&language=en&key=${GOOGLE_MAPS_API_KEY}`;
  const result = await httpsGet(url);
  if (result.status !== "OK" || !result.result?.reviews) return [];
  return result.result.reviews.map((r: any) => ({
    text: (r.text || "").trim(),
    rating: r.rating || 0,
    time: r.time || 0,
  })).filter((r: { text: string }) => r.text.length > 5);
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

  if (!GOOGLE_MAPS_API_KEY) {
    result.error = "GOOGLE_MAPS_API_KEY not configured — reviews scraping skipped";
    console.log(`[ReviewsScraper] ${result.error}`);
    return result;
  }

  try {
    const [competitor] = await db.select({ name: ciCompetitors.name, url: ciCompetitors.profileLink })
      .from(ciCompetitors)
      .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)));

    if (!competitor) {
      result.error = `Competitor not found: ${competitorId}`;
      return result;
    }

    const searchQuery = competitor.name || competitor.url || competitorId;
    const placeId = await findPlaceId(searchQuery);
    if (!placeId) {
      result.error = `No Google Place found for: ${searchQuery}`;
      console.log(`[ReviewsScraper] ${result.error}`);
      return result;
    }

    result.placeId = placeId;
    const reviews = await fetchPlaceReviews(placeId);
    result.reviewsFetched = reviews.length;

    if (reviews.length === 0) {
      result.error = "No reviews found on Google Maps for this competitor";
      return result;
    }

    for (const review of reviews) {
      const reviewId = `google_${placeId}_${review.time}`;
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
      });
      result.reviewsInserted++;
    }

    console.log(`[ReviewsScraper] competitorId=${competitorId} | fetched=${result.reviewsFetched} | inserted=${result.reviewsInserted}`);
    return result;
  } catch (err: any) {
    result.error = err.message;
    console.error(`[ReviewsScraper] ERROR competitorId=${competitorId}: ${err.message}`);
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
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}
