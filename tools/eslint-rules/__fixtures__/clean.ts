/**
 * Seal #9 (F10.3) — clean fixture: the no-semantic-fallback rule MUST
 * NOT flag any of the patterns below. Proves the rule does not produce
 * false positives on the canonical-form rewrites used throughout the
 * codebase post-Seal #9.
 */

declare const a: { status?: string; verdict?: string; outcome?: string };
declare const b: string;

// Helper-extracted reads — the forbidden identifier is read inside an
// `if`, NOT inside a logical-fallback expression, so the rule is silent.
export function readSectionStatus(r: { status?: unknown } | undefined): string {
  if (!r) return "PENDING";
  const v = r.status;
  if (typeof v === "string" && v.length > 0) return v;
  return "CONTRACT_INCOMPLETE";
}

// Plain non-verdict identifiers may use logical fallbacks freely.
export const name = a?.status ? "yes" : "no"; // ternary TEST is not checked
export const namedAlias = b || "fallback"; // `namedAlias` is not a forbidden name

// Plain reads (no fallback, no aliasing) are fine.
export const direct = a.status;
export const memberRead = a?.outcome;

// Seal #9 / F10.3 (pass-3 final): suffix-style canonical names
// (`validationState`, `decisionAction`, `budgetAction`, ...) ARE covered
// by the wider alias/destructured detectors. The 24 engine-internal
// authoring sites that legitimately first-write these values are
// exempted via documented `eslint-disable-next-line` comments — same
// pattern as the F1 status-authoring exemptions in iteration-engine
// and retention-engine.
//
// Benign suffix collisions on identifiers with NO `(status|verdict|outcome|state|action)`
// suffix MUST stay silent.
export const firstName = (a as any)?.firstName || "anon";
export const myCounter = (a as any)?.counter || 0;
