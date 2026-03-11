export const ENGINE_VERSION = 1;
export const ENGINE_NAME = "iteration-engine";
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const MIN_PERFORMANCE_DATA_POINTS = 3;
export const MIN_CREATIVE_COUNT = 2;
export const MIN_FUNNEL_STAGES = 2;

export const CTR_FLOOR = 0.005;
export const CPA_CEILING_MULTIPLIER = 2.0;
export const ROAS_FLOOR = 0.8;
export const CONVERSION_RATE_FLOOR = 0.01;

export const MAX_CONCURRENT_TESTS = 3;
export const MIN_TEST_DURATION_DAYS = 3;
export const MAX_TEST_DURATION_DAYS = 14;

export const OPTIMIZATION_CONFIDENCE_THRESHOLD = 0.5;
export const SCALING_CONFIDENCE_THRESHOLD = 0.7;

export const STATUS = {
  COMPLETE: "COMPLETE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  GUARD_BLOCKED: "GUARD_BLOCKED",
  PROVISIONAL: "PROVISIONAL",
} as const;

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  "financial guarantees": /\b(guarantee.*return|guaranteed roi|guaranteed income|earn \d+%|make \$\d|double your money)\b/i,
  "investment promises": /\b(investment return|roi guarantee|\d+x your money|\d+% return|passive income guarantee)\b/i,
  "unrealistic scaling": /\b(infinite scale|unlimited growth|zero risk scaling|guaranteed \d+x)\b/i,
};

export const FAILED_TEST_REPEAT_WINDOW_DAYS = 30;
