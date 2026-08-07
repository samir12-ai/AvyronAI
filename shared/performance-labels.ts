/**
 * Canonical Performance-loop labels (spec §18) — ONE shared map so wording
 * never drifts between backend, API payloads, hooks, and the Performance page.
 *
 * Rules:
 *  - Never rename the same object across routes; import from here instead.
 *  - Keys are the internal enum/entity tokens; values are the user-facing
 *    plain-language labels.
 */

/** Core Performance entities. */
export const PERFORMANCE_ENTITY_LABELS = {
  user_truth: "User Truth",
  evaluation_window: "Evaluation Window",
  weekly_business_score: "Weekly Business Score",
  owned_post: "Owned Post",
  owned_post_snapshot: "Owned Post Snapshot",
  content_score: "Content Score",
  execution_status: "Execution Status",
  decision_verdict: "Decision Verdict",
  decision_outcome: "Decision Outcome",
  performance_cycle: "Performance Cycle",
  strategy_memory: "Strategy Memory",
  attribution_confidence: "Attribution Confidence",
  business_verdict: "Business Verdict",
  interpretation_status: "Interpretation Status",
} as const;

/** Execution statuses — decided by deterministic code only, never by an LLM. */
export const EXECUTION_STATUS_LABELS: Record<string, { label: string; description: string }> = {
  EXECUTED: { label: "Executed", description: "The plan's recommendation was carried out — plan-linked posts in the window match it." },
  PARTIALLY_EXECUTED: { label: "Partially executed", description: "Some plan-linked posts match the recommendation, others diverge." },
  NOT_EXECUTED: { label: "Not executed", description: "The window was fully observed and no plan-linked post carries this recommendation." },
  UNVERIFIED: { label: "Unverified", description: "The channel scrape does not cover this window yet — posts may exist unobserved." },
  BLOCKED: { label: "Blocked", description: "No social channel is connected, so execution cannot be observed." },
  NOT_YET_DUE: { label: "Not yet due", description: "The window is still open; there is still time to execute this." },
};

/** Decision verdicts (sales-truth driven). */
export const DECISION_VERDICT_LABELS: Record<string, { label: string; description: string }> = {
  WINNER: { label: "Winner", description: "Executed and sales moved up this window." },
  LOSER: { label: "Underperformed", description: "Executed and sales moved down this window." },
  INCONCLUSIVE: { label: "Inconclusive", description: "Executed but sales did not move meaningfully." },
  NEEDS_MORE_DATA: { label: "Needs more data", description: "Not enough evidence to judge this decision yet." },
  NOT_EXECUTED: { label: "Not executed", description: "Recommended but not carried out — nothing to evaluate." },
};

/** Decision outcomes (durable record consumed by future plans). */
export const DECISION_OUTCOME_LABELS: Record<string, { label: string; description: string }> = {
  POSITIVE: { label: "Positive", description: "This decision is associated with improved business results." },
  NEGATIVE: { label: "Negative", description: "This decision is associated with declining business results." },
  MIXED: { label: "Mixed", description: "Evidence points in both directions." },
  INCONCLUSIVE: { label: "Inconclusive", description: "No meaningful business change was measured." },
  NOT_EXECUTED: { label: "Not executed", description: "No outcome — the decision was never carried out." },
};

/** Business verdicts. */
export const BUSINESS_VERDICT_LABELS: Record<string, string> = {
  WORKING: "Working",
  DRIFTING: "Drifting",
  UNKNOWN: "Unknown",
};

/** Attribution confidence. */
export const ATTRIBUTION_CONFIDENCE_LABELS: Record<string, { label: string; description: string }> = {
  DIRECT: { label: "Direct", description: "You directly attributed results to this channel." },
  SUPPORTED: { label: "Supported", description: "Multiple signals support the connection." },
  CORRELATED: { label: "Correlated", description: "Timing correlation only — not proven causation." },
  UNKNOWN: { label: "Unknown", description: "Attribution has not been established." },
};

/** Truthful section states — every Performance section must use these (spec §17). */
export const SECTION_STATE_LABELS: Record<string, { label: string; description: string }> = {
  ready: { label: "Ready", description: "Data is available and current." },
  awaiting_user_truth: { label: "Awaiting your weekly numbers", description: "Submit the weekly sales truth to unlock this cycle." },
  awaiting_scrape: { label: "Awaiting channel scan", description: "Your channel is connected; the next scan has not run yet." },
  awaiting_classification: { label: "Awaiting classification", description: "Posts are scraped and queued for content classification." },
  awaiting_lineage: { label: "Awaiting plan matching", description: "Posts are being matched to the plan that recommended them." },
  awaiting_checkpoint_maturity: { label: "Maturing", description: "Posts need more time before checkpoint metrics are meaningful." },
  insufficient_evidence: { label: "Insufficient evidence", description: "Not enough data to say anything honest yet." },
  failed: { label: "Failed", description: "The last attempt failed — the reason is shown, nothing is fabricated." },
  stale: { label: "Stale", description: "Data exists but is older than its freshness window." },
  unavailable: { label: "Unavailable", description: "This layer is not available for this campaign yet." },
  not_configured: { label: "Not set up", description: "Connect your channel to start observing real execution." },
};

/** Interpretation statuses. */
export const INTERPRETATION_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Validated interpretation available",
  UNAVAILABLE: "Interpretation unavailable — deterministic results shown",
  SKIPPED: "Interpretation skipped",
};

/** Lineage states (owned post → plan). */
export const LINEAGE_STATE_LABELS: Record<string, string> = {
  planned_direct: "Planned (direct)",
  planned_matched: "Planned (matched)",
  manual_matched: "Matched manually",
  unmatched: "Not linked to plan",
  pending: "Matching in progress",
};
