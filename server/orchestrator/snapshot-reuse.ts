import crypto from "crypto";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import {
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  integritySnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
} from "@shared/schema";
import { buildFreshnessMetadata } from "../shared/snapshot-trust";
import { ENFORCE_ENGINE_CONTRACTS } from "./contract-registry/feature-flags";

export const REUSE_LOG = "[Reuse]";

export function computeInputHash(...parts: any[]): string {
  const joined = parts
    .map((p) => (p == null ? "" : typeof p === "string" ? p : JSON.stringify(p)))
    .join("|");
  return crypto.createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

/**
 * Sentinel thrown when a cached snapshot row contains malformed JSON in a
 * required column. The reuse helpers catch it and treat the row as a MISS
 * (forcing regeneration) — never as a degraded HIT. This closes the
 * "silent fallback to empty array/object" path that previously let
 * corrupted cache rows propagate empty data downstream.
 */
class ReuseHydrationError extends Error {
  constructor(public field: string, public original: Error) {
    super(`Reuse hydration failed on field "${field}": ${original.message}`);
    this.name = "ReuseHydrationError";
  }
}

/**
 * STRICT parse — throws ReuseHydrationError on malformed JSON. The previous
 * implementation silently returned a fallback ([], {}) on parse failure,
 * letting corrupted cache rows look like successful HITs. Now every parse
 * failure invalidates the cache entry.
 *
 * Use `field` to identify which column failed in logs. `nullable` allows
 * legitimate null/empty columns to return null without throwing.
 */
function strictParse<T = any>(s: string | null | undefined, field: string): T | null {
  if (s == null || s === "") return null;
  if (typeof s !== "string") return s as any;
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    throw new ReuseHydrationError(field, e as Error);
  }
}

function isEmptyObject(v: any): boolean {
  return v == null || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
}

function isEmptyArray(v: any): boolean {
  return v == null || (Array.isArray(v) && v.length === 0);
}

async function findReusable(table: any, accountId: string, campaignId: string, inputHash: string): Promise<any | null> {
  const conditions = [
    eq(table.accountId, accountId),
    eq(table.campaignId, campaignId),
    eq(table.inputHash, inputHash),
  ];
  if (table.status) {
    conditions.push(eq(table.status, "COMPLETE"));
  }
  const rows = await db
    .select()
    .from(table)
    .where(and(...conditions))
    .orderBy(desc(table.createdAt))
    .limit(1);
  return rows[0] || null;
}

export function logReuseHit(engine: string, snapshotId: string, hash: string) {
  console.log(`${REUSE_LOG} ${engine} | HIT | snapshotId=${snapshotId} | hash=${hash}`);
}

export function logReuseMiss(engine: string, hash: string, reason: string = "no-match") {
  console.log(`${REUSE_LOG} ${engine} | MISS | hash=${hash} | reason=${reason}`);
}

function logReuseRejected(engine: string, snapshotId: string, hash: string, reason: string) {
  console.warn(`${REUSE_LOG} ${engine} | REJECTED | snapshotId=${snapshotId} | hash=${hash} | reason=${reason} — forcing regeneration`);
}

/**
 * Wraps a tryReuse* function: if hydration throws, or if the post-hydration
 * completeness predicate rejects the row, returns null so the caller treats
 * it as a cache MISS and re-runs the engine. NEVER returns a degraded HIT.
 */
