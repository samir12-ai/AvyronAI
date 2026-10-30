import crypto from "crypto";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import {
  miSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  audienceSnapshots,
} from "@shared/schema";

export interface MiVersionedInputFingerprint {
  snapshotId: string;
  competitorHash: string | null;
  contentHash: string | null;
  postSampleSize: number | null;
  commentSampleSize: number | null;
  opportunityCount: number;
  threatCount: number;
  compositeFingerprint: string | null;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  equivalenceMode: "EXACT_SNAPSHOT_ID" | "EQUIVALENT_VERSIONED_INPUTS" | "COMPATIBLE_EVIDENCE_BASE" | "INCOMPATIBLE";
  reason: string;
  expectedSnapshotId: string | null;
  actualSnapshotId: string | null;
}

export interface BundleLineageMismatch {
  engine: string;
  snapshotId: string | null;
  dependencyField: string;
  expectedValue: string | null;
  actualValue: string | null;
  reason: string;
}

export interface BundleLineageValidationResult {
  compatible: boolean;
  mismatches: BundleLineageMismatch[];
}

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val !== "string") return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

/**
 * Computes a deterministic versioned input fingerprint for a Market Intelligence snapshot row.
 * Different orchestrator run IDs (jobId) or timestamps do NOT change this fingerprint if the
 * underlying competitor set, content hash, sample sizes, and extracted signals are identical.
 */
