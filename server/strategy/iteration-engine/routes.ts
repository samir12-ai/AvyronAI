import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { iterationSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runIterationEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { pruneOldSnapshots, checkValidationSession } from "../../engine-hardening";
import { validateEngineDependencies, logDependencyCheck } from "../dependency-validation";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerIterationEngineRoutes(app: Express) {
  app.post("/api/strategy/iteration-engine/analyze", async (req: Request, res: Response) => {
    try {
      const {
        campaignId,
        accountId = "default",
        validationSessionId,
        performance = null,
        funnel = null,
        creative = null,
        persuasion = null,
      } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const depCheck = validateEngineDependencies("iteration-engine");
      logDependencyCheck("iteration-engine", depCheck);
      if (!depCheck.valid) {
        return res.status(503).json({
          error: "ENGINE_DEPENDENCY_MISMATCH",
          message: `Iteration Engine cannot execute: ${depCheck.mismatches.join("; ")}`,
          mismatches: depCheck.mismatches,
        });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "iteration-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      const result = await runIterationEngine(performance, funnel, creative, persuasion);

      const [saved] = await db.insert(iterationSnapshots).values({
        accountId,
        campaignId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        result: JSON.stringify({
          nextTestHypotheses: result.nextTestHypotheses,
          optimizationTargets: result.optimizationTargets,
          failedStrategyFlags: result.failedStrategyFlags,
          iterationPlan: result.iterationPlan,
        }),
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.dataReliability),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, iterationSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[IterationEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Iteration analysis failed" });
    }
  });

  app.get("/api/strategy/iteration-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(iterationSnapshots)
        .where(and(
          eq(iterationSnapshots.campaignId, campaignId),
          eq(iterationSnapshots.accountId, accountId),
          eq(iterationSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(iterationSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return res.json({ exists: false });
      }

      const resultData = safeJsonParse(latest.result) || {};

      res.json({
        exists: true,
        id: latest.id,
        campaignId: latest.campaignId,
        status: latest.status,
        statusMessage: latest.statusMessage,
        engineVersion: latest.engineVersion,
        nextTestHypotheses: resultData.nextTestHypotheses || [],
        optimizationTargets: resultData.optimizationTargets || [],
        failedStrategyFlags: resultData.failedStrategyFlags || [],
        iterationPlan: resultData.iterationPlan || [],
        layerResults: safeJsonParse(latest.layerResults) || [],
        structuralWarnings: safeJsonParse(latest.structuralWarnings) || [],
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        dataReliability: safeJsonParse(latest.dataReliability),
        confidenceScore: latest.confidenceScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
      });
    } catch (error: any) {
      console.error("[IterationEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch iteration snapshot" });
    }
  });
}
