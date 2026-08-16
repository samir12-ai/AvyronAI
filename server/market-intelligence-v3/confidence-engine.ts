import type { CompetitorSignalResult, ConfidenceFactors, ConfidenceLevel, ConfidenceResult, GuardDecision, SignalStabilityGuard } from "./types";
import { MI_CONFIDENCE, MI_THRESHOLDS, MI_REAL_DATA_RATIO } from "./constants";

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

export function computeDataCompleteness(signalResults: CompetitorSignalResult[]): number {
  if (signalResults.length === 0) return 0;
  const coverages = signalResults.map(r => r.signalCoverageScore);
  const avgCoverage = mean(coverages);
  const competitorRatio = Math.min(1, signalResults.length / MI_THRESHOLDS.MIN_COMPETITORS);
  return Math.round((avgCoverage * 0.6 + competitorRatio * 0.4) * 100) / 100;
}

export function computeFreshnessDecay(dataAgeDays: number): number {
  if (dataAgeDays <= 1) return 1.0;
  if (dataAgeDays <= 3) return 0.95;
  if (dataAgeDays <= 7) return 0.85;
  if (dataAgeDays <= 14) return 0.70;
  if (dataAgeDays <= 30) return 0.50;
  return Math.max(0.1, 1 - (dataAgeDays / 90));
}

export function computeSampleStrength(signalResults: CompetitorSignalResult[]): number {
  if (signalResults.length === 0) return 0;
  const totalSamples = signalResults.reduce((s, r) => s + r.sampleSize, 0);
  const idealSamples = MI_THRESHOLDS.MIN_COMPETITORS * (MI_THRESHOLDS.MIN_POSTS_API_CEILING + MI_THRESHOLDS.MIN_COMMENTS_SAMPLE);
  return Math.min(1, totalSamples / idealSamples);
}

/**
 * T3.A — Runtime Truth Track: with <2 competitors there is no meaningful
 * cross-competitor variance to compute. Pre-T3.A this returned a synthetic
 * 0.5 which then flowed into the weighted-confidence sum (`* 0.10`),
 * inflating overall by ~0.05 on every single-competitor run and masking
 * the absence of cross-source verification. Returning 0 surfaces the gap
 * to the orchestrator's confidence integrity verdict; the absence is also
 * flagged via `crossCompetitorConsistencyAbsent` on `ConfidenceResult`.
 */
export function computeCrossCompetitorConsistency(signalResults: CompetitorSignalResult[]): number {
  if (signalResults.length < 2) return 0;
  const signalKeys = [
    "postingFrequencyTrend",
    "engagementVolatility",
    "ctaIntensityShift",
  ] as const;

  let totalVariance = 0;
  for (const key of signalKeys) {
    const values = signalResults.map(r => r.signals[key]);
    totalVariance += variance(values);
  }

  const avgVariance = totalVariance / signalKeys.length;
  return Math.max(0, Math.min(1, 1 - avgVariance * 2));
}

export function computeSignalStability(signalResults: CompetitorSignalResult[]): number {
  if (signalResults.length === 0) return 0;
  const variances = signalResults.map(r => r.varianceScore);
  const avgVariance = mean(variances);
  return Math.max(0, Math.min(1, 1 - avgVariance * 3));
}

export function computeConfidenceFactors(
  signalResults: CompetitorSignalResult[],
  dataAgeDays: number,
): ConfidenceFactors {
  return {
    dataCompleteness: computeDataCompleteness(signalResults),
    freshnessDecay: computeFreshnessDecay(dataAgeDays),
    sourceReliability: MI_CONFIDENCE.PROXY_RELIABILITY,
    sampleStrength: computeSampleStrength(signalResults),
    crossCompetitorConsistency: computeCrossCompetitorConsistency(signalResults),
    signalStability: computeSignalStability(signalResults),
  };
}

export function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= MI_CONFIDENCE.STRONG_THRESHOLD) return "STRONG";
  if (confidence >= MI_CONFIDENCE.MODERATE_THRESHOLD) return "MODERATE";
  if (confidence >= MI_CONFIDENCE.LOW_THRESHOLD) return "LOW";
  if (confidence >= MI_CONFIDENCE.UNSTABLE_THRESHOLD) return "UNSTABLE";
  return "INSUFFICIENT";
}

