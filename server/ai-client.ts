import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";

const DEFAULT_MAX_TOKENS = 800;
const HARD_TIMEOUT_MS = 45000;

export const PRIMARY_CHAT_MODEL = "gpt-4.1-mini";

let openaiInstance: OpenAI | null = null;
let geminiInstance: GoogleGenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      timeout: HARD_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return openaiInstance;
}

export function getGemini(): GoogleGenAI {
  if (!geminiInstance) {
    geminiInstance = new GoogleGenAI({
      apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
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
  accountId: string;
  endpoint?: string;
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
    const result = await openai.chat.completions.create({
      model: rest.model,
      messages: rest.messages as any,
      ...tokenParam,
      temperature: rest.temperature,
      response_format: rest.response_format,
    } as any);

    success = true;
    actualTokens = result.usage?.total_tokens || rest.max_tokens;
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
    const result = await gemini.models.generateContent({
      model,
      contents,
      config: {
        ...config,
        maxOutputTokens: maxTokens,
      },
    });

    success = true;
    actualTokens = (result as any)?.usageMetadata?.totalTokenCount || maxTokens;
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
