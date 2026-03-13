import type { Express, Request, Response } from "express";
import { db } from "../../db";
import {
  channelSelectionSnapshots,
  audienceSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  offerSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { runChannelSelectionEngine } from "./engine";
import { ENGINE_VERSION } from "./constants";
import { pruneOldSnapshots, checkValidationSession } from "../../engine-hardening";
import { validateEngineDependencies, logDependencyCheck } from "../dependency-validation";

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

export function registerChannelSelectionRoutes(app: Express) {
  app.post("/api/strategy/channel-selection/analyze", async (req: Request, res: Response) => {
    try {
      const { campaignId, accountId = "default", validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "channel-selection", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      const [latestAudience] = await db.select().from(audienceSnapshots)
        .where(and(
          eq(audienceSnapshots.campaignId, campaignId),
          eq(audienceSnapshots.accountId, accountId),
        ))
        .orderBy(desc(audienceSnapshots.createdAt))
        .limit(1);

      if (!latestAudience) {
        return res.status(400).json({
          error: "MISSING_DEPENDENCY",
          message: "Audience snapshot required — run audience engine first",
        });
      }

      const [latestAwareness] = await db.select().from(awarenessSnapshots)
        .where(and(
          eq(awarenessSnapshots.campaignId, campaignId),
          eq(awarenessSnapshots.accountId, accountId),
          eq(awarenessSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(awarenessSnapshots.createdAt))
        .limit(1);

      const [latestPersuasion] = await db.select().from(persuasionSnapshots)
        .where(and(
          eq(persuasionSnapshots.campaignId, campaignId),
          eq(persuasionSnapshots.accountId, accountId),
          eq(persuasionSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(persuasionSnapshots.createdAt))
        .limit(1);

      const [latestOffer] = await db.select().from(offerSnapshots)
        .where(and(
          eq(offerSnapshots.campaignId, campaignId),
          eq(offerSnapshots.accountId, accountId),
          eq(offerSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(offerSnapshots.createdAt))
        .limit(1);

      const [latestValidation] = await db.select().from(strategyValidationSnapshots)
        .where(and(
          eq(strategyValidationSnapshots.campaignId, campaignId),
          eq(strategyValidationSnapshots.accountId, accountId),
          eq(strategyValidationSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(strategyValidationSnapshots.createdAt))
        .limit(1);

      const [latestBudget] = await db.select().from(budgetGovernorSnapshots)
        .where(and(
          eq(budgetGovernorSnapshots.campaignId, campaignId),
          eq(budgetGovernorSnapshots.accountId, accountId),
          eq(budgetGovernorSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(budgetGovernorSnapshots.createdAt))
        .limit(1);

      const awarenessRoute = latestAwareness ? safeJsonParse(latestAwareness.primaryRoute) : null;
      const persuasionRoute = latestPersuasion ? safeJsonParse(latestPersuasion.primaryRoute) : null;
      const offerPrimary = latestOffer ? safeJsonParse(latestOffer.primaryOffer) : null;
      const validationResult = latestValidation ? safeJsonParse(latestValidation.result) : null;
      const budgetResult = latestBudget ? safeJsonParse(latestBudget.result) : null;

      const audienceInput = {
        audienceSegments: safeJsonParse(latestAudience.audienceSegments) || [],
        emotionalDrivers: safeJsonParse(latestAudience.emotionalDrivers) || [],
        awarenessLevel: latestAudience.awarenessLevel || null,
        maturityIndex: safeNumber(latestAudience.maturityIndex, 0.5),
        audiencePains: safeJsonParse(latestAudience.audiencePains) || [],
        desireMap: safeJsonParse(latestAudience.desireMap) || {},
        objectionMap: safeJsonParse(latestAudience.objectionMap) || {},
      };

      const awarenessInput = awarenessRoute ? {
        entryMechanismType: awarenessRoute?.entryMechanismType || "pain_entry",
        targetReadinessStage: awarenessRoute?.targetReadinessStage || "problem_aware",
        triggerClass: awarenessRoute?.triggerClass || "hidden_cost",
        trustRequirement: awarenessRoute?.trustRequirement || "medium",
        funnelCompatibility: awarenessRoute?.funnelCompatibility || "standard",
        awarenessStrengthScore: safeNumber(awarenessRoute?.awarenessStrengthScore || latestAwareness?.awarenessStrengthScore, 0.5),
        frictionNotes: awarenessRoute?.frictionNotes || [],
      } : null;

      const persuasionInput = persuasionRoute ? {
        persuasionMode: persuasionRoute?.persuasionMode || "trust_building",
        primaryInfluenceDrivers: persuasionRoute?.primaryInfluenceDrivers || [],
        objectionPriorities: persuasionRoute?.objectionPriorities || [],
        trustSequence: persuasionRoute?.trustSequence || [],
        persuasionStrengthScore: safeNumber(persuasionRoute?.persuasionStrengthScore || latestPersuasion?.persuasionStrengthScore, 0.5),
      } : null;

      const offerInput = offerPrimary ? {
        offerName: offerPrimary?.offerName || "Unknown",
        coreOutcome: offerPrimary?.coreOutcome || "",
        offerStrengthScore: safeNumber(latestOffer?.offerStrengthScore || offerPrimary?.offerStrengthScore, 0.5),
        frictionLevel: safeNumber(offerPrimary?.frictionLevel, 0.5),
        deliverables: offerPrimary?.deliverables || [],
        riskNotes: offerPrimary?.riskNotes || [],
      } : null;

      const budgetInput = budgetResult ? {
        testBudgetMin: safeNumber(budgetResult?.testBudgetRange?.min, 0),
        testBudgetMax: safeNumber(budgetResult?.testBudgetRange?.max, 500),
        scaleBudgetMin: safeNumber(budgetResult?.scaleBudgetRange?.min, 0),
        scaleBudgetMax: safeNumber(budgetResult?.scaleBudgetRange?.max, 2000),
        expansionPermission: !!budgetResult?.expansionPermission,
        killFlag: !!budgetResult?.killFlag,
      } : null;

      const validationInput = validationResult ? {
        claimConfidenceScore: safeNumber(validationResult?.claimConfidenceScore, 0.5),
        evidenceStrength: safeNumber(validationResult?.evidenceStrength, 0.5),
        validationState: validationResult?.validationState || "provisional",
        assumptionFlags: validationResult?.assumptionFlags || [],
      } : null;

      const depCheck = validateEngineDependencies("channel-selection");
      logDependencyCheck("channel-selection", depCheck);
      if (!depCheck.valid) {
        return res.status(503).json({
          error: "Engine dependency mismatch",
          mismatches: depCheck.mismatches,
          warnings: depCheck.warnings,
        });
      }

      const result = runChannelSelectionEngine(
        audienceInput,
        awarenessInput,
        persuasionInput,
        offerInput,
        budgetInput,
        validationInput,
      );

      const snapshotId = `cs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await db.insert(channelSelectionSnapshots).values({
        id: snapshotId,
        accountId,
        campaignId,
        validationSnapshotId: latestValidation?.id || null,
        budgetSnapshotId: latestBudget?.id || null,
        engineVersion: ENGINE_VERSION,
        status: result.status,
        statusMessage: result.statusMessage,
        result: JSON.stringify(result),
        layerResults: JSON.stringify(result.layerResults),
        structuralWarnings: JSON.stringify(result.structuralWarnings),
        boundaryCheck: JSON.stringify(result.boundaryCheck),
        dataReliability: JSON.stringify(result.dataReliability),
        confidenceScore: result.confidenceScore,
        executionTimeMs: result.executionTimeMs,
      });

      await pruneOldSnapshots(db, channelSelectionSnapshots, campaignId, 20, accountId);

      console.log(`[ChannelSelection-V${ENGINE_VERSION}] Analysis complete for campaign ${campaignId} | status=${result.status} confidence=${result.confidenceScore.toFixed(2)} primary=${result.primaryChannel.channelName}`);

      return res.json({
        snapshotId,
        ...result,
      });
    } catch (error: any) {
      console.error("[ChannelSelection] Error:", error.message);
      return res.status(500).json({ error: "Channel selection analysis failed", details: error.message });
    }
  });

  app.get("/api/strategy/channel-selection/latest", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      const [latest] = await db.select().from(channelSelectionSnapshots)
        .where(and(
          eq(channelSelectionSnapshots.campaignId, campaignId),
          eq(channelSelectionSnapshots.accountId, accountId),
        ))
        .orderBy(desc(channelSelectionSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return res.status(404).json({ error: "No channel selection snapshot found for this campaign" });
      }

      return res.json({
        snapshotId: latest.id,
        status: latest.status,
        statusMessage: latest.statusMessage,
        result: safeJsonParse(latest.result),
        layerResults: safeJsonParse(latest.layerResults),
        structuralWarnings: safeJsonParse(latest.structuralWarnings),
        boundaryCheck: safeJsonParse(latest.boundaryCheck),
        dataReliability: safeJsonParse(latest.dataReliability),
        confidenceScore: latest.confidenceScore,
        executionTimeMs: latest.executionTimeMs,
        engineVersion: latest.engineVersion,
        createdAt: latest.createdAt,
      });
    } catch (error: any) {
      console.error("[ChannelSelection] Latest fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch channel selection snapshot", details: error.message });
    }
  });
}
