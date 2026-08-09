/**
 * Single source of truth for assembling a StrategyRootInput.
 *
 * Both writers (the standalone /api/mechanism-engine/analyze route and the
 * orchestrator's full-pipeline path) MUST go through this helper. The previous
 * dual-writer setup let the two paths drift on field names (the orchestrator
 * read `ctx.audience.painProfiles`, which never existed) and silently wrote
 * empty arrays to `approved_audience_pains`, blocking every downstream offer.
 *
 * Canonical contract:
 *   - audience pains:      `audiencePains` (array of pain objects)
 *   - audience desires:    `desireMap` (object or array)
 *   - audience objections: `objectionMap` (object or array)
 *
 * Legacy aliases (`painProfiles`, `painMap`) MUST NOT be propagated by new
 * code; tolerate them only at INPUT boundaries from external producers.
 */
import { db } from "../db";
import { audienceSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { StrategyRootInput } from "./strategy-root";
import { buildAudiencePainRegistry } from "./audience-pain-registry";

function safeJsonParse<T = any>(text: any, fallback: T): T {
  if (text == null) return fallback;
  if (typeof text !== "string") return text as T;
  try {
    const parsed = JSON.parse(text);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Normalize an audience-shaped object onto the canonical key set without
 * dropping unrelated fields. Use this at every `ctx.audience = …` set-site
 * inside the orchestrator so downstream consumers can rely on a single key.
 *
 * Accepts any of the three legacy shapes (`audiencePains` | `painMap` | `painProfiles`)
 * and emits ONLY `audiencePains` going forward.
 */
export function canonicalizeAudienceShape<T extends Record<string, any>>(audience: T): T & {
  audiencePains: any[];
  desireMap: any;
  objectionMap: any;
} {
  if (!audience || typeof audience !== "object") {
    return { audiencePains: [], desireMap: {}, objectionMap: {} } as any;
  }

  const rawPains =
    (audience as any).audiencePains ??
    (audience as any).painMap ??
    (audience as any).painProfiles ??
    [];
  const audiencePains = Array.isArray(rawPains)
    ? rawPains
    : (typeof rawPains === "string" ? safeJsonParse<any[]>(rawPains, []) : []);

  const desireMap = (audience as any).desireMap ?? {};
  const objectionMap = (audience as any).objectionMap ?? {};

  // Strip the legacy aliases so consumers cannot accidentally pick them up.
  const { painProfiles: _ignore1, painMap: _ignore2, ...rest } = audience as any;

  return {
    ...rest,
    audiencePains,
    desireMap,
    objectionMap,
  };
}

interface AssemblerArgs {
  campaignId: string;
  accountId: string;
  miSnapshotId: string;
  audienceSnapshotId: string;
  positioningSnapshotId: string;
  differentiationSnapshotId: string;
  mechanismSnapshotId: string;
  /** Mechanism engine result (may already be parsed). */
  mechanismResult: any;
  /** Positioning snapshot row (already loaded by caller). */
  positioningSnapshot: any;
  /** Differentiation snapshot row OR an in-memory diff result. */
  differentiationContext: any;
  /** Optional: pre-loaded audience object — avoids a re-read when the caller
   *  already has a normalized copy in memory (e.g. orchestrator ctx.audience). */
  audienceOverride?: any;
}

/**
 * Build a fully-typed StrategyRootInput by loading the audience snapshot from
 * the DB (single source of truth) and unifying every field both writers need.
 *
 * Returns the input only — does NOT call buildStrategyRoot. The caller is
 * responsible for the persist step so they can attach engine-specific logging.
 */
export async function assembleStrategyRootInput(args: AssemblerArgs): Promise<StrategyRootInput> {
  const {
    campaignId,
    accountId,
    miSnapshotId,
    audienceSnapshotId,
    positioningSnapshotId,
    differentiationSnapshotId,
    mechanismSnapshotId,
    mechanismResult,
    positioningSnapshot,
    differentiationContext,
    audienceOverride,
  } = args;

  // ---- Audience: prefer in-memory override; fall back to DB read by id ----
  let audiencePains: any[] = [];
  let audienceDesires: any = {};
  let audienceObjections: any = {};
  let audienceTransformation: string | null = null;

  if (audienceOverride) {
    const canonical = canonicalizeAudienceShape(audienceOverride);
    audiencePains = canonical.audiencePains;
    audienceDesires = canonical.desireMap;
    audienceObjections = canonical.objectionMap;
    const segs =
      canonical.audienceSegments ||
      (canonical as any).segments ||
      safeJsonParse<any[]>((audienceOverride as any).audienceSegments, []);
    audienceTransformation = segs?.[0]?.transformation || null;
  }

  // If override gave us no pains, or no override was passed, hydrate from DB.
  if (audiencePains.length === 0 && audienceSnapshotId) {
    const [audSnap] = await db
      .select()
      .from(audienceSnapshots)
      .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId)))
      .limit(1);
    if (audSnap) {
      audiencePains = safeJsonParse<any[]>(audSnap.audiencePains, []);
      audienceDesires = safeJsonParse<any>(audSnap.desireMap, {});
      audienceObjections = safeJsonParse<any>(audSnap.objectionMap, {});
      const segments = safeJsonParse<any[]>(audSnap.audienceSegments, []);
      audienceTransformation = segments?.[0]?.transformation || null;
    }
  }

  // ---- Differentiation claims ----
  const rawClaims: any[] = Array.isArray(differentiationContext?.claimStructures)
    ? differentiationContext.claimStructures
    : safeJsonParse<any[]>(differentiationContext?.claimStructures, []);
  const sortedClaims = [...rawClaims].sort(
    (a: any, b: any) => (b?.overallScore || 0) - (a?.overallScore || 0)
  );
  const topClaim = sortedClaims[0]?.claim || null;

  // ---- Differentiation proof types ----
  const proofRaw: any[] = Array.isArray(differentiationContext?.proofArchitecture)
    ? differentiationContext.proofArchitecture
    : safeJsonParse<any[]>(differentiationContext?.proofArchitecture, []);
  const proofTypes = proofRaw.map((p: any) =>
    typeof p === "string" ? p : p?.type || p?.name || null
  ).filter(Boolean);

  // ---- Positioning context ----
  const positioningContext = {
    territories: Array.isArray(positioningSnapshot?.territories)
      ? positioningSnapshot.territories
      : safeJsonParse<any[]>(positioningSnapshot?.territories, []),
    enemyDefinition: positioningSnapshot?.enemyDefinition || null,
    contrastAxis: positioningSnapshot?.contrastAxis || null,
    narrativeDirection: positioningSnapshot?.narrativeDirection || null,
  };

  const primaryMech = mechanismResult?.primaryMechanism || mechanismResult;
  const mechClaim = topClaim || primaryMech?.mechanismPromise || null;

  return {
    campaignId,
    accountId,
    miSnapshotId: miSnapshotId || "",
    audienceSnapshotId: audienceSnapshotId || "",
    positioningSnapshotId,
    differentiationSnapshotId,
    mechanismSnapshotId,
    primaryAxis: primaryMech?.axisAlignment?.primaryAxis || positioningSnapshot?.contrastAxis || null,
    contrastAxisText: positioningSnapshot?.contrastAxis || null,
    approvedMechanism: primaryMech || null,
    // The root is the authority boundary for pains. Preserve the source
    // records, but make IDs, rank, product-fit and permitted roles explicit.
    approvedAudiencePains: buildAudiencePainRegistry(audiencePains, {
      accountId,
      audienceSnapshotId,
    }),
    approvedDesires: audienceDesires,
    approvedTransformation: audienceTransformation,
    approvedClaim: mechClaim,
    approvedClaims: sortedClaims,
    approvedPromise: primaryMech?.mechanismPromise || null,
    approvedObjections: audienceObjections,
    approvedProofTypes: proofTypes,
    approvedPositioningContext: positioningContext,
  };
}
