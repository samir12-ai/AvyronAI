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

export const REUSE_LOG = "[Reuse]";

export function computeInputHash(...parts: any[]): string {
  const joined = parts
    .map((p) => (p == null ? "" : typeof p === "string" ? p : JSON.stringify(p)))
    .join("|");
  return crypto.createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

function safeParse<T = any>(s: string | null | undefined, fallback: T | null = null): T | null {
  if (s == null) return fallback;
  if (typeof s !== "string") return s as any;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
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

// ============================================================
// PER-ENGINE FIND + HYDRATE
// ============================================================

export async function tryReuseAudience(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(audienceSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      languageSignals: safeParse(snap.languageSignals, {}),
      painProfiles: safeParse(snap.audiencePains, []),
      desireMap: safeParse(snap.desireMap, {}),
      objectionMap: safeParse(snap.objectionMap, []),
      transformationMap: safeParse(snap.transformationMap, {}),
      emotionalDrivers: safeParse(snap.emotionalDrivers, []),
      audienceSegments: safeParse(snap.audienceSegments, []),
      segmentDensity: safeParse(snap.segmentDensity, {}),
      awarenessLevel: safeParse(snap.awarenessLevel) ?? snap.awarenessLevel,
      maturityIndex: safeParse(snap.maturityIndex),
      audienceIntentDistribution: safeParse(snap.audienceIntentDistribution, {}),
      adsTargetingHints: safeParse(snap.adsTargetingHints, {}),
      inputSummary: safeParse(snap.inputSummary, {}),
      signalLineage: safeParse(snap.signalLineage, {}),
      structuredSignals: safeParse(snap.structuredSignals, {
        pain_clusters: [],
        desire_clusters: [],
        pattern_clusters: [],
        root_causes: [],
        psychological_drivers: [],
      }),
      productDna: null,
    },
  };
}

export async function tryReusePositioning(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(positioningSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      territory: safeParse(snap.territory),
      enemyDefinition: safeParse(snap.enemyDefinition),
      contrastAxis: safeParse(snap.contrastAxis) ?? snap.contrastAxis,
      narrativeDirection: safeParse(snap.narrativeDirection) ?? snap.narrativeDirection,
      differentiationVector: safeParse(snap.differentiationVector, []),
      proofSignals: safeParse(snap.proofSignals, []),
      strategyCards: safeParse(snap.strategyCards, []),
      territories: safeParse(snap.territories, []),
      stabilityResult: safeParse(snap.stabilityResult),
      marketPowerAnalysis: safeParse(snap.marketPowerAnalysis),
      opportunityGaps: safeParse(snap.opportunityGaps, []),
      narrativeSaturation: safeParse(snap.narrativeSaturation),
      segmentPriority: safeParse(snap.segmentPriority, []),
      inputSummary: safeParse(snap.inputSummary, {}),
      confidenceScore: snap.confidenceScore,
      signalTraceability: safeParse(snap.signalTraceability),
    },
  };
}

export async function tryReuseDifferentiation(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(differentiationSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      pillars: safeParse(snap.differentiationPillars, []),
      differentiationPillars: safeParse(snap.differentiationPillars, []),
      proofArchitecture: safeParse(snap.proofArchitecture),
      claimStructures: safeParse(snap.claimStructures, []),
      claims: safeParse(snap.claimStructures, []),
      authorityMode: safeParse(snap.authorityMode)?.mode ?? null,
      authorityRationale: safeParse(snap.authorityMode)?.rationale ?? null,
      mechanismFraming: safeParse(snap.mechanismFraming),
      mechanismCore: safeParse(snap.mechanismCore),
      trustPriorityMap: safeParse(snap.trustPriorityMap),
      claimScores: safeParse(snap.claimScores),
      collisionDiagnostics: safeParse(snap.collisionDiagnostics),
      stabilityResult: safeParse(snap.stabilityResult),
      confidenceScore: snap.confidenceScore,
      depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
    },
  };
}

export async function tryReuseMechanism(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(mechanismSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      primaryMechanism: safeParse(snap.primaryMechanism),
      alternativeMechanism: safeParse(snap.alternativeMechanism),
      axisConsistency: safeParse(snap.axisConsistency),
      confidenceScore: snap.confidenceScore,
      engineVersion: snap.engineVersion,
      depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
    },
  };
}

export async function tryReuseOffer(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(offerSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      primaryOffer: safeParse(snap.primaryOffer),
      alternativeOffer: safeParse(snap.alternativeOffer),
      rejectedOffer: safeParse(snap.rejectedOffer),
      offerStrengthScore: snap.offerStrengthScore,
      positioningConsistency: safeParse(snap.positioningConsistency),
      hookMechanismAlignment: safeParse(snap.hookMechanismAlignment),
      boundaryCheck: safeParse(snap.boundaryCheck),
      confidenceScore: snap.confidenceScore,
      selectedOption: snap.selectedOption,
      signalLineage: safeParse(snap.signalLineage),
      structuralWarnings: safeParse(snap.structuralWarnings, []),
      layerDiagnostics: safeParse(snap.layerDiagnostics),
      strategyRootId: snap.strategyRootId,
      engineVersion: snap.engineVersion,
    },
  };
}

