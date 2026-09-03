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
