/**
 * Phase 8 — Competitor Lane AI overlay.
 *
 * Locked by Samir 2026-04-23. Upgrades Phase 7.3's count-based competitor
 * interpretation with semantic understanding:
 *
 *   - semantic grouping       (themes that mean the same thing get grouped)
 *   - strategy-type tagging   (trust / outcome / authority / social-proof / ...)
 *   - IG↔TikTok meaning alignment (not just presence parity)
 *   - cross-theme contradiction detection
 *
 * INPUT:  the rule-based `CompetitorInterpretation` from
 *         `lanes/competitor/interpret.ts` PLUS a small evidence sample of
 *         raw post text per theme. The rule-based output is NOT modified.
 *
 * OUTPUT: an `AIOverlay` envelope. Consumers display the AI fields alongside
 *         the rule-based output; they MUST NOT use the AI fields to change
 *         the rule-based status, counts, or reasons. Boss policy is forbidden
 *         from importing this module.
 */
import { runOverlay } from "./client";
import type { AIOverlay } from "./types";
import type { CompetitorInterpretation } from "../lanes/competitor/interpret";

export type StrategyType =
  | "trust-based"
  | "outcome-based"
  | "authority-based"
  | "social-proof"
  | "scarcity"
  | "novelty"
  | "transformation"
  | "other";

export type ChannelAlignment = "consistent" | "divergent" | "contradictory" | "insufficient";

export interface CompetitorAIOutput {
  semanticGroups: Array<{
    groupName: string;
    themeTokens: string[];        // must be a subset of input theme tokens
    strategyType: StrategyType;
    reasoning: string;
  }>;
  channelAlignment: Array<{
    themeToken: string;           // must be one of the input theme tokens
    alignment: ChannelAlignment;
    reasoning: string;
  }>;
  contradictions: Array<{
    themes: [string, string];     // both must be input theme tokens
    reasoning: string;
  }>;
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
const ALIGNMENT_VALUES: ReadonlyArray<ChannelAlignment> = [
  "consistent",
  "divergent",
  "contradictory",
  "insufficient",
];

const SYSTEM_PROMPT = `You are a deterministic marketing analyst.
You receive a set of competitor theme tokens (already detected by a rules-based system) plus an evidence sample for each.
Your job is to ADD semantic interpretation. You do not change counts, statuses, or rule decisions.

Output STRICT JSON only matching this shape:
{
  "semanticGroups": [{ "groupName": string, "themeTokens": string[], "strategyType": "trust-based"|"outcome-based"|"authority-based"|"social-proof"|"scarcity"|"novelty"|"transformation"|"other", "reasoning": string }],
  "channelAlignment": [{ "themeToken": string, "alignment": "consistent"|"divergent"|"contradictory"|"insufficient", "reasoning": string }],
  "contradictions": [{ "themes": [string, string], "reasoning": string }]
}

Rules:
- Every themeToken you reference MUST appear verbatim in the input themes list. Never invent tokens.
- "channelAlignment.insufficient" is required when there is no TikTok evidence for a theme.
- "contradictions" is empty unless two themes assert genuinely conflicting strategies (e.g., scarcity vs abundance).
- Reasoning must be one or two sentences, plain English, citing observable evidence from the input.
- Output JSON only. No prose outside the JSON.`;

function buildUserMessage(input: CompetitorAIInput): string {
  const themes = input.interpretation.signals.map((s) => ({
    themeToken: s.themeToken,
    status: s.status,
    igPostCount: s.igPostCount,
    tiktokPostCount: s.tiktokPostCount,
    igCompetitors: s.igCompetitorIds.length,
    tiktokCompetitors: s.tiktokCompetitorIds.length,
    sampleText: input.evidence?.[s.themeToken]?.slice(0, 5) ?? [],
  }));
  const diagnostics = input.interpretation.diagnostics.map((d) => ({
    themeToken: d.themeToken,
    status: d.status,
    sampleText: input.evidence?.[d.themeToken]?.slice(0, 3) ?? [],
  }));
  return JSON.stringify({
    corpusStatus: input.interpretation.corpusStatus,
    themes,
    diagnostics,
    notes: "Group semantically, classify strategy, assess IG vs TikTok meaning alignment, flag contradictions.",
  });
}

function validate(parsed: unknown, allowedTokens: Set<string>): CompetitorAIOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.semanticGroups) || !Array.isArray(p.channelAlignment) || !Array.isArray(p.contradictions)) {
    return null;
  }
  const out: CompetitorAIOutput = { semanticGroups: [], channelAlignment: [], contradictions: [] };

  for (const g of p.semanticGroups) {
    if (!g || typeof g !== "object") return null;
    const gg = g as any;
    if (typeof gg.groupName !== "string" || !gg.groupName.trim()) return null;
    if (!Array.isArray(gg.themeTokens) || gg.themeTokens.length === 0) return null;
    for (const t of gg.themeTokens) {
      if (typeof t !== "string" || !allowedTokens.has(t)) return null;
    }
    if (typeof gg.strategyType !== "string" || !STRATEGY_TYPES.includes(gg.strategyType as StrategyType)) return null;
    if (typeof gg.reasoning !== "string" || !gg.reasoning.trim()) return null;
    out.semanticGroups.push({
      groupName: gg.groupName,
      themeTokens: gg.themeTokens,
      strategyType: gg.strategyType,
      reasoning: gg.reasoning,
    });
  }

  for (const a of p.channelAlignment) {
    if (!a || typeof a !== "object") return null;
    const aa = a as any;
    if (typeof aa.themeToken !== "string" || !allowedTokens.has(aa.themeToken)) return null;
    if (typeof aa.alignment !== "string" || !ALIGNMENT_VALUES.includes(aa.alignment as ChannelAlignment)) return null;
    if (typeof aa.reasoning !== "string" || !aa.reasoning.trim()) return null;
    out.channelAlignment.push({
      themeToken: aa.themeToken,
      alignment: aa.alignment,
      reasoning: aa.reasoning,
    });
  }

  for (const c of p.contradictions) {
    if (!c || typeof c !== "object") return null;
    const cc = c as any;
    if (!Array.isArray(cc.themes) || cc.themes.length !== 2) return null;
    const [a, b] = cc.themes;
    if (typeof a !== "string" || typeof b !== "string") return null;
    if (!allowedTokens.has(a) || !allowedTokens.has(b)) return null;
    if (typeof cc.reasoning !== "string" || !cc.reasoning.trim()) return null;
    out.contradictions.push({ themes: [a, b], reasoning: cc.reasoning });
  }

  return out;
}

export interface CompetitorAIInput {
  accountId: string;
  interpretation: CompetitorInterpretation;
  /** Map of themeToken -> small list of raw post text samples (3-5 lines). */
  evidence?: Record<string, string[]>;
}

export async function applyCompetitorOverlay(
  input: CompetitorAIInput,
): Promise<AIOverlay<CompetitorAIOutput>> {
  const allowedTokens = new Set<string>([
    ...input.interpretation.signals.map((s) => s.themeToken),
    ...input.interpretation.diagnostics.map((d) => d.themeToken),
  ]);

  return runOverlay<CompetitorAIOutput>({
    accountId: input.accountId,
    promptVersion: "competitor.v1",
    endpoint: "pipeline.ai-overlay.competitor",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    maxTokens: 800,
    validate: (parsed) => validate(parsed, allowedTokens),
  });
}
