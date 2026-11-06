// Perception Translator — maps internal engine signals/verdicts to
// customer-safe English. Lives in shared/ so both client and server may
// import it (pure, no deps). Phase 8 customer-surface rule: never leak
// engine names, internal status strings, or confidence numbers verbatim
// — only the curated phrases below.
//
// IMPORTANT: This is an ALLOWLIST translator. Unknown inputs map to
// `null` (the caller decides whether to hide the row or fall back to a
// generic "watching" phrase). Never synthesize copy for an unknown
// signal — that breaks the D5 "no semantic fallback" doctrine.

export type WatchtowerTone = "stable" | "watching" | "shift" | "issue" | "unknown";

// ── Market signal kind labels ─────────────────────────────────────────────────
// Maps Watchtower kind codes (stored in pipeline_change_events.kind) to
// customer-readable labels. Allowlist only — unknown codes return null.
// P-3 brief: what changed, not what to do about it.
export function translateSignalKind(kind: string | null | undefined): string | null {
  switch (kind) {
    // Semantic (competitor_post_classifications-driven)
    case "hook_archetype_shift":    return "Hook style shift";
    case "promise_shift":           return "Value proposition shift";
    case "emotional_trigger_shift": return "Emotional appeal shift";
    case "positioning_shift":       return "Brand positioning shift";
    case "primary_goal_shift":      return "Content goal shift";
    case "cta_strategy_shift":      return "Call-to-action shift";
    case "narrative_shift":         return "Narrative framework shift";
    case "awareness_stage_shift":   return "Audience awareness shift";
    case "offer_type_shift":        return "Offer type shift";
    case "content_format_shift":    return "Content format shift";
    // Payload-based
    case "posting_frequency_shift":  return "Posting cadence shift";
    case "competitor_profile_change": return "Competitor profile change";
    case "offer_language_change":     return "Offer language change";
    case "pricing_change":
    case "pricing_page_change":       return "Pricing strategy shift";
    default: return null;
  }
}

// ── Market signal scope labels ────────────────────────────────────────────────
export function translateSignalScope(scope: string | null | undefined): string {
  switch (scope) {
    case "single_competitor":  return "One competitor";
    case "several_competitors": return "Several competitors";
    case "market_wide":        return "Market-wide";
    default:                   return "One competitor";
  }
}

// ── Market signal severity labels ─────────────────────────────────────────────
export function translateSignalSeverity(severity: string | null | undefined): string {
  switch (severity) {
    case "major":  return "Major shift";
    case "medium": return "Moderate shift";
    case "mild":   return "Minor shift";
    default:       return "Minor shift";
  }
}

// ── Semantic value humanizer ─────────────────────────────────────────────────
// Formats classifier value codes for customer display. This is a pure
// FORMATTING transform (BOLD_CLAIM → "Bold claim"), not copy synthesis —
// the value itself is data observed from the market, so the allowlist rule
// (which governs internal statuses) does not apply here.
export function humanizeSemanticValue(value: string | null | undefined): string {
  if (!value) return "";
  const spaced = value.replace(/_/g, " ").trim().toLowerCase();
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "";
}

// ── Distribution trend labels ─────────────────────────────────────────────────
export function translateDistributionTrend(trend: string | null | undefined): string {
  switch (trend) {
    case "rising":               return "Rising";
    case "falling":              return "Falling";
    case "stable":               return "Stable";
    case "new_leader":           return "New leader";
    case "insufficient_history": return "Building history";
    default:                     return "Building history";
  }
}

export interface WatchtowerLine {
  tone: WatchtowerTone;
  headline: string;        // short, < 60 chars
  detail: string | null;   // optional 1-sentence subtext, < 140 chars
}

// boss_runs.q2_verdict — "is the market still the same as when we made the plan?"
// Fail-closed: only the known enum values map to copy. Anything else returns
// `null` and the caller MUST decide how to surface that (drop the line or
// substitute an explicit "no run yet / unrecognized state" line). D5: never
// silently reframe an unknown verdict as a normal startup state.
export function translateQ2Verdict(q2: string | null | undefined): WatchtowerLine | null {
  switch (q2) {
    case "STABLE":
      return { tone: "stable", headline: "Market is steady", detail: "Nothing has shifted since your last plan." };
    case "SHIFTED":
      return { tone: "shift", headline: "Market shift since last check", detail: "Recent signals look different from when this plan was made. A review is queued." };
    case "UNCERTAIN":
      return { tone: "watching", headline: "Watching the market", detail: "Building baseline before flagging shifts. Monitoring is active." };
    case "INSUFFICIENT_DATA":
      return { tone: "watching", headline: "Building market baseline", detail: "Not enough competitor or performance signal yet to judge market movement." };
    default:
      return null;
  }
}

// boss_runs.q1_verdict — "is the current plan actually working?" (fail-closed; see translateQ2Verdict).
export function translateQ1Verdict(q1: string | null | undefined): WatchtowerLine | null {
  switch (q1) {
    case "WORKING":
      return { tone: "stable", headline: "Plan is working", detail: "Performance is in line with expectations." };
    case "DEGRADED":
      return { tone: "issue", headline: "Plan is underperforming", detail: "Results have slipped vs. expectations. A correction is queued." };
    case "UNKNOWN":
      return { tone: "watching", headline: "Measuring results", detail: "First benchmark window still building. Connect performance data to speed this up." };
    default:
      return null;
  }
}

// Explicit "no boss_run yet" lines — used by the watchtower endpoint when
// the campaign has zero rows in boss_runs (vs. an unrecognized verdict from
// a real run, which is a separate fail-closed path).
export const Q1_PENDING_FIRST_RUN: WatchtowerLine = {
  tone: "watching",
  headline: "Plan check starting",
  detail: "Results review activates after your first published cycle.",
};
export const Q2_PENDING_FIRST_RUN: WatchtowerLine = {
  tone: "watching",
  headline: "Market scan starting",
  detail: "First market check runs after your plan is approved.",
};
// Used when latest boss_run exists but verdict is outside the allowlist
// (bug in upstream writer). Explicit unrecognized-state surface, NOT silent
// substitution.
export const Q1_UNRECOGNIZED: WatchtowerLine = {
  tone: "watching",
  headline: "Plan state unclear",
  detail: "We received an unrecognized result code — a re-check is queued.",
};
export const Q2_UNRECOGNIZED: WatchtowerLine = {
  tone: "watching",
  headline: "Market state unclear",
  detail: "We received an unrecognized result code — a re-check is queued.",
};

