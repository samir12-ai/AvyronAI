import { AsyncLocalStorage } from "node:async_hooks";
import OpenAI from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import { recordAiCost, recordAiCallTelemetry } from "./observability/otel";
import { logger } from "./logger";
import { recordAICallOutcome } from "./operations-guardian/ai-pressure-stats";
import { getCurrentRecorder, _nextLlmCallOrder } from "./orchestrator/replay/recorder";
import { hashValue } from "./orchestrator/replay/hash";
import { getActiveStrictLlmMock } from "./orchestrator/replay/llm-strict-mock";

export interface AiCampaignAttributionContext {
  accountId?: string;
  campaignId?: string;
  operationType?: string;
  sharedConsumerCampaignIds?: string[];
  attributionPolicy?: string;
}

const aiCampaignContextStorage = new AsyncLocalStorage<AiCampaignAttributionContext>();

export function runWithAiCampaignContext<T>(
  ctx: AiCampaignAttributionContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const parent = aiCampaignContextStorage.getStore() || {};
  return aiCampaignContextStorage.run({ ...parent, ...ctx }, fn);
}

export function getCurrentAiCampaignContext(): AiCampaignAttributionContext | undefined {
  return aiCampaignContextStorage.getStore();
}

/**
 * Task #89 / Phase 4-A — Replay LLM interception + strict-mock short-circuit.
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
    console.error("[Replay] LLM_CALL_RECORD_FAILED", {
      provider,
      model,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildOpenAIPayload(rest: Omit<AIChatOptions, "accountId" | "endpoint" | "timeoutMs" | "forceProvider">): Record<string, unknown> {
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
 * Authoritative Provider Pricing Registry (USD per 1M tokens).
 * Pricing Version: 2025-04-14 (OpenAI GPT-4.1 / GPT-4o / GPT-5 + Google Gemini API list rates).
 * Unknown models MUST return null (costStatus = "PRICING_UNKNOWN") and NEVER silently become $0.
 */
export const PRICING_VERSION = "2025-04-14";

export type CostStatus =
  | "PROVIDER_REPORTED"
  | "ESTIMATED"
  | "PRICING_UNKNOWN"
  | "USAGE_UNAVAILABLE";

export type AIErrorCategory =
  | "BILLING_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_OUTPUT"
  | "AI_BUDGET_EXCEEDED"
  | "DEMO_MODE_AI_BLOCKED"
  | "AI_CALL_FAILED";

export interface ModelTokenPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  reasoningPer1M?: number;
}

export const MODEL_PRICING_PER_1M_TOKENS: Record<string, ModelTokenPricing> = {
  "gpt-4.1": { inputPer1M: 2.00, cachedInputPer1M: 0.50, outputPer1M: 8.00 },
  "gpt-4.1-mini": { inputPer1M: 0.40, cachedInputPer1M: 0.10, outputPer1M: 1.60 },
  "gpt-4.1-nano": { inputPer1M: 0.10, cachedInputPer1M: 0.025, outputPer1M: 0.40 },
  "gpt-4o": { inputPer1M: 2.50, cachedInputPer1M: 1.25, outputPer1M: 10.00 },
  "gpt-4o-mini": { inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.60 },
  "gpt-5": { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10.00 },
  "gpt-5-mini": { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2.00 },
  "gemini-1.5-pro": { inputPer1M: 1.25, cachedInputPer1M: 0.3125, outputPer1M: 5.00 },
  "gemini-1.5-flash": { inputPer1M: 0.075, cachedInputPer1M: 0.01875, outputPer1M: 0.30 },
  "gemini-2.0-flash": { inputPer1M: 0.10, cachedInputPer1M: 0.025, outputPer1M: 0.40 },
  "gemini-2.5-flash": { inputPer1M: 0.15, cachedInputPer1M: 0.0375, outputPer1M: 0.60, reasoningPer1M: 3.50 },
};

export function resolveModelPricing(model: string): ModelTokenPricing | null {
  if (!model) return null;
  const normalized = model.trim();
  if (MODEL_PRICING_PER_1M_TOKENS[normalized]) {
    return MODEL_PRICING_PER_1M_TOKENS[normalized];
  }
  const withoutDate = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (MODEL_PRICING_PER_1M_TOKENS[withoutDate]) {
    return MODEL_PRICING_PER_1M_TOKENS[withoutDate];
  }
  return null;
}

export interface TokenUsageBreakdown {
  inputTokens: number | null;
  cachedInputTokens: number;
  outputTokens: number | null;
  reasoningTokens: number;
  totalTokens: number | null;
  usageAvailable: boolean;
  reasoningIncludedInOutput: boolean;
  providerReportedCostUsd: number | null;
}

export interface CostCalculationResult {
  estimatedCostUsd: number | null;
  providerReportedCostUsd: number | null;
  effectiveCostUsd: number | null;
  costStatus: CostStatus;
  pricingVersion: string;
}

