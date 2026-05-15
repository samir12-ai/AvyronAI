// Operations Guardian — strict-typed enums + USER_COPY firewall.
//
// Doctrine compliance:
//   * D2 — every meaning has its own canonical field. Category, severity,
//     audience, recovery outcome are each a dedicated enum, not a
//     polysemous `status`.
//   * D3 — strict enums. `as const` tuples + derived union types; no
//     z.string() and no `| string` escape hatch anywhere downstream.
//   * D5 — no silent semantic substitution. The classifier returns
//     undefined when a signal does not justify a notice; callers MUST
//     handle the undefined branch explicitly.
//
// USER_COPY firewall:
//   audience='user' notices MUST have a copy entry below. The interpreter
//   refuses to write audience='user' for any category not present here.
//   During the observe-only rollout, USER_COPY is INTENTIONALLY EMPTY —
//   nothing customer-visible ships until copy review unlocks each
//   category individually after we have noise-floor data.

export const NOTICE_CATEGORIES = [
  // Internal-only categories — describe raw runtime state. Have no place
  // in user-facing surfaces ever; the firewall enforces this.
  "LEAKED_LOCK",
  "WORKER_STUCK",
  "RETRY_LOOP",
  "CHAIN_DEGRADED",
  "CHAIN_DEAD",
  // Operator-eligible interpretations — may be promoted to operator audience
  // once persistence threshold is met.
  "SCHEDULER_HEARTBEAT_DEAD",
  // User-eligible interpretations (NOT yet enabled — gated by USER_COPY).
  // Listed here so the type system reserves the names; the interpreter
  // does not currently emit these because USER_COPY is empty.
  "MARKET_DATA_DEGRADED",
  "PLAN_DEGRADED",
  "SCRAPER_PROVIDER_DEGRADED",
  "AI_QUOTA_PRESSURE",
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_SEVERITIES = ["info", "warning", "degraded", "critical"] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

export const NOTICE_AUDIENCES = ["internal", "operator", "user"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export const RECOVERY_OUTCOMES = [
  "not_attempted",
  "success",
  "failed",
  "not_applicable",
] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

// Type-guard used at every write boundary. A category not in the list
// must surface as an error log (silent-degradation doctrine — Seal #15)
// rather than a silent string write.
export function isNoticeCategory(v: string): v is NoticeCategory {
  return (NOTICE_CATEGORIES as readonly string[]).includes(v);
}

// USER_COPY firewall.
//
// EMPTY during observe-only rollout. When a category is added here, the
// interpreter gains permission to emit audience='user' for that
// category. Adding a category requires:
//   1. Copy review (no internal vocabulary; impact-language only).
//   2. Same-PR test that the rendered string passes the no-tech-leak
//      regex check.
//   3. UI surface (banner / footnote) wired to read it.
export interface UserCopyTemplate {
  titleKey: string;
  bodyKey: string;
  defaultTitle: string;
  defaultBody: string;
  defaultSeverity: NoticeSeverity;
  // Variables expected in copyVars. The renderer interpolates {{name}}
  // tokens. Missing variables render as the literal token (visible bug
  // signal in dev/staging).
  vars: readonly string[];
}

// Empty during observe-only. DO NOT add entries without explicit copy
// review approval per the user's instruction.
export const USER_COPY: Partial<Record<NoticeCategory, UserCopyTemplate>> = {};

export function canPromoteToUser(category: NoticeCategory): boolean {
  return USER_COPY[category] !== undefined;
}

// Internal-only sentinels. The interpreter REFUSES to set audience='user'
// or audience='operator' for these categories from outside the
// interpreter itself. They live exclusively in the raw Operations panel
// (audit-control screen) and the operator-notices panel — never in any
// customer surface.
export const INTERNAL_ONLY_CATEGORIES = new Set<NoticeCategory>([
  "LEAKED_LOCK",
  // The remaining internal categories ARE allowed at operator audience
  // (that's their primary surface). LEAKED_LOCK is the strictest — it
  // means a watchdog already cleaned up; nothing actionable for the
  // operator beyond "watch the trend."
]);
