import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { retentionSnapshots, manualRetentionMetrics, retentionGateInputs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runRetentionEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { pruneOldSnapshots, checkValidationSession } from "../../engine-hardening";
import { validateEngineDependencies, logDependencyCheck } from "../dependency-validation";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerRetentionEngineRoutes(app: Express) {
  app.post("/api/strategy/retention-engine/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const depCheck = validateEngineDependencies("retention-engine");
      logDependencyCheck("retention-engine", depCheck);
      if (!depCheck.valid) {
        return res.status(503).json({
          error: "ENGINE_DEPENDENCY_MISMATCH",
          message: `Retention Engine cannot execute: ${depCheck.mismatches.join("; ")}`,
          mismatches: depCheck.mismatches,
        });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "retention-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      const [gateInputs] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId),
        ))
        .limit(1);

      const gateMissing: string[] = [];
      if (!gateInputs || !gateInputs.hasExistingCustomers) gateMissing.push("Confirmation that the business has existing or past customers");
      if (!gateInputs || !gateInputs.retentionGoal) gateMissing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!gateInputs || !gateInputs.businessModel) gateMissing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!gateInputs || !gateInputs.reachableAudience) gateMissing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      if (gateMissing.length > 0) {
        return res.status(422).json({
          error: "INPUT_GATE_LOCKED",
          message: "Retention Engine requires existing customers and a reachable audience. Analysis cannot run without these foundational inputs.",
          gateStatus: "locked",
          missingRequirements: gateMissing,
        });
      }

      const [retentionMetrics] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId),
        ))
        .limit(1);

      const baseJourney = req.body.customerJourneyData || {
        touchpoints: [],
        avgTimeToConversion: null,
        repeatPurchaseRate: null,
        churnRate: null,
        customerLifetimeValue: null,
        retentionWindowDays: null,
        engagementDecayRate: null,
      };

      if (retentionMetrics) {
        if (retentionMetrics.repeatPurchaseRate != null && baseJourney.repeatPurchaseRate == null) {
          baseJourney.repeatPurchaseRate = retentionMetrics.repeatPurchaseRate;
        }
        if (retentionMetrics.customerLifespan != null && baseJourney.retentionWindowDays == null) {
          baseJourney.retentionWindowDays = retentionMetrics.customerLifespan * 30;
        }
        if (retentionMetrics.averageOrderValue != null && retentionMetrics.purchaseFrequency != null && retentionMetrics.customerLifespan != null) {
          const estimatedLTV = retentionMetrics.averageOrderValue * retentionMetrics.purchaseFrequency * retentionMetrics.customerLifespan;
          if (baseJourney.customerLifetimeValue == null) {
            baseJourney.customerLifetimeValue = estimatedLTV;
          }
        }
        if (retentionMetrics.refundRate != null && baseJourney.churnRate == null) {
          baseJourney.churnRate = Math.min(retentionMetrics.refundRate * 2, 1);
        }
      }

      const input = {
        customerJourneyData: baseJourney,
        offerStructure: req.body.offerStructure || {
          offerName: null,
          coreOutcome: null,
          deliverables: [],
          proofStrength: null,
          riskReducers: [],
          mechanismDescription: null,
        },
        purchaseMotivations: Array.isArray(req.body.purchaseMotivations) ? req.body.purchaseMotivations : [],
        postPurchaseObjections: Array.isArray(req.body.postPurchaseObjections) ? req.body.postPurchaseObjections : [],
        campaignId,
        accountId,
        hasManualRetentionMetrics: !!retentionMetrics,
      };

      const result = await runRetentionEngine(input);

      const [snapshot] = await db.insert(retentionSnapshots).values({
        accountId,
        campaignId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        result: JSON.stringify(result),
        layerResults: JSON.stringify({
          retentionLoops: result.retentionLoops,
          churnRiskFlags: result.churnRiskFlags,
          ltvExpansionPaths: result.ltvExpansionPaths,
          upsellTriggers: result.upsellTriggers,
          guardResult: result.guardResult,
        }),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.dataReliability),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      }).returning();

      await pruneOldSnapshots(db, retentionSnapshots, campaignId, 20, accountId);

      return res.json({
        success: true,
        snapshotId: snapshot.id,
        result,
      });
    } catch (error: any) {
      console.error("[RetentionEngine] Route error:", error.message);
      return res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });

  app.get("/api/strategy/retention-engine/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(retentionSnapshots)
        .where(and(
          eq(retentionSnapshots.campaignId, campaignId),
          eq(retentionSnapshots.accountId, accountId),
        ))
        .orderBy(desc(retentionSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return res.json({ found: false, snapshot: null });
      }

      return res.json({
        found: true,
        snapshot: {
          ...latest,
          result: safeJsonParse(latest.result),
          layerResults: safeJsonParse(latest.layerResults),
          structuralWarnings: safeJsonParse(latest.structuralWarnings),
          boundaryCheck: safeJsonParse(latest.boundaryCheck),
          dataReliability: safeJsonParse(latest.dataReliability),
        },
      });
    } catch (error: any) {
      console.error("[RetentionEngine] Latest route error:", error.message);
      return res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });
}