export function extractOpenAIUsage(result: any): TokenUsageBreakdown {
  const usage = result?.usage;
  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: null,
      cachedInputTokens: 0,
      outputTokens: null,
      reasoningTokens: 0,
      totalTokens: null,
      usageAvailable: false,
      reasoningIncludedInOutput: true,
      providerReportedCostUsd: null,
    };
  }
  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
  const cachedInputTokens =
    typeof usage.prompt_tokens_details?.cached_tokens === "number"
      ? usage.prompt_tokens_details.cached_tokens
      : 0;
  const reasoningTokens =
    typeof usage.completion_tokens_details?.reasoning_tokens === "number"
      ? usage.completion_tokens_details.reasoning_tokens
      : 0;
  const totalTokens =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null;
  const providerReportedCostUsd =
    typeof usage.cost === "number" && Number.isFinite(usage.cost)
      ? usage.cost
      : typeof usage.total_cost_usd === "number" && Number.isFinite(usage.total_cost_usd)
      ? usage.total_cost_usd
      : null;
  const usageAvailable = inputTokens !== null || outputTokens !== null || totalTokens !== null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    usageAvailable,
    reasoningIncludedInOutput: true,
    providerReportedCostUsd,
  };
}

export function extractGeminiUsage(result: any): TokenUsageBreakdown {
  const meta = result?.usageMetadata;
  if (!meta || typeof meta !== "object") {
    return {
      inputTokens: null,
      cachedInputTokens: 0,
      outputTokens: null,
      reasoningTokens: 0,
      totalTokens: null,
      usageAvailable: false,
      reasoningIncludedInOutput: false,
      providerReportedCostUsd: null,
    };
  }
  const inputTokens = typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : null;
  const cachedInputTokens =
    typeof meta.cachedContentTokenCount === "number" ? meta.cachedContentTokenCount : 0;
  const outputTokens =
    typeof meta.candidatesTokenCount === "number" ? meta.candidatesTokenCount : null;
  const reasoningTokens =
    typeof meta.thoughtsTokenCount === "number" ? meta.thoughtsTokenCount : 0;
  const totalTokens =
    typeof meta.totalTokenCount === "number"
      ? meta.totalTokenCount
      : inputTokens !== null || outputTokens !== null || reasoningTokens > 0
      ? (inputTokens ?? 0) + (outputTokens ?? 0) + reasoningTokens
      : null;
  const providerReportedCostUsd =
    typeof meta.billedCostUsd === "number" && Number.isFinite(meta.billedCostUsd)
      ? meta.billedCostUsd
      : null;
  const usageAvailable = inputTokens !== null || outputTokens !== null || totalTokens !== null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    usageAvailable,
    reasoningIncludedInOutput: false,
    providerReportedCostUsd,
  };
}

export function calculateCallCost(model: string, usage: TokenUsageBreakdown): CostCalculationResult {
  const pricing = resolveModelPricing(model);
  if (!usage.usageAvailable || (usage.inputTokens === null && usage.outputTokens === null)) {
    return {
      estimatedCostUsd: null,
      providerReportedCostUsd: usage.providerReportedCostUsd,
      effectiveCostUsd: usage.providerReportedCostUsd,
      costStatus: usage.providerReportedCostUsd !== null ? "PROVIDER_REPORTED" : "USAGE_UNAVAILABLE",
      pricingVersion: PRICING_VERSION,
    };
  }
  if (!pricing) {
    return {
      estimatedCostUsd: null,
      providerReportedCostUsd: usage.providerReportedCostUsd,
      effectiveCostUsd: usage.providerReportedCostUsd,
      costStatus: usage.providerReportedCostUsd !== null ? "PROVIDER_REPORTED" : "PRICING_UNKNOWN",
      pricingVersion: PRICING_VERSION,
    };
  }

  const input = Math.max(0, usage.inputTokens ?? 0);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens ?? 0));
  const uncachedInput = Math.max(0, input - cached);
  const output = Math.max(0, usage.outputTokens ?? 0);
  const reasoning = Math.max(0, usage.reasoningTokens ?? 0);
  const reasoningRate = pricing.reasoningPer1M ?? pricing.outputPer1M;

  let outputCostPer1M: number;
  if (usage.reasoningIncludedInOutput) {
    const nonReasoningOutput = Math.max(0, output - reasoning);
    outputCostPer1M = nonReasoningOutput * pricing.outputPer1M + reasoning * reasoningRate;
  } else {
    outputCostPer1M = output * pricing.outputPer1M + reasoning * reasoningRate;
  }

  const rawEstimated =
    (uncachedInput * pricing.inputPer1M + cached * pricing.cachedInputPer1M + outputCostPer1M) /
    1_000_000;
  const estimatedCostUsd = Number(rawEstimated.toFixed(8));
  const effectiveCostUsd = usage.providerReportedCostUsd ?? estimatedCostUsd;
  const costStatus: CostStatus =
    usage.providerReportedCostUsd !== null ? "PROVIDER_REPORTED" : "ESTIMATED";

  return {
    estimatedCostUsd,
    providerReportedCostUsd: usage.providerReportedCostUsd,
    effectiveCostUsd,
    costStatus,
    pricingVersion: PRICING_VERSION,
  };
}

