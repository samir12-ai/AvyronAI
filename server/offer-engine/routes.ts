import type { Express, Request, Response } from "express";
import { db } from "../db";
import { offerSnapshots, differentiationSnapshots, miSnapshots, audienceSnapshots, positioningSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runOfferEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { getEngineReadinessState, verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerOfferEngineRoutes(app: Express) {
  app.post("/api/offer-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", differentiationSnapshotId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      if (!differentiationSnapshotId) {
        return res.status(400).json({ error: "differentiationSnapshotId is required" });
      }

      const [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);

      if (!diffSnapshot) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Differentiation snapshot not found or campaign mismatch",
        });
      }

      if (diffSnapshot.engineVersion !== DIFF_ENGINE_VERSION) {
        return res.status(400).json({
          error: "VERSION_MISMATCH",
          message: `Differentiation snapshot version ${diffSnapshot.engineVersion} does not match current version ${DIFF_ENGINE_VERSION}`,
        });
      }

      const miSnapshotId = diffSnapshot.miSnapshotId;
      const audienceSnapshotId = diffSnapshot.audienceSnapshotId;
      const positioningSnapshotId = diffSnapshot.positioningSnapshotId;

      const [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (!miSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "MI snapshot not found or campaign/account mismatch" });
      }

      const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
      if (!integrityResult.valid) {
        return res.status(400).json({
          error: "MI_INTEGRITY_FAILED",
          message: "MI snapshot integrity check failed",
          failures: integrityResult.failures,
        });
      }

      const miReadiness = getEngineReadinessState(miSnapshot, campaignId, MI_ENGINE_VERSION, 14);
      if (miReadiness.state !== "READY") {
        return res.status(400).json({
          error: "MI_NOT_READY",
          message: `MI not ready: ${miReadiness.state}`,
          diagnostics: miReadiness.diagnostics,
        });
      }

      const [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);

      if (!audSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Audience snapshot not found or campaign/account mismatch" });
      }

      const [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);

      if (!posSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Positioning snapshot not found or campaign/account mismatch" });
      }

      const miInput = {
        dominanceData: safeJsonParse(miSnapshot.dominanceData),
        contentDnaData: safeJsonParse(miSnapshot.contentDnaData),
        marketDiagnosis: miSnapshot.marketDiagnosis,
        opportunitySignals: safeJsonParse(miSnapshot.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnapshot.threatSignals) || [],
      };

      const audienceInput = {
        objectionMap: safeJsonParse(audSnapshot.objectionMap) || {},
        emotionalDrivers: safeJsonParse(audSnapshot.emotionalDrivers) || [],
        maturityIndex: audSnapshot.maturityIndex,
        awarenessLevel: audSnapshot.awarenessLevel,
        audiencePains: safeJsonParse(audSnapshot.audiencePains) || [],
        desireMap: safeJsonParse(audSnapshot.desireMap) || {},
        audienceSegments: safeJsonParse(audSnapshot.audienceSegments) || [],
      };

      const positioningInput = {
        territories: safeJsonParse(posSnapshot.territories) || [],
        enemyDefinition: posSnapshot.enemyDefinition,
        contrastAxis: posSnapshot.contrastAxis,
        narrativeDirection: posSnapshot.narrativeDirection,
      };

      const differentiationInput = {
        pillars: safeJsonParse(diffSnapshot.differentiationPillars) || [],
        mechanismFraming: safeJsonParse(diffSnapshot.mechanismFraming),
        authorityMode: safeJsonParse(diffSnapshot.authorityMode)?.mode || null,
        claimStructures: safeJsonParse(diffSnapshot.claimStructures) || [],
        proofArchitecture: safeJsonParse(diffSnapshot.proofArchitecture) || [],
        confidenceScore: diffSnapshot.confidenceScore,
      };

      const result = await runOfferEngine(miInput, audienceInput, positioningInput, differentiationInput, accountId);

      const [saved] = await db.insert(offerSnapshots).values({
        accountId,
        campaignId,
        miSnapshotId,
        audienceSnapshotId,
        positioningSnapshotId,
        differentiationSnapshotId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryOffer: JSON.stringify(result.primaryOffer),
        alternativeOffer: JSON.stringify(result.alternativeOffer),
        rejectedOffer: JSON.stringify(result.rejectedOffer),
        offerStrengthScore: result.offerStrengthScore,
        positioningConsistency: JSON.stringify(result.positioningConsistency),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[OfferEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Offer analysis failed" });
    }
  });

  app.get("/api/offer-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(offerSnapshots)
        .where(and(
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
          eq(offerSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(offerSnapshots.createdAt))
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
        primaryOffer: safeJsonParse(latest.primaryOffer),
        alternativeOffer: safeJsonParse(latest.alternativeOffer),
        rejectedOffer: safeJsonParse(latest.rejectedOffer),
        offerStrengthScore: latest.offerStrengthScore,
        positioningConsistency: safeJsonParse(latest.positioningConsistency),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        confidenceScore: latest.confidenceScore,
        selectedOption: latest.selectedOption,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        differentiationSnapshotId: latest.differentiationSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
      });
    } catch (error: any) {
      console.error("[OfferEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch offer snapshot" });
    }
  });
}
