/**
 * Phase 7.3 — Competitor Lane interpretation orchestrator.
 *
 * Locked by Samir 2026-04-21. Composes IG pattern detection
 * (`pattern-detection.ts`) and TikTok validation (`pattern-validation.ts`)
 * into the structured signal stream specified in his directive:
 *
 *   - "pattern_validated"  — IG pattern (>=2 competitors) + strong TikTok validation
 *   - "pattern_detected"   — IG pattern, no TikTok validation
 *   - "weak_validation"    — IG pattern + only weak TikTok presence
 *   - "insufficient_data"  — corpus-level: not enough competitors to reason at all
 *
 * Plus, per Samir's "weak data must be surfaced, not ignored":
 *   - "single_competitor_no_pattern" — IG theme with one competitor only
 *   - "tiktok_only"                  — TikTok-only theme; emitted as a diagnostic,
 *                                      never as a strategy signal ("TikTok alone ≠ strategy")
 *
 * Doctrine placement: Competitor Lane. Pure function, no DB I/O, no scoring,
 * no winner picking. Stable rule codes on every output. Boss assembles.
 *
 * Corpus-level insufficient_data fires when the entire input has fewer than
 * MIN_COMPETITORS_FOR_PATTERN distinct competitors across BOTH channels —
 * with that little data, no pattern claim is defensible.
 */
import type { CompetitorPost } from "./types";
import {
  detectIgPatterns,
  MIN_COMPETITORS_FOR_PATTERN,
  type IgThemeBucket,
} from "./pattern-detection";
import {
  aggregateTikTokPresence,
  validateTheme,
  type TikTokValidation,
} from "./pattern-validation";

export type CompetitorSignalStatus =
  | "pattern_validated"
  | "pattern_detected"
  | "weak_validation"
  | "single_competitor_no_pattern"
  | "tiktok_only";

export interface CompetitorThemeSignal {
  themeToken: string;
  status: CompetitorSignalStatus;
  igCompetitorIds: string[];
  igPostCount: number;
  tiktokCompetitorIds: string[];
  tiktokPostCount: number;
  /** Stable rule code identifying which branch produced this signal. */
  reason: string;
}

export type CorpusStatus = "ok" | "insufficient_data";

export interface CompetitorInterpretation {
  corpusStatus: CorpusStatus;
  corpusReason: string;
  totals: {
    distinctCompetitors: number;
    distinctIgCompetitors: number;
    distinctTiktokCompetitors: number;
    igPostCount: number;
    tiktokPostCount: number;
  };
  /** Strategy signals only — sorted by themeToken for deterministic output. */
  signals: CompetitorThemeSignal[];
  /**
   * Diagnostics for "weak data" the operator should still see:
   *   - single-competitor IG themes
   *   - TikTok-only themes
   * Kept separate from `signals` so the strategy stream stays clean.
   */
  diagnostics: CompetitorThemeSignal[];
}

function classify(
  ig: IgThemeBucket,
  tiktok: TikTokValidation,
): { status: CompetitorSignalStatus; reason: string } {
  // Single-competitor IG never becomes a pattern, but is surfaced as a diagnostic.
  if (ig.status === "single_competitor") {
    return {
      status: "single_competitor_no_pattern",
      reason: "weak_data:single_competitor_ig",
    };
  }
  // ig.status === "pattern" from here.
  if (tiktok.level === "strong") {
    return {
      status: "pattern_validated",
      reason: `pattern_validated:${ig.reason}|${tiktok.reason}`,
    };
  }
  if (tiktok.level === "weak") {
    return {
      status: "weak_validation",
      reason: `weak_validation:${ig.reason}|${tiktok.reason}`,
    };
  }
  // tiktok.level === "none"
  return {
    status: "pattern_detected",
    reason: `pattern_detected:${ig.reason}|${tiktok.reason}`,
  };
}

export function interpretCompetitorPosts(
  posts: ReadonlyArray<CompetitorPost>,
): CompetitorInterpretation {
  // Totals for corpus-level checks and traceability.
  const allCompetitors = new Set<string>();
  const igCompetitors = new Set<string>();
  const tiktokCompetitors = new Set<string>();
  let igPostCount = 0;
  let tiktokPostCount = 0;
  for (const p of posts) {
    if (!p.competitorId) continue;
    allCompetitors.add(p.competitorId);
    if (p.channel === "instagram") {
      igCompetitors.add(p.competitorId);
      igPostCount += 1;
    } else if (p.channel === "tiktok") {
      tiktokCompetitors.add(p.competitorId);
      tiktokPostCount += 1;
    }
  }
  const totals = {
    distinctCompetitors: allCompetitors.size,
    distinctIgCompetitors: igCompetitors.size,
    distinctTiktokCompetitors: tiktokCompetitors.size,
    igPostCount,
    tiktokPostCount,
  };

  // Corpus-level insufficient_data short-circuit. Same threshold as a single
  // pattern (>=2 distinct competitors). Anything less, no signals are emitted.
  if (totals.distinctCompetitors < MIN_COMPETITORS_FOR_PATTERN) {
    return {
      corpusStatus: "insufficient_data",
      corpusReason: `insufficient_data:competitors<${MIN_COMPETITORS_FOR_PATTERN}`,
      totals,
      signals: [],
      diagnostics: [],
    };
  }

  const igBuckets = detectIgPatterns(posts);
  const tiktokPresence = aggregateTikTokPresence(posts);

  const signals: CompetitorThemeSignal[] = [];
  const diagnostics: CompetitorThemeSignal[] = [];
  const seenThemes = new Set<string>();

  for (const ig of igBuckets) {
    seenThemes.add(ig.themeToken);
    const tiktok = validateTheme(ig.themeToken, tiktokPresence);
    const { status, reason } = classify(ig, tiktok);
    const row: CompetitorThemeSignal = {
      themeToken: ig.themeToken,
      status,
      igCompetitorIds: ig.competitorIds,
      igPostCount: ig.postCount,
      tiktokCompetitorIds: tiktok.competitorIds,
      tiktokPostCount: tiktok.postCount,
      reason,
    };
    if (status === "single_competitor_no_pattern") {
      diagnostics.push(row);
    } else {
      signals.push(row);
    }
  }

  // TikTok-only themes — TikTok presence with no IG observation. Surfaced
  // as diagnostics so the operator sees them, never as a strategy signal.
  for (const [themeToken, presence] of tiktokPresence.entries()) {
    if (seenThemes.has(themeToken)) continue;
    diagnostics.push({
      themeToken,
      status: "tiktok_only",
      igCompetitorIds: [],
      igPostCount: 0,
      tiktokCompetitorIds: presence.competitorIds,
      tiktokPostCount: presence.postCount,
      reason: "weak_data:tiktok_only_no_strategy",
    });
  }

  signals.sort((a, b) => a.themeToken.localeCompare(b.themeToken));
  diagnostics.sort((a, b) => a.themeToken.localeCompare(b.themeToken));

  return {
    corpusStatus: "ok",
    corpusReason: "ok",
    totals,
    signals,
    diagnostics,
  };
}
