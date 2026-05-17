import type { TrajectoryDelta } from "../../market-intelligence-v3/types";
import { TrajectoryDeltaSeverityEnum, type TrajectoryDeltaSeverity } from "./shape";

/**
 * T-S10-5 — TrajectoryDelta severity classifier.
 *
 * Thresholds (absolute delta) per trajectory field. Indices map to severity
 * boundaries: [watchThresh, warnThresh, criticalThresh].
 *
 * Rationale: trajectory scores are normalized 0..1 in MIv3. A 0.05 swing
 * across one refresh window is a noticeable narrative move; 0.10 is a meaningful
 * trend shift; 0.20+ is a structural reordering of the competitive landscape.
 */
export const TRAJECTORY_SEVERITY_THRESHOLDS: Record<string, [number, number, number]> = {
  marketHeatingIndex:        [0.05, 0.10, 0.20],
  narrativeConvergenceScore: [0.05, 0.10, 0.20],
  offerCompressionIndex:     [0.05, 0.10, 0.20],
  angleSaturationLevel:      [0.05, 0.10, 0.20],
  revivalPotential:          [0.05, 0.10, 0.20],
};

export function classifyTrajectoryDelta(d: TrajectoryDelta): TrajectoryDeltaSeverity {
  const thresholds = TRAJECTORY_SEVERITY_THRESHOLDS[d.field];
  if (!thresholds) return "unknown";
  const abs = Math.abs(d.delta);
  if (abs >= thresholds[2]) return "critical";
  if (abs >= thresholds[1]) return "warn";
  if (abs >= thresholds[0]) return "watch";
  return "none";
}

export function classifyTrajectoryShift(deltas: TrajectoryDelta[]): TrajectoryDeltaSeverity {
  if (deltas.length === 0) return "none";
  const order: TrajectoryDeltaSeverity[] = ["none", "watch", "warn", "critical"];
  let worst: TrajectoryDeltaSeverity = "none";
  for (const d of deltas) {
    const sev = classifyTrajectoryDelta(d);
    if (sev === "unknown") continue;
    if (order.indexOf(sev) > order.indexOf(worst)) worst = sev;
  }
  return worst;
}

// Re-export type for convenience
export { TrajectoryDeltaSeverityEnum };
export type { TrajectoryDeltaSeverity };
