/**
 * ============================================================================
 * CONTRADICTION JUDGE — "AI Proposes, Code Validates" (Phase 1 / spec item 10)
 * ============================================================================
 *
 * A hostile LLM reviewer that enforces cross-engine coherence: a freshly
 * generated candidate (segment / positioning claim / offer / channel rationale)
 * that CONTRADICTS a validated prior-engine decision is INVALID and must be
 * rejected at validation, "with the prior decision named in the feedback."
 *
 * This complements the interchangeability judge (is the candidate generic?) and
 * the breadth gate (is the candidate too broad?). Here the question is coherence
 * with what upstream engines already validated — e.g. the offer engine proposing
 * a different target buyer than the audience engine already locked in.
 *
 * PURITY (import-direction rule): this module lives in server/shared and MUST
 * NOT import SharedStrategicContext or any server/orchestrator type. It receives
 * the prior decisions as a plain EngineDecisionSummary[] (also a server/shared
 * type). Recording the verdict into SSC.contradictions via addContradiction()
 * happens at the ENGINE call site (Phase 2), never in here.
 *
 * REPLAY INVARIANT: server/shared is whitelisted to import aiChat; the retry
 * loop lives in the calling engine, not here. This module renders ONE verdict.
 *
 * NO-BARE-LLM: aiChat enforces its own wall-clock HARD_TIMEOUT_MS internally,
 * so a plain aiChat call already satisfies the continuity doctrine.
 *
 * VERDICT SEMANTICS (D1/D5 — no silent substitution):
 *   CONSISTENT   — the candidate does not contradict any prior decision.
 *   CONTRADICTS  — the candidate conflicts with a named prior decision; `fix`
 *                  explains the change needed. `contradictedEngineId` names it.
 *   NOT_RUN      — the judge did not run a comparison (no prior decisions to
 *                  check, empty candidate, LLM call failure, or unparseable
 *                  output). Assigned explicitly per branch, NEVER via `?? / ||`.
 *                  Callers MUST NOT treat NOT_RUN as CONTRADICTS (never reject
 *                  on abstention) — deterministic gates remain the floor (B3).
 */
import { z } from "zod";
import { aiChat } from "../ai-client";
import {
  type ProductAnchor,
  type EngineDecisionSummary,
  safeJsonParse,
} from "./strategic-doctrine";
import type { JudgeKind } from "./interchangeability-judge";

// D3 strict enum — full returned verdict space. The LLM only ever emits the
// first two; NOT_RUN is this module's explicit "did not compare" classification.
export const ContradictionVerdictSchema = z.enum([
  "CONSISTENT",
  "CONTRADICTS",
  "NOT_RUN",
]);
export type ContradictionJudgeVerdict = z.infer<typeof ContradictionVerdictSchema>;

export interface ContradictionVerdict {
  kind: JudgeKind;
  verdict: ContradictionJudgeVerdict;
  /** engineId of the prior decision contradicted; null unless CONTRADICTS. */
  contradictedEngineId: string | null;
  /** One-sentence justification naming the conflict (or why it is consistent). */
  reason: string;
  /** Actionable correction when CONTRADICTS; "" otherwise. */
  fix: string;
}

// What the LLM is allowed to return. NOT_RUN is intentionally absent here.
const ContradictionOutputSchema = z.object({
  verdict: z.enum(["CONSISTENT", "CONTRADICTS"]),
  contradictedEngineId: z.string().nullable().default(null),
  reason: z.string().min(1),
  fix: z.string().default(""),
});

const KIND_LABEL: Record<JudgeKind, string> = {
  segment: "AUDIENCE SEGMENT DEFINITION",
  positioning_claim: "POSITIONING CLAIM / TERRITORY",
  offer: "OFFER (outcome + mechanism)",
  channel_rationale: "CHANNEL RECOMMENDATION RATIONALE",
};

function anchorReference(anchor: ProductAnchor | null): string {
  if (!anchor) {
    return "REFERENCE PRODUCT: (none — no product anchor is set for this campaign).";
  }
  const attrs = anchor.keyAttributes.length ? anchor.keyAttributes.join("; ") : "(none listed)";
  return [
    "REFERENCE PRODUCT:",
    `- Name: ${anchor.name}`,
    `- Type: ${anchor.type}`,
    `- Key attributes: ${attrs}`,
    `- Core problem solved: ${anchor.coreProblemSolved}`,
    `- Differentiating feature: ${anchor.differentiatingFeature}`,
  ].join("\n");
}

