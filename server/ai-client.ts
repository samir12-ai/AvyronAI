import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { recordAiCost } from "./observability/otel";
import { logger } from "./logger";
import { recordAICallOutcome } from "./operations-guardian/ai-pressure-stats";
import { getCurrentRecorder, _nextLlmCallOrder } from "./orchestrator/replay/recorder";
import { hashValue } from "./orchestrator/replay/hash";
import { getActiveStrictLlmMock } from "./orchestrator/replay/llm-strict-mock";

/**
 * Task #89 / Phase 4-A — Replay LLM interception + strict-mock short-circuit.
 *
 * Doctrine REPLAY-LLM-INTERCEPT: every successful AI call originating
 * inside a runOrchestrator scope is captured into the active cassette
 * via `getCurrentRecorder()?.recordLlmCall(...)`. Without this hook,
 * cassettes from real orchestrator runs have empty `llmCalls`, and
 * the player can't strict-mock subsequent replays. This function is
 * a no-op outside an orchestrator scope.
 *
 * Doctrine REPLAY-LLM-STRICT-INJECT: when `getActiveStrictLlmMock()`
 * returns a mock (set by the player / replay-cli), aiChat/aiGemini
 * route through `mock.resolve(provider, model, payload)` BEFORE doing
 * any network call. That makes `replay:run --against current` truly
 * hermetic — zero network, zero token spend.
 *
 * Prompt fingerprint contract (UNIFIED): both `recordReplayLlmCall`
 * (recorder side) and `StrictLlmMock.promptHashFor` (player side) use
 * `hashValue(payload)` over the SAME canonical payload object. The
 * payload is built ONCE per call in aiChat/aiGemini so the recorder's
 * promptHash and the mock's lookup key are bit-identical.
 */
