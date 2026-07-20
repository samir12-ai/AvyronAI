/**
 * Phase 5 — Truth intake control gate.
 *
 * Locked by Samir 2026-04-20:
 *   - 4 user-visible fields exactly: total_leads, qualified_leads, booked_calls, paid_active.
 *   - Truth FK-bound to a window (orphan truth impossible by construction).
 *   - Funnel sanity check: reject INCONSISTENT_FUNNEL on qualified > total or booked > qualified.
 *   - Supersede policy: if window already has truth, last-write-wins with audit trail.
 *   - Late-fill: closed_missing_truth windows accept truth with was_late=true, state -> late_filled.
 *   - Server is the only authority for windowId — derived from evaluateWindowState(),
 *     never picked by client.
 */
import { db } from "../../../db";
import {
  pipelineEvalWindows,
  pipelineUserTruth,
  type PipelineUserTruth,
  type PipelineEvalWindow,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { PipelineValidationError } from "../../errors";

export interface AcceptUserTruthInput {
  accountId: string;
  campaignId: string;
  windowId: string;
  totalLeads: number;
  qualifiedLeads: number;
  bookedCalls: number;
  paidActive: boolean;
  submittedBy?: string;
  /**
   * P-2 Phase 4D — optional minimal source input. All optional, never required
   * for weekly submission. payingCustomers is a COUNT; it is NEVER derived
   * from paidActive (D4).
   */
  payingCustomers?: number | null;
  leadSource?: string | null;
  relatedCampaign?: string | null;
  relatedPostUrl?: string | null;
  leadChannel?: string | null;
  attributionKnown?: boolean | null;
  /** Optional override for testing time-dependent behavior; defaults to new Date(). */
  now?: Date;
}

export interface AcceptUserTruthResult {
  truth: PipelineUserTruth;
  window: PipelineEvalWindow;
  superseded: boolean;
}

function assertInteger(name: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
    throw new PipelineValidationError("INVALID_FIELD", `${name} must be a non-negative integer`, { field: name, value: v });
  }
  return v;
}

export async function acceptUserTruth(input: AcceptUserTruthInput): Promise<AcceptUserTruthResult> {
  const now = input.now ?? new Date();
  const totalLeads = assertInteger("totalLeads", input.totalLeads);
  const qualifiedLeads = assertInteger("qualifiedLeads", input.qualifiedLeads);
  const bookedCalls = assertInteger("bookedCalls", input.bookedCalls);
  if (typeof input.paidActive !== "boolean") {
    throw new PipelineValidationError("INVALID_FIELD", "paidActive must be a boolean", { field: "paidActive", value: input.paidActive });
  }
  if (qualifiedLeads > totalLeads || bookedCalls > qualifiedLeads) {
    throw new PipelineValidationError("INCONSISTENT_FUNNEL",
      "qualifiedLeads must be <= totalLeads and bookedCalls must be <= qualifiedLeads",
      { totalLeads, qualifiedLeads, bookedCalls });
  }

  // P-2 Phase 4D — optional source fields. Absent/NULL stays NULL (never 0).
  const payingCustomers =
    input.payingCustomers === undefined || input.payingCustomers === null
      ? null
      : assertInteger("payingCustomers", input.payingCustomers);
  if (input.attributionKnown !== undefined && input.attributionKnown !== null && typeof input.attributionKnown !== "boolean") {
    throw new PipelineValidationError("INVALID_FIELD", "attributionKnown must be a boolean when provided", { field: "attributionKnown", value: input.attributionKnown });
  }
  const optionalText = (name: string, v: string | null | undefined): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || v.length > 2000) {
      throw new PipelineValidationError("INVALID_FIELD", `${name} must be a string (max 2000 chars) when provided`, { field: name });
    }
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  const leadSource = optionalText("leadSource", input.leadSource);
  const relatedCampaign = optionalText("relatedCampaign", input.relatedCampaign);
  const relatedPostUrl = optionalText("relatedPostUrl", input.relatedPostUrl);
  const leadChannel = optionalText("leadChannel", input.leadChannel);

  // Look up the window and assert it belongs to (account, campaign).
  const wRows = await db
    .select()
    .from(pipelineEvalWindows)
    .where(eq(pipelineEvalWindows.id, input.windowId))
    .limit(1);
  const window = wRows[0];
  if (!window) {
    throw new PipelineValidationError("UNKNOWN_WINDOW", `window ${input.windowId} not found`, { windowId: input.windowId });
  }
  if (window.campaignId !== input.campaignId || window.accountId !== input.accountId) {
    throw new PipelineValidationError("UNKNOWN_WINDOW",
      "window does not belong to this campaign/account",
      { windowId: input.windowId, campaignId: input.campaignId, accountId: input.accountId });
  }

  // Determine the late and supersede semantics from current window state.
  let wasLate = false;
  let supersededFromTruthId: string | null = null;
  let nextWindowState: PipelineEvalWindow["state"] = "closed_with_truth";

  switch (window.state) {
    case "open":
      // Happy path. If submitted past windowEnd, mark late (rare race condition
      // where the window hasn't been auto-closed yet but time has passed).
      wasLate = now.getTime() >= window.windowEnd.getTime();
      nextWindowState = wasLate ? "late_filled" : "closed_with_truth";
      break;
    case "closed_missing_truth":
      // Late-fill allowed (E-opt-2).
      wasLate = true;
      nextWindowState = "late_filled";
      break;
    case "closed_with_truth":
    case "late_filled":
      // Supersede: insert new row, mark old superseded, repoint window.
      if (!window.truthId) {
        throw new PipelineValidationError("WINDOW_STATE_INVALID",
          `window in ${window.state} has no truthId`, { windowId: window.id, state: window.state });
      }
      supersededFromTruthId = window.truthId;
      // Lateness: if the original was on-time, supersede stays on-time only if
      // submitted before windowEnd.
      wasLate = now.getTime() >= window.windowEnd.getTime();
      nextWindowState = wasLate ? "late_filled" : "closed_with_truth";
      break;
    default:
      throw new PipelineValidationError("WINDOW_STATE_INVALID",
        `unrecognized window state ${window.state}`, { windowId: window.id, state: window.state });
  }

  // Insert + window update + supersede mark — single transaction.
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(pipelineUserTruth)
      .values({
        accountId: input.accountId,
        campaignId: input.campaignId,
        windowId: window.id,
        totalLeads,
        qualifiedLeads,
        bookedCalls,
        paidActive: input.paidActive,
        submittedAt: now,
        submittedBy: input.submittedBy ?? null,
        wasLate,
        payingCustomers,
        leadSource,
        relatedCampaign,
        relatedPostUrl,
        leadChannel,
        attributionKnown: input.attributionKnown ?? null,
      })
      .returning();
    const truth = inserted[0];

    if (supersededFromTruthId) {
      await tx
        .update(pipelineUserTruth)
        .set({ supersededAt: now, supersededBy: truth.id })
        .where(and(eq(pipelineUserTruth.id, supersededFromTruthId)));
    }

    const updatedWindowRows = await tx
      .update(pipelineEvalWindows)
      .set({ truthId: truth.id, state: nextWindowState, closedAt: now })
      .where(eq(pipelineEvalWindows.id, window.id))
      .returning();

    return { truth, window: updatedWindowRows[0], superseded: !!supersededFromTruthId };
  });

  return result;
}
