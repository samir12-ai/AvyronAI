/**
 * Phase 5 — Plan-anchored weekly evaluation windows.
 *
 * Locked by Samir 2026-04-20:
 *   - Anchor = plan_approvals.decided_at where decision='APPROVED' AND plan_id=<active>.
 *     Fallback = strategic_plans.updated_at, with anchor_fallback_used=true warning.
 *   - Each approved plan creates its own anchor. NO retroactive mixing across plans.
 *     A new approved plan starts a new evaluation cycle (window_index resets to 0
 *     under that new plan_id). Old plans' windows are never created/extended.
 *   - Active approved plan = strategic_plans.status='APPROVED', latest by updated_at.
 *   - Lazy create only. No background job creates windows.
 *   - Backfill of historical windows is explicitly out of scope: the first call
 *     creates only the current window_index for the current plan.
 */
import { db } from "../db";
import {
  pipelineEvalWindows,
  strategicPlans,
  planApprovals,
  type PipelineEvalWindow,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";

const WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_MS = WINDOW_DAYS * MS_PER_DAY;

export interface EvaluateWindowStateResult {
  window: PipelineEvalWindow | null;
  isDue: boolean;
  isMissingTruth: boolean;
  /** Stable reasons describing the result (e.g., "no_active_approved_plan", "anchor_fallback_used"). */
  reasons: string[];
  /** The active approved plan for the campaign, if any. Convenience for downstream rhythm eval. */
  activePlan: {
    id: string;
    approvedRhythmJson: string | null;
    anchorAt: Date;
    anchorFallbackUsed: boolean;
  } | null;
}

/**
 * Pure-ish: only side effect is the idempotent INSERT ... ON CONFLICT DO NOTHING
 * that lazy-creates the current week's window for the active approved plan.
 */
export async function evaluateWindowState(
  accountId: string,
  campaignId: string,
  now: Date,
): Promise<EvaluateWindowStateResult> {
  const reasons: string[] = [];

  // 1) Active approved plan = latest APPROVED for this campaign.
  const planRows = await db
    .select()
    .from(strategicPlans)
    .where(and(eq(strategicPlans.campaignId, campaignId), eq(strategicPlans.status, "APPROVED")))
    .orderBy(desc(strategicPlans.updatedAt))
    .limit(1);

  if (planRows.length === 0) {
    reasons.push("no_active_approved_plan");
    return { window: null, isDue: false, isMissingTruth: false, reasons, activePlan: null };
  }

  const plan = planRows[0];

  // 2) Anchor source = plan_approvals.decided_at (primary).
  //    Plan_approvals doesn't have a `decided_at` column literally — it's `created_at`
  //    (the approval row is created the moment the decision is made). The audit's
  //    "decided_at" semantic === planApprovals.createdAt for an APPROVED row.
  const apRows = await db
    .select()
    .from(planApprovals)
    .where(and(eq(planApprovals.planId, plan.id), eq(planApprovals.decision, "APPROVED")))
    .orderBy(desc(planApprovals.createdAt))
    .limit(1);

  let anchorAt: Date;
  let anchorFallbackUsed = false;
  if (apRows.length > 0 && apRows[0].createdAt) {
    anchorAt = apRows[0].createdAt as Date;
  } else {
    anchorFallbackUsed = true;
    anchorAt = (plan.updatedAt ?? plan.createdAt ?? now) as Date;
    reasons.push("anchor_fallback_used");
  }

  // 3) Compute window_index from anchor — rolling 7-day cycles, no calendar.
  //    Negative diff (now < anchor, e.g., clock skew or future-anchor) clamps to 0.
  const diffMs = Math.max(0, now.getTime() - anchorAt.getTime());
  const windowIndex = Math.floor(diffMs / WINDOW_MS);
  const windowStart = new Date(anchorAt.getTime() + windowIndex * WINDOW_MS);
  const windowEnd = new Date(windowStart.getTime() + WINDOW_MS);

  // 4) Lazy-create the window row. ON CONFLICT DO NOTHING keeps it idempotent.
  await db
    .insert(pipelineEvalWindows)
    .values({
      accountId,
      campaignId,
      planId: plan.id,
      anchorAt,
      anchorFallbackUsed,
      windowIndex,
      windowStart,
      windowEnd,
      state: "open",
      openedAt: now,
    })
    .onConflictDoNothing({
      target: [pipelineEvalWindows.campaignId, pipelineEvalWindows.planId, pipelineEvalWindows.windowIndex],
    });

  // 5) Read back the row (always exists after the insert above).
  const wRows = await db
    .select()
    .from(pipelineEvalWindows)
    .where(
      and(
        eq(pipelineEvalWindows.campaignId, campaignId),
        eq(pipelineEvalWindows.planId, plan.id),
        eq(pipelineEvalWindows.windowIndex, windowIndex),
      ),
    )
    .limit(1);

  const window = wRows[0] ?? null;
  if (!window) {
    // Defensive: should never happen after the upsert succeeded.
    reasons.push("window_lookup_failed_after_insert");
    return {
      window: null,
      isDue: false,
      isMissingTruth: false,
      reasons,
      activePlan: { id: plan.id, approvedRhythmJson: plan.approvedRhythmJson ?? null, anchorAt, anchorFallbackUsed },
    };
  }

  const isOpen = window.state === "open";
  const isDue = isOpen && now.getTime() >= window.windowStart.getTime();
  const isMissingTruth = isOpen && !window.truthId;

  return {
    window,
    isDue,
    isMissingTruth,
    reasons,
    activePlan: { id: plan.id, approvedRhythmJson: plan.approvedRhythmJson ?? null, anchorAt, anchorFallbackUsed },
  };
}

/**
 * Auto-close a window whose end has passed and which has no truth.
 * Used by runBoss before evaluating, so closed_missing_truth shows up promptly.
 * Idempotent: no-op if state is not "open" or window is still in range.
 */
export async function autoCloseExpiredWindow(
  windowId: string,
  now: Date,
): Promise<PipelineEvalWindow | null> {
  const updated = await db
    .update(pipelineEvalWindows)
    .set({ state: "closed_missing_truth", closedAt: now })
    .where(
      and(
        eq(pipelineEvalWindows.id, windowId),
        eq(pipelineEvalWindows.state, "open"),
        sql`${pipelineEvalWindows.windowEnd} <= ${now}`,
      ),
    )
    .returning();
  return updated[0] ?? null;
}