function recordReplayLlmCall(
  provider: "openai" | "gemini",
  model: string,
  payload: unknown,
  response: unknown,
): void {
  const rec = getCurrentRecorder();
  if (!rec) return;
  try {
    rec.recordLlmCall({
      callOrder: _nextLlmCallOrder(),
      provider,
      model,
      promptHash: hashValue(payload),
      response,
    });
  } catch (err) {
    // Seal #15: no silent catches. Recorder errors must never break the
    // AI call but MUST be visible to operators.
    console.error("[Replay] LLM_CALL_RECORD_FAILED", {
      provider,
      model,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildOpenAIPayload(rest: Omit<AIChatOptions, "accountId" | "endpoint" | "timeoutMs">): Record<string, unknown> {
  const isGpt5 = rest.model.startsWith("gpt-5");
  const tokenParam = isGpt5
    ? { max_completion_tokens: rest.max_tokens }
    : { max_tokens: rest.max_tokens };
  return {
    model: rest.model,
    messages: rest.messages as unknown,
    ...tokenParam,
    temperature: rest.temperature,
    response_format: rest.response_format,
    ...(rest.seed !== undefined ? { seed: rest.seed } : {}),
  };
}

/**
 * Seal #7 (F10.6/F10.7) — per-call USD cost estimation. Model rates are the
 * public OpenAI/Gemini list prices ($/1K tokens) at the time of writing.
 * Worth-tracking precision: nearest cent. When pricing changes, update here.
 * Unknown models default to 0 — we still record so cardinality stays right.
 */
const MODEL_COST_USD_PER_1K_TOKENS: Record<string, number> = {
  "gpt-4.1": 0.005,
  "gpt-4o": 0.005,
  "gpt-4o-mini": 0.00015,
  "gpt-5": 0.01,
  "gpt-5-mini": 0.0005,
  "gemini-1.5-pro": 0.00125,
  "gemini-1.5-flash": 0.000075,
  "gemini-2.0-flash": 0.0001,
  "gemini-2.5-flash": 0.0001,
};

function estimateCostUsd(model: string, totalTokens: number): number {
  const ratePer1k = MODEL_COST_USD_PER_1K_TOKENS[model] ?? 0;
  return (totalTokens / 1000) * ratePer1k;
}

const DEFAULT_MAX_TOKENS = 800;
const HARD_TIMEOUT_MS = 45000;

export const PRIMARY_CHAT_MODEL = "gpt-4.1";

export type ModelCapabilityTier =
  | "STRATEGIC_REASONING"
  | "HIGH_CAPABILITY"
  | "HIGH_REASONING"
  | "STANDARD_CLASSIFICATION"
  | "FAST_EXTRACTION";

export function resolveModelForTier(tier: ModelCapabilityTier): string {
  switch (tier) {
    case "STRATEGIC_REASONING":
      return process.env.MODEL_TIER_STRATEGIC || process.env.AI_PRIMARY_MODEL || "gpt-5";
    case "HIGH_CAPABILITY":
      return process.env.MODEL_TIER_HIGH_CAPABILITY || process.env.AI_PRIMARY_MODEL || PRIMARY_CHAT_MODEL;
    case "HIGH_REASONING":
      return process.env.MODEL_TIER_HIGH_REASONING || process.env.AI_PRIMARY_MODEL || PRIMARY_CHAT_MODEL;
    case "STANDARD_CLASSIFICATION":
      return process.env.MODEL_TIER_STANDARD || "gpt-4o-mini";
    case "FAST_EXTRACTION":
      return process.env.MODEL_TIER_FAST || "gpt-4o-mini";
    default:
      return PRIMARY_CHAT_MODEL;
  }
}

let openaiInstance: OpenAI | null = null;
let openaiApiKey: string | undefined;
let geminiInstance: GoogleGenAI | null = null;
let geminiApiKey: string | undefined;

export function getOpenAI(): OpenAI {
  const currentKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!openaiInstance || currentKey !== openaiApiKey) {
    openaiApiKey = currentKey;
    openaiInstance = new OpenAI({
      apiKey: currentKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      timeout: HARD_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return openaiInstance;
}

export function getGemini(): GoogleGenAI {
  const currentKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiInstance || currentKey !== geminiApiKey) {
    geminiApiKey = currentKey;
    const opts: any = { apiKey: currentKey };
    if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
      opts.httpOptions = { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
    }
    geminiInstance = new GoogleGenAI(opts);
  }
  return geminiInstance;
}

export { Modality };

export interface AIChatOptions {
  model: string;
  messages: Array<{ role: string; content: string | any[] }>;
  max_tokens: number;
  temperature?: number;
  response_format?: any;
  seed?: number;
  accountId: string;
  endpoint?: string;
  timeoutMs?: number;
}

export interface AIGeminiOptions {
  model: string;
  contents: string | any[];
  config?: {
    maxOutputTokens?: number;
    responseModalities?: any[];
    [key: string]: any;
  };
  accountId: string;
  endpoint?: string;
}

export class AICallError extends Error {
  code: string;
  constructor(message: string, code: string = "AI_CALL_FAILED") {
    super(message);
    this.name = "AICallError";
    this.code = code;
  }
}

export async function aiChat(options: AIChatOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (!options.max_tokens) {
    throw new AICallError("max_tokens is required for all AI calls", "MISSING_MAX_TOKENS");
  }

  const { accountId, endpoint = "unknown", ...rest } = options;

  // Task #89 / P4-A REPLAY-LLM-STRICT-INJECT — when a strict mock is bound
  // to the async context (player / replay-cli), short-circuit BEFORE any
  // budget reservation or network call so the candidate run is fully
  // hermetic. A mock miss surfaces as `LlmMockMissError` so the player
  // classifies it STRUCTURAL.
  const __mock = getActiveStrictLlmMock();
  if (__mock) {
    const payload = buildOpenAIPayload(rest);
    return __mock.resolve("openai", rest.model, payload) as OpenAI.Chat.Completions.ChatCompletion;
  }

  const budgetCheck = await checkAndReserveBudget(accountId, rest.max_tokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;
  let outcomeKind: "success" | "timeout" | "failed" | null = null;
  const payload = buildOpenAIPayload(rest);

  const effectiveTimeoutMs = options.timeoutMs ?? HARD_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new AICallError(`OpenAI call timed out after ${effectiveTimeoutMs}ms`, "AI_TIMEOUT"));
    }, effectiveTimeoutMs);
  });

  try {
    const openai = getOpenAI();
    let result: OpenAI.Chat.Completions.ChatCompletion;
    try {
      result = await Promise.race([
        openai.chat.completions.create(payload as any, { timeout: effectiveTimeoutMs }),
        timeoutPromise
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    success = true;
    actualTokens = result.usage?.total_tokens || rest.max_tokens;
    // Task #89 / P4-A — capture into active replay cassette (no-op outside
    // orchestrator scope or when gate OFF).
    recordReplayLlmCall("openai", rest.model, payload, result);
    // Seal #7 / F10.7 — emit ai_cost_usd_total + traceId-aware log.
    const costUsd = estimateCostUsd(rest.model, actualTokens);
    recordAiCost("openai", rest.model, costUsd);
    logger.info({
      msg: "ai.openai.call",
      accountId,
      endpoint,
      model: rest.model,
      tokens: actualTokens,
      costUsd: Number(costUsd.toFixed(6)),
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (err: any) {
    const isTimeout =
      (err instanceof AICallError && err.code === "AI_TIMEOUT") ||
      (err && (err.name === "APITimeoutError" || /timeout/i.test(String(err.message ?? ""))));
    const isQuotaOrRateLimit =
      err &&
      (/429/i.test(String(err.message)) ||
        /credits/i.test(String(err.message)) ||
        /quota/i.test(String(err.message)) ||
        /insufficient_quota/i.test(String(err.message)));

    const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if ((isQuotaOrRateLimit || isTimeout) && geminiKey) {
      console.warn(
        `[aiChat] OpenAI ${isTimeout ? "timeout" : "quota/rate-limit"} hit ("${err.message}"). Attempting seamless Gemini fallback...`
      );
      try {
        const gemini = getGemini();
        let promptText = "";
        let systemInstruction = "";
        for (const msg of rest.messages) {
          const contentStr =
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content);
          if (msg.role === "system") {
            systemInstruction += contentStr + "\n\n";
          } else {
            promptText += `${msg.role.toUpperCase()}:\n${contentStr}\n\n`;
          }
        }
        const fullContent = systemInstruction
          ? `${systemInstruction}\n${promptText}`
          : promptText;

        const isJson = rest.response_format?.type === "json_object";
        const geminiModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";

        let geminiRes: any = null;
        let lastGeminiErr: any = null;

        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            geminiRes = await gemini.models.generateContent({
              model: geminiModel,
              contents: fullContent,
              config: {
                maxOutputTokens: rest.max_tokens,
                temperature: rest.temperature,
                ...(isJson ? { responseMimeType: "application/json" } : {}),
              },
            });
            if (geminiRes?.text) break;
          } catch (mErr: any) {
            lastGeminiErr = mErr;
            if (/429|RESOURCE_EXHAUSTED|rate-limit/i.test(mErr.message || "") && attempt < 5) {
              const waitMatch = String(mErr.message).match(/retry in ([\d\.]+)s/i);
              const rawWait = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) : 5;
              const waitSec = Math.min(Math.max(rawWait, 2), 15);
              console.log(`[aiChat] Gemini 429 rate limit hit. Waiting ${waitSec}s before attempt ${attempt + 1}...`);
              await new Promise((r) => setTimeout(r, waitSec * 1000));
              continue;
            }
          }
        }

        if (!geminiRes) {
          throw (lastGeminiErr || new Error("Gemini fallback returned empty response"));
        }

        const text = geminiRes.text || "";
        success = true;
        actualTokens =
          (geminiRes as any)?.usageMetadata?.totalTokenCount || rest.max_tokens;

        recordReplayLlmCall("gemini", geminiModel, payload, geminiRes);
        const costUsd = estimateCostUsd(geminiModel, actualTokens);
        recordAiCost("gemini", geminiModel, costUsd);
        logger.info({
          msg: "ai.gemini.fallback.call",
          accountId,
          endpoint,
          model: geminiModel,
          tokens: actualTokens,
          costUsd: Number(costUsd.toFixed(6)),
          durationMs: Date.now() - startTime,
        });

        const fakeOpenAIResult: OpenAI.Chat.Completions.ChatCompletion = {
          id: `gemini-fallback-${Date.now()}`,
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                role: "assistant",
                content: text,
                refusal: null,
              },
            },
          ],
          created: Math.floor(Date.now() / 1000),
          model: geminiModel,
          object: "chat.completion",
        };
        return fakeOpenAIResult;
      } catch (geminiErr: any) {
        console.error(`[aiChat] Gemini fallback error: ${geminiErr.message}`);
      }
    }

    outcomeKind = isTimeout ? "timeout" : "failed";
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "AI call failed", "AI_CALL_FAILED");
  } finally {
    const latencyMs = Date.now() - startTime;
    try {
      if (success) {
        recordAICallOutcome({ provider: "openai", outcome: "success", latencyMs });
      } else if (outcomeKind) {
        recordAICallOutcome({ provider: "openai", outcome: outcomeKind, latencyMs });
      }
    } catch (recordErr) {
      // Seal #15 doctrine: no silent catches. The aggregator is best-effort
      // observability — a recorder failure must never break the AI call,
      // but it MUST be visible in logs.
      console.error("[OperationsGuardian] AI_OUTCOME_RECORD_FAILED", {
        provider: "openai",
        recordErr,
      });
    }
    await reconcileBudgetReservation({
      accountId,
      endpoint,
      model: rest.model,
      maxTokens: rest.max_tokens,
      actualTokens,
      success,
      durationMs: latencyMs,
    }).catch(() => {});
  }
}

