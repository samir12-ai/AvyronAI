/**
 * ============================================================================
 * INTERCHANGEABILITY JUDGE — "AI Proposes, Code Validates" (Phase 1)
 * ============================================================================
 *
 * A hostile LLM reviewer that enforces the doctrine RESOLUTION_RULE: a strategy
 * output that could be pasted UNCHANGED into a generic competitor's marketing is
 * interchangeable, therefore INVALID. This is one additional gate layered on top
 * of the deterministic gates (breadth regex, per-field grounding, cross-engine
 * contradiction) — the deterministic code remains the sole non-negotiable floor.
 *
 * Architecture mirrors the approved hostile-judge half of positioning-engine/
 * category-game.ts (single-shot review, temp 0.1, verdict + reason struct). The
 * retry loop lives in the CALLING engine (audience / positioning / offer /
 * channel), not here — this module only renders a verdict for one candidate.
 *
 * REPLAY INVARIANT: this file is explicitly whitelisted to import aiChat. New
 * LLM calls for the AI-proposes flow live here or inside engine dirs — NEVER in
 * server/orchestrator/replay/** (ESLint orchestrator-replay/no-bare-llm-call-in-replay).
 *
 * NO-BARE-LLM: aiChat enforces its own HARD_TIMEOUT_MS wall-clock timeout, so a
 * plain aiChat call already satisfies the continuity doctrine.
 *
 * VERDICT SEMANTICS (D1/D5 — no silent substitution):
 *   ACCEPTED  — the LLM judged the candidate non-interchangeable.
 *   REJECTED  — the LLM judged the candidate interchangeable; `fix` explains how.
 *   NOT_RUN   — the judge could not produce a verdict (empty candidate, LLM call
 *               failure, or unparseable output). NOT_RUN is assigned explicitly
 *               per branch, NEVER via `?? / ||`. Callers MUST handle NOT_RUN
 *               explicitly and MUST NOT treat it as ACCEPTED — because the
 *               deterministic gates still run, a NOT_RUN here means only that
 *               this optional LLM gate abstained (safe degradation, B3).
 */
import { z } from "zod";
import { aiChat } from "../ai-client";
import { type ProductAnchor, safeJsonParse } from "./strategic-doctrine";

// ---------------------------------------------------------------------------
// Output shapes the judge can test — one prompt per shape (spec item 8a–8d).
// ---------------------------------------------------------------------------

export const JudgeKindSchema = z.enum([
  "segment",
  "positioning_claim",
  "offer",
  "channel_rationale",
  "performance_interpretation",
]);
export type JudgeKind = z.infer<typeof JudgeKindSchema>;

// D3 strict enum — the full returned verdict space (LLM only ever emits the
// first two; NOT_RUN is this module's explicit "could not judge" classification).
export const InterchangeabilityVerdictSchema = z.enum([
  "ACCEPTED",
  "REJECTED",
  "NOT_RUN",
]);
export type JudgeVerdict = z.infer<typeof InterchangeabilityVerdictSchema>;

export interface InterchangeabilityVerdict {
  kind: JudgeKind;
  verdict: JudgeVerdict;
  /** One-sentence justification (cites the interchangeable phrase or anchor tie). */
  reason: string;
  /** Actionable correction when REJECTED; "" otherwise. */
  fix: string;
}

// What the LLM is allowed to return. NOT_RUN is intentionally absent here.
const JudgeOutputSchema = z.object({
  verdict: z.enum(["ACCEPTED", "REJECTED"]),
  reason: z.string().min(1),
  fix: z.string().default(""),
});

// ---------------------------------------------------------------------------
// Per-kind interchangeability test text (the only thing that varies by shape).
// ---------------------------------------------------------------------------