async function safeReuse<H>(
  engine: string,
  inputHash: string,
  snap: any,
  hydrate: (snap: any) => H,
  completeness: (h: H) => string | null,
): Promise<{ snap: any; hydrated: H } | null> {
  if (!snap) return null;
  let hydrated: H;
  try {
    hydrated = hydrate(snap);
  } catch (e: any) {
    logReuseRejected(engine, snap.id, inputHash, `hydration_failed:${e.message}`);
    return null;
  }
  const incompleteReason = completeness(hydrated);
  if (incompleteReason) {
    logReuseRejected(engine, snap.id, inputHash, `incomplete:${incompleteReason}`);
    return null;
  }
  // Phase C4 — when enforcement is on, refuse reuse rows whose stored
  // `contractStatus` (set by C2 audit at write time, when present on the
  // snapshot row) is anything other than COMPLETE. Snapshots from before
  // the contract registry existed have no contractStatus and bypass this
  // gate via the per-engine completeness predicate above.
  if (ENFORCE_ENGINE_CONTRACTS) {
    const cs = (snap as any)?.contractStatus;
    if (cs && cs !== "COMPLETE") {
      logReuseRejected(engine, snap.id, inputHash, `contract_status:${cs}`);
      return null;
    }
  }
  // Phase R T002 — stamp every reuse hit with snapshot provenance so System
  // Control can detect stale evidence (sourceJobId !== currentJobId, or
  // freshness class NEEDS_REFRESH/INCOMPATIBLE) and so the dashboard can
  // surface "this engine output came from a prior run". The orchestrator
  // does NOT need to set this field on fresh-this-run executions; absent
  // provenance == fresh.
  try {
    const fm = buildFreshnessMetadata(snap);
    (hydrated as any)._provenance = {
      sourceJobId: snap.jobId ?? null,
      sourceSnapshotId: snap.id,
      createdAt: snap.createdAt ? new Date(snap.createdAt).toISOString() : null,
      wasReused: true,
      freshnessClass: fm.freshnessClass,
      ageInDays: fm.ageInDays,
    };
  } catch {
    // Provenance is best-effort — never reject a reuse hit because of it.
  }
  return { snap, hydrated };
}

// ============================================================
// PER-ENGINE FIND + HYDRATE (strict, with completeness gates)
// ============================================================

export async function tryReuseAudience(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(audienceSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "audience",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      languageSignals: strictParse(s.languageSignals, "languageSignals"),
      audiencePains: strictParse(s.audiencePains, "audiencePains"),
      desireMap: strictParse(s.desireMap, "desireMap"),
      objectionMap: strictParse(s.objectionMap, "objectionMap"),
      transformationMap: strictParse(s.transformationMap, "transformationMap"),
      emotionalDrivers: strictParse(s.emotionalDrivers, "emotionalDrivers"),
      audienceSegments: strictParse(s.audienceSegments, "audienceSegments"),
      segmentDensity: strictParse(s.segmentDensity, "segmentDensity"),
      awarenessLevel: strictParse(s.awarenessLevel, "awarenessLevel") ?? s.awarenessLevel,
      maturityIndex: strictParse(s.maturityIndex, "maturityIndex"),
      audienceIntentDistribution: strictParse(s.audienceIntentDistribution, "audienceIntentDistribution"),
      adsTargetingHints: strictParse(s.adsTargetingHints, "adsTargetingHints"),
      inputSummary: strictParse(s.inputSummary, "inputSummary"),
      signalLineage: strictParse(s.signalLineage, "signalLineage"),
      structuredSignals: strictParse(s.structuredSignals, "structuredSignals"),
      productDna: null,
    }),
    (h: any) => {
      // Audience MUST have non-empty pains and desire data — these are
      // required for every downstream engine. The original strategy-root bug
      // proved that an empty `audiencePains` array silently breaks the
      // entire offer pipeline, so we refuse to serve such a cache hit.
      if (isEmptyArray(h.audiencePains)) return "audiencePains_empty";
      // desireMap may legitimately be either an object {} or an array [] depending on
      // engine version; reject only if it's empty in BOTH possible shapes (i.e. truly empty).
      if (isEmptyObject(h.desireMap) || isEmptyArray(h.desireMap)) return "desireMap_empty";
      if (isEmptyObject(h.structuredSignals)) return "structuredSignals_empty";
      return null;
    },
  );
}

