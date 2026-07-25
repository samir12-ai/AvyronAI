/**
 * Task #71 / Phase 8 / Step 5 — Unified run-truthfulness presenter.
 *
 * Single source of truth for verdict + headline rendering. Replaces the
 * three previously-independent renderings (`audit-control.tsx`,
 * `RunTruthfulnessBanner`, dashboard) so a verdict change has exactly one
 * presentation site.
 *
 * Doctrine notes (D2/D3/D5):
 *   - Canonical fields (`integrityVerdict`, `headline`) are passed in raw.
 *     We never `?? legacy` them — `colorForIntegrityVerdict` already
 *     enforces the canonical-first rule and coerces legacy → amber.
 *   - All headline → label mappings use a `Record<TruthfulnessHeadline,…>`
 *     so adding a new headline value forces a compile-time decision here.
 *   - Missing canonical → returns `null` rather than substituting another
 *     field. Callers render an explicit "Unverified" affordance.
 */

import {
  colorForIntegrityVerdict,
  type IntegrityVerdict,
} from "@/lib/verdict-colors";

/**
 * Mirror of `TruthfulnessHeadline` from `@/hooks/useRunTruthfulness`. Kept
 * as a local string-literal union so this module has zero dependencies on
 * the hook layer (the dashboard consumer doesn't pull the hook in).
 */
export type RunHeadline =
  | "ok"
  | "shadowed"
  | "system_untrusted"
  | "needs_reconciliation"
  | "review_required"
  | "blocked"
  | "downgrade"
  | "repair"
  | "no_run";

/**
 * Customer-facing labels. Operator-vocabulary tokens like
 * `system_untrusted` and `needs_reconciliation` are translated to outcome
 * copy ("Verifying", "Cross-check needed"). The audit-control screen
 * still owns operator-vocabulary copy via its own HEADLINE_LABEL map.
 */
export const HEADLINE_CUSTOMER_LABEL: Record<RunHeadline, string> = {
  ok: "On track",
  shadowed: "Showing last good plan",
  system_untrusted: "Verifying",
  needs_reconciliation: "Cross-check needed",
  review_required: "Review needed",
  blocked: "Paused",
  downgrade: "Reduced confidence",
  repair: "Self-healing",
  no_run: "Not started",
};

/**
 * Maps a headline (which is itself a derived presentation) back to the
 * canonical IntegrityVerdict tri-state so color logic stays unified.
 * Used only as a fall-through when the canonical `integrityVerdict` is
 * not in the snapshot.
 */
const HEADLINE_TO_VERDICT: Record<RunHeadline, IntegrityVerdict> = {
  ok: "PASS",
  shadowed: "PARTIAL",
  downgrade: "PARTIAL",
  review_required: "PARTIAL",
  no_run: "PARTIAL",
  needs_reconciliation: "PARTIAL",
  repair: "PARTIAL",
  system_untrusted: "FAIL",
  blocked: "FAIL",
};

export interface PresentedRunTruthfulness {
  /** Outcome-framed customer copy for the headline state. */
  customerLabel: string;
  /** Canonical hex color via `colorForIntegrityVerdict` (canonical-first). */
  color: string;
  /**
   * Whether the color is sourced from the canonical `integrityVerdict`
   * (true) or fell through to the headline-derived verdict (false).
   * Callers can use this to render a small "snapshot" caveat.
   */
  isCanonical: boolean;
}

/**
 * Inputs:
 *   canonicalVerdict — `RunTruthfulness.verdict.verdict` mapped to
 *                      IntegrityVerdict (PASS|PARTIAL|FAIL). May be null
 *                      if the snapshot pre-dates canonical wiring.
 *   headline         — derived headline from the truthfulness hook.
 *                      Required (no D5 silent coercion).
 *
 * Returns null when both inputs are missing — callers MUST render an
 * "Unverified" affordance rather than substituting a default verdict.
 */
export function presentRunTruthfulness(
  canonicalVerdict: IntegrityVerdict | null | undefined,
  headline: RunHeadline | null | undefined,
): PresentedRunTruthfulness | null {
  if (!canonicalVerdict && !headline) return null;
  const fallback = headline ? HEADLINE_TO_VERDICT[headline] : null;
  const color = colorForIntegrityVerdict(canonicalVerdict ?? null, fallback);
  const label = headline ? HEADLINE_CUSTOMER_LABEL[headline] : "Verifying";
  return {
    customerLabel: label,
    color,
    isCanonical: !!canonicalVerdict,
  };
}