function buildContradictionPrompt(
  kind: JudgeKind,
  candidate: string,
  priorDecisions: EngineDecisionSummary[],
  anchor: ProductAnchor | null,
): string {
  const priorBlock = priorDecisions
    .map((d, i) => `[${i + 1}] engineId="${d.engineId}": ${d.summary}`)
    .join("\n");

  return `You are a hostile CROSS-ENGINE COHERENCE reviewer for a marketing-strategy pipeline. Multiple engines run in sequence; each earlier engine's decision is already VALIDATED and LOCKED. A new candidate must not CONTRADICT any locked prior decision.

A CONTRADICTION means the candidate cannot be simultaneously true with a prior decision — e.g. it targets a different buyer than the audience engine locked, or picks a strategic axis the positioning engine already ruled out. Do NOT flag mere elaboration, added detail, or a narrower focus that is still consistent with the prior decision. Only flag genuine conflicts.

${anchorReference(anchor)}

VALIDATED PRIOR DECISIONS (locked — the candidate must be consistent with ALL of these):
${priorBlock}

NEW ${KIND_LABEL[kind]} CANDIDATE TO REVIEW:
"""
${candidate}
"""

If the candidate contradicts one or more prior decisions, set verdict="CONTRADICTS" and put the engineId of the SINGLE most directly contradicted decision in contradictedEngineId. Otherwise verdict="CONSISTENT" and contradictedEngineId=null.

Return ONLY valid JSON, no commentary:
{"verdict":"CONSISTENT"|"CONTRADICTS","contradictedEngineId":"engineId or null","reason":"one sentence naming the conflict or confirming coherence","fix":"if CONTRADICTS, the exact change needed to reconcile with the named prior decision; else empty string"}`;
}

// ---------------------------------------------------------------------------
// The judge. One candidate + prior decisions in, one verdict out. Fail-closed
// to NOT_RUN. A SINGLE LLM call compares the candidate against ALL priors.
// ---------------------------------------------------------------------------

export async function judgeContradiction(input: {
  kind: JudgeKind;
  candidate: string;
  priorDecisions: EngineDecisionSummary[];
  productAnchor: ProductAnchor | null;
  accountId: string;
}): Promise<ContradictionVerdict> {
  const { kind, candidate, priorDecisions, productAnchor, accountId } = input;

  if (!candidate || !candidate.trim()) {
    console.error(`[ContradictionJudge] EMPTY_CANDIDATE kind=${kind} — verdict=NOT_RUN`);
    return { kind, verdict: "NOT_RUN", contradictedEngineId: null, reason: "EMPTY_CANDIDATE: nothing to judge", fix: "" };
  }

  // No prior decisions → nothing to contradict. Honest NOT_RUN (the gate did
  // not compare anything), NOT a synthetic CONSISTENT. Callers proceed anyway.
  if (!priorDecisions || priorDecisions.length === 0) {
    console.log(`[ContradictionJudge] NO_PRIOR_DECISIONS kind=${kind} — verdict=NOT_RUN`);
    return { kind, verdict: "NOT_RUN", contradictedEngineId: null, reason: "NO_PRIOR_DECISIONS: no validated prior decision to compare against", fix: "" };
  }

  let raw: string | null = null;
  try {
    const resp = await aiChat({
      messages: [{ role: "user", content: buildContradictionPrompt(kind, candidate, priorDecisions, productAnchor) }],
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 300,
      accountId,
    });
    raw = resp.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ContradictionJudge] CALL_FAILED kind=${kind} — verdict=NOT_RUN — ${msg}`);
    return { kind, verdict: "NOT_RUN", contradictedEngineId: null, reason: `JUDGE_ERROR: ${msg}`, fix: "" };
  }

  const parsed = safeJsonParse(raw, ContradictionOutputSchema);
  if (!parsed) {
    console.error(
      `[ContradictionJudge] UNPARSEABLE kind=${kind} — verdict=NOT_RUN — raw="${(raw ?? "").slice(0, 80)}"`,
    );
    return { kind, verdict: "NOT_RUN", contradictedEngineId: null, reason: "JUDGE_ERROR: unparseable judge output", fix: "" };
  }

  // Explicit per-branch assignment — parsed.verdict is a strict enum, no `??`.
  const verdict: ContradictionJudgeVerdict = parsed.verdict;
  // When CONSISTENT, force contradictedEngineId to null (the LLM may echo a
  // stray id); when CONTRADICTS, keep whatever it named (may be null if it
  // could not attribute — still a valid rejection with a reason).
  const contradictedEngineId = verdict === "CONTRADICTS" ? parsed.contradictedEngineId : null;
  console.log(
    `[ContradictionJudge] kind=${kind} verdict=${verdict} contradicted=${contradictedEngineId ?? "-"} reason="${parsed.reason.slice(0, 80)}"`,
  );
  return { kind, verdict, contradictedEngineId, reason: parsed.reason, fix: parsed.fix };
}