export async function tryReusePositioning(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(positioningSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "positioning",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      territory: strictParse(s.territory, "territory"),
      enemyDefinition: strictParse(s.enemyDefinition, "enemyDefinition"),
      contrastAxis: strictParse(s.contrastAxis, "contrastAxis") ?? s.contrastAxis,
      narrativeDirection: strictParse(s.narrativeDirection, "narrativeDirection") ?? s.narrativeDirection,
      differentiationVector: strictParse(s.differentiationVector, "differentiationVector"),
      proofSignals: strictParse(s.proofSignals, "proofSignals"),
      strategyCards: strictParse(s.strategyCards, "strategyCards"),
      territories: strictParse(s.territories, "territories"),
      stabilityResult: strictParse(s.stabilityResult, "stabilityResult"),
      marketPowerAnalysis: strictParse(s.marketPowerAnalysis, "marketPowerAnalysis"),
      opportunityGaps: strictParse(s.opportunityGaps, "opportunityGaps"),
      narrativeSaturation: strictParse(s.narrativeSaturation, "narrativeSaturation"),
      segmentPriority: strictParse(s.segmentPriority, "segmentPriority"),
      inputSummary: strictParse(s.inputSummary, "inputSummary"),
      confidenceScore: s.confidenceScore,
      signalTraceability: strictParse(s.signalTraceability, "signalTraceability"),
    }),
    (h: any) => {
      // Positioning needs at least a contrast axis and either a narrative
      // direction or a territory — without these there's nothing to position
      // against and the downstream Differentiation engine has no input.
      if (!h.contrastAxis) return "contrastAxis_missing";
      if (!h.narrativeDirection && isEmptyArray(h.territories) && !h.territory) return "narrative_and_territory_missing";
      return null;
    },
  );
}

export async function tryReuseDifferentiation(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(differentiationSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "differentiation",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      pillars: strictParse(s.differentiationPillars, "differentiationPillars"),
      differentiationPillars: strictParse(s.differentiationPillars, "differentiationPillars"),
      proofArchitecture: strictParse(s.proofArchitecture, "proofArchitecture"),
      claimStructures: strictParse(s.claimStructures, "claimStructures"),
      claims: strictParse(s.claimStructures, "claimStructures"),
      authorityMode: (strictParse(s.authorityMode, "authorityMode") as any)?.mode ?? null,
      authorityRationale: (strictParse(s.authorityMode, "authorityMode") as any)?.rationale ?? null,
      mechanismFraming: strictParse(s.mechanismFraming, "mechanismFraming"),
      mechanismCore: strictParse(s.mechanismCore, "mechanismCore"),
      trustPriorityMap: strictParse(s.trustPriorityMap, "trustPriorityMap"),
      claimScores: strictParse(s.claimScores, "claimScores"),
      collisionDiagnostics: strictParse(s.collisionDiagnostics, "collisionDiagnostics"),
      stabilityResult: strictParse(s.stabilityResult, "stabilityResult"),
      confidenceScore: s.confidenceScore,
      depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
    }),
    (h: any) => {
      if (isEmptyArray(h.pillars)) return "pillars_empty";
      if (isEmptyArray(h.claimStructures)) return "claimStructures_empty";
      return null;
    },
  );
}

export async function tryReuseMechanism(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(mechanismSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "mechanism",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      primaryMechanism: strictParse(s.primaryMechanism, "primaryMechanism"),
      alternativeMechanism: strictParse(s.alternativeMechanism, "alternativeMechanism"),
      axisConsistency: strictParse(s.axisConsistency, "axisConsistency"),
      confidenceScore: s.confidenceScore,
      engineVersion: s.engineVersion,
      depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
    }),
    (h: any) => {
      if (!h.primaryMechanism) return "primaryMechanism_missing";
      const name = (h.primaryMechanism as any)?.mechanismName;
      if (!name || (typeof name === "string" && name.trim().length === 0)) return "mechanismName_missing";
      return null;
    },
  );
}

