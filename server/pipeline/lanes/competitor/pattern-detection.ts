/**
 * Phase 7.3 — Multi-competitor pattern detection on Instagram.
 *
 * Locked by Samir 2026-04-21:
 *   "No single competitor = no pattern."
 *
 * A "pattern" is an Instagram theme that appears across at least
 * MIN_COMPETITORS_FOR_PATTERN = 2 distinct competitors. This module does
 * NOT classify validation (that is `pattern-validation.ts`). It only groups
 * IG posts by theme token and counts distinct competitors per theme.
 *
 * Doctrine placement: Competitor Lane. Pure function, no DB I/O, no scoring.
 * Themes that fall short of the threshold are returned with a "weak data"
 * status so the orchestrator can surface them — Samir: "Weak data must be
 * surfaced, not ignored."
 */
import type { CompetitorPost } from "./types";

export const MIN_COMPETITORS_FOR_PATTERN = 2;

export type IgThemeStatus =
  /** Theme appears across >= MIN_COMPETITORS_FOR_PATTERN distinct competitors. */
  | "pattern"
  /** Theme appears on IG but for a single competitor only. Surfaced, not dropped. */
  | "single_competitor";

export interface IgThemeBucket {
  themeToken: string;
  status: IgThemeStatus;
  /** Sorted, deduped list of distinct competitor ids that posted this theme on IG. */
  competitorIds: string[];
  /** Total IG post count covering this theme (post-level, not competitor-level). */
  postCount: number;
  /** Stable rule code for traceability. */
  reason: string;
}

/**
 * Group Instagram posts by theme token and classify each theme.
 * Returns one bucket per theme observed on Instagram.
 */
export function detectIgPatterns(
  posts: ReadonlyArray<CompetitorPost>,
): IgThemeBucket[] {
  // Aggregate: themeToken -> { competitorIds: Set, postCount: number }
  const byTheme = new Map<string, { competitors: Set<string>; postCount: number }>();
  for (const p of posts) {
    if (p.channel !== "instagram") continue;
    if (!p.competitorId) continue;
    const seen = new Set<string>(); // dedupe theme tokens within the same post
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

  const out: IgThemeBucket[] = [];
  for (const [themeToken, agg] of byTheme.entries()) {
    const competitorIds = Array.from(agg.competitors).sort();
    if (competitorIds.length >= MIN_COMPETITORS_FOR_PATTERN) {
      out.push({
        themeToken,
        status: "pattern",
        competitorIds,
        postCount: agg.postCount,
        reason: `pattern:multi_competitor_ig:${competitorIds.length}`,
      });
    } else {
      out.push({
        themeToken,
        status: "single_competitor",
        competitorIds,
        postCount: agg.postCount,
        reason: "weak_data:single_competitor_ig",
      });
    }
  }
  // Stable order: by themeToken to make outputs deterministic.
  out.sort((a, b) => a.themeToken.localeCompare(b.themeToken));
  return out;
}
