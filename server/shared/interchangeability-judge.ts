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
  "strategic_decision",
  "brand_spine",
  "proof_strategy",
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

export const KIND_TEST: Record<JudgeKind, { label: string; test: string; examples: string }> = {
  segment: {
    label: "AUDIENCE SEGMENT DEFINITION",
    test:
      "A segment FAILS only when it is so broad or vague that it is a pure zero-information tautology ('people who exist', 'consumers who buy things', 'people looking for general solutions'). A segment PASSES when it describes a buyer group with a specific functional, emotional, operational, or situational need grounded in the offering's market context (e.g. consumers seeking personalized milestone gifts under tight deadlines, operations leads managing multi-team handoff bottlenecks, buyers evaluating reliability before purchase). Multiple competitors legitimately serve these same audience concerns — do NOT reject a segment because another competitor could also target the same buyer need. Do NOT demand brand exclusivity or industry-irrelevant jargon.",
    examples:
      'Generic (REJECT): "people who want to buy products", "anyone looking for results". Specific (ACCEPT): "Gift buyers seeking emotionally resonant personalized presents for milestone occasions", "Operations leads managing cross-team handoff delays", "Consumers comparing transparent pricing and preview options before purchase". ALWAYS ACCEPT context-specific buyer segments.',
  },
  positioning_claim: {
    label: "POSITIONING CLAIM / TERRITORY",
    test:
      "A positioning claim or territory FAILS ONLY when it is generic category boilerplate or empty puffery ('most trusted', 'best value', 'innovative solution', 'high quality service') that names no concrete product capabilities, deliverables, workflows, or specific customer problem. A claim PASSES and MUST be ACCEPTED when it explicitly anchors to THIS product's VALIDATED PRODUCT CAPABILITIES (or Reference Product key attributes / differentiating feature) and addresses a specific AUTHORIZED CUSTOMER PROBLEM or named competitor gap. CRITICAL: Multiple competitors in a category may legitimately offer similar capabilities or deliverables (shared-capability strategic emphasis). Do NOT reject a claim because another competitor in the category could hypothetically offer similar capabilities, and NEVER demand unverified claims that competitors fail, non-replicable superiority, invented proprietary technology, trademarked system names, or capabilities outside VALIDATED PRODUCT CAPABILITIES.",
    examples:
      'Generic (REJECT): "the smart choice for modern customers", "high quality service you can trust". Specific (ACCEPT): any claim that names concrete validated product capabilities/deliverables/workflows and ties them to an authorized customer problem, strategic combination of verified capabilities, or explicit market-emphasis choice.',
  },
  offer: {
    label: "OFFER (outcome + mechanism language)",
    test:
      "An offer FAILS ONLY when its outcome and mechanism language are vague category slogans ('get results', 'save money', 'transform your life with our proven system') with no concrete deliverables or workflow. A valid offer PASSES and MUST be ACCEPTED when it names the specific outcome and deliverables THIS product produces grounded in VALIDATED PRODUCT CAPABILITIES and includes clear risk reduction or commercial boundaries. CRITICAL: Do NOT reject an offer because another competitor in the category could offer similar deliverables, and NEVER demand patented technology, invented guarantees, unverified SLAs, or capabilities outside VALIDATED PRODUCT CAPABILITIES.",
    examples:
      'Generic (REJECT): "transform your results with our proven system". Specific (ACCEPT): a named outcome produced by verified capabilities/deliverables with explicit commercial terms, risk reduction, or boundaries.',
  },
  channel_rationale: {
    label: "CHANNEL RECOMMENDATION RATIONALE",
    test:
      "Could this channel reasoning be given, UNCHANGED, for any generic competitor in the category? Best-practice reasoning like \"Instagram because it has high engagement\" or \"email because it converts\" is interchangeable and FAILS. A valid rationale explains why THIS specific segment is reachable on THIS channel for THIS product and defines the strategic content theme and funnel role for each channel.",
    examples:
      'Generic (REJECT): "run Meta ads because they reach a broad audience". Specific (ACCEPT): reasoning tied to where this exact segment\'s attention actually is and what perception shift is required.',
  },
  performance_interpretation: {
    label: "PERFORMANCE INTERPRETATION (hypotheses, next experiment, campaign specificity)",
    test:
      "Reject if ANY of these hold: (1) the hypotheses or recommended experiment could be pasted UNCHANGED into a generic competitor's performance report — best-practice advice like \"post more consistently\", \"use stronger hooks\", \"engage your audience\" is interchangeable and FAILS; (2) the text presents a correlation or hypothesis as a proven causal result (e.g. claims content CAUSED sales/customers without the text itself flagging attribution as confirmed); (3) the recommendation reads like a fixed template with the campaign's nouns swapped in. A valid interpretation names the actual posts, hooks, angles, metrics, and product mechanism, and its experiment changes exactly one named variable for a stated, evidence-tied reason.",
    examples:
      'Generic (REJECT): "test different hook styles to see what resonates with your audience". Specific (ACCEPT): an experiment that names the exact hook/angle value being varied, the constants preserved, and the evidence that motivated it.',
  },
  strategic_decision: {
    label: "STRATEGIC DECISION & LANE RESPONSE",
    test:
      "Reject if ANY of these hold: (1) The output provides generic business advice that could apply to virtually any business without market evidence (e.g. \"build trust\", \"use social proof\", \"maintain consistent presence\", \"focus on quality\"); (2) The output fails to define an actual strategic choice that changes what the business should do; (3) The output lacks a meaningful tradeoff or explicit \"what NOT to do\". A valid strategic decision explains the commercial consequence of the observed problem, defines a concrete strategic response, and specifies what the business must avoid. NOTE: An honest admission of a proof gap or capability gap is VALID and should be ACCEPTED.",
    examples:
      'Generic (REJECT): "Build trust with buyers through high quality content and proof-led persuasion." Specific (ACCEPT): "Lead the primary acquisition proposition with verified preview transparency and upfront pricing rather than unverified speed claims; do not lead consumer acquisition messaging with B2B partnership terms."',
  },
  brand_spine: {
    label: "BRAND SPINE & UMBRELLA POSITIONING",
    test:
      "Reject if ANY of these hold: (1) The Brand Spine smushes conflicting lane pains together into an incoherent contrast axis; (2) It relies on invented operational features or unverified SLAs not backed by the Product Anchor; (3) It is generic category boilerplate (e.g. \"trusted solution provider\"). A valid Brand Spine represents the single unifying strategic truth that remains valid across all active audience lanes.",
    examples:
      'Incoherent (REJECT): "combining unrelated consumer emotion pains with enterprise procurement doubts". Valid (ACCEPT): "A unified strategic proposition anchored in verified product capabilities, clear commercial terms, and consistent buyer outcomes across active lanes."',
  },
  proof_strategy: {
    label: "PROOF STRATEGY & CREDIBILITY ARCHITECTURE",
    test:
      "Reject if the proof strategy is merely a generic phrase like \"use proof\", \"provide validation\", or \"show social proof\" without specifying WHAT claim requires proof, WHAT proof asset is required, or explicitly documenting that a PROOF GAP exists. A valid proof strategy names the exact claim to prove and the proof asset required, or honestly states that proof must be collected.",
    examples:
      'Generic (REJECT): "Use proof-led persuasion to overcome buyer doubts." Specific (ACCEPT): "Claim to prove: preview-before-purchase workflow and delivery reliability. Required proof: live interactive preview sample and timestamped fulfillment records. Proof gap: competitor revision policy comparison is not yet verified."',
  },
};

