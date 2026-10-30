import crypto from "crypto";
import { db } from "../db";
import {
  strategyRoots,
  offerSnapshots,
  funnelSnapshots,
  integritySnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  miSnapshots,
  awarenessSnapshots,
} from "@shared/schema";
import { eq, and, desc, ne, sql, or } from "drizzle-orm";
import { validateAudiencePainRegistry } from "./audience-pain-registry";
import { areMiSnapshotsCompatible, validateBundleLineageCompatibility } from "./dependency-contract";

export interface StrategyRootInput {
  campaignId: string;
  accountId: string;
  jobId?: string;
  runId?: string;
  miSnapshotId: string;
  audienceSnapshotId: string;
  positioningSnapshotId: string;
  differentiationSnapshotId: string;
  mechanismSnapshotId: string;
  primaryAxis: string | null;
  contrastAxisText: string | null;
  approvedMechanism: any;
  /** CANONICAL: array of pain profile objects. NEVER `painProfiles` / `painMap`. */
  approvedAudiencePains: unknown[];
  approvedDesires: any;
  approvedTransformation: string | null;
  approvedClaim: string | null;
  approvedClaims: any;
  approvedPromise: string | null;
  approvedObjections: any;
  approvedProofTypes: any;
  approvedPositioningContext: any;
  brandSpine?: any;
  approvedLanes?: any[];
  approvedProposals?: any[];
}

/**
 * Thrown by buildStrategyRoot() when the caller-supplied input would produce
 * an incomplete row that downstream engines could not consume. The pipeline
 * MUST surface this error (not swallow it) so the operator sees the failure
 * at write time rather than later at the offer-engine gate.
 */
export class StrategyRootIncompleteError extends Error {
  code = "STRATEGY_ROOT_INCOMPLETE_INPUT" as const;
  constructor(public missingFields: string[], public phase: "build" | "consume") {
    super(`Strategy Root ${phase}-time validation failed — missing: ${missingFields.join(", ")}`);
    this.name = "StrategyRootIncompleteError";
  }
}

/**
 * Single shared predicate. Returns the list of fields that disqualify a
 * strategy root from being persisted (`build`) or consumed (`consume`).
 *
 * `subject` may be either a `StrategyRootInput` (build path) or a persisted
 * row (consume path). The shape is uniform enough — both expose
 * `approvedAudiencePains`, `mechanismSnapshotId`, etc.
 */
export function assertCompleteRoot(subject: any, phase: "build" | "consume" = "build"): string[] {
  const missing: string[] = [];
  if (!subject) {
    missing.push(phase === "consume" ? "strategy_root" : "input");
    return missing;
  }

  if (!subject.primaryAxis) missing.push("primary_axis");
  if (!subject.mechanismSnapshotId) {
    missing.push("approved_mechanism");
  } else if (subject.approvedMechanism !== undefined) {
    const rawMech = subject.approvedMechanism;
    const mech = typeof rawMech === "string" ? safeJsonParse(rawMech, rawMech) : rawMech;
    if (!mech || mech === "n/a") {
      missing.push("approved_mechanism");
    } else if (typeof mech === "string" && (mech.trim() === "" || mech === "NO_DISTINCT_MECHANISM_ESTABLISHED")) {
      missing.push("approved_mechanism");
    } else if (typeof mech === "object") {
      const nonAuthMechStatuses = [
        "NO_DISTINCT_MECHANISM_ESTABLISHED",
        "FAILED",
        "INCOMPLETE",
        "AXIS_REJECTED",
        "SEMANTIC_ROLE_BLOCKED",
        "DEPTH_FAILED",
      ];
      const effectiveMech = mech.primaryMechanism || mech;
      if (
        nonAuthMechStatuses.includes(mech.status) ||
        nonAuthMechStatuses.includes(effectiveMech.status) ||
        effectiveMech.mechanismName === "n/a" ||
        (effectiveMech.mechanismName !== undefined && effectiveMech.mechanismName.trim() === "")
      ) {
        missing.push("approved_mechanism");
      }
    }
  }
  if (!subject.audienceSnapshotId) missing.push("audience_data");
  if (!subject.contrastAxisText) missing.push("contrast_axis");

  // Persisted rows store JSON strings; in-memory inputs hold the parsed value.
  const rawPains = subject.approvedAudiencePains;
  const pains = typeof rawPains === "string" ? safeJsonParse(rawPains) : rawPains;
  if (!pains || !Array.isArray(pains) || pains.length === 0) {
    missing.push("approved_audience_pains");
  } else if (pains.some((pain: any) => pain && typeof pain === "object" && "painId" in pain)) {
    const registry = validateAudiencePainRegistry(pains, {
      accountId: subject.accountId,
      audienceSnapshotId: subject.audienceSnapshotId,
    });
    missing.push(...registry.issues.map((issue) => `pain_registry:${issue}`));
  }

  return missing;
}

