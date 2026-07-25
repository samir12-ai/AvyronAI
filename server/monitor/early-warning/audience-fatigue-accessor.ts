import { detectCreativeFatigue } from "../../guardrails";
import type {
  CreativeFatigueSignal,
  Degradation,
  SignalOriginType,
} from "./shape";

/**
 * T-S10-6 — Shared accessor for audience/creative fatigue signal.
 *
 * Previously the orchestrator inlined a separate `r.fatigueSignals`/`creativeFatigue.signals`
 * consumer at server/orchestrator/index.ts:3095. This accessor consolidates the read
 * path so monitor + orchestrator share the same view of fatigue.
 *
 * NOTE: guardrails.detectCreativeFatigue is account-scoped, not campaign-scoped, so
 * the accessor surfaces account-level signal. The reasonCode list is derived
 * structurally from the reason string returned by the detector.
 */
export interface AudienceFatigueSignal {
  detected: boolean;
  reason: string | null;
  reasonCodes: CreativeFatigueSignal["reasonCodes"];
  affectedSurface: CreativeFatigueSignal["affectedSurface"];
  severity: CreativeFatigueSignal["severity"];
  signalOrigin: SignalOriginType;
  degraded: Degradation | null;
}

function deriveReasonCodes(reason: string | undefined): CreativeFatigueSignal["reasonCodes"] {
  if (!reason) return [];
  const codes: CreativeFatigueSignal["reasonCodes"] = [];
  const r = reason.toLowerCase();
  if (r.includes("insufficient data")) codes.push("INSUFFICIENT_DATA");
  if (r.includes("ctr dropped") || r.includes("ctr decline")) codes.push("CTR_DECLINE");
  if (r.includes("frequency")) codes.push("FREQUENCY_HIGH");
  if (r.includes("impressions rising")) codes.push("IMPRESSIONS_RISING");
  if (r.includes("reach")) codes.push("REACH_SATURATED");
  return codes;
}

export async function getAudienceFatigueSignal(accountId: string): Promise<AudienceFatigueSignal> {
  try {
    const raw = await detectCreativeFatigue(accountId);
    const reasonCodes = deriveReasonCodes(raw.reason);
    const insufficient = reasonCodes.includes("INSUFFICIENT_DATA");

    if (insufficient) {
      return {
        detected: false,
        reason: raw.reason ?? null,
        reasonCodes,
        affectedSurface: "unknown",
        severity: "unavailable",
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: raw.reason || "Insufficient performance data for fatigue analysis",
          source: "data_quality",
          signalOrigin: "unknown",
        },
      };
    }

    if (raw.detected) {
      const severity: CreativeFatigueSignal["severity"] = reasonCodes.length >= 3 ? "critical" : "warn";
      return {
        detected: true,
        reason: raw.reason ?? null,
        reasonCodes,
        affectedSurface: "creative",
        severity,
        signalOrigin: "real",
        degraded: null,
      };
    }

    return {
      detected: false,
      reason: raw.reason ?? null,
      reasonCodes,
      affectedSurface: "creative",
      severity: "none",
      signalOrigin: "real",
      degraded: null,
    };
  } catch (err: any) {
    return {
      detected: false,
      reason: err?.message ?? "Fatigue detector failed",
      reasonCodes: [],
      affectedSurface: "unknown",
      severity: "unavailable",
      signalOrigin: "unknown",
      degraded: {
        flag: true,
        reason: `Fatigue detector error: ${err?.message ?? "unknown"}`,
        source: "data_quality",
        signalOrigin: "unknown",
      },
    };
  }
}