export function computeMiVersionedInputFingerprint(miRow: any): MiVersionedInputFingerprint {
  if (!miRow || typeof miRow !== "object") {
    return {
      snapshotId: "",
      competitorHash: null,
      contentHash: null,
      postSampleSize: null,
      commentSampleSize: null,
      opportunityCount: 0,
      threatCount: 0,
      compositeFingerprint: null,
    };
  }

  const snapshotId = String(miRow.id || miRow.snapshotId || "");
  const telemetry = safeJsonParse<Record<string, any>>(miRow.telemetry, {});
  const rawCompetitorHash = miRow.competitorHash ?? miRow.competitor_hash ?? telemetry?.competitorHash ?? null;
  const competitorHash = typeof rawCompetitorHash === "string" && rawCompetitorHash.trim()
    ? rawCompetitorHash.trim()
    : null;
  const rawContentHash = miRow.contentHash ?? miRow.content_hash ?? telemetry?.contentHash ?? telemetry?.content_hash ?? null;
  const contentHash = typeof rawContentHash === "string" && rawContentHash.trim()
    ? rawContentHash.trim()
    : null;
  const rawPostSample = miRow.postSampleSize ?? miRow.post_sample_size ?? telemetry?.postSampleSize ?? telemetry?.postsProcessed ?? null;
  const postSampleSize = typeof rawPostSample === "number" ? rawPostSample : null;
  const rawCommentSample = miRow.commentSampleSize ?? miRow.comment_sample_size ?? telemetry?.commentSampleSize ?? telemetry?.commentsProcessed ?? null;
  const commentSampleSize = typeof rawCommentSample === "number" ? rawCommentSample : null;

  const oppSignals = safeJsonParse<any[]>(miRow.opportunitySignals ?? miRow.opportunity_signals, []);
  const threatSignals = safeJsonParse<any[]>(miRow.threatSignals ?? miRow.threat_signals, []);
  const opportunityCount = Array.isArray(oppSignals) ? oppSignals.length : 0;
  const threatCount = Array.isArray(threatSignals) ? threatSignals.length : 0;

  if (!competitorHash || !contentHash) {
    return {
      snapshotId,
      competitorHash,
      contentHash,
      postSampleSize,
      commentSampleSize,
      opportunityCount,
      threatCount,
      compositeFingerprint: null,
    };
  }

  const rawPayload = JSON.stringify({
    competitorHash,
    contentHash,
    postSampleSize,
    commentSampleSize,
    opportunityCount,
    threatCount,
  });
  const compositeFingerprint = `mifp_${crypto.createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;

  return {
    snapshotId,
    competitorHash,
    contentHash,
    postSampleSize,
    commentSampleSize,
    opportunityCount,
    threatCount,
    compositeFingerprint,
  };
}

/**
 * Synchronous MI snapshot compatibility check using preloaded MI rows or an in-memory map.
 * - Exact snapshot ID match -> compatible (EXACT_SNAPSHOT_ID)
 * - Different snapshot IDs -> compatible ONLY if both MI rows are present and have identical
 *   non-empty versioned input fingerprints (EQUIVALENT_VERSIONED_INPUTS).
 * - Missing MI row or differing fingerprints -> INCOMPATIBLE.
 */
export function areMiSnapshotsCompatibleSync(
  actualMiSnapshotId: string | null | undefined,
  expectedMiSnapshotId: string | null | undefined,
  miRowLookup?: Map<string, any> | Record<string, any> | null,
): CompatibilityCheckResult {
  const actualId = actualMiSnapshotId ? String(actualMiSnapshotId).trim() : null;
  const expectedId = expectedMiSnapshotId ? String(expectedMiSnapshotId).trim() : null;

  if (!expectedId) {
    return {
      compatible: Boolean(actualId),
      equivalenceMode: actualId ? "EXACT_SNAPSHOT_ID" : "INCOMPATIBLE",
      reason: actualId ? "No expected MI snapshot constraint specified" : "Actual MI snapshot ID is missing",
      expectedSnapshotId: expectedId,
      actualSnapshotId: actualId,
    };
  }

  if (!actualId) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Candidate snapshot is missing miSnapshotId (expected ${expectedId})`,
      expectedSnapshotId: expectedId,
      actualSnapshotId: null,
    };
  }

  if (actualId === expectedId) {
    return {
      compatible: true,
      equivalenceMode: "EXACT_SNAPSHOT_ID",
      reason: `Exact MI snapshot match (${expectedId})`,
      expectedSnapshotId: expectedId,
      actualSnapshotId: actualId,
    };
  }

  const getRow = (id: string): any => {
    if (!miRowLookup) return null;
    if (miRowLookup instanceof Map) return miRowLookup.get(id) || null;
    return (miRowLookup as Record<string, any>)[id] || null;
  };

  const actualRow = getRow(actualId);
  const expectedRow = getRow(expectedId);

  if (!actualRow) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Referenced MI snapshot ${actualId} does not match expected MI snapshot ${expectedId} and ${actualId} is missing or unverified in storage`,
      expectedSnapshotId: expectedId,
      actualSnapshotId: actualId,
    };
  }

  if (!expectedRow) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Expected MI snapshot ${expectedId} could not be loaded to verify versioned input equivalence against ${actualId}`,
      expectedSnapshotId: expectedId,
      actualSnapshotId: actualId,
    };
  }

  const actualFp = computeMiVersionedInputFingerprint(actualRow);
  const expectedFp = computeMiVersionedInputFingerprint(expectedRow);

  if (
    actualFp.compositeFingerprint &&
    expectedFp.compositeFingerprint &&
    actualFp.compositeFingerprint === expectedFp.compositeFingerprint
  ) {
    return {
      compatible: true,
      equivalenceMode: "EQUIVALENT_VERSIONED_INPUTS",
      reason: `MI snapshots ${actualId} and ${expectedId} share identical versioned input fingerprint (${actualFp.compositeFingerprint}: competitorHash=${actualFp.competitorHash}, contentHash=${actualFp.contentHash}, posts=${actualFp.postSampleSize}, comments=${actualFp.commentSampleSize})`,
      expectedSnapshotId: expectedId,
      actualSnapshotId: actualId,
    };
  }

  return {
    compatible: false,
    equivalenceMode: "INCOMPATIBLE",
    reason: `MI snapshot ${actualId} (fp=${actualFp.compositeFingerprint || "none"}, posts=${actualFp.postSampleSize}, comments=${actualFp.commentSampleSize}) is incompatible with expected MI snapshot ${expectedId} (fp=${expectedFp.compositeFingerprint || "none"}, posts=${expectedFp.postSampleSize}, comments=${expectedFp.commentSampleSize})`,
    expectedSnapshotId: expectedId,
    actualSnapshotId: actualId,
  };
}

