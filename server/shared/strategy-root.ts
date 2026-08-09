import crypto from "crypto";
import { db } from "../db";
import { strategyRoots, offerSnapshots, funnelSnapshots, integritySnapshots } from "@shared/schema";
import { eq, and, desc, ne, sql } from "drizzle-orm";
import { validateAudiencePainRegistry } from "./audience-pain-registry";

export interface StrategyRootInput {
  campaignId: string;
  accountId: string;
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
  if (!subject.mechanismSnapshotId) missing.push("approved_mechanism");
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

  const rootHash = computeRootHash(input);
  const runId = generateRunId();

  // ---------------------------------------------------------------
  // ATOMIC SUPERSEDE + INSERT
  // The previous implementation ran SELECT → UPDATE → INSERT in three
  // separate statements. Concurrent calls (parallel orchestrator runs
  // for the same campaign, mechanism-engine + orchestrator racing, or
  // dual-analysis re-runs) could leave 0 or 2+ ACTIVE rows. We now
  // serialize through a transaction with row-level locks (FOR UPDATE)
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

    // Idempotent reuse: same hash already ACTIVE → return it, do nothing else.
    const [existing] = await tx.select().from(strategyRoots)
      .where(and(
        eq(strategyRoots.campaignId, input.campaignId),
        eq(strategyRoots.accountId, input.accountId),
        eq(strategyRoots.rootHash, rootHash),
        eq(strategyRoots.status, "ACTIVE"),
      ))
      .limit(1);

    if (existing) {
      console.log(`[StrategyRoot] REUSE | existing root ${existing.id} | hash=${rootHash} | campaign=${input.campaignId}`);
      return { id: existing.id, runId: existing.runId, rootHash, isNew: false };
    }

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

export async function getActiveRoot(campaignId: string, accountId: string): Promise<any | null> {
  const [active] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);

  return active || null;
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
): Promise<{ supersededRoots: number; invalidatedOffers: number; invalidatedFunnels: number; invalidatedIntegrity: number }> {
  const [activeRoot] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .limit(1);

  if (!activeRoot) {
    return { supersededRoots: 0, invalidatedOffers: 0, invalidatedFunnels: 0, invalidatedIntegrity: 0 };
  }

  const supersededRootId = activeRoot.id;

  await db.update(strategyRoots)
    .set({ status: "SUPERSEDED" })
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ));

  let invalidatedOffers = 0;
  let invalidatedFunnels = 0;
  let invalidatedIntegrity = 0;

  try {
    const offerResult = await db.update(offerSnapshots)
      .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
      .where(and(
        eq(offerSnapshots.campaignId, campaignId),
        eq(offerSnapshots.accountId, accountId),
        eq(offerSnapshots.strategyRootId, supersededRootId),
      ));
    invalidatedOffers = (offerResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark offer snapshots (non-critical): ${(e as Error).message}`);
  }

  try {
    const funnelResult = await db.update(funnelSnapshots)
      .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
      .where(and(
        eq(funnelSnapshots.campaignId, campaignId),
        eq(funnelSnapshots.accountId, accountId),
        eq(funnelSnapshots.strategyRootId, supersededRootId),
      ));
    invalidatedFunnels = (funnelResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark funnel snapshots (non-critical): ${(e as Error).message}`);
  }

  try {
    const integrityResult = await db.update(integritySnapshots)
      .set({ statusMessage: `Invalidated: upstream ${regeneratedEngine} engine regenerated (root ${supersededRootId} superseded)` })
      .where(and(
        eq(integritySnapshots.campaignId, campaignId),
        eq(integritySnapshots.accountId, accountId),
        eq(integritySnapshots.strategyRootId, supersededRootId),
      ));
    invalidatedIntegrity = (integrityResult as any)?.rowCount || 0;
  } catch (e) {
    console.log(`[StrategyRoot] Could not mark integrity snapshots (non-critical): ${(e as Error).message}`);
  }

  console.log(`[StrategyRoot] INVALIDATED | root=${supersededRootId} | trigger=${regeneratedEngine} | campaign=${campaignId} | offers=${invalidatedOffers} | funnels=${invalidatedFunnels} | integrity=${invalidatedIntegrity}`);

  return { supersededRoots: 1, invalidatedOffers, invalidatedFunnels, invalidatedIntegrity };
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
