import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  integritySnapshots,
  funnelSnapshots,
  offerSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  audienceSnapshots,
  miSnapshots,
} from "@shared/schema";
import { inArray, eq, and, desc } from "drizzle-orm";
import { runIntegrityEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { ENGINE_VERSION as FUNNEL_ENGINE_VERSION } from "../funnel-engine/constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../offer-engine/constants";
import { ENGINE_VERSION as MI_ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { AUDIENCE_ENGINE_VERSION } from "../audience-engine/constants";
import { POSITIONING_ENGINE_VERSION } from "../positioning-engine/constants";
import { ENGINE_VERSION as DIFF_ENGINE_VERSION } from "../differentiation-engine/constants";
import { getEngineReadinessState, verifySnapshotIntegrity } from "../market-intelligence-v3/engine-state";
import { pruneOldSnapshots, checkValidationSession } from "../engine-hardening";
import { buildFreshnessMetadata, logFreshnessTraceability } from "../shared/snapshot-trust";
import { getActiveRoot, validateRootBinding } from "../shared/strategy-root";

import { resolveAccountId } from "../auth";
import { resolveOrManualJobId } from "../orchestrator/job-id";
import { wrapAsEnvelope } from "../orchestrator/contract-registry";
import { computeStalenessCoefficient } from "../shared/snapshot-trust";
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

export function registerIntegrityEngineRoutes(app: Express) {
  app.post("/api/integrity-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, funnelSnapshotId, validationSessionId } = req.body;
      const __jobId = resolveOrManualJobId(req.body.jobId);
      const accountId = resolveAccountId(req);

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "integrity-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      let funnelSnapshot: any;
      if (funnelSnapshotId) {
        [funnelSnapshot] = await db.select().from(funnelSnapshots)
          .where(and(
            eq(funnelSnapshots.id, funnelSnapshotId),
            eq(funnelSnapshots.campaignId, campaignId),
            eq(funnelSnapshots.accountId, accountId),
          ))
          .limit(1);
      }
      if (!funnelSnapshot) {
        const [latestFunnel] = await db.select().from(funnelSnapshots)
          .where(and(
            eq(funnelSnapshots.campaignId, campaignId),
            eq(funnelSnapshots.accountId, accountId),
            eq(funnelSnapshots.engineVersion, FUNNEL_ENGINE_VERSION),
            eq(funnelSnapshots.status, "COMPLETE"),
          ))
          .orderBy(desc(funnelSnapshots.createdAt))
          .limit(1);
        if (latestFunnel) {
          funnelSnapshot = latestFunnel;
          console.log(`[IntegrityEngine-V3] Funnel snapshot resolved via fallback to latest: ${latestFunnel.id}`);
        } else {
          return res.status(400).json({
            error: "MISSING_DEPENDENCY",
            message: "No valid Funnel snapshot found — please run Funnel Engine first",
          });
        }
      }

      if (funnelSnapshot.engineVersion !== FUNNEL_ENGINE_VERSION) {
        console.log(`[IntegrityEngine-V3] Funnel snapshot ${funnelSnapshotId} version mismatch (v${funnelSnapshot.engineVersion} vs v${FUNNEL_ENGINE_VERSION}), searching for latest valid funnel snapshot`);
        const [latestFunnel] = await db.select().from(funnelSnapshots)
          .where(and(
            eq(funnelSnapshots.campaignId, campaignId),
            eq(funnelSnapshots.accountId, accountId),
            eq(funnelSnapshots.engineVersion, FUNNEL_ENGINE_VERSION),
            eq(funnelSnapshots.status, "COMPLETE"),
          ))
          .orderBy(desc(funnelSnapshots.createdAt))
          .limit(1);
        if (latestFunnel) {
          console.log(`[IntegrityEngine-V3] Using latest valid funnel snapshot ${latestFunnel.id} (v${latestFunnel.engineVersion})`);
          funnelSnapshot = latestFunnel;
        } else {
          return res.status(400).json({
            error: "VERSION_MISMATCH",
            message: `Funnel snapshot version ${funnelSnapshot.engineVersion} does not match current version ${FUNNEL_ENGINE_VERSION} — please re-run Funnel Engine first`,
          });
        }
      }

      const offerSnapshotId = funnelSnapshot.offerSnapshotId;
      const miSnapshotId = funnelSnapshot.miSnapshotId;
      const audienceSnapshotId = funnelSnapshot.audienceSnapshotId;
      const positioningSnapshotId = funnelSnapshot.positioningSnapshotId;
      const differentiationSnapshotId = funnelSnapshot.differentiationSnapshotId;

      let [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(eq(miSnapshots.id, miSnapshotId), eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (miSnapshot) {
        const integrityResult = verifySnapshotIntegrity(miSnapshot, MI_ENGINE_VERSION, campaignId);
        if (!integrityResult.valid) {
          console.log(`[IntegrityEngine-V3] MI snapshot ${miSnapshotId} failed version check (v${miSnapshot.analysisVersion} vs v${MI_ENGINE_VERSION}), searching for latest valid MI snapshot`);
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
            console.log(`[IntegrityEngine-V3] Using latest valid MI snapshot ${latestMI.id} (v${latestMI.analysisVersion})`);
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
      logFreshnessTraceability("IntegrityEngine", miSnapshot, miFreshnessMetadata);

      let [audSnapshot] = await db.select().from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.id, audienceSnapshotId), eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .limit(1);
      if (!audSnapshot) {
        const [latestAud] = await db.select().from(audienceSnapshots)
          .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.engineVersion, AUDIENCE_ENGINE_VERSION)))
          .orderBy(desc(audienceSnapshots.createdAt)).limit(1);
        if (latestAud) {
          audSnapshot = latestAud;
          console.log(`[IntegrityEngine-V3] Audience snapshot resolved via fallback to latest: ${latestAud.id}`);
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
          console.log(`[IntegrityEngine-V3] Positioning snapshot resolved via fallback to latest: ${latestPos.id}`);
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
          console.log(`[IntegrityEngine-V3] Differentiation snapshot resolved via fallback to latest: ${latestDiff.id}`);
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Differentiation snapshot found — please run Differentiation Engine first" });
        }
      }

      let [offerSnapshot] = await db.select().from(offerSnapshots)
        .where(and(eq(offerSnapshots.id, offerSnapshotId), eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId)))
        .limit(1);
      if (!offerSnapshot) {
        const [latestOffer] = await db.select().from(offerSnapshots)
          .where(and(eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.status, "COMPLETE"), eq(offerSnapshots.engineVersion, OFFER_ENGINE_VERSION)))
          .orderBy(desc(offerSnapshots.createdAt)).limit(1);
        if (latestOffer) {
          offerSnapshot = latestOffer;
          console.log(`[IntegrityEngine-V3] Offer snapshot resolved via fallback to latest: ${latestOffer.id}`);
        } else {
          return res.status(400).json({ error: "MISSING_DEPENDENCY", message: "No valid Offer snapshot found — please run Offer Engine first" });
        }
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
        mechanismCore: safeJsonParse((diffSnapshot as any).mechanismCore) || null,
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
        completeness: offerData?.completeness || { complete: false, missingLayers: [] },
        genericFlag: offerData?.genericFlag || false,
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
        compressionApplied: funnelData?.compressionApplied || false,
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
          console.log(`[IntegrityEngine] ROOT_BINDING_ADVISORY | issues: ${rootValidation.issues.join("; ")}`);
        }
        strategyRootId = activeRoot.id;
        console.log(`[IntegrityEngine] STRATEGY_ROOT_BOUND | rootId=${activeRoot.id} | hash=${activeRoot.rootHash}`);
      } else {
        console.log(`[IntegrityEngine] NO_ACTIVE_ROOT | campaign=${campaignId}`);
      }

      const result = runIntegrityEngine(miInput, audienceInput, positioningInput, differentiationInput, offerInput, funnelInput);

      if (result.status === "INTEGRITY_FAILED") {
        console.error(`[IntegrityEngine] HARD-FAIL: Boundary violation — not persisting`);
        return res.status(422).json({
          success: false,
          error: "INTEGRITY_FAILED",
          message: result.statusMessage || "Integrity output violated boundary protections",
          boundaryCheck: result.boundaryCheck,
          executionTimeMs: result.executionTimeMs,
        });
      }

      const [saved] = await db.insert(integritySnapshots).values({
        jobId: __jobId,
        accountId,
        campaignId,
        funnelSnapshotId: funnelSnapshot.id,
        offerSnapshotId,
        miSnapshotId: miSnapshot.id,
        audienceSnapshotId,
        positioningSnapshotId,
        differentiationSnapshotId,
        strategyRootId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        overallIntegrityScore: result.overallIntegrityScore,
        safeToExecute: result.safeToExecute,
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        flaggedInconsistencies: JSON.stringify(result.flaggedInconsistencies),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, integritySnapshots, campaignId, 20, accountId);

      res.json({
        success: true,
        snapshotId: saved.id,
        ...result,
        freshnessMetadata: miFreshnessMetadata,
      });
    } catch (error: any) {
      console.error("[IntegrityEngine] Analysis error:", error.message);
      res.status(500).json({ error: "Integrity analysis failed" });
    }
  });

  app.get("/api/integrity-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = resolveAccountId(req);
      const requestedRunId = (req.query.runId as string) || null;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const { resolveRunId } = await import("../orchestrator/run-resolver");
      let __resolved;
      try { __resolved = await resolveRunId(campaignId, accountId, requestedRunId); }
      catch (e: any) { return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false }); }
      if (!__resolved.runId) return res.json({ exists: false, runId: null, isLatest: true, isStale: false });

      const [latest] = await db.select().from(integritySnapshots)
        .where(and(
          eq(integritySnapshots.campaignId, campaignId),
          eq(integritySnapshots.accountId, accountId),
          eq(integritySnapshots.jobId, __resolved.runId),
        ))
        .limit(1);

      if (!latest) {
        return res.json({ exists: false, runId: __resolved.runId, isLatest: __resolved.isLatest, isStale: __resolved.isStale });
      }

      // Phase C3 — emit LiveSnapshotEnvelope. The integrity_snapshots table
      // does not persist `zeroLeakage`/`traceabilityComplete`/`failureReasons`
      // /`overallStatus` as separate columns, so we derive them deterministically
      // from the already-persisted layerResults + flaggedInconsistencies +
      // safeToExecute. This matches the contract's read paths until/unless the
      // schema is extended.
      //
      // Integrity contract hardening (May 2026): `overallStatus` is the
      // canonical VERDICT (PASS|PARTIAL|FAIL). It MUST NOT be derived from the
      // engine-execution `status` column (which carries COMPLETE|INTEGRITY_FAILED).
      // Mapping below mirrors the engine's own derivation in engine.ts.
      let envelope: ReturnType<typeof wrapAsEnvelope> | null = null;
      try {
        const layerResultsParsed = safeJsonParse(latest.layerResults) || [];
        const structuralWarningsParsed = safeJsonParse(latest.structuralWarnings) || [];
        const flaggedInconsistenciesParsed = safeJsonParse(latest.flaggedInconsistencies) || [];
        const boundaryCheckParsed = safeJsonParse(latest.boundaryCheck) || { passed: true, violations: [] };
        const failedLayers = Array.isArray(layerResultsParsed)
          ? layerResultsParsed.filter((l: any) => l && (l.status === "FAIL" || l.status === "FAILED" || l.passed === false))
          : [];
        const failedCount = failedLayers.length;
        const failureReasons: string[] = [
          ...failedLayers.map((l: any) => typeof l?.reason === "string" ? l.reason : (typeof l?.layer === "string" ? `${l.layer}_FAILED` : "LAYER_FAILED")),
          ...(Array.isArray(flaggedInconsistenciesParsed) ? flaggedInconsistenciesParsed.map((i: any) => typeof i === "string" ? i : (i?.reason || i?.code || "INCONSISTENCY")) : []),
        ].filter((r) => typeof r === "string" && r.length > 0);
        const zeroLeakage = Array.isArray(flaggedInconsistenciesParsed) && flaggedInconsistenciesParsed.length === 0;
        const traceabilityComplete = boundaryCheckParsed?.passed === true && failedCount === 0;
        const structuralWarningsCount = Array.isArray(structuralWarningsParsed) ? structuralWarningsParsed.length : 0;

        // Canonical verdict derivation — mirrors integrity-engine/engine.ts:706-719.
        // Never trust `latest.status` (engine-execution semantics, NOT a verdict).
        let overallStatus: "PASS" | "PARTIAL" | "FAIL";
        if (boundaryCheckParsed?.passed !== true || failedCount >= 3 || latest.safeToExecute !== true) {
          overallStatus = "FAIL";
        } else if (failedCount > 0 || structuralWarningsCount > 0) {
          overallStatus = "PARTIAL";
        } else {
          overallStatus = "PASS";
        }

        const integrityOutput = {
          overallIntegrityScore: latest.overallIntegrityScore,
          safeToExecute: latest.safeToExecute,
          status: latest.status,            // engine-execution status (display only)
          overallStatus,                    // legacy verdict field (back-compat for FE SystemIntegrityPanel)
          integrityVerdict: overallStatus,  // H4 (2026-05-10): canonical verdict under a semantically-explicit name (same value as overallStatus)
          zeroLeakage,
          traceabilityComplete,
          failureReasons,
          structuralWarnings: structuralWarningsParsed,
          flaggedInconsistencies: flaggedInconsistenciesParsed,
          layerResults: layerResultsParsed,
        };
        const staleness = computeStalenessCoefficient(latest);
        envelope = wrapAsEnvelope("integrity", integrityOutput, {
          snapshotId: latest.id,
          campaignId,
          runId: __resolved.runId,
          currentJobId: __resolved.runId,
          provenance: {
            sourceJobId: latest.jobId ?? null,
            createdAt: latest.createdAt ? new Date(latest.createdAt).toISOString() : null,
            wasReused: latest.jobId != null && latest.jobId !== __resolved.runId,
            freshnessClass: staleness.freshnessClass,
            ageInDays: staleness.ageInDays,
            schemaVersion: typeof latest.engineVersion === "number" ? latest.engineVersion : null,
          },
        });
      } catch (e: any) {
        console.log(`[ContractEnvelope] BUILD_FAILED engine=integrity snap=${latest.id} err=${e?.message ?? String(e)}`);
      }

      res.json({
        exists: true,
        runId: __resolved.runId,
        isLatest: __resolved.isLatest,
        isStale: __resolved.isStale,
        completedAt: __resolved.completedAt,
        id: latest.id,
        campaignId: latest.campaignId,
        status: latest.status,
        statusMessage: latest.statusMessage,
        engineVersion: latest.engineVersion,
        envelope,
        overallIntegrityScore: latest.overallIntegrityScore,
        safeToExecute: latest.safeToExecute,
        layerResults: safeJsonParse(latest.layerResults),
        structuralWarnings: safeJsonParse(latest.structuralWarnings),
        flaggedInconsistencies: safeJsonParse(latest.flaggedInconsistencies),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        executionTimeMs: latest.executionTimeMs,
        createdAt: latest.createdAt,
        funnelSnapshotId: latest.funnelSnapshotId,
        offerSnapshotId: latest.offerSnapshotId,
        differentiationSnapshotId: latest.differentiationSnapshotId,
        positioningSnapshotId: latest.positioningSnapshotId,
        miSnapshotId: latest.miSnapshotId,
        audienceSnapshotId: latest.audienceSnapshotId,
      });
    } catch (error: any) {
      console.error("[IntegrityEngine] Latest fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch integrity snapshot" });
    }
  });

  console.log("[IntegrityEngine-V3] Routes registered: POST /api/integrity-engine/analyze, GET /api/integrity-engine/latest");
}