// Freshness: how recent was the last check?
export function translateFreshness(lastCheckedAt: Date | string | null): WatchtowerLine {
  if (!lastCheckedAt) {
    return { tone: "watching", headline: "First review pending", detail: "Reviews start after your plan is approved." };
  }
  const ts = typeof lastCheckedAt === "string" ? new Date(lastCheckedAt) : lastCheckedAt;
  const ageMs = Date.now() - ts.getTime();
  const ageH = ageMs / 3_600_000;
  if (ageH < 2) return { tone: "stable", headline: "Just checked", detail: `Last reviewed ${Math.max(1, Math.floor(ageMs / 60_000))} min ago.` };
  if (ageH < 26) return { tone: "stable", headline: "Recently reviewed", detail: `Last reviewed ${Math.floor(ageH)}h ago.` };
  if (ageH < 24 * 8) return { tone: "watching", headline: "Review due soon", detail: `Last reviewed ${Math.floor(ageH / 24)}d ago.` };
  return { tone: "issue", headline: "Review overdue", detail: `Last reviewed ${Math.floor(ageH / 24)}d ago — scheduler may be lagging.` };
}

// continuity_ticks.notes[].decision — per-campaign per-tick outcome.
// Canonical values come from server/continuity/scheduler.ts (lowercase,
// snake_case). Allowlist only — unknown → null (caller hides).
export type ContinuityDecision =
  | "invoked"
  | "reanchored_then_invoked"
  | "skipped_no_advance"
  | "skipped_completed_claim_exists"
  | "skipped_claimed_by_other_replica"
  | "skipped_in_flight"
  | "failed";

export function translateContinuityDecision(decision: string | null | undefined): { tone: WatchtowerTone; label: string } | null {
  switch (decision) {
    case "invoked": return { tone: "stable", label: "Ran scheduled review" };
    case "reanchored_then_invoked": return { tone: "watching", label: "Re-aligned schedule and ran review" };
    case "skipped_no_advance": return { tone: "stable", label: "No review due yet" };
    case "skipped_completed_claim_exists": return { tone: "stable", label: "Already reviewed this window" };
    case "skipped_claimed_by_other_replica": return { tone: "stable", label: "Already reviewed this window" };
    case "skipped_in_flight": return { tone: "watching", label: "Review in progress" };
    case "failed": return { tone: "issue", label: "Scheduled review failed — will retry" };
    default: return null;
  }
}

// Activity event kinds surfaced on the timeline.
export type ActivityKind = "boss_run" | "reanchor" | "tick_decision";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  at: string;           // ISO
  tone: WatchtowerTone;
  title: string;
  detail: string | null;
}

// Fail-closed: any status outside the known allowlist returns null and is
// dropped by the caller (NEVER coerced to "completed / all good"). The
// known set mirrors boss_runs.status defaults in shared/schema.ts.
export function translateBossRunStatus(
  status: string | null | undefined,
  q1: string | null | undefined,
  q2: string | null | undefined,
): { tone: WatchtowerTone; title: string; detail: string | null } | null {
  switch (status) {
    case "failed":
      return { tone: "issue", title: "Review failed", detail: "An attempt to re-evaluate this plan did not finish. A retry is queued." };
    case "partial":
      return { tone: "watching", title: "Review partially completed", detail: "Some checks finished, others were skipped. We'll retry the rest." };
    case "running":
      return { tone: "watching", title: "Review in progress", detail: "Re-evaluating plan and market now." };
    case "completed":
      if (q1 === "DEGRADED" || q2 === "SHIFTED") {
        return { tone: "shift", title: "Review completed — change detected", detail: "A correction has been queued for your next plan cycle." };
      }
      return { tone: "stable", title: "Review completed", detail: "Plan and market look in line with expectations." };
    default:
      return null;
  }
}

export function translateReanchorReason(reason: string | null | undefined): { tone: WatchtowerTone; title: string; detail: string | null } {
  return {
    tone: "watching",
    title: "Review schedule re-aligned",
    detail: "Your review cadence was reset to start cleanly from the most recent plan approval.",
  };
}

// ---------------------------------------------------------------------------
// Blocked-reason translator (lifecycle C-package, May 2026).
//
// When boss_runs.warnings contains evaluation-blocking codes, the system
// KNOWS exactly what it needs from the user but never used to surface those
// asks. Each code below maps to a single customer-facing CTA describing
// what the user should do (or what's already in flight) to unblock the
// weekly review. The dashboard renders the items in priority order.
//
// Fail-closed: unknown warning codes return null and are silently dropped
// — never coerced into a generic "something is wrong" line.
// ---------------------------------------------------------------------------

export type BlockedReasonAction =
  | "submit_user_truth"     // user must click into the truth form
  | "configure_rhythm"      // user must set/repair the content rhythm
  | "connect_accounts"      // user must link social accounts for signal extraction
  | "approve_plan"          // user must approve a plan first
  | "wait_for_system";      // nothing the user can do — system is recovering

export interface BlockedReason {
  code: string;             // original warning code (operator-grade, not shown)
  action: BlockedReasonAction;
  tone: WatchtowerTone;
  headline: string;         // short, < 60 chars
  detail: string;           // 1 sentence, < 160 chars
  cta: string | null;       // button label, null if no action
}

// Priority order — first match wins when multiple warnings collide on the
// same action surface. Higher = more important to show first.
const BLOCKED_REASON_PRIORITY: Record<BlockedReasonAction, number> = {
  approve_plan: 100,
  configure_rhythm: 80,
  connect_accounts: 60,
  submit_user_truth: 40,
  wait_for_system: 0,
};