export async function tryReuseAwareness(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(awarenessSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      primaryRoute: safeParse(snap.primaryRoute),
      alternativeRoute: safeParse(snap.alternativeRoute),
      rejectedRoute: safeParse(snap.rejectedRoute),
      layerResults: safeParse(snap.layerResults),
      structuralWarnings: safeParse(snap.structuralWarnings, []),
      boundaryCheck: safeParse(snap.boundaryCheck),
      dataReliability: safeParse(snap.dataReliability),
      confidenceNormalized: snap.confidenceNormalized,
      awarenessStrengthScore: snap.awarenessStrengthScore,
      signalLineage: safeParse(snap.signalLineage),
      engineVersion: snap.engineVersion,
    },
  };
}

export async function tryReuseFunnel(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(funnelSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      primaryFunnel: safeParse(snap.primaryFunnel),
      alternativeFunnel: safeParse(snap.alternativeFunnel),
      rejectedFunnel: safeParse(snap.rejectedFunnel),
      funnelStrengthScore: snap.funnelStrengthScore,
      trustPathAnalysis: safeParse(snap.trustPathAnalysis),
      proofPlacementLogic: safeParse(snap.proofPlacementLogic),
      frictionMap: safeParse(snap.frictionMap),
      boundaryCheck: safeParse(snap.boundaryCheck),
      confidenceScore: snap.confidenceScore,
      selectedOption: snap.selectedOption,
      strategyRootId: snap.strategyRootId,
      layerDiagnostics: safeParse(snap.layerDiagnostics),
      engineVersion: snap.engineVersion,
      stages: safeParse(snap.primaryFunnel)?.stages || [],
      depthGateResult: { status: "CACHED", attempt: 0, maxAttempts: 0 },
    },
  };
}

export async function tryReusePersuasion(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(persuasionSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      primaryRoute: safeParse(snap.primaryRoute),
      alternativeRoute: safeParse(snap.alternativeRoute),
      rejectedRoute: safeParse(snap.rejectedRoute),
      layerResults: safeParse(snap.layerResults),
      structuralWarnings: safeParse(snap.structuralWarnings, []),
      boundaryCheck: safeParse(snap.boundaryCheck),
      dataReliability: safeParse(snap.dataReliability),
      confidenceNormalized: snap.confidenceNormalized,
      persuasionStrengthScore: snap.persuasionStrengthScore,
      signalLineage: safeParse(snap.signalLineage),
      engineVersion: snap.engineVersion,
    },
  };
}

export async function tryReuseIntegrity(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(integritySnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  return {
    snap,
    hydrated: {
      snapshotId: snap.id,
      status: snap.status || "COMPLETE",
      statusMessage: snap.statusMessage,
      overallIntegrityScore: snap.overallIntegrityScore,
      safeToExecute: snap.safeToExecute,
      layerResults: safeParse(snap.layerResults),
      structuralWarnings: safeParse(snap.structuralWarnings, []),
      flaggedInconsistencies: safeParse(snap.flaggedInconsistencies, []),
      boundaryCheck: safeParse(snap.boundaryCheck),
      engineVersion: snap.engineVersion,
    },
  };
}

export async function tryReuseStatVal(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(strategyValidationSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  const result = safeParse((snap as any).result) || {};
  return {
    snap,
    hydrated: { snapshotId: snap.id, status: snap.status || "COMPLETE", ...result },
  };
}

export async function tryReuseBudgetGovernor(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(budgetGovernorSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  const result = safeParse((snap as any).result) || {};
  return {
    snap,
    hydrated: { snapshotId: snap.id, status: snap.status || "COMPLETE", ...result },
  };
}

export async function tryReuseChannelSelection(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(channelSelectionSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  const result = safeParse((snap as any).result) || {};
  return {
    snap,
    hydrated: { snapshotId: snap.id, status: snap.status || "COMPLETE", ...result },
  };
}

export async function tryReuseIteration(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(iterationSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  const result = safeParse((snap as any).result) || {};
  return {
    snap,
    hydrated: { snapshotId: snap.id, status: snap.status || "COMPLETE", ...result },
  };
}

export async function tryReuseRetention(accountId: string, campaignId: string, inputHash: string) {
  const snap = await findReusable(retentionSnapshots, accountId, campaignId, inputHash);
  if (!snap) return null;
  const result = safeParse((snap as any).result) || {};
  return {
    snap,
    hydrated: { snapshotId: snap.id, status: snap.status || "COMPLETE", ...result },
  };
}
