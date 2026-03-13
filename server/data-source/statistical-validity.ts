export interface StatisticalValidityResult {
  isStatisticallyValid: boolean;
  sampleSizeAdequate: boolean;
  spendAdequate: boolean;
  conversions: number;
  spend: number;
  minimumConversions: number;
  minimumSpend: number;
  confidenceLevel: number;
  validityScore: number;
  reasons: string[];
}

export interface TransitionEligibility {
  eligible: boolean;
  currentMode: "benchmark" | "campaign_metrics";
  recommendedMode: "benchmark" | "campaign_metrics";
  transitionReason: string | null;
  statisticalEvidence: StatisticalValidityResult;
  blockReasons: string[];
}

const MIN_CONVERSIONS_FOR_TRANSITION = 50;
const MIN_SPEND_FOR_TRANSITION = 1000;

const MIN_CONVERSIONS_FOR_SCALING = 30;
const MIN_SPEND_FOR_SCALING = 500;

export function assessStatisticalValidity(
  conversions: number,
  spend: number,
  revenue: number = 0,
): StatisticalValidityResult {
  const reasons: string[] = [];

  const sampleSizeAdequate = conversions >= MIN_CONVERSIONS_FOR_SCALING;
  const spendAdequate = spend >= MIN_SPEND_FOR_SCALING;

  if (!sampleSizeAdequate) {
    reasons.push(`Conversions (${conversions}) below minimum threshold of ${MIN_CONVERSIONS_FOR_SCALING} — sample size insufficient for reliable analysis`);
  }
  if (!spendAdequate) {
    reasons.push(`Spend ($${spend.toFixed(2)}) below minimum threshold of $${MIN_SPEND_FOR_SCALING} — spend volume insufficient for statistical reliability`);
  }

  const isStatisticallyValid = sampleSizeAdequate && spendAdequate;

  let confidenceLevel = 0.3;
  if (isStatisticallyValid) {
    const conversionFactor = Math.min(conversions / 100, 1.0);
    const spendFactor = Math.min(spend / 2000, 1.0);
    const revenueFactor = revenue > 0 ? 0.1 : 0;
    confidenceLevel = 0.5 + conversionFactor * 0.25 + spendFactor * 0.15 + revenueFactor;
    confidenceLevel = Math.min(confidenceLevel, 0.95);
  } else {
    const partialConv = Math.min(conversions / MIN_CONVERSIONS_FOR_SCALING, 1.0);
    const partialSpend = Math.min(spend / MIN_SPEND_FOR_SCALING, 1.0);
    confidenceLevel = 0.2 + (partialConv + partialSpend) * 0.15;
    confidenceLevel = Math.min(confidenceLevel, 0.49);
  }

  const validityScore = isStatisticallyValid ? confidenceLevel : confidenceLevel * 0.7;

  if (isStatisticallyValid) {
    reasons.push(`Statistical validity confirmed: ${conversions} conversions, $${spend.toFixed(2)} spend`);
  }

  return {
    isStatisticallyValid,
    sampleSizeAdequate,
    spendAdequate,
    conversions,
    spend,
    minimumConversions: MIN_CONVERSIONS_FOR_SCALING,
    minimumSpend: MIN_SPEND_FOR_SCALING,
    confidenceLevel,
    validityScore,
    reasons,
  };
}

export function evaluateTransitionEligibility(
  currentMode: "benchmark" | "campaign_metrics",
  conversions: number,
  spend: number,
  revenue: number = 0,
): TransitionEligibility {
  const statisticalEvidence = assessStatisticalValidity(conversions, spend, revenue);
  const blockReasons: string[] = [];

  const meetsConversionThreshold = conversions >= MIN_CONVERSIONS_FOR_TRANSITION;
  const meetsSpendThreshold = spend >= MIN_SPEND_FOR_TRANSITION;
  const meetsTransitionCriteria = meetsConversionThreshold || meetsSpendThreshold;

  if (currentMode === "benchmark") {
    if (!meetsTransitionCriteria) {
      if (!meetsConversionThreshold) {
        blockReasons.push(`Conversions (${conversions}) below transition threshold of ${MIN_CONVERSIONS_FOR_TRANSITION}`);
      }
      if (!meetsSpendThreshold) {
        blockReasons.push(`Spend ($${spend.toFixed(2)}) below transition threshold of $${MIN_SPEND_FOR_TRANSITION}`);
      }

      return {
        eligible: false,
        currentMode,
        recommendedMode: "benchmark",
        transitionReason: null,
        statisticalEvidence,
        blockReasons,
      };
    }

    let transitionReason = "Campaign data meets statistical thresholds for mode escalation: ";
    const parts: string[] = [];
    if (meetsConversionThreshold) parts.push(`conversions (${conversions}) ≥ ${MIN_CONVERSIONS_FOR_TRANSITION}`);
    if (meetsSpendThreshold) parts.push(`spend ($${spend.toFixed(2)}) ≥ $${MIN_SPEND_FOR_TRANSITION}`);
    transitionReason += parts.join(" AND ");

    return {
      eligible: true,
      currentMode,
      recommendedMode: "campaign_metrics",
      transitionReason,
      statisticalEvidence,
      blockReasons: [],
    };
  }

  if (currentMode === "campaign_metrics") {
    if (!statisticalEvidence.isStatisticallyValid) {
      return {
        eligible: true,
        currentMode,
        recommendedMode: "benchmark",
        transitionReason: `Campaign data no longer meets statistical validity — ${statisticalEvidence.reasons.filter(r => r.includes("below")).join("; ")}`,
        statisticalEvidence,
        blockReasons: [],
      };
    }

    return {
      eligible: false,
      currentMode,
      recommendedMode: "campaign_metrics",
      transitionReason: null,
      statisticalEvidence,
      blockReasons: [],
    };
  }

  return {
    eligible: false,
    currentMode,
    recommendedMode: currentMode,
    transitionReason: null,
    statisticalEvidence,
    blockReasons: ["Unknown mode state"],
  };
}

export function shouldBlockScaling(
  conversions: number,
  spend: number,
): { blocked: boolean; reason: string | null } {
  if (conversions < MIN_CONVERSIONS_FOR_SCALING) {
    return {
      blocked: true,
      reason: `Statistical Validity Layer: conversions (${conversions}) below minimum ${MIN_CONVERSIONS_FOR_SCALING} — scaling blocked until sample size is adequate`,
    };
  }
  if (spend < MIN_SPEND_FOR_SCALING) {
    return {
      blocked: true,
      reason: `Statistical Validity Layer: spend ($${spend.toFixed(2)}) below minimum $${MIN_SPEND_FOR_SCALING} — scaling blocked until spend volume is adequate`,
    };
  }
  return { blocked: false, reason: null };
}

export const TRANSITION_THRESHOLDS = {
  MIN_CONVERSIONS_FOR_TRANSITION,
  MIN_SPEND_FOR_TRANSITION,
  MIN_CONVERSIONS_FOR_SCALING,
  MIN_SPEND_FOR_SCALING,
} as const;
