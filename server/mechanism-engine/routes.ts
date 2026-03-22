import type { Express, Request, Response } from "express";
import { db } from "../db";
import { mechanismSnapshots, differentiationSnapshots, positioningSnapshots, audienceSnapshots } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { runMechanismEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";
import { parseLineageFromSnapshot, mergeLineageArrays, findBestParentSignal, createDerivedLineageEntry, type SignalLineageEntry } from "../shared/signal-lineage";
import { buildStrategyRoot } from "../shared/strategy-root";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerMechanismEngineRoutes(app: Express) {
  app.post("/api/mechanism-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, differentiationSnapshotId, validationSessionId } = req.body;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "mechanism-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!differentiationSnapshotId) {
        return res.status(400).json({ error: "differentiationSnapshotId is required" });
      }

      let [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);

      if (!diffSnapshot) {
        console.warn(`[MechanismEngine] Requested differentiationSnapshotId=${differentiationSnapshotId} not found — falling back to latest for campaign=${campaignId}`);
        const [fallback] = await db.select().from(differentiationSnapshots)
          .where(and(
            eq(differentiationSnapshots.campaignId, campaignId),
            eq(differentiationSnapshots.accountId, accountId),
            inArray(differentiationSnapshots.status, ["COMPLETE", "LOW_CONFIDENCE"]),
          ))
          .orderBy(desc(differentiationSnapshots.createdAt))
          .limit(1);
        if (!fallback) {
          return res.status(400).json({
            error: "MISSING_DEPENDENCY",
            message: "Differentiation snapshot not found or campaign mismatch",
          });
        }
        diffSnapshot = fallback;
      }

      let activeDiffSnapshot = diffSnapshot;
      if (activeDiffSnapshot.engineVersion !== DIFF_ENGINE_VERSION) {
        const [latestDiff] = await db.select().from(differentiationSnapshots)
          .where(and(
            eq(differentiationSnapshots.campaignId, campaignId),
            eq(differentiationSnapshots.accountId, accountId),
            inArray(differentiationSnapshots.status, ["COMPLETE", "LOW_CONFIDENCE"]),
            eq(differentiationSnapshots.engineVersion, DIFF_ENGINE_VERSION),
          ))
          .orderBy(desc(differentiationSnapshots.createdAt))
          .limit(1);
        if (latestDiff) {
          activeDiffSnapshot = latestDiff;
        } else {
          return res.status(400).json({
            error: "VERSION_MISMATCH",
            message: `Differentiation snapshot version mismatch — please re-run Differentiation Engine first`,
          });
        }
      }

      const positioningSnapshotId = activeDiffSnapshot.positioningSnapshotId;
      const [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);

      if (!posSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Positioning snapshot not found" });
      }

      const positioningInput = {
        contrastAxis: posSnapshot.contrastAxis,
        enemyDefinition: posSnapshot.enemyDefinition,
        narrativeDirection: posSnapshot.narrativeDirection,
        differentiationVector: safeJsonParse(posSnapshot.differentiationVector) || [],
        territories: safeJsonParse(posSnapshot.territories) || [],
      };

      const differentiationInput = {
        pillars: safeJsonParse(activeDiffSnapshot.differentiationPillars) || [],
        mechanismFraming: safeJsonParse(activeDiffSnapshot.mechanismFraming),
        mechanismCore: safeJsonParse((activeDiffSnapshot as any).mechanismCore) || null,
        authorityMode: safeJsonParse(activeDiffSnapshot.authorityMode)?.mode || null,
        claimStructures: safeJsonParse(activeDiffSnapshot.claimStructures) || [],
        proofArchitecture: safeJsonParse(activeDiffSnapshot.proofArchitecture) || [],
      };

      console.log(`[MechanismEngine] Analyzing for campaign=${campaignId} | diffSnapshot=${activeDiffSnapshot.id} | posSnapshot=${posSnapshot.id}`);

      const result = await runMechanismEngine(positioningInput, differentiationInput, accountId);

      const [saved] = await db.insert(mechanismSnapshots).values({
        accountId,
        campaignId,
        positioningSnapshotId,
        differentiationSnapshotId: activeDiffSnapshot.id,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryMechanism: JSON.stringify(result.primaryMechanism),
        alternativeMechanism: result.alternativeMechanism ? JSON.stringify(result.alternativeMechanism) : null,
        axisConsistency: JSON.stringify(result.axisConsistency),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, mechanismSnapshots, campaignId, 20, accountId);

      console.log(`[MechanismEngine] SAVED | snapshotId=${saved.id} | status=${result.status} | confidence=${result.confidenceScore.toFixed(2)}`);

      let strategyRootResult: any = null;
      if (result.status === "COMPLETE" || result.status === "LOW_CONFIDENCE") {
        try {
          const miSnapshotId = activeDiffSnapshot.miSnapshotId;
          const audienceSnapshotId = activeDiffSnapshot.audienceSnapshotId;

          let audiencePains: any[] = [];
          let audienceDesires: any = {};
          let audienceTransformation: string | null = null;
          let audienceObjections: any = {};
          if (audienceSnapshotId) {
            const [audSnap] = await db.select().from(audienceSnapshots)
              .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId)))
              .limit(1);
            if (audSnap) {
              audiencePains = safeJsonParse(audSnap.audiencePains) || [];
              audienceDesires = safeJsonParse(audSnap.desireMap) || {};
              audienceObjections = safeJsonParse(audSnap.objectionMap) || {};
              const segments = safeJsonParse(audSnap.audienceSegments) || [];
              audienceTransformation = segments[0]?.transformation || null;
            }
          }

          const diffProofArchitecture = safeJsonParse(activeDiffSnapshot.proofArchitecture) || [];
          const proofTypes = diffProofArchitecture.map((p: any) => typeof p === "string" ? p : p?.type || p?.name || String(p));

          const positioningContext = {
            territories: safeJsonParse(posSnapshot.territories) || [],
            enemyDefinition: posSnapshot.enemyDefinition || null,
            contrastAxis: posSnapshot.contrastAxis || null,
            narrativeDirection: posSnapshot.narrativeDirection || null,
          };

          const primaryMech = result.primaryMechanism;
          const mechClaim = primaryMech?.mechanismPromise || null;

          strategyRootResult = await buildStrategyRoot({
            campaignId,
            accountId,
            miSnapshotId: miSnapshotId || "",
            audienceSnapshotId: audienceSnapshotId || "",
            positioningSnapshotId,
            differentiationSnapshotId: activeDiffSnapshot.id,
            mechanismSnapshotId: saved.id,
            primaryAxis: primaryMech?.axisAlignment?.primaryAxis || posSnapshot.contrastAxis || null,
            contrastAxisText: posSnapshot.contrastAxis || null,
            approvedMechanism: primaryMech || null,
            approvedAudiencePains: audiencePains,
            approvedDesires: audienceDesires,
            approvedTransformation: audienceTransformation,
            approvedClaim: mechClaim,
            approvedPromise: primaryMech?.mechanismPromise || null,
            approvedObjections: audienceObjections,
            approvedProofTypes: proofTypes,
            approvedPositioningContext: positioningContext,
          });

          console.log(`[MechanismEngine] STRATEGY_ROOT | id=${strategyRootResult.id} | hash=${strategyRootResult.rootHash} | isNew=${strategyRootResult.isNew}`);
        } catch (rootErr: any) {
          console.error(`[MechanismEngine] Strategy root creation failed (non-blocking): ${rootErr.message}`);
        }
      }

      res.json({
        success: true,
        snapshotId: saved.id,
        strategyRoot: strategyRootResult,
        ...result,
      });
    } catch (error: any) {
      console.error("[MechanismEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Mechanism analysis failed" });
    }
  });

  app.get("/api/mechanism-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(mechanismSnapshots)
        .where(and(
          eq(mechanismSnapshots.campaignId, campaignId),
          eq(mechanismSnapshots.accountId, accountId),
          eq(mechanismSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(mechanismSnapshots.createdAt))
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
        primaryMechanism: safeJsonParse(latest.primaryMechanism),
        alternativeMechanism: safeJsonParse(latest.alternativeMechanism),
        axisConsistency: safeJsonParse(latest.axisConsistency),
        confidenceScore: latest.confidenceScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        positioningSnapshotId: latest.positioningSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
      });
    } catch (error: any) {
      console.error("[MechanismEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch mechanism snapshot" });
    }
  });
}