function anchorReference(anchor: ProductAnchor | null, kind?: JudgeKind): string {
  if (kind === "segment") {
    return [
      "MARKET EVIDENCE CONTEXT (for audience segment evaluation):",
      "Audience segments reflect discovery of who is in the market evidence (which may include end-consumers, patients, or practitioners).",
      "CRITICAL RULE FOR SEGMENTS: Do NOT require the segment to match the business's B2B target role, wholesale model, or specific purchasing mechanism. Evaluate ONLY whether the segment describes a specific, verifiable situation or constraint in the category rather than generic boilerplate. A valid B2C consumer segment MUST be ACCEPTED.",
      anchor ? `- Category Context: ${anchor.type || anchor.name}` : "",
    ].filter(Boolean).join("\n");
  }
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
  parts.push("AUTHORITY BOUNDARIES (strictly govern what the candidate may claim):");
  if (pains.length > 0) {
    parts.push(
      `- AUTHORIZED CUSTOMER PROBLEMS (the ONLY problems the output may center): ${pains.map((p) => `"${p.canonical}"`).join("; ")}. REJECT if the output's central customer problem is an invented problem outside this list.`,
    );
  }
  if (caps.length > 0) {
    parts.push(
      `- VALIDATED PRODUCT CAPABILITIES (the ONLY capabilities the output is permitted to claim): ${caps.map((c) => `"${c.statement}"`).join("; ")}. REJECT if the output claims a product capability not covered by these. IMPORTANT: Because the candidate is strictly forbidden from claiming capabilities outside this list, when the candidate explicitly anchors to one or more of these VALIDATED PRODUCT CAPABILITIES and addresses an AUTHORIZED CUSTOMER PROBLEM, you MUST ACCEPT it — never reject it because a competitor in the category might share similar capabilities, and never ask the candidate to add unverified claims beyond these capabilities.`,
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
  const ruleLine = kind === "segment"
    ? "Judge ONLY whether the segment describes a concrete, situation-specific group/problem (PASS) versus a completely generic catch-all (FAIL). Do NOT demand product exclusivity or brand-specific ties."
    : (kind === "positioning_claim" || kind === "offer")
      ? "Judge whether the candidate names concrete validated capabilities/deliverables/workflows tied to a specific customer problem (ACCEPT) versus empty generic slogans (REJECT). Never demand capabilities or competitor-failure claims outside VALIDATED PRODUCT CAPABILITIES."
      : "Judge ONLY interchangeability — ignore grammar, tone, and length. If the text would survive being swapped onto a generic competitor with no edit, it FAILS.";

  return `You are a hostile INTERCHANGEABILITY reviewer for a marketing-strategy engine. You have read thousands of generic marketing documents and you reject empty category boilerplate.

THE ONE TEST — INTERCHANGEABILITY:
${k.test}

${k.examples}

${anchorReference(anchor, kind)}

${authoritySection(authority)}${k.label} TO REVIEW:
"""
${candidate}
"""

${ruleLine}

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
