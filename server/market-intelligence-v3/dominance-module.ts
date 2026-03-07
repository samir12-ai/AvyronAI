import type { CompetitorSignalResult, ConfidenceResult, DominanceResult, DominanceModeMetadata, GoalMode } from "./types";
import { GOAL_MODE_WEIGHTS, ENGAGEMENT_BIAS_THRESHOLD } from "./constants";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function getDominanceLevel(score: number): string {
  if (score >= 80) return "DOMINANT";
  if (score >= 65) return "STRUCTURALLY_STRONG";
  if (score >= 50) return "EFFICIENT";
  if (score >= 30) return "EXPOSED";
  return "WEAK";
}

function identifyStrengths(signal: CompetitorSignalResult): string[] {
  const strengths: string[] = [];
  const s = signal.signals;
  if (s.postingFrequencyTrend > 0.3) strengths.push("Increasing posting frequency");
  if (s.engagementVolatility < 0.2) strengths.push("Stable engagement");
  if (s.ctaIntensityShift > 0.2) strengths.push("Strengthening CTA presence");
  if (s.contentExperimentRate > 0.3) strengths.push("High content experimentation");
  if (s.sentimentDrift > 0.1) strengths.push("Improving audience sentiment");
  if (signal.signalCoverageScore > 0.8) strengths.push("Comprehensive market presence");
  return strengths;
}

function identifyWeaknesses(signal: CompetitorSignalResult): string[] {
  const weaknesses: string[] = [];
  const s = signal.signals;
  if (s.postingFrequencyTrend < -0.2) weaknesses.push("Declining posting frequency");
  if (s.engagementVolatility > 0.6) weaknesses.push("Unstable engagement");
  if (s.ctaIntensityShift < -0.1) weaknesses.push("Weakening CTA presence");
  if (s.offerLanguageChange > 0.3) weaknesses.push("Frequent offer changes (instability)");
  if (s.hashtagDriftScore > 0.6) weaknesses.push("High hashtag drift (unclear positioning)");
  if (s.sentimentDrift < -0.1) weaknesses.push("Declining audience sentiment");
  if (s.contentExperimentRate < 0.1) weaknesses.push("Low content innovation");
  return weaknesses;
}

function detectEngagementBiasRisk(
  engagementContribution: number,
  totalScore: number,
  goalMode: GoalMode,
): string | null {
  if (totalScore === 0) return null;
  const engagementRatio = engagementContribution / totalScore;
  if (engagementRatio > ENGAGEMENT_BIAS_THRESHOLD) {
    return `Engagement signals contribute ${Math.round(engagementRatio * 100)}% of dominance score in ${goalMode}. High engagement-weight bias risk: scores may overweight vanity metrics over strategic positioning.`;
  }
  return null;
}

export function computeDominanceForCompetitor(
  signal: CompetitorSignalResult,
  allSignals: CompetitorSignalResult[],
  confidence: ConfidenceResult,
  goalMode: GoalMode = "STRATEGY_MODE",
): DominanceResult {
  const s = signal.signals;
  const weights = GOAL_MODE_WEIGHTS[goalMode];

  const engagementScore = clamp01(1 - s.engagementVolatility) * (weights.engagement * 100);
  const frequencyScore = clamp01((s.postingFrequencyTrend + 1) / 2) * (weights.frequency * 100);
  const ctaScore = clamp01((s.ctaIntensityShift + 1) / 2) * (weights.cta * 100);
  const innovationScore = clamp01(s.contentExperimentRate) * (weights.innovation * 100);
  const sentimentScore = clamp01((s.sentimentDrift + 1) / 2) * (weights.sentiment * 100);
  const coverageScore = signal.signalCoverageScore * (weights.coverage * 100);

  let rawScore = engagementScore + frequencyScore + ctaScore + innovationScore + sentimentScore + coverageScore;

  if (confidence.level === "UNSTABLE" || confidence.level === "INSUFFICIENT") {
    rawScore *= 0.7;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  const engagementBiasRisk = detectEngagementBiasRisk(engagementScore, rawScore, goalMode);

  const dominanceModeMetadata: DominanceModeMetadata = {
    mode: goalMode,
    weights: { ...weights },
  };

  return {
    competitorId: signal.competitorId,
    competitorName: signal.competitorName,
    dominanceScore: score,
    dominanceLevel: getDominanceLevel(score),
    weaknesses: identifyWeaknesses(signal),
    strengths: identifyStrengths(signal),
    engagementWeightBiasRisk: engagementBiasRisk,
    dominanceModeMetadata,
  };
}

export function computeAllDominance(
  signals: CompetitorSignalResult[],
  confidence: ConfidenceResult,
  goalMode: GoalMode = "STRATEGY_MODE",
): DominanceResult[] {
  return signals.map(s => computeDominanceForCompetitor(s, signals, confidence, goalMode));
}