export function computeRootHash(input: StrategyRootInput): string {
  const claimsKey = Array.isArray(input.approvedClaims)
    ? input.approvedClaims.slice(0, 3).map((c: any) => (typeof c === "string" ? c : c?.claim || "")).join("|")
    : null;
  const hashPayload = {
    mi: input.miSnapshotId,
    aud: input.audienceSnapshotId,
    pos: input.positioningSnapshotId,
    diff: input.differentiationSnapshotId,
    mech: input.mechanismSnapshotId,
    axis: input.primaryAxis,
    contrast: input.contrastAxisText,
    objections: input.approvedObjections ? JSON.stringify(input.approvedObjections) : null,
    proofTypes: input.approvedProofTypes ? JSON.stringify(input.approvedProofTypes) : null,
    posContext: input.approvedPositioningContext ? JSON.stringify(input.approvedPositioningContext) : null,
    claims: claimsKey,
    pains: input.approvedAudiencePains,
  };
  return crypto.createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex").substring(0, 16);
}

export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export async function buildStrategyRoot(input: StrategyRootInput): Promise<{
  id: string;
  runId: string;
  rootHash: string;
  isNew: boolean;
}> {
  // ---------------------------------------------------------------
  // BUILD-TIME VALIDATION (fail-loud, no degraded persist)
  // Symmetrical to validatePreGeneration's read-time gate. Sharing
  // assertCompleteRoot ensures the two contracts cannot drift again.
  // ---------------------------------------------------------------
  const missing = assertCompleteRoot(input, "build");
  if (missing.length > 0) {
    console.error(
      `[StrategyRoot] BUILD_REJECTED | campaign=${input.campaignId} | missing=${missing.join(",")} | mech=${input.mechanismSnapshotId} | aud=${input.audienceSnapshotId}`
    );
    throw new StrategyRootIncompleteError(missing, "build");
  }

  // ---------------------------------------------------------------
  // PROVENANCE GRAPH LINKAGE ENFORCEMENT
  // StrategyRoot verifies the immutable provenance graph of child snapshots:
  // 1. Snapshot existence in database.
  // 2. Tenant and campaign isolation (accountId, campaignId match).
  // 3. Parent-child DAG linkages across positioning, differentiation, mechanism, and audience.
  // Physical job IDs are recorded for the current execution run, but cross-run
  // resumed snapshots with valid provenance are fully authoritative.
  // ---------------------------------------------------------------
  const [audRow] = input.audienceSnapshotId
    ? await db.select({
        id: audienceSnapshots.id,
        accountId: audienceSnapshots.accountId,
        campaignId: audienceSnapshots.campaignId,
        jobId: audienceSnapshots.jobId,
      }).from(audienceSnapshots).where(eq(audienceSnapshots.id, input.audienceSnapshotId)).limit(1)
    : [null];

  const [posRow] = input.positioningSnapshotId
    ? await db.select({
        id: positioningSnapshots.id,
        accountId: positioningSnapshots.accountId,
        campaignId: positioningSnapshots.campaignId,
        jobId: positioningSnapshots.jobId,
        miSnapshotId: positioningSnapshots.miSnapshotId,
        audienceSnapshotId: positioningSnapshots.audienceSnapshotId,
      }).from(positioningSnapshots).where(eq(positioningSnapshots.id, input.positioningSnapshotId)).limit(1)
    : [null];

  const [diffRow] = input.differentiationSnapshotId
    ? await db.select({
        id: differentiationSnapshots.id,
        accountId: differentiationSnapshots.accountId,
        campaignId: differentiationSnapshots.campaignId,
        jobId: differentiationSnapshots.jobId,
        miSnapshotId: differentiationSnapshots.miSnapshotId,
        audienceSnapshotId: differentiationSnapshots.audienceSnapshotId,
        positioningSnapshotId: differentiationSnapshots.positioningSnapshotId,
      }).from(differentiationSnapshots).where(eq(differentiationSnapshots.id, input.differentiationSnapshotId)).limit(1)
    : [null];

  const [mechRow] = input.mechanismSnapshotId
    ? await db.select({
        id: mechanismSnapshots.id,
        accountId: mechanismSnapshots.accountId,
        campaignId: mechanismSnapshots.campaignId,
        jobId: mechanismSnapshots.jobId,
        positioningSnapshotId: mechanismSnapshots.positioningSnapshotId,
        differentiationSnapshotId: mechanismSnapshots.differentiationSnapshotId,
      }).from(mechanismSnapshots).where(eq(mechanismSnapshots.id, input.mechanismSnapshotId)).limit(1)
    : [null];

  const provenanceIssues: string[] = [];

  // 1. Existence check
  if (input.audienceSnapshotId && !audRow) {
    provenanceIssues.push(`snapshot_not_found: audience snapshot ${input.audienceSnapshotId}`);
  }
  if (input.positioningSnapshotId && !posRow) {
    provenanceIssues.push(`snapshot_not_found: positioning snapshot ${input.positioningSnapshotId}`);
  }
  if (input.differentiationSnapshotId && !diffRow) {
    provenanceIssues.push(`snapshot_not_found: differentiation snapshot ${input.differentiationSnapshotId}`);
  }
  if (input.mechanismSnapshotId && !mechRow) {
    provenanceIssues.push(`snapshot_not_found: mechanism snapshot ${input.mechanismSnapshotId}`);
  }

  // 2. Tenant and Campaign isolation
  const snapshotsToCheck = [
    { name: "audience", row: audRow },
    { name: "positioning", row: posRow },
    { name: "differentiation", row: diffRow },
    { name: "mechanism", row: mechRow },
  ];

  for (const { name, row } of snapshotsToCheck) {
    if (row) {
      if (row.accountId && row.accountId !== input.accountId) {
        provenanceIssues.push(`tenant_isolation_violation: ${name} snapshot belongs to account ${row.accountId}, expected ${input.accountId}`);
      }
      if (row.campaignId && row.campaignId !== input.campaignId) {
        provenanceIssues.push(`campaign_isolation_violation: ${name} snapshot belongs to campaign ${row.campaignId}, expected ${input.campaignId}`);
      }
    }
  }

  // 3. DAG Parent-Child Linkages (including MI snapshot compatibility)
  if (posRow && input.miSnapshotId) {
    const posMiCompat = await areMiSnapshotsCompatible((posRow as any).miSnapshotId, input.miSnapshotId);
    if (!posMiCompat.compatible) {
      provenanceIssues.push(`provenance_linkage_mismatch: positioning snapshot ${posRow.id} references incompatible MI snapshot ${(posRow as any).miSnapshotId}, expected ${input.miSnapshotId} (${posMiCompat.reason})`);
    }
  }
  if (diffRow && input.miSnapshotId) {
    const diffMiCompat = await areMiSnapshotsCompatible((diffRow as any).miSnapshotId, input.miSnapshotId);
    if (!diffMiCompat.compatible) {
      provenanceIssues.push(`provenance_linkage_mismatch: differentiation snapshot ${diffRow.id} references incompatible MI snapshot ${(diffRow as any).miSnapshotId}, expected ${input.miSnapshotId} (${diffMiCompat.reason})`);
    }
  }
  if (posRow && input.audienceSnapshotId && posRow.audienceSnapshotId && posRow.audienceSnapshotId !== input.audienceSnapshotId) {
    provenanceIssues.push(`provenance_linkage_mismatch: positioning snapshot references audience ${posRow.audienceSnapshotId}, expected ${input.audienceSnapshotId}`);
  }
  if (diffRow) {
    if (input.positioningSnapshotId && diffRow.positioningSnapshotId && diffRow.positioningSnapshotId !== "N/A" && diffRow.positioningSnapshotId !== input.positioningSnapshotId) {
      provenanceIssues.push(`provenance_linkage_mismatch: differentiation snapshot references positioning ${diffRow.positioningSnapshotId}, expected ${input.positioningSnapshotId}`);
    }
    if (input.audienceSnapshotId && diffRow.audienceSnapshotId && diffRow.audienceSnapshotId !== input.audienceSnapshotId) {
      provenanceIssues.push(`provenance_linkage_mismatch: differentiation snapshot references audience ${diffRow.audienceSnapshotId}, expected ${input.audienceSnapshotId}`);
    }
  }
  if (mechRow) {
    if (input.positioningSnapshotId && mechRow.positioningSnapshotId && mechRow.positioningSnapshotId !== input.positioningSnapshotId) {
      provenanceIssues.push(`provenance_linkage_mismatch: mechanism snapshot references positioning ${mechRow.positioningSnapshotId}, expected ${input.positioningSnapshotId}`);
    }
    if (input.differentiationSnapshotId && mechRow.differentiationSnapshotId && mechRow.differentiationSnapshotId !== input.differentiationSnapshotId) {
      provenanceIssues.push(`provenance_linkage_mismatch: mechanism snapshot references differentiation ${mechRow.differentiationSnapshotId}, expected ${input.differentiationSnapshotId}`);
    }
  }

  if (provenanceIssues.length > 0) {
    console.error(`[StrategyRoot] PROVENANCE_GRAPH_VIOLATION | ${provenanceIssues.join("; ")}`);
    throw new StrategyRootIncompleteError(provenanceIssues, "build");
  }

  const rootHash = computeRootHash(input);
  const runId = input.jobId || input.runId || generateRunId();

  // ---------------------------------------------------------------
  // ATOMIC SUPERSEDE + INSERT
  // Every run generates a fresh StrategyRoot record.
  // We serialize through a transaction with row-level locks (FOR UPDATE)
  // and a uniqueness invariant verified before commit.
  // ---------------------------------------------------------------
  return await db.transaction(async (tx: any) => {
    // Lock all rows for this (campaign, account) so concurrent transactions
    // serialize on this campaign — postgres holds the locks until commit.
    await tx.execute(sql`
      SELECT id FROM strategy_roots
       WHERE campaign_id = ${input.campaignId}
         AND account_id  = ${input.accountId}
       FOR UPDATE
    `);

    // Supersede any existing ACTIVE roots for this (campaign, account).
    await tx.update(strategyRoots)
      .set({ status: "SUPERSEDED" })
      .where(and(
        eq(strategyRoots.campaignId, input.campaignId),
        eq(strategyRoots.accountId, input.accountId),
        eq(strategyRoots.status, "ACTIVE"),
      ));

    const [created] = await tx.insert(strategyRoots).values({
      accountId: input.accountId,
      campaignId: input.campaignId,
      runId,
      rootHash,
      primaryAxis: input.primaryAxis,
      contrastAxisText: input.contrastAxisText,
      approvedMechanism: JSON.stringify(input.approvedMechanism),
      approvedAudiencePains: JSON.stringify(input.approvedAudiencePains),
      approvedDesires: JSON.stringify(input.approvedDesires),
      approvedTransformation: input.approvedTransformation,
      approvedClaim: input.approvedClaim,
      approvedClaims: JSON.stringify(input.approvedClaims || []),
      approvedPromise: input.approvedPromise,
      approvedObjections: JSON.stringify(input.approvedObjections),
      approvedProofTypes: JSON.stringify(input.approvedProofTypes),
      approvedPositioningContext: JSON.stringify(input.approvedPositioningContext),
      brandSpine: input.brandSpine ? JSON.stringify(input.brandSpine) : null,
      approvedLanes: input.approvedLanes ? JSON.stringify(input.approvedLanes) : null,
      miSnapshotId: input.miSnapshotId,
      audienceSnapshotId: input.audienceSnapshotId,
      positioningSnapshotId: input.positioningSnapshotId,
      differentiationSnapshotId: input.differentiationSnapshotId,
      mechanismSnapshotId: input.mechanismSnapshotId,
      status: "ACTIVE",
    }).returning();

    // Invariant guard: exactly one ACTIVE row for (campaign, account) post-commit.
    const activeRows = await tx.select({ id: strategyRoots.id }).from(strategyRoots)
      .where(and(
        eq(strategyRoots.campaignId, input.campaignId),
        eq(strategyRoots.accountId, input.accountId),
        eq(strategyRoots.status, "ACTIVE"),
      ));
    if (activeRows.length !== 1) {
      // Throwing inside the transaction triggers a rollback — no degraded state persists.
      throw new Error(
        `[StrategyRoot] INVARIANT_VIOLATION | expected exactly 1 ACTIVE row, found ${activeRows.length} | campaign=${input.campaignId}`
      );
    }

    console.log(`[StrategyRoot] CREATED | id=${created.id} | hash=${rootHash} | runId=${runId} | campaign=${input.campaignId}`);
    return { id: created.id, runId, rootHash, isNew: true };
  });
}

