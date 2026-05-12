import type { AnalyticalPackage } from "./types";

export interface AelAcknowledgement {
  usable: boolean;
  partial: boolean;
  reason: "AEL_OK" | "AEL_MISSING" | "AEL_PARTIAL";
  partialReason?: string;
}

export const AEL_PARTIAL_CONFIDENCE_MULTIPLIER = 0.7;

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

interface ProvenanceCarrier {
  _provenance?: Record<string, unknown>;
}

export function attachAelProvenance<T extends ProvenanceCarrier>(
  result: T,
  ack: AelAcknowledgement,
): T {
  const existing = result._provenance && typeof result._provenance === "object"
    ? result._provenance
    : {};
  result._provenance = {
    ...existing,
    aelPartialPropagated: ack.partial === true,
    aelAcknowledgement: ack.reason,
    ...(ack.partialReason ? { aelPartialReason: ack.partialReason } : {}),
  };
  return result;
}

interface ConfidenceCarrier extends ProvenanceCarrier {
  confidenceScore?: number;
  score?: number;
  offerStrengthScore?: number;
  engineConfidence?: number;
}

export function applyPartialAelDowngrade<T extends ConfidenceCarrier>(
  engineName: string,
  result: T,
  ack: AelAcknowledgement,
): T {
  attachAelProvenance(result, ack);
  if (!ack.partial) return result;

  const m = AEL_PARTIAL_CONFIDENCE_MULTIPLIER;
  const downgraded: string[] = [];

  if (typeof result.confidenceScore === "number") {
    const before = result.confidenceScore;
    result.confidenceScore = +(before * m).toFixed(4);
    downgraded.push(`confidenceScore ${before.toFixed(3)}→${result.confidenceScore.toFixed(3)}`);
  }
  if (typeof result.score === "number") {
    const before = result.score;
    result.score = +(before * m).toFixed(4);
    downgraded.push(`score ${before.toFixed(3)}→${result.score.toFixed(3)}`);
  }
  if (typeof result.offerStrengthScore === "number") {
    const before = result.offerStrengthScore;
    result.offerStrengthScore = +(before * m).toFixed(4);
    downgraded.push(`offerStrengthScore ${before.toFixed(3)}→${result.offerStrengthScore.toFixed(3)}`);
  }
  if (typeof result.engineConfidence === "number") {
    const before = result.engineConfidence;
    result.engineConfidence = +(before * m).toFixed(4);
    downgraded.push(`engineConfidence ${before.toFixed(3)}→${result.engineConfidence.toFixed(3)}`);
  }

  result._provenance = {
    ...(result._provenance || {}),
    aelPartialDowngradeApplied: downgraded.length > 0,
    aelPartialDowngradeMultiplier: m,
    aelPartialDowngradeFields: downgraded,
  };

  console.log(`[${engineName}] AEL_PARTIAL_DOWNGRADE_APPLIED | multiplier=${m} | fields=[${downgraded.join("; ") || "none"}]`);
  return result;
}