export function classifyAIError(err: any): AIErrorCategory {
  if (!err) return "AI_CALL_FAILED";
  const code = String(err.code ?? "");
  const msg = String(err.message ?? err);
  if (code === "AI_BUDGET_EXCEEDED") return "AI_BUDGET_EXCEEDED";
  if (code === "DEMO_MODE_AI_BLOCKED") return "DEMO_MODE_AI_BLOCKED";
  if (code === "MALFORMED_OUTPUT" || code === "TRUNCATED_OUTPUT") return "MALFORMED_OUTPUT";
  if (code === "AI_TIMEOUT" || err.name === "APITimeoutError" || /timeout|aborted|ETIMEDOUT/i.test(msg)) {
    return "TIMEOUT";
  }
  if (/no credits remaining|insufficient_quota|billing_hard_limit_reached|credit balance is too low/i.test(msg)) {
    return "BILLING_EXHAUSTED";
  }
  if (/429|rate limit|rate-limit|RESOURCE_EXHAUSTED|too many requests/i.test(msg)) {
    return "RATE_LIMITED";
  }
  if (/500|502|503|504|UNAVAILABLE|overloaded|high demand|ECONNRESET|ENOTFOUND/i.test(msg)) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "AI_CALL_FAILED";
}

// Provider circuit breaker state to avoid repeatedly hammering an exhausted provider in the same run
const CIRCUIT_BREAKER_TTL_MS = 5 * 60 * 1000;
let openaiBillingExhaustedUntil = 0;
let openaiBillingExhaustedMessage = "";
let geminiQuotaExhaustedUntil = 0;
let geminiQuotaExhaustedMessage = "";
const geminiModelExhaustedUntil = new Map<string, number>();
const GEMINI_FALLBACK_MODEL_CASCADE = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
];
let isTestClientInjected = false;
let logicalRequestSeq = 0;

export function isBillingOrQuotaExhaustedError(err: any): boolean {
  if (!err) return false;
  const cat = err.errorCategory || classifyAIError(err);
  if (cat === "BILLING_EXHAUSTED") return true;
  const code = String(err.code || "");
  if (code === "AI_BUDGET_EXCEEDED" || code === "BILLING_EXHAUSTED") return true;
  const msg = String(err.message || "");
  return /no credits remaining|insufficient_quota|billing_hard_limit_reached|credit balance is too low|ai budget exceeded/i.test(msg);
}

export function isProviderTechnicalFailureError(err: any): boolean {
  if (!err) return false;
  if (isBillingOrQuotaExhaustedError(err)) return true;
  const cat = err.errorCategory || classifyAIError(err);
  return (
    cat === "BILLING_EXHAUSTED" ||
    cat === "RATE_LIMITED" ||
    cat === "PROVIDER_UNAVAILABLE" ||
    cat === "TIMEOUT" ||
    cat === "DEMO_MODE_AI_BLOCKED"
  );
}

export function __resetProviderCircuitBreakerForTests(): void {
  openaiBillingExhaustedUntil = 0;
  openaiBillingExhaustedMessage = "";
  geminiQuotaExhaustedUntil = 0;
  geminiQuotaExhaustedMessage = "";
  geminiModelExhaustedUntil.clear();
}

/**
 * Resets process-local provider circuit breaker state when a user explicitly initiates
 * a pipeline continuation after restoring API credits or quota.
 */
export function resetProviderCircuitBreakerForContinuation(): void {
  openaiBillingExhaustedUntil = 0;
  openaiBillingExhaustedMessage = "";
  geminiQuotaExhaustedUntil = 0;
  geminiQuotaExhaustedMessage = "";
  geminiModelExhaustedUntil.clear();
}

export function getProviderCircuitBreakerState(): {
  openaiCircuitBroken: boolean;
  openaiBillingExhaustedUntil: number;
  openaiBillingExhaustedMessage: string;
  geminiCircuitBroken: boolean;
  geminiQuotaExhaustedUntil: number;
  geminiQuotaExhaustedMessage: string;
} {
  const now = Date.now();
  return {
    openaiCircuitBroken: now < openaiBillingExhaustedUntil,
    openaiBillingExhaustedUntil,
    openaiBillingExhaustedMessage,
    geminiCircuitBroken: now < geminiQuotaExhaustedUntil,
    geminiQuotaExhaustedUntil,
    geminiQuotaExhaustedMessage,
  };
}

const DEFAULT_MAX_TOKENS = 800;
const HARD_TIMEOUT_MS = parseInt(process.env.AI_HARD_TIMEOUT_MS || "120000", 10);

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
  campaignId?: string;
  operationType?: string;
  sharedConsumerCampaignIds?: string[];
  attributionPolicy?: string;
  endpoint?: string;
  timeoutMs?: number;
  forceProvider?: "openai" | "gemini";
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
  campaignId?: string;
  operationType?: string;
  sharedConsumerCampaignIds?: string[];
  attributionPolicy?: string;
  endpoint?: string;
}

export class AICallError extends Error {
  code: string;
  errorCategory: AIErrorCategory;
  provider?: "openai" | "gemini";
  attempts?: number;
  constructor(
    message: string,
    code: string = "AI_CALL_FAILED",
    meta?: { errorCategory?: AIErrorCategory; provider?: "openai" | "gemini"; attempts?: number },
  ) {
    super(message);
    this.name = "AICallError";
    this.code = code;
    this.errorCategory = meta?.errorCategory ?? classifyAIError({ message, code });
    this.provider = meta?.provider;
    this.attempts = meta?.attempts;
  }
}

