export const ENGINE_VERSION = 1;
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const OFFER_DEPTH_WEIGHTS = {
  outcomeClarity: 0.18,
  mechanismCredibility: 0.15,
  proofStrength: 0.15,
  differentiationSupport: 0.12,
  marketDemandAlignment: 0.12,
  audienceTrustCompatibility: 0.10,
  executionFeasibility: 0.10,
  buyerFrictionLevel: 0.08,
};

export const GENERIC_OFFER_PATTERNS = [
  /\b(grow your business)\b/i,
  /\b(scale faster)\b/i,
  /\b(get more leads)\b/i,
  /\b(improve marketing)\b/i,
  /\b(increase revenue)\b/i,
  /\b(boost sales)\b/i,
  /\b(grow your brand)\b/i,
  /\b(maximize roi)\b/i,
  /\b(transform your business)\b/i,
  /\b(take .* to the next level)\b/i,
  /\b(unlock .* potential)\b/i,
  /\b(supercharge your)\b/i,
  /\b(dominate your market)\b/i,
  /\b(crush the competition)\b/i,
  /\b(10x your)\b/i,
];

export const GENERIC_PENALTY = 0.35;

export const BOUNDARY_BLOCKED_PATTERNS = {
  funnel: /\b(funnel architecture|funnel stage|funnel step|funnel design|landing page sequence|opt.in page)\b/i,
  advertising: /\b(ad strategy|ad campaign|media buy|ad spend|ad creative|retargeting|lookalike audience)\b/i,
  channel: /\b(channel selection|channel strategy|instagram strategy|facebook strategy|tiktok strategy|linkedin strategy|youtube strategy|content calendar|posting schedule)\b/i,
  media: /\b(media planning|media mix|placement strategy|impressions target)\b/i,
  budget: /\b(budget recommendation|budget allocation|spending plan|cost per acquisition)\b/i,
  execution: /\b(campaign execution|launch sequence|deployment plan|publish schedule|send email|activate sequence)\b/i,
  sales: /\b(sales script|persuasion framework|closing technique|objection handling script|cold call)\b/i,
  financial: /\b(financial model|pricing calculation|revenue projection|profit margin|break.even)\b/i,
  strategy: /\b(strategic master plan|strategic plan|execution plan|growth strategy|go.to.market strategy)\b/i,
};

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  funnel: /\b(funnel architecture|funnel stage|funnel step|funnel design|landing page sequence|opt.in page)\b/i,
  advertising: /\b(ad strategy|ad campaign|media buy|ad spend|ad creative|retargeting|lookalike audience)\b/i,
  channel: /\b(channel selection|channel strategy|instagram strategy|facebook strategy|tiktok strategy|linkedin strategy|youtube strategy|content calendar|posting schedule)\b/i,
  media: /\b(media planning|media mix|placement strategy|impressions target)\b/i,
  budget: /\b(budget recommendation|budget allocation|spending plan|cost per acquisition)\b/i,
  execution: /\b(campaign execution|launch sequence|deployment plan|publish schedule|send email|activate sequence)\b/i,
  sales: /\b(sales script|persuasion framework|closing technique|objection handling script|cold call)\b/i,
  "financial guarantees": /\b(increase your net worth|guarantee.*return|guaranteed roi|guaranteed income|earn \d+%|make \$\d|double your money|triple your income|financial freedom guaranteed)\b/i,
  "investment promises": /\b(investment return|roi guarantee|return on investment guarantee|\d+x your money|\d+% return|passive income guarantee)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS = [
  { pattern: /\brevenue projection\b/gi, domain: "financial", replacement: "outcome improvement" },
  { pattern: /\bgrowth strategy\b/gi, domain: "strategy", replacement: "strategic direction" },
  { pattern: /\bprofit margin\b/gi, domain: "financial", replacement: "value delivery" },
  { pattern: /\bstrategic plan\b/gi, domain: "strategy", replacement: "strategic framework" },
  { pattern: /\bfinancial model\b/gi, domain: "financial", replacement: "value model" },
  { pattern: /\bpricing calculation\b/gi, domain: "financial", replacement: "value assessment" },
  { pattern: /\bbreak.even\b/gi, domain: "financial", replacement: "value threshold" },
  { pattern: /\bstrategic master plan\b/gi, domain: "strategy", replacement: "strategic framework" },
  { pattern: /\bexecution plan\b/gi, domain: "strategy", replacement: "implementation framework" },
  { pattern: /\bgo.to.market strategy\b/gi, domain: "strategy", replacement: "market approach" },
];

export const MIN_PROOF_STRENGTH = 0.30;
export const MIN_OUTCOME_SPECIFICITY = 0.40;
export const MAX_DELIVERABLES = 8;
export const FRICTION_THRESHOLD = 0.65;

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INSUFFICIENT_SIGNALS: "INSUFFICIENT_SIGNALS",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;
