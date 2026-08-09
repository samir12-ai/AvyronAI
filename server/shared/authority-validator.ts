import type { ValidatedCapability } from "./capability-registry";

/**
 * ============================================================================
 * AUTHORITY VALIDATOR — deterministic enforcement of the namespace boundaries
 * ============================================================================
 *
 * Enforces (in CODE, not prompt text) the global authority model:
 *   PROBLEM_NAMESPACE    — central customer problems must resolve to the
 *                          engine's selected authoritative pains.
 *   CAPABILITY_NAMESPACE — product capability claims must resolve to
 *                          validated capabilityIds.
 *   SYNTHESIS_NAMESPACE  — engines may connect the two but may not change,
 *                          invent, or merge either authority.
 *
 * Checks are generic — NO hardcoded product names, pain topics, or keywords.
 * Violations produce precise retry feedback; callers reject + rerun inside
 * the existing bounded retry policy (never silent rewrite).
 */

export interface SelectedPainLike {
  painId: string;
  canonical: string;
}

export type AuthorityViolationKind =
  | "UNAUTHORIZED_PROBLEM" // central problem doesn't resolve to any selected pain
  | "UNSUPPORTED_CAPABILITY" // capabilityRefs cite ids outside the validated set
  | "PAIN_CAPABILITY_MERGE"; // problem text is capability language, not the selected pain

export interface AuthorityViolation {
  kind: AuthorityViolationKind;
  detail: string;
  /** Precise retry feedback for the regeneration prompt. */
  retryFeedback: string;
}

export interface AuthorityCheckResult {
  passed: boolean;
  violations: AuthorityViolation[];
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were will with our your you we they them us not no most more they're don't can't lack lacks".split(
    " ",
  ),
);

function contentTokens(s: string): Set<string> {
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function overlapRatio(text: string, reference: string): number {
  const t = contentTokens(text);
  if (t.size === 0) return 0;
  const ref = contentTokens(reference);
  let hit = 0;
  for (const tok of t) if (ref.has(tok)) hit++;
  return hit / t.size;
}

/** Distinctive capability tokens = capability tokens absent from every selected pain. */
function distinctiveCapabilityTokens(
  capabilities: ValidatedCapability[],
  pains: SelectedPainLike[],
): Set<string> {
  const painTokens = new Set<string>();
  for (const p of pains) for (const t of contentTokens(p.canonical)) painTokens.add(t);
  const out = new Set<string>();
  for (const c of capabilities) {
    for (const t of contentTokens(c.statement)) {
      if (!painTokens.has(t)) out.add(t);
    }
  }
  return out;
}

/**
 * Validate one engine output against the authority boundaries.
 *
 * @param centralProblemTexts The output fields that CLAIM a central customer
 *   problem (e.g. problemStatement, coreProblem, territory problem framing).
 *   The CALLER decides which fields are "central" — this validator never
 *   guesses. Empty array → problem checks are skipped (truthful N/A).
 * @param capabilityRefs The structured capabilityRefs the LLM emitted
 *   (undefined → capability-ref check skipped; prompt+judge still apply).
 */
export function validateAuthorityBoundaries(params: {
  engineId: string;
  centralProblemTexts: string[];
  capabilityRefs?: unknown;
  selectedPains: SelectedPainLike[];
  capabilities: ValidatedCapability[];
}): AuthorityCheckResult {
  const { engineId, centralProblemTexts, selectedPains, capabilities } = params;
  const violations: AuthorityViolation[] = [];

  // ---- CAPABILITY CHECK: emitted refs must be a subset of validated ids ----
  if (Array.isArray(params.capabilityRefs) && capabilities.length > 0) {
    const allowed = new Set(capabilities.map((c) => c.capabilityId));
    const cited = params.capabilityRefs.filter((r): r is string => typeof r === "string");
    const invalid = cited.filter((r) => !allowed.has(r.trim()));
    if (invalid.length > 0) {
      violations.push({
        kind: "UNSUPPORTED_CAPABILITY",
        detail: `engine=${engineId} cited capabilityRefs outside the validated registry: ${invalid.join(", ")}`,
        retryFeedback: `Your output cited capability IDs that are NOT in the validated capability registry: ${invalid.join(", ")}. Cite ONLY these validated IDs: ${[...allowed].join(", ")}. Do not invent capabilities.`,
      });
    }
  }

  // ---- PROBLEM + MERGE CHECKS on each central problem claim ----
  if (centralProblemTexts.length > 0 && selectedPains.length > 0) {
    const capDistinct = distinctiveCapabilityTokens(capabilities, selectedPains);
    for (const text of centralProblemTexts) {
      const trimmed = String(text || "").trim();
      if (trimmed.length === 0) continue;
      const bestPainOverlap = Math.max(...selectedPains.map((p) => overlapRatio(trimmed, p.canonical)));
      const toks = contentTokens(trimmed);
      let capHits = 0;
      for (const t of toks) if (capDistinct.has(t)) capHits++;
      const capShare = toks.size > 0 ? capHits / toks.size : 0;

      // MERGE: the "problem" is predominantly capability language with no
      // resolution to any selected pain → capability was transformed into
      // the customer's problem (the poisoning signature).
      if (bestPainOverlap < 0.15 && capShare >= 0.35) {
        violations.push({
          kind: "PAIN_CAPABILITY_MERGE",
          detail: `engine=${engineId} central problem is capability language (capShare=${capShare.toFixed(2)}, painOverlap=${bestPainOverlap.toFixed(2)}): "${trimmed.slice(0, 120)}"`,
          retryFeedback: `Your central problem statement is built from PRODUCT CAPABILITY language, not the authorized customer pain. The customer's problem MUST be one of the selected authoritative pains: ${selectedPains.map((p) => `${p.painId} ("${p.canonical}")`).join("; ")}. Product capabilities describe the SOLUTION, never the problem. Rewrite the problem statement to state the selected pain, then connect a validated capability to it.`,
        });
        continue;
      }
      // UNAUTHORIZED_PROBLEM: central problem resolves to no selected pain.
      if (bestPainOverlap < 0.15) {
        violations.push({
          kind: "UNAUTHORIZED_PROBLEM",
          detail: `engine=${engineId} central problem resolves to no selected pain (best overlap ${bestPainOverlap.toFixed(2)}): "${trimmed.slice(0, 120)}"`,
          retryFeedback: `Your central problem claim does not resolve to any authorized selected pain. Use one of: ${selectedPains.map((p) => `${p.painId} ("${p.canonical}")`).join("; ")}. Do not reselect the problem from business context or invent a new one.`,
        });
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`[AuthorityValidator] AUTHORITY_VIOLATION | ${v.kind} | ${v.detail}`);
    }
  }
  return { passed: violations.length === 0, violations };
}
