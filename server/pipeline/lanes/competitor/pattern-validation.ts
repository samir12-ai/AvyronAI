/**
 * Phase 7.3 — TikTok validation layer.
 *
 * Locked by Samir 2026-04-21:
 *   "No TikTok validation = no strong signal."
 *   "TikTok alone ≠ strategy."
 *
 * This module computes per-theme TikTok presence (distinct competitors and
 * post counts on TikTok). It does NOT consume engagement metrics — presence
 * is the only signal at this layer (Phase 7 doctrine: rules-based, no
 * scoring). The orchestrator (`interpret.ts`) joins these counts with IG
 * pattern detection to emit the final four structured signals.
 *
 * Thresholds (single source of truth):
 *   MIN_TIKTOK_COMPETITORS_STRONG = 2  — strong validation requires >=2 distinct competitors
 *   MIN_TIKTOK_POSTS_STRONG       = 2  — and at least 2 TikTok posts overall
 *   Anything between zero presence and the strong threshold is "weak".
 */
import type { CompetitorPost } from "./types";

export const MIN_TIKTOK_COMPETITORS_STRONG = 2;
export const MIN_TIKTOK_POSTS_STRONG = 2;

export interface TikTokThemePresence {
  themeToken: string;
  competitorIds: string[]; // sorted, deduped
  postCount: number;
}

export type TikTokValidationLevel =
  | "strong"        // >= MIN_TIKTOK_COMPETITORS_STRONG distinct + >= MIN_TIKTOK_POSTS_STRONG posts
  | "weak"          // some presence (>=1 competitor or >=1 post) but below strong
  | "none";         // no TikTok presence for this theme

export interface TikTokValidation {
  themeToken: string;
  level: TikTokValidationLevel;
  competitorIds: string[];
  postCount: number;
  reason: string;
}

/**
 * Aggregate TikTok presence per theme token. Returns one entry per theme
 * observed on TikTok. Themes never observed on TikTok are absent (queries
 * default to "none" via `validateTheme`).
 */
export function aggregateTikTokPresence(
  posts: ReadonlyArray<CompetitorPost>,
): Map<string, TikTokThemePresence> {
  const byTheme = new Map<string, { competitors: Set<string>; postCount: number }>();
  for (const p of posts) {
    if (p.channel !== "tiktok") continue;
    if (!p.competitorId) continue;
    const seen = new Set<string>();
    for (const raw of p.themeTokens ?? []) {
      const token = (raw ?? "").trim().toLowerCase();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      let bucket = byTheme.get(token);
      if (!bucket) {
        bucket = { competitors: new Set<string>(), postCount: 0 };
        byTheme.set(token, bucket);
      }
      bucket.competitors.add(p.competitorId);
      bucket.postCount += 1;
    }
  }
  const out = new Map<string, TikTokThemePresence>();
  for (const [themeToken, agg] of byTheme.entries()) {
    out.set(themeToken, {
      themeToken,
      competitorIds: Array.from(agg.competitors).sort(),
      postCount: agg.postCount,
    });
  }
  return out;
}

/**
 * Classify a single theme's TikTok validation level given the aggregated
 * presence map. Themes absent from the map default to "none".
 */
export function validateTheme(
  themeToken: string,
  tiktokPresence: Map<string, TikTokThemePresence>,
): TikTokValidation {
  const presence = tiktokPresence.get(themeToken);
  if (!presence || (presence.competitorIds.length === 0 && presence.postCount === 0)) {
    return {
      themeToken,
      level: "none",
      competitorIds: [],
      postCount: 0,
      reason: "no_tiktok_validation",
    };
  }
  const competitors = presence.competitorIds.length;
  const posts = presence.postCount;
  if (competitors >= MIN_TIKTOK_COMPETITORS_STRONG && posts >= MIN_TIKTOK_POSTS_STRONG) {
    return {
      themeToken,
      level: "strong",
      competitorIds: presence.competitorIds,
      postCount: posts,
      reason: `strong:multi_competitor_tiktok:${competitors}c_${posts}p`,
    };
  }
  return {
    themeToken,
    level: "weak",
    competitorIds: presence.competitorIds,
    postCount: posts,
    reason: `weak:limited_tiktok_presence:${competitors}c_${posts}p`,
  };
}
