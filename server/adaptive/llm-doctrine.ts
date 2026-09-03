/**
 * LLM Authority Doctrine & Structured Reasoning Contracts
 * 
 * Constitutional Principle:
 * Every semantic LLM prompt must explicitly separate:
 * 1. CANONICAL STRATEGY (Frozen Context)
 * 2. SUPPORTING EVIDENCE / SIGNALS (Observations)
 * 3. TASK (Analytical Mandate)
 * 4. ALLOWED DECISIONS (Permitted Output Actions)
 * 5. FORBIDDEN DECISIONS (Prohibited Inferences / Strategic Mutations)
 * 6. EXPECTED OUTPUT SCHEMA (Deterministic JSON Contract)
 * 
 * Reliability Standard:
 * Generator / Reasoner -> Judge -> Targeted Repair -> Bounded Retry -> Fail Closed.
 */

export interface LLMAuthorityPromptContract {
  canonicalStrategyContext: string;
  supportingEvidence: string;
  taskDescription: string;
  allowedDecisions: string[];
  forbiddenDecisions: string[];
  outputSchemaDescription: string;
}

/**
 * Builds a standardized authority prompt conforming to the Avyron Adaptive Doctrine.
 */
export function buildAdaptiveAuthorityPrompt(contract: LLMAuthorityPromptContract): string {
  return `
============================================================
1. CURRENT CANONICAL STRATEGY (AUTHORITATIVE FROZEN CONTEXT)
============================================================
${contract.canonicalStrategyContext.trim()}

============================================================
2. SUPPORTING EVIDENCE & SIGNALS (OBSERVATIONS)
============================================================
${contract.supportingEvidence.trim()}

============================================================
3. YOUR MANDATE / TASK
============================================================
${contract.taskDescription.trim()}

============================================================
4. ALLOWED DECISIONS
============================================================
${contract.allowedDecisions.map(d => `- ${d}`).join("\n")}

============================================================
5. STRICTLY FORBIDDEN ACTIONS
============================================================
${contract.forbiddenDecisions.map(f => `- ${f}`).join("\n")}
- DO NOT invent facts, buyer pains, or competitor claims not supported by evidence.
- DO NOT rewrite Positioning, Differentiation, Offer, or Audience directly.
- DO NOT return generic placeholder or deterministic keyword responses.
- If evidence is insufficient, you MUST fail-closed by returning "INSUFFICIENT_EVIDENCE".

============================================================
6. EXPECTED OUTPUT SCHEMA
============================================================
${contract.outputSchemaDescription.trim()}
`.trim();
}

export const REASONING_ENGINE_DOCTRINE = {
  allowedDecisions: [
    "Identify causal relationships between observed market/performance signals and strategic assumptions",
    "Formulate structured hypotheses with supporting and contradicting evidence IDs",
    "Estimate confidence based strictly on evidence strength and sample recency",
    "Recommend specific strategic authorities for re-evaluation (e.g. DIFFERENTIATION, OFFER)",
    "Recommend OBSERVE or INSUFFICIENT_EVIDENCE when confidence is below threshold",
  ],
  forbiddenDecisions: [
    "Rewriting canonical Positioning statements",
    "Rewriting canonical Differentiation pillars or claim structures",
    "Rewriting Offer outcomes, guarantees, or pricing architecture",
    "Mutating Strategy Root directly",
    "Inventing unverified market signals or competitor capabilities",
  ],
};