/**
 * Reconstructs a Strategy Root row from the database into a fully typed and
 * deserialized StrategyRoot object where JSON fields (especially approvedLanes,
 * approvedAudiencePains, approvedDesires, etc.) are guaranteed to be proper Arrays/Objects.
 */
export function reconstructStrategyRoot(rawRow: any): any {
  if (!rawRow) return null;

  const parseArray = (val: any): any[] => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const parseObj = (val: any): any => {
    if (val === null || val === undefined) return null;
    if (typeof val === "object") return val;
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    ...rawRow,
    approvedLanes: parseArray(rawRow.approvedLanes),
    approvedAudiencePains: parseArray(rawRow.approvedAudiencePains),
    approvedDesires: parseArray(rawRow.approvedDesires),
    approvedObjections: parseArray(rawRow.approvedObjections),
    approvedProofTypes: parseArray(rawRow.approvedProofTypes),
    approvedClaims: parseArray(rawRow.approvedClaims),
    approvedMechanism: parseObj(rawRow.approvedMechanism),
    approvedPositioningContext: parseObj(rawRow.approvedPositioningContext),
    brandSpine: parseObj(rawRow.brandSpine),
  };
}

export type StrategyRootStatus = "ACTIVE" | "REVIEW_REQUIRED" | "SUPERSEDED";

