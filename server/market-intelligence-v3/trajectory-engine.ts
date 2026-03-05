import type { CompetitorSignalResult, IntentResult, TrajectoryData, EngagementQuality } from "./types";
import { MI_REVIVAL_CAP } from "./constants";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function computeMarketHeatingIndex(signals: CompetitorSignalResult[], intents: IntentResult[]): number {
  if (signals.length === 0) return 0;

  const avgFrequencyTrend = mean(signals.map(s => Math.max(0, s.signals.postingFrequencyTrend)));
  const avgCtaShift = mean(signals.map(s => Math.max(0, s.signals.ctaIntensityShift)));
  const aggressiveRatio = intents.filter(i =>
    i.intentCategory === "AGGRESSIVE_SCALING" || i.intentCategory === "PRICE_WAR"
  ).length / Math.max(1, intents.length);

  return clamp01(avgFrequencyTrend * 0.3 + avgCtaShift * 0.3 + aggressiveRatio * 0.4);
}

export function computeNarrativeConvergenceScore(signals: CompetitorSignalResult[]): number {
  if (signals.length < 2) return 0;

  const hashtagDrifts = signals.map(s => s.signals.hashtagDriftScore);
  const avgDrift = mean(hashtagDrifts);
  const convergence = 1 - avgDrift;

  const offerChanges = signals.map(s => Math.abs(s.signals.offerLanguageChange));
  const avgOfferChange = mean(offerChanges);

  return clamp01(convergence * 0.6 + (1 - avgOfferChange) * 0.4);
}

export function computeOfferCompressionIndex(signals: CompetitorSignalResult[]): number {
  if (signals.length < 2) return 0;

  const offerChanges = signals.map(s => s.signals.offerLanguageChange);
  const ctaShifts = signals.map(s => s.signals.ctaIntensityShift);
  const avgOfferIncrease = mean(offerChanges.map(v => Math.max(0, v)));
  const avgCtaIncrease = mean(ctaShifts.map(v => Math.max(0, v)));

  return clamp01(avgOfferIncrease * 0.5 + avgCtaIncrease * 0.5);
}

export function computeAngleSaturationLevel(signals: CompetitorSignalResult[]): number {
  if (signals.length < 2) return 0;

  const experimentRates = signals.map(s => s.signals.contentExperimentRate);
  const avgExperiment = mean(experimentRates);
  const hashtagDrifts = signals.map(s => s.signals.hashtagDriftScore);
  const avgHashtagDrift = mean(hashtagDrifts);

  const saturation = 1 - (avgExperiment * 0.5 + avgHashtagDrift * 0.5);
  return clamp01(saturation);
}

export function computeRevivalPotential(
  signals: CompetitorSignalResult[],
  intents: IntentResult[],
): number {
  if (signals.length === 0) return 0;

  const decliningCount = intents.filter(i => i.intentCategory === "DECLINING").length;
  const decliningRatio = decliningCount / Math.max(1, intents.length);

  const avgEngagementVolatility = mean(signals.map(s => s.signals.engagementVolatility));
  const avgExperimentRate = mean(signals.map(s => s.signals.contentExperimentRate));
  const angleSaturation = computeAngleSaturationLevel(signals);

  let rawRevival = decliningRatio * 0.3 + avgEngagementVolatility * 0.2 + (1 - avgExperimentRate) * 0.2 + angleSaturation * 0.3;

  const highComplaintClustering = mean(signals.map(s => Math.max(0, -s.signals.sentimentDrift))) > 0.3;
  const lowAngleDiversity = avgExperimentRate < 0.15;
  const competitorFatigue = decliningRatio > 0.5;

  if (!(highComplaintClustering && lowAngleDiversity && competitorFatigue)) {
    rawRevival = Math.min(rawRevival, MI_REVIVAL_CAP);
  }

  return clamp01(Math.round(rawRevival * 1000) / 1000);
}

export function computeMarketActivityLevel(signals: CompetitorSignalResult[]): number {
  if (signals.length === 0) return 0;
  const avgFrequency = mean(signals.map(s => Math.max(0, s.signals.postingFrequencyTrend)));
  const avgExperiment = mean(signals.map(s => s.signals.contentExperimentRate));
  return clamp01(avgFrequency * 0.6 + avgExperiment * 0.4);
}

export function computeDemandConfidence(engagementQuality: EngagementQuality, signals: CompetitorSignalResult[]): number {
  if (signals.length === 0) return 0;
  const qualityWeight = engagementQuality.engagementQualityRatio * 0.5;
  const avgSentimentStrength = mean(signals.map(s => Math.abs(s.signals.sentimentDrift)));
  const dataWeight = Math.min(1, (engagementQuality.highIntentCount + engagementQuality.lowValueCount) / 20) * 0.3;
  const sentimentWeight = avgSentimentStrength * 0.2;
  return clamp01(qualityWeight + dataWeight + sentimentWeight);
}

export function computeTrajectory(
  signals: CompetitorSignalResult[],
  intents: IntentResult[],
  engagementQuality?: EngagementQuality,
): TrajectoryData {
  const eq: EngagementQuality = engagementQuality || { highIntentCount: 0, lowValueCount: 0, engagementQualityRatio: 0 };
  return {
    marketHeatingIndex: computeMarketHeatingIndex(signals, intents),
    narrativeConvergenceScore: computeNarrativeConvergenceScore(signals),
    offerCompressionIndex: computeOfferCompressionIndex(signals),
    angleSaturationLevel: computeAngleSaturationLevel(signals),
    revivalPotential: computeRevivalPotential(signals, intents),
    marketActivityLevel: computeMarketActivityLevel(signals),
    demandConfidence: computeDemandConfidence(eq, signals),
  };
}

export function deriveTrajectoryDirection(trajectory: TrajectoryData): string {
  const { marketHeatingIndex, offerCompressionIndex, angleSaturationLevel } = trajectory;

  if (marketHeatingIndex > 0.7 && offerCompressionIndex > 0.5) return "HEATING_COMPRESSED";
  if (marketHeatingIndex > 0.7) return "HEATING";
  if (marketHeatingIndex < 0.3 && angleSaturationLevel > 0.7) return "STAGNANT_SATURATED";
  if (marketHeatingIndex < 0.3) return "COOLING";
  if (offerCompressionIndex > 0.6) return "COMPRESSING";
  if (angleSaturationLevel > 0.7) return "SATURATED";
  return "STABLE";
}

export function deriveMarketState(trajectory: TrajectoryData, confidenceLevel: string): string {
  if (confidenceLevel === "INSUFFICIENT") {
    return "INSUFFICIENT_DATA";
  }
  const direction = deriveTrajectoryDirection(trajectory);
  switch (direction) {
    case "HEATING_COMPRESSED": return "HIGH_COMPETITION";
    case "HEATING": return "GROWING_COMPETITION";
    case "STAGNANT_SATURATED": return "SATURATED_MARKET";
    case "COOLING": return "LOW_ACTIVITY";
    case "COMPRESSING": return "PRICE_PRESSURE";
    case "SATURATED": return "CONTENT_SATURATION";
    default: return "MODERATE_ACTIVITY";
  }
}
