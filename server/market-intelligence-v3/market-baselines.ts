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
}

const BASELINE_WINDOW = 5;
const DEVIATION_TRIGGER = 0.25;
const MIN_SNAPSHOTS_FOR_CALIBRATION = 2;

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

    if (snapshots.length < MIN_SNAPSHOTS_FOR_CALIBRATION) {
      return FALLBACK_BASELINE;
    }

    let sumNarrative = 0, sumAngle = 0, sumOffer = 0, sumHeating = 0, sumRevival = 0;
    let count = 0;

    for (const snap of snapshots) {
      const traj = parseJsonSafe(snap.trajectoryData, null);
      if (!traj) continue;
      sumNarrative += (traj.narrativeConvergenceScore || 0);
      sumAngle += (traj.angleSaturationLevel || 0);
      sumOffer += (traj.offerCompressionIndex || 0);
      sumHeating += (traj.marketHeatingIndex || 0);
      sumRevival += (traj.revivalPotential || 0);
      count++;
    }

    if (count < MIN_SNAPSHOTS_FOR_CALIBRATION) {
      return FALLBACK_BASELINE;
    }

    return {
      narrativeConvergence: sumNarrative / count,
      angleSaturation: sumAngle / count,
      offerCompression: sumOffer / count,
      marketHeating: sumHeating / count,
      revivalPotential: sumRevival / count,
      snapshotsUsed: count,
      isCalibrated: true,
    };
  } catch (err) {
    console.error("[MIv3] Market baseline computation failed:", err);
    return FALLBACK_BASELINE;
  }
}

export function computeDeviation(observed: number, baseline: number, field: string): DeviationResult {
  const deviation = observed - baseline;
  const deviationPct = baseline > 0.01 ? Math.abs(deviation) / baseline : Math.abs(deviation);
  return {
    field,
    observed,
    baseline,
    deviation,
    deviationPct,
    isElevated: deviation > 0 && deviationPct > DEVIATION_TRIGGER,
    isDepressed: deviation < 0 && deviationPct > DEVIATION_TRIGGER,
  };
}

export function computeAllDeviations(trajectory: any, baseline: MarketBaseline): DeviationResult[] {
  return [
    computeDeviation(trajectory.narrativeConvergenceScore || 0, baseline.narrativeConvergence, "narrativeConvergence"),
    computeDeviation(trajectory.angleSaturationLevel || 0, baseline.angleSaturation, "angleSaturation"),
    computeDeviation(trajectory.offerCompressionIndex || 0, baseline.offerCompression, "offerCompression"),
    computeDeviation(trajectory.marketHeatingIndex || 0, baseline.marketHeating, "marketHeating"),
    computeDeviation(trajectory.revivalPotential || 0, baseline.revivalPotential, "revivalPotential"),
  ];
}

export function getDeviationForField(deviations: DeviationResult[], field: string): DeviationResult | undefined {
  return deviations.find(d => d.field === field);
}

export { DEVIATION_TRIGGER, BASELINE_WINDOW, MIN_SNAPSHOTS_FOR_CALIBRATION, FALLBACK_BASELINE };
