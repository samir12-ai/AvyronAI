import type { AnalyticalPackage } from "./types";

export interface AelAcknowledgement {
  usable: boolean;
  partial: boolean;
  reason: "AEL_OK" | "AEL_MISSING" | "AEL_PARTIAL";
  partialReason?: string;
}

export function acknowledgeAelInput(
  engineName: string,
  ael: AnalyticalPackage | null | undefined,
  accountId?: string,
): AelAcknowledgement {
  if (!ael) {
    console.log(`[${engineName}] AEL_MISSING_PROPAGATED | accountId=${accountId || "n/a"} | reason=AEL_MISSING`);
    return { usable: false, partial: false, reason: "AEL_MISSING" };
  }
  if ((ael as any).isPartial === true) {
    const partialReason = (ael as any).partialReason || "unknown";
    console.log(`[${engineName}] AEL_PARTIAL_PROPAGATED | accountId=${accountId || "n/a"} | reason=AEL_PARTIAL | partialReason=${partialReason}`);
    return { usable: true, partial: true, reason: "AEL_PARTIAL", partialReason };
  }
  return { usable: true, partial: false, reason: "AEL_OK" };
}

export function attachAelProvenance<T extends Record<string, any>>(
  result: T,
  ack: AelAcknowledgement,
): T {
  const existing = (result as any)._provenance && typeof (result as any)._provenance === "object"
    ? (result as any)._provenance
    : {};
  (result as any)._provenance = {
    ...existing,
    aelPartialPropagated: ack.partial === true,
    aelAcknowledgement: ack.reason,
    ...(ack.partialReason ? { aelPartialReason: ack.partialReason } : {}),
  };
  return result;
}
