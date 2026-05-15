import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { recordAiCost } from "./observability/otel";
import { logger } from "./logger";

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

let openaiInstance: OpenAI | null = null;
let openaiApiKey: string | undefined;
let geminiInstance: GoogleGenAI | null = null;
let geminiApiKey: string | undefined;

export function getOpenAI(): OpenAI {
  const currentKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
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
  const currentKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!geminiInstance || currentKey !== geminiApiKey) {
    geminiApiKey = currentKey;
    geminiInstance = new GoogleGenAI({
      apiKey: currentKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      },
    });
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

  const budgetCheck = await checkAndReserveBudget(accountId, rest.max_tokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;

  try {
    const openai = getOpenAI();
    const isGpt5 = rest.model.startsWith("gpt-5");
    const tokenParam = isGpt5
      ? { max_completion_tokens: rest.max_tokens }
      : { max_tokens: rest.max_tokens };
    const payload = {
      model: rest.model,
      messages: rest.messages as any,
      ...tokenParam,
      temperature: rest.temperature,
      response_format: rest.response_format,
      ...(rest.seed !== undefined ? { seed: rest.seed } : {}),
    };
    const callOptions = options.timeoutMs && options.timeoutMs > HARD_TIMEOUT_MS
      ? { timeout: options.timeoutMs }
      : undefined;
    const result = callOptions
      ? await openai.chat.completions.create(payload as any, callOptions)
      : await openai.chat.completions.create(payload as any);

    success = true;
    actualTokens = result.usage?.total_tokens || rest.max_tokens;
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
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "AI call failed", "AI_CALL_FAILED");
  } finally {
    await reconcileBudgetReservation({
      accountId,
      endpoint,
      model: rest.model,
      maxTokens: rest.max_tokens,
      actualTokens,
      success,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
  }
}

export async function aiGemini(options: AIGeminiOptions) {
  const { accountId, endpoint = "unknown", model, contents, config } = options;

  const maxTokens = config?.maxOutputTokens || DEFAULT_MAX_TOKENS;

  const budgetCheck = await checkAndReserveBudget(accountId, maxTokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;

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
    // Seal #16 / F2 — wall-clock timeout MUST also abort the underlying SDK
    // call. Pre-Seal #16 the Promise.race only released our await; the
    // @google/genai HTTP request kept running in the background until its
    // own (much longer) network timeout, leaking sockets, holding a budget
    // reservation that had already been "released" by reconcileBudgetReservation,
    // and continuing to charge tokens against the account quota. We now
    // wire an AbortController.signal into GenerateContentConfig.abortSignal
    // (added to the SDK in @google/genai 0.x; verified in 1.40.0). On
    // timeout we call controller.abort() BEFORE rejecting so the SDK's
    // fetch is cancelled at the same instant the AICallError surfaces.
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        try {
          abortController.abort();
        } catch (abortErr) {
          // AbortController.abort() is sync + cannot fail in Node, but a
          // user-supplied AbortSignal in `config.abortSignal` could throw
          // if it's already aborted. Log and continue to reject — we MUST
          // still surface the AI_TIMEOUT to the caller.
          console.error(
            `[ai-client] gemini abort threw on timeout: ${(abortErr as Error)?.message}`,
          );
        }
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
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "Gemini call failed", "AI_CALL_FAILED");
  } finally {
    await reconcileBudgetReservation({
      accountId,
      endpoint,
      model,
      maxTokens,
      actualTokens,
      success,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
  }
}

const WEEKLY_TOKEN_BUDGET = 500000;

const FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

const ACCOUNT_BUDGET_OVERRIDES: Record<string, number> = {
  [FOUNDER_ACCOUNT_ID]: Infinity,
};

function getAccountBudget(accountId: string): number {
  return ACCOUNT_BUDGET_OVERRIDES[accountId] ?? WEEKLY_TOKEN_BUDGET;
}

async function checkAndReserveBudget(accountId: string, maxTokens: number): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const lockKey = hashAccountId(accountId);
    const budget = getAccountBudget(accountId);
    await db.execute(sql`SELECT pg_advisory_lock(${lockKey})`);
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(estimated_tokens), 0) as total_tokens
        FROM ai_usage_log
        WHERE account_id = ${accountId} AND created_at > NOW() - INTERVAL '7 days'
      `);
      const totalTokens = Number(result.rows?.[0]?.total_tokens || 0);
      if (totalTokens + maxTokens > budget) {
        return { allowed: false, reason: `Weekly quota ${budget} tokens exceeded (used: ${totalTokens}, requested: ${maxTokens})` };
      }
      await db.execute(sql`
        INSERT INTO ai_usage_log (account_id, endpoint, model, max_tokens, estimated_tokens, success, duration_ms, created_at)
        VALUES (${accountId}, 'budget_reservation', 'reservation', ${maxTokens}, ${maxTokens}, false, 0, NOW())
      `);
      return { allowed: true };
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
    }
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
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
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
