/**
 * Phase 4-A — Commercial Reasoning Core LLM boundary.
 *
 * Single allowed entry-point for LLM calls from inside
 * `server/commercial-reasoning/**`. All other files in the scope are
 * forbidden from importing `aiChat` / `getOpenAI` directly by the
 * `orchestrator-replay/no-bare-llm-call-in-replay` lint rule.
 *
 * This file IS the recorder boundary — the bare ai-client import here
 * is the legitimate exception (see lint allowlist in eslint.config.js
 * `ignores: ["server/commercial-reasoning/llm-call.ts"]`).
 *
 * Responsibilities:
 *   - Force JSON-mode response_format.
 *   - Enforce a hard wall-clock timeout via Promise.race (per §5 plan).
 *   - Surface AICallError / JSON-parse failure / timeout as distinct
 *     classes the caller can map to GATE_DECISION_REASONS.
 */

// eslint-disable-next-line orchestrator-replay/no-bare-llm-call-in-replay
// This file IS the recorder boundary — see file header.
import { aiChat, PRIMARY_CHAT_MODEL, AICallError } from "../ai-client";

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = process.env.COMMERCIAL_REASONER_TIMEOUT_MS;
  if (!raw) return 45_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
})();

const DEFAULT_MAX_TOKENS = 2_500;

export class CommercialReasonerTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`commercial reasoner timed out after ${timeoutMs}ms`);
    this.name = "CommercialReasonerTimeoutError";
  }
}

export class CommercialReasonerJsonParseError extends Error {
  constructor(public readonly raw: string, cause: unknown) {
    super(
      `commercial reasoner response was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "CommercialReasonerJsonParseError";
  }
}

export interface CommercialLlmCallInput {
  accountId: string;
  endpoint: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CommercialLlmCallOutput {
  raw: string;
  parsed: unknown;
  tokensUsed: number;
  latencyMs: number;
}

export async function callCommercialReasoner(
  input: CommercialLlmCallInput,
): Promise<CommercialLlmCallOutput> {
  const startedAt = Date.now();
  const callPromise = aiChat({
    accountId: input.accountId,
    endpoint: input.endpoint,
    model: PRIMARY_CHAT_MODEL,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    response_format: { type: "json_object" },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new CommercialReasonerTimeoutError(DEFAULT_TIMEOUT_MS)),
      DEFAULT_TIMEOUT_MS,
    );
  });

  let result: Awaited<ReturnType<typeof aiChat>>;
  try {
    result = await Promise.race([callPromise, timeoutPromise]);
  } catch (err) {
    if (err instanceof CommercialReasonerTimeoutError) throw err;
    if (err instanceof AICallError) throw err;
    throw new AICallError(
      err instanceof Error ? err.message : String(err),
      "AI_CALL_FAILED",
    );
  }

  const raw = result.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CommercialReasonerJsonParseError(raw, err);
  }

  return {
    raw,
    parsed,
    tokensUsed: result.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - startedAt,
  };
}
