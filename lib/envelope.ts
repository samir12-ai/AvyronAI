export type SnapshotTrustState =
  | "FRESH_VERIFIED"
  | "CURRENT_RUN_VERIFIED"
  | "REUSED_ALLOWED"
  | "REUSED_UNVERIFIED"
  | "WRONG_RUN"
  | "STALE"
  | "NEEDS_REFRESH"
  | "INCOMPATIBLE_VERSION"
  | "LEGACY_UNVERIFIED"
  | "CONTRACT_INCOMPLETE"
  // P5 isolation seal — cross-tenant / cross-campaign kill-switch states.
  // Mirrors `server/orchestrator/contract-registry/types.ts`. Never
  // live-eligible; the FE renders them as a hard security badge.
  | "WRONG_ACCOUNT"
  | "WRONG_CAMPAIGN";

export type FreshnessClass = "FRESH" | "AGING" | "STALE" | "NEEDS_REFRESH" | "INCOMPATIBLE";

export type ContractStatus = "COMPLETE" | "INCOMPLETE" | "INVALID" | "LEGACY_NONE";

export interface LiveSnapshotEnvelope<T = unknown> {
  runId: string | null;
  snapshotId: string;
  sourceJobId: string | null;
  campaignId: string;
  engineId: string;
  engineVersion: number;

  trustState: SnapshotTrustState;
  freshnessClass: FreshnessClass | null;
  contractStatus: ContractStatus;
  missingRequiredOutputs: string[];
  invalidFields: { fieldId: string; reason: string }[];
  wasReused: boolean;
  ageInDays: number | null;

  isLiveEvidence: boolean;
  isHistoricalOnly: boolean;

  data?: T;
}

export function requireLiveSnapshot(
  envelope: LiveSnapshotEnvelope | null | undefined,
): boolean {
  return envelope?.isLiveEvidence === true;
}

export type EnvelopeBadgeKind = "live" | "reused" | "stale" | "incomplete" | "unknown";

export interface EnvelopeBadgeMeta {
  kind: EnvelopeBadgeKind;
  label: string;
  detail: string;
  color: string;
}

export function classifyEnvelopeBadge(
  envelope: LiveSnapshotEnvelope | null | undefined,
): EnvelopeBadgeMeta | null {
  if (!envelope) return null;

  if (envelope.contractStatus === "INCOMPLETE" || envelope.contractStatus === "INVALID") {
    return {
      kind: "incomplete",
      label: "Contract incomplete",
      detail:
        envelope.missingRequiredOutputs.length > 0
          ? `Missing: ${envelope.missingRequiredOutputs.slice(0, 3).join(", ")}`
          : "Engine output missing required fields",
      color: "#EF4444",
    };
  }

  if (envelope.isLiveEvidence) {
    if (envelope.trustState === "REUSED_ALLOWED" || envelope.wasReused) {
      const age = envelope.ageInDays;
      return {
        kind: "reused",
        label: "Reused snapshot",
        detail:
          age !== null && age !== undefined
            ? `Reused from prior run · ${age}d old`
            : "Reused from prior run",
        color: "#3B82F6",
      };
    }
    return {
      kind: "live",
      label: "Live evidence",
      detail: envelope.trustState === "FRESH_VERIFIED" ? "Fresh from current run" : "Verified for current run",
      color: "#10B981",
    };
  }

  // P5 isolation seal — cross-tenant kill-switch states. Render as hard
  // error badge so the user sees this is a SECURITY block, not a freshness
  // issue. Should never appear in normal operation.
  if (envelope.trustState === "WRONG_ACCOUNT" || envelope.trustState === "WRONG_CAMPAIGN") {
    return {
      kind: "incomplete",
      label: "Cross-tenant block",
      detail:
        envelope.trustState === "WRONG_ACCOUNT"
          ? "Snapshot belongs to a different account — blocked"
          : "Snapshot belongs to a different campaign — blocked",
      color: "#EF4444",
    };
  }

  // Fresh manual re-analysis: newer than the last full-analysis run, so it
  // isn't bound to the current verdict (WRONG_RUN), but telling the user to
  // "re-run" would be a self-contradicting instruction — a manual re-run can
  // never rebind it; only a full analysis does. Presentation-only branch;
  // trust classification untouched.
  if (
    envelope.trustState === "WRONG_RUN" &&
    envelope.wasReused &&
    envelope.freshnessClass === "FRESH"
  ) {
    return {
      kind: "reused",
      label: "Latest analysis",
      detail: "Newer than your last full analysis — run a full analysis to apply it everywhere",
      color: "#3B82F6",
    };
  }

  if (
    envelope.trustState === "STALE" ||
    envelope.trustState === "WRONG_RUN" ||
    envelope.trustState === "NEEDS_REFRESH" ||
    envelope.trustState === "REUSED_UNVERIFIED" ||
    envelope.freshnessClass === "STALE" ||
    envelope.freshnessClass === "NEEDS_REFRESH"
  ) {
    return {
      kind: "stale",
      label: "Historical snapshot",
      detail: "Not used for current verdict — re-run to refresh",
      color: "#F59E0B",
    };
  }

  if (envelope.trustState === "INCOMPATIBLE_VERSION" || envelope.freshnessClass === "INCOMPATIBLE") {
    return {
      kind: "incomplete",
      label: "Version incompatible",
      detail: "Engine output from an older schema — re-run required",
      color: "#EF4444",
    };
  }

  if (envelope.trustState === "LEGACY_UNVERIFIED" || envelope.contractStatus === "LEGACY_NONE") {
    return {
      kind: "stale",
      label: "Legacy snapshot",
      detail: "No contract metadata — historical only",
      color: "#F59E0B",
    };
  }

  return {
    kind: "unknown",
    label: "Unverified",
    detail: `Trust state: ${envelope.trustState}`,
    color: "#8892A4",
  };
}
