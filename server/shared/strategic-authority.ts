// @ts-nocheck
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  strategyRoots as strategyRootsTable,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
} from "../../shared/schema";
import { deriveValidatedCapabilities } from "./capability-registry";
import { loadCampaignProductAnchor } from "../orchestrator/doctrine-seed";
import { loadProductDNA } from "./product-dna";

export interface StrategicAuthorityState {
  campaignId: string;
  accountId: string;
  jobId: string;
  strategyRootId: string;
  rootHash: string;
  validatedCapabilityIds: string[];
  authoritativePainIds: string[];
  authoritativeObjectionIds: string[];
  authoritativeDesireIds: string[];
  positioningWinnerId: string | null;
  differentiationWinnerId: string | null;
  mechanismWinnerId: string | null;
  offerWinnerId: string | null;
  reusedFromRootId: string | null;
  sourceRootId: string | null;
}

export class StrategicAuthorityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategicAuthorityMismatchError";
  }
}

export function parseStringifiedList(val: any): any[] {
  if (!val) return [];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

export function safeJsonParse<T = any>(val: any, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val !== "string") return val as T;
  try {
    return (JSON.parse(val) ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Loads the active strategy root and derives/validates the entire system-wide strategic authority state.
 * Throws StrategicAuthorityMismatchError if any lineage check fails or if stale N-1 runs are detected.
 */
export async function resolveStrategicAuthority(
  campaignId: string,
  accountId: string,
  jobId: string
): Promise<StrategicAuthorityState> {
  const [activeRoot] = await db
    .select()
    .from(strategyRootsTable)
    .where(
      and(
        eq(strategyRootsTable.campaignId, campaignId),
        eq(strategyRootsTable.accountId, accountId),
        eq(strategyRootsTable.status, "ACTIVE")
      )
    )
    .orderBy(desc(strategyRootsTable.createdAt))
    .limit(1);

  if (!activeRoot) {
    throw new StrategicAuthorityMismatchError(`No active Strategy Root found for campaign ${campaignId}`);
  }

  // Strict lineage sanity check: current run jobId MUST match Strategy Root's runId.
  // If they mismatch, it indicates a stale N-1 Strategy Root leakage!
  if (activeRoot.runId !== jobId) {
    throw new StrategicAuthorityMismatchError(
      `Strategy Root lineage mismatch: active root ${activeRoot.id} belongs to runId ${activeRoot.runId} but current run jobId is ${jobId}`
    );
  }

  // Derive validated capabilities deterministically
  const anchor = await loadCampaignProductAnchor(campaignId, accountId);
  const dna = await loadProductDNA(campaignId, accountId);
  const capabilities = deriveValidatedCapabilities(anchor, dna);
  const validatedCapabilityIds = capabilities.map((c) => c.capabilityId);

  // Extract canonical pains, desires, and objections
  const approvedPains = parseStringifiedList(activeRoot.approvedAudiencePains);
  const authoritativePainIds = approvedPains.map((p: any) => p?.painId || p?.id).filter(Boolean);

  const approvedObjections = parseStringifiedList(activeRoot.approvedObjections);
  const authoritativeObjectionIds = approvedObjections.map((o: any) => o?.painId || o?.id || o?.objectionId).filter(Boolean);

  const approvedDesires = parseStringifiedList(activeRoot.approvedDesires);
  const authoritativeDesireIds = approvedDesires.map((d: any) => d?.painId || d?.id).filter(Boolean);

  // Extract winner IDs
  // 1. Positioning Winner
  let positioningWinnerId: string | null = null;
  if (activeRoot.positioningSnapshotId && activeRoot.positioningSnapshotId !== "N/A") {
    const [posSnap] = await db
      .select()
      .from(positioningSnapshots)
      .where(eq(positioningSnapshots.id, activeRoot.positioningSnapshotId))
      .limit(1);
    positioningWinnerId = posSnap?.territory || activeRoot.contrastAxisText || null;
  }

  // 2. Differentiation Winner
  let differentiationWinnerId: string | null = null;
  if (activeRoot.differentiationSnapshotId && activeRoot.differentiationSnapshotId !== "N/A") {
    const [diffSnap] = await db
      .select()
      .from(differentiationSnapshots)
      .where(eq(differentiationSnapshots.id, activeRoot.differentiationSnapshotId))
      .limit(1);
    const pillars = safeJsonParse<any[]>(diffSnap?.differentiationPillars, []);
    differentiationWinnerId = pillars[0]?.pillarName || pillars[0]?.pillar || activeRoot.approvedClaim || null;
  }

  // 3. Mechanism Winner
  let mechanismWinnerId: string | null = null;
  const primaryMech = safeJsonParse(activeRoot.approvedMechanism, null);
  mechanismWinnerId = primaryMech?.mechanismId || primaryMech?.mechanismName || null;

  // 4. Offer Winner
  let offerWinnerId: string | null = null;
  const [offerSnap] = await db
    .select()
    .from(offerSnapshots)
    .where(eq(offerSnapshots.strategyRootId, activeRoot.id))
    .limit(1);
  if (offerSnap) {
    const primaryOffer = safeJsonParse(offerSnap.primaryOffer, null);
    offerWinnerId = primaryOffer?.offerId || primaryOffer?.offerName || null;
  }

  return {
    campaignId,
    accountId,
    jobId,
    strategyRootId: activeRoot.id,
    rootHash: activeRoot.rootHash,
    validatedCapabilityIds,
    authoritativePainIds,
    authoritativeObjectionIds,
    authoritativeDesireIds,
    positioningWinnerId,
    differentiationWinnerId,
    mechanismWinnerId,
    offerWinnerId,
    reusedFromRootId: activeRoot.reusedFromRootId || null,
    sourceRootId: activeRoot.sourceRootId || null,
  };
}
