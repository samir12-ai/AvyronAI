import { db } from "../db";
import { 
  campaignOfferings, 
  offeringInputEvidence, 
  businessUnderstandingSnapshots,
  type BusinessUnderstandingSnapshotRow
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { BusinessUnderstandingPayload } from "@shared/business-understanding-types";

export interface ResolveCurrentBusinessUnderstandingParams {
  accountId: string;
  campaignId: string;
  campaignOfferingId?: string;
}

export interface CurrentBusinessUnderstandingResult {
  snapshotId: string;
  campaignOfferingId: string;
  offeringInputEvidenceId: string;
  offeringName: string;
  authorityType: string;
  payload: BusinessUnderstandingPayload;
  status: string;
  createdAt: Date;
  snapshotRow: BusinessUnderstandingSnapshotRow;
}

/**
 * Canonical Business Understanding Resolver (Fail-Closed)
 * 
 * Strict Authority Contract:
 * Downstream readers MUST read the Business Understanding snapshot belonging to the
 * CURRENT canonical Hero Product authority (campaign_offerings + offering_input_evidence).
 * 
 * A snapshot is CURRENT only when ALL match:
 * - accountId
 * - campaignId
 * - campaignOfferingId = current offering ID
 * - offeringInputEvidenceId = current sourceInputEvidenceId
 * - status = 'COMPLETE'
 * 
 * Does NOT select current authority using createdAt alone.
 */
export async function resolveCurrentBusinessUnderstanding(
  params: ResolveCurrentBusinessUnderstandingParams
): Promise<CurrentBusinessUnderstandingResult | null> {
  const { accountId, campaignId, campaignOfferingId } = params;

  if (!accountId || !campaignId) {
    return null;
  }

  // 1. Resolve current canonical offering for the campaign
  const offeringConditions = [
    eq(campaignOfferings.accountId, accountId),
    eq(campaignOfferings.campaignId, campaignId)
  ];
  if (campaignOfferingId) {
    offeringConditions.push(eq(campaignOfferings.id, campaignOfferingId));
  }

  const [currentOffering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(...offeringConditions))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!currentOffering || !currentOffering.sourceInputEvidenceId) {
    return null;
  }

  const currentOfferingId = currentOffering.id;
  const currentEvidenceId = currentOffering.sourceInputEvidenceId;

  // 2. Verify offering_input_evidence exists for this sourceInputEvidenceId
  const [evidenceRow] = await db
    .select()
    .from(offeringInputEvidence)
    .where(
      and(
        eq(offeringInputEvidence.id, currentEvidenceId),
        eq(offeringInputEvidence.accountId, accountId),
        eq(offeringInputEvidence.campaignId, campaignId)
      )
    )
    .limit(1);

  const authorityType = evidenceRow?.authorityType || "UNKNOWN";

  // 3. Resolve COMPLETE Business Understanding snapshot with exact authority linkage
  const [buSnapshot] = await db
    .select()
    .from(businessUnderstandingSnapshots)
    .where(
      and(
        eq(businessUnderstandingSnapshots.accountId, accountId),
        eq(businessUnderstandingSnapshots.campaignId, campaignId),
        eq(businessUnderstandingSnapshots.campaignOfferingId, currentOfferingId),
        eq(businessUnderstandingSnapshots.offeringInputEvidenceId, currentEvidenceId),
        eq(businessUnderstandingSnapshots.status, "COMPLETE")
      )
    )
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  if (!buSnapshot || !buSnapshot.businessUnderstanding) {
    return null;
  }

  const payload = typeof buSnapshot.businessUnderstanding === "string"
    ? JSON.parse(buSnapshot.businessUnderstanding)
    : buSnapshot.businessUnderstanding;

  if ((payload as any).status && (payload as any).status !== "COMPLETE") {
    return null;
  }

  return {
    snapshotId: buSnapshot.id,
    campaignOfferingId: currentOfferingId,
    offeringInputEvidenceId: currentEvidenceId,
    offeringName: currentOffering.offeringName,
    authorityType,
    payload: payload as BusinessUnderstandingPayload,
    status: buSnapshot.status,
    createdAt: buSnapshot.createdAt,
    snapshotRow: buSnapshot
  };
}

/**
 * Resolves current canonical Business Understanding or throws FAIL-CLOSED error.
 */
export async function resolveCurrentBusinessUnderstandingOrThrow(
  params: ResolveCurrentBusinessUnderstandingParams
): Promise<CurrentBusinessUnderstandingResult> {
  const result = await resolveCurrentBusinessUnderstanding(params);
  if (!result) {
    throw new Error(
      `[BusinessUnderstandingResolver] FAIL-CLOSED: No COMPLETE Business Understanding snapshot found matching current canonical offering authority for accountId=${params.accountId}, campaignId=${params.campaignId}${params.campaignOfferingId ? `, offeringId=${params.campaignOfferingId}` : ""}.`
    );
  }
  return result;
}
