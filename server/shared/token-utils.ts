export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4.1-mini": 1_000_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1": 128_000,
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8192,
  "default": 16384,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TokenBudgetConfig {
  model: string;
  reservedOutputTokens: number;
  promptOverheadTokens: number;
  safetyMarginTokens?: number;
}

export function calculateSafeEvidenceBudget(configs: TokenBudgetConfig[]): number {
  if (configs.length === 0) return 0;
  
  let minSafeBudget = Infinity;

  for (const config of configs) {
    const limit = MODEL_CONTEXT_LIMITS[config.model] || MODEL_CONTEXT_LIMITS.default;
    const safety = config.safetyMarginTokens ?? 2000;
    const safeBudget = limit - config.promptOverheadTokens - config.reservedOutputTokens - safety;
    
    if (safeBudget < minSafeBudget) {
      minSafeBudget = safeBudget;
    }
  }

  return minSafeBudget;
}
