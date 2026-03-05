import { db } from "../db";
import { miSnapshots } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface MarketBaseline {
  narrativeConvergence: number;
  angleSaturation: number;
  offerCompression: number;
  marketHeating: number;
  revivalPotential: number;
  snapshotsUsed: number;
  isCalibrated: boolean;
}

export interface DeviationResult {
  field: string;
  observed: number;
  baseline: number;
  deviation: number;
  deviationPct: number;
  isElevated: boolean;
  isDepressed: boolean;
  effectiveThreshold: number;
}

export interface CalibrationContext {
  signalNoiseRatio: number;
  confidenceScore: number;
  postsAnalyzed: number;
  competitorCoverage: number;
}

const BASELINE_WINDOW = 5;
const BASE_DEVIATION_TRIGGER = 0.25;
const MIN_SNAPSHOTS_FOR_CALIBRATION = 2;

const TIME_WEIGHTS = [0.10, 0.15, 0.20, 0.25, 0.30];

const FALLBACK_BASELINE: MarketBaseline = {
  narrativeConvergence: 0.35,
  angleSaturation: 0.30,
  offerCompression: 0.25,
  marketHeating: 0.40,
  revivalPotential: 0.30,
  snapshotsUsed: 0,
  isCalibrated: false,
};

function parseJsonSafe(val: any, fallback: any): any {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function getTimeWeights(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1.0];
  const fullWeights = TIME_WEIGHTS.slice(-count);
  const sum = fullWeights.reduce((a, b) => a + b, 0);
  return fullWeights.map(w => w / sum);
}

export async function computeMarketBaseline(accountId: string, campaignId: string): Promise<MarketBaseline> {
  try {
    const snapshots = await db.select({
      trajectoryData: miSnapshots.trajectoryData,
      status: miSnapshots.status,
    })
      .from(miSnapshots)
      .where(and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
        eq(miSnapshots.status, "COMPLETE"),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(BASELINE_WINDOW);

    const validTrajectories: any[] = [];
    for (const snap of snapshots) {
      const traj = parseJsonSafe(snap.trajectoryData, null);
      if (traj) validTrajectories.push(traj);
    }

    if (validTrajectories.length < MIN_SNAPSHOTS_FOR_CALIBRATION) {
      return FALLBACK_BASELINE;
    }

    const ordered = validTrajectories.reverse();
    const weights = getTimeWeights(ordered.length);

    let wNarrative = 0, wAngle = 0, wOffer = 0, wHeating = 0, wRevival = 0;

    for (let i = 0; i < ordered.length; i++) {
      const t = ordered[i];
      const w = weights[i];
      wNarrative += (t.narrativeConvergenceScore || 0) * w;
      wAngle += (t.angleSaturationLevel || 0) * w;
      wOffer += (t.offerCompressionIndex || 0) * w;
      wHeating += (t.marketHeatingIndex || 0) * w;
      wRevival += (t.revivalPotential || 0) * w;
    }

    return {
      narrativeConvergence: wNarrative,
      angleSaturation: wAngle,
      offerCompression: wOffer,
      marketHeating: wHeating,
      revivalPotential: wRevival,
      snapshotsUsed: ordered.length,
      isCalibrated: true,
    };
  } catch (err) {
    console.error("[MIv3] Market baseline computation failed:", err);
    return FALLBACK_BASELINE;
  }
}

export function computeDynamicThreshold(baseThreshold: number, ctx?: CalibrationContext): number {
  if (!ctx) return baseThreshold;

  let modifier = 0;

  if (ctx.postsAnalyzed < 20) modifier += 0.15;
  else if (ctx.postsAnalyzed < 50) modifier += 0.08;
  else if (ctx.postsAnalyzed >= 100) modifier -= 0.05;

  if (ctx.signalNoiseRatio < 0.3) modifier += 0.12;
  else if (ctx.signalNoiseRatio < 0.5) modifier += 0.06;
  else if (ctx.signalNoiseRatio >= 0.7) modifier -= 0.05;

  if (ctx.confidenceScore < 0.4) modifier += 0.10;
  else if (ctx.confidenceScore < 0.6) modifier += 0.05;
  else if (ctx.confidenceScore >= 0.8) modifier -= 0.05;

  if (ctx.competitorCoverage < 0.5) modifier += 0.10;
  else if (ctx.competitorCoverage >= 0.8) modifier -= 0.03;

  const threshold = baseThreshold + modifier;
  return Math.max(0.10, Math.min(0.60, threshold));
}

export function computeDeviation(observed: number, baseline: number, field: string, threshold?: number): DeviationResult {
  const effectiveThreshold = threshold ?? BASE_DEVIATION_TRIGGER;
  const deviation = observed - baseline;
  const deviationPct = baseline > 0.01 ? Math.abs(deviation) / baseline : Math.abs(deviation);
  return {
    field,
    observed,
    baseline,
    deviation,
    deviationPct,
    isElevated: deviation > 0 && deviationPct > effectiveThreshold,
    isDepressed: deviation < 0 && deviationPct > effectiveThreshold,
    effectiveThreshold,
  };
}

export function computeAllDeviations(trajectory: any, baseline: MarketBaseline, ctx?: CalibrationContext): DeviationResult[] {
  const threshold = computeDynamicThreshold(BASE_DEVIATION_TRIGGER, ctx);
  return [
    computeDeviation(trajectory.narrativeConvergenceScore || 0, baseline.narrativeConvergence, "narrativeConvergence", threshold),
    computeDeviation(trajectory.angleSaturationLevel || 0, baseline.angleSaturation, "angleSaturation", threshold),
    computeDeviation(trajectory.offerCompressionIndex || 0, baseline.offerCompression, "offerCompression", threshold),
    computeDeviation(trajectory.marketHeatingIndex || 0, baseline.marketHeating, "marketHeating", threshold),
    computeDeviation(trajectory.revivalPotential || 0, baseline.revivalPotential, "revivalPotential", threshold),
  ];
}

export function getDeviationForField(deviations: DeviationResult[], field: string): DeviationResult | undefined {
  return deviations.find(d => d.field === field);
}

export { BASE_DEVIATION_TRIGGER as DEVIATION_TRIGGER, BASELINE_WINDOW, MIN_SNAPSHOTS_FOR_CALIBRATION, FALLBACK_BASELINE, TIME_WEIGHTS };
