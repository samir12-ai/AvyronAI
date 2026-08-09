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

      // Depth-gate map + AEL are loaded SERVER-SIDE inside runBuildPlanLayer
      // from the run's persisted state (orchestrator_jobs.depth_gate_status /
      // ael_snapshots, bound by sourceJobId + accountId). We deliberately do
      // NOT read req.body.depthGateStatus: a client-supplied gate-admission map
      // is an integrity hole — it would let a caller decide which engines
      // "passed" the depth gate and thus which snapshots enter synthesis.

      // Resolve the most recent completed orchestrator run for this campaign
      // so build-plan synthesis is bound to a single coherent run (the
      // engine hard-blocks with STALE_LINEAGE when sourceJobId is missing).
      // Body-supplied `sourceJobId` wins (operator path); otherwise resolve.
      const requestedJobId: string | null = (req.body?.sourceJobId as string) || null;
      let sourceJobId: string | null = requestedJobId;
      let resolved: Awaited<ReturnType<typeof resolveRunId>> | null = null;
      if (!sourceJobId) {
        try {
          resolved = await resolveRunId(campaignId, accountId, null);
          sourceJobId = resolved.runId ?? null;
        } catch (resolveErr: any) {
          console.warn(
            `[BuildPlanLayer] Run resolve failed for campaign ${campaignId}: ${resolveErr?.message ?? resolveErr}`,
          );
          sourceJobId = null;
        }
      }

      if (resolved?.isStale && !requestedJobId) {
        return res.json({
          jobId: null,
          shadowedByRun: resolved.newerNonResolvableRun?.runId ?? null,
          status: "CURRENT_RUN_PLAN_NOT_PERSISTED",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: 0,
          message: "A more recent run attempt is in progress or failed. Wait for it to complete before building a new plan.",
        });
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
        undefined,
        sourceJobId,
      );

      if (result.status === "SUCCESS" || result.status === "ACTIONABILITY_FAILED") {
        try {
          const snapId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
          await db.insert(buildPlanSnapshots).values({
            id: snapId,
            accountId,
            campaignId,
            jobId: sourceJobId,
            status: result.status,
            plan: result.plan ? JSON.stringify(result.plan) : null,
            actionabilityScore: result.actionabilityScore,
            failedBlocks: JSON.stringify(result.failedBlocks),
            attempts: result.attempts,
          });
          console.log(`[BuildPlanLayer] Snapshot saved | id=${snapId} | job=${sourceJobId} | status=${result.status}`);
        } catch (snapErr: any) {
          console.error("[BuildPlanLayer] Snapshot save failed:", snapErr.message);
          return res.status(500).json({
            status: "ERROR",
            error: "PLAN_PERSIST_FAILED",
            plan: null,
            actionabilityScore: 0,
            failedBlocks: [],
            attempts: result.attempts,
            jobId: sourceJobId,
            message: "Your plan was not saved, so we will not show an unverified result. Please try again.",
          });
        }
      }

      let narrative = null;
      try {
        narrative = await buildCausalNarrative(campaignId, accountId, sourceJobId);
      } catch (narrativeErr: any) {
        console.warn("[BuildPlanLayer] Narrative generation failed (non-blocking):", narrativeErr?.message);
      }

      // Include the exact source job so the client can carry run lineage.
      res.json({ ...result, jobId: sourceJobId, narrative });
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

      const requestedJobId = typeof req.query.jobId === "string" ? req.query.jobId : null;
      let resolved;
      try {
        resolved = await resolveRunId(campaignId, accountId, requestedJobId);
      } catch (resolveErr: any) {
        return res.status(404).json({
          status: "RUN_NOT_FOUND",
          error: resolveErr?.message ?? "RUN_NOT_FOUND",
          plan: null,
        });
      }

      if (!resolved.runId) {
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

      // When a newer failed/running/cancelled run shadows the last resolvable run
      // AND the caller did not pin an explicit jobId, serving the older snapshot
      // would silently present stale data as fresh. Fail closed instead so the
      // client can inform the user to wait for the new run to complete.
      if (resolved.isStale && !requestedJobId) {
        return res.json({
          jobId: null,
          shadowedByRun: resolved.newerNonResolvableRun?.runId ?? null,
          status: "CURRENT_RUN_PLAN_NOT_PERSISTED",
          plan: null,
          actionabilityScore: 0,
          failedBlocks: [],
          attempts: 0,
          message:
            "A more recent run attempt is in progress or failed — the previous plan is no longer current. Wait for the run to complete, then reload.",
        });
      }

      const [stored] = await db
        .select()
        .from(buildPlanSnapshots)
        .where(and(
          eq(buildPlanSnapshots.accountId, accountId),
          eq(buildPlanSnapshots.campaignId, campaignId),
          eq(buildPlanSnapshots.jobId, resolved.runId),
        ))
        .orderBy(desc(buildPlanSnapshots.createdAt))
        .limit(1);

      if (stored) {
        console.log(`[BuildPlanLayer] Serving stored snapshot | id=${stored.id} | job=${stored.jobId} | status=${stored.status}`);
        return res.json({
          jobId: stored.jobId,
          status: stored.status,
          plan: stored.plan ? JSON.parse(stored.plan) : null,
          actionabilityScore: stored.actionabilityScore ?? 0,
          failedBlocks: stored.failedBlocks ? JSON.parse(stored.failedBlocks) : [],
          attempts: stored.attempts ?? 1,
          fromCache: true,
          cachedAt: stored.createdAt,
        });
      }

      // A GET must never synthesize an unpersisted result. The caller either
      // receives the exact run-bound snapshot or an explicit absence; silently
      // generating here made refreshes race and obscured persistence failures.
      return res.json({
        jobId: resolved.runId,
        status: "CURRENT_RUN_PLAN_NOT_PERSISTED",
        plan: null,
        actionabilityScore: 0,
        failedBlocks: [],
        attempts: 0,
      });
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