/**
 * Authoritative resolver for an execution-eligible Strategy Root.
 * Returns ONLY an active root (status === "ACTIVE").
 * Never falls back to superseded roots or latest timestamp.
 */
export async function getExecutionEligibleRoot(
  campaignId: string,
  accountId?: string
): Promise<any | null> {
  const conditions = [
    eq(strategyRoots.campaignId, campaignId),
    eq(strategyRoots.status, "ACTIVE"),
  ];
  if (accountId) {
    conditions.push(eq(strategyRoots.accountId, accountId));
  }

  const [active] = await db.select().from(strategyRoots)
    .where(and(...conditions))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);

  if (!active) return null;
  return reconstructStrategyRoot(active);
}

/**
 * Historical inspection resolver.
 * May return SUPERSEDED or REVIEW_REQUIRED roots, flagged with executionEligible: false.
 */
export async function getRootForHistoricalView(
  campaignId: string,
  accountId?: string,
  rootId?: string
): Promise<{ root: any | null; executionEligible: boolean; status: string | null }> {
  let row: any = null;
  if (rootId) {
    const conditions = [
      eq(strategyRoots.id, rootId),
      eq(strategyRoots.campaignId, campaignId),
    ];
    if (accountId) conditions.push(eq(strategyRoots.accountId, accountId));
    [row] = await db.select().from(strategyRoots).where(and(...conditions)).limit(1);
  } else {
    const conditions = [eq(strategyRoots.campaignId, campaignId)];
    if (accountId) conditions.push(eq(strategyRoots.accountId, accountId));
    [row] = await db.select().from(strategyRoots).where(and(...conditions)).orderBy(desc(strategyRoots.createdAt)).limit(1);
  }

  if (!row) {
    return { root: null, executionEligible: false, status: null };
  }

  const executionEligible = row.status === "ACTIVE";
  return {
    root: reconstructStrategyRoot(row),
    executionEligible,
    status: row.status,
  };
}

