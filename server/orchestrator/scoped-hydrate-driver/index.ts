/**
 * Task #90 / Phase 4-B — scoped-hydrate-driver.
 *
 * Extracts the "scoped re-run hydration" block from `runOrchestrator`
 * (~lines 3806-3905). When the caller passes `scopedEngines`, the
 * orchestrator must hydrate the engine context with the most recent
 * snapshots for any UPSTREAM engine that will NOT execute this run,
 * then run `validateScopedHydration` to fail-closed on missing inputs.
 *
 * Doctrine:
 *   - D5: the hydration step returns a typed `HydrationOutcome` describing
 *     audience / mi / gaps. Caller MUST inspect `gaps` and BLOCK on any
 *     non-empty array — there is no silent "best effort" path.
 *
 * Side-effect ownership:
 *   - Hydration READS from DB (audience_snapshots, mi_snapshots) — those
 *     reads remain in the orchestrator seam to keep this module
 *     dependency-light. The module exposes pure ASSEMBLERS that turn
 *     raw DB rows into the canonical `ctx.audience` / `ctx.mi` shape.
 */

import type { EngineId } from "../priority-matrix";

export interface AudienceSnapshotRow {
  id: string;
  structuredSignals: string | null;
  audiencePains: string | null;
  desireMap: string | null;
  objectionMap: string | null;
  transformationMap: string | null;
  emotionalDrivers: string | null;
  audienceSegments: string | null;
  segmentDensity: string | null;
  awarenessLevel: string | null;
  maturityIndex: string | null;
  audienceIntentDistribution: string | null;
  inputSummary: string | null;
}

export interface MiSnapshotRow {
  id: string;
  signalData: string | Buffer | null;
  multiSourceSignals: string | null;
  overallConfidence: number | null;
}

export interface ParsedAudienceSnapshot {
  snapshotId: string;
  signalCount: number;
  rawObjectionsForSgl: Array<{ label: string; confidence: number; evidence: string[] }>;
  /** The canonical-shape audience object (passed through canonicalizeAudienceShape by the orchestrator). */
  canonicalSeed: Record<string, unknown>;
}

/**
 * Parse one audience-snapshot row into the canonical-seed shape. Returns
 * `null` when the row carries zero structured signals (caller continues
 * iterating older rows).
 */
export function parseAudienceSnapshotRow(row: AudienceSnapshotRow): ParsedAudienceSnapshot | null {
  const ss = JSON.parse(
    row.structuredSignals ||
      '{"pain_clusters":[],"desire_clusters":[],"pattern_clusters":[],"root_causes":[],"psychological_drivers":[]}',
  );
  const signalCount =
    (ss.pain_clusters?.length || 0) +
    (ss.desire_clusters?.length || 0) +
    (ss.pattern_clusters?.length || 0) +
    (ss.root_causes?.length || 0) +
    (ss.psychological_drivers?.length || 0);
  if (signalCount === 0) return null;

  const canonicalSeed = {
    ...row,
    audiencePains: JSON.parse(row.audiencePains || "[]"),
    desireMap: JSON.parse(row.desireMap || "[]"),
    objectionMap: JSON.parse(row.objectionMap || "[]"),
    transformationMap: JSON.parse(row.transformationMap || "[]"),
    emotionalDrivers: JSON.parse(row.emotionalDrivers || "[]"),
    audienceSegments: JSON.parse(row.audienceSegments || "[]"),
    segmentDensity: JSON.parse(row.segmentDensity || "[]"),
    awarenessLevel: JSON.parse(row.awarenessLevel || "{}"),
    maturityIndex: JSON.parse(row.maturityIndex || "{}"),
    intentDistribution: JSON.parse(row.audienceIntentDistribution || "{}"),
    structuredSignals: ss,
    inputSummary: JSON.parse(row.inputSummary || "{}"),
    snapshotId: row.id,
  };

  const rawObjections = canonicalSeed.objectionMap as Array<Record<string, unknown>>;
  const rawObjectionsForSgl = rawObjections.map((o) => ({
    label: String(o.label ?? o.canonical ?? o.pain ?? o.signal ?? ""),
    confidence: typeof o.confidence === "number"
      ? o.confidence
      : typeof o.confidenceScore === "number"
        ? o.confidenceScore
        : 0.5,
    evidence: Array.isArray(o.evidence) ? (o.evidence as string[]) : [],
  }));

  return { snapshotId: row.id, signalCount, rawObjectionsForSgl, canonicalSeed };
}

/**
 * Parse one MI snapshot row into the canonical `ctx.mi` shape.
 */
export function parseMiSnapshotRow(row: MiSnapshotRow): {
  snapshotId: string;
  parsed: Record<string, unknown>;
} {
  return {
    snapshotId: row.id,
    parsed: {
      ...row,
      signals: JSON.parse(row.signalData?.toString() || "[]"),
      multiSourceSignals: row.multiSourceSignals || "{}",
      snapshotId: row.id,
    },
  };
}

/**
 * Outcome bundle returned by the orchestrator's scoped-hydrate seam.
 * Used by the dispatcher's `compare` step in shadow mode.
 */
export interface ScopedHydrationOutcome {
  audienceHydrated: boolean;
  audienceSnapshotId?: string;
  audienceSignalCount: number;
  miHydrated: boolean;
  miSnapshotId?: string;
  gaps: Array<{ missingDependency: string; ctxKey: string }>;
}

export function buildScopedHydrationOutcome(parts: {
  audience: ParsedAudienceSnapshot | null;
  mi: { snapshotId: string } | null;
  gaps: Array<{ missingDependency: string; ctxKey: string }>;
}): ScopedHydrationOutcome {
  return {
    audienceHydrated: parts.audience !== null,
    audienceSnapshotId: parts.audience?.snapshotId,
    audienceSignalCount: parts.audience?.signalCount ?? 0,
    miHydrated: parts.mi !== null,
    miSnapshotId: parts.mi?.snapshotId,
    gaps: parts.gaps,
  };
}

/** Re-export so the orchestrator imports the validator through the module seam. */
export { validateScopedHydration } from "../priority-matrix";
export type { EngineId };
