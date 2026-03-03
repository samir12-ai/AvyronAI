/**
 * ENGINE_VERSION — Bump Policy
 *
 * INCREMENT when:
 *   - Output schema changes (new/removed fields in snapshot payload)
 *   - Confidence rules change (guard decision logic, thresholds)
 *   - Guard logic changes (validateSnapshotCompleteness contract)
 *   - Trajectory / dominance computation logic changes
 *   - Snapshot completeness contract changes
 *
 * DO NOT increment for:
 *   - Logging changes (new log lines, log format)
 *   - UI/frontend changes
 *   - Refactors with identical output (rename, restructure)
 *   - Test additions
 *
 * All snapshots with analysisVersion !== ENGINE_VERSION are cache-rejected
 * and recomputed on next access. Unnecessary bumps cause recompute storms.
 */
export const ENGINE_VERSION = 8;

export const MI_THRESHOLDS = {
  MIN_POSTS_PER_COMPETITOR: 30,
  MIN_COMMENTS_SAMPLE: 100,
  MIN_ENGAGEMENT_POSTS: 15,
  MIN_POSTING_FREQUENCY_WEEKS: 4,
  MIN_COMPETITORS: 3,
  MIN_FULL_THRESHOLD_COMPETITORS: 2,
} as const;

export const MI_COST_LIMITS = {
  MAX_COMPETITORS: 5,
  MAX_POSTS_PER_COMPETITOR: 40,
  MAX_COMMENTS_PER_COMPETITOR: 150,
  MAX_TOTAL_COMMENTS: 500,
} as const;

export const MI_TOKEN_BUDGET = {
  FULL_MODE_CEILING: 25000,
  REDUCED_MODE_CEILING: 15000,
  LIGHT_MODE_CEILING: 0,
  TOKENS_PER_POST: 50,
  TOKENS_PER_COMMENT: 20,
  BASE_PROMPT_TOKENS: 1500,
  NARRATIVE_TOKENS: 2000,
} as const;

export const MI_CONFIDENCE = {
  STRONG_THRESHOLD: 0.80,
  MODERATE_THRESHOLD: 0.65,
  LOW_THRESHOLD: 0.50,
  UNSTABLE_THRESHOLD: 0.40,
  PROXY_RELIABILITY: 0.75,
  BLOCK_THRESHOLD: 0.40,
  NO_AGGRESSIVE_THRESHOLD: 0.50,
  STRONG_RECOMMENDATION_COVERAGE: 0.75,
  STRONG_RECOMMENDATION_RELIABILITY: 0.70,
  DOWNGRADE_COVERAGE: 0.65,
  DOWNGRADE_DOMINANT_SOURCE: 0.60,
  BLOCK_COVERAGE: 0.45,
  BLOCK_RELIABILITY: 0.50,
} as const;

export const MI_REFRESH = {
  HIGH_VOLATILITY_DAYS: 3,
  MODERATE_VOLATILITY_DAYS: 7,
  STABLE_VOLATILITY_DAYS: 14,
  HARD_CAP_HOURS: 72,
  CTA_SHIFT_TRIGGER: 0.20,
  REVIEW_VELOCITY_TRIGGER: 0.15,
  HIGH_VOLATILITY_THRESHOLD: 0.70,
  MODERATE_VOLATILITY_THRESHOLD: 0.40,
} as const;

export const MI_REVIVAL_CAP = 0.7;

export const MI_INTENT_WEIGHTS = {
  DEFENSIVE: {
    postingFrequencyTrend: -0.3,
    engagementVolatility: 0.2,
    ctaIntensityShift: 0.1,
    offerLanguageChange: 0.1,
    hashtagDriftScore: -0.1,
    bioModificationFrequency: 0.1,
    sentimentDrift: -0.1,
    reviewVelocityChange: 0.0,
    contentExperimentRate: -0.1,
  },
  AGGRESSIVE_SCALING: {
    postingFrequencyTrend: 0.3,
    engagementVolatility: 0.1,
    ctaIntensityShift: 0.2,
    offerLanguageChange: 0.15,
    hashtagDriftScore: 0.1,
    bioModificationFrequency: 0.05,
    sentimentDrift: 0.0,
    reviewVelocityChange: 0.05,
    contentExperimentRate: 0.05,
  },
  TESTING: {
    postingFrequencyTrend: 0.0,
    engagementVolatility: 0.3,
    ctaIntensityShift: 0.1,
    offerLanguageChange: 0.1,
    hashtagDriftScore: 0.2,
    bioModificationFrequency: 0.05,
    sentimentDrift: 0.0,
    reviewVelocityChange: 0.0,
    contentExperimentRate: 0.25,
  },
  POSITIONING_SHIFT: {
    postingFrequencyTrend: 0.0,
    engagementVolatility: 0.1,
    ctaIntensityShift: 0.1,
    offerLanguageChange: 0.15,
    hashtagDriftScore: 0.25,
    bioModificationFrequency: 0.2,
    sentimentDrift: 0.1,
    reviewVelocityChange: 0.0,
    contentExperimentRate: 0.1,
  },
  PRICE_WAR: {
    postingFrequencyTrend: 0.05,
    engagementVolatility: 0.05,
    ctaIntensityShift: 0.15,
    offerLanguageChange: 0.35,
    hashtagDriftScore: 0.0,
    bioModificationFrequency: 0.1,
    sentimentDrift: 0.1,
    reviewVelocityChange: 0.1,
    contentExperimentRate: 0.1,
  },
  DECLINING: {
    postingFrequencyTrend: -0.35,
    engagementVolatility: -0.15,
    ctaIntensityShift: -0.1,
    offerLanguageChange: -0.1,
    hashtagDriftScore: -0.1,
    bioModificationFrequency: -0.1,
    sentimentDrift: -0.05,
    reviewVelocityChange: -0.05,
    contentExperimentRate: 0.0,
  },
  STABLE_DOMINANT: {
    postingFrequencyTrend: 0.1,
    engagementVolatility: -0.2,
    ctaIntensityShift: 0.05,
    offerLanguageChange: 0.05,
    hashtagDriftScore: -0.1,
    bioModificationFrequency: -0.1,
    sentimentDrift: 0.1,
    reviewVelocityChange: 0.1,
    contentExperimentRate: -0.1,
  },
} as const;
