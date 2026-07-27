/**
 * Phase 7.5 — Competitor corpus reader (Boss-side aggregation).
 *
 * Locked by Samir 2026-04-24:
 *   "Q2 must operate on real structured market signals, not approximations."
 *
 * This module bridges the gap between the per-call competitor lane runner
 * (which writes free-form pattern strings into pipeline_signals) and the
 * Phase 7.3 interpretation orchestrator (`interpretCompetitorPosts`) which
 * requires a structured `CompetitorPost[]` stream with channel + theme
 * attribution.
 *
 * Source of truth: `ci_competitor_posts` is the live per-post table that
 * already carries `competitorId`, `platform` (instagram | tiktok), `caption`,
 * `hashtags`, and `timestamp`. We read posts within the Q2 lookback window,
 * normalize them into `CompetitorPost[]`, and feed the Phase 7.3 interpreter.
 *
 * Theme token strategy — DETERMINISTIC, NO INFERENCE:
 *   - Theme tokens are derived ONLY from the post's hashtags field.
 *   - Hashtags are the competitor's own self-labelled themes. They are
 *     already declarative ("#fasterresults", "#valueoffer", ...) so they
 *     map cleanly to Phase 7.3's "themeToken" concept.
 *   - We do NOT mine the caption with NLP — that would introduce inference
 *     and break the "rule-based, traceable" doctrine.
 *   - Posts with no hashtags contribute zero theme tokens (they are still
 *     counted in totals but cannot drive a multi-competitor pattern).
 *
 * Channel mapping:
 *   - ci_competitor_posts.platform === "instagram" -> CompetitorChannel "instagram"
 *   - ci_competitor_posts.platform === "tiktok"    -> CompetitorChannel "tiktok"
 *   - any other value -> post is excluded (Phase 7.3 only models IG vs TikTok)
 *
 * Pure orchestration: this module reads from DB but never writes. The Boss
 * runner persists the resulting `CompetitorInterpretation` onto execution
 * for the explanation route to surface.
 */
import { db } from "../../../db";
import { ciCompetitors, ciCompetitorPosts, competitorPostClassifications } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { interpretCompetitorPosts } from "./interpret";
import type { CompetitorInterpretation } from "./interpret";
import type { CompetitorChannel, CompetitorPost } from "./types";

export const CORPUS_DEFAULT_LOOKBACK_DAYS = 7;

export interface CorpusReadInput {
  accountId: string;
  campaignId: string;
  /** Override clock for tests. */
  now?: Date;
  /** Override lookback (Q2 uses 7 days; tests may shorten). */
  lookbackDays?: number;
  /** Inject a pre-built post stream for tests, bypassing DB. */
  postsOverride?: ReadonlyArray<CompetitorPost>;
}

export interface CorpusReadResult {
  interpretation: CompetitorInterpretation;
  /** Raw posts that were fed into the interpreter (for traceability). */
  postsUsed: number;
  /** Posts read from DB but excluded (unsupported channel, no hashtags). */
  postsExcluded: { unsupportedChannel: number; noHashtags: number };
  lookbackDays: number;
  windowStart: string;
  windowEnd: string;
  /**
   * Posts that received AI-classified semantic theme tokens (from
   * competitor_post_classifications). When > 0, the interpreter is
   * operating on marketing-intent signals rather than hashtag frequencies.
   * Optional so callers built before this field was added don't break.
   */
  semanticTokensInjected?: number;
}

/**
 * Parse the `hashtags` text column into a deduped, normalized theme-token list.
 * The column is stored as a free-form text blob — observed formats include
 * comma-separated, whitespace-separated, and JSON-array. We accept any of
 * those without raising.
 */