export async function aiGemini(options: AIGeminiOptions) {
  const { accountId, endpoint = "unknown", model, contents, config } = options;

  const maxTokens = config?.maxOutputTokens || DEFAULT_MAX_TOKENS;

  // Task #89 / P4-A REPLAY-LLM-STRICT-INJECT — short-circuit before any
  // network call. Lookup payload mirrors the shape used by
  // recordReplayLlmCall below so the hash matches bit-for-bit.
  const __mock = getActiveStrictLlmMock();
  if (__mock) {
    return __mock.resolve("gemini", model, { model, contents, config });
  }

  const budgetCheck = await checkAndReserveBudget(accountId, maxTokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;
  let outcomeKind: "success" | "timeout" | "failed" | null = null;

  try {
    const gemini = getGemini();
    // Track #3 / Seal #15 — Gemini call previously had NO wall-clock timeout.
    // The OpenAI path uses HARD_TIMEOUT_MS (45s); Gemini was relying entirely
    // on the underlying fetch defaults, which can hang indefinitely on a
    // half-open socket. A hung Gemini call also holds the per-account
    // pg_advisory_lock in checkAndReserveBudget, so a single hang blocks
    // ALL subsequent AI calls for the same account. We now race against a
    // wall-clock timer; on timeout we throw an AICallError so the outer
    // catch + finally still run (lock release, budget reconciliation).
    const GEMINI_HARD_TIMEOUT_MS = (() => {
      const raw = process.env.AI_GEMINI_HARD_TIMEOUT_MS;
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
    })();
    // Seal #16 / F2 — wall-clock timeout MUST also abort the underlying
    // @google/genai SDK fetch via AbortController. Pre-Seal #16 the
    // Promise.race only released our await; the SDK request kept running
    // until its own (much longer) network timeout, leaking sockets and
    // continuing to charge tokens against the account quota.
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        reject(
          new AICallError(
            `Gemini call exceeded ${GEMINI_HARD_TIMEOUT_MS}ms wall-clock timeout`,
            "AI_TIMEOUT",
          ),
        );
      }, GEMINI_HARD_TIMEOUT_MS);
    });
    const result = await Promise.race([
      gemini.models.generateContent({
        model,
        contents,
        config: {
          ...config,
          maxOutputTokens: maxTokens,
          abortSignal: abortController.signal,
        },
      }),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });

    success = true;
    actualTokens = (result as any)?.usageMetadata?.totalTokenCount || maxTokens;
    // Task #89 / P4-A — capture into active replay cassette (no-op outside
    // orchestrator scope or when gate OFF).
    recordReplayLlmCall("gemini", model, { model, contents, config }, result);
    // Seal #7 / F10.7 — emit ai_cost_usd_total + traceId-aware log.
    const costUsd = estimateCostUsd(model, actualTokens);
    recordAiCost("gemini", model, costUsd);
    logger.info({
      msg: "ai.gemini.call",
      accountId,
      endpoint,
      model,
      tokens: actualTokens,
      costUsd: Number(costUsd.toFixed(6)),
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (err: any) {
    const isTimeout =
      (err instanceof AICallError && err.code === "AI_TIMEOUT") ||
      (err && /timeout|aborted/i.test(String(err.message ?? "")));
    outcomeKind = isTimeout ? "timeout" : "failed";
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "Gemini call failed", "AI_CALL_FAILED");
  } finally {
    const latencyMs = Date.now() - startTime;
    try {
      if (success) {
        recordAICallOutcome({ provider: "gemini", outcome: "success", latencyMs });
      } else if (outcomeKind) {
        recordAICallOutcome({ provider: "gemini", outcome: outcomeKind, latencyMs });
      }
    } catch (recordErr) {
      console.error("[OperationsGuardian] AI_OUTCOME_RECORD_FAILED", {
        provider: "gemini",
        recordErr,
      });
    }
    await reconcileBudgetReservation({
      accountId,
      endpoint,
      model,
      maxTokens,
      actualTokens,
      success,
      durationMs: latencyMs,
    }).catch(() => {});
  }
}

