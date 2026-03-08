import type { CompetitorSignalResult, IntentResult, TrajectoryData, EngagementQuality } from "./types";
import { MI_REVIVAL_CAP, MI_COMPETITION_INTENSITY, MI_LIFECYCLE, MI_DEMAND_PRESSURE } from "./constants";

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

  const activeWithSufficientData = signals.filter(s => s.lifecycle === "ACTIVE" && !s.lowSample);
  const useActiveOnly = activeWithSufficientData.length >= 2;
  const signalsToUse = useActiveOnly ? activeWithSufficientData : signals;

  let weightedFrequencySum = 0;
  let weightedExperimentSum = 0;
  let totalWeight = 0;

  for (const s of signalsToUse) {
    let lifecycleWeight = 1.0;
    if (s.lifecycle === "DORMANT") lifecycleWeight = MI_LIFECYCLE.DORMANT_ACTIVITY_WEIGHT;
    else if (s.lifecycle === "LOW_SIGNAL") lifecycleWeight = MI_LIFECYCLE.LOW_SIGNAL_ACTIVITY_WEIGHT;
    if (s.lowSample) lifecycleWeight *= MI_LIFECYCLE.LOW_SAMPLE_ACTIVITY_WEIGHT;

    const w = (s.authorityWeight ?? 1.0) * lifecycleWeight;
    weightedFrequencySum += Math.max(0, s.signals.postingFrequencyTrend) * w;
    weightedExperimentSum += s.signals.contentExperimentRate * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return 0;
  const avgFrequency = weightedFrequencySum / totalWeight;
  const avgExperiment = weightedExperimentSum / totalWeight;

  const lowSampleCount = signals.filter(s => s.lowSample).length;
  if (lowSampleCount > 0) {
    console.log(`[MIv3] LOW_SAMPLE_COMPETITOR: ${lowSampleCount}/${signals.length} competitors flagged as LOW_SAMPLE | marketActivity calculated from ${signalsToUse.length} ${useActiveOnly ? "ACTIVE-only" : "all"} competitors`);
  }

  return clamp01(avgFrequency * 0.6 + avgExperiment * 0.4);
}

export function computeDemandConfidence(engagementQuality: EngagementQuality, signals: CompetitorSignalResult[]): number {
  if (signals.length === 0) return 0;
  const qualityWeight = engagementQuality.engagementQualityRatio * 0.5;
  const avgSentimentStrength = mean(signals.map(s => Math.abs(s.signals.sentimentDrift)));
  const dataWeight = Math.min(1, (engagementQuality.highIntentCount + engagementQuality.lowValueCount) / 20) * 0.3;
  const sentimentWeight = avgSentimentStrength * 0.2;

  let base = clamp01(qualityWeight + dataWeight + sentimentWeight);

  const avgEngagementVolatility = mean(signals.map(s => s.signals.engagementVolatility));
  const engagementDensitySignal = clamp01(avgEngagementVolatility * 0.5 + (engagementQuality.highIntentCount > 0 ? 0.2 : 0));
  const totalContent = signals.reduce((s, r) => s + r.sampleSize, 0);
  const contentOutputSignal = clamp01(totalContent / (signals.length * 15));
  const stabilizer = (engagementDensitySignal + contentOutputSignal) * 0.15;
  base = clamp01(base + stabilizer);

  return base;
}

export function computeCompetitionIntensity(signals: CompetitorSignalResult[], engagementQuality: EngagementQuality): number {
  if (signals.length === 0) return 0;

  const competitorCount = signals.length;
  const competitorDensity = clamp01(competitorCount / MI_COMPETITION_INTENSITY.HIGH_DENSITY_COMPETITOR_THRESHOLD);

  const avgPostsPerCompetitor = mean(signals.map(s => s.sampleSize > 0 ? Math.min(s.sampleSize, 40) : 0));
  const contentVolume = clamp01(avgPostsPerCompetitor / MI_COMPETITION_INTENSITY.HIGH_CONTENT_VOLUME_PER_COMPETITOR);

  const avgEngagementVolatility = mean(signals.map(s => s.signals.engagementVolatility));
  const engagementDensity = clamp01(Math.max(avgEngagementVolatility, engagementQuality.engagementQualityRatio));

  const avgFrequencyTrend = mean(signals.map(s => Math.abs(s.signals.postingFrequencyTrend)));
  const postingBaseline = clamp01(avgFrequencyTrend + (avgPostsPerCompetitor > 0 ? 0.3 : 0));

  const hashtagDrifts = signals.map(s => s.signals.hashtagDriftScore);
  const avgDrift = mean(hashtagDrifts);
  const experimentRates = signals.map(s => s.signals.contentExperimentRate);
  const avgExperiment = mean(experimentRates);
  const narrativeDiversity = clamp01(avgDrift * 0.5 + avgExperiment * 0.5);

  let intensity = clamp01(
    competitorDensity * 0.30 +
    contentVolume * 0.25 +
    engagementDensity * 0.15 +
    postingBaseline * 0.15 +
    narrativeDiversity * 0.15
  );

  if (competitorCount >= MI_COMPETITION_INTENSITY.HIGH_DENSITY_COMPETITOR_THRESHOLD && (avgPostsPerCompetitor > 0 || avgFrequencyTrend >= MI_COMPETITION_INTENSITY.POSTING_BASELINE_FLOOR)) {
    intensity = Math.max(intensity, 0.45);
  } else if (competitorCount >= MI_COMPETITION_INTENSITY.MODERATE_DENSITY_COMPETITOR_THRESHOLD && avgPostsPerCompetitor > 0) {
    intensity = Math.max(intensity, 0.25);
  }

  return Math.round(intensity * 1000) / 1000;
}