export async function tryReuseOffer(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(offerSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "offer",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      primaryOffer: strictParse(s.primaryOffer, "primaryOffer"),
      alternativeOffer: strictParse(s.alternativeOffer, "alternativeOffer"),
      rejectedOffer: strictParse(s.rejectedOffer, "rejectedOffer"),
      offerStrengthScore: s.offerStrengthScore,
      positioningConsistency: strictParse(s.positioningConsistency, "positioningConsistency"),
      hookMechanismAlignment: strictParse(s.hookMechanismAlignment, "hookMechanismAlignment"),
      boundaryCheck: strictParse(s.boundaryCheck, "boundaryCheck"),
      confidenceScore: s.confidenceScore,
      selectedOption: s.selectedOption,
      signalLineage: strictParse(s.signalLineage, "signalLineage"),
      structuralWarnings: strictParse(s.structuralWarnings, "structuralWarnings"),
      layerDiagnostics: strictParse(s.layerDiagnostics, "layerDiagnostics"),
      strategyRootId: s.strategyRootId,
      engineVersion: s.engineVersion,
    }),
    (h: any) => {
      if (!h.primaryOffer) return "primaryOffer_missing";
      const po = h.primaryOffer as any;
      if (!po.coreOutcome && !po.offerName && !po.headline) return "primaryOffer_fields_missing";
      if (!h.strategyRootId) return "strategyRootId_missing";
      return null;
    },
  );
}

export async function tryReuseAwareness(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(awarenessSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "awareness",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      primaryRoute: strictParse(s.primaryRoute, "primaryRoute"),
      alternativeRoute: strictParse(s.alternativeRoute, "alternativeRoute"),
      rejectedRoute: strictParse(s.rejectedRoute, "rejectedRoute"),
      layerResults: strictParse(s.layerResults, "layerResults"),
      structuralWarnings: strictParse(s.structuralWarnings, "structuralWarnings"),
      boundaryCheck: strictParse(s.boundaryCheck, "boundaryCheck"),
      dataReliability: strictParse(s.dataReliability, "dataReliability"),
      confidenceNormalized: s.confidenceNormalized,
      awarenessStrengthScore: s.awarenessStrengthScore,
      signalLineage: strictParse(s.signalLineage, "signalLineage"),
      engineVersion: s.engineVersion,
    }),
    (h: any) => {
      if (!h.primaryRoute) return "primaryRoute_missing";
      return null;
    },
  );
}

export async function tryReuseFunnel(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(funnelSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "funnel",
    inputHash,
    snap,
    (s) => {
      const primaryFunnel = strictParse(s.primaryFunnel, "primaryFunnel");
      return {
        snapshotId: s.id,
        // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
        status: s.status || "COMPLETE",
        statusMessage: s.statusMessage,
        primaryFunnel,
        alternativeFunnel: strictParse(s.alternativeFunnel, "alternativeFunnel"),
        rejectedFunnel: strictParse(s.rejectedFunnel, "rejectedFunnel"),
        funnelStrengthScore: s.funnelStrengthScore,
        trustPathAnalysis: strictParse(s.trustPathAnalysis, "trustPathAnalysis"),
        proofPlacementLogic: strictParse(s.proofPlacementLogic, "proofPlacementLogic"),
        frictionMap: strictParse(s.frictionMap, "frictionMap"),
        boundaryCheck: strictParse(s.boundaryCheck, "boundaryCheck"),
        confidenceScore: s.confidenceScore,
        selectedOption: s.selectedOption,
        strategyRootId: s.strategyRootId,
        layerDiagnostics: strictParse(s.layerDiagnostics, "layerDiagnostics"),
        engineVersion: s.engineVersion,
        stages: (primaryFunnel as any)?.stages || [],
        depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
      };
    },
    (h: any) => {
      if (!h.primaryFunnel) return "primaryFunnel_missing";
      if (isEmptyArray(h.stages)) return "stages_empty";
      if (!h.strategyRootId) return "strategyRootId_missing";
      return null;
    },
  );
}