/**
 * Async MI snapshot compatibility check that loads any missing MI snapshot rows from DB.
 */
export async function areMiSnapshotsCompatible(
  actualMiSnapshotId: string | null | undefined,
  expectedMiSnapshotId: string | null | undefined,
  existingLookup?: Map<string, any> | null,
): Promise<CompatibilityCheckResult> {
  const actualId = actualMiSnapshotId ? String(actualMiSnapshotId).trim() : null;
  const expectedId = expectedMiSnapshotId ? String(expectedMiSnapshotId).trim() : null;

  if (!actualId || !expectedId || actualId === expectedId) {
    return areMiSnapshotsCompatibleSync(actualId, expectedId, existingLookup);
  }

  const lookup = new Map<string, any>(existingLookup ? Array.from(existingLookup.entries()) : []);
  const missingIds = [actualId, expectedId].filter(id => !lookup.has(id));
  if (missingIds.length > 0) {
    try {
      const rows = await db
        .select()
        .from(miSnapshots)
        .where(inArray(miSnapshots.id, missingIds));
      for (const r of rows) {
        lookup.set(r.id, r);
      }
    } catch {
      // Fall through to sync check with available rows
    }
  }

  return areMiSnapshotsCompatibleSync(actualId, expectedId, lookup);
}

/**
 * Checks whether an Audience snapshot is compatible with the active Market Intelligence
 * and Market Voice evidence base so compatible Audience snapshots are reused without
 * unnecessary regeneration.
 */
