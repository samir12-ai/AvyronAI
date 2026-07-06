/**
 * Phase 7.4 — Q2 ("Has the market shifted?") policy.
 *
 * Locked by Samir 2026-04-24:
 *   "Boss decides. Competitor lane does NOT decide."
 *
 * This module is the SOLE owner of the Q2 verdict. It is rule-based,
 * deterministic, and never reads from the AI overlay layer. The AI overlay
 * (`server/pipeline/ai-overlay/q2-reasoning.ts`) consumes the verdict + reasons
 * AFTER they are produced here, and only enhances the explanation surface.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Verdict universe (Phase 7.4):
 *   - SHIFTED            — strong validated competitor changes observed.
 *   - UNCERTAIN          — weak validation; signals present but not strong.
 *   - STABLE             — no meaningful market motion (or only early /
 *                          diagnostic signals — "do not overreact").
 *   - INSUFFICIENT_DATA  — not enough competitor + truth signal exists to
 *                          reason at all. Distinct from STABLE because
 *                          "we have no data" is not the same as
 *                          "the market is calm".
 *
 * ──────────────────────────────────────────────────────────────────────
 * Mapping from Samir's Phase 7.3 categories to today's available data:
 *
 *   Samir's category            Today's proxy in the live data
 *   ──────────────────────────  ───────────────────────────────────────
 *   pattern_validated           change_events.severity === "major"
 *                               (multi-dimensional change in competitor
 *                                payload — strong evidence of motion)
 *   weak_validation             change_events.severity === "medium"
 *                               (single-dimensional change)
 *   pattern_detected (early)    pipeline_signals.type === "pattern" but
 *                               no change_event recorded yet — pattern
 *                               present, no validation
 *   diagnostics                 change_events.severity === "mild"
 *                               (cosmetic / low-evidence change) —
 *                               IGNORED for verdict, surfaced in reasons
 *   insufficient_data           zero competitor runs in lookback OR zero
 *                               signals + zero change_events
 *
 * The full Phase 7.3 per-competitor / per-channel interpretation
 * (`interpretCompetitorPosts`) is a pure module ready to plug in once the
 * competitor lane runner emits CompetitorPost records (planned Phase 7.4.5).
 * Today's Q2 is honest about what data exists.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Rule tree (in priority order — first match wins, deterministic):
 *
 *   R0: corpus = no_runs
 *       competitor.recentRunsCount === 0
 *       -> INSUFFICIENT_DATA  reason: insufficient_data:no_competitor_runs
 *
 *   R1: corpus = empty
 *       competitor.signalCount === 0
 *       AND competitor.changeEvents.{major,medium,mild} === 0
 *       AND user.truthStatus !== "submitted"
 *       -> INSUFFICIENT_DATA  reason: insufficient_data:no_market_signal
 *
 *   R2: SHIFTED
 *       major >= MAJOR_THRESHOLD            (default 1)
 *       OR medium >= MEDIUM_SHIFTED_THRESHOLD (default 3)
 *       -> SHIFTED  reason: rule:shifted_<which>
 *
 *   R3: UNCERTAIN
 *       major === 0 AND medium >= MEDIUM_UNCERTAIN_THRESHOLD (default 1)
 *       -> UNCERTAIN  reason: rule:uncertain_medium
 *
 *   R4: STABLE — early patterns, do not overreact
 *       major === 0 AND medium === 0
 *       AND (mild >= 1 OR signalCount >= 1)
 *       -> STABLE  reason: rule:stable_early_patterns_only
 *
 *   R5: STABLE — quiet
 *       no signals, no change_events, but truth submitted
 *       -> STABLE  reason: rule:stable_quiet_market
 *
 * Reasons array always includes:
 *   - corpus snapshot (recentRunsCount, signalCount, severity buckets)
 *   - user / DNA context tags (descriptive — never modify the verdict)
 *   - the rule code that fired
 */
