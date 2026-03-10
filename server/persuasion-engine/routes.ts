import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  persuasionSnapshots,
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
import { runPersuasionEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as AWARENESS_ENGINE_VERSION } from "../awareness-engine/constants";
import { ENGINE_VERSION as INTEGRITY_ENGINE_VERSION } from "../integrity-engine/constants";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { ENGINE_VERSION as FUNNEL_ENGINE_VERSION } from "../funnel-engine/constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../offer-engine/constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { POSITIONING_ENGINE_VERSION } from "../positioning-engine/constants";
import { AUDIENCE_ENGINE_VERSION } from "../audience-engine/constants";
import { verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";

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

async function resolveSnapshot(table: any, idField: any, id: string, campaignId: string, accountId: string, versionField: any, expectedVersion: number, engineLabel: string) {
  let [snapshot] = await db.select().from(table)
    .where(and(eq(idField, id), eq(table.campaignId, campaignId), eq(table.accountId, accountId)))
    .limit(1);

  if (snapshot && snapshot[versionField.name] !== expectedVersion) {
    console.log(`[PersuasionEngine-V3] ${engineLabel} snapshot ${id} version mismatch (v${snapshot[versionField.name]} vs v${expectedVersion}), searching for latest valid`);
    const [latest] = await db.select().from(table)
      .where(and(
        eq(table.campaignId, campaignId),
        eq(table.accountId, accountId),
        eq(versionField, expectedVersion),
      ))
      .orderBy(desc(table.createdAt))
      .limit(1);
    if (latest) {
      console.log(`[PersuasionEngine-V3] Using latest valid ${engineLabel} snapshot ${latest.id}`);
      snapshot = latest;
    } else {
      return { snapshot: null, error: `${engineLabel} snapshot version ${snapshot[versionField.name]} does not match current version ${expectedVersion} — please re-run ${engineLabel}` };
    }
  }

  if (!snapshot) {
    const [latest] = await db.select().from(table)
      .where(and(
        eq(table.campaignId, campaignId),
        eq(table.accountId, accountId),
        eq(versionField, expectedVersion),
      ))
      .orderBy(desc(table.createdAt))
      .limit(1);
    if (latest) {
      snapshot = latest;
    } else {
      return { snapshot: null, error: `No valid ${engineLabel} snapshot found — please run ${engineLabel} first` };
    }
  }

  return { snapshot, error: null };
}

export function registerPersuasionEngineRoutes(app: Express) {
  app.post("/api/persuasion-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", awarenessSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "persuasion-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!awarenessSnapshotId) {
        return res.status(400).json({ error: "awarenessSnapshotId is required" });
      }

      let [awarenessSnapshot] = await db.select().from(awarenessSnapshots)
        .where(and(
          eq(awarenessSnapshots.id, awarenessSnapshotId),
          eq(awarenessSnapshots.campaignId, campaignId),
          eq(awarenessSnapshots.accountId, accountId),
        ))
        .limit(1);

      if (!awarenessSnapshot) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Awareness snapshot not found or campaign mismatch",
        });
      }

      if (awarenessSnapshot.engineVersion !== AWARENESS_ENGINE_VERSION) {
        console.log(`[PersuasionEngine-V3] Awareness snapshot ${awarenessSnapshotId} version mismatch (v${awarenessSnapshot.engineVersion} vs v${AWARENESS_ENGINE_VERSION}), searching for latest valid`);
        const [latestAwareness] = await db.select().from(awarenessSnapshots)
          .where(and(
            eq(awarenessSnapshots.campaignId, campaignId),
            eq(awarenessSnapshots.accountId, accountId),
            eq(awarenessSnapshots.status, "COMPLETE"),
            eq(awarenessSnapshots.engineVersion, AWARENESS_ENGINE_VERSION),
          ))
          .orderBy(desc(awarenessSnapshots.createdAt))
          .limit(1);
        if (!latestAwareness) {
          return res.status(400).json({
            error: "VERSION_MISMATCH",
            message: `Awareness snapshot version ${awarenessSnapshot.engineVersion} does not match current version ${AWARENESS_ENGINE_VERSION} — please re-run Awareness Engine`,
          });
        }
        console.log(`[PersuasionEngine-V3] Using latest valid Awareness snapshot ${latestAwareness.id}`);
        awarenessSnapshot = latestAwareness;
      }

      const integritySnapshotId = awarenessSnapshot.integritySnapshotId;
      const funnelSnapshotId = awarenessSnapshot.funnelSnapshotId;
      const offerSnapshotId = awarenessSnapshot.offerSnapshotId;
      const miSnapshotId = awarenessSnapshot.miSnapshotId;
      const audienceSnapshotId = awarenessSnapshot.audienceSnapshotId;
      const positioningSnapshotId = awarenessSnapshot.positioningSnapshotId;
      const differentiationSnapshotId = awarenessSnapshot.differentiationSnapshotId;

      let [integritySnapshot] = await db.select().from(integritySnapshots)
        .where(and(eq(integritySnapshots.id, integritySnapshotId), eq(integritySnapshots.campaignId, campaignId), eq(integritySnapshots.accountId, accountId)))
        .limit(1);
      if (!integritySnapshot) {
        const [latest] = await db.select().from(integritySnapshots)
          .where(and(eq(integritySnapshots.campaignId, campaignId), eq(integritySnapshots.accountId, accountId), eq(integritySnapshots.status, "COMPLETE"), eq(integritySnapshots.engineVersion, INTEGRITY_ENGINE_VERSION)))
          .orderBy(desc(integritySnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Integrity snapshot found" });
        integritySnapshot = latest;
      }

      let miSnapshot: any;
      {
        let [snap] = await db.select().from(miSnapshots)
          .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
          .limit(1);
        if (snap) {
          const integrityResult = verifySnapshotIntegrity(snap, MI_ENGINE_VERSION, campaignId);
          if (!integrityResult.valid) {
            const [latest] = await db.select().from(miSnapshots)
              .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId), eq(miSnapshots.status, "COMPLETE"), eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION)))
              .orderBy(desc(miSnapshots.createdAt)).limit(1);
            if (latest) snap = latest;
            else return res.status(400).json({ error: "MI_VERSION_MISMATCH", message: "MI snapshot version mismatch — please re-run Market Intelligence" });
          }
          miSnapshot = snap;
        } else {
          const [latest] = await db.select().from(miSnapshots)
            .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId), eq(miSnapshots.status, "COMPLETE"), eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION)))
            .orderBy(desc(miSnapshots.createdAt)).limit(1);
          if (!latest) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid MI snapshot found" });
          miSnapshot = latest;
        }
      }

      let [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);
      if (!audSnapshot) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Audience snapshot not found" });
      if (audSnapshot.engineVersion !== AUDIENCE_ENGINE_VERSION) {
        const [latest] = await db.select().from(audienceSnapshots)
          .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.engineVersion, AUDIENCE_ENGINE_VERSION)))
          .orderBy(desc(audienceSnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "VERSION_MISMATCH", message: "Audience snapshot version mismatch — please re-run Audience Engine" });
        audSnapshot = latest;
      }

      let [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);
      if (!posSnapshot) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Positioning snapshot not found" });
      if (posSnapshot.engineVersion !== POSITIONING_ENGINE_VERSION) {
        const [latest] = await db.select().from(positioningSnapshots)
          .where(and(eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.status, "COMPLETE"), eq(positioningSnapshots.engineVersion, POSITIONING_ENGINE_VERSION)))
          .orderBy(desc(positioningSnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "VERSION_MISMATCH", message: "Positioning snapshot version mismatch — please re-run Positioning" });
        posSnapshot = latest;
      }

      let [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);
      if (!diffSnapshot) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Differentiation snapshot not found" });
      if (diffSnapshot.engineVersion !== DIFF_ENGINE_VERSION) {
        const [latest] = await db.select().from(differentiationSnapshots)
          .where(and(eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.status, "COMPLETE"), eq(differentiationSnapshots.engineVersion, DIFF_ENGINE_VERSION)))
          .orderBy(desc(differentiationSnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "VERSION_MISMATCH", message: "Differentiation snapshot version mismatch — please re-run Differentiation" });
        diffSnapshot = latest;
      }

      let [offerSnapshot] = await db.select().from(offerSnapshots)
        .where(and(eq(offerSnapshots.id, offerSnapshotId), eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId)))
        .limit(1);
      if (!offerSnapshot) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Offer snapshot not found" });
      if (offerSnapshot.engineVersion !== OFFER_ENGINE_VERSION) {
        const [latest] = await db.select().from(offerSnapshots)
          .where(and(eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.status, "COMPLETE"), eq(offerSnapshots.engineVersion, OFFER_ENGINE_VERSION)))
          .orderBy(desc(offerSnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "VERSION_MISMATCH", message: "Offer snapshot version mismatch — please re-run Offer Engine" });
        offerSnapshot = latest;
      }

      let [funnelSnapshot] = await db.select().from(funnelSnapshots)
        .where(and(eq(funnelSnapshots.id, funnelSnapshotId), eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.accountId, accountId)))
        .limit(1);
      if (!funnelSnapshot) return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Funnel snapshot not found" });
      if (funnelSnapshot.engineVersion !== FUNNEL_ENGINE_VERSION) {
        const [latest] = await db.select().from(funnelSnapshots)
          .where(and(eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.status, "COMPLETE"), eq(funnelSnapshots.engineVersion, FUNNEL_ENGINE_VERSION)))
          .orderBy(desc(funnelSnapshots.createdAt)).limit(1);
        if (!latest) return res.status(400).json({ error: "VERSION_MISMATCH", message: "Funnel snapshot version mismatch — please re-run Funnel Engine" });
        funnelSnapshot = latest;
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

      const awarenessRoute = safeJsonParse(awarenessSnapshot.primaryRoute);
      const awarenessInput = {
        entryMechanismType: awarenessRoute?.entryMechanismType || "unknown",
        targetReadinessStage: awarenessRoute?.targetReadinessStage || "problem_aware",
        triggerClass: awarenessRoute?.triggerClass || "unknown",
        trustRequirement: awarenessRoute?.trustRequirement || "medium",
        funnelCompatibility: awarenessRoute?.funnelCompatibility || "unknown",
        awarenessStrengthScore: safeNumber(awarenessRoute?.awarenessStrengthScore || awarenessSnapshot.awarenessStrengthScore, 0),
        frictionNotes: awarenessRoute?.frictionNotes || [],
      };

      const result = await runPersuasionEngine(miInput, audienceInput, positioningInput, differentiationInput, offerInput, funnelInput, integrityInput, awarenessInput, accountId);

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[PersuasionEngine] HARD-FAIL: Boundary violation — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Persuasion output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const [saved] = await db.insert(persuasionSnapshots).values({
        accountId,
        campaignId,
        awarenessSnapshotId: awarenessSnapshot.id,
        integritySnapshotId: integritySnapshot.id,
        funnelSnapshotId: funnelSnapshot.id,
        offerSnapshotId: offerSnapshot.id,
        miSnapshotId: miSnapshot.id,
        audienceSnapshotId: audSnapshot.id,
        positioningSnapshotId: posSnapshot.id,
        differentiationSnapshotId: diffSnapshot.id,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryRoute: JSON.stringify(result.primaryRoute),
        alternativeRoute: JSON.stringify(result.alternativeRoute),
        rejectedRoute: JSON.stringify(result.rejectedRoute),
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.dataReliability),
        confidenceNormalized: result.confidenceNormalized,
        persuasionStrengthScore: result.primaryRoute.persuasionStrengthScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, persuasionSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
      });
    } catch (error: any) {
      console.error("[PersuasionEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Persuasion analysis failed" });
    }
  });

  app.get("/api/persuasion-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(persuasionSnapshots)
        .where(and(
          eq(persuasionSnapshots.campaignId, campaignId),
          eq(persuasionSnapshots.accountId, accountId),
          eq(persuasionSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(persuasionSnapshots.createdAt))
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
        dataReliability: safeJsonParse(latest.dataReliability),
        confidenceNormalized: latest.confidenceNormalized,
        persuasionStrengthScore: latest.persuasionStrengthScore,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        awarenessSnapshotId: latest.awarenessSnapshotId,
        integritySnapshotId: latest.integritySnapshotId,
        funnelSnapshotId: latest.funnelSnapshotId,
        offerSnapshotId: latest.offerSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
      });
    } catch (error: any) {
      console.error("[PersuasionEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch persuasion snapshot" });
    }
  });

  console.log("[PersuasionEngine-V3] Routes registered: POST /api/persuasion-engine/analyze, GET /api/persuasion-engine/latest");
}
