export const ENGINE_VERSION = 1;
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const MIN_VALIDATION_CONFIDENCE_FOR_SCALE = 0.65;
export const MIN_OFFER_PROOF_FOR_SCALE = 0.6;
export const MIN_FUNNEL_STRENGTH_FOR_SCALE = 0.55;

export const CAC_DEVIATION_THRESHOLD = 0.4;
export const MAX_RISK_FOR_EXPANSION = 0.6;

export const TEST_BUDGET_FLOOR = 50;
export const TEST_BUDGET_CEILING = 500;
export const SCALE_BUDGET_FLOOR = 500;
export const SCALE_BUDGET_CEILING = 10000;

export const KILL_THRESHOLDS = {
  minOfferStrength: 0.2,
  minValidationConfidence: 0.15,
  maxRisk: 0.9,
};

export const RISK_WEIGHTS = {
  validationConfidence: 0.25,
  offerStrength: 0.20,
  funnelStrength: 0.15,
  channelRisk: 0.15,
  cacRealism: 0.15,
  marketIntensity: 0.10,
};

export const STATUS = {
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  HALTED: "HALTED",
};
