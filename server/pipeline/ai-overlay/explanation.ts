/**
 * Phase 8 — Output / Explanation AI overlay.
 *
 * Locked by Samir 2026-04-23. Translates a fully-decided Boss verdict (Q1/Q2
 * + reasons) into a human-readable marketing narrative. The verdict is
 * already final by the time this module runs — this overlay NEVER changes
 * the verdict, NEVER reorders reasons, NEVER adds new reason codes.
 *
 * Every key driver in the AI output MUST cite a reason code that is present
 * verbatim in the input. The validator enforces this — if the AI invents a
 * reason code, the envelope returns `{status: "error", error: "schema_invalid"}`
 * and the dashboard falls back to the raw rule reasons unchanged.
 */
import { runOverlay } from "./client";
import type { AIOverlay } from "./types";

export type Verdict = "WORKING" | "DEGRADED" | "UNKNOWN" | "MARKET_SHIFT" | "NO_SHIFT" | "INSUFFICIENT_DATA";

export interface ExplanationAIInput {
  accountId: string;
  question: "Q1" | "Q2";
  verdict: Verdict;
  reasons: string[];     // exact reason codes emitted by boss/policy/*
  /** Optional context: the rule-based snippets that produced these reasons. */
  context?: Record<string, unknown>;
}

export interface ExplanationAIOutput {
  narrative: string;     // 1-3 sentences
  keyDrivers: Array<{
    driver: string;        // short human label
    citesReason: string;   // MUST be one of the input reasons
  }>;
}

const SYSTEM_PROMPT = `You are a deterministic marketing analyst translating a verdict into plain English.

You receive: a verdict (already decided), the reason codes that produced it, and optional rule context.

Your job is to ADD a narrative that explains the verdict. You do not change the verdict. You do not add reasons that were not given to you.

Output STRICT JSON only:
{
  "narrative": string,
  "keyDrivers": [{ "driver": string, "citesReason": string }]
}

Rules:
- "narrative" is one to three sentences, plain English, citing observable causes.
- Every "citesReason" MUST appear verbatim in the input "reasons" list.
- Do not invent reason codes.
- Do not contradict the verdict (e.g., do not call a DEGRADED verdict "working").
- Output JSON only.`;

function buildUserMessage(input: ExplanationAIInput): string {
  return JSON.stringify({
    question: input.question,
    verdict: input.verdict,
    reasons: input.reasons,
    context: input.context ?? {},
    notes: "Translate this verdict into a short marketing narrative; cite only the reasons given.",
  });
}

function validate(parsed: unknown, allowedReasons: Set<string>): ExplanationAIOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as any;
  if (typeof p.narrative !== "string" || !p.narrative.trim()) return null;
  if (!Array.isArray(p.keyDrivers)) return null;
  const drivers: ExplanationAIOutput["keyDrivers"] = [];
  for (const d of p.keyDrivers) {
    if (!d || typeof d !== "object") return null;
    if (typeof d.driver !== "string" || !d.driver.trim()) return null;
    if (typeof d.citesReason !== "string" || !allowedReasons.has(d.citesReason)) return null;
    drivers.push({ driver: d.driver, citesReason: d.citesReason });
  }
  return { narrative: p.narrative, keyDrivers: drivers };
}

export async function applyExplanationOverlay(
  input: ExplanationAIInput,
): Promise<AIOverlay<ExplanationAIOutput>> {
  const allowedReasons = new Set<string>(input.reasons);
  return runOverlay<ExplanationAIOutput>({
    accountId: input.accountId,
    promptVersion: "explanation.v1",
    endpoint: "pipeline.ai-overlay.explanation",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(input),
    maxTokens: 500,
    validate: (parsed) => validate(parsed, allowedReasons),
  });
}
