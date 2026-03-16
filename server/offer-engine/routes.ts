import type { Express, Request, Response } from "express";
import { db } from "../db";
import { offerSnapshots, differentiationSnapshots, miSnapshots, audienceSnapshots, positioningSnapshots, mechanismSnapshots } from "@shared/schema";
import { inArray, eq, and, desc } from "drizzle-orm";
import { runOfferEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { getEngineReadinessState, verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";
import { parseLineageFromSnapshot, mergeLineageArrays, findBestParentSignal, createDerivedLineageEntry, type SignalLineageEntry } from "../shared/signal-lineage";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";
import { getActiveRoot, validateRootBinding, validatePreGeneration, validatePostGeneration } from "../shared/strategy-root";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerOfferEngineRoutes(app: Express) {
  app.post("/api/offer-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", differentiationSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "offer-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
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

      let activeDiffSnapshot = diffSnapshot;
      if (activeDiffSnapshot.engineVersion !== DIFF_ENGINE_VERSION) {
        console.log(`[OfferEngine] Diff snapshot ${differentiationSnapshotId} version mismatch (v${activeDiffSnapshot.engineVersion} vs v${DIFF_ENGINE_VERSION}), searching for latest valid diff snapshot`);
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
          console.log(`[OfferEngine] Using latest valid diff snapshot ${latestDiff.id} (v${latestDiff.engineVersion})`);
          activeDiffSnapshot = latestDiff;
        } else {
          return res.status(400).json({
            error: "VERSION_MISMATCH",
            message: `Differentiation snapshot version ${activeDiffSnapshot.engineVersion} does not match current version ${DIFF_ENGINE_VERSION} — please re-run Differentiation Engine first`,
          });
        }
      }

      const miSnapshotId = activeDiffSnapshot.miSnapshotId;
      const audienceSnapshotId = activeDiffSnapshot.audienceSnapshotId;
      const positioningSnapshotId = activeDiffSnapshot.positioningSnapshotId;

      let [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (miSnapshot) {
        const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
        const miReadiness = integrityResult.valid ? getEngineReadinessState(miSnapshot, campaignId, MI_ENGINE_VERSION, 14) : null;
        if (!integrityResult.valid || (miReadiness && miReadiness.state !== "READY")) {
          console.log(`[OfferEngine] MI snapshot ${miSnapshotId} failed integrity/readiness check, searching for latest valid MI snapshot`);
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
            console.log(`[OfferEngine] Using latest valid MI snapshot ${latestMI.id} (v${latestMI.analysisVersion})`);
            miSnapshot = latestMI;
          } else {
            return res.status(400).json({
              error: "MI_INTEGRITY_FAILED",
              message: "MI snapshot integrity check failed and no valid alternative found — please re-run Market Intelligence first",
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
      logFreshnessTraceability("OfferEngine", miSnapshot, miFreshnessMetadata);

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
        multiSourceSignals: miSnapshot.multiSourceSignals || null,
        sourceAvailability: miSnapshot.sourceAvailability || null,
        _campaignId: campaignId,
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
        pillars: safeJsonParse(activeDiffSnapshot.differentiationPillars) || [],
        mechanismFraming: safeJsonParse(activeDiffSnapshot.mechanismFraming),
        mechanismCore: safeJsonParse((activeDiffSnapshot as any).mechanismCore) || null,
        authorityMode: safeJsonParse(activeDiffSnapshot.authorityMode)?.mode || null,
        claimStructures: safeJsonParse(activeDiffSnapshot.claimStructures) || [],
        proofArchitecture: safeJsonParse(activeDiffSnapshot.proofArchitecture) || [],
        confidenceScore: activeDiffSnapshot.confidenceScore,
      };

      const upstreamLineage = mergeLineageArrays(
        parseLineageFromSnapshot((miSnapshot as any).signalLineage),
        parseLineageFromSnapshot((audSnapshot as any).signalLineage),
      );
      console.log(`[OfferEngine] UPSTREAM_LINEAGE | mi=${parseLineageFromSnapshot((miSnapshot as any).signalLineage).length} | audience=${parseLineageFromSnapshot((audSnapshot as any).signalLineage).length} | merged=${upstreamLineage.length}`);

      const activeRoot = await getActiveRoot(campaignId, accountId);
      let strategyRootId: string | null = null;
      let rootValidation: any = null;

      if (activeRoot) {
        const preGen = validatePreGeneration(activeRoot);
        rootValidation = validateRootBinding(activeRoot, {
          miSnapshotId: miSnapshot.id,
          audienceSnapshotId,
          positioningSnapshotId,
          differentiationSnapshotId: activeDiffSnapshot.id,
        });

        if (!rootValidation.valid) {
          console.log(`[OfferEngine] ROOT_BINDING_ADVISORY | issues: ${rootValidation.issues.join("; ")}`);
        }
        if (!preGen.canGenerate) {
          console.log(`[OfferEngine] ROOT_PRE_GEN_ADVISORY | missing: ${preGen.missingFields.join(", ")}`);
        }
        strategyRootId = activeRoot.id;
        console.log(`[OfferEngine] STRATEGY_ROOT_BOUND | rootId=${activeRoot.id} | hash=${activeRoot.rootHash} | runId=${activeRoot.runId}`);
      } else {
        console.log(`[OfferEngine] NO_ACTIVE_ROOT | campaign=${campaignId} | proceeding without root binding`);
      }

      let mechanismEngineOutput: any = undefined;
      let mechanismSnapshotUsed: string | null = null;

      if (activeRoot?.mechanismSnapshotId) {
        const [rootMechanism] = await db.select().from(mechanismSnapshots)
          .where(and(
            eq(mechanismSnapshots.id, activeRoot.mechanismSnapshotId),
            eq(mechanismSnapshots.campaignId, campaignId),
            eq(mechanismSnapshots.accountId, accountId),
          ))
          .limit(1);
        if (rootMechanism) {
          mechanismEngineOutput = {
            primaryMechanism: safeJsonParse(rootMechanism.primaryMechanism),
            alternativeMechanism: safeJsonParse(rootMechanism.alternativeMechanism),
            axisConsistency: safeJsonParse(rootMechanism.axisConsistency),
          };
          mechanismSnapshotUsed = rootMechanism.id;
          console.log(`[OfferEngine] MECHANISM_FROM_ROOT | snapshotId=${rootMechanism.id} | bound to strategy root ${activeRoot.id}`);
        }
      }

      if (!mechanismEngineOutput) {
        const [latestMechanism] = await db.select().from(mechanismSnapshots)
          .where(and(
            eq(mechanismSnapshots.campaignId, campaignId),
            eq(mechanismSnapshots.accountId, accountId),
            eq(mechanismSnapshots.status, "COMPLETE"),
          ))
          .orderBy(desc(mechanismSnapshots.createdAt))
          .limit(1);
        if (latestMechanism) {
          mechanismEngineOutput = {
            primaryMechanism: safeJsonParse(latestMechanism.primaryMechanism),
            alternativeMechanism: safeJsonParse(latestMechanism.alternativeMechanism),
            axisConsistency: safeJsonParse(latestMechanism.axisConsistency),
          };
          mechanismSnapshotUsed = latestMechanism.id;
          console.log(`[OfferEngine] MECHANISM_FALLBACK | snapshotId=${latestMechanism.id} | no root binding, using latest`);
        }
      }

      const result = await runOfferEngine(miInput, audienceInput, positioningInput, differentiationInput, accountId, upstreamLineage, mechanismEngineOutput);

      if (result.status === "INSUFFICIENT_SIGNALS") {
        return res.status(422).json({
          success: false,
          error: "SIGNAL_INSUFFICIENT",
          message: result.statusMessage || "Insufficient upstream signals for grounded claim generation",
          signalGrounding: result.signalGrounding,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const offerLineage: SignalLineageEntry[] = [];
      const offerClaims = [
        result.primaryOffer?.coreOutcome,
        result.primaryOffer?.mechanismDescription,
        ...(result.primaryOffer?.deliverables || []),
        ...(result.primaryOffer?.proofAlignment || []),
      ].filter(Boolean);
      offerClaims.forEach((claim: string, i: number) => {
        const parent = findBestParentSignal(claim, upstreamLineage);
        if (parent) {
          offerLineage.push(createDerivedLineageEntry("offer_engine", "offer_claim", claim, parent, i));
        }
      });
      console.log(`[OfferEngine] LINEAGE_BUILT | upstream=${upstreamLineage.length} | derived=${offerLineage.length} | claims=${offerClaims.length} | grounding=${result.signalGrounding ? `${result.signalGrounding.groundedClaims}/${result.signalGrounding.totalClaims}` : 'N/A'}`);

      let postGenValidation: any = null;
      if (activeRoot && result.primaryOffer) {
        postGenValidation = validatePostGeneration(activeRoot, result.primaryOffer);
        if (!postGenValidation.valid) {
          console.log(`[OfferEngine] POST_GEN_ADVISORY | issues: ${postGenValidation.issues.join("; ")}`);
          const warnings = result.structuralWarnings || [];
          warnings.push(...postGenValidation.issues);
          result.structuralWarnings = warnings;
        }
      }

      const diagnostics = result.layerDiagnostics || {};
      diagnostics.strategyRoot = activeRoot ? {
        rootId: activeRoot.id,
        rootHash: activeRoot.rootHash,
        runId: activeRoot.runId,
        bound: true,
        bindingValid: rootValidation?.valid ?? true,
        bindingIssues: rootValidation?.issues || [],
        postGenValid: postGenValidation?.valid ?? true,
        postGenIssues: postGenValidation?.issues || [],
      } : { bound: false };

      const [saved] = await db.insert(offerSnapshots).values({
        accountId,
        campaignId,
        miSnapshotId: miSnapshot.id,
        audienceSnapshotId,
        positioningSnapshotId,
        differentiationSnapshotId: activeDiffSnapshot.id,
        mechanismSnapshotId: mechanismSnapshotUsed || null,
        strategyRootId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        primaryOffer: JSON.stringify(result.primaryOffer),
        alternativeOffer: JSON.stringify(result.alternativeOffer),
        rejectedOffer: JSON.stringify(result.rejectedOffer),
        offerStrengthScore: result.offerStrengthScore,
        positioningConsistency: JSON.stringify(result.positioningConsistency),
        hookMechanismAlignment: JSON.stringify(result.hookMechanismAlignment),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        confidenceScore: result.confidenceScore,
        signalLineage: JSON.stringify(mergeLineageArrays(upstreamLineage, offerLineage)),
        structuralWarnings: JSON.stringify(result.structuralWarnings || []),
        layerDiagnostics: JSON.stringify(diagnostics),
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, offerSnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
        freshnessMetadata: miFreshnessMetadata,
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
        hookMechanismAlignment: safeJsonParse(latest.hookMechanismAlignment),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        confidenceScore: latest.confidenceScore,
        selectedOption: latest.selectedOption,
        structuralWarnings: safeJsonParse(latest.structuralWarnings),
        layerDiagnostics: safeJsonParse(latest.layerDiagnostics),
        mechanismSnapshotId: latest.mechanismSnapshotId,
        strategyRootId: latest.strategyRootId,
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