const WEEKLY_TOKEN_BUDGET = 500000;

const FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

const ACCOUNT_BUDGET_OVERRIDES: Record<string, number> = {
  [FOUNDER_ACCOUNT_ID]: Infinity,
  "system": Infinity,
};

export function getAccountBudget(accountId: string): number {
  if (
    process.env.NODE_ENV !== "production" &&
    (accountId.startsWith("acc_buffer") ||
     accountId.startsWith("test_") ||
     accountId.startsWith("dev_") ||
     accountId.includes("_e2e_") ||
     process.env.NODE_ENV === "test" ||
     process.env.NODE_ENV === "development")
  ) {
    return Infinity;
  }
  return ACCOUNT_BUDGET_OVERRIDES[accountId] ?? WEEKLY_TOKEN_BUDGET;
}

export async function checkAndReserveBudget(accountId: string, maxTokens: number): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const budget = getAccountBudget(accountId);
    if (!Number.isFinite(budget)) {
      return { allowed: true };
    }
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const lockKey = hashAccountId(accountId);
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      const result = await tx.execute(sql`
        SELECT COALESCE(SUM(estimated_tokens), 0) as total_tokens
        FROM ai_usage_log
        WHERE account_id = ${accountId} AND created_at > NOW() - INTERVAL '7 days'
      `);
      const totalTokens = Number(result.rows?.[0]?.total_tokens || 0);
      if (totalTokens + maxTokens > budget) {
        return { allowed: false, reason: `Weekly quota ${budget} tokens exceeded (used: ${totalTokens}, requested: ${maxTokens})` };
      }
      await tx.execute(sql`
        INSERT INTO ai_usage_log (account_id, endpoint, model, max_tokens, estimated_tokens, success, duration_ms, created_at)
        VALUES (${accountId}, 'budget_reservation', 'reservation', ${maxTokens}, ${maxTokens}, false, 0, NOW())
      `);
      return { allowed: true };
    });
  } catch {
    return { allowed: true };
  }
}

