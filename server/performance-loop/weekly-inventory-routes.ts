/**
 * Avyron — Weekly Business Inventory Routes.
 */

import { Router, Request, Response } from "express";
import { resolveAccountId } from "../auth";
import { resolveAccountIdFromCampaign } from "./account-resolver";
import {
  getOrCreateWeeklyInventory,
  submitWeeklyInventoryMetrics,
} from "./weekly-inventory-engine";

const router = Router();

// GET active weekly business inventory
router.get("/weekly-inventory/:campaignId", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    const payload = await getOrCreateWeeklyInventory(accountId, campaignId);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST submit weekly business inventory metrics
router.post("/weekly-inventory/:campaignId/submit", async (req: Request, res: Response) => {
  try {
    const authedAccountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const accountId = await resolveAccountIdFromCampaign(campaignId, authedAccountId);

    const { inventoryId, metrics } = req.body;
    if (!inventoryId || !metrics) {
      return res.status(400).json({ error: "inventoryId and metrics object are required." });
    }

    const result = await submitWeeklyInventoryMetrics({
      inventoryId,
      accountId,
      campaignId,
      metrics,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export function registerWeeklyInventoryRoutes(app: any) {
  app.use("/api/performance", router);
}

export default router;