export function deriveCompetitionIntensityLevel(score: number): string {
  if (score >= 0.70) return "HIGH";
  if (score >= 0.45) return "MODERATE";
  if (score >= 0.25) return "LOW";
  return "MINIMAL";
}

export function computeMarketCompressionScore(
  narrativeConvergence: number,
  angleSaturation: number,
  marketHeating: number,
): number {
  return clamp01(
    Math.round(
      (narrativeConvergence * 0.45 + angleSaturation * 0.35 + marketHeating * 0.20) * 1000,
    ) / 1000,
  );
}

export function computeTrajectory(
  signals: CompetitorSignalResult[],
  intents: IntentResult[],
  engagementQuality?: EngagementQuality,
): TrajectoryData {
  const eq: EngagementQuality = engagementQuality || { highIntentCount: 0, lowValueCount: 0, engagementQualityRatio: 0 };
  const marketHeatingIndex = computeMarketHeatingIndex(signals, intents);
  const narrativeConvergenceScore = computeNarrativeConvergenceScore(signals);
  const angleSaturationLevel = computeAngleSaturationLevel(signals);
  const competitionIntensityScore = computeCompetitionIntensity(signals, eq);
  return {
    marketHeatingIndex,
    narrativeConvergenceScore,
    offerCompressionIndex: computeOfferCompressionIndex(signals),
    angleSaturationLevel,
    revivalPotential: computeRevivalPotential(signals, intents),
    marketActivityLevel: computeMarketActivityLevel(signals),
    demandConfidence: computeDemandConfidence(eq, signals),
    marketCompressionScore: computeMarketCompressionScore(narrativeConvergenceScore, angleSaturationLevel, marketHeatingIndex),
    competitionIntensityScore,
  };
}

export function deriveTrajectoryDirection(trajectory: TrajectoryData, demandPressureScore?: number): string {
  const { marketHeatingIndex, offerCompressionIndex, angleSaturationLevel, competitionIntensityScore } = trajectory;
  const highIntensity = competitionIntensityScore >= 0.45;
  const dp = demandPressureScore ?? 0;

  if (marketHeatingIndex > 0.7 && offerCompressionIndex > 0.5) return "HEATING_COMPRESSED";
  if (marketHeatingIndex > 0.7) return "HEATING";
  if (marketHeatingIndex < 0.3 && angleSaturationLevel > 0.7) {
    if (highIntensity) return "STABLE_COMPETITIVE";
    if (dp >= MI_DEMAND_PRESSURE.SUPPRESSED_DEMAND_PRESSURE_FLOOR) return "SUPPRESSED_DEMAND";
    return "STAGNANT_SATURATED";
  }
  if (marketHeatingIndex < MI_DEMAND_PRESSURE.SUPPRESSED_DEMAND_ACTIVITY_CEILING) {
    if (highIntensity) return "STABLE_COMPETITIVE";
    if (dp >= MI_DEMAND_PRESSURE.SUPPRESSED_DEMAND_PRESSURE_FLOOR) return "SUPPRESSED_DEMAND";
    return "COOLING";
  }
  if (offerCompressionIndex > 0.6) return "COMPRESSING";
  if (angleSaturationLevel > 0.7) return "SATURATED";
  return "STABLE";
}

export function deriveMarketState(trajectory: TrajectoryData, confidenceLevel: string, demandPressureScore?: number): string {
  if (confidenceLevel === "INSUFFICIENT") {
    return "INSUFFICIENT_DATA";
  }
  const direction = deriveTrajectoryDirection(trajectory, demandPressureScore);
  switch (direction) {
    case "HEATING_COMPRESSED": return "HIGH_COMPETITION";
    case "HEATING": return "GROWING_COMPETITION";
    case "STAGNANT_SATURATED": return "SATURATED_MARKET";
    case "COOLING": return "LOW_ACTIVITY";
    case "COMPRESSING": return "PRICE_PRESSURE";
    case "SATURATED": return "CONTENT_SATURATION";
    case "STABLE_COMPETITIVE": return "ESTABLISHED_COMPETITION";
    case "SUPPRESSED_DEMAND": return "SUPPRESSED_DEMAND_MARKET";
    default: return "MODERATE_ACTIVITY";
  }
}