import { db } from "../../db";
import { pipelineChangeEvents, pipelineRuns, pipelineSignals } from "@shared/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { BossQuestionVerdict, Q2Verdict } from "../types";
import { readCompetitorCorpus } from "../../pipeline/lanes/competitor/corpus";
import type { CompetitorInterpretation } from "../../pipeline/lanes/competitor/interpret";

export const Q2_LOOKBACK_DAYS = 7;
export const Q2_MAJOR_THRESHOLD = 1;
export const Q2_MEDIUM_SHIFTED_THRESHOLD = 3;
export const Q2_MEDIUM_UNCERTAIN_THRESHOLD = 1;

/**
 * Descriptive user / DNA context. Pulled from execution.phase5/phase6 by the
 * Boss runner. Provided to Q2 ONLY for traceability and explanation; the
 * decision tree above does NOT branch on these fields. They are surfaced in
 * the reasons array so operators (and the AI explanation overlay) can see the
 * surrounding context that produced the verdict.
 */
export interface Q2UserContext {
  truthStatus: "submitted" | "missing" | "late" | null;
  rhythmStatus:
    | "compliant"
    | "partial"
    | "non_compliant"
    | "no_active_plan"
    | "rhythm_invalid"
    | null;
  evaluationStatus: "complete" | "degraded" | "blocked" | "no_active_plan" | null;
}

export interface Q2DnaContext {
  hasActiveDna: boolean;
  clusterComparisonVerdict: string | null;
  outcomeRegressed: boolean | null;
}

export interface Q2CompetitorSnapshot {
  recentRunsCount: number;
  signalCount: number;
  changeEvents: { major: number; medium: number; mild: number };
}

export interface Q2Inputs {
  accountId: string;
  campaignId: string;
  /** Override clock for tests. */
  now?: Date;
  /** Optional injected snapshots (for unit testing). When omitted, the policy
   *  loads them from the live tables — preserving legacy call sites. */
  competitor?: Q2CompetitorSnapshot;
  user?: Q2UserContext;
  dna?: Q2DnaContext;
  /**
   * Phase 7.5 — Real Phase 7.3 structured interpretation. When provided
   * (or successfully loaded from `ci_competitor_posts`), the decision tree
   * branches on real `pattern_validated` / `weak_validation` /
   * `pattern_detected` categories instead of severity-bucket proxies.
   * Severity buckets are kept as a fallback when the corpus has no posts.
   */
  interpretation?: CompetitorInterpretation;
  /** When true, skip auto-loading the corpus (used by unit tests that want
   *  the legacy severity-only path). */
  skipCorpusLoad?: boolean;
}

export interface Q2EvaluationResult extends BossQuestionVerdict<Q2Verdict> {
  /** Snapshot of every input used to derive the verdict. The AI overlay
   *  reads this; it is NEVER consulted by the policy itself. */
  inputs: {
    competitor: Q2CompetitorSnapshot;
    user: Q2UserContext;
    dna: Q2DnaContext;
    lookbackDays: number;
    /** Phase 7.5 — present when structured interpretation drove the decision. */
    interpretation?: CompetitorInterpretation;
  };
  /** Stable identifier of the rule that fired. */
  ruleCode: string;
}