const KIND_TEST: Record<JudgeKind, { label: string; test: string; examples: string }> = {
  segment: {
    label: "AUDIENCE SEGMENT DEFINITION",
    test:
      "A segment FAILS only when it is so broad or vague that it could describe the audience of virtually ANY product in the category — a broad demographic (\"small business owners\"), a vague desire (\"people who want to save time\"), or an \"anyone who...\" catch-all. A segment PASSES when it names a describable group with a shared, verifiable, situation-specific problem — EVEN IF another narrowly-focused competitor could also target that same specific situation. What matters is the SPECIFICITY of the situation, NOT whether the audience is exclusive to this product. Do not reject a segment merely because a rival serving the same niche could share it.",
    examples:
      'Generic (REJECT): "business owners who want to grow", "anyone looking to save time". Specific (ACCEPT): a named group defined by a shared, verifiable, situation-specific constraint (e.g. a concrete workflow pain, tool, or measurable loss they experience).',
  },
  positioning_claim: {
    label: "POSITIONING CLAIM / TERRITORY",
    test:
      "Could this claim or territory be made, UNCHANGED, by any generic competitor in the category? Claims like \"most trusted\", \"best value\", \"innovative solution\" are interchangeable and FAIL. A valid claim ties to THIS product's differentiating feature or mechanism in a way a competitor could not truthfully repeat.",
    examples:
      'Generic (REJECT): "the smart choice for modern teams". Specific (ACCEPT): a claim anchored to the named differentiating feature.',
  },
  offer: {
    label: "OFFER (outcome + mechanism language)",
    test:
      "Could this offer's outcome and mechanism language be attached, UNCHANGED, to a generic competitor's product? Vague outcomes (\"get results\", \"save money\") paired with vague mechanisms (\"our proven system\") are interchangeable and FAIL. A valid offer names the specific outcome THIS product's mechanism produces.",
    examples:
      'Generic (REJECT): "transform your business with our proven system". Specific (ACCEPT): a named outcome produced by the named mechanism.',
  },
  channel_rationale: {
    label: "CHANNEL RECOMMENDATION RATIONALE",
    test:
      "Could this channel reasoning be given, UNCHANGED, for any generic competitor in the category? Best-practice reasoning like \"Instagram because it has high engagement\" or \"email because it converts\" is interchangeable and FAILS. A valid rationale explains why THIS specific segment is reachable on THIS channel for THIS product.",
    examples:
      'Generic (REJECT): "run Meta ads because they reach a broad audience". Specific (ACCEPT): reasoning tied to where this exact segment\'s attention actually is.',
  },
  // P-2 Phase 5D — performance interpretation (hypotheses + next experiment +
  // campaign-specificity narrative). The judge tests BOTH interchangeability
  // AND evidence honesty: generic marketing advice, template-shaped
  // recommendations, and correlation presented as causation all FAIL.
  performance_interpretation: {
    label: "PERFORMANCE INTERPRETATION (hypotheses, next experiment, campaign specificity)",
    test:
      "Reject if ANY of these hold: (1) the hypotheses or recommended experiment could be pasted UNCHANGED into a generic competitor's performance report — best-practice advice like \"post more consistently\", \"use stronger hooks\", \"engage your audience\" is interchangeable and FAILS; (2) the text presents a correlation or hypothesis as a proven causal result (e.g. claims content CAUSED sales/customers without the text itself flagging attribution as confirmed); (3) the recommendation reads like a fixed template with the campaign's nouns swapped in. A valid interpretation names the actual posts, hooks, angles, metrics, and product mechanism, and its experiment changes exactly one named variable for a stated, evidence-tied reason.",
    examples:
      'Generic (REJECT): "test different hook styles to see what resonates with your audience". Specific (ACCEPT): an experiment that names the exact hook/angle value being varied, the constants preserved, and the evidence that motivated it.',
  },
};

function anchorReference(anchor: ProductAnchor | null): string {
  if (!anchor) {
    return [
      "REFERENCE PRODUCT: (none — no product anchor is set for this campaign).",
      "Because no specific product is anchored, apply the WEAKER test: reject only if the text is pure category boilerplate that names no describable segment, mechanism, or situation. Do not demand product-name specificity that cannot exist here.",
    ].join("\n");
  }
  const attrs = anchor.keyAttributes.length ? anchor.keyAttributes.join("; ") : "(none listed)";
  return [
    "REFERENCE PRODUCT (the output must be specific to THIS product, not the category):",
    `- Name: ${anchor.name}`,
    `- Type: ${anchor.type}`,
    `- Key attributes: ${attrs}`,
    `- Core problem solved: ${anchor.coreProblemSolved}`,
    `- Differentiating feature: ${anchor.differentiatingFeature}`,
  ].join("\n");
}

export interface JudgeAuthorityContext {
  selectedPains?: Array<{ painId: string; canonical: string }>;
  capabilities?: Array<{ capabilityId: string; statement: string }>;
}

