/**
 * Avyron — Weekly Business Inventory Routes.
 */

import { Router, Request, Response } from "express";
import { resolveAccountId } from "../auth";
import { resolveAccountIdFromCampaign } from "./account-resolver";
import {
  WeeklyInventoryValidationError,
  getOrCreateWeeklyInventory,
  submitWeeklyInventoryMetrics,
} from "./weekly-inventory-engine";
import {
  getCampaignClockOverride,
  resolveEffectiveNow,
  setCampaignClockOverride,
} from "./clock";

const router = Router();

// GET active weekly business inventory
router.get("/weekly-inventory/:campaignId", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);
    const now = resolveEffectiveNow(campaignId, req.query.nowOverride as string | undefined, req);

    const payload = await getOrCreateWeeklyInventory(accountId, campaignId, now);
    return res.json(payload);
  } catch (err: any) {
    const status = err?.name === "AccountScopeError" ? 403 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// GET/POST controlled campaign clock override for isolated fixture lifecycle verification
router.get("/clock/:campaignId", async (req: Request, res: Response) => {
  const { campaignId } = req.params;
  const override = getCampaignClockOverride(campaignId);
  const effectiveNow = resolveEffectiveNow(campaignId, undefined, req);
  return res.json({
    campaignId,
    clockOverride: override ? override.toISOString() : null,
    effectiveNow: effectiveNow.toISOString(),
  });
});

router.post("/clock/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const { now } = req.body || {};
    setCampaignClockOverride(campaignId, now ?? null);
    const override = getCampaignClockOverride(campaignId);
    const effectiveNow = resolveEffectiveNow(campaignId);
    return res.json({
      success: true,
      campaignId,
      clockOverride: override ? override.toISOString() : null,
      effectiveNow: effectiveNow.toISOString(),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST submit weekly business inventory metrics
router.post("/weekly-inventory/:campaignId/submit", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    const { inventoryId, metrics, __simulateDownstreamFailure, __nowOverride } = req.body || {};
    if (!inventoryId || !metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
      return res.status(400).json({
        error: "inventoryId and metrics object are required.",
        code: "MISSING_REQUIRED_FIELDS",
      });
    }

    const result = await submitWeeklyInventoryMetrics({
      inventoryId,
      accountId,
      campaignId,
      metrics,
      nowOverride: __nowOverride ? new Date(__nowOverride) : undefined,
      simulateDownstreamFailure: Boolean(__simulateDownstreamFailure),
    });

    return res.json(result);
  } catch (err: any) {
    const status =
      err instanceof WeeklyInventoryValidationError
        ? err.status
        : typeof err?.status === "number" && err.status >= 400 && err.status < 500
          ? err.status
          : err?.name === "AccountScopeError"
            ? 403
            : 500;
    return res.status(status).json({
      error: err.message,
      code: err.code || (status === 400 ? "VALIDATION_ERROR" : "SERVER_ERROR"),
    });
  }
});

export function registerWeeklyInventoryRoutes(app: any) {
  app.use("/api/performance", router);
}

export default router;
