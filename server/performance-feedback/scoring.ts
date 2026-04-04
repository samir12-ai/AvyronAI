export const SCORE_WEIGHTS = {
  savesRate: 0.45,
  engagementRate: 0.35,
  reachDecayFactor: 0.20,
} as const;

export const VOLUME_PENALTY_FACTOR = 0.75;
export const VOLUME_PENALTY_THRESHOLD = 3;
export const SMOOTHING_PERIODS = 3;

export interface RawSnapshotInput {
  savesRate: number;
  avgEngagementRate: number;
  reachDecayFactor: number;
  totalPublished: number;
}

export function computeRawScore(input: RawSnapshotInput): number {
  return (
    input.savesRate * SCORE_WEIGHTS.savesRate +
    input.avgEngagementRate * SCORE_WEIGHTS.engagementRate +
    input.reachDecayFactor * SCORE_WEIGHTS.reachDecayFactor
  );
}

export function applyVolumePenalty(rawScore: number, totalPublished: number): { score: number; penaltyApplied: boolean } {
  if (totalPublished < VOLUME_PENALTY_THRESHOLD) {
    return { score: rawScore * VOLUME_PENALTY_FACTOR, penaltyApplied: true };
  }
  return { score: rawScore, penaltyApplied: false };
}

export function computeSmoothedScore(currentRaw: number, previousScores: number[]): number {
  if (previousScores.length === 0) return currentRaw;
  const recent = previousScores.slice(0, SMOOTHING_PERIODS - 1);
  const all = [currentRaw, ...recent];
  const sum = all.reduce((a, b) => a + b, 0);
  return sum / all.length;
}

export function computeStabilitySignal(scores: number[]): number {
  if (scores.length < 2) return 1.0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 1;
  return Math.max(0, Math.min(1, 1 - cv));
}