export function translateBlockedReason(code: string): BlockedReason | null {
  switch (code) {
    case "user_truth_missing":
      return {
        code,
        action: "submit_user_truth",
        tone: "watching",
        headline: "Tell me how last week went",
        detail: "Enter the 4 numbers from last week — leads, qualified, booked, paying — so I can score the plan.",
        cta: "Submit weekly numbers",
      };
    case "user_truth_late":
      return {
        code,
        action: "submit_user_truth",
        tone: "watching",
        headline: "Last week's numbers are late",
        detail: "Still accepting last week's numbers — submit now and I'll back-fill the review.",
        cta: "Submit late numbers",
      };
    case "rhythm_invalid":
      return {
        code,
        action: "configure_rhythm",
        tone: "issue",
        headline: "Posting rhythm needs setup",
        detail: "Your weekly posting rhythm config is missing or malformed — pick how many posts per week so I can measure compliance.",
        cta: "Set posting rhythm",
      };
    case "rhythm_non_compliant":
      return {
        code,
        action: "configure_rhythm",
        tone: "watching",
        headline: "Posting cadence drifted",
        detail: "You're publishing less than your approved rhythm. Adjust the plan or get back on cadence.",
        cta: "Review rhythm",
      };
    case "rhythm_partial":
      return {
        code,
        action: "configure_rhythm",
        tone: "watching",
        headline: "Partial week of posts",
        detail: "Not every day was covered. Catch up or adjust the plan so reviews stay accurate.",
        cta: "Review rhythm",
      };
    case "bridge_skipped:user_lane_no_signals_extracted":
      return {
        code,
        action: "connect_accounts",
        tone: "watching",
        headline: "No signals from your accounts yet",
        detail: "I couldn't extract any posts from your connected accounts — re-check the connection so I can read your content.",
        cta: "Check connections",
      };
    case "bridge_skipped:missing_validated_user_or_competitor_run":
      return {
        code,
        action: "connect_accounts",
        tone: "watching",
        headline: "Connect more sources",
        detail: "I need at least one validated user post or competitor profile to bridge signals. Add one in Market DB.",
        cta: "Open Market DB",
      };
    case "no_active_approved_plan":
      return {
        code,
        action: "approve_plan",
        tone: "issue",
        headline: "No approved plan yet",
        detail: "Reviews only start after you approve a strategic plan. Open the roadmap to approve one.",
        cta: "Open roadmap",
      };
    case "anchor_fallback_used":
      return {
        code,
        action: "wait_for_system",
        tone: "watching",
        headline: "Using a fallback review anchor",
        detail: "Plan approval timestamp was missing; I'm using the plan's creation time instead. Reviews still run normally.",
        cta: null,
      };
    case "evaluation_blocked":
      // Umbrella code — only surface if NO other more-specific code is present.
      // Caller dedups by action; the consolidator at the bottom of this file
      // demotes this entry when a higher-priority sibling already covers the
      // same action.
      return {
        code,
        action: "wait_for_system",
        tone: "issue",
        headline: "Review is blocked",
        detail: "One or more inputs are missing — see the action items above.",
        cta: null,
      };
    case "evaluation_degraded":
      return {
        code,
        action: "wait_for_system",
        tone: "watching",
        headline: "Review running with limited confidence",
        detail: "Some inputs were partial. The review still ran but the verdict carries lower confidence.",
        cta: null,
      };
    default:
      return null;
  }
}

/**
 * Translate the full warnings[] array from a boss_run into a deduplicated,
 * priority-ordered list of customer-facing actions. Multiple warnings that
 * map to the same `action` collapse to the highest-tone instance. The
 * "evaluation_blocked" umbrella is dropped when any concrete cause is
 * present (because then the concrete cause already explains the block).
 */
export function translateBlockedReasons(warnings: string[] | null | undefined): BlockedReason[] {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  const translated: BlockedReason[] = [];
  for (const w of warnings) {
    const t = translateBlockedReason(w);
    if (t) translated.push(t);
  }
  if (translated.length === 0) return [];

  // Dedup by action; keep the most-severe tone (issue > shift > watching > stable > unknown).
  const toneRank: Record<WatchtowerTone, number> = { issue: 4, shift: 3, watching: 2, stable: 1, unknown: 0 };
  const byAction = new Map<BlockedReasonAction, BlockedReason>();
  for (const r of translated) {
    const existing = byAction.get(r.action);
    if (!existing || toneRank[r.tone] > toneRank[existing.tone]) {
      byAction.set(r.action, r);
    }
  }

  // Drop the umbrella "evaluation_blocked" (action: wait_for_system, code: evaluation_blocked)
  // when any actionable cause is present — concrete causes already explain it.
  const hasActionable = Array.from(byAction.values()).some(
    (r) => r.action !== "wait_for_system",
  );
  if (hasActionable) {
    const waiter = byAction.get("wait_for_system");
    if (waiter && waiter.code === "evaluation_blocked") {
      byAction.delete("wait_for_system");
    }
  }

  // Sort by priority descending.
  return Array.from(byAction.values()).sort(
    (a, b) => BLOCKED_REASON_PRIORITY[b.action] - BLOCKED_REASON_PRIORITY[a.action],
  );
}

// ---------------------------------------------------------------------------
// Monitoring snapshot — evidence-first translator. Turns RAW COUNTS the
// system has actually observed (competitors watched, posts scanned, insights
// validated, etc.) into customer-safe English lines that emphasize what the
// system IS doing, not what is missing.
//
// Design rule: every line MUST be backed by a real number from the DB. If
// the count is 0 we still surface the line — but framed as "what we need
// next" rather than absence. Never invent activity that didn't happen.
// ---------------------------------------------------------------------------

export interface MonitoringFacts {
  competitorsWatched: number;
  lastScanAt: Date | string | null;
  competitorPostsAnalyzed7d: number;
  publishedPosts: number;
  validatedInsights: number;
  baselineStatus: "forming" | "ready";
  marketQ1: string | null;   // boss_runs.q1_verdict (latest)
  marketQ2: string | null;   // boss_runs.q2_verdict (latest)
  lastReviewAt: Date | string | null;
}

function fmtAge(ts: Date | string | null): string | null {
  if (!ts) return null;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const ageMs = Date.now() - d.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageH = Math.floor(ageMs / 3_600_000);
  if (ageH < 26) return `${ageH}h ago`;
  return `${Math.floor(ageH / 24)}d ago`;
}

