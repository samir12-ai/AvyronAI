import type { Express, Request, Response } from "express";
import { db } from "../../db";
import {
  strategyValidationSnapshots,
  persuasionSnapshots,
  awarenessSnapshots,
  integritySnapshots,
  funnelSnapshots,
  offerSnapshots,
  audienceSnapshots,
  miSnapshots,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runStatisticalValidationEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as PERSUASION_ENGINE_VERSION } from "../../persuasion-engine/constants";
import { pruneOldSnapshots, checkValidationSession } from "../../engine-hardening";

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

export function registerStatisticalValidationRoutes(app: Express) {
  app.post("/api/strategy/statistical-validation/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", persuasionSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "statistical-validation", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      let persuasionSnapshot: any;

      if (persuasionSnapshotId) {
        const [snap] = await db.select().from(persuasionSnapshots)
          .where(and(
            eq(persuasionSnapshots.id, persuasionSnapshotId),
            eq(persuasionSnapshots.campaignId, campaignId),
            eq(persuasionSnapshots.accountId, accountId),
          ))
          .limit(1);

        if (snap && snap.engineVersion === PERSUASION_ENGINE_VERSION) {
          persuasionSnapshot = snap;
        } else if (snap) {
          console.log(`[StatisticalValidation] Persuasion snapshot ${persuasionSnapshotId} version mismatch (v${snap.engineVersion} vs v${PERSUASION_ENGINE_VERSION}), searching for latest valid`);
        }
      }

      if (!persuasionSnapshot) {
        const [latest] = await db.select().from(persuasionSnapshots)
          .where(and(
            eq(persuasionSnapshots.campaignId, campaignId),
            eq(persuasionSnapshots.accountId, accountId),
            eq(persuasionSnapshots.status, "COMPLETE"),
            eq(persuasionSnapshots.engineVersion, PERSUASION_ENGINE_VERSION),
          ))
          .orderBy(desc(persuasionSnapshots.createdAt))
          .limit(1);

        if (!latest) {
          return res.status(400).json({
            error: "MISSING_DEPENDENCY",
            message: "No valid Persuasion snapshot found — please run Persuasion Engine first",
          });
        }
        persuasionSnapshot = latest;
      }

      const awarenessSnapshotId = persuasionSnapshot.awarenessSnapshotId;
      const offerSnapshotId = persuasionSnapshot.offerSnapshotId;
      const funnelSnapshotId = persuasionSnapshot.funnelSnapshotId;
      const miSnapshotId = persuasionSnapshot.miSnapshotId;
      const audienceSnapshotId = persuasionSnapshot.audienceSnapshotId;

      const [awarenessSnap] = await db.select().from(awarenessSnapshots)
        .where(and(eq(awarenessSnapshots.id, awarenessSnapshotId), eq(awarenessSnapshots.campaignId, campaignId), eq(awarenessSnapshots.accountId, accountId)))
        .limit(1);

      const [offerSnap] = await db.select().from(offerSnapshots)
        .where(and(eq(offerSnapshots.id, offerSnapshotId), eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId)))
        .limit(1);

      const [funnelSnap] = await db.select().from(funnelSnapshots)
        .where(and(eq(funnelSnapshots.id, funnelSnapshotId), eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.accountId, accountId)))
        .limit(1);

      const [miSnap] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      const [audSnap] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);

      if (!awarenessSnap || !offerSnap || !funnelSnap || !miSnap || !audSnap) {
        const missing: string[] = [];
        if (!awarenessSnap) missing.push("Awareness");
        if (!offerSnap) missing.push("Offer");
        if (!funnelSnap) missing.push("Funnel");
        if (!miSnap) missing.push("MI");
        if (!audSnap) missing.push("Audience");
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: `Missing upstream snapshots: ${missing.join(", ")} — please run these engines first`,
        });
      }

      const primaryRoute = safeJsonParse(persuasionSnapshot.primaryRoute) || {};

      const narrativeObjMap = safeJsonParse(miSnap.objectionMapData) || null;
      const narrativeObjections = (narrativeObjMap?.objections || []).map((item: any) => ({
        objection: item.objection || "",
        frequencyScore: safeNumber(item.frequencyScore, 0),
        narrativeConfidence: safeNumber(item.narrativeConfidence, 0),
        patternCategory: item.patternCategory || "unknown",
        signalType: item.signalType || "objection",
      }));

      const miInput = {
        marketDiagnosis: miSnap.marketDiagnosis || null,
        overallConfidence: safeNumber(miSnap.overallConfidence, 0),
        opportunitySignals: safeJsonParse(miSnap.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnap.threatSignals) || [],
        narrativeObjectionCount: narrativeObjMap?.totalObjectionsDetected ?? 0,
        narrativeObjections,
      };

      const audienceInput = {
        objectionMap: safeJsonParse(audSnap.objectionMap) || {},
        emotionalDrivers: safeJsonParse(audSnap.emotionalDrivers) || [],
        maturityIndex: safeNumber(audSnap.maturityIndex, 0.5),
        awarenessLevel: audSnap.awarenessLevel || null,
        audiencePains: safeJsonParse(audSnap.audiencePains) || [],
        desireMap: safeJsonParse(audSnap.desireMap) || {},
        audienceSegments: safeJsonParse(audSnap.audienceSegments) || [],
      };

      const selectedOfferKey = (offerSnap as any).selectedOption || "primary";
      const offerData = safeJsonParse(
        selectedOfferKey === "alternative" ? (offerSnap as any).alternativeOffer : (offerSnap as any).primaryOffer
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

      const selectedFunnelKey = (funnelSnap as any).selectedOption || "primary";
      const funnelData = safeJsonParse(
        selectedFunnelKey === "alternative" ? (funnelSnap as any).alternativeFunnel : (funnelSnap as any).primaryFunnel
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

      const awarenessRoute = safeJsonParse(awarenessSnap.primaryRoute) || {};
      const awarenessInput = {
        entryMechanismType: awarenessRoute.entryMechanismType || "",
        targetReadinessStage: awarenessRoute.targetReadinessStage || "",
        triggerClass: awarenessRoute.triggerClass || "",
        trustRequirement: awarenessRoute.trustRequirement || "medium",
        funnelCompatibility: awarenessRoute.funnelCompatibility || "",
        awarenessStrengthScore: safeNumber(awarenessRoute.awarenessStrengthScore || awarenessSnap.awarenessStrengthScore, 0),
        frictionNotes: awarenessRoute.frictionNotes || [],
      };

      const persuasionInput = {
        persuasionMode: primaryRoute.persuasionMode || "",
        primaryInfluenceDrivers: primaryRoute.primaryInfluenceDrivers || [],
        objectionPriorities: primaryRoute.objectionPriorities || [],
        trustSequence: primaryRoute.trustSequence || [],
        persuasionStrengthScore: safeNumber(primaryRoute.persuasionStrengthScore || persuasionSnapshot.persuasionStrengthScore, 0),
        frictionNotes: primaryRoute.frictionNotes || [],
        trustBarriers: primaryRoute.trustBarriers || [],
        objectionProofLinks: primaryRoute.objectionProofLinks || [],
        structuredObjections: primaryRoute.structuredObjections || [],
      };

      const result = await runStatisticalValidationEngine(
        miInput, audienceInput, offerInput, funnelInput, awarenessInput, persuasionInput, accountId,
      );

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[StatisticalValidation] HARD-FAIL: Boundary violation — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Statistical validation output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const [saved] = await db.insert(strategyValidationSnapshots).values({
        accountId,
        campaignId,
        persuasionSnapshotId: persuasionSnapshot.id,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        result: JSON.stringify({
          claimConfidenceScore: result.claimConfidenceScore,
          evidenceStrength: result.evidenceStrength,
          validationState: result.validationState,
          assumptionFlags: result.assumptionFlags,
          claimValidations: result.claimValidations,
          strategyAcceptability: result.strategyAcceptability,
        }),
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.dataReliability),
        confidenceScore: result.claimConfidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, strategyValidationSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[StatisticalValidation] Analysis error:", error.message);
      res.status(500).json({ error: "Statistical validation analysis failed" });
    }
  });

  app.get("/api/strategy/statistical-validation/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(strategyValidationSnapshots)
        .where(and(
          eq(strategyValidationSnapshots.campaignId, campaignId),
          eq(strategyValidationSnapshots.accountId, accountId),
          eq(strategyValidationSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(strategyValidationSnapshots.createdAt))
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
        result: safeJsonParse(latest.result),
        layerResults: safeJsonParse(latest.layerResults),
        structuralWarnings: safeJsonParse(latest.structuralWarnings),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        dataReliability: safeJsonParse(latest.dataReliability),
        confidenceScore: latest.confidenceScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        persuasionSnapshotId: latest.persuasionSnapshotId,
      });
    } catch (error: any) {
      console.error("[StatisticalValidation] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch statistical validation snapshot" });
    }
  });

  console.log("[StatisticalValidation-V3] Routes registered: POST /api/strategy/statistical-validation/analyze, GET /api/strategy/statistical-validation/latest");
}
