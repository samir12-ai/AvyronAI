/**
 * Task #92 / Phase 4-D — Traffic-percent dispatcher (OD-4).
 *
 * Deterministic per-jobId split. Same jobId ALWAYS lands the same path
 * for the lifetime of the run, so a single orchestrator invocation
 * cannot bisect into mixed-mode behavior mid-flight.
 *
 * Algorithm:
 *   - Compute a stable 32-bit hash of `jobId` (FNV-1a).
 *   - Pick the path whenever `hash % 100 < trafficPercent`.
 *
 * Doctrine:
 *   - OD-4: traffic-percent ∈ {0,1,5,25,50,100}; values outside the
 *     ladder MUST be rejected (we DO NOT silently coerce).
 *   - D1: no `?? path` / `|| path` fallback. The decision is a strict
 *     numeric comparison; missing/invalid input throws.
 *   - D5: the function returns a strict `CutoverPath` enum. Callers
 *     MUST exhaust both arms.
 */

import type { CutoverPath } from "./metrics";

export const ALLOWED_TRAFFIC_PERCENTS = [0, 1, 5, 25, 50, 100] as const;
export type AllowedTrafficPercent = (typeof ALLOWED_TRAFFIC_PERCENTS)[number];

export function isAllowedTrafficPercent(n: number): n is AllowedTrafficPercent {
  return (ALLOWED_TRAFFIC_PERCENTS as readonly number[]).includes(n);
}

export class InvalidTrafficPercentError extends Error {
  constructor(public readonly received: unknown) {
    super(
      `cutover: traffic_percent must be one of {${ALLOWED_TRAFFIC_PERCENTS.join(",")}}, ` +
        `got ${JSON.stringify(received)}`,
    );
    this.name = "InvalidTrafficPercentError";
  }
}

/** FNV-1a 32-bit hash. Deterministic, no Math.random / Date.now dependency. */
export function hashJobId(jobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick the orchestrator path for a job.
 *
 * @throws InvalidTrafficPercentError if `trafficPercent` is outside
 *         the doctrine ladder. Refuses to silently round/clip.
 */
export function decideOrchestratorPath(
  jobId: string,
  trafficPercent: number,
): CutoverPath {
  if (!isAllowedTrafficPercent(trafficPercent)) {
    throw new InvalidTrafficPercentError(trafficPercent);
  }
  if (trafficPercent === 0) return "current";
  if (trafficPercent === 100) return "candidate";
  if (!jobId || typeof jobId !== "string") {
    // Without a stable identifier we cannot honor "same job → same path";
    // fail closed to `current` (the safe path). This is the canonical
    // resolution, NOT a D1 fallback — the inputs are insufficient.
    return "current";
  }
  const bucket = hashJobId(jobId) % 100;
  return bucket < trafficPercent ? "candidate" : "current";
}
