/**
 * Phase 8 — DNA / Cluster AI overlay.
 *
 * Locked by Samir 2026-04-23. Upgrades Phase 6's token-count cluster
 * signature with semantic meaning:
 *
 *   - cluster meaning   (what is this cluster actually saying?)
 *   - persuasion logic  (what mechanism is it leaning on?)
 *   - strategy-type tags (same vocabulary as the competitor overlay so
 *                         operators can reason across both lanes)
 *
 * INPUT:  a `ClusterSignature` from `pipeline/cluster-producer.ts` (themes +
 *         post counts) PLUS optional evidence text per theme token.
 *
 * OUTPUT: descriptive AI envelope. Cluster comparison verdicts in
 *         `cluster-comparator.ts` and Q1 in `boss/policy/dna-working.ts`
 *         continue to use the rule-based theme-set delta only.
 */
import { runOverlay } from "./client";
import type { AIOverlay } from "./types";
import type { ClusterSignature } from "../cluster-producer";
import type { StrategyType } from "./competitor";

export type PersuasionMechanism =
  | "credibility"
  | "specificity"
  | "outcome-framing"
  | "risk-reduction"
  | "identity-fit"
  | "scarcity-framing"
  | "novelty-framing"
  | "social-validation"
  | "other";

export interface DnaAIOutput {
  clusterMeaning: string; // 1-3 sentence paragraph
  persuasionLogic: {
    primary: PersuasionMechanism;
    supporting: PersuasionMechanism[];
    reasoning: string;
  };
  strategyTypeTags: StrategyType[];
}

const STRATEGY_TYPES: ReadonlyArray<StrategyType> = [
  "trust-based",
  "outcome-based",
  "authority-based",
  "social-proof",
  "scarcity",
  "novelty",
  "transformation",
  "other",
];
const PERSUASION_MECHANISMS: ReadonlyArray<PersuasionMechanism> = [
  "credibility",
  "specificity",
  "outcome-framing",
  "risk-reduction",
  "identity-fit",
  "scarcity-framing",
  "novelty-framing",
  "social-validation",
  "other",
];

const SYSTEM_PROMPT = `You are a deterministic marketing analyst.
You receive a cluster signature (theme tokens + post counts) plus optional sample text.
Your job is to ADD semantic meaning. You do not change counts or rule decisions.

Output STRICT JSON only:
{
  "clusterMeaning": string,
  "persuasionLogic": { "primary": <PersuasionMechanism>, "supporting": [<PersuasionMechanism>...], "reasoning": string },
  "strategyTypeTags": [<StrategyType>...]
}

PersuasionMechanism enum: "credibility" | "specificity" | "outcome-framing" | "risk-reduction" | "identity-fit" | "scarcity-framing" | "novelty-framing" | "social-validation" | "other"
StrategyType enum: "trust-based" | "outcome-based" | "authority-based" | "social-proof" | "scarcity" | "novelty" | "transformation" | "other"

Rules:
- "clusterMeaning" is one to three sentences. Plain English. No marketing fluff.
- "supporting" must NOT include the primary mechanism.
- Reasoning must cite specific theme tokens from the input.
- Output JSON only.`;

function buildUserMessage(input: DnaAIInput): string {
  return JSON.stringify({
    windowId: input.windowId ?? null,
    postCount: input.signature.post_count,
    themes: (input.signature.themes ?? []).map((t) => ({
      themeToken: t.theme_token,
      postCount: t.post_count,
      sampleText: input.evidence?.[t.theme_token]?.slice(0, 4) ?? [],
    })),
    notes: "Describe what this cluster is saying, what persuasion logic it leans on, and tag strategy types.",
  });
}

function validate(parsed: unknown): DnaAIOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as any;
  if (typeof p.clusterMeaning !== "string" || !p.clusterMeaning.trim()) return null;
  if (!p.persuasionLogic || typeof p.persuasionLogic !== "object") return null;
  const pl = p.persuasionLogic;
  if (!PERSUASION_MECHANISMS.includes(pl.primary)) return null;
  if (!Array.isArray(pl.supporting)) return null;
  for (const m of pl.supporting) {
    if (!PERSUASION_MECHANISMS.includes(m)) return null;
    if (m === pl.primary) return null;
  }
  if (typeof pl.reasoning !== "string" || !pl.reasoning.trim()) return null;
  if (!Array.isArray(p.strategyTypeTags)) return null;
  for (const t of p.strategyTypeTags) {
    if (!STRATEGY_TYPES.includes(t)) return null;
  }
  return {
    clusterMeaning: p.clusterMeaning,
    persuasionLogic: { primary: pl.primary, supporting: pl.supporting, reasoning: pl.reasoning },
    strategyTypeTags: p.strategyTypeTags,
  };
}

export interface DnaAIInput {
  accountId: string;
  signature: ClusterSignature;
  /** Optional traceability — the eval window this signature came from. */
  windowId?: string | null;
  evidence?: Record<string, string[]>;
}

export async function applyDnaOverlay(input: DnaAIInput): Promise<AIOverlay<DnaAIOutput>> {
  return runOverlay<DnaAIOutput>({
    accountId: input.accountId,
    promptVersion: "dna.v1",
    endpoint: "pipeline.ai-overlay.dna",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    maxTokens: 600,
    validate,
  });
}