export function buildMonitoringLines(f: MonitoringFacts): WatchtowerLine[] {
  const lines: WatchtowerLine[] = [];

  // Line 1 — competitor watchlist (always emitted).
  if (f.competitorsWatched > 0) {
    const noun = f.competitorsWatched === 1 ? "competitor" : "competitors";
    lines.push({
      tone: "stable",
      headline: `Watching ${f.competitorsWatched} ${noun}`,
      detail: "Profiles re-scanned automatically on the next cycle.",
    });
  } else {
    lines.push({
      tone: "watching",
      headline: "No competitors added yet",
      detail: "Add competitor profiles in Market DB to start watching their activity.",
    });
  }

  // Line 2 — last completed competitor scan.
  if (f.lastScanAt) {
    const age = fmtAge(f.lastScanAt);
    const ts = typeof f.lastScanAt === "string" ? new Date(f.lastScanAt) : f.lastScanAt;
    const ageH = (Date.now() - ts.getTime()) / 3_600_000;
    const tone: WatchtowerTone = ageH < 26 ? "stable" : ageH < 24 * 8 ? "watching" : "issue";
    lines.push({
      tone,
      headline: `Last competitor scan ${age}`,
      detail: tone === "issue"
        ? "Scans usually run on a 1–3 day cycle. We'll retry on the next tick."
        : "Scans run automatically on a 1–3 day cycle.",
    });
  } else if (f.competitorsWatched > 0) {
    lines.push({
      tone: "watching",
      headline: "First competitor scan pending",
      detail: "Initial scan starts after your next monitoring tick.",
    });
  }

  // Line 3 — volume of evidence collected in last 7d.
  if (f.competitorPostsAnalyzed7d > 0) {
    const noun = f.competitorPostsAnalyzed7d === 1 ? "post" : "posts";
    lines.push({
      tone: "stable",
      headline: `Analyzed ${f.competitorPostsAnalyzed7d} competitor ${noun} this week`,
      detail: "Used to detect shifts in hooks, offers, and posting cadence.",
    });
  } else if (f.competitorsWatched > 0 && f.lastScanAt) {
    lines.push({
      tone: "watching",
      headline: "No new competitor posts in the last 7 days",
      detail: "Quiet week — market activity unchanged. We'll keep scanning.",
    });
  }

  // Line 4 — market verdict from latest boss_run (if any). Fail-closed:
  // if the verdict is missing OR outside the known enum, the line is
  // dropped entirely — never reframed as a normal startup state.
  if (f.marketQ2) {
    const q2 = translateQ2Verdict(f.marketQ2);
    if (q2) lines.push(q2);
  }

  // Line 5 — validated insights tracked in strategy memory.
  if (f.validatedInsights > 0) {
    const noun = f.validatedInsights === 1 ? "insight" : "insights";
    lines.push({
      tone: "stable",
      headline: `Tracking ${f.validatedInsights} validated ${noun}`,
      detail: "Confidence-banded facts about your audience, offer, and positioning.",
    });
  } else {
    lines.push({
      tone: "watching",
      headline: "Building validated insights",
      detail: "First high-confidence insights appear after a few review cycles.",
    });
  }

  // Line 6 — your own publishing activity (the input the optimizer needs).
  if (f.publishedPosts > 0) {
    const noun = f.publishedPosts === 1 ? "post" : "posts";
    if (f.baselineStatus === "ready") {
      lines.push({
        tone: "stable",
        headline: `${f.publishedPosts} ${noun} published — performance baseline ready`,
        detail: "Optimization recommendations are now grounded in your real results.",
      });
    } else {
      lines.push({
        tone: "watching",
        headline: `${f.publishedPosts} ${noun} published — baseline still forming`,
        detail: "A few more posting cycles are needed before performance trends are reliable.",
      });
    }
  } else {
    lines.push({
      tone: "watching",
      headline: "No posts published yet",
      detail: "Publish from the calendar to unlock performance-based optimization.",
    });
  }

  // Line 7 — last review heartbeat. We DO NOT label this "scheduled"
  // unless the trigger proves a scheduler origin — today boss_runs.trigger
  // is "manual" | "approval" only (cron deferred), so neutral copy is the
  // only truthful framing (B1).
  if (f.lastReviewAt) {
    lines.push({
      tone: "stable",
      headline: `Last review ${fmtAge(f.lastReviewAt)}`,
      detail: "Reviews run automatically on plan approval and when changes are detected.",
    });
  }

  return lines;
}


// ---------------------------------------------------------------------------
// Watchtower Structured Before/After Comparison Formatter
// ---------------------------------------------------------------------------
// Prevents raw object coercion ("[object Object]") and raw JSON dumps in UI
// cards while preserving exact semantic distinctions among:
//   absent (no baseline / undefined), unknown, null, empty, 0, and false.
// ---------------------------------------------------------------------------

export type ComparisonValueState =
  | "present"
  | "absent"
  | "unknown"
  | "null"
  | "empty"
  | "explicit_none"
  | "zero"
  | "false";

export interface ComparisonFieldRow {
  label: string;
  before: string;
  after: string;
  changeType?: "added" | "removed" | "modified" | "unchanged" | "context";
}

export interface WatchtowerStructuredComparison {
  kind: string;
  categoryLabel: string;
  beforeSummary: string;
  afterSummary: string;
  beforeValueState: ComparisonValueState;
  afterValueState: ComparisonValueState;
  rows: ComparisonFieldRow[];
  methodologyNote: string | null;
  rawTechnicalJson: string;
}

function unwrapLegacyStateWrapper(val: unknown, key: "previous" | "current"): unknown {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.keys(parsed).length === 1 &&
          key in parsed
        ) {
          return (parsed as Record<string, unknown>)[key];
        }
        return parsed;
      } catch {
        return val;
      }
    }
  }
  if (
    val &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    Object.keys(val as Record<string, unknown>).length === 1 &&
    key in (val as Record<string, unknown>)
  ) {
    return (val as Record<string, unknown>)[key];
  }
  return val;
}

export function classifyComparisonValueState(
  val: unknown,
  hasBaseline = true
): ComparisonValueState {
  if (!hasBaseline && val === undefined) return "absent";
  if (val === undefined) return "absent";
  if (val === null) return "null";
  if (val === 0) return "zero";
  if (val === false) return "false";
  if (typeof val === "string") {
    const t = val.trim();
    if (t === "") return "empty";
    if (t.toLowerCase() === "unknown" || t.toLowerCase() === "n/a") return "unknown";
    if (/^none(\s+listed)?$/i.test(t)) return "explicit_none";
    if (t === "0") return "zero";
    if (t.toLowerCase() === "false") return "false";
    return "present";
  }
  if (Array.isArray(val)) {
    return val.length === 0 ? "empty" : "present";
  }
  if (typeof val === "object") {
    return Object.keys(val as Record<string, unknown>).length === 0 ? "empty" : "present";
  }
  return "present";
}