/**
 * Verifies whether a given strategy root is currently execution-eligible.
 * Fails closed if the root does not exist, status is not ACTIVE, or fields are incomplete.
 */
export async function assertRootExecutionEligible(
  rootId: string,
  campaignId: string,
  accountId?: string
): Promise<{ eligible: boolean; root: any | null; reasons: string[] }> {
  const conditions = [
    eq(strategyRoots.id, rootId),
    eq(strategyRoots.campaignId, campaignId),
  ];
  if (accountId) {
    conditions.push(eq(strategyRoots.accountId, accountId));
  }

  const [row] = await db.select().from(strategyRoots).where(and(...conditions)).limit(1);
  if (!row) {
    return {
      eligible: false,
      root: null,
      reasons: [`Strategy root '${rootId}' not found for campaign '${campaignId}'`],
    };
  }

  const reasons: string[] = [];
  if (row.status !== "ACTIVE") {
    reasons.push(`Strategy root '${rootId}' has status '${row.status}' (execution requires 'ACTIVE')`);
  }

  const missingFields = assertCompleteRoot(row, "consume");
  const lineageCheck = await validateBundleLineageCompatibility({
    miSnapshotId: row.miSnapshotId,
    audienceSnapshotId: row.audienceSnapshotId,
    differentiationSnapshotId: row.differentiationSnapshotId,
    positioningSnapshotId: row.positioningSnapshotId,
    mechanismSnapshotId: row.mechanismSnapshotId,
  });
  if (!lineageCheck.compatible) {
    for (const m of lineageCheck.mismatches) {
      reasons.push(`Lineage mismatch in ${m.engine} (${m.snapshotId}): ${m.reason}`);
    }
  }
  if (missingFields.length > 0) {
    reasons.push(...missingFields.map((f) => `Incomplete root field: ${f}`));
  }

  if (reasons.length > 0) {
    return { eligible: false, root: reconstructStrategyRoot(row), reasons };
  }

  return { eligible: true, root: reconstructStrategyRoot(row), reasons: [] };
}

