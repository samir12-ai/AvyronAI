import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";

const DEFAULT_MAX_TOKENS = 800;
const HARD_TIMEOUT_MS = 25000;

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
  accountId?: string;
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
  accountId?: string;
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

  const { accountId = "default", endpoint = "unknown", ...rest } = options;

  const budgetCheck = await checkAIBudget(accountId);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let estimatedTokens = 0;

  try {
    const openai = getOpenAI();
    const result = await openai.chat.completions.create({
      model: rest.model,
      messages: rest.messages as any,
      max_tokens: rest.max_tokens,
      temperature: rest.temperature,
      response_format: rest.response_format,
    });

    success = true;
    estimatedTokens = result.usage?.total_tokens || rest.max_tokens;
    return result;
  } catch (err: any) {
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "AI call failed", "AI_CALL_FAILED");
  } finally {
    await logAICall({
      accountId,
      endpoint,
      model: rest.model,
      maxTokens: rest.max_tokens,
      estimatedTokens,
      success,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
  }
}

export async function aiGemini(options: AIGeminiOptions) {
  const { accountId = "default", endpoint = "unknown", model, contents, config } = options;

  const maxTokens = config?.maxOutputTokens || DEFAULT_MAX_TOKENS;

  const budgetCheck = await checkAIBudget(accountId);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const startTime = Date.now();
  let success = false;
  let estimatedTokens = 0;

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
    estimatedTokens = maxTokens;
    return result;
  } catch (err: any) {
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "Gemini call failed", "AI_CALL_FAILED");
  } finally {
    await logAICall({
      accountId,
      endpoint,
      model,
      maxTokens,
      estimatedTokens,
      success,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
  }
}

const WEEKLY_TOKEN_BUDGET = 500000;

async function checkAIBudget(accountId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      SELECT COALESCE(SUM(estimated_tokens), 0) as total_tokens
      FROM ai_usage_log
      WHERE account_id = ${accountId}
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    const totalTokens = Number(result.rows?.[0]?.total_tokens || 0);
    if (totalTokens >= WEEKLY_TOKEN_BUDGET) {
      return { allowed: false, reason: `Weekly quota ${WEEKLY_TOKEN_BUDGET} tokens exceeded (used: ${totalTokens})` };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

interface AILogEntry {
  accountId: string;
  endpoint: string;
  model: string;
  maxTokens: number;
  estimatedTokens: number;
  success: boolean;
  durationMs: number;
}

async function logAICall(entry: AILogEntry): Promise<void> {
  try {
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO ai_usage_log (account_id, endpoint, model, max_tokens, estimated_tokens, success, duration_ms, created_at)
      VALUES (${entry.accountId}, ${entry.endpoint}, ${entry.model}, ${entry.maxTokens}, ${entry.estimatedTokens}, ${entry.success}, ${entry.durationMs}, NOW())
    `);
  } catch {
  }
}

export function getWeeklyTokenBudget(): number {
  return WEEKLY_TOKEN_BUDGET;
}

export { WEEKLY_TOKEN_BUDGET };

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