export function extractThemeTokens(hashtagsBlob: string | null | undefined): string[] {
  if (!hashtagsBlob) return [];
  const blob = hashtagsBlob.trim();
  if (!blob) return [];

  let raw: string[] = [];
  // JSON array of strings.
  if (blob.startsWith("[")) {
    try {
      const parsed = JSON.parse(blob);
      if (Array.isArray(parsed)) {
        raw = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // fall through to delimiter splitting
    }
  }
  if (raw.length === 0) {
    raw = blob.split(/[\s,;]+/);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tok = t.trim().replace(/^#+/, "").toLowerCase();
    if (!tok) continue;
    if (!/^[a-z0-9_-]+$/.test(tok)) continue; // strip URL fragments / emoji
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/**
 * Build semantic theme tokens from a competitor_post_classifications row.
 *
 * Each token is prefixed with its dimension so the pattern-detection layer
 * can identify multi-competitor trends in marketing intent rather than
 * hashtag frequency. Format: "hook:bold_claim", "promise:better_taste", etc.
 *
 * UNKNOWN and NONE values are excluded — they carry no signal.
 * Token values are lowercased so pattern grouping is case-insensitive.
 *
 * Dimension priority (CORE → SECONDARY per Phase 3 evaluation):
 *   hook, angle, promise, trigger, positioning, goal (all CORE ≥ 67% fill)
 */
export function extractSemanticThemeTokens(classification: {
  hookArchetype: string | null;
  primaryAngle: string | null;
  coreMarketingPromise: string | null;
  emotionalTrigger: string | null;
  positioningStyle: string | null;
  primaryGoal: string | null;
}): string[] {
  const tokens: string[] = [];
  const SKIP = new Set(["UNKNOWN", "NONE", ""]);
  const add = (prefix: string, val: string | null | undefined) => {
    if (val && !SKIP.has(val)) tokens.push(`${prefix}:${val.toLowerCase()}`);
  };
  add("hook",        classification.hookArchetype);
  add("angle",       classification.primaryAngle);
  add("promise",     classification.coreMarketingPromise);
  add("trigger",     classification.emotionalTrigger);
  add("positioning", classification.positioningStyle);
  add("goal",        classification.primaryGoal);
  return tokens;
}

function normalizeChannel(platform: string | null | undefined): CompetitorChannel | null {
  if (!platform) return null;
  const p = platform.trim().toLowerCase();
  if (p === "instagram" || p === "ig") return "instagram";
  if (p === "tiktok" || p === "tt") return "tiktok";
  return null;
}

async function loadPostsFromDb(
  accountId: string,
  campaignId: string,
  cutoff: Date,
): Promise<{ posts: CompetitorPost[]; excludedNoHashtags: number; excludedChannel: number; semanticTokensInjected: number }> {
  const competitors = await db
    .select({ id: ciCompetitors.id })
    .from(ciCompetitors)
    .where(
      and(
        eq(ciCompetitors.accountId, accountId),
        eq(ciCompetitors.campaignId, campaignId),
        eq(ciCompetitors.isActive, true),
      ),
    );

  if (competitors.length === 0) {
    return { posts: [], excludedNoHashtags: 0, excludedChannel: 0, semanticTokensInjected: 0 };
  }
  const competitorIds = competitors.map((c) => c.id);

  // Phase 7.5 — architect-flagged 2026-04-24: lookback MUST filter on the
  // post's actual event time (`timestamp`), not on `createdAt` (ingestion
  // time). Otherwise a recently-ingested old post would be counted as
  // current market evidence and could falsely trigger pattern_validated /
  // weak_validation. We COALESCE to createdAt only when timestamp is NULL
  // (legacy rows), so rows without a posting timestamp still contribute.
  const rows = await db
    .select({
      id: ciCompetitorPosts.id,
      competitorId: ciCompetitorPosts.competitorId,
      platform: ciCompetitorPosts.platform,
      hashtags: ciCompetitorPosts.hashtags,
      timestamp: ciCompetitorPosts.timestamp,
      createdAt: ciCompetitorPosts.createdAt,
    })
    .from(ciCompetitorPosts)
    .where(
      and(
        inArray(ciCompetitorPosts.competitorId, competitorIds),
        sql`COALESCE(${ciCompetitorPosts.timestamp}, ${ciCompetitorPosts.createdAt}) >= ${cutoff}`,
      ),
    );

  // Bulk-load AI classifications for all posts in one query (no N+1).
  // We use "competitor-post-v2" and confidence >= 0.50 to match the SSOT
  // threshold established in P-2 Step 5.
  const postIds = rows.map((r) => r.id).filter((id): id is string => !!id);
  const classificationsByPostId = new Map<string, {
    hookArchetype: string | null;
    primaryAngle: string | null;
    coreMarketingPromise: string | null;
    emotionalTrigger: string | null;
    positioningStyle: string | null;
    primaryGoal: string | null;
  }>();
  if (postIds.length > 0) {
    try {
      const classRows = await db
        .select({
          postId: competitorPostClassifications.postId,
          hookArchetype: competitorPostClassifications.hookArchetype,
          primaryAngle: competitorPostClassifications.primaryAngle,
          coreMarketingPromise: competitorPostClassifications.coreMarketingPromise,
          emotionalTrigger: competitorPostClassifications.emotionalTrigger,
          positioningStyle: competitorPostClassifications.positioningStyle,
          primaryGoal: competitorPostClassifications.primaryGoal,
          confidenceScore: competitorPostClassifications.confidenceScore,
        })
        .from(competitorPostClassifications)
        .where(
          and(
            inArray(competitorPostClassifications.postId, postIds),
            eq(competitorPostClassifications.classifierVersion, "competitor-post-v2"),
          ),
        );
      for (const c of classRows) {
        if (!c.postId) continue;
        const conf = typeof c.confidenceScore === "number"
          ? c.confidenceScore
          : Number(c.confidenceScore ?? 0);
        if (conf < 0.50) continue;
        classificationsByPostId.set(c.postId, {
          hookArchetype: c.hookArchetype,
          primaryAngle: c.primaryAngle,
          coreMarketingPromise: c.coreMarketingPromise,
          emotionalTrigger: c.emotionalTrigger,
          positioningStyle: c.positioningStyle,
          primaryGoal: c.primaryGoal,
        });
      }
    } catch (err) {
      // Non-fatal: if classification load fails, fall back to hashtag-only tokens.
      console.error(
        `[CorpusReader] SEMANTIC_CLASSIFICATION_LOAD_FAILED reason=${(err as Error).message} — falling back to hashtag tokens`,
      );
    }
  }

  const posts: CompetitorPost[] = [];
  let excludedNoHashtags = 0;
  let excludedChannel = 0;
  let semanticTokensInjected = 0;

  for (const r of rows) {
    const channel = normalizeChannel(r.platform);
    if (!channel) {
      excludedChannel++;
      continue;
    }

    const classification = r.id ? classificationsByPostId.get(r.id) : undefined;
    const hashtagTokens = extractThemeTokens(r.hashtags);

    let themeTokens: string[];
    if (classification) {
      // AI-classified path: semantic tokens are primary, hashtag tokens are
      // secondary (prefixed with "tag:" to keep them distinct in pattern detection).
      const semanticTokens = extractSemanticThemeTokens(classification);
      themeTokens = semanticTokens.length > 0
        ? [...semanticTokens, ...hashtagTokens.map((t) => `tag:${t}`)]
        : hashtagTokens; // classification exists but all dimensions UNKNOWN — hashtag fallback
      if (semanticTokens.length > 0) semanticTokensInjected++;
    } else {
      // Unclassified post: pure hashtag path (backward-compatible behavior).
      themeTokens = hashtagTokens;
    }

    if (themeTokens.length === 0) {
      excludedNoHashtags++;
      // Still pushed — the post counts toward totals (helps corpus density)
      // but cannot drive a theme. Phase 7.3 detector ignores empty-theme posts.
    }
    posts.push({
      competitorId: r.competitorId,
      channel,
      themeTokens,
      observedAt: (r.timestamp ?? r.createdAt ?? new Date()).toISOString(),
    });
  }

  return { posts, excludedNoHashtags, excludedChannel, semanticTokensInjected };
}

export async function readCompetitorCorpus(
  inp: CorpusReadInput,
): Promise<CorpusReadResult> {
  const lookbackDays = inp.lookbackDays ?? CORPUS_DEFAULT_LOOKBACK_DAYS;
  const now = inp.now ?? new Date();
  const cutoff = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let posts: CompetitorPost[];
  let excludedNoHashtags = 0;
  let excludedChannel = 0;
  let semanticTokensInjected = 0;

  if (inp.postsOverride) {
    posts = [...inp.postsOverride];
  } else {
    const loaded = await loadPostsFromDb(inp.accountId, inp.campaignId, cutoff);
    posts = loaded.posts;
    excludedNoHashtags = loaded.excludedNoHashtags;
    excludedChannel = loaded.excludedChannel;
    semanticTokensInjected = loaded.semanticTokensInjected;
  }

  const interpretation = interpretCompetitorPosts(posts);

  return {
    interpretation,
    postsUsed: posts.length,
    postsExcluded: { unsupportedChannel: excludedChannel, noHashtags: excludedNoHashtags },
    semanticTokensInjected,
    lookbackDays,
    windowStart: cutoff.toISOString(),
    windowEnd: now.toISOString(),
  };
}