export async function aiChat(options: AIChatOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (!options.max_tokens) {
    throw new AICallError("max_tokens is required for all AI calls", "MISSING_MAX_TOKENS");
  }

  const {
    accountId,
    campaignId: optCampaignId,
    operationType: optOperationType,
    sharedConsumerCampaignIds: optSharedConsumers,
    attributionPolicy: optAttributionPolicy,
    endpoint = "unknown",
    ...rest
  } = options;
  const ambientCtx = getCurrentAiCampaignContext();
  const resolvedCampaignId = optCampaignId || ambientCtx?.campaignId || null;
  const resolvedOperationType = optOperationType || ambientCtx?.operationType || endpoint;
  const resolvedSharedConsumers = optSharedConsumers || ambientCtx?.sharedConsumerCampaignIds || [];
  const resolvedAttributionPolicy = optAttributionPolicy || ambientCtx?.attributionPolicy || "ORIGINATING_CAMPAIGN_ONCE";

  // Task #89 / P4-A REPLAY-LLM-STRICT-INJECT
  const __mock = getActiveStrictLlmMock();
  if (__mock) {
    const payload = buildOpenAIPayload(rest);
    return __mock.resolve("openai", rest.model, payload) as OpenAI.Chat.Completions.ChatCompletion;
  }

  if (process.env.AVYRON_DEMO_MODE === "1") {
    throw new AICallError(
      `Live AI provider calls are disabled in AVYRON_DEMO_MODE (endpoint=${endpoint}, model=${rest.model})`,
      "DEMO_MODE_AI_BLOCKED",
    );
  }

  const budgetCheck = await checkAndReserveBudget(accountId, rest.max_tokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const logicalRequestId = `req_${++logicalRequestSeq}_${Date.now().toString(36)}`;
  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;
  let capturedInputTokens: number | null = null;
  let capturedOutputTokens: number | null = null;
  let capturedCachedTokens: number | null = null;
  let capturedReasoningTokens: number | null = null;
  let capturedCostUsd: number | null = null;
  let capturedProviderCallId: string | null = null;
  let capturedErrorMessage: string | null = null;
  let servedProvider: "openai" | "gemini" = "openai";
  let servedModel: string = rest.model;
  let finalCostStatus: CostStatus | "NOT_APPLICABLE" = "NOT_APPLICABLE";
  let finalErrorCategory: AIErrorCategory | undefined;
  let providerAttempts = 0;
  let outcomeKind: "success" | "timeout" | "failed" | null = null;
  const payload = buildOpenAIPayload(rest);

  const effectiveTimeoutMs = options.timeoutMs ?? HARD_TIMEOUT_MS;

  try {
    // Check OpenAI billing circuit breaker before firing a doomed network request
    const now = Date.now();
    const isOpenAICircuitBroken = now < openaiBillingExhaustedUntil;

    if (isOpenAICircuitBroken) {
      recordAiCallTelemetry({
        provider: "openai",
        model: rest.model,
        kind: "provider_attempt",
        outcome: "circuit_broken",
        costStatus: "NOT_APPLICABLE",
        errorCategory: "BILLING_EXHAUSTED",
      });
      throw new AICallError(
        openaiBillingExhaustedMessage || "OpenAI billing quota exhausted (circuit breaker open)",
        "BILLING_EXHAUSTED",
        { errorCategory: "BILLING_EXHAUSTED", provider: "openai", attempts: providerAttempts },
      );
    }

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new AICallError(`OpenAI call timed out after ${effectiveTimeoutMs}ms`, "AI_TIMEOUT"));
      }, effectiveTimeoutMs);
    });

    const attemptStart = Date.now();
    providerAttempts += 1;
    const openai = getOpenAI();
    let result: OpenAI.Chat.Completions.ChatCompletion;
    try {
      result = await Promise.race([
        openai.chat.completions.create(payload as any, { timeout: effectiveTimeoutMs }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const usage = extractOpenAIUsage(result);
    const cost = calculateCallCost(rest.model, usage);
    success = true;
    servedProvider = "openai";
    servedModel = rest.model;
    finalCostStatus = cost.costStatus;
    actualTokens = usage.totalTokens ?? 0;
    capturedInputTokens = usage.inputTokens;
    capturedOutputTokens = usage.outputTokens;
    capturedCachedTokens = usage.cachedInputTokens;
    capturedReasoningTokens = usage.reasoningTokens;
    capturedCostUsd = cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null;
    capturedProviderCallId = result.id || logicalRequestId;

    recordReplayLlmCall("openai", rest.model, payload, result);
    recordAiCost("openai", rest.model, cost.effectiveCostUsd);
    recordAiCallTelemetry({
      provider: "openai",
      model: rest.model,
      kind: "provider_attempt",
      outcome: "success",
      costStatus: cost.costStatus,
      inputTokens: usage.inputTokens ?? undefined,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens ?? undefined,
      reasoningTokens: usage.reasoningTokens,
    });
    logger.info({
      msg: "ai.openai.call",
      logicalRequestId,
      attemptNumber: providerAttempts,
      accountId,
      endpoint,
      model: rest.model,
      tokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      usageAvailable: usage.usageAvailable,
      costUsd: cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null,
      estimatedCostUsd: cost.estimatedCostUsd !== null ? Number(cost.estimatedCostUsd.toFixed(6)) : null,
      providerReportedCostUsd: cost.providerReportedCostUsd,
      costStatus: cost.costStatus,
      pricingVersion: cost.pricingVersion,
      finishReason: result.choices?.[0]?.finish_reason ?? null,
      durationMs: Date.now() - attemptStart,
    });
    return result;
  } catch (err: any) {
    const primaryCategory = classifyAIError(err);
    finalErrorCategory = primaryCategory;
    const isTimeout = primaryCategory === "TIMEOUT";
    const isBillingExhausted = primaryCategory === "BILLING_EXHAUSTED";
    const isQuotaOrRateLimit = isBillingExhausted || primaryCategory === "RATE_LIMITED";

    if (isBillingExhausted) {
      openaiBillingExhaustedUntil = Date.now() + CIRCUIT_BREAKER_TTL_MS;
      openaiBillingExhaustedMessage = String(err.message || "OpenAI billing exhausted");
    }

    if (providerAttempts > 0) {
      recordAiCallTelemetry({
        provider: "openai",
        model: rest.model,
        kind: "provider_attempt",
        outcome: isTimeout ? "timeout" : "failed",
        costStatus: "NOT_APPLICABLE",
        errorCategory: primaryCategory,
      });
      logger.warn({
        msg: "ai.openai.failed",
        logicalRequestId,
        attemptNumber: providerAttempts,
        accountId,
        endpoint,
        model: rest.model,
        errorCategory: primaryCategory,
        errorMessage: String(err?.message ?? err),
        durationMs: Date.now() - startTime,
      });
    }

    const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const isGeminiCircuitBroken = Date.now() < geminiQuotaExhaustedUntil;

    if (
      options.forceProvider !== "openai" &&
      (isQuotaOrRateLimit || isTimeout) &&
      geminiKey &&
      !isGeminiCircuitBroken
    ) {
      console.warn(
        `[aiChat] OpenAI ${isTimeout ? "timeout" : primaryCategory} hit ("${err.message}"). Attempting seamless Gemini fallback...`,
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
        const preferredGeminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
        const candidateGeminiModels = Array.from(
          new Set([preferredGeminiModel, ...GEMINI_FALLBACK_MODEL_CASCADE]),
        );
        // Thinking models share output budget with thoughtsTokenCount; allocate bounded headroom
        const baseMaxOutputTokens = Math.min(Math.max(rest.max_tokens * 2, 4096), 8192);

        let geminiRes: any = null;
        let lastGeminiErr: any = null;
        let geminiModel = preferredGeminiModel;
        let exhaustedModelsCount = 0;

        for (let attempt = 0; attempt < candidateGeminiModels.length; attempt++) {
          const candidateModel = candidateGeminiModels[attempt];
          const modelExhaustedUntil = geminiModelExhaustedUntil.get(candidateModel) ?? 0;
          if (Date.now() < modelExhaustedUntil) {
            exhaustedModelsCount += 1;
            continue;
          }
          geminiModel = candidateModel;
          const geminiAttemptStart = Date.now();
          providerAttempts += 1;
          const attemptMaxTokens = baseMaxOutputTokens;
          try {
            geminiRes = await gemini.models.generateContent({
              model: geminiModel,
              contents: fullContent,
              config: {
                maxOutputTokens: attemptMaxTokens,
                temperature: rest.temperature,
                ...(isJson ? { responseMimeType: "application/json" } : {}),
              },
            });
            const candidateFinishReason = String(
              geminiRes?.candidates?.[0]?.finishReason ?? "STOP",
            ).toUpperCase();
            const candidateText = geminiRes?.text || "";
            if (isJson && candidateText) {
              try {
                JSON.parse(candidateText);
              } catch (parseErr: any) {
                const truncErr = new AICallError(
                  `Gemini fallback returned truncated/invalid JSON (finishReason=${candidateFinishReason}): ${parseErr.message}`,
                  "MALFORMED_OUTPUT",
                  { errorCategory: "MALFORMED_OUTPUT", provider: "gemini", attempts: providerAttempts },
                );
                if (attempt < candidateGeminiModels.length - 1) {
                  lastGeminiErr = truncErr;
                  geminiRes = null;
                  continue;
                }
                throw truncErr;
              }
            }
            if (geminiRes?.text) break;
          } catch (mErr: any) {
            lastGeminiErr = mErr;
            const gCategory = classifyAIError(mErr);
            finalErrorCategory = gCategory;
            recordAiCallTelemetry({
              provider: "gemini",
              model: geminiModel,
              kind: "provider_attempt",
              outcome: gCategory === "TIMEOUT" ? "timeout" : "failed",
              costStatus: "NOT_APPLICABLE",
              errorCategory: gCategory,
            });
            logger.warn({
              msg: "ai.gemini.fallback.failed",
              logicalRequestId,
              attemptNumber: providerAttempts,
              geminiAttempt: attempt + 1,
              accountId,
              endpoint,
              model: geminiModel,
              errorCategory: gCategory,
              errorMessage: String(mErr?.message ?? mErr),
              durationMs: Date.now() - geminiAttemptStart,
            });

            const errStr = String(mErr?.message || "");
            const isDailyQuotaExhausted =
              /PerDay|GenerateRequestsPerDay|billing_hard_limit|no credits remaining/i.test(errStr);
            if (isDailyQuotaExhausted) {
              geminiModelExhaustedUntil.set(geminiModel, Date.now() + CIRCUIT_BREAKER_TTL_MS);
              exhaustedModelsCount += 1;
              if (exhaustedModelsCount >= candidateGeminiModels.length) {
                geminiQuotaExhaustedUntil = Date.now() + CIRCUIT_BREAKER_TTL_MS;
                geminiQuotaExhaustedMessage = errStr;
                break;
              }
              continue;
            }

            if (gCategory === "MALFORMED_OUTPUT") {
              break;
            }
            // For 429 rate-limit or 503 provider unavailable, cascade immediately to the next candidate Gemini model
            continue;
          }
        }

        if (!geminiRes) {
          throw (lastGeminiErr || new AICallError("Gemini fallback returned empty response", "PROVIDER_UNAVAILABLE"));
        }

        const text = geminiRes.text || "";
        const geminiFinishReason = String(
          geminiRes?.candidates?.[0]?.finishReason ?? "STOP",
        ).toUpperCase();
        const usage = extractGeminiUsage(geminiRes);
        const cost = calculateCallCost(geminiModel, usage);

        success = true;
        servedProvider = "gemini";
        servedModel = geminiModel;
        finalCostStatus = cost.costStatus;
        actualTokens = usage.totalTokens ?? 0;
        capturedInputTokens = usage.inputTokens;
        capturedOutputTokens = usage.outputTokens;
        capturedCachedTokens = usage.cachedInputTokens;
        capturedReasoningTokens = usage.reasoningTokens;
        capturedCostUsd = cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null;
        capturedProviderCallId = (geminiRes as any)?.responseId || `gemini-fallback-${logicalRequestId}`;

        recordReplayLlmCall("gemini", geminiModel, payload, geminiRes);
        recordAiCost("gemini", geminiModel, cost.effectiveCostUsd);
        recordAiCallTelemetry({
          provider: "gemini",
          model: geminiModel,
          kind: "provider_attempt",
          outcome: "success",
          costStatus: cost.costStatus,
          inputTokens: usage.inputTokens ?? undefined,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens ?? undefined,
          reasoningTokens: usage.reasoningTokens,
        });
        logger.info({
          msg: "ai.gemini.fallback.call",
          logicalRequestId,
          attemptNumber: providerAttempts,
          accountId,
          endpoint,
          requestedModel: rest.model,
          model: geminiModel,
          tokens: usage.totalTokens,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          usageAvailable: usage.usageAvailable,
          costUsd: cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null,
          estimatedCostUsd: cost.estimatedCostUsd !== null ? Number(cost.estimatedCostUsd.toFixed(6)) : null,
          providerReportedCostUsd: cost.providerReportedCostUsd,
          costStatus: cost.costStatus,
          pricingVersion: cost.pricingVersion,
          finishReason: geminiFinishReason,
          durationMs: Date.now() - startTime,
        });

        const mappedFinishReason =
          geminiFinishReason === "MAX_TOKENS" ? "length" : "stop";
        const fakeOpenAIResult: OpenAI.Chat.Completions.ChatCompletion = {
          id: `gemini-fallback-${Date.now()}`,
          choices: [
            {
              finish_reason: mappedFinishReason,
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
          usage: usage.usageAvailable
            ? {
                prompt_tokens: usage.inputTokens ?? 0,
                completion_tokens: (usage.outputTokens ?? 0) + usage.reasoningTokens,
                total_tokens: usage.totalTokens ?? 0,
                prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
                completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
              }
            : undefined,
        };
        return fakeOpenAIResult;
      } catch (geminiErr: any) {
        console.error(`[aiChat] Gemini fallback error: ${geminiErr.message}`);
        const gCat = classifyAIError(geminiErr);
        // Preserve BILLING_EXHAUSTED if OpenAI failed due to billing and Gemini fallback also failed due to rate limit/quota
        finalErrorCategory = isBillingExhausted ? "BILLING_EXHAUSTED" : gCat;
        if (geminiErr instanceof AICallError && gCat === "MALFORMED_OUTPUT") {
          throw geminiErr;
        }
      }
    }

    outcomeKind = isTimeout ? "timeout" : "failed";
    capturedErrorMessage = String(err?.message || "AI call failed");
    const resolvedCategory = finalErrorCategory ?? primaryCategory;
    if (err instanceof AICallError) {
      err.errorCategory = resolvedCategory;
      err.attempts = providerAttempts;
      throw err;
    }
    throw new AICallError(err.message || "AI call failed", resolvedCategory, {
      errorCategory: resolvedCategory,
      provider: servedProvider,
      attempts: providerAttempts,
    });
  } finally {
    const latencyMs = Date.now() - startTime;
    recordAiCallTelemetry({
      provider: servedProvider,
      model: servedModel,
      kind: "logical_request",
      outcome: success ? "success" : outcomeKind === "timeout" ? "timeout" : "failed",
      costStatus: success ? finalCostStatus : "NOT_APPLICABLE",
      errorCategory: success ? undefined : finalErrorCategory,
    });
    try {
      if (success) {
        recordAICallOutcome({ provider: servedProvider, outcome: "success", latencyMs });
      } else if (outcomeKind) {
        recordAICallOutcome({ provider: servedProvider, outcome: outcomeKind, latencyMs });
      }
    } catch (recordErr) {
      console.error("[OperationsGuardian] AI_OUTCOME_RECORD_FAILED", {
        provider: servedProvider,
        recordErr,
      });
    }
    await reconcileBudgetReservation({
      accountId,
      campaignId: resolvedCampaignId,
      operationType: resolvedOperationType,
      provider: servedProvider,
      endpoint,
      model: servedModel,
      maxTokens: rest.max_tokens,
      actualTokens: success ? actualTokens : 0,
      inputTokens: capturedInputTokens,
      outputTokens: capturedOutputTokens,
      cachedTokens: capturedCachedTokens,
      reasoningTokens: capturedReasoningTokens,
      costUsd: capturedCostUsd,
      costStatus: success ? finalCostStatus : "UNKNOWN",
      providerCallId: capturedProviderCallId || logicalRequestId,
      retryCount: Math.max(0, providerAttempts - 1),
      errorCategory: success ? null : (finalErrorCategory ?? null),
      errorMessage: success ? null : capturedErrorMessage,
      sharedConsumerCampaignIds: resolvedSharedConsumers,
      attributionPolicy: resolvedAttributionPolicy,
      success,
      durationMs: latencyMs,
    }).catch(() => {});
  }
}

export async function aiGemini(options: AIGeminiOptions) {
  const {
    accountId,
    campaignId: optCampaignId,
    operationType: optOperationType,
    sharedConsumerCampaignIds: optSharedConsumers,
    attributionPolicy: optAttributionPolicy,
    endpoint = "unknown",
    model,
    contents,
    config,
  } = options;
  const ambientCtx = getCurrentAiCampaignContext();
  const resolvedCampaignId = optCampaignId || ambientCtx?.campaignId || null;
  const resolvedOperationType = optOperationType || ambientCtx?.operationType || endpoint;
  const resolvedSharedConsumers = optSharedConsumers || ambientCtx?.sharedConsumerCampaignIds || [];
  const resolvedAttributionPolicy = optAttributionPolicy || ambientCtx?.attributionPolicy || "ORIGINATING_CAMPAIGN_ONCE";

  const maxTokens = config?.maxOutputTokens || DEFAULT_MAX_TOKENS;

  // Task #89 / P4-A REPLAY-LLM-STRICT-INJECT
  const __mock = getActiveStrictLlmMock();
  if (__mock) {
    return __mock.resolve("gemini", model, { model, contents, config });
  }

  if (process.env.AVYRON_DEMO_MODE === "1") {
    throw new AICallError(
      `Live Gemini provider calls are disabled in AVYRON_DEMO_MODE (endpoint=${endpoint}, model=${model})`,
      "DEMO_MODE_AI_BLOCKED",
    );
  }

  const budgetCheck = await checkAndReserveBudget(accountId, maxTokens);
  if (!budgetCheck.allowed) {
    throw new AICallError(`AI budget exceeded for account ${accountId}: ${budgetCheck.reason}`, "AI_BUDGET_EXCEEDED");
  }

  const logicalRequestId = `req_${++logicalRequestSeq}_${Date.now().toString(36)}`;
  const startTime = Date.now();
  let success = false;
  let actualTokens = 0;
  let capturedInputTokens: number | null = null;
  let capturedOutputTokens: number | null = null;
  let capturedCachedTokens: number | null = null;
  let capturedReasoningTokens: number | null = null;
  let capturedCostUsd: number | null = null;
  let capturedProviderCallId: string | null = null;
  let capturedErrorMessage: string | null = null;
  let finalCostStatus: CostStatus | "NOT_APPLICABLE" = "NOT_APPLICABLE";
  let finalErrorCategory: AIErrorCategory | undefined;
  let outcomeKind: "success" | "timeout" | "failed" | null = null;

  try {
    const gemini = getGemini();
    const GEMINI_HARD_TIMEOUT_MS = (() => {
      const raw = process.env.AI_GEMINI_HARD_TIMEOUT_MS;
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
    })();
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

    const usage = extractGeminiUsage(result);
    const cost = calculateCallCost(model, usage);
    success = true;
    finalCostStatus = cost.costStatus;
    actualTokens = usage.totalTokens ?? 0;
    capturedInputTokens = usage.inputTokens;
    capturedOutputTokens = usage.outputTokens;
    capturedCachedTokens = usage.cachedInputTokens;
    capturedReasoningTokens = usage.reasoningTokens;
    capturedCostUsd = cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null;
    capturedProviderCallId = (result as any)?.responseId || logicalRequestId;

    recordReplayLlmCall("gemini", model, { model, contents, config }, result);
    recordAiCost("gemini", model, cost.effectiveCostUsd);
    recordAiCallTelemetry({
      provider: "gemini",
      model,
      kind: "provider_attempt",
      outcome: "success",
      costStatus: cost.costStatus,
      inputTokens: usage.inputTokens ?? undefined,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens ?? undefined,
      reasoningTokens: usage.reasoningTokens,
    });
    logger.info({
      msg: "ai.gemini.call",
      logicalRequestId,
      attemptNumber: 1,
      accountId,
      endpoint,
      model,
      tokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      usageAvailable: usage.usageAvailable,
      costUsd: cost.effectiveCostUsd !== null ? Number(cost.effectiveCostUsd.toFixed(6)) : null,
      estimatedCostUsd: cost.estimatedCostUsd !== null ? Number(cost.estimatedCostUsd.toFixed(6)) : null,
      providerReportedCostUsd: cost.providerReportedCostUsd,
      costStatus: cost.costStatus,
      pricingVersion: cost.pricingVersion,
      finishReason: (result as any)?.candidates?.[0]?.finishReason ?? null,
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (err: any) {
    const errCategory = classifyAIError(err);
    finalErrorCategory = errCategory;
    capturedErrorMessage = String(err?.message ?? err);
    const isTimeout = errCategory === "TIMEOUT";
    outcomeKind = isTimeout ? "timeout" : "failed";
    recordAiCallTelemetry({
      provider: "gemini",
      model,
      kind: "provider_attempt",
      outcome: outcomeKind,
      costStatus: "NOT_APPLICABLE",
      errorCategory: errCategory,
    });
    logger.warn({
      msg: "ai.gemini.failed",
      logicalRequestId,
      attemptNumber: 1,
      accountId,
      endpoint,
      model,
      errorCategory: errCategory,
      errorMessage: String(err?.message ?? err),
      durationMs: Date.now() - startTime,
    });
    if (err instanceof AICallError) throw err;
    throw new AICallError(err.message || "Gemini call failed", errCategory, {
      errorCategory: errCategory,
      provider: "gemini",
      attempts: 1,
    });
  } finally {
    const latencyMs = Date.now() - startTime;
    recordAiCallTelemetry({
      provider: "gemini",
      model,
      kind: "logical_request",
      outcome: success ? "success" : outcomeKind === "timeout" ? "timeout" : "failed",
      costStatus: success ? finalCostStatus : "NOT_APPLICABLE",
      errorCategory: success ? undefined : finalErrorCategory,
    });
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
      campaignId: resolvedCampaignId,
      operationType: resolvedOperationType,
      provider: "gemini",
      endpoint,
      model,
      maxTokens,
      actualTokens: success ? actualTokens : 0,
      inputTokens: capturedInputTokens,
      outputTokens: capturedOutputTokens,
      cachedTokens: capturedCachedTokens,
      reasoningTokens: capturedReasoningTokens,
      costUsd: capturedCostUsd,
      costStatus: success ? finalCostStatus : "UNKNOWN",
      providerCallId: capturedProviderCallId || logicalRequestId,
      retryCount: 0,
      errorCategory: success ? null : (finalErrorCategory ?? null),
      errorMessage: success ? null : capturedErrorMessage,
      sharedConsumerCampaignIds: resolvedSharedConsumers,
      attributionPolicy: resolvedAttributionPolicy,
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

export interface ReconcileEntry {
  accountId: string;
  campaignId?: string | null;
  operationType?: string | null;
  provider?: string | null;
  endpoint: string;
  model: string;
  maxTokens: number;
  actualTokens: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  costUsd?: number | null;
  costStatus?: string | null;
  providerCallId?: string | null;
  retryCount?: number;
  errorCategory?: string | null;
  errorMessage?: string | null;
  sharedConsumerCampaignIds?: string[];
  attributionPolicy?: string;
  success: boolean;
  durationMs: number;
}

export async function reconcileBudgetReservation(entry: ReconcileEntry): Promise<void> {
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
    const sharedConsumersJson = JSON.stringify(entry.sharedConsumerCampaignIds || []);
    const costStatusVal = entry.costStatus || (entry.costUsd !== null && entry.costUsd !== undefined ? "CALCULATED" : "UNKNOWN");
    await db.execute(sql`
      INSERT INTO ai_usage_log (
        account_id,
        campaign_id,
        operation_type,
        provider,
        endpoint,
        model,
        max_tokens,
        estimated_tokens,
        input_tokens,
        output_tokens,
        cached_tokens,
        reasoning_tokens,
        cost_usd,
        cost_status,
        provider_call_id,
        retry_count,
        error_category,
        error_message,
        shared_consumer_campaign_ids,
        attribution_policy,
        success,
        duration_ms,
        created_at
      )
      VALUES (
        ${entry.accountId},
        ${entry.campaignId ?? null},
        ${entry.operationType ?? entry.endpoint},
        ${entry.provider ?? null},
        ${entry.endpoint},
        ${entry.model},
        ${entry.maxTokens},
        ${entry.actualTokens},
        ${entry.inputTokens ?? null},
        ${entry.outputTokens ?? null},
        ${entry.cachedTokens ?? null},
        ${entry.reasoningTokens ?? null},
        ${entry.costUsd ?? null},
        ${costStatusVal},
        ${entry.providerCallId ?? null},
        ${entry.retryCount ?? 0},
        ${entry.errorCategory ?? null},
        ${entry.errorMessage ?? null},
        ${sharedConsumersJson}::jsonb,
        ${entry.attributionPolicy ?? "ORIGINATING_CAMPAIGN_ONCE"},
        ${entry.success},
        ${entry.durationMs},
        NOW()
      )
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
  isTestClientInjected = true;
  __resetProviderCircuitBreakerForTests();
  // Sync the cached api-key to whatever the current env says so
  // `getOpenAI()`'s `currentKey !== openaiApiKey` cache-bust check does
  // NOT replace our stub with a real client on the next call.
  openaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
}

export function __resetOpenAIClientForTests(): void {
  openaiInstance = null;
  openaiApiKey = undefined;
  isTestClientInjected = false;
  __resetProviderCircuitBreakerForTests();
}

export function __setGeminiClientForTests(client: GoogleGenAI): void {
  geminiInstance = client;
  isTestClientInjected = true;
  __resetProviderCircuitBreakerForTests();
  geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
}

export function __resetGeminiClientForTests(): void {
  geminiInstance = null;
  geminiApiKey = undefined;
  isTestClientInjected = false;
  __resetProviderCircuitBreakerForTests();
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
