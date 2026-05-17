import type { Express } from "express";
import { runBuildPlanLayer } from "./engine";
import { resolveAccountId } from "../auth";
import { buildCausalNarrative } from "../narrative-layer";
import { db } from "../db";
import { buildPlanSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveRunId } from "../orchestrator/run-resolver";

export function registerBuildPlanLayerRoutes(app: Express) {
  app.post("/api/build-plan-layer/generate", async (req, res) => {
    try {
      const { campaignId } = req.body;
      const accountId = resolveAccountId(req);
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const depthGateStatusInput = req.body.depthGateStatus || undefined;

      // Resolve the most recent completed orchestrator run for this campaign
      // so build-plan synthesis is bound to a single coherent run (the
      // engine hard-blocks with STALE_LINEAGE when sourceJobId is missing).
      // Body-supplied `sourceJobId` wins (operator path); otherwise resolve.
      let sourceJobId: string | null = (req.body?.sourceJobId as string) || null;
      if (!sourceJobId) {
        try {
          const resolved = await resolveRunId(campaignId, accountId, null);
          sourceJobId = resolved.runId ?? null;
        } catch (resolveErr: any) {
          console.warn(
            `[BuildPlanLayer] Run resolve failed for campaign ${campaignId}: ${resolveErr?.message ?? resolveErr}`,
          );
          sourceJobId = null;
        }
      }

      if (!sourceJobId) {
        // Customer-safe: no completed strategy run yet, so we cannot build a
        // plan. Return a NEEDS_STRATEGY_RUN status the UI knows how to render
        // instead of leaking the raw STALE_LINEAGE engine block.
        return res.json({
          status: "NEEDS_STRATEGY_RUN",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: 0,
          message:
            "We need a completed strategy run before we can build a plan. Run the strategy engines, then try again.",
        });
      }

      const result = await runBuildPlanLayer(
        accountId,
        campaignId,
        depthGateStatusInput,
        sourceJobId,
      );

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
      res.status(500).json({
        status: "ERROR",
        error: "PLAN_BUILD_FAILED",
        message: "We couldn't build your plan right now. Please try again in a moment.",
      });
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
      let sourceJobId: string | null = null;
      try {
        const resolved = await resolveRunId(campaignId, accountId, null);
        sourceJobId = resolved.runId ?? null;
      } catch (resolveErr: any) {
        console.warn(
          `[BuildPlanLayer] Run resolve failed for campaign ${campaignId}: ${resolveErr?.message ?? resolveErr}`,
        );
      }
      if (!sourceJobId) {
        return res.json({
          status: "NEEDS_STRATEGY_RUN",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: 0,
          message:
            "We need a completed strategy run before we can build a plan. Run the strategy engines, then try again.",
        });
      }
      const result = await runBuildPlanLayer(accountId, campaignId, undefined, sourceJobId);
      res.json(result);
    } catch (err: any) {
      console.error("[BuildPlanLayer] Latest route error:", err.message);
      res.status(500).json({
        status: "ERROR",
        error: "PLAN_LOAD_FAILED",
        message: "We couldn't load your latest plan right now. Please try again.",
      });
    }
  });
}
