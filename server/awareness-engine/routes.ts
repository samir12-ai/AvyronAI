import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  awarenessSnapshots,
  integritySnapshots,
  funnelSnapshots,
  offerSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  audienceSnapshots,
  miSnapshots,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runAwarenessEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as INTEGRITY_ENGINE_VERSION } from "../integrity-engine/constants";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

function safeNumber(v: any, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const parsed = Number(v);
  return isNaN(parsed) ? fallback : parsed;
}

export function registerAwarenessEngineRoutes(app: Express) {
  app.post("/api/awareness-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", integritySnapshotId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      if (!integritySnapshotId) {
        return res.status(400).json({ error: "integritySnapshotId is required" });
      }

      const [integritySnapshot] = await db.select().from(integritySnapshots)
        .where(and(
          eq(integritySnapshots.id, integritySnapshotId),
          eq(integritySnapshots.campaignId, campaignId),
          eq(integritySnapshots.accountId, accountId),
        ))
        .limit(1);

      if (!integritySnapshot) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Integrity snapshot not found or campaign mismatch",
        });
      }

      if (integritySnapshot.engineVersion !== INTEGRITY_ENGINE_VERSION) {
        return res.status(400).json({
          error: "VERSION_MISMATCH",
          message: `Integrity snapshot version ${integritySnapshot.engineVersion} does not match current version ${INTEGRITY_ENGINE_VERSION}`,
        });
      }

      const funnelSnapshotId = integritySnapshot.funnelSnapshotId;
      const offerSnapshotId = integritySnapshot.offerSnapshotId;
      const miSnapshotId = integritySnapshot.miSnapshotId;
      const audienceSnapshotId = integritySnapshot.audienceSnapshotId;
      const positioningSnapshotId = integritySnapshot.positioningSnapshotId;
      const differentiationSnapshotId = integritySnapshot.differentiationSnapshotId;

      const [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (!miSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "MI snapshot not found" });
      }

      const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
      if (!integrityResult.valid) {
        return res.status(400).json({
          error: "MI_INTEGRITY_FAILED",
          message: "MI snapshot integrity check failed",
          failures: integrityResult.failures,
        });
      }

      const [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);

      if (!audSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Audience snapshot not found" });
      }

      const [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);

      if (!posSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Positioning snapshot not found" });
      }

      const [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);

      if (!diffSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Differentiation snapshot not found" });
      }

      const [offerSnapshot] = await db.select().from(offerSnapshots)
        .where(and(eq(offerSnapshots.id, offerSnapshotId), eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId)))
        .limit(1);

      if (!offerSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Offer snapshot not found" });
      }

      const [funnelSnapshot] = await db.select().from(funnelSnapshots)
        .where(and(eq(funnelSnapshots.id, funnelSnapshotId), eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.accountId, accountId)))
        .limit(1);

      if (!funnelSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Funnel snapshot not found" });
      }

      const miInput = {
        marketDiagnosis: miSnapshot.marketDiagnosis,
        overallConfidence: safeNumber(miSnapshot.overallConfidence, 0),
        opportunitySignals: safeJsonParse(miSnapshot.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnapshot.threatSignals) || [],
      };

      const audienceInput = {
        objectionMap: safeJsonParse(audSnapshot.objectionMap) || {},
        emotionalDrivers: safeJsonParse(audSnapshot.emotionalDrivers) || [],
        maturityIndex: safeNumber(audSnapshot.maturityIndex, 0.5),
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
        confidenceScore: safeNumber(posSnapshot.confidenceScore, 0),
      };

      const differentiationInput = {
        pillars: safeJsonParse(diffSnapshot.differentiationPillars) || [],
        mechanismFraming: safeJsonParse(diffSnapshot.mechanismFraming),
        authorityMode: safeJsonParse(diffSnapshot.authorityMode)?.mode || null,
        claimStructures: safeJsonParse(diffSnapshot.claimStructures) || [],
        proofArchitecture: safeJsonParse(diffSnapshot.proofArchitecture) || [],
        confidenceScore: safeNumber(diffSnapshot.confidenceScore, 0),
      };

      const selectedOfferKey = offerSnapshot.selectedOption || "primary";
      const offerData = safeJsonParse(
        selectedOfferKey === "alternative" ? offerSnapshot.alternativeOffer : offerSnapshot.primaryOffer
      );

      const offerInput = {
        offerName: offerData?.offerName || "Primary Offer",
        coreOutcome: offerData?.coreOutcome || "",
        mechanismDescription: offerData?.mechanismDescription || "",
        deliverables: offerData?.deliverables || [],
        proofAlignment: offerData?.proofAlignment || [],
        offerStrengthScore: safeNumber(offerData?.offerStrengthScore, 0),
        riskNotes: offerData?.riskNotes || [],
        frictionLevel: safeNumber(offerData?.frictionLevel, 0),
      };

      const selectedFunnelKey = funnelSnapshot.selectedOption || "primary";
      const funnelData = safeJsonParse(
        selectedFunnelKey === "alternative" ? funnelSnapshot.alternativeFunnel : funnelSnapshot.primaryFunnel
      );

      const funnelInput = {
        funnelName: funnelData?.funnelName || "Primary Funnel",
        funnelType: funnelData?.funnelType || "webinar",
        stageMap: funnelData?.stageMap || [],
        trustPath: funnelData?.trustPath || [],
        proofPlacements: funnelData?.proofPlacements || [],
        commitmentLevel: funnelData?.commitmentLevel || "medium",
        frictionMap: funnelData?.frictionMap || [],
        entryTrigger: funnelData?.entryTrigger || { mechanismType: "none", purpose: "" },
        funnelStrengthScore: safeNumber(funnelData?.funnelStrengthScore, 0),
      };

      const integrityInput = {
        overallIntegrityScore: safeNumber(integritySnapshot.overallIntegrityScore, 0),
        safeToExecute: integritySnapshot.safeToExecute ?? false,
        layerResults: safeJsonParse(integritySnapshot.layerResults) || [],
        structuralWarnings: safeJsonParse(integritySnapshot.structuralWarnings) || [],
        flaggedInconsistencies: safeJsonParse(integritySnapshot.flaggedInconsistencies) || [],
      };

      const result = await runAwarenessEngine(miInput, audienceInput, positioningInput, differentiationInput, offerInput, funnelInput, integrityInput, accountId);

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[AwarenessEngine] HARD-FAIL: Boundary violation — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Awareness output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const [saved] = await db.insert(awarenessSnapshots).values({
        accountId,
        campaignId,
        integritySnapshotId,
        funnelSnapshotId,
        offerSnapshotId,
        miSnapshotId,
        audienceSnapshotId,
        positioningSnapshotId,
        differentiationSnapshotId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryRoute: JSON.stringify(result.primaryRoute),
        alternativeRoute: JSON.stringify(result.alternativeRoute),
        rejectedRoute: JSON.stringify(result.rejectedRoute),
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        awarenessStrengthScore: result.primaryRoute.awarenessStrengthScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[AwarenessEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Awareness analysis failed" });
    }
  });

  app.get("/api/awareness-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(awarenessSnapshots)
        .where(and(
          eq(awarenessSnapshots.campaignId, campaignId),
          eq(awarenessSnapshots.accountId, accountId),
          eq(awarenessSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(awarenessSnapshots.createdAt))
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
        primaryRoute: safeJsonParse(latest.primaryRoute),
        alternativeRoute: safeJsonParse(latest.alternativeRoute),
        rejectedRoute: safeJsonParse(latest.rejectedRoute),
        layerResults: safeJsonParse(latest.layerResults),
        structuralWarnings: safeJsonParse(latest.structuralWarnings),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        awarenessStrengthScore: latest.awarenessStrengthScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        integritySnapshotId: latest.integritySnapshotId,
        funnelSnapshotId: latest.funnelSnapshotId,
        offerSnapshotId: latest.offerSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
      });
    } catch (error: any) {
      console.error("[AwarenessEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch awareness snapshot" });
    }
  });

  console.log("[AwarenessEngine-V3] Routes registered: POST /api/awareness-engine/analyze, GET /api/awareness-engine/latest");
}
