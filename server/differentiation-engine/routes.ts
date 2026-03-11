import type { Express, Request, Response } from "express";
import { db } from "../db";
import { differentiationSnapshots, miSnapshots, audienceSnapshots, positioningSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runDifferentiationEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { getEngineReadinessState, verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerDifferentiationRoutes(app: Express) {
  app.post("/api/differentiation-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", positioningSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "differentiation-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!positioningSnapshotId) {
        return res.status(400).json({ error: "positioningSnapshotId is required" });
      }

      const [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId)))
        .limit(1);

      if (!posSnapshot) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Positioning snapshot not found or campaign mismatch",
        });
      }

      let miSnapshotId = posSnapshot.miSnapshotId;
      const audienceSnapshotId = posSnapshot.audienceSnapshotId;

      let [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId)))
        .limit(1);

      if (miSnapshot) {
        const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
        const miReadiness = integrityResult.valid
          ? getEngineReadinessState(miSnapshot, campaignId, MI_ENGINE_VERSION, 14)
          : null;

        if (!integrityResult.valid || (miReadiness && miReadiness.state !== "READY")) {
          console.log(`[DifferentiationEngine] MI snapshot ${miSnapshotId} failed integrity/readiness check, searching for latest valid MI snapshot`);
          const [latestMI] = await db.select().from(miSnapshots)
            .where(and(
              eq(miSnapshots.campaignId, campaignId),
              eq(miSnapshots.status, "COMPLETE"),
              eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION),
            ))
            .orderBy(desc(miSnapshots.createdAt))
            .limit(1);
          if (latestMI) {
            console.log(`[DifferentiationEngine] Using latest valid MI snapshot ${latestMI.id} (v${latestMI.analysisVersion})`);
            miSnapshot = latestMI;
            miSnapshotId = latestMI.id;
          } else {
            return res.status(400).json({
              error: "MI_INTEGRITY_FAILED",
              message: `MI snapshot integrity/readiness check failed and no valid MI snapshot found — please re-run Market Intelligence first`,
              failures: integrityResult.failures,
            });
          }
        }
      } else {
        const [latestMI] = await db.select().from(miSnapshots)
          .where(and(
            eq(miSnapshots.campaignId, campaignId),
            eq(miSnapshots.status, "COMPLETE"),
            eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION),
          ))
          .orderBy(desc(miSnapshots.createdAt))
          .limit(1);
        if (latestMI) {
          console.log(`[DifferentiationEngine] MI snapshot ${miSnapshotId} not found, using latest valid MI snapshot ${latestMI.id}`);
          miSnapshot = latestMI;
          miSnapshotId = latestMI.id;
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "MI snapshot not found and no valid MI snapshot available" });
        }
      }

      const [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId)))
        .limit(1);

      if (!audSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Audience snapshot not found or campaign mismatch" });
      }

      const miInput = {
        dominanceData: safeJsonParse(miSnapshot.dominanceData),
        contentDnaData: safeJsonParse(miSnapshot.contentDnaData),
        marketDiagnosis: miSnapshot.marketDiagnosis,
        opportunitySignals: safeJsonParse(miSnapshot.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnapshot.threatSignals) || [],
        narrativeSynthesis: miSnapshot.narrativeSynthesis,
      };

      const audienceInput = {
        objectionMap: safeJsonParse(audSnapshot.objectionMap) || {},
        emotionalDrivers: safeJsonParse(audSnapshot.emotionalDrivers) || [],
        maturityIndex: audSnapshot.maturityIndex,
        awarenessLevel: audSnapshot.awarenessLevel,
        audiencePains: safeJsonParse(audSnapshot.audiencePains) || [],
        desireMap: safeJsonParse(audSnapshot.desireMap) || {},
        audienceSegments: safeJsonParse(audSnapshot.audienceSegments) || [],
        intentDistribution: safeJsonParse(audSnapshot.intentDistribution),
      };

      const parsedStability = safeJsonParse(posSnapshot.stabilityResult);
      const parsedTerritories = safeJsonParse(posSnapshot.territories) || [];
      const flankingMode = parsedTerritories.some((t: any) => t.flankingMode === true) ||
        (parsedStability?.flankingDetected === true) || false;

      const positioningInput = {
        territories: parsedTerritories,
        differentiationVector: safeJsonParse(posSnapshot.differentiationVector),
        enemyDefinition: posSnapshot.enemyDefinition,
        contrastAxis: posSnapshot.contrastAxis,
        narrativeDirection: posSnapshot.narrativeDirection,
        flankingMode,
        stabilityResult: parsedStability,
        strategyCards: safeJsonParse(posSnapshot.strategyCards) || [],
      };

      const result = await runDifferentiationEngine(miInput, audienceInput, positioningInput, accountId);

      if (result.status === "INTEGRITY_FAILED") {
        return res.status(400).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage,
          ...result,
          confidenceScore: 0,
        });
      }

      const [saved] = await db.insert(differentiationSnapshots).values({
        accountId,
        campaignId,
        miSnapshotId,
        audienceSnapshotId,
        positioningSnapshotId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        differentiationPillars: JSON.stringify(result.pillars),
        proofArchitecture: JSON.stringify(result.proofArchitecture),
        claimStructures: JSON.stringify(result.claimStructures),
        authorityMode: JSON.stringify({ mode: result.authorityMode, rationale: result.authorityRationale }),
        mechanismFraming: JSON.stringify(result.mechanismFraming),
        mechanismCore: JSON.stringify(result.mechanismCore),
        trustPriorityMap: JSON.stringify(result.trustPriorityMap),
        claimScores: JSON.stringify(result.claimScores),
        collisionDiagnostics: JSON.stringify(result.collisionDiagnostics),
        stabilityResult: JSON.stringify(result.stabilityResult),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, differentiationSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[DifferentiationEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Differentiation analysis failed" });
    }
  });

  app.get("/api/differentiation-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(differentiationSnapshots)
        .where(and(
          eq(differentiationSnapshots.campaignId, campaignId),
          eq(differentiationSnapshots.accountId, accountId),
          eq(differentiationSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(differentiationSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return res.json({ exists: false });
      }

      res.json({
        exists: true,
        id: latest.id,
        campaignId: latest.campaignId,
        status: latest.status,
        statusMessage: latest.statusMessage,
        engineVersion: latest.engineVersion,
        differentiationPillars: safeJsonParse(latest.differentiationPillars) || [],
        proofArchitecture: safeJsonParse(latest.proofArchitecture) || [],
        claimStructures: safeJsonParse(latest.claimStructures) || [],
        authorityMode: safeJsonParse(latest.authorityMode),
        mechanismFraming: safeJsonParse(latest.mechanismFraming),
        mechanismCore: safeJsonParse(latest.mechanismCore) || { mechanismName: "", mechanismType: "none", mechanismSteps: [], mechanismPromise: "", mechanismProblem: "", mechanismLogic: "" },
        trustPriorityMap: safeJsonParse(latest.trustPriorityMap) || [],
        claimScores: safeJsonParse(latest.claimScores),
        collisionDiagnostics: safeJsonParse(latest.collisionDiagnostics) || [],
        stabilityResult: safeJsonParse(latest.stabilityResult),
        confidenceScore: latest.confidenceScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
      });
    } catch (error: any) {
      console.error("[DifferentiationEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch differentiation snapshot" });
    }
  });
}
