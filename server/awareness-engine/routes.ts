import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  awarenessSnapshots,
  offerSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  audienceSnapshots,
  miSnapshots,
} from "@shared/schema";
import { inArray, eq, and, desc } from "drizzle-orm";
import { runAwarenessEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../offer-engine/constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { POSITIONING_ENGINE_VERSION } from "../positioning-engine/constants";
import { AUDIENCE_ENGINE_VERSION } from "../audience-engine/constants";
import { verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";
import { parseLineageFromSnapshot, mergeLineageArrays, findBestParentSignal, createDerivedLineageEntry, type SignalLineageEntry } from "../shared/signal-lineage";
import { getActiveRoot, validateRootBinding } from "../shared/strategy-root";

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
      const { campaignId, offerSnapshotId, validationSessionId } = req.body;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "awareness-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!offerSnapshotId) {
        return res.status(400).json({ error: "offerSnapshotId is required" });
      }

      let [offerSnapshot] = await db.select().from(offerSnapshots)
        .where(and(
          eq(offerSnapshots.id, offerSnapshotId),
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
        ))
        .limit(1);

      if (!offerSnapshot) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Offer snapshot not found or campaign mismatch",
        });
      }

      let activeOfferSnapshot = offerSnapshot;
      if (offerSnapshot.engineVersion !== OFFER_ENGINE_VERSION) {
        console.log(`[AwarenessEngine-V3] Offer snapshot ${offerSnapshotId} version mismatch (v${offerSnapshot.engineVersion} vs v${OFFER_ENGINE_VERSION}), searching for latest valid`);
        const [latestOffer] = await db.select().from(offerSnapshots)
          .where(and(
            eq(offerSnapshots.campaignId, campaignId),
            eq(offerSnapshots.accountId, accountId),
            eq(offerSnapshots.status, "COMPLETE"),
            eq(offerSnapshots.engineVersion, OFFER_ENGINE_VERSION),
          ))
          .orderBy(desc(offerSnapshots.createdAt))
          .limit(1);
        if (latestOffer) {
          console.log(`[AwarenessEngine-V3] Using latest valid Offer snapshot ${latestOffer.id}`);
          activeOfferSnapshot = latestOffer;
        } else {
          return res.status(400).json({
            error: "VERSION_MISMATCH",
            message: `Offer snapshot version ${offerSnapshot.engineVersion} does not match current version ${OFFER_ENGINE_VERSION} — please re-run Offer Engine first`,
          });
        }
      }

      const miSnapshotId = activeOfferSnapshot.miSnapshotId;
      const audienceSnapshotId = activeOfferSnapshot.audienceSnapshotId;
      const positioningSnapshotId = activeOfferSnapshot.positioningSnapshotId;
      const differentiationSnapshotId = activeOfferSnapshot.differentiationSnapshotId;

      let [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (miSnapshot) {
        const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
        if (!integrityResult.valid) {
          console.log(`[AwarenessEngine-V3] MI snapshot ${miSnapshotId} failed version check (v${miSnapshot.analysisVersion} vs v${MI_ENGINE_VERSION}), searching for latest valid MI snapshot`);
          const [latestMI] = await db.select().from(miSnapshots)
            .where(and(
              eq(miSnapshots.campaignId, campaignId),
              eq(miSnapshots.accountId, accountId),
              inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
              eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION),
            ))
            .orderBy(desc(miSnapshots.createdAt))
            .limit(1);
          if (latestMI) {
            console.log(`[AwarenessEngine-V3] Using latest valid MI snapshot ${latestMI.id} (v${latestMI.analysisVersion})`);
            miSnapshot = latestMI;
          } else {
            return res.status(400).json({
              error: "MI_VERSION_MISMATCH",
              message: `MI snapshot version ${miSnapshot.analysisVersion} does not match current version ${MI_ENGINE_VERSION} — please re-run Market Intelligence first`,
            });
          }
        }
      } else {
        const [latestMI] = await db.select().from(miSnapshots)
          .where(and(
            eq(miSnapshots.campaignId, campaignId),
            eq(miSnapshots.accountId, accountId),
            inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
            eq(miSnapshots.analysisVersion, MI_ENGINE_VERSION),
          ))
          .orderBy(desc(miSnapshots.createdAt))
          .limit(1);
        if (latestMI) {
          miSnapshot = latestMI;
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid MI snapshot found — please run Market Intelligence first" });
        }
      }

      const miFreshnessMetadata = buildFreshnessMetadata(miSnapshot);
      logFreshnessTraceability("AwarenessEngine", miSnapshot, miFreshnessMetadata);

      let [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);

      if (!audSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Audience snapshot not found" });
      }
      if (audSnapshot.engineVersion !== AUDIENCE_ENGINE_VERSION) {
        console.log(`[AwarenessEngine-V3] Audience snapshot ${audienceSnapshotId} version mismatch (v${audSnapshot.engineVersion} vs v${AUDIENCE_ENGINE_VERSION}), searching for latest valid`);
        const [latestAud] = await db.select().from(audienceSnapshots)
          .where(and(
            eq(audienceSnapshots.campaignId, campaignId),
            eq(audienceSnapshots.accountId, accountId),
            eq(audienceSnapshots.engineVersion, AUDIENCE_ENGINE_VERSION),
          ))
          .orderBy(desc(audienceSnapshots.createdAt))
          .limit(1);
        if (latestAud) {
          console.log(`[AwarenessEngine-V3] Using latest valid Audience snapshot ${latestAud.id}`);
          audSnapshot = latestAud;
        } else {
          return res.status(400).json({ error: "VERSION_MISMATCH", message: `Audience snapshot version ${audSnapshot.engineVersion} does not match current version ${AUDIENCE_ENGINE_VERSION} — please re-run Audience Engine` });
        }
      }

      let [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);

      if (!posSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Positioning snapshot not found" });
      }
      if (posSnapshot.engineVersion !== POSITIONING_ENGINE_VERSION) {
        console.log(`[AwarenessEngine-V3] Positioning snapshot ${positioningSnapshotId} version mismatch (v${posSnapshot.engineVersion} vs v${POSITIONING_ENGINE_VERSION}), searching for latest valid`);
        const [latestPos] = await db.select().from(positioningSnapshots)
          .where(and(
            eq(positioningSnapshots.campaignId, campaignId),
            eq(positioningSnapshots.accountId, accountId),
            eq(positioningSnapshots.status, "COMPLETE"),
            eq(positioningSnapshots.engineVersion, POSITIONING_ENGINE_VERSION),
          ))
          .orderBy(desc(positioningSnapshots.createdAt))
          .limit(1);
        if (latestPos) {
          console.log(`[AwarenessEngine-V3] Using latest valid Positioning snapshot ${latestPos.id}`);
          posSnapshot = latestPos;
        } else {
          return res.status(400).json({ error: "VERSION_MISMATCH", message: `Positioning snapshot version ${posSnapshot.engineVersion} does not match current version ${POSITIONING_ENGINE_VERSION} — please re-run Positioning Engine` });
        }
      }

      let [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);

      if (!diffSnapshot) {
        return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "Differentiation snapshot not found" });
      }
      if (diffSnapshot.engineVersion !== DIFF_ENGINE_VERSION) {
        console.log(`[AwarenessEngine-V3] Differentiation snapshot ${differentiationSnapshotId} version mismatch (v${diffSnapshot.engineVersion} vs v${DIFF_ENGINE_VERSION}), searching for latest valid`);
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
          console.log(`[AwarenessEngine-V3] Using latest valid Differentiation snapshot ${latestDiff.id}`);
          diffSnapshot = latestDiff;
        } else {
          return res.status(400).json({ error: "VERSION_MISMATCH", message: `Differentiation snapshot version ${diffSnapshot.engineVersion} does not match current version ${DIFF_ENGINE_VERSION} — please re-run Differentiation Engine` });
        }
      }

      let miNarrativeObjectionCount = 0;
      let miNarrativeObjectionDensity = 0;
      if (miSnapshot.objectionMapData) {
        try {
          const objMap = JSON.parse(miSnapshot.objectionMapData as string);
          miNarrativeObjectionCount = objMap?.totalObjectionsDetected || 0;
          miNarrativeObjectionDensity = objMap?.objectionDensity || 0;
        } catch {}
      }

      const selectedOfferKey = activeOfferSnapshot.selectedOption || "primary";
      const offerData = safeJsonParse(
        selectedOfferKey === "alternative" ? activeOfferSnapshot.alternativeOffer : activeOfferSnapshot.primaryOffer
      );

      const miInput = {
        marketDiagnosis: miSnapshot.marketDiagnosis,
        overallConfidence: safeNumber(miSnapshot.overallConfidence, 0),
        opportunitySignals: safeJsonParse(miSnapshot.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnapshot.threatSignals) || [],
        narrativeObjectionCount: miNarrativeObjectionCount,
        narrativeObjectionDensity: miNarrativeObjectionDensity,
        multiSourceSignals: miSnapshot.multiSourceSignals || null,
        sourceAvailability: miSnapshot.sourceAvailability || null,
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

      const activeRoot = await getActiveRoot(campaignId, accountId);
      let strategyRootId: string | null = null;

      if (activeRoot) {
        const rootValidation = validateRootBinding(activeRoot, {
          miSnapshotId: miSnapshot.id,
          audienceSnapshotId,
          positioningSnapshotId,
          differentiationSnapshotId,
        });
        if (!rootValidation.valid) {
          console.log(`[AwarenessEngine] ROOT_BINDING_ADVISORY | issues: ${rootValidation.issues.join("; ")}`);
        }
        strategyRootId = activeRoot.id;
        console.log(`[AwarenessEngine] STRATEGY_ROOT_BOUND | rootId=${activeRoot.id} | hash=${activeRoot.rootHash}`);
      } else {
        console.log(`[AwarenessEngine] NO_ACTIVE_ROOT | campaign=${campaignId}`);
      }

      const upstreamLineage = mergeLineageArrays(
        parseLineageFromSnapshot((miSnapshot as any).signalLineage),
        parseLineageFromSnapshot((audSnapshot as any).signalLineage),
        parseLineageFromSnapshot((activeOfferSnapshot as any).signalLineage),
      );
      console.log(`[AwarenessEngine] UPSTREAM_LINEAGE | mi=${parseLineageFromSnapshot((miSnapshot as any).signalLineage).length} | audience=${parseLineageFromSnapshot((audSnapshot as any).signalLineage).length} | offer=${parseLineageFromSnapshot((activeOfferSnapshot as any).signalLineage).length} | merged=${upstreamLineage.length}`);

      const result = await runAwarenessEngine(miInput, audienceInput, positioningInput, differentiationInput, offerInput, accountId, upstreamLineage);

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[AwarenessEngine] HARD-FAIL: ${result.statusMessage || "Boundary violation"} — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Awareness output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }
      const awarenessLineage: SignalLineageEntry[] = [];
      const awarenessClaims = [
        result.primaryRoute?.entryMechanismType,
        result.primaryRoute?.triggerClass,
        result.primaryRoute?.targetReadinessStage,
        ...(result.primaryRoute?.frictionNotes || []),
      ].filter(Boolean);
      awarenessClaims.forEach((claim: string, i: number) => {
        const parent = findBestParentSignal(claim, upstreamLineage);
        if (parent) {
          awarenessLineage.push(createDerivedLineageEntry("awareness_engine", "awareness_claim", claim, parent, i));
        }
      });
      console.log(`[AwarenessEngine] LINEAGE_BUILT | upstream=${upstreamLineage.length} | derived=${awarenessLineage.length} | claims=${awarenessClaims.length}`);

      const [saved] = await db.insert(awarenessSnapshots).values({
        accountId,
        campaignId,
        integritySnapshotId: null,
        funnelSnapshotId: null,
        offerSnapshotId: activeOfferSnapshot.id,
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
        awarenessStrengthScore: result.primaryRoute.awarenessStrengthScore,
        signalLineage: JSON.stringify(mergeLineageArrays(upstreamLineage, awarenessLineage)),
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, awarenessSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
        freshnessMetadata: miFreshnessMetadata,
      });
    } catch (error: any) {
      console.error("[AwarenessEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Awareness analysis failed" });
    }
  });

  app.get("/api/awareness-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req as any).accountId || "default";

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
        dataReliability: safeJsonParse(latest.dataReliability),
        confidenceNormalized: latest.confidenceNormalized,
        awarenessStrengthScore: latest.awarenessStrengthScore,
        signalLineage: safeJsonParse(latest.signalLineage),
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        offerSnapshotId: latest.offerSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
      });
    } catch (error: any) {
      console.error("[AwarenessEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch awareness snapshot" });
    }
  });

  console.log("[AwarenessEngine-V3] Routes registered: POST /api/awareness-engine/analyze, GET /api/awareness-engine/latest");
}
