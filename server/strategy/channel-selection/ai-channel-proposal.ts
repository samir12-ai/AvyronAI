/**
 * ============================================================================
 * AI-PROPOSES / CODE-VALIDATES — CHANNEL LAYER (Phase 3 / T15)
 * ============================================================================
 *
 * The deterministic runChannelSelectionEngine remains the sole constraint floor:
 * it scores every channel, blocks guard/awareness/budget violations, and ranks
 * the viable set. This wrapper adds the doctrine's "AI proposes, code validates"
 * step ON TOP of that floor — mirroring the audience / positioning / offer
 * engines shipped earlier this run:
 *
 *   1. Run the sync deterministic engine (the floor + the recorded FALLBACK).
 *   2. Ask the AI to pick WHICH of the two deterministically-viable channels
 *      should lead, plus a product-specific rationale that ties THIS segment /
 *      positioning / offer to THAT channel.
 *   3. The candidate gate battery (breadth → interchangeability(channel_rationale)
 *      → contradiction vs prior decisions) is the SOLE judge. Up to 3 attempts
 *      PER GATE with temperature escalation (0.3 → 0.4 → 0.5) and structured
 *      rejection feedback.
 *   4. The AI can only pick a channel already on the viable whitelist — it can
 *      NEVER resurrect a channel the deterministic engine hard-blocked.
 *   5. On success → mode "ai" (rationale attached, primary/secondary reordered
 *      iff the validated pick differs). On exhaustion / no doctrine / < 2 viable
 *      → mode "fallback" with an explicit fallbackReason. NEVER silent.
 *
 * REPLAY / NO-BARE-LLM: this module lives in the channel-selection engine dir
 * (whitelisted for aiChat, like channel-orchestration.ts) — NOT an orchestrator
 * sibling. aiChat enforces its own wall-clock HARD_TIMEOUT_MS.
 *
 * D1/D5: mode / fallbackReason / the chosen pick are assigned per branch with
 * literals — never `?? / ||` on a decision value. `??` appears ONLY on optional
 * INPUT defaults. Every attempt (incl. NOT_RUN judge verdicts and off-whitelist
 * picks) is RECORDED on gateTrace — an abstention is never an implicit pass.
 */
import { aiChat } from "../../ai-client";
import { generateWithRepair, LLMReliabilityError } from "../../shared/llm-reliability/reliability-runner";
import type { JudgeResult } from "../../shared/llm-reliability/types";
import {
  safeJsonParse,
  buildDoctrineBlock,
  deriveAnchorFromProductDna,
  type RunStrategicContext,
  type ProductAnchor,
  type EngineDecisionSummary,
  type ProductDnaLike,
} from "../../shared/strategic-doctrine";
import { runCandidateGateBattery } from "../../shared/candidate-gate-battery";
import { z } from "zod";
import { STATUS } from "./constants";
import { runChannelSelectionEngine } from "./engine";
import type {
  ChannelAudienceInput,
  ChannelAwarenessInput,
  ChannelPersuasionInput,
  ChannelOfferInput,
  ChannelBudgetInput,
  ChannelValidationInput,
  ChannelMode,
  ChannelSelectionResult,
  ChannelCandidate,
  AiChannelProposal,
  AiChannelGateAttempt,
  AiChannelFallbackReason,
} from "./types";

const MODEL = "gpt-4.1-mini";
const MAX_ATTEMPTS = 3;
const TEMP_LADDER = [0.3, 0.4, 0.5];

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

// What the proposer LLM is allowed to return — a pick + a rationale. The pick is
// re-validated against the viable whitelist in code (never trusted blindly).
const ProposalOutputSchema = z.object({
  primaryChannel: z.string().min(1),
  rationale: z.string().min(1),
});