export function evaluateSignalStabilityGuard(
  signalResults: CompetitorSignalResult[],
  contentPrimaryMode: boolean = false
): SignalStabilityGuard {
  const avgCoverage = mean(signalResults.map(r => r.signalCoverageScore));
  const avgReliability = mean(signalResults.map(r => r.sourceReliabilityScore));
  const totalSampleSize = signalResults.reduce((s, r) => s + r.sampleSize, 0);
  const maxTimeWindow = Math.max(0, ...signalResults.map(r => r.timeWindowDays));
  const avgVariance = mean(signalResults.map(r => r.varianceScore));
  const maxDominantRatio = Math.max(0, ...signalResults.map(r => r.dominantSourceRatio));
  const allMissing = signalResults.flatMap(r => r.missingFields);

  const reasons: string[] = [];
  let decision: GuardDecision = "PROCEED";

  const sampleSizes = signalResults.map(r => r.sampleSize);
  const activeCompetitorsWithData = signalResults.filter(r => r.sampleSize > 0).length;

  // BLOCK CONDITIONS (Extreme low data or absolute lack of cross-competitor representation)
  if (avgCoverage < 0.35) {
    decision = "BLOCK";
    reasons.push(`BLOCK: Extremely low average signal coverage (${(avgCoverage * 100).toFixed(0)}% < 35%).`);
  }

  if (totalSampleSize < 12) {
    decision = "BLOCK";
    reasons.push(`BLOCK: Total post sample size (${totalSampleSize} < 12) is insufficient for cross-source verification.`);
  }

  if (activeCompetitorsWithData < 2 && signalResults.length >= 2) {
    decision = "BLOCK";
    reasons.push(`BLOCK: Only ${activeCompetitorsWithData} competitor has data. Cross-source representation is absent.`);
  }

  // Evaluate extreme concentration skew
  if (decision !== "BLOCK" && totalSampleSize > 0) {
    const sortedSizes = [...sampleSizes].sort((a, b) => b - a);
    const maxSample = sortedSizes[0] || 0;
    const concentrationRatio = maxSample / totalSampleSize;

    if (concentrationRatio > 0.85) {
      const othersMax = sortedSizes[1] || 0;
      if (othersMax < 3) {
        decision = "BLOCK";
        reasons.push(`BLOCK: Extreme sample concentration (${(concentrationRatio * 100).toFixed(0)}% of evidence in a single competitor, other competitors have < 3 posts).`);
      }
    }
  }

  // DOWNGRADE CONDITIONS (Low confidence, or concentration that leaves other sources under-represented)
  if (decision === "PROCEED") {
    if (avgCoverage < 0.55) {
      decision = "DOWNGRADE";
      reasons.push(`DOWNGRADE: Low average signal coverage (${(avgCoverage * 100).toFixed(0)}% < 55%).`);
    }

    const sortedSizes = [...sampleSizes].sort((a, b) => b - a);
    const maxSample = sortedSizes[0] || 0;
    const concentrationRatio = totalSampleSize > 0 ? maxSample / totalSampleSize : 0;
    
    if (concentrationRatio > 0.75) {
      const others = sortedSizes.slice(1);
      const poorlyRepresentedCount = others.filter(size => size < 6).length;
      if (poorlyRepresentedCount > 0 && others.length > 0) {
        decision = "DOWNGRADE";
        reasons.push(`DOWNGRADE: High competitor source concentration (${(concentrationRatio * 100).toFixed(0)}%) leaving ${poorlyRepresentedCount} competitor(s) with < 6 posts.`);
      }
    }

    if (avgReliability < 0.50) {
      decision = "DOWNGRADE";
      reasons.push(`DOWNGRADE: Low average source reliability (${avgReliability.toFixed(2)} < 0.50).`);
    }
  }

  return {
    signalCoverageScore: avgCoverage,
    sourceReliabilityScore: avgReliability,
    sampleSize: totalSampleSize,
    timeWindowDays: maxTimeWindow,
    varianceScore: avgVariance,
    dominantSourceRatio: maxDominantRatio,
    missingFields: allMissing,
    decision,
    reasons,
  };
}

export function computeConfidence(
  signalResults: CompetitorSignalResult[],
  dataAgeDays: number,
  realDataRatio: number = 1.0,
  contentPrimaryMode: boolean = false,
  freshnessState: "FRESH" | "PARTIALLY_FRESH" | "STALE" | "INSUFFICIENT_DATA" = "STALE"
): ConfidenceResult {
  const factors = computeConfidenceFactors(signalResults, dataAgeDays);

  let overall = Math.round((
    factors.dataCompleteness * 0.25 +
    factors.freshnessDecay * 0.15 +
    factors.sourceReliability * 0.15 +
    factors.sampleStrength * 0.20 +
    factors.crossCompetitorConsistency * 0.10 +
    factors.signalStability * 0.15
  ) * 1000) / 1000;

  if (realDataRatio < MI_REAL_DATA_RATIO.MIN_REAL_RATIO && !contentPrimaryMode) {
    const penalty = (MI_REAL_DATA_RATIO.MIN_REAL_RATIO - realDataRatio) * MI_REAL_DATA_RATIO.CONFIDENCE_PENALTY_FACTOR;
    overall = Math.round(Math.max(0, overall - penalty) * 1000) / 1000;
  }

  const level = getConfidenceLevel(overall);

  const guard = evaluateSignalStabilityGuard(signalResults, contentPrimaryMode);
  let guardDecision = guard.decision;
  const guardReasons = [...guard.reasons];

  if (dataAgeDays > MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS) {
    guardDecision = "BLOCK";
    guardReasons.push(`DATA_STALE_HARD_GATE: data older than ${MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS} days (age: ${dataAgeDays}d)`);
  }
  if (overall < MI_CONFIDENCE.BLOCK_THRESHOLD && guardDecision !== "BLOCK") {
    guardReasons.push(`Low confidence advisory: ${overall} < ${MI_CONFIDENCE.BLOCK_THRESHOLD} — proceeding with available data`);
  }

  return {
    overall,
    level,
    factors,
    guardDecision,
    guardReasons,
    freshnessState
  };
}
