/**
 * P-2 Final Phase — Performance Loop cycle runner.
 *
 * Closes the loop: user truth (sales) → deterministic scoring → decision
 * verdicts → durable strategic memory → next-cycle recommendation.
 *
 * Doctrine (locked by the P-2 Final brief — DO NOT soften):
 *   D1. Sales (pipeline_user_truth.paying_customers — a COUNT the user typed)
 *       is the ONLY primary success metric. Likes/views/followers are context,
 *       never success. A "WINNING" content verdict with falling sales is a
 *       commercial failure.
 *   D2. Allowed verdicts: WINNER / LOSER / INCONCLUSIVE / NOT_EXECUTED /
 *       NEEDS_MORE_DATA. Nothing else.
 *   D3. A recommendation that was never executed is NOT_EXECUTED. It is never
 *       blamed for (or credited with) a sales change.
 *   D4. NULL is never coerced to 0. Missing paying_customers on either side of
 *       the comparison → NEEDS_MORE_DATA. No fabricated baselines.
 *   D5. No causal claims from code. The deterministic layer emits correlation
 *       language; "strong_evidence" requires the business scorer's DIRECT
 *       attribution (user explicitly linked sales to the channel).
 *   D6. Multiple variables executed in the same window → INCONCLUSIVE for all
 *       of them. Certainty is not available and is not claimed.
 *   D7. Append-only history. A window's verdicts freeze at the first COMPLETE
 *       cycle. Superseded truth does NOT rewrite past verdicts.
 *
 * Deterministic verdict ladder (per recommended decision):
 *   1. executed=false                          → NOT_EXECUTED
 *   2. salesBefore==null || salesAfter==null   → NEEDS_MORE_DATA
 *   3. >1 recommended decisions executed       → INCONCLUSIVE (simultaneous variables)
 *   4. sales moved up   (>= +workingRelativeDelta, or 0→N) → WINNER
 *      sales moved down (<= driftingRelativeDelta, or N→0) → LOSER
 *      otherwise flat                          → INCONCLUSIVE (no meaningful change)
 *
 * Thresholds are imported from BUSINESS_SCORING_THRESHOLDS — one source of
 * truth with the weekly business scorer.
 */
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  ownedPosts,
  publishedPosts,
  studioItems,
  pipelineEvalWindows,
  pipelineUserTruth,
  weeklyBusinessScores,
  performanceDecisionVerdicts,
  performanceCycleReports,
  CONTENT_SCORE_DIMENSIONS,
  type ContentScoreDimension,
  type DecisionVerdict,
  type EvidenceStrength,
  type PerformanceDecisionVerdict,
  type PerformanceCycleReport,
  type PipelineEvalWindow,
  type PipelineUserTruth,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { BUSINESS_SCORING_THRESHOLDS } from "./scoring-config";
import { runContentScoring } from "./content-scorer";
import { runBusinessOutcomeScoring } from "./business-outcome-scorer";
import {
  assemblePerformanceFacts,
  runPerformanceInterpretation,
  type PerformanceFacts,
  type PerformanceInterpretationResult,
} from "./interpretation";
import { upsertByFingerprint } from "../memory-system/store";

const LOG = "[PerformanceCycle]";
export const CYCLE_VERSION = "p2-cycle-runner-v1";

