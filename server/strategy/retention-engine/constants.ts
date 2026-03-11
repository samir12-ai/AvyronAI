export const ENGINE_VERSION = 1;
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const RETENTION_SCORE_WEIGHTS = {
  valueDeliveryClarity: 0.25,
  postPurchaseTrust: 0.20,
  retentionMechanismStrength: 0.20,
  churnRiskMitigation: 0.15,
  ltvExpansionViability: 0.10,
  upsellReadiness: 0.10,
};

export const CHURN_SEVERITY_THRESHOLDS = {
  critical: 0.8,
  high: 0.6,
  moderate: 0.4,
  low: 0.2,
};

export const GUARD_THRESHOLDS = {
  minValueDeliveryClarity: 0.4,
  maxTrustDecayRisk: 0.7,
  minRetentionMechanismPresence: 0.3,
};

export const STATUS = {
  COMPLETE: "COMPLETE",
  PROVISIONAL: "PROVISIONAL",
  GUARD_BLOCKED: "GUARD_BLOCKED",
  ERROR: "ERROR",
};

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  advertising: /\b(ad strategy|ad campaign|media buy|ad spend|ad creative|retargeting)\b/i,
  channel: /\b(channel selection|channel strategy|posting schedule|content calendar)\b/i,
  budget: /\b(budget recommendation|budget allocation|spending plan)\b/i,
  "financial guarantees": /\b(guarantee.*return|guaranteed roi|guaranteed income|double your money)\b/i,
};

export const RETENTION_LOOP_TYPES = [
  "engagement_loop",
  "value_reinforcement",
  "community_loop",
  "habit_loop",
  "reward_loop",
  "milestone_loop",
  "feedback_loop",
  "referral_loop",
] as const;

export type RetentionLoopType = typeof RETENTION_LOOP_TYPES[number];
