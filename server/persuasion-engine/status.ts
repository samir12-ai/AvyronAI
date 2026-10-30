/**
 * Unified Status Mapping for Persuasion Engine
 * 
 * Provides an authoritative, single source of truth for:
 * 1. Live per-lane execution status mapping
 * 2. Resume hydration status mapping
 * 3. Aggregate Persuasion status derivation
 * 4. Downstream gating eligibility
 * 
 * Invariants:
 * - Only explicitly approved terminal outcomes count as SUCCESS.
 * - Unknown statuses fail-closed to ERROR.
 * - A required failed lane strictly prevents aggregate SUCCESS.
 * - Confirmed drift or unsupported product claims remain blocking until repaired.
 */

export type PersuasionNormalizedStatus = "SUCCESS" | "PARTIAL" | "ERROR";

export const PERSUASION_BLOCKING_STATUSES = new Set([
  "POSITIONING_DRIFT",
  "FACTUAL_POSTURE_FAILED",
  "FACTUAL_UNSUPPORTED",
  "BLOCKED",
  "ERROR",
  "INTEGRITY_FAILED",
  "DEPTH_FAILED",
  "CONTRACT_INCOMPLETE",
  "SIGNAL_BLOCKED",
]);

/**
 * Maps a single lane's Persuasion result or snapshot row to normalized status.
 */
export function mapPersuasionLaneStatus(resultOrRow: any): PersuasionNormalizedStatus {
  if (!resultOrRow) return "ERROR";

  const rawStatus = typeof resultOrRow.status === "string" 
    ? resultOrRow.status.trim().toUpperCase() 
    : "";

  // 1. Explicitly approved terminal outcomes
  if (rawStatus === "COMPLETE" || rawStatus === "SUCCESS") {
    // If output is present, verify there are no unhandled blocking drift or factual flags
    if (resultOrRow.factualPostureVerdict === "UNSUPPORTED" || resultOrRow.statusMessage?.includes("BLOCKED:")) {
      return "ERROR";
    }
    return "SUCCESS";
  }

  // 2. Non-fatal advisory outcomes
  if (rawStatus === "PARTIAL" || rawStatus === "ACCEPTABLE") {
    return "PARTIAL";
  }

  // 3. Known failure or blocking outcomes
  if (PERSUASION_BLOCKING_STATUSES.has(rawStatus)) {
    return "ERROR";
  }

  // 4. Fail-closed: unknown statuses never succeed by default
  return "ERROR";
}

/**
 * Derives aggregate Persuasion engine status across all required executable lanes.
 * A single required failed lane strictly blocks aggregate SUCCESS.
 */
export function deriveAggregatePersuasionStatus(
  laneResults: Map<string, any> | Array<any> | Record<string, any>
): PersuasionNormalizedStatus {
  const entries: any[] = laneResults instanceof Map
    ? Array.from(laneResults.values())
    : Array.isArray(laneResults)
      ? laneResults
      : Object.values(laneResults || {});

  if (entries.length === 0) {
    return "ERROR";
  }

  let hasError = false;
  let hasPartial = false;
  let successCount = 0;

  for (const entry of entries) {
    const status = mapPersuasionLaneStatus(entry);
    if (status === "ERROR") {
      hasError = true;
    } else if (status === "PARTIAL") {
      hasPartial = true;
    } else if (status === "SUCCESS") {
      successCount++;
    }
  }

  // Invariant: ANY required lane in ERROR prevents aggregate SUCCESS
  if (hasError) {
    return "ERROR";
  }

  if (hasPartial) {
    return "PARTIAL";
  }

  if (successCount === entries.length) {
    return "SUCCESS";
  }

  return "ERROR";
}
