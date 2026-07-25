/**
 * Phase 8 — User Interpretation AI overlay.
 *
 * Locked by Samir 2026-04-23. Upgrades Phase 7.2's composition + cluster-
 * interpretation with WHY-IT-WORKED reasoning and an organic-vs-paid
 * amplification reading.
 *
 * CRITICAL CONTRACT — locked verbatim from Samir's letter:
 *   "AI must NOT change numbers or verdict logic."
 *
 * Every output envelope carries `interpretation_only: true`. The explanation
 * layer MUST surface this as a banner so a corrected/AI-narrated week is
 * never confused with system truth.
 *
 * INPUT:  the unchanged `Composition`, `ComparisonInterpretation`, lead
 *         quality, and outcome regression outputs from Phase 7.2 modules,
 *         plus a small evidence sample of post text + observable metrics.
 *
 * OUTPUT: descriptive AI envelope. Q1 / outcome-regression / composition
 *         numbers in `lanes/user/*` are NOT touched.
 */
import { runOverlay } from "./client";
import type { AIOverlay } from "./types";
import type { Composition } from "../lanes/user/composition";
import type { ComparisonInterpretation } from "../lanes/user/cluster-interpretation";

export interface UserInterpretationAIOutput {
  /** Mandatory — always true. The explanation layer must display this as a banner. */
  interpretation_only: true;
  whyItWorked: Array<{
    themeToken: string;        // must appear in input
    reasoning: string;         // 1-2 sentences citing observable evidence
  }>;
  amplificationReading: {
    natural: string[];         // observable signals attributed to organic dynamics
    paid: string[];            // observable signals attributed to paid amplification
    blended: string[];         // signals where the two compound
    reasoning: string;         // overall narrative tying them together
  };
}

const SYSTEM_PROMPT = `You are a deterministic marketing analyst interpreting a user's posts.
You receive rule-based outputs (composition, cluster interpretation lens, lead quality, outcome regression) and a small evidence sample.

Your job is to ADD interpretation: WHY did themes work, and HOW is paid amplification interacting with organic traction.

YOU MUST NOT:
- change any number from the inputs
- contradict any rule status (e.g., do not say a low-confidence composition is high-confidence)
- recommend an action or pick a winner
- overwrite the verdict

Output STRICT JSON only:
{
  "interpretation_only": true,
  "whyItWorked": [{ "themeToken": string, "reasoning": string }],
  "amplificationReading": { "natural": string[], "paid": string[], "blended": string[], "reasoning": string }
}

Rules:
- "interpretation_only" must be exactly true.
- Every themeToken in whyItWorked must appear verbatim in the input themes.
- Reasoning is 1-2 sentences, citing observable evidence (post text snippets or metric directions you were given).
- Do not invent metrics. Cite only what is in the input.
- Output JSON only.`;

function buildUserMessage(input: UserInterpretationAIInput): string {
  return JSON.stringify({
    composition: {
      type: input.composition.type,
      shares: input.composition.shares,
      counts: input.composition.counts,
      source: input.composition.source,
      clarificationNeeded: input.composition.clarificationNeeded,
    },
    clusterInterpretation: input.clusterInterpretation
      ? {
          mode: input.clusterInterpretation.mode,
          lensCurrent: input.clusterInterpretation.lensCurrent,
          lensBaseline: input.clusterInterpretation.lensBaseline,
          reason: input.clusterInterpretation.reason,
        }
      : null,
    leadQuality: input.leadQuality ?? null,
    outcomeRegression: input.outcomeRegression ?? null,
    themes: input.themes ?? [],
    evidence: input.evidence ?? {},
    notes: "Interpret why themes worked and how paid vs organic dynamics are interacting. Do not change numbers.",
  });
}

function validate(parsed: unknown, allowedThemes: Set<string>): UserInterpretationAIOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as any;
  if (p.interpretation_only !== true) return null;
  if (!Array.isArray(p.whyItWorked)) return null;
  const why: UserInterpretationAIOutput["whyItWorked"] = [];
  for (const w of p.whyItWorked) {
    if (!w || typeof w !== "object") return null;
    if (typeof w.themeToken !== "string" || !allowedThemes.has(w.themeToken)) return null;
    if (typeof w.reasoning !== "string" || !w.reasoning.trim()) return null;
    why.push({ themeToken: w.themeToken, reasoning: w.reasoning });
  }
  if (!p.amplificationReading || typeof p.amplificationReading !== "object") return null;
  const ar = p.amplificationReading;
  for (const k of ["natural", "paid", "blended"] as const) {
    if (!Array.isArray(ar[k])) return null;
    for (const item of ar[k]) {
      if (typeof item !== "string" || !item.trim()) return null;
    }
  }
  if (typeof ar.reasoning !== "string" || !ar.reasoning.trim()) return null;
  return {
    interpretation_only: true,
    whyItWorked: why,
    amplificationReading: {
      natural: ar.natural,
      paid: ar.paid,
      blended: ar.blended,
      reasoning: ar.reasoning,
    },
  };
}

export interface UserInterpretationAIInput {
  accountId: string;
  composition: Composition;
  clusterInterpretation?: ComparisonInterpretation | null;
  /** Lead quality summary as produced by `lanes/user/lead-quality.ts`. */
  leadQuality?: { booked_calls: number | null; qualifiedToBookedRatio: number | null } | null;
  /** Outcome regression summary as produced by `lanes/user/outcome-regression.ts`. */
  outcomeRegression?: { regressed: boolean; reason?: string | null } | null;
  /** List of theme tokens currently observed for the user. */
  themes?: string[];
  /** Map of themeToken -> small list of raw post text samples (3-5 lines). */
  evidence?: Record<string, string[]>;
}

export async function applyUserInterpretationOverlay(
  input: UserInterpretationAIInput,
): Promise<AIOverlay<UserInterpretationAIOutput>> {
  const allowedThemes = new Set<string>(input.themes ?? []);
  return runOverlay<UserInterpretationAIOutput>({
    accountId: input.accountId,
    promptVersion: "user-interp.v1",
    endpoint: "pipeline.ai-overlay.user-interpretation",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    maxTokens: 700,
    validate: (parsed) => validate(parsed, allowedThemes),
  });
}
