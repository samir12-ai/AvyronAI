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

export interface WatchtowerLine {
  tone: WatchtowerTone;
  headline: string;        // short, < 60 chars
  detail: string | null;   // optional 1-sentence subtext, < 140 chars
}

// boss_runs.q2_verdict — "is the market still the same as when we made the plan?"
export function translateQ2Verdict(q2: string | null | undefined): WatchtowerLine {
  switch (q2) {
    case "STABLE":
      return { tone: "stable", headline: "Market is steady", detail: "Nothing has shifted since your last plan." };
    case "SHIFTED":
      return { tone: "shift", headline: "Market shift detected", detail: "Recent signals look different from when this plan was made. A review is queued." };
    case "UNCERTAIN":
      return { tone: "watching", headline: "Watching the market", detail: "Not enough signal yet to confirm a shift." };
    default:
      return { tone: "unknown", headline: "Market check pending", detail: null };
  }
}

// boss_runs.q1_verdict — "is the current plan actually working?"
export function translateQ1Verdict(q1: string | null | undefined): WatchtowerLine {
  switch (q1) {
    case "WORKING":
      return { tone: "stable", headline: "Plan is working", detail: "Performance is in line with expectations." };
    case "DEGRADED":
      return { tone: "issue", headline: "Plan is underperforming", detail: "Results have slipped vs. expectations. A correction is queued." };
    case "UNKNOWN":
      return { tone: "watching", headline: "Measuring results", detail: "Waiting on enough data to judge this plan." };
    default:
      return { tone: "unknown", headline: "Plan check pending", detail: null };
  }
}

// Freshness: how recent was the last check?
export function translateFreshness(lastCheckedAt: Date | string | null): WatchtowerLine {
  if (!lastCheckedAt) {
    return { tone: "unknown", headline: "No recent check", detail: "Your first analysis hasn't completed yet." };
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
