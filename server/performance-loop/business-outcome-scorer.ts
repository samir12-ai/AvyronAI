/**
 * P-2 Phase 4 — Weekly business outcome scoring (deterministic, code-only).
 *
 * Truth source: pipeline_user_truth rows FK-bound to pipeline_eval_windows.
 * READER RULE (architect-locked): a window is "closed" when windowEnd <= now
 * — never inferred from state='open', which can lag the clock.
 *
 * Honesty invariants:
 *   - A missing week is MISSING, never zero.
 *   - payingCustomers is a COUNT from user input. It is NEVER derived from
 *     the legacy paidActive boolean (D4).
 *   - Rates with a missing or zero denominator are NULL, never 0.
 *   - Verdict compares against the account's own trailing weeks only.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import {
  pipelineEvalWindows,
  pipelineUserTruth,
  weeklyBusinessScores,
  type PipelineEvalWindow,
  type PipelineUserTruth,
  type BusinessVerdict,
  type AttributionConfidence,
  type WeeklyBusinessScore,
} from "@shared/schema";
import { and, eq, lte, asc, inArray } from "drizzle-orm";
import { BUSINESS_SCORER_VERSION, BUSINESS_SCORING_THRESHOLDS } from "./scoring-config";

const T = BUSINESS_SCORING_THRESHOLDS;

interface WeekRecord {
  window: PipelineEvalWindow;
  truth: PipelineUserTruth | null;
}

export interface BusinessScoreRunResult {
  scoreRunId: string;
  scoredAt: Date;
  windowsClosed: number;
  windowsWithTruth: number;
  row: WeeklyBusinessScore | null;
  persistFailures: number;
}

/** Honest rate: NULL whenever numerator or denominator missing, or denom 0. */
function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

/** Relative WoW delta; NULL when previous is missing or 0 (undefined growth). */
function relDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

function stageValues(truth: PipelineUserTruth | null): {
  leads: number | null;
  qualified: number | null;
  booked: number | null;
  paying: number | null;
} {
  if (!truth) return { leads: null, qualified: null, booked: null, paying: null };
  return {
    leads: truth.totalLeads,
    qualified: truth.qualifiedLeads,
    booked: truth.bookedCalls,
    // COUNT only — never derived from paidActive (D4).
    paying: truth.payingCustomers ?? null,
  };
}

function trailingMean(values: Array<number | null>): { mean: number | null; weeksUsed: number } {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return { mean: null, weeksUsed: 0 };
  return { mean: present.reduce((a, b) => a + b, 0) / present.length, weeksUsed: present.length };
}

/**
 * Score the most recent time-closed window for a campaign. Appends exactly
 * one weekly_business_scores row (previous runs stay queryable).
 */