export async function tryReusePersuasion(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(persuasionSnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "persuasion",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      primaryRoute: strictParse(s.primaryRoute, "primaryRoute"),
      alternativeRoute: strictParse(s.alternativeRoute, "alternativeRoute"),
      rejectedRoute: strictParse(s.rejectedRoute, "rejectedRoute"),
      layerResults: strictParse(s.layerResults, "layerResults"),
      structuralWarnings: strictParse(s.structuralWarnings, "structuralWarnings"),
      boundaryCheck: strictParse(s.boundaryCheck, "boundaryCheck"),
      dataReliability: strictParse(s.dataReliability, "dataReliability"),
      confidenceNormalized: s.confidenceNormalized,
      persuasionStrengthScore: s.persuasionStrengthScore,
      signalLineage: strictParse(s.signalLineage, "signalLineage"),
      engineVersion: s.engineVersion,
    }),
    (h: any) => {
      if (!h.primaryRoute) return "primaryRoute_missing";
      return null;
    },
  );
}

export async function tryReuseIntegrity(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(integritySnapshots, accountId, campaignId, inputHash);
  return safeReuse(
    "integrity",
    inputHash,
    snap,
    (s) => ({
      snapshotId: s.id,
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      status: s.status || "COMPLETE",
      statusMessage: s.statusMessage,
      overallIntegrityScore: s.overallIntegrityScore,
      safeToExecute: s.safeToExecute,
      layerResults: strictParse(s.layerResults, "layerResults"),
      structuralWarnings: strictParse(s.structuralWarnings, "structuralWarnings"),
      flaggedInconsistencies: strictParse(s.flaggedInconsistencies, "flaggedInconsistencies"),
      boundaryCheck: strictParse(s.boundaryCheck, "boundaryCheck"),
      engineVersion: s.engineVersion,
    }),
    (h: any) => {
      if (h.safeToExecute === null || h.safeToExecute === undefined) return "safeToExecute_missing";
      if (!h.layerResults) return "layerResults_missing";
      return null;
    },
  );
}

// Strategic-loop snapshots (StatVal/BG/CS/Iter/Retention) store their full
// payload in a single `result` JSON column. A reuse hit must therefore parse
// that column AND have at least one key — an empty `{}` is treated as a MISS.

async function tryReuseStrategicLoop(
  engine: string,
  table: any,
  accountId: string,
  campaignId: string,
  inputHash: string,
) {
  const snap = await findReusable(table, accountId, campaignId, inputHash);
  return safeReuse(
    engine,
    inputHash,
    snap,
    (s) => {
      const result = strictParse((s as any).result, "result");
      // eslint-disable-next-line semantic/no-semantic-fallback -- P (H8): persistence read of generic DB `status` column (H9 typed-snapshot-reader pending)
      return { snapshotId: s.id, status: s.status || "COMPLETE", _result: result, ...(result as any || {}) };
    },
    (h: any) => {
      if (!h._result || isEmptyObject(h._result)) return "result_empty";
      return null;
    },
  );
}

export async function tryReuseStatVal(accountId: string, campaignId: string, inputHash: string) {
  return tryReuseStrategicLoop("strategy_validation", strategyValidationSnapshots, accountId, campaignId, inputHash);
}

export async function tryReuseBudgetGovernor(accountId: string, campaignId: string, inputHash: string) {
  return tryReuseStrategicLoop("budget_governor", budgetGovernorSnapshots, accountId, campaignId, inputHash);
}

export async function tryReuseChannelSelection(accountId: string, campaignId: string, inputHash: string) {
  return tryReuseStrategicLoop("channel_selection", channelSelectionSnapshots, accountId, campaignId, inputHash);
}

export async function tryReuseIteration(accountId: string, campaignId: string, inputHash: string) {
  return tryReuseStrategicLoop("iteration", iterationSnapshots, accountId, campaignId, inputHash);
}

export async function tryReuseRetention(accountId: string, campaignId: string, inputHash: string) {
  return tryReuseStrategicLoop("retention", retentionSnapshots, accountId, campaignId, inputHash);
}
