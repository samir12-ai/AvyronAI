/**
 * Instagram Acquisition Provider (2026-07-26)
 *
 * Single integration point for competitor Instagram data acquisition.
 * Apify is the primary (and currently only) provider; swapping providers
 * in future requires only changes to this file.
 *
 * Architecture:
 *   Instagram Acquisition
 *         ↓
 *   Instagram Provider   ← this file
 *         ↓
 *   Apify
 *
 * Bright Data is no longer part of the Instagram execution path.
 * This module MUST NOT attempt Bright Data for Instagram, even as a fallback.
 *
 * NULL≠zero (P-2 doctrine): missing or hidden metrics map to null, never 0.
 * Failure classification mirrors profile-scraper.ts conventions so
 * data-acquisition.ts receives an identical ScrapeResult shape.
 */

import { type ScrapeResult, classifyScrapeFailure } from "./profile-scraper";
import { scrapeInstagramViaApify, isInstagramApifyConfigured } from "./instagram-apify-scraper";

/**
 * Acquire Instagram posts for a competitor via Apify.
 *
 * @param handle   Instagram username (no @ prefix, no URL)
 * @param maxPosts Maximum posts to return
 * @param accountId  Caller's account ID (for logging / future per-account rate limits)
 * @returns ScrapeResult-compatible object — drop-in replacement for
 *          scrapeInstagramProfile() in the competitor acquisition path
 */
export async function scrapeInstagramForCompetitor(
  handle: string,
  maxPosts: number,
  accountId: string,
): Promise<ScrapeResult> {
  if (!isInstagramApifyConfigured()) {
    console.warn(`[InstagramProvider] APIFY_API_KEY not set — cannot scrape @${handle}`);
    return {
      success: false,
      posts: [],
      embeddedComments: [],
      followers: null,
      profileName: null,
      collectionMethodUsed: "NONE",
      attempts: ["APIFY_ACTOR"],
      warnings: ["APIFY_API_KEY not configured"],
      rawFetchedCount: 0,
      paginationPages: 0,
      paginationStopReason: "PROVIDER_NOT_CONFIGURED",
      failureClass: "TRANSIENT",
    };
  }

  console.log(`[InstagramProvider] Acquiring @${handle} via Apify (accountId=${accountId}, maxPosts=${maxPosts})`);

  try {
    const result = await scrapeInstagramViaApify(handle, maxPosts);

    if (result.posts.length === 0 && result.followers === null) {
      // Transport reached Apify and the actor ran, but no profile data returned —
      // treat as healthy-empty (NONE failure class) so no 24h block is stamped.
      console.log(`[InstagramProvider] Apify returned empty profile for @${handle} — healthy-empty`);
      return {
        success: false,
        posts: [],
        embeddedComments: [],
        followers: null,
        profileName: result.profileName,
        collectionMethodUsed: "APIFY_ACTOR",
        attempts: ["APIFY_ACTOR"],
        warnings: ["Apify returned no posts and no follower count"],
        rawFetchedCount: 0,
        paginationPages: 1,
        paginationStopReason: "NO_MORE_PAGES",
        failureClass: "NONE",
      };
    }

    console.log(`[InstagramProvider] @${handle} — ${result.posts.length} posts, followers=${result.followers ?? "unknown"}`);

    return {
      success: true,
      posts: result.posts,
      embeddedComments: [], // Apify profile actor does not return comment threads
      followers: result.followers,
      profileName: result.profileName,
      collectionMethodUsed: "APIFY_ACTOR",
      attempts: ["APIFY_ACTOR"],
      warnings: [],
      rawFetchedCount: result.posts.length,
      paginationPages: 1,
      paginationStopReason: result.posts.length >= maxPosts ? "TARGET_REACHED" : "NO_MORE_PAGES",
      failureClass: "NONE",
    };
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : String(err);
    // Classify: only unambiguous auth/403/challenge walls become GENUINE_BLOCK;
    // everything else (timeout, breaker-open, network) is TRANSIENT.
    const failureClass = classifyScrapeFailure(message);
    console.error(`[InstagramProvider] Apify scrape failed for @${handle}: ${message} (class=${failureClass})`);

    return {
      success: false,
      posts: [],
      embeddedComments: [],
      followers: null,
      profileName: null,
      collectionMethodUsed: "NONE",
      attempts: ["APIFY_ACTOR"],
      warnings: [message],
      rawFetchedCount: 0,
      paginationPages: 0,
      paginationStopReason: "FETCH_FAILED",
      failureClass,
    };
  }
}