function hashAccountId(accountId: string): number {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) {
    hash = ((hash << 5) - hash + accountId.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff;
}

interface ReconcileEntry {
  accountId: string;
  endpoint: string;
  model: string;
  maxTokens: number;
  actualTokens: number;
  success: boolean;
  durationMs: number;
}

async function reconcileBudgetReservation(entry: ReconcileEntry): Promise<void> {
  try {
    const budget = getAccountBudget(entry.accountId);
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    if (Number.isFinite(budget)) {
      await db.execute(sql`
        DELETE FROM ai_usage_log 
        WHERE id = (
          SELECT id FROM ai_usage_log 
          WHERE account_id = ${entry.accountId} 
            AND endpoint = 'budget_reservation' 
            AND model = 'reservation'
          ORDER BY created_at DESC LIMIT 1
        )
      `);
    }
    await db.execute(sql`
      INSERT INTO ai_usage_log (account_id, endpoint, model, max_tokens, estimated_tokens, success, duration_ms, created_at)
      VALUES (${entry.accountId}, ${entry.endpoint}, ${entry.model}, ${entry.maxTokens}, ${entry.actualTokens}, ${entry.success}, ${entry.durationMs}, NOW())
    `);
  } catch {
  }
}

export function getWeeklyTokenBudget(accountId?: string): number {
  if (accountId) return getAccountBudget(accountId);
  return WEEKLY_TOKEN_BUDGET;
}

export { WEEKLY_TOKEN_BUDGET, ACCOUNT_BUDGET_OVERRIDES };

/**
 * Task #89 / Phase 4-A test-only helpers — let the E2E record→replay
 * suite swap the OpenAI / Gemini clients for stubs that return canned
 * responses without making a network call. Production code MUST NOT
 * import these; they exist purely to keep the hermeticity contract of
 * server/tests/orchestrator-replay/llm-end-to-end.test.ts provable
 * without a real provider key. Naming follows the `__*ForTests`
 * convention so a reviewer can grep for accidental production usage.
 */
export function __setOpenAIClientForTests(client: OpenAI): void {
  openaiInstance = client;
  // Sync the cached api-key to whatever the current env says so
  // `getOpenAI()`'s `currentKey !== openaiApiKey` cache-bust check does
  // NOT replace our stub with a real client on the next call.
  openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

export function __resetOpenAIClientForTests(): void {
  openaiInstance = null;
  openaiApiKey = undefined;
}

export function __setGeminiClientForTests(client: GoogleGenAI): void {
  geminiInstance = client;
  geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
}

export function __resetGeminiClientForTests(): void {
  geminiInstance = null;
  geminiApiKey = undefined;
}

export async function getWeeklyTokenUsage(accountId: string): Promise<number> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(estimated_tokens), 0) as total_tokens
      FROM ai_usage_log
      WHERE account_id = ${accountId}
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    return Number(result.rows?.[0]?.total_tokens || 0);
  } catch {
    return 0;
  }
}