export function formatScalarOrStructuredValue(
  val: unknown,
  options?: { hasBaseline?: boolean; isBefore?: boolean }
): string {
  const hasBaseline = options?.hasBaseline ?? true;
  const state = classifyComparisonValueState(val, hasBaseline);
  switch (state) {
    case "absent":
      return options?.isBefore && !hasBaseline
        ? "Absent (no baseline snapshot recorded)"
        : "Absent (not recorded)";
    case "null":
      return "Null (explicitly unset)";
    case "empty":
      return "Empty (none recorded)";
    case "explicit_none":
      return "None";
    case "unknown":
      return "Unknown";
    case "zero":
      return "0";
    case "false":
      return "false";
  }

  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "string") {
    return val.trim();
  }
  if (Array.isArray(val)) {
    const formattedItems = val
      .map((item) => {
        if (item === null) return "null";
        if (item === undefined) return "absent";
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return String(item).trim();
        }
        if (typeof item === "object") {
          return formatObjectAsReadableSummary(item as Record<string, unknown>);
        }
        return String(item);
      })
      .filter((s) => s.length > 0);
    return formattedItems.length > 0 ? formattedItems.map((s) => `• ${s}`).join("\n") : "Empty (none recorded)";
  }
  if (typeof val === "object" && val !== null) {
    return formatObjectAsReadableSummary(val as Record<string, unknown>);
  }
  return String(val);
}

function formatObjectAsReadableSummary(obj: Record<string, unknown>): string {
  // 1. Semantic distribution object: { top, share, distribution }
  if ("top" in obj && ("share" in obj || "distribution" in obj)) {
    const topRaw = typeof obj.top === "string" ? obj.top : String(obj.top ?? "none");
    const topLabel = humanizeSemanticValue(topRaw) || topRaw;
    const shareNum =
      typeof obj.share === "number"
        ? obj.share <= 1 && obj.share > 0
          ? Math.round(obj.share * 100)
          : Math.round(obj.share)
        : null;
    const headline =
      shareNum !== null ? `Dominant: ${topLabel} (${shareNum}% share)` : `Dominant: ${topLabel}`;

    const dist = obj.distribution;
    if (dist && typeof dist === "object" && !Array.isArray(dist)) {
      const rawEntries = Object.entries(dist as Record<string, unknown>)
        .filter(([, v]) => typeof v === "number")
        .sort((a, b) => (b[1] as number) - (a[1] as number));
      const sumVals = rawEntries.reduce((acc, [, v]) => acc + (v as number), 0);
      const isFractionalRatio =
        rawEntries.length > 0 &&
        rawEntries.every(([, v]) => (v as number) <= 1) &&
        sumVals <= 1.05;
      const entries = rawEntries.map(([k, v]) => {
        const num = v as number;
        const label = humanizeSemanticValue(k) || k;
        if (isFractionalRatio) {
          return `${label}: ${Math.round(num * 100)}%`;
        }
        const pct = sumVals > 0 ? Math.round((num / sumVals) * 100) : 0;
        return Number.isInteger(num) ? `${label}: ${num} posts (${pct}%)` : `${label}: ${Math.round(num)}%`;
      });
      if (entries.length > 0) {
        return `${headline}\nDistribution: ${entries.join(", ")}`;
      }
    }
    return headline;
  }

  // 2. Pricing object: { price, currency, billingPeriod, discount, conditions, ... }
  if ("price" in obj || "currency" in obj || "discount" in obj || "billingPeriod" in obj) {
    const parts: string[] = [];
    if (obj.price !== undefined && obj.price !== null) {
      const curr = obj.currency ? `${obj.currency} ` : "";
      const period = obj.billingPeriod ? ` / ${obj.billingPeriod}` : "";
      parts.push(`Price: ${curr}${obj.price}${period}`);
    } else if (obj.currency) {
      parts.push(`Currency: ${obj.currency}`);
    }
    if (obj.billingPeriod && obj.price === undefined) {
      parts.push(`Billing Period: ${obj.billingPeriod}`);
    }
    if (obj.discount !== undefined && obj.discount !== null) {
      parts.push(`Discount: ${obj.discount}`);
    }
    if (obj.conditions !== undefined && obj.conditions !== null) {
      parts.push(`Conditions: ${obj.conditions}`);
    }
    if (parts.length > 0) return parts.join(" · ");
  }

  // 3. Generic labelled key-value object
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const label = humanizeSemanticValue(k) || k;
    if (v === null) {
      pairs.push(`${label}: null`);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      pairs.push(`${label}: ${v}`);
    } else if (Array.isArray(v)) {
      const inner = v
        .map((x) => (typeof x === "object" && x !== null ? formatObjectAsReadableSummary(x as Record<string, unknown>) : String(x)))
        .join(", ");
      pairs.push(`${label}: [${inner}]`);
    } else if (typeof v === "object") {
      pairs.push(`${label}: (${formatObjectAsReadableSummary(v as Record<string, unknown>)})`);
    }
  }
  return pairs.length > 0 ? pairs.join(" · ") : "Empty (none recorded)";
}

function parsePriceSignalDetails(items: string[]): {
  prices: string[];
  currencies: string[];
  billingPeriods: string[];
  discounts: string[];
  conditions: string[];
} {
  const prices: string[] = [];
  const currencies = new Set<string>();
  const billingPeriods: string[] = [];
  const discounts: string[] = [];
  const conditions: string[] = [];

  for (const raw of items) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const currMatch = s.match(/(£|\$|€|USD|GBP|EUR|AED|CAD|AUD)/i);
    if (currMatch) currencies.add(currMatch[1].toUpperCase());

    const hasNumericPrice = /(?:£|\$|€|USD|GBP|EUR)\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:£|\$|€|USD|GBP|EUR)/i.test(s);
    const isDiscountTerm = /discount|off|sale|promo|anniversary|coupon|bundle|save/i.test(s);
    const isPeriod = /month|annual|year|week|one-time|per song|subscription/i.test(s);
    const isCondition = /minimum|limit|selected|terms|refund|guarantee|free|delivery/i.test(s);

    if (hasNumericPrice) prices.push(s);
    if (isDiscountTerm) discounts.push(s);
    if (isPeriod) billingPeriods.push(s);
    if (isCondition) conditions.push(s);
    if (!hasNumericPrice && !isDiscountTerm && !isPeriod && !isCondition) {
      prices.push(s);
    }
  }

  return {
    prices,
    currencies: Array.from(currencies),
    billingPeriods,
    discounts,
    conditions,
  };
}

