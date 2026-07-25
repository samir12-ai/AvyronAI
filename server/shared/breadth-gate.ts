/**
 * ============================================================================
 * BREADTH GATE — deterministic specificity check (Phase 1 / T6)
 * ============================================================================
 *
 * A pure-regex, deterministic gate that rejects broad-audience boilerplate:
 * "anyone who...", "people who want [category]", "all [demographic]" and close
 * variants. This is one of the deterministic code gates that remain the sole
 * non-negotiable floor under the "AI Proposes, Code Validates" doctrine — it
 * runs regardless of whether the LLM interchangeability judge could run.
 *
 * It returns the list of matched patterns so a caller's retry loop can inject
 * precise, structured rejection feedback ("Rejected by breadth gate: ...").
 *
 * No LLM, no I/O, no throw — safe to call anywhere on any string.
 */

export interface BreadthResult {
  /** true when the text contains NO broad-audience catch-all patterns. */
  passed: boolean;
  /** Human-readable names of the catch-all families that matched (for feedback). */
  violations: string[];
  /** The exact substrings that tripped the gate (for precise feedback). */
  matched: string[];
}

interface BreadthPattern {
  name: string;
  re: RegExp;
}

// Each pattern targets a CATCH-ALL opening, not any "who" clause — a genuinely
// specific segment ("freelance developers who bill hourly") must pass.
const BREADTH_PATTERNS: readonly BreadthPattern[] = [
  {
    name: '"anyone/everyone who…" catch-all',
    re: /\b(?:any|every)(?:one|body)\s+(?:who|that|looking|wanting|interested|wishing|needing)\b/i,
  },
  {
    name: '"people/those who want|need…" catch-all',
    re: /\b(?:people|folks|those|individuals|persons?|users|customers|clients)\s+who\s+(?:want|wants|need|needs|wish|wishes|desire|desires|would\s+like|are\s+looking|like)\b/i,
  },
  {
    name: '"all [demographic]" broad group',
    re: /\ball\s+(?:the\s+)?(?:\w+\s+){0,2}(?:people|humans|persons?|businesses?|business\s+owners?|companies|organi[sz]ations?|brands?|women|men|adults|kids|children|parents|students|customers|clients|users|consumers|shoppers|buyers|entrepreneurs?|professionals?|marketers?|developers?|founders?|teams?)\b/i,
  },
  {
    name: '"any [demographic]" catch-all',
    re: /\bany\s+(?:\w+\s+){0,2}(?:business(?:es)?|business\s+owners?|company|companies|person|people|individual|customer|client|user|consumer|professional|entrepreneur)\b/i,
  },
];

/**
 * Test a candidate string for broad-audience boilerplate.
 * @param text the candidate segment / positioning / offer / rationale text.
 */
export function checkBreadth(text: string): BreadthResult {
  if (!text || !text.trim()) {
    // Empty is not "broad", but it is unusable — report explicitly so a caller
    // never mistakes an empty candidate for a specific one.
    return { passed: false, violations: ["EMPTY: no text to evaluate"], matched: [] };
  }

  const violations: string[] = [];
  const matched: string[] = [];
  for (const p of BREADTH_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      violations.push(p.name);
      matched.push(m[0].trim());
    }
  }

  return { passed: violations.length === 0, violations, matched };
}

/**
 * Render a one-line rejection-feedback string for a retry prompt.
 * Returns "" when the text passed (nothing to inject).
 */
export function breadthRejectionFeedback(result: BreadthResult): string {
  if (result.passed) return "";
  const detail = result.matched.length
    ? ` (matched: ${result.matched.map((s) => `"${s}"`).join(", ")})`
    : "";
  return `Rejected by breadth gate: too broad — ${result.violations.join("; ")}${detail}. Replace the catch-all with a describable group defined by a shared, verifiable, situation-specific problem.`;
}