function buildProposerPrompt(input: {
  anchor: ProductAnchor | null;
  strategic: RunStrategicContext;
  primary: ChannelCandidate;
  secondary: ChannelCandidate;
  rejected: ChannelCandidate[];
  feedback: string;
}): string {
  const { primary, secondary, rejected, strategic, feedback } = input;
  const doctrineBlock = buildDoctrineBlock(strategic);
  // F5a (Fix 3): when the anchor was DNA-derived (doctrine itself is degraded),
  // show it to the proposer too — the battery judges against this anchor, so the
  // model must see the same product identity it is being judged on. When the
  // doctrine is anchored, the doctrine block already renders the anchor (no dup).
  const dnaAnchorBlock =
    input.anchor && strategic.doctrine.resolution === "business_level_degraded"
      ? `\n═══ PRODUCT ANCHOR (derived from Product DNA — resolve your rationale to THIS product) ═══\nProduct name: ${input.anchor.name}\nProduct type: ${input.anchor.type}\n${input.anchor.keyAttributes.length > 0 ? `Key attributes: ${input.anchor.keyAttributes.join("; ")}\n` : ""}Core problem solved: ${input.anchor.coreProblemSolved}\nDifferentiating feature: ${input.anchor.differentiatingFeature}\n`
      : "";
  const priors = strategic.priorDecisions.length
    ? strategic.priorDecisions.map((d) => `- [${d.engineId}] ${d.summary}`).join("\n")
    : "(no prior decisions recorded)";
  const rejectedList = rejected.length
    ? rejected
        .slice(0, 5)
        .map((c) => `- ${c.channelName} (${c.channelType}) — ${c.rejectionReason ? c.rejectionReason : "not viable"}`)
        .join("\n")
    : "(none)";
  const retry = feedback
    ? `\n═══ PRIOR ATTEMPT REJECTED ═══\n${feedback}\nRewrite so the rationale is specific to THIS product and cannot be pasted onto a generic competitor. Cite the anchor's differentiating feature or core problem by name.\n`
    : "";
  return `You are a Channel Strategy Principal. Two channels survived the deterministic scoring floor and are the ONLY channels you may recommend as primary. Your job: choose which leads, and justify it in a way that is specific to THIS product and audience.

${doctrineBlock}
${dnaAnchorBlock}
═══ VALIDATED PRIOR DECISIONS (segment / positioning / offer) ═══
${priors}

═══ THE TWO VIABLE CHANNELS (pick the primary from EXACTLY these) ═══
- ${primary.channelName} (${primary.channelType}) — deterministic fit ${primary.fitScore.toFixed(2)}${primary.riskNotes.length ? ` | risk: ${primary.riskNotes.slice(0, 2).join("; ")}` : ""}
- ${secondary.channelName} (${secondary.channelType}) — deterministic fit ${secondary.fitScore.toFixed(2)}${secondary.riskNotes.length ? ` | risk: ${secondary.riskNotes.slice(0, 2).join("; ")}` : ""}

═══ CHANNELS ALREADY BLOCKED (off-limits — do NOT name any of these) ═══
${rejectedList}
${retry}
═══ HARD RULES ═══
1. "primaryChannel" MUST be EXACTLY one of the two viable channel names above — no other channel, no invented name.
2. "rationale" MUST explain why THIS specific segment's attention is on THIS channel for THIS product's offer/positioning — cite the anchor's differentiating feature or the named segment. Generic best-practice reasoning ("high engagement", "broad reach", "it converts") is INTERCHANGEABLE and will be REJECTED.
3. The rationale MUST NOT contradict any validated prior decision above.

Return ONLY valid JSON, no commentary:
{"primaryChannel":"<one of the two viable names>","rationale":"<2-3 sentence product-specific reasoning>"}`;
}