async function loadCompetitorSnapshot(
  accountId: string,
  campaignId: string,
  cutoff: Date,
): Promise<Q2CompetitorSnapshot> {
  // Phase 7.4 — recentRunsCount must be lookback-bounded, otherwise R0
  // (INSUFFICIENT_DATA on no_competitor_runs) can never fire for any campaign
  // that ever had a competitor run. Architect-flagged 2026-04-24.
  const runs = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.accountId, accountId),
        eq(pipelineRuns.campaignId, campaignId),
        eq(pipelineRuns.lane, "competitor"),
        gte(pipelineRuns.createdAt, cutoff),
      ),
    );

  if (runs.length === 0) {
    return { recentRunsCount: 0, signalCount: 0, changeEvents: { major: 0, medium: 0, mild: 0 } };
  }

  const runIds = runs.map((r) => r.id);

  const [events, signals] = await Promise.all([
    db
      .select({ severity: pipelineChangeEvents.severity, createdAt: pipelineChangeEvents.createdAt })
      .from(pipelineChangeEvents)
      .where(
        and(
          inArray(pipelineChangeEvents.runId, runIds),
          gte(pipelineChangeEvents.createdAt, cutoff),
        ),
      ),
    db
      .select({ id: pipelineSignals.id, type: pipelineSignals.type, createdAt: pipelineSignals.createdAt })
      .from(pipelineSignals)
      .where(
        and(
          inArray(pipelineSignals.runId, runIds),
          gte(pipelineSignals.createdAt, cutoff),
          eq(pipelineSignals.type, "pattern"),
        ),
      ),
  ]);

  const changeEvents = { major: 0, medium: 0, mild: 0 };
  for (const e of events) {
    if (e.severity === "major") changeEvents.major++;
    else if (e.severity === "medium") changeEvents.medium++;
    else if (e.severity === "mild") changeEvents.mild++;
  }

  return {
    recentRunsCount: runs.length,
    signalCount: signals.length,
    changeEvents,
  };
}

/**
 * Pure decision tree. Exposed for tests and for the harness so we can prove
 * each verdict deterministically without DB. The boss runner calls
 * `evaluateQ2()` (the loader wrapper below).
 *
 * Phase 7.5 priority order:
 *   I0..I3  — Real Phase 7.3 interpretation rules (when interpretation provided)
 *   R0..R5  — Severity-bucket fallback rules (when no interpretation)
 *
 * Interpretation rules are PREFERRED because they encode actual structured
 * market signal (per-competitor, per-channel, per-theme). Severity buckets
 * are derived from the legacy lane payload and remain as a safety net for
 * accounts where the live ci_competitor_posts feed has not been wired.
 */