export function isAudienceSnapshotCompatible(args: {
  audienceRow: any;
  expectedMiRow?: any | null;
  expectedMiSnapshotId?: string | null;
  expectedMvJobId?: string | null;
  miRowLookup?: Map<string, any> | null;
}): CompatibilityCheckResult {
  const { audienceRow, expectedMiRow, expectedMiSnapshotId, expectedMvJobId, miRowLookup } = args;
  if (!audienceRow) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: "Audience snapshot row is missing",
      expectedSnapshotId: expectedMiSnapshotId || null,
      actualSnapshotId: null,
    };
  }

  const inputSummary = safeJsonParse<Record<string, any>>(audienceRow.inputSummary, {});
  const recordedMiId = audienceRow.miSnapshotId || inputSummary?.miSnapshotId || null;

  if (recordedMiId && expectedMiSnapshotId) {
    const miCheck = areMiSnapshotsCompatibleSync(recordedMiId, expectedMiSnapshotId, miRowLookup);
    if (!miCheck.compatible) {
      return {
        compatible: false,
        equivalenceMode: "INCOMPATIBLE",
        reason: `Audience snapshot ${audienceRow.id} references incompatible MI snapshot ${recordedMiId}: ${miCheck.reason}`,
        expectedSnapshotId: expectedMiSnapshotId,
        actualSnapshotId: recordedMiId,
      };
    }
  }

  if (expectedMvJobId && audienceRow.mvJobId && audienceRow.mvJobId !== expectedMvJobId) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Audience snapshot ${audienceRow.id} was built from Market Voice job ${audienceRow.mvJobId}, expected ${expectedMvJobId}`,
      expectedSnapshotId: expectedMvJobId,
      actualSnapshotId: audienceRow.mvJobId,
    };
  }

  if (expectedMiRow && typeof inputSummary?.competitorsAnalyzed === "number") {
    const compData = safeJsonParse<any[]>(expectedMiRow.competitorData, []);
    if (Array.isArray(compData) && compData.length > 0 && inputSummary.competitorsAnalyzed !== compData.length) {
      return {
        compatible: false,
        equivalenceMode: "INCOMPATIBLE",
        reason: `Audience snapshot ${audienceRow.id} analyzed ${inputSummary.competitorsAnalyzed} competitors, but MI snapshot ${expectedMiRow.id} has ${compData.length} competitors`,
        expectedSnapshotId: expectedMiRow.id,
        actualSnapshotId: audienceRow.id,
      };
    }
  }

  return {
    compatible: true,
    equivalenceMode: recordedMiId === expectedMiSnapshotId && recordedMiId ? "EXACT_SNAPSHOT_ID" : "COMPATIBLE_EVIDENCE_BASE",
    reason: `Audience snapshot ${audienceRow.id} is compatible with the current Market Voice (${audienceRow.mvJobId || "none"}) and Market Intelligence evidence base`,
    expectedSnapshotId: expectedMiSnapshotId || null,
    actualSnapshotId: audienceRow.id,
  };
}

/**
 * Checks whether a Differentiation snapshot is compatible with the selected MI and Audience snapshots.
 * Never permits an audience-only fallback when MI is incompatible.
 */
export function isDifferentiationSnapshotCompatibleSync(args: {
  diffRow: any;
  expectedMiSnapshotId: string | null | undefined;
  expectedAudienceSnapshotId: string | null | undefined;
  miRowLookup?: Map<string, any> | Record<string, any> | null;
}): CompatibilityCheckResult {
  const { diffRow, expectedMiSnapshotId, expectedAudienceSnapshotId, miRowLookup } = args;
  if (!diffRow) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: "Differentiation snapshot row is null",
      expectedSnapshotId: expectedMiSnapshotId || null,
      actualSnapshotId: null,
    };
  }

  if (expectedAudienceSnapshotId && diffRow.audienceSnapshotId !== expectedAudienceSnapshotId) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Differentiation snapshot ${diffRow.id} references audienceSnapshotId=${diffRow.audienceSnapshotId}, expected ${expectedAudienceSnapshotId}`,
      expectedSnapshotId: expectedAudienceSnapshotId,
      actualSnapshotId: diffRow.audienceSnapshotId || null,
    };
  }

  const miCheck = areMiSnapshotsCompatibleSync(diffRow.miSnapshotId, expectedMiSnapshotId, miRowLookup);
  if (!miCheck.compatible) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Differentiation snapshot ${diffRow.id} MI mismatch: ${miCheck.reason}`,
      expectedSnapshotId: expectedMiSnapshotId || null,
      actualSnapshotId: diffRow.miSnapshotId || null,
    };
  }

  return {
    compatible: true,
    equivalenceMode: miCheck.equivalenceMode,
    reason: `Differentiation snapshot ${diffRow.id} is compatible with MI (${expectedMiSnapshotId}) and Audience (${expectedAudienceSnapshotId})`,
    expectedSnapshotId: expectedMiSnapshotId || null,
    actualSnapshotId: diffRow.miSnapshotId || null,
  };
}

/**
 * Checks whether a Positioning snapshot is compatible with the selected MI, Audience, and Differentiation snapshots.
 */
export function isPositioningSnapshotCompatibleSync(args: {
  posRow: any;
  expectedMiSnapshotId: string | null | undefined;
  expectedAudienceSnapshotId: string | null | undefined;
  expectedDifferentiationSnapshotId?: string | null | undefined;
  miRowLookup?: Map<string, any> | Record<string, any> | null;
}): CompatibilityCheckResult {
  const {
    posRow,
    expectedMiSnapshotId,
    expectedAudienceSnapshotId,
    expectedDifferentiationSnapshotId,
    miRowLookup,
  } = args;

  if (!posRow) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: "Positioning snapshot row is null",
      expectedSnapshotId: expectedMiSnapshotId || null,
      actualSnapshotId: null,
    };
  }

  if (expectedAudienceSnapshotId && posRow.audienceSnapshotId !== expectedAudienceSnapshotId) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Positioning snapshot ${posRow.id} references audienceSnapshotId=${posRow.audienceSnapshotId}, expected ${expectedAudienceSnapshotId}`,
      expectedSnapshotId: expectedAudienceSnapshotId,
      actualSnapshotId: posRow.audienceSnapshotId || null,
    };
  }

  const miCheck = areMiSnapshotsCompatibleSync(posRow.miSnapshotId, expectedMiSnapshotId, miRowLookup);
  if (!miCheck.compatible) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Positioning snapshot ${posRow.id} MI mismatch: ${miCheck.reason}`,
      expectedSnapshotId: expectedMiSnapshotId || null,
      actualSnapshotId: posRow.miSnapshotId || null,
    };
  }

  const inputSummary = safeJsonParse<Record<string, any>>(posRow.inputSummary, {});
  const recordedDiffId = inputSummary?.differentiationSnapshotId || null;
  if (expectedDifferentiationSnapshotId && recordedDiffId && recordedDiffId !== expectedDifferentiationSnapshotId) {
    return {
      compatible: false,
      equivalenceMode: "INCOMPATIBLE",
      reason: `Positioning snapshot ${posRow.id} was built from differentiationSnapshotId=${recordedDiffId}, expected ${expectedDifferentiationSnapshotId}`,
      expectedSnapshotId: expectedDifferentiationSnapshotId,
      actualSnapshotId: recordedDiffId,
    };
  }

  return {
    compatible: true,
    equivalenceMode: miCheck.equivalenceMode,
    reason: `Positioning snapshot ${posRow.id} is compatible with upstream MI, Audience, and Differentiation`,
    expectedSnapshotId: expectedMiSnapshotId || null,
    actualSnapshotId: posRow.miSnapshotId || null,
  };
}

/**
 * Validates full cross-snapshot dependency compatibility across a strategy bundle before
 * locking a Strategy Root, publishing a Root Bundle, or activating a Strategic Plan.
 */
export async function validateBundleLineageCompatibility(args: {
  miSnapshotId: string | null | undefined;
  audienceSnapshotId: string | null | undefined;
  differentiationSnapshotId: string | null | undefined;
  positioningSnapshotId?: string | null | undefined;
  mechanismSnapshotId?: string | null | undefined;
  offerSnapshotId?: string | null | undefined;
  awarenessSnapshotId?: string | null | undefined;
  preloadedRows?: {
    miRows?: Map<string, any>;
    audienceRow?: any;
    diffRow?: any;
    posRow?: any;
    mechRow?: any;
    offerRow?: any;
    awarenessRow?: any;
  };
}): Promise<BundleLineageValidationResult> {
  const mismatches: BundleLineageMismatch[] = [];
  const miId = args.miSnapshotId ? String(args.miSnapshotId).trim() : null;
  const audId = args.audienceSnapshotId ? String(args.audienceSnapshotId).trim() : null;
  const diffId = args.differentiationSnapshotId ? String(args.differentiationSnapshotId).trim() : null;
  const posId = args.positioningSnapshotId ? String(args.positioningSnapshotId).trim() : null;
  const mechId = args.mechanismSnapshotId ? String(args.mechanismSnapshotId).trim() : null;
  const offerId = args.offerSnapshotId ? String(args.offerSnapshotId).trim() : null;
  const awId = args.awarenessSnapshotId ? String(args.awarenessSnapshotId).trim() : null;

  const miLookup = new Map<string, any>(
    args.preloadedRows?.miRows ? Array.from(args.preloadedRows.miRows.entries()) : [],
  );

  // Load snapshots if not preloaded
  let diffRow = args.preloadedRows?.diffRow || null;
  if (!diffRow && diffId) {
    const [row] = await db
      .select()
      .from(differentiationSnapshots)
      .where(inArray(differentiationSnapshots.id, [diffId]));
    diffRow = row || null;
  }

  let posRow = args.preloadedRows?.posRow || null;
  if (!posRow && posId) {
    const [row] = await db
      .select()
      .from(positioningSnapshots)
      .where(inArray(positioningSnapshots.id, [posId]));
    posRow = row || null;
  }

  let mechRow = args.preloadedRows?.mechRow || null;
  if (!mechRow && mechId) {
    const [row] = await db
      .select()
      .from(mechanismSnapshots)
      .where(inArray(mechanismSnapshots.id, [mechId]));
    mechRow = row || null;
  }

  let offerRow = args.preloadedRows?.offerRow || null;
  if (!offerRow && offerId) {
    const [row] = await db
      .select()
      .from(offerSnapshots)
      .where(inArray(offerSnapshots.id, [offerId]));
    offerRow = row || null;
  }

  let awarenessRow = args.preloadedRows?.awarenessRow || null;
  if (!awarenessRow && awId) {
    const [row] = await db
      .select()
      .from(awarenessSnapshots)
      .where(inArray(awarenessSnapshots.id, [awId]));
    awarenessRow = row || null;
  }

  // Collect all referenced MI snapshot IDs so we can batch-fetch them once
  const referencedMiIds = new Set<string>();
  if (miId) referencedMiIds.add(miId);
  if (diffRow?.miSnapshotId) referencedMiIds.add(diffRow.miSnapshotId);
  if (posRow?.miSnapshotId) referencedMiIds.add(posRow.miSnapshotId);
  if (offerRow?.miSnapshotId) referencedMiIds.add(offerRow.miSnapshotId);
  if (awarenessRow?.miSnapshotId) referencedMiIds.add(awarenessRow.miSnapshotId);

  const missingMiIds = Array.from(referencedMiIds).filter(id => !miLookup.has(id));
  if (missingMiIds.length > 0) {
    try {
      const rows = await db
        .select()
        .from(miSnapshots)
        .where(inArray(miSnapshots.id, missingMiIds));
      for (const r of rows) {
        miLookup.set(r.id, r);
      }
    } catch {
      // non-fatal
    }
  }

  // 1. Validate Differentiation
  if (diffId) {
    if (!diffRow) {
      mismatches.push({
        engine: "differentiation",
        snapshotId: diffId,
        dependencyField: "id",
        expectedValue: diffId,
        actualValue: null,
        reason: `Differentiation snapshot ${diffId} does not exist in storage`,
      });
    } else {
      const diffCheck = isDifferentiationSnapshotCompatibleSync({
        diffRow,
        expectedMiSnapshotId: miId,
        expectedAudienceSnapshotId: audId,
        miRowLookup: miLookup,
      });
      if (!diffCheck.compatible) {
        mismatches.push({
          engine: "differentiation",
          snapshotId: diffId,
          dependencyField: diffRow.audienceSnapshotId !== audId ? "audienceSnapshotId" : "miSnapshotId",
          expectedValue: diffRow.audienceSnapshotId !== audId ? audId : miId,
          actualValue: diffRow.audienceSnapshotId !== audId ? diffRow.audienceSnapshotId : diffRow.miSnapshotId,
          reason: diffCheck.reason,
        });
      }
    }
  }

  // 2. Validate Positioning
  if (posId && posRow) {
    const posCheck = isPositioningSnapshotCompatibleSync({
      posRow,
      expectedMiSnapshotId: miId,
      expectedAudienceSnapshotId: audId,
      expectedDifferentiationSnapshotId: diffId,
      miRowLookup: miLookup,
    });
    if (!posCheck.compatible) {
      mismatches.push({
        engine: "positioning",
        snapshotId: posId,
        dependencyField: "miSnapshotId/audienceSnapshotId/differentiationSnapshotId",
        expectedValue: `${miId}/${audId}/${diffId || "*"}`,
        actualValue: `${posRow.miSnapshotId}/${posRow.audienceSnapshotId}`,
        reason: posCheck.reason,
      });
    }
  }

  // 3. Validate Mechanism
  if (mechId && mechRow) {
    if (posId && mechRow.positioningSnapshotId && mechRow.positioningSnapshotId !== posId) {
      mismatches.push({
        engine: "mechanism",
        snapshotId: mechId,
        dependencyField: "positioningSnapshotId",
        expectedValue: posId,
        actualValue: mechRow.positioningSnapshotId,
        reason: `Mechanism snapshot ${mechId} references positioningSnapshotId=${mechRow.positioningSnapshotId}, expected ${posId}`,
      });
    }
    if (diffId && mechRow.differentiationSnapshotId && mechRow.differentiationSnapshotId !== diffId) {
      mismatches.push({
        engine: "mechanism",
        snapshotId: mechId,
        dependencyField: "differentiationSnapshotId",
        expectedValue: diffId,
        actualValue: mechRow.differentiationSnapshotId,
        reason: `Mechanism snapshot ${mechId} references differentiationSnapshotId=${mechRow.differentiationSnapshotId}, expected ${diffId}`,
      });
    }
  }

  // 4. Validate Offer
  if (offerId && offerRow) {
    if (miId && offerRow.miSnapshotId) {
      const offerMiCheck = areMiSnapshotsCompatibleSync(offerRow.miSnapshotId, miId, miLookup);
      if (!offerMiCheck.compatible) {
        mismatches.push({
          engine: "offer",
          snapshotId: offerId,
          dependencyField: "miSnapshotId",
          expectedValue: miId,
          actualValue: offerRow.miSnapshotId,
          reason: offerMiCheck.reason,
        });
      }
    }
    if (posId && offerRow.positioningSnapshotId && offerRow.positioningSnapshotId !== posId) {
      mismatches.push({
        engine: "offer",
        snapshotId: offerId,
        dependencyField: "positioningSnapshotId",
        expectedValue: posId,
        actualValue: offerRow.positioningSnapshotId,
        reason: `Offer snapshot ${offerId} references positioningSnapshotId=${offerRow.positioningSnapshotId}, expected ${posId}`,
      });
    }
    if (diffId && offerRow.differentiationSnapshotId && offerRow.differentiationSnapshotId !== diffId) {
      mismatches.push({
        engine: "offer",
        snapshotId: offerId,
        dependencyField: "differentiationSnapshotId",
        expectedValue: diffId,
        actualValue: offerRow.differentiationSnapshotId,
        reason: `Offer snapshot ${offerId} references differentiationSnapshotId=${offerRow.differentiationSnapshotId}, expected ${diffId}`,
      });
    }
  }

  // 5. Validate Awareness
  if (awId && awarenessRow) {
    if (miId && awarenessRow.miSnapshotId) {
      const awMiCheck = areMiSnapshotsCompatibleSync(awarenessRow.miSnapshotId, miId, miLookup);
      if (!awMiCheck.compatible) {
        mismatches.push({
          engine: "awareness",
          snapshotId: awId,
          dependencyField: "miSnapshotId",
          expectedValue: miId,
          actualValue: awarenessRow.miSnapshotId,
          reason: awMiCheck.reason,
        });
      }
    }
    if (posId && awarenessRow.positioningSnapshotId && awarenessRow.positioningSnapshotId !== posId) {
      mismatches.push({
        engine: "awareness",
        snapshotId: awId,
        dependencyField: "positioningSnapshotId",
        expectedValue: posId,
        actualValue: awarenessRow.positioningSnapshotId,
        reason: `Awareness snapshot ${awId} references positioningSnapshotId=${awarenessRow.positioningSnapshotId}, expected ${posId}`,
      });
    }
    if (diffId && awarenessRow.differentiationSnapshotId && awarenessRow.differentiationSnapshotId !== diffId) {
      mismatches.push({
        engine: "awareness",
        snapshotId: awId,
        dependencyField: "differentiationSnapshotId",
        expectedValue: diffId,
        actualValue: awarenessRow.differentiationSnapshotId,
        reason: `Awareness snapshot ${awId} references differentiationSnapshotId=${awarenessRow.differentiationSnapshotId}, expected ${diffId}`,
      });
    }
    if (offerId && awarenessRow.offerSnapshotId && awarenessRow.offerSnapshotId !== offerId) {
      mismatches.push({
        engine: "awareness",
        snapshotId: awId,
        dependencyField: "offerSnapshotId",
        expectedValue: offerId,
        actualValue: awarenessRow.offerSnapshotId,
        reason: `Awareness snapshot ${awId} references offerSnapshotId=${awarenessRow.offerSnapshotId}, expected ${offerId}`,
      });
    }
  }

  return {
    compatible: mismatches.length === 0,
    mismatches,
  };
}
