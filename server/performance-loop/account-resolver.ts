import { db } from "../db";
import { businessDataLayer, campaignSelections, strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

export class AccountCampaignMismatchError extends Error {
  constructor(campaignId: string, providedAccountId: string, canonicalAccountId: string) {
    super(`ACCOUNT_CAMPAIGN_MISMATCH: Provided accountId "${providedAccountId}" does not match canonical accountId "${canonicalAccountId}" for campaignId "${campaignId}".`);
    this.name = "AccountCampaignMismatchError";
  }
}

export class CampaignNotFoundError extends Error {
  constructor(campaignId: string) {
    super(`CAMPAIGN_NOT_FOUND: Could not resolve canonical accountId for campaignId "${campaignId}".`);
    this.name = "CampaignNotFoundError";
  }
}

/**
 * Canonical Campaign Account Resolver:
 * Resolves the true canonical accountId for any given campaignId.
 * If providedAccountId is also passed, asserts that providedAccountId matches canonical accountId.
 * Fails closed on mismatch.
 */
export async function resolveAccountIdFromCampaign(
  campaignId: string,
  providedAccountId?: string | null
): Promise<string> {
  let canonicalAccountId: string | null = null;

  // 1. Check businessDataLayer
  const [bizData] = await db
    .select({ accountId: businessDataLayer.accountId })
    .from(businessDataLayer)
    .where(eq(businessDataLayer.campaignId, campaignId))
    .limit(1);

  if (bizData?.accountId) {
    canonicalAccountId = bizData.accountId;
  }

  // 2. Fallback to campaignSelections
  if (!canonicalAccountId) {
    const [sel] = await db
      .select({ accountId: campaignSelections.accountId })
      .from(campaignSelections)
      .where(eq(campaignSelections.selectedCampaignId, campaignId))
      .limit(1);

    if (sel?.accountId) {
      canonicalAccountId = sel.accountId;
    }
  }

  // 3. Fallback to strategicPlans
  if (!canonicalAccountId) {
    const [plan] = await db
      .select({ accountId: strategicPlans.accountId })
      .from(strategicPlans)
      .where(eq(strategicPlans.campaignId, campaignId))
      .limit(1);

    if (plan?.accountId) {
      canonicalAccountId = plan.accountId;
    }
  }

  if (!canonicalAccountId) {
    throw new CampaignNotFoundError(campaignId);
  }

  // Assertion & Hard Invariant
  if (providedAccountId && providedAccountId !== canonicalAccountId) {
    throw new AccountCampaignMismatchError(campaignId, providedAccountId, canonicalAccountId);
  }

  return canonicalAccountId;
}
