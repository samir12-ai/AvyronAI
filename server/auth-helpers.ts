/**
 * Auth helpers — P0-4 of runtime-truth-isolation-seal.
 *
 * Centralised ownership assertion for any route that accepts a campaignId,
 * runId, jobId, snapshotId, or fetchJobId in the request body/query/params.
 * The previous pattern (resolveAccountId(req) + trust the body campaignId)
 * meant any authed user could read/write another tenant's snapshots simply by
 * supplying their campaignId. requireCampaign in campaign-routes.ts already
 * enforces this via campaignSelections; this module provides a lightweight,
 * non-middleware variant for routes that resolve campaignId outside the
 * request lifecycle (workers, internal triggers, body-level campaignId).
 */
import { db } from "./db";
import { campaignSelections, orchestratorJobs, miFetchJobs, strategicPlans } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export class PlanOwnershipError extends Error {
  status = 404;
  code = "PLAN_NOT_FOUND";
  constructor(public accountId: string, public planId: string) {
    super(`Plan ${planId} not found for account ${accountId}`);
    this.name = "PlanOwnershipError";
  }
}

/**
 * Assert that `planId` belongs to `accountId`. Throws PlanOwnershipError (404)
 * if not. Use BEFORE any read/write that uses the planId.
 *
 * Returns the plan's campaignId so callers can avoid a second lookup.
 */
export async function assertPlanBelongsTo(
  accountId: string,
  planId: string,
): Promise<string> {
  if (!accountId || !planId) {
    throw new PlanOwnershipError(accountId, planId);
  }
  const [row] = await db
    .select({ campaignId: strategicPlans.campaignId })
    .from(strategicPlans)
    .where(and(
      eq(strategicPlans.id, planId),
      eq(strategicPlans.accountId, accountId),
    ))
    .limit(1);
  if (!row) {
    throw new PlanOwnershipError(accountId, planId);
  }
  return row.campaignId;
}

export class CampaignOwnershipError extends Error {
  status = 404; // 404 not 403 — never confirm existence to a non-owner.
  code = "CAMPAIGN_NOT_FOUND";
  constructor(public accountId: string, public campaignId: string) {
    super(`Campaign ${campaignId} not found for account ${accountId}`);
    this.name = "CampaignOwnershipError";
  }
}

export class JobOwnershipError extends Error {
  status = 404;
  code = "JOB_NOT_FOUND";
  constructor(public accountId: string, public jobId: string) {
    super(`Job ${jobId} not found for account ${accountId}`);
    this.name = "JobOwnershipError";
  }
}

/**
 * Assert that `campaignId` belongs to `accountId`. Throws CampaignOwnershipError
 * (404) if not. Use BEFORE any read/write that uses the campaignId.
 */
export async function assertCampaignBelongsTo(
  accountId: string,
  campaignId: string,
): Promise<void> {
  if (!accountId || !campaignId) {
    throw new CampaignOwnershipError(accountId, campaignId);
  }
  const [row] = await db
    .select({ id: campaignSelections.id })
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, accountId),
      eq(campaignSelections.selectedCampaignId, campaignId),
    ))
    .limit(1);
  if (!row) {
    throw new CampaignOwnershipError(accountId, campaignId);
  }
}

/**
 * Assert that an orchestrator runId/jobId belongs to the account. Returns the
 * matching row or throws JobOwnershipError (404).
 */
export async function assertOrchestratorJobBelongsTo(
  accountId: string,
  jobId: string,
): Promise<typeof orchestratorJobs.$inferSelect> {
  const [row] = await db
    .select()
    .from(orchestratorJobs)
    .where(and(
      eq(orchestratorJobs.id, jobId),
      eq(orchestratorJobs.accountId, accountId),
    ))
    .limit(1);
  if (!row) {
    throw new JobOwnershipError(accountId, jobId);
  }
  return row;
}

/**
 * Assert that an MI-V3 fetch job belongs to the account. Returns the row or
 * throws JobOwnershipError (404).
 */
export async function assertFetchJobBelongsTo(
  accountId: string,
  fetchJobId: string,
): Promise<typeof miFetchJobs.$inferSelect> {
  const [row] = await db
    .select()
    .from(miFetchJobs)
    .where(and(
      eq(miFetchJobs.id, fetchJobId),
      eq(miFetchJobs.accountId, accountId),
    ))
    .limit(1);
  if (!row) {
    throw new JobOwnershipError(accountId, fetchJobId);
  }
  return row;
}

import { verifyToken } from "./auth";

export class AuthenticationRequiredError extends Error {
  status = 401;
  code = "AUTHENTICATION_REQUIRED";
  constructor(message = "Authentication required for plan approval or rejection") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export class PlanAuthorizationError extends Error {
  status = 403;
  code = "FORBIDDEN_PLAN_ACCESS";
  constructor(message = "Account does not have authorization to approve or reject this plan") {
    super(message);
    this.name = "PlanAuthorizationError";
  }
}

/** Express helper: writes a JSON 4xx if the error is an ownership error.
 *  P3 isolation seal: response body intentionally OMITS campaignId/accountId
 *  to prevent attacker-supplied identifiers from being reflected back in
 *  denial responses (cross-tenant identifier leak surface). */
export function handleOwnershipError(err: unknown, res: any): boolean {
  if (err instanceof AuthenticationRequiredError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof PlanAuthorizationError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof CampaignOwnershipError) {
    res.status(err.status).json({ error: err.code, message: "Campaign not found" });
    return true;
  }
  if (err instanceof JobOwnershipError) {
    res.status(err.status).json({ error: err.code, message: "Job not found" });
    return true;
  }
  if (err instanceof PlanOwnershipError) {
    res.status(err.status).json({ error: err.code, message: "Plan not found" });
    return true;
  }
  return false;
}

/**
 * Resolves the genuine provenance actor for plan approval/rejection.
 * Strictly verifies authentication and account matching.
 * Never defaults unauthenticated callers to "automation_script" and never trusts caller-supplied decidedBy/x-actor-id.
 */
export function resolveApprovalProvenance(req: any, plan?: { accountId?: string }): string {
  let userId = req.userId || req.user?.id;
  let accountId = req.accountId || (req.user as any)?.accountId;
  let userEmail = req.user?.email;

  // If not already resolved by middleware, try bearer token from headers
  if (!userId && req.headers?.authorization?.startsWith("Bearer ")) {
    const token = req.headers.authorization.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      userId = payload.userId;
      accountId = payload.accountId || payload.userId;
      userEmail = payload.email;
    }
  }

  // Strict check: unauthenticated requests cannot approve or reject plans
  if (!userId && !accountId) {
    throw new AuthenticationRequiredError("Authentication required: unauthenticated callers cannot approve or reject plans");
  }

  // Account boundary: caller account must match the plan's account
  if (plan?.accountId && accountId && accountId !== plan.accountId) {
    throw new PlanAuthorizationError(`Account mismatch: caller account ${accountId} cannot act on plan for account ${plan.accountId}`);
  }

  const identifier = userEmail || userId || accountId;
  return `client:${identifier}`;
}