export async function getActiveRoot(
  campaignId: string,
  accountId?: string,
  options?: {
    strategyRootId?: string;
    allowPinnedOrLatest?: boolean;
  }
): Promise<any | null> {
  if (options?.strategyRootId) {
    const conditions = [
      eq(strategyRoots.id, options.strategyRootId),
      eq(strategyRoots.campaignId, campaignId),
    ];
    if (accountId) {
      conditions.push(eq(strategyRoots.accountId, accountId));
    }
    const [pinned] = await db.select().from(strategyRoots)
      .where(and(...conditions))
      .limit(1);
    if (pinned) {
      return reconstructStrategyRoot(pinned);
    }
  }

  const conditions = [
    eq(strategyRoots.campaignId, campaignId),
    eq(strategyRoots.status, "ACTIVE"),
  ];
  if (accountId) {
    conditions.push(eq(strategyRoots.accountId, accountId));
  }

  const [active] = await db.select().from(strategyRoots)
    .where(and(...conditions))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);

  if (active) {
    return reconstructStrategyRoot(active);
  }

  if (options?.allowPinnedOrLatest) {
    const fallbackConditions = [
      eq(strategyRoots.campaignId, campaignId),
    ];
    if (accountId) {
      fallbackConditions.push(eq(strategyRoots.accountId, accountId));
    }
    const [latest] = await db.select().from(strategyRoots)
      .where(and(...fallbackConditions))
      .orderBy(desc(strategyRoots.createdAt))
      .limit(1);
    if (latest) {
      return reconstructStrategyRoot(latest);
    }
  }

  return null;
}

export interface RootValidationResult {
  valid: boolean;
  issues: string[];
  rootId: string | null;
  rootHash: string | null;
  runId: string | null;
}

