import { useQuery } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";

// Seal #17 / Track #4 — Operator-visible continuity surface (client).
//
// Strict union — kept in sync with PerCampaignDecision.decision in
// server/continuity/scheduler.ts. NO string fallback at the type
// boundary (D2/D3). Adding a new decision value requires updating both
// the server union and this constant in the same change.
export const CONTINUITY_DECISION_VALUES = [
  "invoked",
  "skipped_already_evaluated",
  "skipped_in_flight",
  "skipped_no_advance",
  "skipped_claimed_by_other_replica",
  "skipped_completed_claim_exists",
  "reanchored_then_invoked",
  "failed",
] as const;
export type ContinuityDecision = (typeof CONTINUITY_DECISION_VALUES)[number];

export interface ContinuityWindowGap {
  accountId: string;
  campaignId: string;
  planId: string;
  decision: ContinuityDecision;
  reason: string | null;
  observedWindowIndex: number | null;
  expectedWindowIndex: number | null;
  missedWindows: number;
  claimedBy: string | null;
}

export interface ContinuityReanchor {
  id: string;
  accountId: string;
  campaignId: string;
  planId: string;
  reanchoredAt: string;
  reason: string;
  source: string;
}

export interface ContinuityPanelData {
  lastTick: {
    tickAt: string;
    durationMs: number;
    campaignsScanned: number;
    runsInvoked: number;
    runsSkippedIdempotent: number;
    runsFailed: number;
    reanchorsWritten: number;
    missedWindowsDetected: number;
    deadCyclesDetected: number;
  } | null;
  perCampaignWindowGaps: ContinuityWindowGap[];
  recentReanchors: ContinuityReanchor[];
  skipReasonHistogram24h: Record<ContinuityDecision | "unknown", number>;
  deadCycles: number;
}

export interface CampaignContinuityDecision {
  decision: ContinuityDecision;
  reason: string | null;
  missedWindows: number;
  observedWindowIndex: number | null;
  expectedWindowIndex: number | null;
  tickAt: string | null;
}

/**
 * Operator-only admin token. Sourced from EXPO_PUBLIC_METRICS_ADMIN_TOKEN
 * so dev/operator builds can surface the panel; absent in customer builds.
 * When unset, the panel hook is DISABLED (returns no data, no error) so
 * customer builds don't show a "Failed to load" red banner.
 */
function getAdminToken(): string | null {
  const t = process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function continuityPanelEnabled(): boolean {
  return getAdminToken() !== null;
}

export function useContinuityPanel() {
  const baseUrl = getApiUrl();
  const token = getAdminToken();
  return useQuery<ContinuityPanelData>({
    queryKey: ["continuity-panel"],
    enabled: token !== null,
    refetchInterval: 60_000,
    queryFn: async () => {
      const url = new URL("/api/admin/continuity/panel", baseUrl).toString();
      const res = await fetch(url, {
        headers: token ? { "X-Admin-Token": token } : {},
      });
      if (!res.ok) {
        throw new Error(`continuity-panel ${res.status}`);
      }
      return res.json() as Promise<ContinuityPanelData>;
    },
  });
}

export function useCampaignContinuityDecision(campaignId: string | null | undefined) {
  const baseUrl = getApiUrl();
  const token = getAdminToken();
  return useQuery<{ decision: CampaignContinuityDecision | null }>({
    queryKey: ["continuity-campaign-decision", campaignId],
    enabled: token !== null && !!campaignId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const url = new URL(
        `/api/admin/continuity/campaign/${campaignId}/last-decision`,
        baseUrl,
      ).toString();
      const res = await fetch(url, {
        headers: token ? { "X-Admin-Token": token } : {},
      });
      if (!res.ok) {
        throw new Error(`continuity-campaign-decision ${res.status}`);
      }
      return res.json();
    },
  });
}

/**
 * Human-readable label for a strict-union decision value. Keep in sync
 * with CONTINUITY_DECISION_VALUES — TypeScript will flag any missing key
 * (Record<ContinuityDecision, string>) so this is exhaustive by construction.
 */
