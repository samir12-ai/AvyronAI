/**
 * Seal #9 (F10.3) — fixture file containing every shape the
 * no-semantic-fallback rule MUST flag. Used by
 * server/tests/doctrine-regression.test.ts to prove the rule's
 * AST detector covers H6 baseline + H8 + Seal #9 alias / destructured
 * patterns.
 *
 * This file is INTENTIONALLY linted: each line below is an offender.
 * Do not import this file from production code.
 */

declare const a: { status?: string; verdict?: string; outcome?: string };
declare const b: string;
declare const cond: boolean;

// H6 baseline — RHS forbidden identifier read.
export const r1 = b ?? a.status;
export const r2 = b || a.verdict;

// H8 — LHS forbidden member read with fallback.
export const r3 = a?.outcome ?? b;
export const r4 = a?.status || b;

// H8 — ternary branch reads forbidden field.
export const r5 = cond ? a.outcome : b;
export const r6 = cond ? b : a.verdict;

// Seal #9 / F10.3 — alias-variable assignment with logical fallback.
// Wrapped in a function so the local `const status / verdict / outcome`
// declarations do not collide with the module-level destructured bindings
// further below. The rule operates on the AST regardless of scope.
export function _aliasOffenders() {
  const status = a?.status || "PENDING";    // alias-LHS exact `status`
  const verdict = a?.verdict ?? "UNKNOWN";  // alias-LHS exact `verdict`
  const outcome = cond ? a.outcome : "x";   // alias-ternary exact `outcome`
  return [status, verdict, outcome];
}

// Seal #9 / F10.3 — destructured default substituting a fabricated value.
// The destructured detector inspects the AssignmentPattern's `left` Identifier
// — which is the BOUND name, not the source property name. The un-renamed
// pattern (`{ status = ... }`) makes the bound name the canonical `status`
// token the rule checks.
export const { status = "PENDING" } = a;
export const { outcome = "fallback" } = a;

// Seal #9 / F10.3 (pass-3 final): the alias / destructured detectors
// cover suffix-style canonical contract fields too (anything ending
// in `status|verdict|outcome|state|action`, case-insensitive). Engine
// authoring sites that legitimately first-write these are exempted
// via documented in-line `eslint-disable-next-line` comments.
declare const v: { validationState?: string; decisionAction?: string; budgetAction?: string };
export function _suffixAliasOffenders() {
  const validationState = v?.validationState || "provisional"; // alias-LHS suffix — MUST flag
  const decisionAction = v?.decisionAction ?? "hold";          // alias-LHS suffix — MUST flag
  const { budgetAction = "halt" } = v;                         // destructured suffix — MUST flag
  return { validationState, decisionAction, budgetAction };
}
