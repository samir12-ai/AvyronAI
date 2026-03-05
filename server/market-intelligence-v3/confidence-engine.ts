import type { CompetitorSignalResult, ConfidenceFactors, ConfidenceLevel, ConfidenceResult, GuardDecision, SignalStabilityGuard } from "./types";
import { MI_CONFIDENCE, MI_THRESHOLDS } from "./constants";

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
  const idealSamples = MI_THRESHOLDS.MIN_COMPETITORS * (MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR + MI_THRESHOLDS.MIN_COMMENTS_SAMPLE);
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

export function evaluateSignalStabilityGuard(signalResults: CompetitorSignalResult[]): SignalStabilityGuard {
  const avgCoverage = mean(signalResults.map(r => r.signalCoverageScore));
  const avgReliability = mean(signalResults.map(r => r.sourceReliabilityScore));
  const totalSampleSize = signalResults.reduce((s, r) => s + r.sampleSize, 0);
  const maxTimeWindow = Math.max(0, ...signalResults.map(r => r.timeWindowDays));
  const avgVariance = mean(signalResults.map(r => r.varianceScore));
  const maxDominantRatio = Math.max(0, ...signalResults.map(r => r.dominantSourceRatio));
  const allMissing = signalResults.flatMap(r => r.missingFields);

  const reasons: string[] = [];
  let decision: GuardDecision = "PROCEED";

  if (avgCoverage < MI_CONFIDENCE.BLOCK_COVERAGE) {
    decision = "BLOCK";
    reasons.push(`Signal coverage critically low: ${avgCoverage.toFixed(2)} < ${MI_CONFIDENCE.BLOCK_COVERAGE}`);
  } else if (avgCoverage < MI_CONFIDENCE.DOWNGRADE_COVERAGE) {
    if (decision !== "BLOCK") decision = "DOWNGRADE";
    reasons.push(`Signal coverage below threshold: ${avgCoverage.toFixed(2)} < ${MI_CONFIDENCE.DOWNGRADE_COVERAGE}`);
  }

  if (avgReliability < MI_CONFIDENCE.BLOCK_RELIABILITY) {
    decision = "BLOCK";
    reasons.push(`Source reliability critically low: ${avgReliability.toFixed(2)} < ${MI_CONFIDENCE.BLOCK_RELIABILITY}`);
  }

  if (maxDominantRatio > MI_CONFIDENCE.DOWNGRADE_DOMINANT_SOURCE) {
    if (decision !== "BLOCK") decision = "DOWNGRADE";
    reasons.push(`Dominant source ratio too high: ${maxDominantRatio.toFixed(2)} > ${MI_CONFIDENCE.DOWNGRADE_DOMINANT_SOURCE}`);
  }

  const minSample = MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR * signalResults.length;
  if (totalSampleSize < minSample) {
    if (decision !== "BLOCK") decision = "DOWNGRADE";
    reasons.push(`Sample size insufficient: ${totalSampleSize} < ${minSample}`);
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
): ConfidenceResult {
  const factors = computeConfidenceFactors(signalResults, dataAgeDays);

  const overall = Math.round((
    factors.dataCompleteness * 0.25 +
    factors.freshnessDecay * 0.15 +
    factors.sourceReliability * 0.15 +
    factors.sampleStrength * 0.20 +
    factors.crossCompetitorConsistency * 0.10 +
    factors.signalStability * 0.15
  ) * 1000) / 1000;

  const level = getConfidenceLevel(overall);

  const guard = evaluateSignalStabilityGuard(signalResults);
  let guardDecision = guard.decision;
  const guardReasons = [...guard.reasons];

  if (dataAgeDays > MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS) {
    guardDecision = "BLOCK";
    guardReasons.push(`DATA_STALE_HARD_GATE: data older than ${MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS} days requires refresh (age: ${dataAgeDays}d)`);
  } else if (overall < MI_CONFIDENCE.BLOCK_THRESHOLD && guardDecision !== "BLOCK") {
    guardDecision = "BLOCK";
    guardReasons.push(`Overall confidence below block threshold: ${overall} < ${MI_CONFIDENCE.BLOCK_THRESHOLD}`);
  } else if (overall < MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD && guardDecision === "PROCEED") {
    guardDecision = "DOWNGRADE";
    guardReasons.push(`Overall confidence below aggressive threshold: ${overall} < ${MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD}`);
  }

  return {
    overall,
    level,
    factors,
    guardDecision,
    guardReasons,
  };
}
