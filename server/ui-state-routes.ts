import type { Express, Request, Response } from "express";
import { db } from "./db";
import { requireCampaign } from "./campaign-routes";
import { uiStateStore } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const LOG_PREFIX = "[UIState]";
const VALID_MODULES = ["create", "studio", "ai-management", "calendar", "settings"];

export function registerUIStateRoutes(app: Express) {
  app.get("/api/ui-state/:moduleKey", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { moduleKey } = req.params;

      if (!VALID_MODULES.includes(moduleKey)) {
        return res.status(400).json({ success: false, code: 400, message: `Invalid moduleKey: ${moduleKey}` });
      }

      const rows = await db
        .select()
        .from(uiStateStore)
        .where(
          and(
            eq(uiStateStore.accountId, accountId),
            eq(uiStateStore.campaignId, campaignId),
            eq(uiStateStore.moduleKey, moduleKey)
          )
        )
        .limit(1);

      if (rows.length === 0) {
        return res.json({ success: true, exists: false, stateData: null, updatedAt: null });
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(rows[0].stateData);
      } catch {
        parsed = null;
      }

      res.json({
        success: true,
        exists: true,
        stateData: parsed,
        updatedAt: rows[0].updatedAt,
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} GET error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load UI state" });
    }
  });

  app.put("/api/ui-state/:moduleKey", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { moduleKey } = req.params;
      const { stateData } = req.body;

      if (!VALID_MODULES.includes(moduleKey)) {
        return res.status(400).json({ success: false, code: 400, message: `Invalid moduleKey: ${moduleKey}` });
      }

      if (stateData === undefined || stateData === null) {
        return res.status(400).json({ success: false, code: 400, message: "stateData is required" });
      }

      const serialized = typeof stateData === "string" ? stateData : JSON.stringify(stateData);
      const now = new Date();

      const existing = await db
        .select({ id: uiStateStore.id })
        .from(uiStateStore)
        .where(
          and(
            eq(uiStateStore.accountId, accountId),
            eq(uiStateStore.campaignId, campaignId),
            eq(uiStateStore.moduleKey, moduleKey)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(uiStateStore)
          .set({ stateData: serialized, updatedAt: now })
          .where(eq(uiStateStore.id, existing[0].id));
      } else {
        await db
          .insert(uiStateStore)
          .values({
            accountId,
            campaignId,
            moduleKey,
            stateData: serialized,
            updatedAt: now,
          });
      }

      res.json({ success: true, updatedAt: now });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} PUT error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to save UI state" });
    }
  });

  app.delete("/api/ui-state/:moduleKey", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { moduleKey } = req.params;

      if (!VALID_MODULES.includes(moduleKey)) {
        return res.status(400).json({ success: false, code: 400, message: `Invalid moduleKey: ${moduleKey}` });
      }

      await db
        .delete(uiStateStore)
        .where(
          and(
            eq(uiStateStore.accountId, accountId),
            eq(uiStateStore.campaignId, campaignId),
            eq(uiStateStore.moduleKey, moduleKey)
          )
        );

      res.json({ success: true });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} DELETE error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to delete UI state" });
    }
  });
}