export function validateRootBinding(
  activeRoot: any,
  snapshotIds: {
    miSnapshotId?: string;
    audienceSnapshotId?: string;
    positioningSnapshotId?: string;
    differentiationSnapshotId?: string;
    mechanismSnapshotId?: string;
  }
): RootValidationResult {
  if (!activeRoot) {
    return {
      valid: false,
      issues: ["No active strategy root — run Mechanism Engine to create one"],
      rootId: null,
      rootHash: null,
      runId: null,
    };
  }

  const issues: string[] = [];

  if (snapshotIds.miSnapshotId && snapshotIds.miSnapshotId !== activeRoot.miSnapshotId) {
    issues.push(`MI snapshot mismatch: using ${snapshotIds.miSnapshotId} but root expects ${activeRoot.miSnapshotId}`);
  }
  if (snapshotIds.audienceSnapshotId && snapshotIds.audienceSnapshotId !== activeRoot.audienceSnapshotId) {
    issues.push(`Audience snapshot mismatch: using ${snapshotIds.audienceSnapshotId} but root expects ${activeRoot.audienceSnapshotId}`);
  }
  if (snapshotIds.positioningSnapshotId && snapshotIds.positioningSnapshotId !== activeRoot.positioningSnapshotId) {
    issues.push(`Positioning snapshot mismatch: using ${snapshotIds.positioningSnapshotId} but root expects ${activeRoot.positioningSnapshotId}`);
  }
  if (snapshotIds.differentiationSnapshotId && snapshotIds.differentiationSnapshotId !== activeRoot.differentiationSnapshotId) {
    issues.push(`Differentiation snapshot mismatch: using ${snapshotIds.differentiationSnapshotId} but root expects ${activeRoot.differentiationSnapshotId}`);
  }
  if (snapshotIds.mechanismSnapshotId && snapshotIds.mechanismSnapshotId !== activeRoot.mechanismSnapshotId) {
    issues.push(`Mechanism snapshot mismatch: using ${snapshotIds.mechanismSnapshotId} but root expects ${activeRoot.mechanismSnapshotId}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    rootId: activeRoot.id,
    rootHash: activeRoot.rootHash,
    runId: activeRoot.runId,
  };
}

export async function invalidateDownstreamOnRegeneration(
  campaignId: string,
  accountId: string,
  regeneratedEngine: "positioning" | "differentiation" | "audience" | "mechanism" | "mi"
): Promise<{ reviewRequiredRoots: number; supersededRoots: number; invalidatedOffers: number; invalidatedFunnels: number; invalidatedIntegrity: number; invalidatedAwareness: number }> {
  const [activeRoot] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .limit(1);

  if (!activeRoot) {
    return { reviewRequiredRoots: 0, supersededRoots: 0, invalidatedOffers: 0, invalidatedFunnels: 0, invalidatedIntegrity: 0, invalidatedAwareness: 0 };
  }

  const affectedRootId = activeRoot.id;

  // Upstream regeneration marks root as REVIEW_REQUIRED (not SUPERSEDED).
  // Root assumptions must be reviewed/re-evaluated. Atomic SUPERSEDED happens when a new root is built via buildStrategyRoot.
  await db.update(strategyRoots)
    .set({ status: "REVIEW_REQUIRED" })
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.id, affectedRootId),
    ));

  let invalidatedOffers = 0;
  let invalidatedFunnels = 0;
  let invalidatedIntegrity = 0;
  let invalidatedAwareness = 0;

  const reasonMsg = `Review required: upstream ${regeneratedEngine} engine regenerated (root ${affectedRootId} marked REVIEW_REQUIRED)`;

  try {
    const offerResult = await db.update(offerSnapshots)
      .set({ statusMessage: reasonMsg })
      .where(and(
        eq(offerSnapshots.campaignId, campaignId),
        eq(offerSnapshots.accountId, accountId),
        eq(offerSnapshots.strategyRootId, affectedRootId),
      ));
    invalidatedOffers = (offerResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark offer snapshots (non-critical): ${(e as Error).message}`);
  }

  try {
    // Match funnels by strategyRootId OR campaign + account + activeRoot.runId (covers funnels with null strategyRootId)
    const funnelResult = await db.update(funnelSnapshots)
      .set({ statusMessage: reasonMsg })
      .where(and(
        eq(funnelSnapshots.campaignId, campaignId),
        eq(funnelSnapshots.accountId, accountId),
        or(
          eq(funnelSnapshots.strategyRootId, affectedRootId),
          activeRoot.runId ? eq(funnelSnapshots.jobId, activeRoot.runId) : sql`false`
        ),
      ));
    invalidatedFunnels = (funnelResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark funnel snapshots (non-critical): ${(e as Error).message}`);
  }

  try {
    const integrityResult = await db.update(integritySnapshots)
      .set({ statusMessage: reasonMsg })
      .where(and(
        eq(integritySnapshots.campaignId, campaignId),
        eq(integritySnapshots.accountId, accountId),
        eq(integritySnapshots.strategyRootId, affectedRootId),
      ));
    invalidatedIntegrity = (integrityResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark integrity snapshots (non-critical): ${(e as Error).message}`);
  }

  try {
    if (activeRoot.runId) {
      const awarenessResult = await db.update(awarenessSnapshots)
        .set({ statusMessage: reasonMsg })
        .where(and(
          eq(awarenessSnapshots.campaignId, campaignId),
          eq(awarenessSnapshots.accountId, accountId),
          eq(awarenessSnapshots.jobId, activeRoot.runId),
        ));
      invalidatedAwareness = (awarenessResult as any)?.rowCount || 0;
    }
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark awareness snapshots (non-critical): ${(e as Error).message}`);
  }

  console.log(`[StrategyRoot] MARKED_REVIEW_REQUIRED | root=${affectedRootId} | trigger=${regeneratedEngine} | campaign=${campaignId} | offers=${invalidatedOffers} | funnels=${invalidatedFunnels} | integrity=${invalidatedIntegrity} | awareness=${invalidatedAwareness}`);

  return { reviewRequiredRoots: 1, supersededRoots: 0, invalidatedOffers, invalidatedFunnels, invalidatedIntegrity, invalidatedAwareness };
}

export function validatePreGeneration(activeRoot: any): {
  canGenerate: boolean;
  missingFields: string[];
} {
  // Delegates to the shared predicate so build-time and consume-time gates
  // can never disagree about what counts as a "complete" root.
  const missing = assertCompleteRoot(activeRoot, "consume");
  return { canGenerate: missing.length === 0, missingFields: missing };
}

export function validatePostGeneration(
  activeRoot: any,
  generatedOffer: any
): { valid: boolean; issues: string[] } {
  if (!activeRoot || !generatedOffer) {
    return { valid: true, issues: [] };
  }

  const issues: string[] = [];
  const axis = activeRoot.primaryAxis || "";
  const axisTokens = axis.replace(/_/g, " ").toLowerCase().split(/\s+/).filter((t: string) => t.length > 3);

  if (generatedOffer.offerName && axisTokens.length > 0) {
    const nameLC = generatedOffer.offerName.toLowerCase();
    const nameLC2 = (generatedOffer.coreOutcome || "").toLowerCase();
    const combined = `${nameLC} ${nameLC2} ${(generatedOffer.mechanismDescription || "").toLowerCase()}`;
    const hasAxisRef = axisTokens.some((t: string) => {
      if (combined.includes(t)) return true;
      const stem = t.replace(/(ity|ness|ment|tion|sion|ance|ence|able|ible|ful|less|ing|ous|ive|ical|ally|ized|ise|ize)$/, "");
      return stem.length >= 3 && combined.includes(stem);
    });
    if (!hasAxisRef) {
      issues.push(`axis_mismatch: offer does not reference the active axis "${axis.replace(/_/g, " ")}" — required tokens: [${axisTokens.join(", ")}]`);
    }
  }

  const mechData = safeJsonParse(activeRoot.approvedMechanism);
  if (mechData?.mechanismName && generatedOffer.mechanismDescription) {
    const mechName = mechData.mechanismName.toLowerCase();
    const mechDesc = generatedOffer.mechanismDescription.toLowerCase();
    if (!mechDesc.includes(mechName.substring(0, Math.min(mechName.length, 10)))) {
      issues.push(`mechanism_mismatch: approved mechanism "${mechData.mechanismName}" not referenced in offer mechanism description`);
    }
  }

  const rootPains = safeJsonParse(activeRoot.approvedAudiencePains);
  const corePain = Array.isArray(rootPains)
    ? rootPains.find((pain: any) => pain?.eligible && pain?.allowedUses?.includes("offer_core"))
    : null;
  if (corePain && generatedOffer.selectedPainRoles?.core?.painId !== corePain.painId) {
    issues.push(`audience_pain_role_mismatch: offer must preserve approved core pain ${corePain.painId}`);
  }
  if (generatedOffer.selectedPainRoles?.core?.mergedPainIds?.length > 1) {
    issues.push("audience_pain_merge_forbidden: an offer core pain must reference exactly one approved pain");
  }
  if (rootPains && Array.isArray(rootPains) && rootPains.length > 0 && generatedOffer.coreOutcome) {
    const outcomeLC = generatedOffer.coreOutcome.toLowerCase();
    const painTokens = rootPains.slice(0, 8).flatMap((p: any) => {
      const text = typeof p === "string" ? p : p?.pain || p?.name || "";
      return text.toLowerCase().split(/\s+/).filter((t: string) => t.length > 4);
    });
    const hasPainRef = painTokens.some((t: string) => outcomeLC.includes(t));
    if (!hasPainRef && painTokens.length > 0) {
      issues.push(`audience_pain_alignment: offer outcome does not reference any approved audience pains`);
    }
  }

  return { valid: issues.length === 0, issues };
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}
