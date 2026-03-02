import type { CompetitorSignalResult, ConfidenceResult, DominanceResult } from "./types";

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

export function computeDominanceForCompetitor(
  signal: CompetitorSignalResult,
  allSignals: CompetitorSignalResult[],
  confidence: ConfidenceResult,
): DominanceResult {
  const s = signal.signals;

  const engagementScore = clamp01(1 - s.engagementVolatility) * 25;
  const frequencyScore = clamp01((s.postingFrequencyTrend + 1) / 2) * 20;
  const ctaScore = clamp01((s.ctaIntensityShift + 1) / 2) * 15;
  const innovationScore = clamp01(s.contentExperimentRate) * 15;
  const sentimentScore = clamp01((s.sentimentDrift + 1) / 2) * 15;
  const coverageScore = signal.signalCoverageScore * 10;

  let rawScore = engagementScore + frequencyScore + ctaScore + innovationScore + sentimentScore + coverageScore;

  if (confidence.level === "UNSTABLE" || confidence.level === "INSUFFICIENT") {
    rawScore *= 0.7;
  }

  const score = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  return {
    competitorId: signal.competitorId,
    competitorName: signal.competitorName,
    dominanceScore: score,
    dominanceLevel: getDominanceLevel(score),
    weaknesses: identifyWeaknesses(signal),
    strengths: identifyStrengths(signal),
  };
}

export function computeAllDominance(
  signals: CompetitorSignalResult[],
  confidence: ConfidenceResult,
): DominanceResult[] {
  return signals.map(s => computeDominanceForCompetitor(s, signals, confidence));
}
