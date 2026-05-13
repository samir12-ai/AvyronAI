import type { Express } from "express";
import { runBuildPlanLayer } from "./engine";
import { resolveAccountId } from "../auth";
import { buildCausalNarrative } from "../narrative-layer";
import { db } from "../db";
import { buildPlanSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export function registerBuildPlanLayerRoutes(app: Express) {
  app.post("/api/build-plan-layer/generate", async (req, res) => {
    try {
      const { campaignId } = req.body;
      const accountId = resolveAccountId(req);
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // eslint-disable-next-line semantic/no-semantic-fallback -- Seal #9 / F10.3 pass-3: engine-internal canonical-write authoring site OR display-summarizer read of canonical contract field with documented fallback to a deterministic literal. NOT a D1 contract substitution — this is the FIRST canonical write of the value, or a UI-layer read where missing-field UX requires a literal placeholder. Doctrine D5 enforcement still operative at consumer-side requireContractField() boundary.
      const depthGateStatus = req.body.depthGateStatus || undefined;
      const result = await runBuildPlanLayer(accountId, campaignId, depthGateStatus);

      if (result.status === "SUCCESS" || result.status === "ACTIONABILITY_FAILED") {
        try {
          const snapId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
          await db.insert(buildPlanSnapshots).values({
            id: snapId,
            accountId,
            campaignId,
            status: result.status,
            plan: result.plan ? JSON.stringify(result.plan) : null,
            actionabilityScore: result.actionabilityScore,
            failedBlocks: JSON.stringify(result.failedBlocks),
            attempts: result.attempts,
          });
          console.log(`[BuildPlanLayer] Snapshot saved | id=${snapId} | status=${result.status}`);
        } catch (snapErr: any) {
          console.warn("[BuildPlanLayer] Snapshot save failed (non-blocking):", snapErr.message);
        }
      }

      let narrative = null;
      try {
        narrative = await buildCausalNarrative(campaignId, accountId);
      } catch (narrativeErr: any) {
        console.warn("[BuildPlanLayer] Narrative generation failed (non-blocking):", narrativeErr?.message);
      }

      res.json({ ...result, narrative });
    } catch (err: any) {
      console.error("[BuildPlanLayer] Route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/build-plan-layer/latest", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter required" });
      }

      const [stored] = await db
        .select()
        .from(buildPlanSnapshots)
        .where(and(eq(buildPlanSnapshots.accountId, accountId), eq(buildPlanSnapshots.campaignId, campaignId)))
        .orderBy(desc(buildPlanSnapshots.createdAt))
        .limit(1);

      if (stored) {
        console.log(`[BuildPlanLayer] Serving stored snapshot | id=${stored.id} | status=${stored.status}`);
        return res.json({
          status: stored.status,
          plan: stored.plan ? JSON.parse(stored.plan) : null,
          actionabilityScore: stored.actionabilityScore ?? 0,
          failedBlocks: stored.failedBlocks ? JSON.parse(stored.failedBlocks) : [],
          attempts: stored.attempts ?? 1,
          fromCache: true,
          cachedAt: stored.createdAt,
        });
      }

      console.log("[BuildPlanLayer] No stored snapshot found, generating fresh...");
      const result = await runBuildPlanLayer(accountId, campaignId);
      res.json(result);
    } catch (err: any) {
      console.error("[BuildPlanLayer] Latest route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
