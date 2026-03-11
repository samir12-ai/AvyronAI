import type { Express, Request, Response } from "express";
import { db } from "../../db";
import { budgetGovernorSnapshots, strategyValidationSnapshots, offerSnapshots, funnelSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runBudgetGovernorEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { pruneOldSnapshots, checkValidationSession } from "../../engine-hardening";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function registerBudgetGovernorRoutes(app: Express) {
  app.post("/api/strategy/budget-governor/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", validationSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "budget-governor", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      let validationResult: any = null;
      let resolvedValidationSnapshotId: string | null = validationSnapshotId || null;
      if (validationSnapshotId) {
        const [valSnapshot] = await db.select().from(strategyValidationSnapshots)
          .where(and(
            eq(strategyValidationSnapshots.id, validationSnapshotId),
            eq(strategyValidationSnapshots.campaignId, campaignId),
            eq(strategyValidationSnapshots.accountId, accountId),
          ))
          .limit(1);
        if (valSnapshot) {
          validationResult = safeJsonParse(valSnapshot.result);
        }
      }

      if (!validationResult) {
        const [latestValidation] = await db.select().from(strategyValidationSnapshots)
          .where(and(
            eq(strategyValidationSnapshots.campaignId, campaignId),
            eq(strategyValidationSnapshots.accountId, accountId),
            eq(strategyValidationSnapshots.status, "COMPLETE"),
          ))
          .orderBy(desc(strategyValidationSnapshots.createdAt))
          .limit(1);
        if (latestValidation) {
          validationResult = safeJsonParse(latestValidation.result);
          resolvedValidationSnapshotId = latestValidation.id;
        }
      }

      let offerData: any = null;
      const [latestOffer] = await db.select().from(offerSnapshots)
        .where(and(
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
          eq(offerSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(offerSnapshots.createdAt))
        .limit(1);
      if (latestOffer) {
        offerData = {
          offerStrengthScore: latestOffer.offerStrengthScore,
          primaryOffer: safeJsonParse(latestOffer.primaryOffer),
        };
      }

      let funnelData: any = null;
      const [latestFunnel] = await db.select().from(funnelSnapshots)
        .where(and(
          eq(funnelSnapshots.campaignId, campaignId),
          eq(funnelSnapshots.accountId, accountId),
          eq(funnelSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(funnelSnapshots.createdAt))
        .limit(1);
      if (latestFunnel) {
        funnelData = {
          funnelStrengthScore: latestFunnel.funnelStrengthScore,
          primaryFunnel: safeJsonParse(latestFunnel.primaryFunnel),
          frictionMap: safeJsonParse(latestFunnel.frictionMap),
        };
      }

      const input = {
        offerStrength: offerData?.offerStrengthScore ?? 0.5,
        offerProofScore: offerData?.primaryOffer?.proofLayer?.proofStrength ?? 0.4,
        offerCompleteness: offerData?.primaryOffer?.completeness?.complete ?? false,
        funnelStrengthScore: funnelData?.funnelStrengthScore ?? 0.5,
        funnelFrictionScore: funnelData?.frictionMap?.totalFriction ?? 0.5,
        funnelProjections: {
          expectedConversionRate: funnelData?.primaryFunnel?.eligibilityScore ?? 0.05,
          expectedCPA: req.body.expectedCPA ?? 25,
          expectedROAS: req.body.expectedROAS ?? 2.0,
        },
        channelRisk: req.body.channelRisk ?? 0.4,
        validationConfidence: validationResult?.confidenceScore ?? 0.5,
        validationState: validationResult?.validationState ?? "unknown",
        marketIntensity: req.body.marketIntensity ?? 0.5,
        competitorSpendEstimate: req.body.competitorSpendEstimate ?? 0,
        audienceSize: req.body.audienceSize ?? "medium",
        currentBudget: req.body.currentBudget ?? 0,
        historicalCPA: req.body.historicalCPA ?? null,
        historicalROAS: req.body.historicalROAS ?? null,
      };

      const result = runBudgetGovernorEngine(input);

      const snapshotId = crypto.randomUUID();
      await db.insert(budgetGovernorSnapshots).values({
        id: snapshotId,
        accountId,
        campaignId,
        validationSnapshotId: resolvedValidationSnapshotId,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        result: JSON.stringify(result),
        layerResults: JSON.stringify(result.layerDiagnostics),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.riskAssessment),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      });

      await pruneOldSnapshots(db, budgetGovernorSnapshots, campaignId, 20, accountId);

      console.log(`[BudgetGovernor] Campaign ${campaignId} | Decision: ${result.decision.action} | Confidence: ${(result.confidenceScore * 100).toFixed(0)}% | Kill: ${result.killFlag} | Time: ${result.executionTimeMs}ms`);

      return res.json({
        success: true,
        snapshotId,
        result,
      });
    } catch (error: any) {
      console.error(`[BudgetGovernor] Error:`, error);
      return res.status(500).json({ error: "Budget Governor engine failed", details: error.message });
    }
  });

  app.get("/api/strategy/budget-governor/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [latest] = await db.select().from(budgetGovernorSnapshots)
        .where(and(
          eq(budgetGovernorSnapshots.campaignId, campaignId),
          eq(budgetGovernorSnapshots.accountId, accountId),
        ))
        .orderBy(desc(budgetGovernorSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return res.json({ success: true, snapshot: null });
      }

      return res.json({
        success: true,
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
      console.error(`[BudgetGovernor] Latest fetch error:`, error);
      return res.status(500).json({ error: "Failed to fetch latest budget governor snapshot", details: error.message });
    }
  });
}