export function decideQ2(
  competitor: Q2CompetitorSnapshot,
  user: Q2UserContext,
  dna: Q2DnaContext,
  interpretation?: CompetitorInterpretation,
): { verdict: Q2Verdict; ruleCode: string; ruleReason: string } {
  const { major, medium, mild } = competitor.changeEvents;

  // ──────────────────────────────────────────────────────────────────
  // I-rules — real Phase 7.3 interpretation (preferred path)
  // ──────────────────────────────────────────────────────────────────
  if (interpretation) {
    // I0 — corpus too thin for any pattern claim *within the lookback
    // window*. This does NOT mean the account lacks competitors overall —
    // `ci_competitor_posts` is windowed to Q2_LOOKBACK_DAYS, so an account
    // with plenty of configured competitors but a scraping cadence slower
    // than the window (or a temporarily stalled scrape) will legitimately
    // show 0-1 distinct competitors *in-window* while still having rich,
    // fresher legacy severity-bucket data (pipeline_signals/change_events).
    // Bug (2026-07-06): this used to return INSUFFICIENT_DATA immediately,
    // which shadowed real R-rule signal even when recentRunsCount/signalCount
    // showed an actively-running, data-rich account. Now we fall through to
    // R-rules just like the "no IG strategy signals" case below, so legacy
    // data gets a chance to produce a real verdict before we give up.
    if (interpretation.corpusStatus !== "insufficient_data") {
      const sigs = interpretation.signals;
      const hasValidated = sigs.some((s) => s.status === "pattern_validated");
      const hasWeak = sigs.some((s) => s.status === "weak_validation");
      const hasDetected = sigs.some((s) => s.status === "pattern_detected");

      // I1 — at least one IG pattern strongly validated on TikTok.
      if (hasValidated) {
        return {
          verdict: "SHIFTED",
          ruleCode: "rule:shifted_pattern_validated",
          ruleReason: "rule:shifted_pattern_validated_ig+tiktok",
        };
      }
      // I2 — IG patterns with weak TikTok validation only.
      if (hasWeak) {
        return {
          verdict: "UNCERTAIN",
          ruleCode: "rule:uncertain_weak_validation",
          ruleReason: "rule:uncertain_pattern_ig_weak_tiktok",
        };
      }
      // I3 — IG patterns detected but no TikTok validation. Don't overreact.
      if (hasDetected) {
        return {
          verdict: "STABLE",
          ruleCode: "rule:stable_pattern_detected_no_validation",
          ruleReason: "rule:stable_ig_patterns_no_tiktok_validation",
        };
      }
      // No IG strategy signals at all (only diagnostics). Severity buckets may
      // still drive the verdict — fall through to R-rules so back-compat data
      // (legacy lane runs without ci_competitor_posts coverage) is honored.
    }
    // else: corpusStatus === "insufficient_data" (thin/stale in-window corpus)
    // — also fall through to R-rules below so legacy severity-bucket data
    // gets a real chance before we ever report INSUFFICIENT_DATA.
  }

  // ──────────────────────────────────────────────────────────────────
  // R-rules — severity-bucket fallback (legacy data, no interpretation)
  // ──────────────────────────────────────────────────────────────────

  // R0 — no competitor runs in this account/campaign at all.
  if (competitor.recentRunsCount === 0) {
    return {
      verdict: "INSUFFICIENT_DATA",
      ruleCode: "rule:insufficient_no_competitor_runs",
      ruleReason: "insufficient_data:no_competitor_runs_for_campaign",
    };
  }

  // R1 — competitor ran but produced nothing usable AND we have no truth
  //      signal from the user side either. We refuse to decide.
  if (
    competitor.signalCount === 0 &&
    major === 0 && medium === 0 && mild === 0 &&
    user.truthStatus !== "submitted"
  ) {
    return {
      verdict: "INSUFFICIENT_DATA",
      ruleCode: "rule:insufficient_no_market_signal",
      ruleReason: "insufficient_data:no_signals_no_change_events_no_truth",
    };
  }

  // R2 — strong validated motion.
  if (major >= Q2_MAJOR_THRESHOLD) {
    return {
      verdict: "SHIFTED",
      ruleCode: "rule:shifted_major>=1",
      ruleReason: `rule:shifted_major>=${Q2_MAJOR_THRESHOLD}`,
    };
  }
  if (medium >= Q2_MEDIUM_SHIFTED_THRESHOLD) {
    return {
      verdict: "SHIFTED",
      ruleCode: "rule:shifted_medium>=3",
      ruleReason: `rule:shifted_medium>=${Q2_MEDIUM_SHIFTED_THRESHOLD}`,
    };
  }

  // R3 — weak validation only.
  if (medium >= Q2_MEDIUM_UNCERTAIN_THRESHOLD) {
    return {
      verdict: "UNCERTAIN",
      ruleCode: "rule:uncertain_medium",
      ruleReason: `rule:medium>=${Q2_MEDIUM_UNCERTAIN_THRESHOLD}_no_major`,
    };
  }

  // R4 — early/diagnostic signals only. Samir: "do not overreact".
  if (mild >= 1 || competitor.signalCount >= 1) {
    return {
      verdict: "STABLE",
      ruleCode: "rule:stable_early_patterns_only",
      ruleReason: "rule:stable_no_validated_changes_diagnostics_only",
    };
  }

  // R5 — quiet market with operator truth confirming.
  return {
    verdict: "STABLE",
    ruleCode: "rule:stable_quiet_market",
    ruleReason: "rule:stable_no_market_motion",
  };
}