export const DECISION_LABELS: Record<ContinuityDecision, string> = {
  invoked: "Ran",
  skipped_already_evaluated: "Already evaluated",
  skipped_in_flight: "In flight",
  skipped_no_advance: "No advance",
  skipped_claimed_by_other_replica: "Other replica",
  skipped_completed_claim_exists: "Already completed",
  reanchored_then_invoked: "Re-anchored & ran",
  failed: "Failed",
};

/**
 * Operator-facing color for each decision. NOT a status verdict color —
 * these are operational signals only.
 *   green  = ran             (invoked, reanchored_then_invoked)
 *   red    = failed
 *   amber  = skipped or unknown
 */
export const DECISION_COLORS: Record<ContinuityDecision, string> = {
  invoked: "#85BB65",
  reanchored_then_invoked: "#85BB65",
  failed: "#FF6B6B",
  skipped_already_evaluated: "#8892A4",
  skipped_in_flight: "#FFB347",
  skipped_no_advance: "#8892A4",
  skipped_claimed_by_other_replica: "#8892A4",
  skipped_completed_claim_exists: "#8892A4",
};

/**
 * Task #53 / U5 — Friendly skip-reason translator.
 *
 * Canonical reason strings emitted by server/continuity/scheduler.ts are
 * machine-shaped ("boss_run_in_flight", "current_window_already_evaluated").
 * This table maps the known canonical reasons to operator-friendly English.
 *
 * Doctrine notes (D2/D3/D5):
 *   - Decision-level fallbacks use a Partial<Record<ContinuityDecision,…>>
 *     keyed by the strict union, NOT a string fallback. Adding a new
 *     decision value to CONTINUITY_DECISION_VALUES forces this map to be
 *     re-considered (TypeScript will not error, but the absence of an
 *     entry surfaces in the helper's `?? null` chain below).
 *   - Unknown reason strings are NEVER coerced into a friendly canonical —
 *     they fall through to the raw text bucket (sanitized to ≤80 chars).
 *   - When neither the reason nor the decision yields a label, the helper
 *     returns the empty string so callers don't render "· undefined".
 */
const REASON_LABELS: Record<string, string> = {
  current_window_already_evaluated: "Already evaluated this window.",
  completed_claim_exists: "Already completed for this window.",
  claimed_by_other_replica: "Another worker is handling this run.",
  in_flight: "Currently running — we'll check back shortly.",
  boss_run_in_flight: "Currently running — we'll check back shortly.",
  per_campaign_exception: "We hit a temporary issue and will retry automatically.",
};

const DECISION_DEFAULT_REASON: Partial<Record<ContinuityDecision, string>> = {
  invoked: "Ran on schedule.",
  reanchored_then_invoked: "Re-aligned to the latest approved plan, then ran.",
  failed: "We hit a temporary issue and will retry automatically.",
  skipped_in_flight: "Currently running — we'll check back shortly.",
  skipped_no_advance: "Waiting on plan approval before the next run.",
  skipped_already_evaluated: "Already evaluated this window.",
  skipped_claimed_by_other_replica: "Another worker is handling this run.",
  skipped_completed_claim_exists: "Already completed for this window.",
};

export function friendlyContinuityReason(
  decision: ContinuityDecision,
  reason: string | null | undefined,
): string {
  // Architect fix — when scheduler emits a NOVEL reason string (one we
  // haven't catalogued in REASON_LABELS yet), surface the raw text so the
  // operator can see what's actually happening rather than collapsing it
  // into the decision-default. This preserves B1 truthful visibility:
  // novel signals must not be silently masked by a generic placeholder.
  if (reason && reason.length > 0) {
    if (Object.prototype.hasOwnProperty.call(REASON_LABELS, reason)) {
      return REASON_LABELS[reason];
    }
    return reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
  }
  // No reason supplied — fall back to a decision-level explanation so the
  // badge still has human-readable context.
  const decisionDefault = DECISION_DEFAULT_REASON[decision];
  if (decisionDefault) return decisionDefault;
  return "";
}