async function callProposer(
  prompt: string,
  temperature: number,
  accountId: string,
): Promise<{ primaryChannel: string; rationale: string } | null> {
  let raw: string | null = null;
  try {
    const resp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 500,
      endpoint: "channel-ai-proposer",
      accountId,
    });
    raw = resp.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ChannelAIProposer] CALL_FAILED — ${msg}`);
    return null;
  }
  const parsed = safeJsonParse(raw, ProposalOutputSchema);
  if (!parsed) {
    console.error(`[ChannelAIProposer] UNPARSEABLE — raw="${(raw ?? "").slice(0, 80)}"`);
    return null;
  }
  return { primaryChannel: parsed.primaryChannel.trim(), rationale: parsed.rationale.trim() };
}

/**
 * Run the gate-validated AI proposer over an already-computed deterministic
 * result. Returns the proposal verdict; the caller applies any swap. The two
 * viable channel names form the whitelist — a pick outside it is a recorded,
 * counted attempt (never accepted).
 */
async function callProposerRaw(
  prompt: string,
  temperature: number,
  accountId: string,
): Promise<string | null> {
  try {
    const resp = await aiChat({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 500,
      endpoint: "channel-ai-proposer",
      accountId,
    });
    return resp.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    return null;
  }
}

async function proposeAndValidate(input: {
  strategic: RunStrategicContext;
  /** F5a (Fix 3): resolved by the caller — doctrine anchor, else DNA-derived, else null. */
  anchor: ProductAnchor | null;
  /** T003: how the anchor was resolved (audit trail — never anchor text). */
  anchorSource: "doctrine" | "dna" | "none";
  primary: ChannelCandidate;
  secondary: ChannelCandidate;
  rejected: ChannelCandidate[];
  accountId: string;
}): Promise<AiChannelProposal> {
  const { strategic, anchor, anchorSource, primary, secondary, rejected, accountId } = input;
  const whitelist = new Set([primary.channelName, secondary.channelName]);
  const gateTrace: AiChannelGateAttempt[] = [];
  let feedback = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const temperature = TEMP_LADDER[attempt - 1] ?? 0.5;
    console.log(`[ChannelAIProposer] ANCHOR_EVIDENCE | engine=channel_proposal | site=first_prompt | attempt=${attempt} | present=${anchor ? "yes" : "no"} | source=${anchorSource}`);
    const prompt = buildProposerPrompt({ anchor, strategic, primary, secondary, rejected, feedback });
    const proposal = await callProposer(prompt, temperature, accountId);

    // Proposer produced nothing parseable — record + retry (or exhaust).
    if (!proposal) {
      gateTrace.push({
        attempt,
        proposedPrimary: "",
        passed: false,
        failedGate: null,
        interchangeabilityVerdict: "NOT_RUN",
        contradictionVerdict: "NOT_RUN",
        rejectionFeedback: "PROPOSER_FAILED: no parseable pick+rationale returned",
      });
      feedback = "Your previous response was empty or invalid JSON. Return the exact JSON shape requested.";
      continue;
    }

    // Whitelist floor: reject off-whitelist picks WITHOUT running the battery.
    if (!whitelist.has(proposal.primaryChannel)) {
      const fb = `"${proposal.primaryChannel}" is not a viable channel. You MUST pick exactly one of: ${primary.channelName}, ${secondary.channelName}.`;
      gateTrace.push({
        attempt,
        proposedPrimary: proposal.primaryChannel,
        passed: false,
        failedGate: null,
        interchangeabilityVerdict: "NOT_RUN",
        contradictionVerdict: "NOT_RUN",
        rejectionFeedback: fb,
      });
      feedback = fb;
      continue;
    }

    // The battery is the sole judge of the rationale.
    console.log(`[ChannelAIProposer] ANCHOR_EVIDENCE | engine=channel_proposal | site=judge | attempt=${attempt} | present=${anchor ? "yes" : "no"} | source=${anchorSource}`);
    const battery = await runCandidateGateBattery({
      kind: "channel_rationale",
      candidateText: proposal.rationale,
      productAnchor: anchor,
      priorDecisions: strategic.priorDecisions,
      accountId,
    });
    gateTrace.push({
      attempt,
      proposedPrimary: proposal.primaryChannel,
      passed: battery.passed,
      failedGate: battery.failedGate,
      interchangeabilityVerdict: battery.interchangeability.verdict,
      contradictionVerdict: battery.contradiction.verdict,
      rejectionFeedback: battery.rejectionFeedback,
    });

    if (battery.passed) {
      return {
        mode: "ai",
        fallbackReason: null,
        proposedPrimary: proposal.primaryChannel,
        rationale: proposal.rationale,
        swappedFromDeterministic: proposal.primaryChannel !== primary.channelName,
        attempts: attempt,
        gateTrace,
      };
    }
    feedback = battery.rejectionFeedback;
  }

  // Every attempt exhausted without a passing candidate — recorded fallback.
  // B4 (explicit classification): distinguish "the proposer never returned a
  // parseable candidate for any gate to judge" (proposer_failed) from
  // "candidates were judged and rejected / kept picking off-whitelist"
  // (gates_exhausted). Ternary, not ??/|| — explicit branch on a real signal.
  const allProposerFailed = gateTrace.every((a) => a.rejectionFeedback.startsWith("PROPOSER_FAILED"));
  const exhaustionReason: AiChannelFallbackReason = allProposerFailed ? "proposer_failed" : "gates_exhausted";
  console.warn(`[ChannelAIProposer] EXHAUSTED reason=${exhaustionReason} after ${MAX_ATTEMPTS} attempts — falling back to deterministic pick`);
  return {
    mode: "fallback",
    fallbackReason: exhaustionReason,
    proposedPrimary: null,
    rationale: "",
    swappedFromDeterministic: false,
    attempts: MAX_ATTEMPTS,
    gateTrace,
  };
}

/** Build the fallback proposal for a branch that never ran the LLM. */
function fallbackProposal(reason: AiChannelFallbackReason): AiChannelProposal {
  return {
    mode: "fallback",
    fallbackReason: reason,
    proposedPrimary: null,
    rationale: "",
    swappedFromDeterministic: false,
    attempts: 0,
    gateTrace: [],
  };
}

/** Recompute the primary-derived fields after a primary/secondary swap, using the
 *  same reliability + structural-repair penalties the engine applied (engine
 *  L1366-1379) — kept in lockstep so a swapped result stays internally truthful. */
function recomputeConfidence(base: ChannelSelectionResult, newPrimary: ChannelCandidate): number {
  let confidence = newPrimary.fitScore;
  if (base.dataReliability.isWeak) {
    confidence = Math.min(confidence * 0.6, 0.65);
  }
  if (base.structurallyRepaired) {
    const correctionPenalty = Math.min(base.correctionAuditTrail.length * 0.05, 0.2);
    confidence = clamp(confidence - correctionPenalty, 0.1, 1);
  }
  return confidence;
}

function dedupeRiskNotes(primary: ChannelCandidate, secondary: ChannelCandidate): string[] {
  const merged = [...primary.riskNotes.slice(0, 5), ...secondary.riskNotes.slice(0, 3)];
  return Array.from(new Set(merged));
}

function buildDecisionSummary(primary: ChannelCandidate, secondary: ChannelCandidate, proposal: AiChannelProposal): EngineDecisionSummary {
  const modeTail = proposal.mode === "ai" ? ` (AI-validated: ${proposal.rationale})` : " (deterministic fallback)";
  const summary = `Locked channel plan — primary: ${primary.channelName} (${primary.channelType}); secondary: ${secondary.channelName} (${secondary.channelType})${modeTail}`;
  return { engineId: "channel_selection", summary, validatedAt: Date.now() };
}

/**
 * Public entry — the orchestrator calls THIS instead of runChannelSelectionEngine.
 * Signature is the sync engine's args plus (strategic, accountId). Keeps the sync
 * engine untouched (it is the floor + fallback); all async LLM work lives here.
 */
export async function runChannelSelectionWithAIProposal(
  audience: ChannelAudienceInput,
  awareness: ChannelAwarenessInput | null,
  persuasion: ChannelPersuasionInput | null,
  offer: ChannelOfferInput | null,
  budget: ChannelBudgetInput | null,
  validation: ChannelValidationInput | null,
  channelMode: ChannelMode,
  memoryContext: string | undefined,
  strategic: RunStrategicContext | undefined,
  accountId: string,
  // F5a (Fix 3): Product DNA threaded from the orchestrator so the battery /
  // proposer anchor can be derived when the doctrine's anchor is absent.
  productDna?: ProductDnaLike | null,
): Promise<ChannelSelectionResult> {
  const base = runChannelSelectionEngine(
    audience,
    awareness,
    persuasion,
    offer,
    budget,
    validation,
    channelMode,
    memoryContext,
  );

  const primary = base.primaryChannel;
  const secondary = base.secondaryChannel;
  // Need doctrine AND two DISTINCT viable channels for the proposer to have a
  // real choice. viable.length===0 → GUARD_BLOCKED. Same object / same name →
  // only one viable channel. Either way there is nothing to propose over.
  const twoDistinctViable =
    base.status !== STATUS.GUARD_BLOCKED &&
    primary.rejectionReason === null &&
    secondary.rejectionReason === null &&
    primary.channelName !== secondary.channelName;

  let proposal: AiChannelProposal;
  if (!strategic) {
    proposal = fallbackProposal("no_doctrine");
  } else if (!twoDistinctViable) {
    proposal = fallbackProposal("insufficient_viable");
  } else {
    // F5a (Fix 3): doctrine present but its anchor is null → derive the
    // proposer/battery anchor from Product DNA (explicit branch — D1). The
    // no_doctrine fallback above is untouched: DNA never fabricates doctrine (D5).
    let channelAnchor: ProductAnchor | null = strategic.doctrine.productAnchor;
    let channelAnchorSource: "doctrine" | "dna" | "none" = channelAnchor ? "doctrine" : "none";
    if (!channelAnchor && productDna) {
      const derivedChannelAnchor = deriveAnchorFromProductDna(productDna);
      if (derivedChannelAnchor) {
        channelAnchor = derivedChannelAnchor;
        channelAnchorSource = "dna";
        console.log(`[ChannelAIProposer] BATTERY_ANCHOR_FROM_DNA | doctrine anchor absent — anchor derived from Product DNA`);
      }
    }
    proposal = await proposeAndValidate({
      strategic,
      anchor: channelAnchor,
      anchorSource: channelAnchorSource,
      primary,
      secondary,
      rejected: base.rejectedChannels,
      accountId,
    });
  }

  // Apply the outcome. On a validated swap, reorder primary/secondary and keep
  // every primary-derived field in lockstep (D1: chosen via explicit branch).
  if (proposal.mode === "ai" && proposal.swappedFromDeterministic) {
    const newPrimary = secondary;
    const newSecondary = primary;
    const swapped: ChannelSelectionResult = {
      ...base,
      primaryChannel: newPrimary,
      secondaryChannel: newSecondary,
      channelFitScore: newPrimary.fitScore,
      confidenceScore: recomputeConfidence(base, newPrimary),
      channelRiskNotes: dedupeRiskNotes(newPrimary, newSecondary),
      // Swap the two viable channels' scoring layers. NOTE (known cosmetic drift):
      // the engine appended the reconstructed funnelLayer onto the ORIGINAL
      // primary's layers, so post-swap the promoted primary's layerResults lack
      // that one telemetry layer. Selection/decision fields are unaffected.
      layerResults: base.secondaryLayerResults && base.secondaryLayerResults.length ? base.secondaryLayerResults : base.layerResults,
      secondaryLayerResults: base.layerResults,
      structuralWarnings: Array.from(
        new Set([
          ...base.structuralWarnings,
          `AI proposer reordered channels: ${newPrimary.channelName} promoted to primary (deterministic top was ${primary.channelName}) — rationale gate-validated`,
        ]),
      ),
    };
    swapped.aiChannelProposal = proposal;
    swapped.channelDecisionSummary = buildDecisionSummary(newPrimary, newSecondary, proposal);
    console.log(`[ChannelAIProposer] MODE=ai SWAP primary=${newPrimary.channelName} attempts=${proposal.attempts}`);
    return swapped;
  }

  base.aiChannelProposal = proposal;
  base.channelDecisionSummary = buildDecisionSummary(primary, secondary, proposal);
  console.log(
    `[ChannelAIProposer] MODE=${proposal.mode}${proposal.fallbackReason ? ` reason=${proposal.fallbackReason}` : ""} primary=${primary.channelName} attempts=${proposal.attempts}`,
  );
  return base;
}