export async function runBusinessOutcomeScoring(params: {
  accountId: string;
  campaignId: string;
}): Promise<BusinessScoreRunResult> {
  const { accountId, campaignId } = params;
  const scoredAt = new Date();
  const scoreRunId = `bsr_${scoredAt.getTime()}_${randomUUID().slice(0, 8)}`;
  const tag = `campaign=${campaignId} run=${scoreRunId}`;

  const result: BusinessScoreRunResult = {
    scoreRunId,
    scoredAt,
    windowsClosed: 0,
    windowsWithTruth: 0,
    row: null,
    persistFailures: 0,
  };

  // Time-closed windows only (windowEnd <= now), oldest first.
  const windows = await db
    .select()
    .from(pipelineEvalWindows)
    .where(
      and(
        eq(pipelineEvalWindows.accountId, accountId),
        eq(pipelineEvalWindows.campaignId, campaignId),
        lte(pipelineEvalWindows.windowEnd, scoredAt),
      ),
    )
    .orderBy(asc(pipelineEvalWindows.windowEnd));
  result.windowsClosed = windows.length;

  if (windows.length === 0) {
    console.log(`[BusinessScorer] BUSINESS_OUTCOME_INCOMPLETE ${tag} reason=no_closed_windows`);
    return result;
  }

  // Resolve current (non-superseded) truth per window via window.truthId.
  const truthIds = windows.map((w) => w.truthId).filter((id): id is string => !!id);
  const truthRows = truthIds.length
    ? await db.select().from(pipelineUserTruth).where(inArray(pipelineUserTruth.id, truthIds))
    : [];
  const truthById = new Map(truthRows.map((t) => [t.id, t]));

  const weeks: WeekRecord[] = windows.map((w) => ({
    window: w,
    truth: w.truthId ? truthById.get(w.truthId) ?? null : null,
  }));
  result.windowsWithTruth = weeks.filter((w) => w.truth !== null).length;

  const target = weeks[weeks.length - 1];
  const prior = weeks.slice(0, -1);
  const priorWithTruth = prior.filter((w) => w.truth !== null);

  const cur = stageValues(target.truth);
  const missingFields: string[] = [];
  if (target.truth === null) missingFields.push("truth");
  else {
    if (target.truth.payingCustomers === null || target.truth.payingCustomers === undefined) {
      missingFields.push("payingCustomers");
    }
    if (!target.truth.leadSource) missingFields.push("leadSource");
    if (!target.truth.leadChannel) missingFields.push("leadChannel");
    if (target.truth.attributionKnown === null || target.truth.attributionKnown === undefined) {
      missingFields.push("attributionKnown");
    }
  }

  // Rates (NULL on missing/zero denominator).
  const leadToQualifiedRate = rate(cur.qualified, cur.leads);
  const qualifiedToBookedRate = rate(cur.booked, cur.qualified);
  const bookedToPayingRate = rate(cur.paying, cur.booked);
  const leadToPayingRate = rate(cur.paying, cur.leads);

  // WoW deltas vs the most recent PRIOR week with truth (missing week ≠ zero).
  const prev = priorWithTruth.length > 0 ? stageValues(priorWithTruth[priorWithTruth.length - 1].truth) : null;
  const wowDeltaLeads = prev ? relDelta(cur.leads, prev.leads) : null;
  const wowDeltaQualified = prev ? relDelta(cur.qualified, prev.qualified) : null;
  const wowDeltaBooked = prev ? relDelta(cur.booked, prev.booked) : null;
  const wowDeltaPaying = prev ? relDelta(cur.paying, prev.paying) : null;

  // Trailing self-baseline over up to T.baselineWeeks prior weeks with truth.
  const baselinePool = priorWithTruth.slice(-T.baselineWeeks).map((w) => stageValues(w.truth));
  const bLeads = trailingMean(baselinePool.map((s) => s.leads));
  const bQualified = trailingMean(baselinePool.map((s) => s.qualified));
  const bBooked = trailingMean(baselinePool.map((s) => s.booked));
  const bPaying = trailingMean(baselinePool.map((s) => s.paying));
  const baselineWeeks = baselinePool.length > 0 ? baselinePool.length : null;
  const baseline =
    baselinePool.length > 0
      ? JSON.stringify({
          leads: bLeads.mean,
          qualified: bQualified.mean,
          booked: bBooked.mean,
          paying: bPaying.mean,
          weeksUsed: {
            leads: bLeads.weeksUsed,
            qualified: bQualified.weeksUsed,
            booked: bBooked.weeksUsed,
            paying: bPaying.weeksUsed,
          },
        })
      : null;

  // ── Verdict (WORKING | DRIFTING | UNKNOWN) ───────────────────────────────
  let businessVerdict: BusinessVerdict;
  let verdictReason: string;
  if (target.truth === null) {
    businessVerdict = "UNKNOWN";
    verdictReason = "no truth submitted for the evaluated week";
    console.log(`[BusinessScorer] BUSINESS_OUTCOME_INCOMPLETE ${tag} window=${target.window.id} reason=missing_truth`);
  } else if (priorWithTruth.length < T.minPriorWeeks) {
    businessVerdict = "UNKNOWN";
    verdictReason = `only ${priorWithTruth.length} prior week(s) with truth; need ${T.minPriorWeeks} for a trend verdict`;
    console.log(
      `[BusinessScorer] BUSINESS_OUTCOME_INCOMPLETE ${tag} window=${target.window.id} priorWeeks=${priorWithTruth.length} min=${T.minPriorWeeks}`,
    );
  } else {
    const stageDeltas: Array<{ stage: string; d: number | null }> = [
      { stage: "leads", d: relDelta(cur.leads, bLeads.mean) },
      { stage: "qualified", d: relDelta(cur.qualified, bQualified.mean) },
      { stage: "booked", d: relDelta(cur.booked, bBooked.mean) },
      { stage: "paying", d: relDelta(cur.paying, bPaying.mean) },
    ];
    const deteriorating = stageDeltas.filter((s) => s.d !== null && s.d <= T.driftingRelativeDelta);
    const improving = stageDeltas.filter((s) => s.d !== null && s.d >= T.workingRelativeDelta);
    const computableDeltas = stageDeltas.filter((s) => s.d !== null);
    if (deteriorating.length >= T.driftingMinStages) {
      businessVerdict = "DRIFTING";
      verdictReason = `deteriorating vs trailing baseline: ${deteriorating.map((s) => s.stage).join(", ")}`;
    } else if (improving.length > 0) {
      businessVerdict = "WORKING";
      verdictReason = `improving vs trailing baseline: ${improving.map((s) => s.stage).join(", ")}`;
    } else if (computableDeltas.length >= T.minComputableStagesForSteady) {
      // "Holding steady" is only claimable when enough stage deltas were
      // actually computable — B1: no verdict on indeterminate evidence.
      businessVerdict = "WORKING";
      verdictReason = `holding steady vs trailing baseline (${computableDeltas.length} stage(s) measurable)`;
    } else {
      businessVerdict = "UNKNOWN";
      verdictReason = `only ${computableDeltas.length} stage delta(s) computable; need ${T.minComputableStagesForSteady} to claim holding steady`;
      console.log(
        `[BusinessScorer] BUSINESS_OUTCOME_INCOMPLETE ${tag} window=${target.window.id} reason=insufficient_stage_deltas computable=${computableDeltas.length} min=${T.minComputableStagesForSteady}`,
      );
    }
  }

  // ── Attribution confidence (never guessed above the evidence) ───────────
  let attributionConfidence: AttributionConfidence;
  let attributionBasis: string | null = null;
  const t = target.truth;
  if (t && t.attributionKnown === true && (t.relatedPostUrl || t.relatedCampaign)) {
    attributionConfidence = "DIRECT";
    attributionBasis = t.relatedPostUrl
      ? `user linked a specific post: ${t.relatedPostUrl}`
      : `user linked campaign: ${t.relatedCampaign}`;
  } else if (t && t.attributionKnown === true && (t.leadSource || t.leadChannel)) {
    attributionConfidence = "SUPPORTED";
    attributionBasis = `user confirmed source: ${[t.leadSource, t.leadChannel].filter(Boolean).join(" / ")}`;
  } else if (t && (t.leadSource || t.leadChannel)) {
    attributionConfidence = "CORRELATED";
    attributionBasis = `unconfirmed source hint: ${[t.leadSource, t.leadChannel].filter(Boolean).join(" / ")}`;
  } else {
    attributionConfidence = "UNKNOWN";
    console.log(
      `[BusinessScorer] BUSINESS_ATTRIBUTION_UNKNOWN ${tag} window=${target.window.id} attributionKnown=${t?.attributionKnown ?? "null"}`,
    );
  }

  try {
    const inserted = await db
      .insert(weeklyBusinessScores)
      .values({
        accountId,
        campaignId,
        scoreRunId,
        windowId: target.window.id,
        truthId: target.truth?.id ?? null,
        windowIndex: target.window.windowIndex,
        planId: target.window.planId,
        windowStart: target.window.windowStart,
        windowEnd: target.window.windowEnd,
        leads: cur.leads,
        qualified: cur.qualified,
        booked: cur.booked,
        payingCustomers: cur.paying,
        paidActive: target.truth?.paidActive ?? null,
        leadToQualifiedRate,
        qualifiedToBookedRate,
        bookedToPayingRate,
        leadToPayingRate,
        wowDeltaLeads,
        wowDeltaQualified,
        wowDeltaBooked,
        wowDeltaPaying,
        baseline,
        baselineWeeks,
        businessVerdict,
        verdictReason,
        attributionConfidence,
        attributionBasis,
        missingFields: JSON.stringify(missingFields),
        scorerVersion: BUSINESS_SCORER_VERSION,
        scoredAt,
      })
      .returning();
    result.row = inserted[0];
  } catch (err: any) {
    result.persistFailures++;
    console.error(
      `[BusinessScorer] PERFORMANCE_SCORE_PERSIST_FAILED ${tag} window=${target.window.id} err=${err?.message ?? String(err)}`,
    );
  }

  console.log(
    `[BusinessScorer] SCORE_RUN_COMPLETE ${tag} window=${target.window.id} index=${target.window.windowIndex} verdict=${businessVerdict} attribution=${attributionConfidence} missing=${missingFields.length} priorWeeks=${priorWithTruth.length}`,
  );
  return result;
}
