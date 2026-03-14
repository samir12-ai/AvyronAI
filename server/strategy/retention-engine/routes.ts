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

      const [retentionData] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId),
        ))
        .limit(1);

      const gateMissing: string[] = [];
      if (!retentionData || !retentionData.totalCustomers || retentionData.totalCustomers <= 0) {
        gateMissing.push("Total customers acquired (last 30–90 days)");
      }
      if (!retentionData || retentionData.returningCustomers == null) {
        gateMissing.push("Returning customers count");
      }
      if (!retentionData || !retentionData.totalPurchases || retentionData.totalPurchases <= 0) {
        gateMissing.push("Total purchases/orders");
      }
      if (!retentionData || ![30, 60, 90].includes(retentionData.dataWindowDays || 0)) {
        gateMissing.push("Time window selection (30, 60, or 90 days)");
      }
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

      const baseJourney = req.body.customerJourneyData || {
        touchpoints: [],
        avgTimeToConversion: null,
        repeatPurchaseRate: null,
        churnRate: null,
        customerLifetimeValue: null,
        retentionWindowDays: null,
        engagementDecayRate: null,
      };

      if (retentionData) {
        const tc = retentionData.totalCustomers || 0;
        const tp = retentionData.totalPurchases || 0;
        const rc = retentionData.returningCustomers || 0;
        const aov = retentionData.averageOrderValue || 0;
        const rfc = retentionData.refundCount || 0;
        const dw = retentionData.dataWindowDays || 30;

        const derivedRPR = tc > 0 ? Math.min(rc / tc, 1) : (retentionData.repeatPurchaseRate || 0);
        const derivedPF = tc > 0 ? tp / tc : (retentionData.purchaseFrequency || 1);
        const derivedRefundRate = tp > 0 ? Math.min(rfc / tp, 1) : (retentionData.refundRate || 0);
        const monthsInWindow = Math.max(dw / 30, 1);
        const estLifespanMonths = derivedRPR > 0.1 ? Math.round(1 / (1 - derivedRPR) * monthsInWindow) : 6;
        const annualFreq = derivedPF * (12 / monthsInWindow);
        const derivedLTV = aov * annualFreq * (estLifespanMonths / 12);
        const derivedChurnRisk = Math.min(1 - derivedRPR + (derivedRefundRate * 0.3), 1);

        if (baseJourney.repeatPurchaseRate == null) baseJourney.repeatPurchaseRate = derivedRPR;
        if (baseJourney.retentionWindowDays == null) baseJourney.retentionWindowDays = dw;
        if (baseJourney.customerLifetimeValue == null) baseJourney.customerLifetimeValue = derivedLTV;
        if (baseJourney.churnRate == null) baseJourney.churnRate = derivedChurnRisk;

        (baseJourney as any).rawInputs = {
          totalCustomers: tc,
          totalPurchases: tp,
          returningCustomers: rc,
          averageOrderValue: aov,
          refundCount: rfc,
          monthlyCustomers: retentionData.monthlyCustomers || 0,
          dataWindowDays: dw,
        };
        (baseJourney as any).derivedMetrics = {
          repeatPurchaseRate: Math.round(derivedRPR * 1000) / 1000,
          purchaseFrequency: Math.round(derivedPF * 100) / 100,
          refundRate: Math.round(derivedRefundRate * 1000) / 1000,
          estimatedLTV: Math.round(derivedLTV * 100) / 100,
          churnRiskEstimate: Math.round(derivedChurnRisk * 1000) / 1000,
          estimatedLifespanMonths: estLifespanMonths,
        };
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
        hasManualRetentionMetrics: !!retentionData,
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
