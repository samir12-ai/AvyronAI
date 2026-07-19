import type { AnalyticalPackage } from "./types";

export interface AelAcknowledgement {
  usable: boolean;
  partial: boolean;
  reason: "AEL_OK" | "AEL_MISSING" | "AEL_PARTIAL";
  partialReason?: string;
}

export const AEL_PARTIAL_CONFIDENCE_MULTIPLIER = 0.7;

const NUMERIC_DOWNGRADE_FIELDS = [
  "confidenceScore",
  "score",
  "offerStrengthScore",
  "engineConfidence",
  "actionabilityScore",
  "awarenessStrengthScore",
  "persuasionStrengthScore",
] as const;

export function acknowledgeAelInput(
  engineName: string,
  ael: AnalyticalPackage | null | undefined,
  accountId?: string,
): AelAcknowledgement {
  if (!ael) {
    console.log(`[${engineName}] AEL_MISSING_PROPAGATED | accountId=${accountId || "n/a"} | reason=AEL_MISSING`);
    return { usable: false, partial: false, reason: "AEL_MISSING" };
  }
  if (ael.isPartial === true) {
    const partialReason = ael.partialReason || "unknown";
    console.log(`[${engineName}] AEL_PARTIAL_PROPAGATED | accountId=${accountId || "n/a"} | reason=AEL_PARTIAL | partialReason=${partialReason}`);
    return { usable: true, partial: true, reason: "AEL_PARTIAL", partialReason };
  }
  return { usable: true, partial: false, reason: "AEL_OK" };
}

/**
 * AEL provenance is written under `_aelProvenance` — NOT `_provenance`.
 *
 * `_provenance` is owned by the snapshot-reuse trust layer: the contract
 * registry's `extractProvenance()` treats ANY non-null `_provenance` object
 * without a `sourceJobId` as REUSED_UNVERIFIED → STALE, which cascades into
 * `offer_input_sufficient=UNKNOWN` → PIPELINE_INCOMPLETE at system-control.
 * Writing AEL acknowledgement flags into that key on FRESH engine outputs
 * (2026-07 regression) made every guard-wrapped engine look like an
 * unverified snapshot reuse. Keep AEL metadata in its own namespace.
 */
export function attachAelProvenance<T extends object>(
  result: T,
  ack: AelAcknowledgement,
): T {
  const r = result as Record<string, unknown>;
  const existing = (r._aelProvenance && typeof r._aelProvenance === "object")
    ? r._aelProvenance as Record<string, unknown>
    : {};
  r._aelProvenance = {
    ...existing,
    aelPartialPropagated: ack.partial === true,
    aelAcknowledgement: ack.reason,
    ...(ack.partialReason ? { aelPartialReason: ack.partialReason } : {}),
  };
  return result;
}

export function applyPartialAelDowngrade<T extends object>(
  engineName: string,
  result: T,
  ack: AelAcknowledgement,
): T {
  attachAelProvenance(result, ack);
  if (!ack.partial) return result;

  const r = result as Record<string, unknown>;
  const m = AEL_PARTIAL_CONFIDENCE_MULTIPLIER;
  const downgraded: string[] = [];

  for (const field of NUMERIC_DOWNGRADE_FIELDS) {
    const before = r[field];
    if (typeof before === "number") {
      const after = +(before * m).toFixed(4);
      r[field] = after;
      downgraded.push(`${field} ${before.toFixed(3)}→${after.toFixed(3)}`);
    }
  }

  const existing = (r._aelProvenance && typeof r._aelProvenance === "object")
    ? r._aelProvenance as Record<string, unknown>
    : {};
  r._aelProvenance = {
    ...existing,
    aelPartialDowngradeApplied: downgraded.length > 0,
    aelPartialDowngradeMultiplier: m,
    aelPartialDowngradeFields: downgraded,
  };

  console.log(`[${engineName}] AEL_PARTIAL_DOWNGRADE_APPLIED | multiplier=${m} | fields=[${downgraded.join("; ") || "none"}]`);
  return result;
}
