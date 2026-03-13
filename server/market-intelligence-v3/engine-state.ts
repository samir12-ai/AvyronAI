import { ENGINE_VERSION } from "./constants";
import { MI_CONFIDENCE } from "./constants";
import { db } from "../db";
import { miSnapshots } from "@shared/schema";
import { ne, eq, inArray, and } from "drizzle-orm";
import {
  computeStalenessCoefficient,
  validateSnapshotSchema,
  buildFreshnessMetadata,
  logFreshnessTraceability,
  type FreshnessClass,
  type FreshnessMetadata,
} from "../shared/snapshot-trust";

export type EngineState = "READY" | "REFRESH_REQUIRED" | "REFRESHING" | "REFRESH_FAILED" | "BLOCKED";

export interface SnapshotIntegrityResult {
  valid: boolean;
  failures: string[];
}

export interface EngineReadinessResult {
  state: EngineState;
  diagnostics: EngineDiagnostics;
  reason?: string;
  freshnessMetadata?: FreshnessMetadata;
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
  freshnessClass?: FreshnessClass;
  stalenessCoefficient?: number;
  trustScore?: number;
  schemaCompatible?: boolean;
  schemaVersion?: number;
  snapshotSchemaVersion?: number;
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

  const freshnessMetadata = buildFreshnessMetadata(snapshot);
  diagnostics.freshnessClass = freshnessMetadata.freshnessClass;
  diagnostics.stalenessCoefficient = freshnessMetadata.stalenessCoefficient;
  diagnostics.trustScore = freshnessMetadata.trustScore;
  diagnostics.schemaCompatible = freshnessMetadata.schemaCompatible;
  diagnostics.schemaVersion = freshnessMetadata.schemaVersion;
  diagnostics.snapshotSchemaVersion = freshnessMetadata.snapshotVersion;

  logFreshnessTraceability("MI", snapshot, freshnessMetadata);

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
      return { state: "REFRESH_REQUIRED", diagnostics, reason: `Integrity failed: ${integrity.failures.join("; ")}`, freshnessMetadata };
    }

    diagnostics.engineState = "BLOCKED";
    logDiagnostics("MI", diagnostics);
    return { state: "BLOCKED", diagnostics, reason: `Integrity failed: ${integrity.failures.join("; ")}`, freshnessMetadata };
  }

  const freshnessDays = snapshot.dataFreshnessDays ?? null;
  diagnostics.freshnessDays = freshnessDays;

  if (freshnessDays !== null && freshnessDays > freshnessThresholdDays) {
    diagnostics.freshnessValid = false;
    diagnostics.engineState = "REFRESH_REQUIRED";
    logDiagnostics("MI", diagnostics);
    return { state: "REFRESH_REQUIRED", diagnostics, reason: `Data stale: ${freshnessDays}d exceeds ${freshnessThresholdDays}d threshold`, freshnessMetadata };
  }

  diagnostics.freshnessValid = true;

  if (!freshnessMetadata.schemaCompatible) {
    diagnostics.engineState = "BLOCKED";
    logDiagnostics("MI", diagnostics);

    if (snapshot.id && snapshot.status !== "INCOMPATIBLE") {
      db.update(miSnapshots)
        .set({ status: "INCOMPATIBLE" })
        .where(and(eq(miSnapshots.id, snapshot.id), eq(miSnapshots.status, snapshot.status)))
        .then(() => console.log(`[MI] SCHEMA_GUARD | snapshot=${snapshot.id.slice(0, 8)} | status persisted as INCOMPATIBLE (v${freshnessMetadata.snapshotVersion} != v${freshnessMetadata.schemaVersion})`))
        .catch((err: any) => console.error(`[MI] SCHEMA_GUARD | failed to persist INCOMPATIBLE: ${err.message}`));
    }

    return {
      state: "BLOCKED",
      diagnostics,
      reason: `Snapshot schema incompatible with current engine (v${freshnessMetadata.snapshotVersion} vs v${freshnessMetadata.schemaVersion}). Re-run analysis.`,
      freshnessMetadata,
    };
  }

  if (freshnessMetadata.freshnessClass === "NEEDS_REFRESH") {
    diagnostics.engineState = "REFRESH_REQUIRED";
    logDiagnostics("MI", diagnostics);
    return {
      state: "REFRESH_REQUIRED",
      diagnostics,
      reason: `Data is ${Math.round(freshnessMetadata.ageInDays)}d old (max 7d for strategy). Re-run analysis.`,
      freshnessMetadata,
    };
  }

  diagnostics.engineState = "READY";
  logDiagnostics("MI", diagnostics);
  return { state: "READY", diagnostics, freshnessMetadata };
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

export async function invalidateStaleSnapshots(): Promise<{ invalidatedCount: number }> {
  console.log(`[MIv3] ENGINE_VERSION_CHECK | currentVersion=${ENGINE_VERSION} | action=startup_audit`);

  try {
    const activeSessions = await db.select({ campaignId: miSnapshots.campaignId })
      .from(miSnapshots)
      .where(inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]));
    const activeCampaignIds = new Set(activeSessions.map(s => s.campaignId));

    const staleSnapshots = await db.select({ id: miSnapshots.id, campaignId: miSnapshots.campaignId })
      .from(miSnapshots)
      .where(eq(miSnapshots.status, "STALE"));

    let recoveredCount = 0;
    let skippedCount = 0;
    for (const stale of staleSnapshots) {
      if (activeCampaignIds.has(stale.campaignId)) {
        skippedCount++;
        continue;
      }
      await db.update(miSnapshots)
        .set({ status: "COMPLETE" })
        .where(and(eq(miSnapshots.id, stale.id), eq(miSnapshots.status, "STALE")));
      recoveredCount++;
    }

    if (recoveredCount > 0 || skippedCount > 0) {
      console.log(`[MIv3] STALE_RECOVERY | recovered=${recoveredCount} | skipped=${skippedCount} (active session exists)`);
    }

    const oldVersionSnapshots = await db.select({ id: miSnapshots.id, analysisVersion: miSnapshots.analysisVersion })
      .from(miSnapshots)
      .where(ne(miSnapshots.analysisVersion, ENGINE_VERSION));

    const staleCount = oldVersionSnapshots.length;

    if (staleCount > 0) {
      console.log(`[MIv3] STARTUP_AUDIT_COMPLETE | outdatedSnapshots=${staleCount} | currentVersion=${ENGINE_VERSION} | action=SOFT_FLAG (snapshots preserved, version noted for downstream)`);
    } else {
      console.log(`[MIv3] STARTUP_AUDIT_COMPLETE | outdatedSnapshots=0 | allSnapshotsCurrentVersion=${ENGINE_VERSION}`);
    }

    return { invalidatedCount: 0 };
  } catch (error) {
    console.error(`[MIv3] STARTUP_AUDIT_ERROR | version=${ENGINE_VERSION} | error=${error}`);
    return { invalidatedCount: 0 };
  }
}