export async function evaluateQ2(inp: Q2Inputs): Promise<Q2EvaluationResult> {
  const now = inp.now ?? new Date();
  const cutoff = new Date(now.getTime() - Q2_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const competitor = inp.competitor ?? (await loadCompetitorSnapshot(
    inp.accountId,
    inp.campaignId,
    cutoff,
  ));

  // Defaults preserve back-compat for legacy call sites that don't pass
  // user/dna context. The decision tree never branches on these — they are
  // descriptive context only.
  const user: Q2UserContext = inp.user ?? {
    truthStatus: null,
    rhythmStatus: null,
    evaluationStatus: null,
  };
  const dna: Q2DnaContext = inp.dna ?? {
    hasActiveDna: false,
    clusterComparisonVerdict: null,
    outcomeRegressed: null,
  };

  // Phase 7.5 — load real Phase 7.3 interpretation from ci_competitor_posts.
  // If the caller injected one (test path) we use that. Otherwise we attempt
  // to read the live corpus; failures are caught and the verdict falls back
  // to severity buckets (back-compat for accounts without the live feed).
  // Architect-flagged 2026-04-24: corpus errors must be persisted in the
  // structured reasons stream, not just console — so audits can see why a
  // verdict was severity-driven instead of interpretation-driven.
  let interpretation = inp.interpretation;
  let corpusError: string | null = null;
  if (!interpretation && !inp.skipCorpusLoad) {
    try {
      const corpus = await readCompetitorCorpus({
        accountId: inp.accountId,
        campaignId: inp.campaignId,
        now,
        lookbackDays: Q2_LOOKBACK_DAYS,
      });
      interpretation = corpus.interpretation;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Classify a few common error shapes so the persisted reason is
      // greppable (e.g. corpus_error=db_unavailable, corpus_error=timeout).
      const code = /timeout/i.test(msg)
        ? "timeout"
        : /econnrefused|connection|unavailable|enotfound/i.test(msg)
          ? "db_unavailable"
          : /relation .* does not exist/i.test(msg)
            ? "schema_missing"
            : "unknown";
      corpusError = code;
      console.warn(`[q2] corpus read failed (${code}), falling back to severity buckets:`, msg);
    }
  }

  const { verdict, ruleCode, ruleReason } = decideQ2(competitor, user, dna, interpretation);

  // Rich, stable reasons stream. Order matters for traceability — corpus
  // snapshot first, then interpretation summary, then context tags, then
  // the rule code that fired.
  const reasons: string[] = [
    `lookback_days=${Q2_LOOKBACK_DAYS}`,
    `competitor_runs=${competitor.recentRunsCount}`,
    `signals=${competitor.signalCount}`,
    `major=${competitor.changeEvents.major}`,
    `medium=${competitor.changeEvents.medium}`,
    `mild=${competitor.changeEvents.mild}`,
  ];
  if (interpretation) {
    reasons.push(
      `corpus_status=${interpretation.corpusStatus}`,
      `corpus_competitors=${interpretation.totals.distinctCompetitors}`,
      `corpus_ig_posts=${interpretation.totals.igPostCount}`,
      `corpus_tiktok_posts=${interpretation.totals.tiktokPostCount}`,
      `corpus_signals=${interpretation.signals.length}`,
      `corpus_diagnostics=${interpretation.diagnostics.length}`,
    );
    for (const s of interpretation.signals) {
      reasons.push(`signal:${s.themeToken}=${s.status}`);
    }
  } else {
    reasons.push("corpus=unavailable_severity_fallback");
    if (corpusError) {
      reasons.push(`corpus_error=${corpusError}`);
    }
  }
  reasons.push(
    `user_truth=${user.truthStatus ?? "null"}`,
    `user_rhythm=${user.rhythmStatus ?? "null"}`,
    `user_evaluation=${user.evaluationStatus ?? "null"}`,
    `dna_active=${dna.hasActiveDna}`,
    `cluster_comparison=${dna.clusterComparisonVerdict ?? "null"}`,
    `outcome_regressed=${dna.outcomeRegressed ?? "null"}`,
    ruleReason,
  );

  return {
    verdict,
    reasons,
    ruleCode,
    inputs: { competitor, user, dna, lookbackDays: Q2_LOOKBACK_DAYS, interpretation },
  };
}
