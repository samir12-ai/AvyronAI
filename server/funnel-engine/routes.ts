import type { Express, Request, Response } from "express";
import { db } from "../db";
import { funnelSnapshots, offerSnapshots, differentiationSnapshots, miSnapshots, audienceSnapshots, positioningSnapshots, awarenessSnapshots } from "@shared/schema";
import { ENGINE_VERSION as AWARENESS_ENGINE_VERSION } from "../awareness-engine/constants";
import { inArray, eq, and, desc } from "drizzle-orm";
import { runFunnelEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../offer-engine/constants";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { AUDIENCE_ENGINE_VERSION } from "../audience-engine/constants";
import { POSITIONING_ENGINE_VERSION } from "../positioning-engine/constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { getEngineReadinessState, verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";
import { getActiveRoot, validateRootBinding } from "../shared/strategy-root";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerFunnelEngineRoutes(app: Express) {
  app.post("/api/funnel-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, offerSnapshotId, awarenessSnapshotId, validationSessionId } = req.body;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "funnel-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!offerSnapshotId) {
        return res.status(400).json({ error: "offerSnapshotId is required" });
      }

      const [offerSnapshot] = await db.select().from(offerSnapshots)
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
        console.log(`[FunnelEngine-V3] Offer snapshot ${offerSnapshotId} version mismatch (v${offerSnapshot.engineVersion} vs v${OFFER_ENGINE_VERSION}), searching for latest valid offer snapshot`);
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
          console.log(`[FunnelEngine-V3] Using latest valid offer snapshot ${latestOffer.id} (v${latestOffer.engineVersion})`);
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
          console.log(`[FunnelEngine-V3] MI snapshot ${miSnapshotId} failed integrity check (v${miSnapshot.analysisVersion} vs v${MI_ENGINE_VERSION}), searching for latest valid MI snapshot`);
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
            console.log(`[FunnelEngine-V3] Using latest valid MI snapshot ${latestMI.id} (v${latestMI.analysisVersion})`);
            miSnapshot = latestMI;
          } else {
            return res.status(400).json({
              error: "MI_INTEGRITY_FAILED",
              message: `MI snapshot version ${miSnapshot.analysisVersion} does not match current version ${MI_ENGINE_VERSION} — please re-run Market Intelligence first`,
              failures: integrityResult.failures,
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
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "MI snapshot not found or campaign/account mismatch" });
        }
      }

      const miFreshnessMetadata = buildFreshnessMetadata(miSnapshot);
      logFreshnessTraceability("FunnelEngine", miSnapshot, miFreshnessMetadata);

      const miReadiness = getEngineReadinessState(miSnapshot, campaignId, MI_ENGINE_VERSION, 14);
      if (miReadiness.state !== "READY") {
        return res.status(400).json({
          error: "MI_NOT_READY",
          message: `MI not ready: ${miReadiness.state}`,
          diagnostics: miReadiness.diagnostics,
        });
      }

      let [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);
      if (!audSnapshot) {
        const [latestAud] = await db.select().from(audienceSnapshots)
          .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.engineVersion, AUDIENCE_ENGINE_VERSION)))
          .orderBy(desc(audienceSnapshots.createdAt)).limit(1);
        if (latestAud) {
          audSnapshot = latestAud;
          console.log(`[FunnelEngine-V3] Audience snapshot resolved via fallback to latest: ${latestAud.id}`);
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Audience snapshot found — please run Audience Engine first" });
        }
      }

      let [posSnapshot] = await db.select().from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.id, positioningSnapshotId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .limit(1);
      if (!posSnapshot) {
        const [latestPos] = await db.select().from(positioningSnapshots)
          .where(and(eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.status, "COMPLETE"), eq(positioningSnapshots.engineVersion, POSITIONING_ENGINE_VERSION)))
          .orderBy(desc(positioningSnapshots.createdAt)).limit(1);
        if (latestPos) {
          posSnapshot = latestPos;
          console.log(`[FunnelEngine-V3] Positioning snapshot resolved via fallback to latest: ${latestPos.id}`);
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Positioning snapshot found — please run Positioning Engine first" });
        }
      }

      let [diffSnapshot] = await db.select().from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.id, differentiationSnapshotId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .limit(1);
      if (!diffSnapshot) {
        const [latestDiff] = await db.select().from(differentiationSnapshots)
          .where(and(eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId), inArray(differentiationSnapshots.status, ["COMPLETE", "LOW_CONFIDENCE"]), eq(differentiationSnapshots.engineVersion, DIFF_ENGINE_VERSION)))
          .orderBy(desc(differentiationSnapshots.createdAt)).limit(1);
        if (latestDiff) {
          diffSnapshot = latestDiff;
          console.log(`[FunnelEngine-V3] Differentiation snapshot resolved via fallback to latest: ${latestDiff.id}`);
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Differentiation snapshot found — please run Differentiation Engine first" });
        }
      }

      const miInput = {
        dominanceData: safeJsonParse(miSnapshot.dominanceData),
        contentDnaData: safeJsonParse(miSnapshot.contentDnaData),
        marketDiagnosis: miSnapshot.marketDiagnosis,
        opportunitySignals: safeJsonParse(miSnapshot.opportunitySignals) || [],
        threatSignals: safeJsonParse(miSnapshot.threatSignals) || [],
        multiSourceSignals: miSnapshot.multiSourceSignals || null,
        sourceAvailability: miSnapshot.sourceAvailability || null,
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
        mechanismCore: safeJsonParse((diffSnapshot as any).mechanismCore) || null,
        authorityMode: safeJsonParse(diffSnapshot.authorityMode)?.mode || null,
        claimStructures: safeJsonParse(diffSnapshot.claimStructures) || [],
        proofArchitecture: safeJsonParse(diffSnapshot.proofArchitecture) || [],
        confidenceScore: diffSnapshot.confidenceScore,
      };

      const selectedOfferKey = activeOfferSnapshot.selectedOption || "primary";
      const offerData = safeJsonParse(
        selectedOfferKey === "alternative" ? activeOfferSnapshot.alternativeOffer : activeOfferSnapshot.primaryOffer
      );

      const offerInput = {
        offerName: offerData?.offerName || "Primary Offer",
        coreOutcome: offerData?.coreOutcome || "",
        mechanismDescription: offerData?.mechanismDescription || "",
        deliverables: offerData?.deliverables || [],
        proofAlignment: offerData?.proofAlignment || [],
        offerStrengthScore: offerData?.offerStrengthScore || 0,
        riskNotes: offerData?.riskNotes || [],
        completeness: offerData?.completeness || { complete: false, missingLayers: [] },
        genericFlag: offerData?.genericFlag || false,
        frictionLevel: offerData?.frictionLevel || 0,
      };

      let awarenessInput = null;
      let activeAwarenessSnapshotId: string | null = null;

      if (awarenessSnapshotId) {
        let [awarenessSnapshot] = await db.select().from(awarenessSnapshots)
          .where(and(eq(awarenessSnapshots.id, awarenessSnapshotId), eq(awarenessSnapshots.campaignId, campaignId), eq(awarenessSnapshots.accountId, accountId)))
          .limit(1);
        if (awarenessSnapshot && awarenessSnapshot.engineVersion !== AWARENESS_ENGINE_VERSION) {
          const [latestAwareness] = await db.select().from(awarenessSnapshots)
            .where(and(
              eq(awarenessSnapshots.campaignId, campaignId),
              eq(awarenessSnapshots.accountId, accountId),
              eq(awarenessSnapshots.engineVersion, AWARENESS_ENGINE_VERSION),
            ))
            .orderBy(desc(awarenessSnapshots.createdAt))
            .limit(1);
          if (latestAwareness) {
            console.log(`[FunnelEngine-V3] Using latest valid Awareness snapshot ${latestAwareness.id}`);
            awarenessSnapshot = latestAwareness;
          }
        }
        if (awarenessSnapshot) {
          const routeData = safeJsonParse(awarenessSnapshot.primaryRoute);
          awarenessInput = {
            awarenessStage: routeData?.targetReadinessStage || "problem_aware",
            entryMechanism: routeData?.entryMechanismType || "unknown",
            triggerClass: routeData?.triggerClass || "unknown",
            trustState: routeData?.trustRequirement || "moderate",
            awarenessRoute: routeData?.routeName || "default awareness route",
            awarenessStrengthScore: awarenessSnapshot.awarenessStrengthScore || 0,
          };
          activeAwarenessSnapshotId = awarenessSnapshot.id;
          console.log(`[FunnelEngine-V3] AWARENESS_BOUND | snapshotId=${awarenessSnapshot.id} | stage=${awarenessInput.awarenessStage} | entry=${awarenessInput.entryMechanism}`);
        }
      }

      if (!awarenessInput) {
        const [latestAwareness] = await db.select().from(awarenessSnapshots)
          .where(and(
            eq(awarenessSnapshots.campaignId, campaignId),
            eq(awarenessSnapshots.accountId, accountId),
            eq(awarenessSnapshots.engineVersion, AWARENESS_ENGINE_VERSION),
          ))
          .orderBy(desc(awarenessSnapshots.createdAt))
          .limit(1);
        if (latestAwareness) {
          const routeData = safeJsonParse(latestAwareness.primaryRoute);
          awarenessInput = {
            awarenessStage: routeData?.targetReadinessStage || "problem_aware",
            entryMechanism: routeData?.entryMechanismType || "unknown",
            triggerClass: routeData?.triggerClass || "unknown",
            trustState: routeData?.trustRequirement || "moderate",
            awarenessRoute: routeData?.routeName || "default awareness route",
            awarenessStrengthScore: latestAwareness.awarenessStrengthScore || 0,
          };
          activeAwarenessSnapshotId = latestAwareness.id;
          console.log(`[FunnelEngine-V3] AWARENESS_FALLBACK | using latest snapshot ${latestAwareness.id}`);
        } else {
          console.log(`[FunnelEngine-V3] NO_AWARENESS_SNAPSHOT | campaign=${campaignId} — Funnel requires Awareness to run first`);
          return res.status(400).json({
            error: "MISSING_DEPENDENCY",
            message: "No Awareness snapshot found — please run Awareness Engine first. Awareness must run before Funnel.",
          });
        }
      }

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
          console.log(`[FunnelEngine] ROOT_BINDING_ADVISORY | issues: ${rootValidation.issues.join("; ")}`);
        }
        strategyRootId = activeRoot.id;
        console.log(`[FunnelEngine] STRATEGY_ROOT_BOUND | rootId=${activeRoot.id} | hash=${activeRoot.rootHash}`);
      } else {
        console.log(`[FunnelEngine] NO_ACTIVE_ROOT | campaign=${campaignId}`);
      }

      const result = await runFunnelEngine(miInput, audienceInput, offerInput, positioningInput, differentiationInput, accountId, awarenessInput);

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[FunnelEngine] HARD-FAIL: Boundary violation detected — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Funnel output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const [saved] = await db.insert(funnelSnapshots).values({
        accountId,
        campaignId,
        offerSnapshotId: activeOfferSnapshot.id,
        awarenessSnapshotId: activeAwarenessSnapshotId,
        miSnapshotId: miSnapshot.id,
        audienceSnapshotId,
        positioningSnapshotId,
        differentiationSnapshotId,
        strategyRootId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryFunnel: JSON.stringify(result.primaryFunnel),
        alternativeFunnel: JSON.stringify(result.alternativeFunnel),
        rejectedFunnel: JSON.stringify(result.rejectedFunnel),
        funnelStrengthScore: result.funnelStrengthScore,
        trustPathAnalysis: JSON.stringify(result.trustPathAnalysis),
        proofPlacementLogic: JSON.stringify(result.proofPlacementLogic),
        frictionMap: JSON.stringify(result.frictionMap),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
        layerDiagnostics: JSON.stringify(result.layerDiagnostics),
      }).returning();

      await pruneOldSnapshots(db, funnelSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
        freshnessMetadata: miFreshnessMetadata,
      });
    } catch (error: any) {
      console.error("[FunnelEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Funnel analysis failed" });
    }
  });

  app.get("/api/funnel-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(funnelSnapshots)
        .where(and(
          eq(funnelSnapshots.campaignId, campaignId),
          eq(funnelSnapshots.accountId, accountId),
          eq(funnelSnapshots.engineVersion, ENGINE_VERSION),
        ))
        .orderBy(desc(funnelSnapshots.createdAt))
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
        primaryFunnel: safeJsonParse(latest.primaryFunnel),
        alternativeFunnel: safeJsonParse(latest.alternativeFunnel),
        rejectedFunnel: safeJsonParse(latest.rejectedFunnel),
        funnelStrengthScore: latest.funnelStrengthScore,
        trustPathAnalysis: safeJsonParse(latest.trustPathAnalysis),
        proofPlacementLogic: safeJsonParse(latest.proofPlacementLogic),
        frictionMap: safeJsonParse(latest.frictionMap),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        confidenceScore: latest.confidenceScore,
        selectedOption: latest.selectedOption,
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        offerSnapshotId: latest.offerSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
        layerDiagnostics: safeJsonParse(latest.layerDiagnostics),
      });
    } catch (error: any) {
      console.error("[FunnelEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch funnel snapshot" });
    }
  });

  app.post("/api/funnel-engine/select", async (req: Request, res: Response) => {
    try {
      const { snapshotId, selectedOption, campaignId } = req.body;

      if (!snapshotId || !selectedOption || !campaignId) {
        return res.status(400).json({ error: "snapshotId, selectedOption, and campaignId are required" });
      }

      if (!["primary", "alternative"].includes(selectedOption)) {
        return res.status(400).json({ error: "selectedOption must be 'primary' or 'alternative'" });
      }

      const [updated] = await db.update(funnelSnapshots)
        .set({ selectedOption })
        .where(and(
          eq(funnelSnapshots.id, snapshotId),
          eq(funnelSnapshots.campaignId, campaignId),
          eq(funnelSnapshots.accountId, accountId),
        ))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Funnel snapshot not found" });
      }

      res.json({ success: true, selectedOption: updated.selectedOption });
    } catch (error: any) {
      console.error("[FunnelEngine] Select error:", error.message);
      res.status(500).json({ error: "Failed to update funnel selection" });
    }
  });

  app.post("/api/offer-engine/select", async (req: Request, res: Response) => {
    try {
      const { snapshotId, selectedOption, campaignId } = req.body;

      if (!snapshotId || !selectedOption || !campaignId) {
        return res.status(400).json({ error: "snapshotId, selectedOption, and campaignId are required" });
      }

      if (!["primary", "alternative"].includes(selectedOption)) {
        return res.status(400).json({ error: "selectedOption must be 'primary' or 'alternative'" });
      }

      const [existingSnapshot] = await db.select({ status: offerSnapshots.status })
        .from(offerSnapshots)
        .where(and(
          eq(offerSnapshots.id, snapshotId),
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
        ))
        .limit(1);

      const [updated] = await db.update(offerSnapshots)
        .set({ selectedOption })
        .where(and(
          eq(offerSnapshots.id, snapshotId),
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
        ))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Offer snapshot not found" });
      }

      res.json({ success: true, selectedOption: updated.selectedOption });
    } catch (error: any) {
      console.error("[OfferEngine] Select error:", error.message);
      res.status(500).json({ error: "Failed to update offer selection" });
    }
  });

  console.log("[FunnelEngine-V3] Routes registered: POST /api/funnel-engine/analyze, GET /api/funnel-engine/latest, POST /api/funnel-engine/select, POST /api/offer-engine/select");
}
