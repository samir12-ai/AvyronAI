export const SGL_VERSION = 1;

export const MIN_SIGNALS_PER_CATEGORY: Record<string, number> = {
  pain: 2,
  desire: 2,
  objection: 1,
  pattern: 1,
  root_cause: 1,
  psychological_driver: 1,
};

export const MIN_TOTAL_SIGNALS = 5;

export const SIGNAL_CONFIDENCE_FLOOR = 0.20;

export const LEAKAGE_PATTERNS = [
  /^https?:\/\//i,
  /\b(raw|unprocessed|todo|fixme|hack)\b/i,
  /^\s*\/\//,
  /^\s*#/,
  /\{\{.*\}\}/,
  /\$\{.*\}/,
  /<script/i,
  /password|api_key|secret/i,
];