/** Mirrors content-scorer: lineage states whose plan-derived dimensions count. */
const SCORABLE_LINEAGE = ["planned_direct", "planned_matched", "manual_matched"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecommendedDecision {
  dimension: ContentScoreDimension;
  value: string;
  source: "planned_artifact";
}

export interface DecisionEvaluation {
  decision: RecommendedDecision;
  executed: boolean;
  executedPostCount: number;
  verdict: DecisionVerdict;
  verdictReason: string;
  evidenceStrength: EvidenceStrength;
  confidence: number | null;
  confounders: string[];
  contentContext: Array<{ verdict: string; maturity: string; sampleSize: number }>;
}

export type CycleStatus =
  | "COMPLETE"
  | "ALREADY_REPORTED"
  | "NO_WINDOW"
  | "NO_TRUTH"
  | "NO_APPROVED_PLAN"
  /** The truth this run computed with was superseded mid-run — nothing persisted; the newer submission's own cycle reports. */
  | "TRUTH_CHANGED";

export interface CycleRunResult {
  status: CycleStatus;
  reasons: string[];
  cycleRunId: string | null;
  report: PerformanceCycleReport | null;
  verdicts: PerformanceDecisionVerdict[];
  interpretationStatus: "AVAILABLE" | "UNAVAILABLE" | "SKIPPED";
}

export interface RunPerformanceCycleParams {
  accountId: string;
  campaignId: string;
  /** Preferred: the window that just received truth. Falls back to the latest truth-bearing window. */
  windowId?: string;
  /** Owned-channel platform; resolved from window posts when omitted. */
  platform?: string;
  /** Marks every persisted row as a clearly-labelled synthetic verification cycle. */
  testLabel?: string | null;
  /** "run" (default) executes judged LLM interpretation; "skip" keeps the cycle fully deterministic. */
  interpretationMode?: "run" | "skip";
  /** Test seam forwarded to runPerformanceInterpretation. NEVER set in production code. */
  _chatFn?: Parameters<typeof runPerformanceInterpretation>[0]["_chatFn"];
  /** Test seam: awaited immediately before the atomic persist — lets tests
   *  race a truth supersede against the persist guard. NEVER set in production code. */
  _beforePersist?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Sales-direction math (single source: BUSINESS_SCORING_THRESHOLDS)
// ---------------------------------------------------------------------------

type SalesDirection = "increased" | "decreased" | "flat";

export function computeSalesDelta(before: number, after: number): {
  relDelta: number | null;
  direction: SalesDirection;
} {
  if (before === 0 && after === 0) return { relDelta: 0, direction: "flat" };
  if (before === 0) return { relDelta: null, direction: "increased" }; // 0 → N: growth undefined, emergence is real
  const relDelta = (after - before) / before;
  if (after === 0) return { relDelta, direction: "decreased" }; // N → 0: collapse is real
  if (relDelta >= BUSINESS_SCORING_THRESHOLDS.workingRelativeDelta) return { relDelta, direction: "increased" };
  if (relDelta <= BUSINESS_SCORING_THRESHOLDS.driftingRelativeDelta) return { relDelta, direction: "decreased" };
  return { relDelta, direction: "flat" };
}

// ---------------------------------------------------------------------------
// Deterministic verdict logic (pure — unit-testable without DB or LLM)
// ---------------------------------------------------------------------------

export interface VerdictInputs {
  decision: RecommendedDecision;
  executedPostCount: number;
  salesBefore: number | null;
  salesAfter: number | null;
  /** Count of recommended decisions executed in this window (incl. this one). */
  executedDecisionCount: number;
  /** Business scorer attribution for this window (DIRECT/SUPPORTED/CORRELATED/UNKNOWN). */
  attributionConfidence: string;
  /** Truth row's attribution_known flag (user said they know where sales came from). */
  attributionKnown: boolean | null;
  /** Watchtower events inside the window. */
  marketEvents: Array<{ kind: string | null; severity: string }>;
  /** Deterministic content verdicts for this dimension value (context only). */
  contentVerdicts: Array<{ verdict: string; maturity: string; sampleSize: number }>;
}

export function evaluateDecision(inputs: VerdictInputs): Omit<DecisionEvaluation, "decision" | "executed" | "executedPostCount" | "contentContext"> & { executed: boolean } {
  const {
    decision, executedPostCount, salesBefore, salesAfter,
    executedDecisionCount, attributionConfidence, attributionKnown,
    marketEvents, contentVerdicts,
  } = inputs;
  const executed = executedPostCount > 0;
  const confounders: string[] = [];
  const majorMarketEvents = marketEvents.filter((e) => e.severity === "major" || e.severity === "high");
  if (majorMarketEvents.length > 0) {
    confounders.push(
      `market_shift: ${majorMarketEvents.map((e) => e.kind ?? "unclassified").join(", ")} detected by competitor watch during this window`,
    );
  }

  // Rung 1 — never blame (or credit) what was not executed. D3.
  if (!executed) {
    return {
      executed,
      verdict: "NOT_EXECUTED",
      verdictReason:
        `The plan recommended ${decision.dimension}=${decision.value}, but no owned post in this window carried it. ` +
        `Whatever happened to sales this week cannot be attributed to this recommendation — it was never tried.`,
      evidenceStrength: "insufficient_evidence",
      confidence: null,
      confounders,
    };
  }

  // Rung 2 — missing sales input on either side. D4: NULL never becomes 0.
  if (salesBefore === null || salesAfter === null) {
    const missing = [
      salesBefore === null ? "baseline week (paying customers not reported)" : null,
      salesAfter === null ? "this week (paying customers not reported)" : null,
    ].filter(Boolean).join(" and ");
    return {
      executed,
      verdict: "NEEDS_MORE_DATA",
      verdictReason:
        `${decision.dimension}=${decision.value} was executed (${executedPostCount} post${executedPostCount === 1 ? "" : "s"}), ` +
        `but the sales comparison is missing: ${missing}. No verdict is fabricated from vanity metrics — ` +
        `submit paying-customer counts for consecutive weeks to unlock a verdict.`,
      evidenceStrength: "insufficient_evidence",
      confidence: null,
      confounders,
    };
  }

  const { relDelta, direction } = computeSalesDelta(salesBefore, salesAfter);
  const salesLine = `Paying customers ${salesBefore} → ${salesAfter}` +
    (relDelta !== null ? ` (${relDelta >= 0 ? "+" : ""}${Math.round(relDelta * 100)}%)` : " (baseline was 0 — growth rate undefined)");

  // Content-context notes (vanity divergence honesty — D1).
  const winningContent = contentVerdicts.some((v) => v.verdict === "WINNING");
  const underperformingContent = contentVerdicts.some((v) => v.verdict === "UNDERPERFORMING");

  // Rung 3 — simultaneous variables. D6.
  if (executedDecisionCount > 1) {
    confounders.push(`simultaneous_variables: ${executedDecisionCount} recommended decisions were executed in the same window — effects cannot be separated`);
    return {
      executed,
      verdict: "INCONCLUSIVE",
      verdictReason:
        `${salesLine}, but ${executedDecisionCount} recommended changes ran at the same time. ` +
        `${decision.dimension}=${decision.value} is at most a probable contributor — claiming certainty here would be dishonest.`,
      evidenceStrength: "correlation",
      confidence: 0.25,
      confounders,
    };
  }

  // Rung 4 — single executed variable, judge by sales direction only.
  if (direction === "flat") {
    return {
      executed,
      verdict: "INCONCLUSIVE",
      verdictReason:
        `${decision.dimension}=${decision.value} was executed (${executedPostCount} post${executedPostCount === 1 ? "" : "s"}), ` +
        `and ${salesLine} — inside the noise threshold (±${Math.round(BUSINESS_SCORING_THRESHOLDS.workingRelativeDelta * 100)}%). ` +
        `No meaningful sales movement either way.`,
      evidenceStrength: "correlation",
      confidence: 0.25,
      confounders,
    };
  }

  // Evidence strength from attribution — capped by market confounders. D5.
  let evidenceStrength: EvidenceStrength =
    attributionConfidence === "DIRECT" ? "strong_evidence"
    : attributionConfidence === "SUPPORTED" ? "probable_contribution"
    : "correlation";
  if (majorMarketEvents.length > 0 && evidenceStrength === "strong_evidence") {
    evidenceStrength = "probable_contribution";
  }

  // Confidence — deterministic, documented, clamped.
  let confidence = 0.5;
  if (attributionConfidence === "DIRECT") confidence += 0.25;
  else if (attributionConfidence === "SUPPORTED") confidence += 0.15;
  if (attributionKnown === true) confidence += 0.05;
  if (executedPostCount >= 3) confidence += 0.1;
  if (relDelta !== null && Math.abs(relDelta) >= 0.5) confidence += 0.05;
  if (majorMarketEvents.length > 0) confidence -= 0.15;
  confidence = Math.min(0.9, Math.max(0.1, confidence));

  if (direction === "increased") {
    const vanityNote = underperformingContent
      ? " Engagement metrics were DOWN for this content — sales outrank vanity metrics, so this still counts as a win."
      : "";
    return {
      executed,
      verdict: "WINNER",
      verdictReason:
        `${decision.dimension}=${decision.value} was the only recommended change executed this window and ${salesLine}. ` +
        `This is ${evidenceStrength === "strong_evidence" ? "directly attributed by the user" : "a correlation, not proven causation"}.${vanityNote}`,
      evidenceStrength,
      confidence,
      confounders,
    };
  }

  // direction === "decreased"
  const vanityNote = winningContent
    ? " Engagement metrics were UP for this content — but engagement does not pay invoices. Falling sales make this a commercial failure."
    : "";
  return {
    executed,
    verdict: "LOSER",
    verdictReason:
      `${decision.dimension}=${decision.value} was the only recommended change executed this window and ${salesLine}. ` +
      `${evidenceStrength === "strong_evidence" ? "The user directly attributed sales to this channel." : "This is a correlation, not proven causation."}${vanityNote}`,
    evidenceStrength,
    confidence,
    confounders,
  };
}

// ---------------------------------------------------------------------------
// Recommended-decision extraction (planned artifacts = the operationalized plan)
// ---------------------------------------------------------------------------

/**
 * The plan's standing recommendations = distinct dimension values carried by
 * planned artifacts (published_posts + studio_items rows bound to the plan).
 * Free-text plan_json pillars are NOT fuzzy-matched — only vocabulary that can
 * be honestly compared against owned-post lineage dimensions counts.
 */
export async function loadRecommendedDecisions(
  accountId: string,
  campaignId: string,
  planId: string,
): Promise<RecommendedDecision[]> {
  const [pubRows, studioRows] = await Promise.all([
    db
      .select({ hookStyle: publishedPosts.hookStyle, contentAngle: publishedPosts.contentAngle })
      .from(publishedPosts)
      .where(and(
        eq(publishedPosts.accountId, accountId),
        eq(publishedPosts.campaignId, campaignId),
        eq(publishedPosts.planId, planId),
      )),
    db
      .select({ contentAngle: studioItems.contentAngle, contentType: studioItems.contentType })
      .from(studioItems)
      .where(and(
        eq(studioItems.accountId, accountId),
        eq(studioItems.campaignId, campaignId),
        eq(studioItems.planId, planId),
      )),
  ]);

  const byDimension = new Map<ContentScoreDimension, Set<string>>();
  const add = (dim: ContentScoreDimension, value: string | null) => {
    const v = (value ?? "").trim();
    if (!v) return;
    if (!byDimension.has(dim)) byDimension.set(dim, new Set());
    byDimension.get(dim)!.add(v);
  };
  for (const r of pubRows) {
    add("hook_style", r.hookStyle);
    add("content_angle", r.contentAngle);
  }
  for (const r of studioRows) {
    add("content_angle", r.contentAngle);
    add("content_type", r.contentType);
  }

  const decisions: RecommendedDecision[] = [];
  for (const dim of CONTENT_SCORE_DIMENSIONS) {
    for (const value of byDimension.get(dim) ?? []) {
      decisions.push({ dimension: dim, value, source: "planned_artifact" });
    }
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Window + truth resolution
// ---------------------------------------------------------------------------

async function resolveWindow(
  accountId: string,
  campaignId: string,
  windowId?: string,
): Promise<PipelineEvalWindow | null> {
  if (windowId) {
    const rows = await db
      .select()
      .from(pipelineEvalWindows)
      .where(and(
        eq(pipelineEvalWindows.id, windowId),
        eq(pipelineEvalWindows.accountId, accountId),
        eq(pipelineEvalWindows.campaignId, campaignId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }
  // Latest window that actually has truth attached (closed_with_truth / late_filled).
  const rows = await db
    .select()
    .from(pipelineEvalWindows)
    .where(and(
      eq(pipelineEvalWindows.accountId, accountId),
      eq(pipelineEvalWindows.campaignId, campaignId),
      inArray(pipelineEvalWindows.state, ["closed_with_truth", "late_filled"]),
    ))
    .orderBy(desc(pipelineEvalWindows.windowEnd))
    .limit(1);
  return rows[0] ?? null;
}

async function loadActiveTruth(windowId: string): Promise<PipelineUserTruth | null> {
  const rows = await db
    .select()
    .from(pipelineUserTruth)
    .where(and(eq(pipelineUserTruth.windowId, windowId), isNull(pipelineUserTruth.supersededAt)))
    .orderBy(desc(pipelineUserTruth.submittedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function loadPreviousTruth(
  accountId: string,
  campaignId: string,
  planId: string,
  windowIndex: number,
): Promise<PipelineUserTruth | null> {
  if (windowIndex <= 0) return null;
  const prevWindows = await db
    .select()
    .from(pipelineEvalWindows)
    .where(and(
      eq(pipelineEvalWindows.accountId, accountId),
      eq(pipelineEvalWindows.campaignId, campaignId),
      eq(pipelineEvalWindows.planId, planId),
      eq(pipelineEvalWindows.windowIndex, windowIndex - 1),
    ))
    .limit(1);
  const prev = prevWindows[0];
  if (!prev) return null;
  return loadActiveTruth(prev.id);
}

// ---------------------------------------------------------------------------
// Main cycle
// ---------------------------------------------------------------------------

export async function runPerformanceCycle(params: RunPerformanceCycleParams): Promise<CycleRunResult> {
  const { accountId, campaignId } = params;
  const cycleRunId = `pcr_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const reasons: string[] = [];
  const empty = (status: CycleStatus): CycleRunResult => ({
    status, reasons, cycleRunId: null, report: null, verdicts: [], interpretationStatus: "SKIPPED",
  });

  // 1) Window.
  const window = await resolveWindow(accountId, campaignId, params.windowId);
  if (!window) {
    reasons.push(params.windowId ? "window_not_found" : "no_truth_bearing_window");
    console.log(`${LOG} NO_WINDOW campaign=${campaignId} reasons=${reasons.join(",")}`);
    return empty("NO_WINDOW");
  }
  if (!window.planId) {
    reasons.push("window_has_no_plan");
    return empty("NO_APPROVED_PLAN");
  }

  // 2) Freeze guard (D7): if this window already has a COMPLETE report, return it untouched.
  const existing = await db
    .select()
    .from(performanceCycleReports)
    .where(and(eq(performanceCycleReports.campaignId, campaignId), eq(performanceCycleReports.windowId, window.id)))
    .limit(1);
  if (existing[0]) {
    const frozenVerdicts = await db
      .select()
      .from(performanceDecisionVerdicts)
      .where(and(eq(performanceDecisionVerdicts.campaignId, campaignId), eq(performanceDecisionVerdicts.windowId, window.id)));
    reasons.push("window_already_reported_history_frozen");
    console.log(`${LOG} ALREADY_REPORTED campaign=${campaignId} window=${window.id}`);
    return {
      status: "ALREADY_REPORTED",
      reasons,
      cycleRunId: existing[0].cycleRunId,
      report: existing[0],
      verdicts: frozenVerdicts,
      interpretationStatus: (existing[0].interpretationStatus as any) ?? "SKIPPED",
    };
  }

  // 3) Truth (Scenario 7: no truth → wait, fabricate nothing, persist nothing).
  const truth = await loadActiveTruth(window.id);
  if (!truth) {
    reasons.push("no_truth_for_window — the weekly sales report has not been submitted; the loop waits");
    console.log(`${LOG} NO_TRUTH campaign=${campaignId} window=${window.id}`);
    return empty("NO_TRUTH");
  }
  const prevTruth = await loadPreviousTruth(accountId, campaignId, window.planId, window.windowIndex);
  if (!prevTruth && window.windowIndex > 0) reasons.push("previous_window_truth_missing");
  if (window.windowIndex === 0) reasons.push("first_window_of_plan_no_baseline");

  const salesAfter = truth.payingCustomers ?? null;
  const salesBefore = prevTruth?.payingCustomers ?? null;

  // 4) Executed posts in the window (scorable lineage only).
  const windowPosts = await db
    .select()
    .from(ownedPosts)
    .where(and(
      eq(ownedPosts.accountId, accountId),
      eq(ownedPosts.campaignId, campaignId),
      inArray(ownedPosts.lineageState, [...SCORABLE_LINEAGE]),
      gte(ownedPosts.postedAt, window.windowStart),
      lt(ownedPosts.postedAt, window.windowEnd),
    ));

  // Platform: explicit param > dominant among window posts > instagram.
  let platform = params.platform ?? null;
  if (!platform) {
    const counts = new Map<string, number>();
    for (const p of windowPosts) counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1);
    platform = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "instagram";
    if (windowPosts.length === 0) reasons.push("platform_defaulted_no_window_posts");
  }

  // 5) Refresh deterministic scorers (append-only, idempotent by design).
  try {
    await runContentScoring({ accountId, campaignId, platform });
  } catch (err: any) {
    reasons.push(`content_scoring_failed: ${err?.message ?? err}`);
    console.error(`${LOG} content scoring failed campaign=${campaignId}:`, err?.message ?? err);
  }
  try {
    await runBusinessOutcomeScoring({ accountId, campaignId });
  } catch (err: any) {
    reasons.push(`business_scoring_failed: ${err?.message ?? err}`);
    console.error(`${LOG} business scoring failed campaign=${campaignId}:`, err?.message ?? err);
  }

  // 6) Facts (content scores, business score, watchtower events).
  const facts: PerformanceFacts = await assemblePerformanceFacts({ accountId, campaignId, platform });
  const windowBizRows = await db
    .select()
    .from(weeklyBusinessScores)
    .where(and(
      eq(weeklyBusinessScores.accountId, accountId),
      eq(weeklyBusinessScores.campaignId, campaignId),
      eq(weeklyBusinessScores.windowId, window.id),
    ))
    .orderBy(desc(weeklyBusinessScores.scoredAt))
    .limit(1);
  const windowBiz = windowBizRows[0] ?? facts.businessScore;
  const attributionConfidence = windowBiz?.attributionConfidence ?? "UNKNOWN";
  const businessVerdict = windowBiz?.businessVerdict ?? null;

  const windowMarketEvents = facts.watchtowerEvents.filter((e) => {
    if (!e.createdAt) return false;
    const t = new Date(e.createdAt).getTime();
    return t >= window.windowStart.getTime() && t < window.windowEnd.getTime();
  });

  // 7) Recommended decisions from planned artifacts.
  const recommended = await loadRecommendedDecisions(accountId, campaignId, window.planId);
  if (recommended.length === 0) reasons.push("no_trackable_recommendations_in_plan_artifacts");

  // 8) Evaluate each decision deterministically.
  const executedCountsByDecision = new Map<string, number>();
  for (const d of recommended) {
    const count = windowPosts.filter((p) => {
      const v = d.dimension === "hook_style" ? p.hookStyle : d.dimension === "content_angle" ? p.contentAngle : p.contentType;
      return (v ?? "").trim().toLowerCase() === d.value.toLowerCase();
    }).length;
    executedCountsByDecision.set(`${d.dimension}:${d.value}`, count);
  }
  const executedDecisionCount = [...executedCountsByDecision.values()].filter((c) => c > 0).length;

  const evaluations: DecisionEvaluation[] = recommended.map((decision) => {
    const executedPostCount = executedCountsByDecision.get(`${decision.dimension}:${decision.value}`) ?? 0;
    const contentVerdicts = facts.contentScores
      .filter((r) => r.dimension === decision.dimension && (r.dimensionValue ?? "").toLowerCase() === decision.value.toLowerCase())
      .map((r) => ({ verdict: r.verdict, maturity: r.maturity, sampleSize: r.sampleSize ?? 0 }));
    const evaluated = evaluateDecision({
      decision,
      executedPostCount,
      salesBefore,
      salesAfter,
      executedDecisionCount,
      attributionConfidence,
      attributionKnown: truth.attributionKnown ?? null,
      marketEvents: windowMarketEvents,
      contentVerdicts,
    });
    return {
      decision,
      executed: evaluated.executed,
      executedPostCount,
      verdict: evaluated.verdict,
      verdictReason: evaluated.verdictReason,
      evidenceStrength: evaluated.evidenceStrength,
      confidence: evaluated.confidence,
      confounders: evaluated.confounders,
      contentContext: contentVerdicts,
    };
  });

  const { relDelta } = salesBefore !== null && salesAfter !== null
    ? computeSalesDelta(salesBefore, salesAfter)
    : { relDelta: null as number | null };

  const funnelContext = JSON.stringify({
    before: prevTruth
      ? { leads: prevTruth.totalLeads, qualified: prevTruth.qualifiedLeads, booked: prevTruth.bookedCalls, payingCustomers: prevTruth.payingCustomers }
      : null,
    after: { leads: truth.totalLeads, qualified: truth.qualifiedLeads, booked: truth.bookedCalls, payingCustomers: truth.payingCustomers },
  });
  const marketContextJson = JSON.stringify({
    eventsInWindow: windowMarketEvents.length,
    events: windowMarketEvents.slice(0, 20),
  });

  // 9) Judged LLM interpretation (optional; fail-closed; never blocks the
  //    cycle). Runs BEFORE persist so the atomic section below stays short —
  //    an LLM call must never sit inside a transaction holding a lock.
  let interpretationStatus: "AVAILABLE" | "UNAVAILABLE" | "SKIPPED" = "SKIPPED";
  let interpretation: PerformanceInterpretationResult | null = null;
  if ((params.interpretationMode ?? "run") === "run") {
    try {
      interpretation = await runPerformanceInterpretation({
        accountId, campaignId, platform,
        ...(params._chatFn !== undefined ? { _chatFn: params._chatFn } : {}),
      });
      interpretationStatus = interpretation.status;
      if (interpretation.status === "UNAVAILABLE" && interpretation.unavailableReason) {
        reasons.push(`interpretation_unavailable: ${interpretation.unavailableReason}`);
      }
    } catch (err: any) {
      interpretationStatus = "UNAVAILABLE";
      reasons.push(`interpretation_failed: ${err?.message ?? err}`);
      console.error(`${LOG} interpretation failed campaign=${campaignId}:`, err?.message ?? err);
    }
  }

  // 10) Next-cycle recommendation (deterministic composition + judged experiment).
  const summarize = (ev: DecisionEvaluation) => ({
    dimension: ev.decision.dimension,
    value: ev.decision.value,
    verdict: ev.verdict,
    reason: ev.verdictReason,
    evidenceStrength: ev.evidenceStrength,
    confidence: ev.confidence,
  });
  const preserve = evaluations.filter((e) => e.verdict === "WINNER").map(summarize);
  const reject = evaluations.filter((e) => e.verdict === "LOSER").map(summarize);
  const uncertain = evaluations.filter((e) => e.verdict === "INCONCLUSIVE" || e.verdict === "NEEDS_MORE_DATA").map(summarize);
  const notExecuted = evaluations.filter((e) => e.verdict === "NOT_EXECUTED").map(summarize);

  const nextExperiment = interpretation?.interpretation?.nextExperiment ?? null;
  const nextCycleRecommendation = JSON.stringify({
    keepDoing: preserve.map((p) => `${p.dimension}=${p.value}`),
    stopDoing: reject.map((p) => `${p.dimension}=${p.value}`),
    retryWithBetterData: uncertain.map((p) => `${p.dimension}=${p.value}`),
    executeWhatWasPlanned: notExecuted.map((p) => `${p.dimension}=${p.value}`),
    nextExperiment,
    rationale:
      preserve.length + reject.length > 0
        ? "Verdicts are sales-driven. Reinforced winners and rejected losers are now in strategic memory and will shape the next plan."
        : "No sales-proven winner or loser this window. The honest move is better execution/data next week, not invented conclusions.",
  });

  const verdictCounts: Record<string, number> = {};
  for (const ev of evaluations) verdictCounts[ev.verdict] = (verdictCounts[ev.verdict] ?? 0) + 1;

  const sevenAnswers = JSON.stringify({
    q1_what_was_recommended: recommended.map((d) => `${d.dimension}=${d.value}`),
    q2_what_was_executed: evaluations.filter((e) => e.executed).map((e) => `${e.decision.dimension}=${e.decision.value} (${e.executedPostCount} posts)`),
    q3_what_happened_to_sales: {
      payingCustomersBefore: salesBefore,
      payingCustomersAfter: salesAfter,
      relativeDelta: relDelta,
      businessVerdict,
      note: salesBefore === null || salesAfter === null ? "sales comparison incomplete — missing paying-customer count" : null,
    },
    q4_verdicts: verdictCounts,
    q5_why: evaluations.map((e) => ({ decision: `${e.decision.dimension}=${e.decision.value}`, verdict: e.verdict, reason: e.verdictReason })),
    q6_confounders: [...new Set(evaluations.flatMap((e) => e.confounders))],
    q7_next_step: JSON.parse(nextCycleRecommendation),
  });

  // 11) ATOMIC PERSIST — verdicts + report in one transaction, serialized
  //     per window by an advisory lock. Inside the lock we re-check both
  //     invariants this run computed under:
  //       a) the window is still unreported (freeze / D7), and
  //       b) the truth used for the math is STILL the active truth — if a
  //          superseding submission landed mid-run, persisting would freeze
  //          stale sales into history, so we abort and let the newer
  //          submission's own trigger report instead.
  if (params._beforePersist) await params._beforePersist();

  type PersistOutcome =
    | { kind: "COMPLETE"; inserted: PerformanceDecisionVerdict[]; report: PerformanceCycleReport }
    | { kind: "FROZEN" }
    | { kind: "TRUTH_CHANGED" };

  const outcome: PersistOutcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${window.id})::bigint)`);

    const frozen = await tx
      .select({ id: performanceCycleReports.id })
      .from(performanceCycleReports)
      .where(and(eq(performanceCycleReports.campaignId, campaignId), eq(performanceCycleReports.windowId, window.id)))
      .limit(1);
    if (frozen[0]) return { kind: "FROZEN" as const };

    const activeNow = await tx
      .select({ id: pipelineUserTruth.id })
      .from(pipelineUserTruth)
      .where(and(eq(pipelineUserTruth.windowId, window.id), isNull(pipelineUserTruth.supersededAt)))
      .orderBy(desc(pipelineUserTruth.submittedAt))
      .limit(1);
    if (!activeNow[0] || activeNow[0].id !== truth.id) return { kind: "TRUTH_CHANGED" as const };

    const inserted: PerformanceDecisionVerdict[] = [];
    for (const ev of evaluations) {
      const rows = await tx
        .insert(performanceDecisionVerdicts)
        .values({
          accountId,
          campaignId,
          cycleRunId,
          windowId: window.id,
          windowIndex: window.windowIndex,
          planId: window.planId,
          platform,
          decisionDimension: ev.decision.dimension,
          decisionValue: ev.decision.value,
          decisionSource: ev.decision.source,
          executed: ev.executed,
          executedPostCount: ev.executedPostCount,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          salesBefore,
          salesAfter,
          salesDeltaRel: relDelta,
          funnelContext,
          contentContext: JSON.stringify(ev.contentContext),
          marketContext: marketContextJson,
          confounders: JSON.stringify(ev.confounders),
          verdict: ev.verdict,
          verdictReason: ev.verdictReason,
          evidenceStrength: ev.evidenceStrength,
          confidence: ev.confidence,
          attributionConfidence,
          memoryWriteStatus: null,
          testLabel: params.testLabel ?? null,
          verdictVersion: CYCLE_VERSION,
        })
        .onConflictDoNothing({
          target: [
            performanceDecisionVerdicts.campaignId,
            performanceDecisionVerdicts.windowId,
            performanceDecisionVerdicts.decisionDimension,
            performanceDecisionVerdicts.decisionValue,
          ],
        })
        .returning();
      if (rows[0]) inserted.push(rows[0]);
    }

    const reportRows = await tx
      .insert(performanceCycleReports)
      .values({
        accountId,
        campaignId,
        cycleRunId,
        windowId: window.id,
        windowIndex: window.windowIndex,
        planId: window.planId,
        platform,
        status: "COMPLETE",
        salesBefore,
        salesAfter,
        businessVerdict,
        attributionConfidence,
        decisionsTotal: evaluations.length,
        verdictCounts: JSON.stringify(verdictCounts),
        preserve: JSON.stringify(preserve),
        reject: JSON.stringify(reject),
        uncertain: JSON.stringify(uncertain),
        notExecuted: JSON.stringify(notExecuted),
        nextCycleRecommendation,
        interpretationStatus,
        sevenAnswers,
        testLabel: params.testLabel ?? null,
        cycleVersion: CYCLE_VERSION,
      })
      .onConflictDoNothing({
        target: [performanceCycleReports.campaignId, performanceCycleReports.windowId],
      })
      .returning();
    const report = reportRows[0];
    if (!report) return { kind: "FROZEN" as const }; // unreachable under the lock; belt only
    return { kind: "COMPLETE" as const, inserted, report };
  });

  if (outcome.kind === "FROZEN") {
    reasons.push("concurrent_cycle_won_freeze");
    const winner = await db
      .select()
      .from(performanceCycleReports)
      .where(and(eq(performanceCycleReports.campaignId, campaignId), eq(performanceCycleReports.windowId, window.id)))
      .limit(1);
    const frozenVerdicts = await db
      .select()
      .from(performanceDecisionVerdicts)
      .where(and(eq(performanceDecisionVerdicts.campaignId, campaignId), eq(performanceDecisionVerdicts.windowId, window.id)));
    console.log(`${LOG} ALREADY_REPORTED campaign=${campaignId} window=${window.id} (lost persist race)`);
    return {
      status: "ALREADY_REPORTED",
      reasons,
      cycleRunId: winner[0]?.cycleRunId ?? cycleRunId,
      report: winner[0] ?? null,
      verdicts: frozenVerdicts,
      interpretationStatus,
    };
  }
  if (outcome.kind === "TRUTH_CHANGED") {
    reasons.push(
      "active_truth_superseded_mid_run — a newer weekly report replaced the numbers this cycle was computing with; " +
      "nothing was persisted, the newer submission's own cycle reports instead",
    );
    console.log(`${LOG} TRUTH_CHANGED campaign=${campaignId} window=${window.id}`);
    return { status: "TRUTH_CHANGED", reasons, cycleRunId: null, report: null, verdicts: [], interpretationStatus };
  }
  const { inserted } = outcome;
  const report = outcome.report;

  // 12) Strategic-memory write-through — WINNER→reinforce, LOSER→avoid.
  //     Only for rows inserted by THIS run (idempotency), via the canonical
  //     policy-gated store. The loop's learning persists into the same
  //     strategy_memory the plan generator already consumes. Runs AFTER the
  //     commit — memory must never reference verdicts that failed to land.
  for (const row of inserted) {
    if (row.verdict !== "WINNER" && row.verdict !== "LOSER") continue;
    let memoryWriteStatus: string;
    try {
      const result = await upsertByFingerprint({
        accountId,
        campaignId,
        memoryType: "iteration_direction",
        engineName: "performance_cycle_runner",
        label: `${row.decisionDimension}:${row.decisionValue}`,
        details:
          `${row.verdict} in window ${row.windowIndex} (${row.windowStart.toISOString().slice(0, 10)} → ${row.windowEnd.toISOString().slice(0, 10)}). ` +
          `Paying customers ${row.salesBefore} → ${row.salesAfter}. ${row.evidenceStrength}. ${row.verdictReason}`,
        performance: `payingCustomers ${row.salesBefore}→${row.salesAfter}`,
        score: Math.round((row.confidence ?? 0) * 100),
        confidenceScore: row.confidence ?? 0,
        direction: row.verdict === "WINNER" ? "reinforce" : "avoid",
        planId: row.planId,
        provenanceOrigin: "outcome",
        platform,
      });
      memoryWriteStatus = result.allowed ? "written" : `blocked:${result.reason}`;
    } catch (err: any) {
      memoryWriteStatus = `failed:${(err?.message ?? String(err)).slice(0, 200)}`;
      console.error(`${LOG} memory write failed for ${row.decisionDimension}=${row.decisionValue}:`, err?.message ?? err);
    }
    await db
      .update(performanceDecisionVerdicts)
      .set({ memoryWriteStatus })
      .where(eq(performanceDecisionVerdicts.id, row.id));
    row.memoryWriteStatus = memoryWriteStatus;
  }

  const allVerdicts = await db
    .select()
    .from(performanceDecisionVerdicts)
    .where(and(eq(performanceDecisionVerdicts.campaignId, campaignId), eq(performanceDecisionVerdicts.windowId, window.id)));

  console.log(
    `${LOG} COMPLETE campaign=${campaignId} window=${window.windowIndex} run=${cycleRunId} ` +
    `decisions=${evaluations.length} verdicts=${JSON.stringify(verdictCounts)} sales=${salesBefore}→${salesAfter} interp=${interpretationStatus}`,
  );

  return { status: "COMPLETE", reasons, cycleRunId, report, verdicts: allVerdicts, interpretationStatus };
}