function authoritySection(authority: JudgeAuthorityContext | null | undefined): string {
  if (!authority) return "";
  const parts: string[] = [];
  const pains = authority.selectedPains ?? [];
  const caps = authority.capabilities ?? [];
  if (pains.length === 0 && caps.length === 0) return "";
  parts.push("AUTHORITY BOUNDARIES (also REJECT on any of these):");
  if (pains.length > 0) {
    parts.push(
      `- AUTHORIZED CUSTOMER PROBLEMS (the ONLY problems the output may center): ${pains.map((p) => `"${p.canonical}"`).join("; ")}. REJECT if the output's central customer problem is a different problem, an invented problem, or product-capability/competitor-weakness language reframed as the customer's problem.`,
    );
  }
  if (caps.length > 0) {
    parts.push(
      `- VALIDATED PRODUCT CAPABILITIES (the ONLY capabilities the output may claim): ${caps.map((c) => `"${c.statement}"`).join("; ")}. REJECT if the output claims a product capability not covered by these.`,
    );
  }
  parts.push(
    "- REJECT if the output merges a capability with evidence fragments into a new authoritative-sounding problem or capability that exists in neither list.",
  );
  return parts.join("\n") + "\n\n";
}

function buildJudgePrompt(
  kind: JudgeKind,
  candidate: string,
  anchor: ProductAnchor | null,
  authority?: JudgeAuthorityContext | null,
): string {
  const k = KIND_TEST[kind];
  return `You are a hostile INTERCHANGEABILITY reviewer for a marketing-strategy engine. You have read thousands of generic marketing documents and you reject anything that could belong to a competitor unchanged.

THE ONE TEST — INTERCHANGEABILITY:
${k.test}

${k.examples}

${anchorReference(anchor)}

${authoritySection(authority)}${k.label} TO REVIEW:
"""
${candidate}
"""

Judge ONLY interchangeability — ignore grammar, tone, and length. If the text would survive being swapped onto a generic competitor with no edit, it FAILS.

Return ONLY valid JSON, no commentary:
{"verdict":"ACCEPTED"|"REJECTED","reason":"one sentence citing the interchangeable phrase or the specific anchor tie","fix":"if REJECTED, the exact change needed to make it non-interchangeable; else empty string"}`;
}

// ---------------------------------------------------------------------------
// The judge. One candidate in, one verdict out. Fail-closed to NOT_RUN.
// ---------------------------------------------------------------------------

export async function judgeInterchangeability(input: {
  kind: JudgeKind;
  candidate: string;
  productAnchor: ProductAnchor | null;
  accountId: string;
  /** Optional authority boundaries (selected pains / validated capabilities) the judge also enforces. */
  authority?: JudgeAuthorityContext | null;
}): Promise<InterchangeabilityVerdict> {
  const { kind, candidate, productAnchor, accountId, authority } = input;

  // Empty candidate is a caller bug, not a judgeable output. Explicit NOT_RUN
  // (never silently ACCEPTED) so the caller retries or degrades visibly.
  if (!candidate || !candidate.trim()) {
    console.error(`[InterchangeabilityJudge] EMPTY_CANDIDATE kind=${kind} — verdict=NOT_RUN`);
    return { kind, verdict: "NOT_RUN", reason: "EMPTY_CANDIDATE: nothing to judge", fix: "" };
  }

  let raw: string | null = null;
  try {
    const resp = await aiChat({
      messages: [{ role: "user", content: buildJudgePrompt(kind, candidate, productAnchor, authority) }],
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 300,
      accountId,
    });
    raw = resp.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[InterchangeabilityJudge] CALL_FAILED kind=${kind} — verdict=NOT_RUN — ${msg}`);
    return { kind, verdict: "NOT_RUN", reason: `JUDGE_ERROR: ${msg}`, fix: "" };
  }

  const parsed = safeJsonParse(raw, JudgeOutputSchema);
  if (!parsed) {
    console.error(
      `[InterchangeabilityJudge] UNPARSEABLE kind=${kind} — verdict=NOT_RUN — raw="${(raw ?? "").slice(0, 80)}"`,
    );
    return { kind, verdict: "NOT_RUN", reason: "JUDGE_ERROR: unparseable judge output", fix: "" };
  }

  // Explicit per-branch assignment — parsed.verdict is a strict enum, no `??`.
  const verdict: JudgeVerdict = parsed.verdict;
  console.log(
    `[InterchangeabilityJudge] kind=${kind} verdict=${verdict} reason="${parsed.reason.slice(0, 80)}"`,
  );
  return { kind, verdict, reason: parsed.reason, fix: parsed.fix };
}
