import { ENGINE_VERSION } from "./constants";
import { MI_CONFIDENCE } from "./constants";

export type EngineState = "READY" | "REFRESH_REQUIRED" | "REFRESHING" | "REFRESH_FAILED" | "BLOCKED";

export interface SnapshotIntegrityResult {
  valid: boolean;
  failures: string[];
}

export interface EngineReadinessResult {
  state: EngineState;
  diagnostics: EngineDiagnostics;
  reason?: string;
}

export interface EngineDiagnostics {
  snapshotFound: boolean;
  snapshotId: string | null;
  campaignIdMatch: boolean;
  versionMatch: boolean;
  freshnessValid: boolean;
  freshnessDays: number | null;
  integrityValid: boolean;
  integrityFailures: string[];
  engineState: EngineState;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifySnapshotIntegrity(
  snapshot: any,
  expectedVersion: number,
  campaignId: string
): SnapshotIntegrityResult {
  const failures: string[] = [];

  if (!snapshot) {
    return { valid: false, failures: ["snapshot is null or undefined"] };
  }

  if (!snapshot.id || typeof snapshot.id !== "string" || !UUID_REGEX.test(snapshot.id)) {
    failures.push(`invalid snapshot.id: ${snapshot.id}`);
  }

  if (!snapshot.createdAt) {
    failures.push("missing snapshot.createdAt");
  } else {
    const ts = new Date(snapshot.createdAt).getTime();
    if (isNaN(ts)) {
      failures.push(`invalid snapshot.createdAt: ${snapshot.createdAt}`);
    }
  }

  if (!snapshot.campaignId || snapshot.campaignId !== campaignId) {
    failures.push(`campaignId mismatch: snapshot=${snapshot.campaignId} expected=${campaignId}`);
  }

  const snapshotVersion = snapshot.analysisVersion ?? snapshot.version ?? 0;
  if (snapshotVersion !== expectedVersion) {
    failures.push(`version mismatch: snapshot=${snapshotVersion} expected=${expectedVersion}`);
  }

  const hasOutput = !!(
    snapshot.analysisOutput ||
    snapshot.output ||
    snapshot.signalData ||
    snapshot.confidenceData ||
    snapshot.marketState
  );
  if (!hasOutput) {
    failures.push("output payload missing or empty");
  }

  return { valid: failures.length === 0, failures };
}

export function getEngineReadinessState(
  snapshot: any,
  campaignId: string,
  expectedVersion: number = ENGINE_VERSION,
  freshnessThresholdDays: number = MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS
): EngineReadinessResult {
  const diagnostics: EngineDiagnostics = {
    snapshotFound: false,
    snapshotId: null,
    campaignIdMatch: false,
    versionMatch: false,
    freshnessValid: false,
    freshnessDays: null,
    integrityValid: false,
    integrityFailures: [],
    engineState: "BLOCKED",
  };

  if (!snapshot) {
    diagnostics.engineState = "REFRESH_REQUIRED";
    logDiagnostics("MI", diagnostics);
    return { state: "REFRESH_REQUIRED", diagnostics, reason: "No snapshot found" };
  }

  diagnostics.snapshotFound = true;
  diagnostics.snapshotId = snapshot.id || null;

  const integrity = verifySnapshotIntegrity(snapshot, expectedVersion, campaignId);
  diagnostics.integrityValid = integrity.valid;
  diagnostics.integrityFailures = integrity.failures;

  diagnostics.campaignIdMatch = snapshot.campaignId === campaignId;
  const snapshotVersion = snapshot.analysisVersion ?? snapshot.version ?? 0;
  diagnostics.versionMatch = snapshotVersion === expectedVersion;

  if (!integrity.valid) {
    const hasVersionMismatch = integrity.failures.some(f => f.includes("version mismatch"));
    const hasCampaignMismatch = integrity.failures.some(f => f.includes("campaignId mismatch"));

    if (hasVersionMismatch || hasCampaignMismatch) {
      diagnostics.engineState = "REFRESH_REQUIRED";
      logDiagnostics("MI", diagnostics);
      return { state: "REFRESH_REQUIRED", diagnostics, reason: `Integrity failed: ${integrity.failures.join("; ")}` };
    }

    diagnostics.engineState = "BLOCKED";
    logDiagnostics("MI", diagnostics);
    return { state: "BLOCKED", diagnostics, reason: `Integrity failed: ${integrity.failures.join("; ")}` };
  }

  const freshnessDays = snapshot.dataFreshnessDays ?? null;
  diagnostics.freshnessDays = freshnessDays;

  if (freshnessDays !== null && freshnessDays > freshnessThresholdDays) {
    diagnostics.freshnessValid = false;
    diagnostics.engineState = "REFRESH_REQUIRED";
    logDiagnostics("MI", diagnostics);
    return { state: "REFRESH_REQUIRED", diagnostics, reason: `Data stale: ${freshnessDays}d exceeds ${freshnessThresholdDays}d threshold` };
  }

  diagnostics.freshnessValid = true;
  diagnostics.engineState = "READY";
  logDiagnostics("MI", diagnostics);
  return { state: "READY", diagnostics };
}

export function logDiagnostics(engineName: string, diagnostics: EngineDiagnostics): void {
  console.log(`[${engineName}] Engine Status: snapshotFound=${diagnostics.snapshotFound} | snapshotId=${diagnostics.snapshotId?.slice(0, 8) || "N/A"} | campaignMatch=${diagnostics.campaignIdMatch} | versionMatch=${diagnostics.versionMatch} | freshnessDays=${diagnostics.freshnessDays ?? "N/A"} | freshnessValid=${diagnostics.freshnessValid} | integrityValid=${diagnostics.integrityValid} | state=${diagnostics.engineState}`);
  if (diagnostics.integrityFailures.length > 0) {
    console.log(`[${engineName}] Integrity failures: ${diagnostics.integrityFailures.join(", ")}`);
  }
}

export function checkMIDependencyForDownstream(
  miSnapshot: any,
  campaignId: string
): { ready: boolean; state: EngineState; reason?: string } {
  const readiness = getEngineReadinessState(miSnapshot, campaignId);
  if (readiness.state === "READY") {
    return { ready: true, state: "READY" };
  }
  return { ready: false, state: readiness.state, reason: readiness.reason };
}
