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
export const ENGINE_VERSION = 18;

export const COMMENT_TEXT_OPTIONAL = true;

export const BASELINE_POSTS_PER_COMPETITOR = 12;

export const INSTAGRAM_API_CEILING = BASELINE_POSTS_PER_COMPETITOR;

export const MI_THRESHOLDS = {
  MIN_POSTS_PER_COMPETITOR: BASELINE_POSTS_PER_COMPETITOR,
  MIN_POSTS_API_CEILING: BASELINE_POSTS_PER_COMPETITOR,
  MIN_COMMENTS_SAMPLE: 50,
  MIN_ENGAGEMENT_POSTS: 12,
  MIN_POSTING_FREQUENCY_WEEKS: 4,
  MIN_COMPETITORS: 3,
  MIN_FULL_THRESHOLD_COMPETITORS: 2,
} as const;

export const MI_COST_LIMITS = {
  MAX_COMPETITORS: 12,
  MAX_POSTS_PER_COMPETITOR: BASELINE_POSTS_PER_COMPETITOR,
  MAX_COMMENTS_PER_COMPETITOR: 50,
  MAX_TOTAL_COMMENTS: 600,
} as const;

export const MI_TOKEN_BUDGET = {
  FULL_MODE_CEILING: 60000,
  REDUCED_MODE_CEILING: 35000,
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
  FRESHNESS_HARD_GATE_DAYS: 14,
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

export const MI_COMPETITION_INTENSITY = {
  HIGH_DENSITY_COMPETITOR_THRESHOLD: 5,
  MODERATE_DENSITY_COMPETITOR_THRESHOLD: 3,
  HIGH_CONTENT_VOLUME_PER_COMPETITOR: 10,
  ENGAGEMENT_DENSITY_FLOOR: 0.15,
  POSTING_BASELINE_FLOOR: 0.10,
} as const;

export const MI_AUTHORITY_WEIGHT = {
  ENGAGEMENT_COMPONENT: 0.35,
  SAMPLE_SIZE_COMPONENT: 0.30,
  FREQUENCY_COMPONENT: 0.20,
  COVERAGE_COMPONENT: 0.15,
  SMALL_TIER_CEILING: 0.33,
  MID_TIER_CEILING: 0.66,
} as const;

export const MI_SAMPLE_BIAS = {
  MIN_COMPETITORS_FOR_COVERAGE: 3,
  SKEW_THRESHOLD: 0.60,
  LOW_SIGNAL_DENSITY_THRESHOLD: 0.40,
} as const;

export const MI_REAL_DATA_RATIO = {
  MIN_REAL_RATIO: 0.60,
  CONFIDENCE_PENALTY_FACTOR: 0.20,
} as const;

export const MI_LIFECYCLE = {
  DORMANT_FREQUENCY_THRESHOLD: -0.25,
  DORMANT_COVERAGE_THRESHOLD: 0.35,
  LOW_SIGNAL_SAMPLE_THRESHOLD: 10,
  DORMANT_ACTIVITY_WEIGHT: 0.3,
  LOW_SIGNAL_ACTIVITY_WEIGHT: 0.5,
  LOW_SAMPLE_WEIGHT_FACTOR: 0.5,
  LOW_SAMPLE_ACTIVITY_WEIGHT: 0.4,
} as const;

export const MI_NARRATIVE_CLUSTERING = {
  TOKEN_OVERLAP_THRESHOLD: 0.40,
  MIN_TOKEN_LENGTH: 2,
  ECHO_CHAMBER_CONVERGENCE_THRESHOLD: 0.65,
  ECHO_CHAMBER_DIVERSITY_FLOOR: 0.30,
  ECHO_CHAMBER_PENALTY_MAX: 0.35,
} as const;

export const MI_DEMAND_PRESSURE = {
  HIGH_THRESHOLD: 0.55,
  MODERATE_THRESHOLD: 0.30,
  COMMENT_INTENSITY_NORMALIZATION: 100,
  INTENT_SIGNAL_NORMALIZATION: 5,
  PURCHASE_INTENT_AMPLIFIER: 3.0,
  OBJECTION_AMPLIFIER: 2.5,
  WEIGHT_ENGAGEMENT: 0.25,
  WEIGHT_COMMENT_INTENSITY: 0.20,
  WEIGHT_INTENT_SIGNAL: 0.20,
  WEIGHT_OBJECTION: 0.15,
  WEIGHT_PURCHASE_INTENT: 0.20,
  SUPPRESSED_DEMAND_ACTIVITY_CEILING: 0.30,
  SUPPRESSED_DEMAND_PRESSURE_FLOOR: 0.50,
} as const;

export const GOAL_MODE_WEIGHTS = {
  REACH_MODE: {
    engagement: 0.35,
    frequency: 0.25,
    cta: 0.10,
    innovation: 0.10,
    sentiment: 0.15,
    coverage: 0.05,
  },
  STRATEGY_MODE: {
    engagement: 0.15,
    frequency: 0.15,
    cta: 0.20,
    innovation: 0.20,
    sentiment: 0.15,
    coverage: 0.15,
  },
} as const;

export const ENGAGEMENT_BIAS_THRESHOLD = 0.50;

export const SIMILARITY_MIN_EVIDENCE_THRESHOLD = 6;

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
