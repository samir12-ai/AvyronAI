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

export function computeCrossCompetitorConsistency(signalResults: CompetitorSignalResult[]): number {
  if (signalResults.length < 2) return 0.5;
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

export function evaluateSignalStabilityGuard(signalResults: CompetitorSignalResult[], contentPrimaryMode: boolean = false): SignalStabilityGuard {
  const avgCoverage = mean(signalResults.map(r => r.signalCoverageScore));
  const avgReliability = mean(signalResults.map(r => r.sourceReliabilityScore));
  const totalSampleSize = signalResults.reduce((s, r) => s + r.sampleSize, 0);
  const maxTimeWindow = Math.max(0, ...signalResults.map(r => r.timeWindowDays));
  const avgVariance = mean(signalResults.map(r => r.varianceScore));
  const maxDominantRatio = Math.max(0, ...signalResults.map(r => r.dominantSourceRatio));
  const allMissing = signalResults.flatMap(r => r.missingFields);

  const reasons: string[] = [];
  const decision: GuardDecision = "PROCEED";

  if (avgCoverage < MI_CONFIDENCE.BLOCK_COVERAGE) {
    reasons.push(`Signal coverage low: ${avgCoverage.toFixed(2)} (advisory only)`);
  }

  if (avgReliability < MI_CONFIDENCE.BLOCK_RELIABILITY) {
    reasons.push(`Source reliability low: ${avgReliability.toFixed(2)} (advisory only)`);
  }

  const effectiveDominantThreshold = contentPrimaryMode ? 0.75 : MI_CONFIDENCE.DOWNGRADE_DOMINANT_SOURCE;
  if (maxDominantRatio > effectiveDominantThreshold) {
    reasons.push(`Dominant source ratio high: ${maxDominantRatio.toFixed(2)} > ${effectiveDominantThreshold}${contentPrimaryMode ? " (content-primary mode)" : ""} (advisory only)`);
  }

  const minSample = MI_THRESHOLDS.MIN_POSTS_API_CEILING * signalResults.length;
  if (totalSampleSize < minSample) {
    reasons.push(`Sample size note: ${totalSampleSize} < ${minSample} (using available data)`);
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
    guardReasons.push(`DATA_STALE_ADVISORY: data older than ${MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS} days (age: ${dataAgeDays}d) — proceeding with available data`);
  }
  if (overall < MI_CONFIDENCE.BLOCK_THRESHOLD) {
    guardReasons.push(`Low confidence advisory: ${overall} < ${MI_CONFIDENCE.BLOCK_THRESHOLD} — proceeding with available data`);
  }

  return {
    overall,
    level,
    factors,
    guardDecision,
    guardReasons,
  };
}