export function formatWatchtowerComparison(params: {
  kind?: string | null;
  eventKind?: string | null;
  evidence?: unknown;
  prev?: unknown;
  curr?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
  beforeValue?: unknown;
  afterValue?: unknown;
  fromValue?: string | null;
  toValue?: string | null;
  diffSummary?: string | null;
  hasBaseline?: boolean;
  baselineTimestamp?: string | null;
  currentTimestamp?: string | null;
  baselineSnapshotId?: string | null;
  currentSnapshotId?: string | null;
  failureCode?: string | null;
}): WatchtowerStructuredComparison {
  const kind = (params.kind || params.eventKind || "market_signal").trim();
  const categoryLabel = translateSignalKind(kind) || humanizeSemanticValue(kind) || "Market Signal";

  let parsedEv: Record<string, any> = {};
  if (typeof params.evidence === "string" && params.evidence.trim()) {
    try {
      parsedEv = JSON.parse(params.evidence);
    } catch {
      parsedEv = { notes: [params.evidence] };
    }
  } else if (params.evidence && typeof params.evidence === "object") {
    parsedEv = params.evidence as Record<string, any>;
  }

  const candidatePrev =
    params.prev !== undefined
      ? params.prev
      : params.oldValue !== undefined
        ? params.oldValue
        : params.beforeValue !== undefined
          ? params.beforeValue
          : parsedEv.prev !== undefined
            ? parsedEv.prev
            : params.fromValue ?? undefined;

  const candidateCurr =
    params.curr !== undefined
      ? params.curr
      : params.newValue !== undefined
        ? params.newValue
        : params.afterValue !== undefined
          ? params.afterValue
          : parsedEv.curr !== undefined
            ? parsedEv.curr
            : params.toValue ?? undefined;

  const rawPrev = unwrapLegacyStateWrapper(candidatePrev, "previous");
  const rawCurr = unwrapLegacyStateWrapper(candidateCurr, "current");

  const hasBaseline =
    params.hasBaseline !== undefined
      ? params.hasBaseline
      : rawPrev !== undefined;

  const beforeValueState = classifyComparisonValueState(rawPrev, hasBaseline);
  const afterValueState = classifyComparisonValueState(rawCurr, true);

  const rows: ComparisonFieldRow[] = [];
  let beforeSummary = formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true });
  let afterSummary = formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false });
  let methodologyNote: string | null = null;

  const notes: string[] = Array.isArray(parsedEv.notes)
    ? parsedEv.notes.map((n: unknown) => String(n))
    : [];

  const toReadableList = (val: unknown): string[] => {
    if (val === null || val === undefined) return [];
    if (Array.isArray(val)) {
      return val
        .map((item) => {
          if (item === null || item === undefined) return "";
          if (typeof item === "object") {
            return formatObjectAsReadableSummary(item as Record<string, unknown>);
          }
          return String(item).trim();
        })
        .filter(Boolean);
    }
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.plans)) {
        return toReadableList(obj.plans);
      }
      const formatted = formatObjectAsReadableSummary(obj);
      return formatted ? [formatted] : [];
    }
    const s = String(val).trim();
    return s ? [s] : [];
  };

  // 1. PRICING CHANGE
  if (kind === "pricing_change" || kind === "pricing_page_change") {
    const prevList = toReadableList(rawPrev);
    const currList = toReadableList(rawCurr);
    const pDetails = parsePriceSignalDetails(prevList);
    const cDetails = parsePriceSignalDetails(currList);

    rows.push({
      label: "Observed Price Points",
      before: !hasBaseline
        ? "Absent (no baseline snapshot)"
        : pDetails.prices.length > 0
        ? pDetails.prices.join(", ")
        : "No explicit numeric price point extracted",
      after: cDetails.prices.length > 0
        ? cDetails.prices.join(", ")
        : "No explicit numeric price point extracted",
      changeType:
        pDetails.prices.join("|") !== cDetails.prices.join("|") ? "modified" : "unchanged",
    });

    rows.push({
      label: "Currency & Billing Basis",
      before: !hasBaseline
        ? "Absent"
        : [
            pDetails.currencies.join("/") || "Unspecified currency",
            pDetails.billingPeriods.join(", ") || "One-time / unspecified period",
          ].join(" · "),
      after: [
        cDetails.currencies.join("/") || pDetails.currencies.join("/") || "Unspecified currency",
        cDetails.billingPeriods.join(", ") || "One-time / unspecified period",
      ].join(" · "),
      changeType: "context",
    });

    rows.push({
      label: "Promotional Discount / Banner",
      before: !hasBaseline
        ? "Absent"
        : pDetails.discounts.length > 0
        ? pDetails.discounts.join(", ")
        : "None observed in baseline",
      after: cDetails.discounts.length > 0
        ? cDetails.discounts.join(", ")
        : "None observed in current snapshot",
      changeType:
        pDetails.discounts.join("|") !== cDetails.discounts.join("|") ? "added" : "unchanged",
    });

    if (pDetails.conditions.length > 0 || cDetails.conditions.length > 0) {
      rows.push({
        label: "Purchase Conditions",
        before: pDetails.conditions.join("; ") || "None specified",
        after: cDetails.conditions.join("; ") || "None specified",
        changeType: "modified",
      });
    }

    beforeSummary = !hasBaseline
      ? "Absent (no baseline snapshot recorded)"
      : prevList.length > 0
      ? `Price Signals: ${prevList.join(" · ")}${pDetails.currencies.length ? ` (${pDetails.currencies.join("/")})` : ""}`
      : formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true });

    afterSummary = currList.length > 0
      ? `Price / Promo Signals: ${currList.join(" · ")}${
          cDetails.discounts.length > 0 && cDetails.prices.length === 0
            ? " (Promotional discount banner detected; base checkout price not independently confirmed changed)"
            : ""
        }`
      : formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false });

    if (cDetails.discounts.length > 0 && cDetails.prices.length === 0) {
      methodologyNote =
        "A promotional discount banner was detected while the previous numeric price string was absent from the current crawl excerpt. A discount banner alone does not prove a permanent base price or pricing-model change.";
    }
  }
  // 2. OFFER LANGUAGE CHANGE
  else if (kind === "offer_language_change") {
    const prevList = Array.isArray(rawPrev) ? toReadableList(rawPrev) : [];
    const currList = Array.isArray(rawCurr) ? toReadableList(rawCurr) : [];

    const prevLower = new Set(prevList.map((s) => s.toLowerCase()));
    const currLower = new Set(currList.map((s) => s.toLowerCase()));

    const removed = prevList.filter((s) => !currLower.has(s.toLowerCase()));
    const added = currList.filter((s) => !prevLower.has(s.toLowerCase()));
    const retained = currList.filter((s) => prevLower.has(s.toLowerCase()));

    if (removed.length > 0 || added.length > 0) {
      rows.push({
        label: "Changed Offer Terms & Conditions",
        before: removed.length > 0 ? removed.map((s) => `• ${s}`).join("\n") : "No prior terms removed",
        after: added.length > 0 ? added.map((s) => `• ${s}`).join("\n") : "No new terms added",
        changeType: "modified",
      });
    }
    if (retained.length > 0) {
      rows.push({
        label: "Unchanged Deliverables & Terms",
        before: `${retained.length} core offer statement(s) retained`,
        after: retained.slice(0, 4).map((s) => `• ${s}`).join("\n"),
        changeType: "unchanged",
      });
    }

    beforeSummary = !hasBaseline
      ? "Absent (no baseline snapshot recorded)"
      : removed.length > 0
      ? `Removed / Superseded Wording (${removed.length}):\n${removed.map((s) => `• ${s}`).join("\n")}\n\nRetained (${retained.length}): ${retained.slice(0, 3).join(" · ")}`
      : formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true });

    afterSummary = added.length > 0
      ? `Added Offer / Policy Wording (${added.length}):\n${added.map((s) => `• ${s}`).join("\n")}\n\nRetained (${retained.length}): ${retained.slice(0, 3).join(" · ")}`
      : formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false });
  }
  // 3. COMPETITOR PROFILE / MESSAGING / FEATURE CHANGE
  else if (kind === "competitor_profile_change") {
    const prevList = Array.isArray(rawPrev) ? toReadableList(rawPrev) : [];
    const currList = Array.isArray(rawCurr) ? toReadableList(rawCurr) : [];

    const prevLower = new Set(prevList.map((s) => s.toLowerCase()));
    const currLower = new Set(currList.map((s) => s.toLowerCase()));

    const removed = prevList.filter((s) => !currLower.has(s.toLowerCase()));
    const added = currList.filter((s) => !prevLower.has(s.toLowerCase()));
    const retained = currList.filter((s) => prevLower.has(s.toLowerCase()));

    if (removed.length > 0) {
      rows.push({
        label: "Claims / Features Absent From Current Crawl",
        before: removed.map((s) => `• ${s}`).join("\n"),
        after:
          params.failureCode === "COUNTEREVIDENCE_CONTRADICTION"
            ? "Absent in single snapshot diff, but contradicted by active website/social evidence"
            : "Not present in current snapshot extraction",
        changeType: "removed",
      });
    }
    if (added.length > 0) {
      rows.push({
        label: "Newly Extracted Claims / Messaging",
        before: "Not present in baseline snapshot extraction",
        after: added.map((s) => `• ${s}`).join("\n"),
        changeType: "added",
      });
    }
    if (retained.length > 0) {
      rows.push({
        label: "Retained Profile Claims",
        before: retained.slice(0, 4).map((s) => `• ${s}`).join("\n"),
        after: retained.slice(0, 4).map((s) => `• ${s}`).join("\n"),
        changeType: "unchanged",
      });
    }

    beforeSummary = !hasBaseline
      ? "Absent (no baseline snapshot recorded)"
      : removed.length > 0
      ? `Previously Extracted Claims (${prevList.length} total; ${removed.length} absent in current diff):\n${removed.map((s) => `• ${s}`).join("\n")}${retained.length > 0 ? `\n\nRetained: ${retained.slice(0, 3).join(" · ")}` : ""}`
      : formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true });

    afterSummary = added.length > 0 || retained.length > 0
      ? `${added.length > 0 ? `Newly Extracted (${added.length}):\n${added.map((s) => `• ${s}`).join("\n")}\n\n` : ""}Current Active Claims (${currList.length} total):\n${currList.slice(0, 5).map((s) => `• ${s}`).join("\n")}`
      : formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false });

    if (params.failureCode === "COUNTEREVIDENCE_CONTRADICTION") {
      methodologyNote =
        "Contradictory Evidence Detected: Although the snapshot diff flagged a claim/feature as missing, current competitor social posts and website understanding snapshots still reference this feature. Treated as extraction coverage variance (MONITORING only).";
    }
  }
  // 4. POSTING FREQUENCY / CADENCE SHIFT
  else if (kind === "posting_frequency_shift") {
    const freqMeta = parsedEv.frequency_meta || {};
    const prevCount = rawPrev !== undefined && rawPrev !== null ? Number(rawPrev) : freqMeta.previous_count;
    const currCount = rawCurr !== undefined && rawCurr !== null ? Number(rawCurr) : freqMeta.current_count;
    const windowDays = freqMeta.window_days ?? null;
    const coverage = freqMeta.window_Coverage ?? "unspecified";
    const pctDelta =
      typeof prevCount === "number" && typeof currCount === "number" && prevCount > 0
        ? `${currCount >= prevCount ? "+" : ""}${Math.round(((currCount - prevCount) / prevCount) * 100)}%`
        : null;

    rows.push({
      label: "Stored Post Count",
      before:
        prevCount !== undefined && prevCount !== null && !Number.isNaN(prevCount)
          ? `${prevCount} stored posts`
          : formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true }),
      after:
        currCount !== undefined && currCount !== null && !Number.isNaN(currCount)
          ? `${currCount} stored posts${pctDelta ? ` (${pctDelta})` : ""}`
          : formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false }),
      changeType: "modified",
    });

    rows.push({
      label: "Comparison Window & Dates",
      before: params.baselineTimestamp
        ? `Baseline snapshot: ${params.baselineTimestamp}`
        : windowDays
        ? `Nominal ${windowDays}-day observation window (exact start/end post timestamps not deduplicated)`
        : "Baseline snapshot total count",
      after: params.currentTimestamp
        ? `Current snapshot: ${params.currentTimestamp}`
        : windowDays
        ? `Nominal ${windowDays}-day observation window`
        : "Current snapshot total count",
      changeType: "context",
    });

    rows.push({
      label: "Collection Coverage",
      before: `Coverage: ${coverage}`,
      after: `Coverage: ${coverage}${
        freqMeta.confidence_adjustment ? ` (confidence factor: ${freqMeta.confidence_adjustment})` : ""
      }`,
      changeType: "context",
    });

    beforeSummary =
      prevCount !== undefined && prevCount !== null && !Number.isNaN(prevCount)
        ? `${prevCount} stored posts in baseline snapshot (coverage: ${coverage})`
        : formatScalarOrStructuredValue(rawPrev, { hasBaseline, isBefore: true });

    afterSummary =
      currCount !== undefined && currCount !== null && !Number.isNaN(currCount)
        ? `${currCount} stored posts in current snapshot${pctDelta ? ` (${pctDelta})` : ""} (window: ${
            windowDays ? `${windowDays}d nominal` : "snapshot total"
          }, coverage: ${coverage})`
        : formatScalarOrStructuredValue(rawCurr, { hasBaseline: true, isBefore: false });

    methodologyNote =
      "Count reflects stored posts across snapshots with partial window coverage rather than deduplicated publishing timestamps inside an identical date window. Increased stored-post count alone does not prove an acceleration in publishing cadence.";
  }
  // 5. SEMANTIC DISTRIBUTION SHIFTS (narrative_shift, offer_type_shift, cta_strategy_shift, positioning_shift, etc.)
  else if (
    (rawPrev && typeof rawPrev === "object" && !Array.isArray(rawPrev) && "top" in (rawPrev as any)) ||
    (rawCurr && typeof rawCurr === "object" && !Array.isArray(rawCurr) && "top" in (rawCurr as any))
  ) {
    const pObj = (rawPrev && typeof rawPrev === "object" ? rawPrev : {}) as Record<string, any>;
    const cObj = (rawCurr && typeof rawCurr === "object" ? rawCurr : {}) as Record<string, any>;

    const pTop = pObj.top ? humanizeSemanticValue(String(pObj.top)) : hasBaseline ? "None" : "Absent";
    const cTop = cObj.top ? humanizeSemanticValue(String(cObj.top)) : "None";
    const fmtSharePct = (s: unknown) =>
      typeof s === "number"
        ? `${s <= 1 && s > 0 ? Math.round(s * 100) : Math.round(s)}%`
        : "—";
    const pShare = fmtSharePct(pObj.share);
    const cShare = fmtSharePct(cObj.share);

    rows.push({
      label: "Dominant Pattern",
      before: !hasBaseline ? "Absent (no baseline)" : `${pTop} (${pShare} share)`,
      after: `${cTop} (${cShare} share)`,
      changeType: pTop !== cTop ? "modified" : "unchanged",
    });

    const pDistVals = Object.values(pObj.distribution || {}).filter((v) => typeof v === "number") as number[];
    const cDistVals = Object.values(cObj.distribution || {}).filter((v) => typeof v === "number") as number[];
    const pDistSum = pDistVals.reduce((a, b) => a + b, 0);
    const cDistSum = cDistVals.reduce((a, b) => a + b, 0);
    const pIsRatio = pDistVals.length > 0 && pDistVals.every((v) => v <= 1) && pDistSum <= 1.05;
    const cIsRatio = cDistVals.length > 0 && cDistVals.every((v) => v <= 1) && cDistSum <= 1.05;
    const fmtDistVal = (v: unknown, isRatio: boolean, total: number) => {
      if (typeof v !== "number") return "0%";
      if (isRatio) return `${Math.round(v * 100)}%`;
      const pct = total > 0 ? Math.round((v / total) * 100) : 0;
      return Number.isInteger(v) ? `${v} posts (${pct}%)` : `${Math.round(v)}%`;
    };

    const allKeys = new Set<string>([
      ...Object.keys(pObj.distribution || {}),
      ...Object.keys(cObj.distribution || {}),
    ]);
    for (const k of Array.from(allKeys)) {
      const pv = pObj.distribution?.[k];
      const cv = cObj.distribution?.[k];
      const pvStr = fmtDistVal(pv, pIsRatio, pDistSum);
      const cvStr = fmtDistVal(cv, cIsRatio, cDistSum);
      rows.push({
        label: `Share: ${humanizeSemanticValue(k) || k}`,
        before: !hasBaseline ? "Absent" : pvStr,
        after: cvStr,
        changeType: pvStr !== cvStr ? "modified" : "unchanged",
      });
    }

    beforeSummary = !hasBaseline
      ? "Absent (no baseline snapshot recorded)"
      : formatObjectAsReadableSummary(pObj);
    afterSummary = formatObjectAsReadableSummary(cObj);
  }
  // 6. GENERIC / LEGACY / OTHER PAYLOADS
  else {
    rows.push({
      label: categoryLabel,
      before: beforeSummary,
      after: afterSummary,
      changeType: beforeSummary !== afterSummary ? "modified" : "unchanged",
    });
  }

  if (rows.length === 0 && notes.length > 0) {
    rows.push({
      label: "Observed Notes",
      before: beforeSummary,
      after: notes.join(" · "),
      changeType: "modified",
    });
  }

  if (rows.length === 0) {
    rows.push({
      label: categoryLabel,
      before: beforeSummary,
      after: afterSummary,
      changeType: beforeSummary !== afterSummary ? "modified" : "unchanged",
    });
  }

  let rawTechnicalJson = "{}";
  try {
    rawTechnicalJson = JSON.stringify(
      {
        kind,
        hasBaseline,
        beforeValueState,
        afterValueState,
        prev: rawPrev ?? null,
        curr: rawCurr ?? null,
        notes: notes.length > 0 ? notes : undefined,
        frequency_meta: parsedEv.frequency_meta,
      },
      null,
      2
    );
  } catch {
    rawTechnicalJson = "{}";
  }

  return {
    kind,
    categoryLabel,
    beforeSummary,
    afterSummary,
    beforeValueState,
    afterValueState,
    rows,
    methodologyNote,
    rawTechnicalJson,
  };
}
