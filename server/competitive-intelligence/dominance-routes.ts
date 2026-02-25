import type { Express } from "express";
import { db } from "../db";
import { dominanceAnalyses, dominanceModifications, ciCompetitors } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import { aiChat } from "../ai-client";
import crypto from "crypto";

function computeInputsHash(inputs: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(inputs)).digest("hex").substring(0, 16);
}

function safeParse(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return val; }
}

export function registerDominanceRoutes(app: Express) {

  app.post("/api/dominance/analyze", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const { competitorId, topContentData, contentEvidence, blueprintId } = req.body;
      const campaignId = req.headers["x-campaign-id"] as string || req.body.campaignId || null;
      const location = req.body.location || "Dubai, UAE";

      if (!competitorId) {
        return res.status(400).json({ success: false, error: "competitorId is required" });
      }

      const allCompetitors = await db.select().from(ciCompetitors)
        .where(eq(ciCompetitors.accountId, accountId));

      const competitor = allCompetitors.find(c => c.id === competitorId);
      if (!competitor) {
        return res.status(404).json({ success: false, error: "Competitor not found" });
      }

      const competitorsWithEvidence = allCompetitors.filter(c => {
        return c.profileLink || c.name;
      });
      if (competitorsWithEvidence.length < 1) {
        return res.status(400).json({
          success: false,
          error: "COMPETITOR_GATE_FAILED",
          message: "At least 1 competitor with a profile URL is required before running Dominance Engine. Add competitors in the Intelligence tab.",
          currentCount: competitorsWithEvidence.length,
          requiredCount: 1,
        });
      }

      const contentItems = topContentData || generateSimulatedTopContent(competitor);

      const evidenceItems = contentEvidence || contentItems.map((item: any, i: number) => ({
        rank: item.rank || i + 1,
        selectionReason: item.selectionReason || `Top-performing ${item.type || 'content'} by engagement metrics`,
        metricsSnapshot: {
          views: item.estimatedViews || null,
          likes: item.estimatedEngagement || null,
          comments: item.estimatedComments || null,
          shares: item.estimatedShares || null,
          saves: item.estimatedSaves || null,
        },
        confidenceScore: item.confidenceScore || (item.estimatedViews ? 0.7 : 0.3),
        evidenceSource: item.evidenceSource || (item.estimatedViews ? "metrics" : "manual/video"),
      }));

      const inputsHash = computeInputsHash({ competitorId, contentItems, location });

      const previousVersions = await db.select().from(dominanceAnalyses)
        .where(and(
          eq(dominanceAnalyses.accountId, accountId),
          eq(dominanceAnalyses.competitorName, competitor.name || "")
        ))
        .orderBy(desc(dominanceAnalyses.runVersion));
      const nextVersion = (previousVersions.length > 0 && previousVersions[0].runVersion)
        ? previousVersions[0].runVersion + 1 : 1;

      const [analysis] = await db.insert(dominanceAnalyses).values({
        accountId,
        campaignId,
        location,
        blueprintId: blueprintId || null,
        runVersion: nextVersion,
        inputsHash,
        competitorName: competitor.name || "Unknown",
        competitorUrl: competitor.profileLink || "",
        topContent: JSON.stringify(contentItems),
        contentEvidence: JSON.stringify(evidenceItems),
        evidenceSource: contentEvidence ? "provided" : "simulated",
        status: "processing",
      }).returning();

      await logAudit(accountId, "DOMINANCE_RUN", {
        details: {
          analysisId: analysis.id,
          runId: analysis.runId,
          runVersion: nextVersion,
          competitorName: competitor.name,
          campaignId,
          location,
          contentItemCount: contentItems.length,
          inputsHash,
        },
      });

      let dissectionResult: any, weaknessResult: any, strategyResult: any, deltaResult: any;
      let fallbackReasons: string[] = [];

      try {
        dissectionResult = await runContentDissection(competitor, contentItems, evidenceItems, location);
      } catch (err: any) {
        fallbackReasons.push(`Content dissection: ${err.message}`);
        dissectionResult = getFallbackDissection(contentItems);
      }

      try {
        weaknessResult = await runWeaknessDetection(competitor, contentItems, dissectionResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Weakness detection: ${err.message}`);
        weaknessResult = getFallbackWeakness(contentItems);
      }

      try {
        strategyResult = await runDominanceStrategy(competitor, dissectionResult, weaknessResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Dominance strategy: ${err.message}`);
        strategyResult = getFallbackStrategy();
      }

      try {
        deltaResult = await runDominanceDelta(competitor, dissectionResult, strategyResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Dominance delta: ${err.message}`);
        deltaResult = getFallbackDelta();
      }

      const hasFallback = fallbackReasons.length > 0;
      const finalStatus = hasFallback ? "partial" : "completed";

      const [updated] = await db.update(dominanceAnalyses)
        .set({
          contentDissection: JSON.stringify(dissectionResult),
          weaknessDetection: JSON.stringify(weaknessResult),
          dominanceStrategy: JSON.stringify(strategyResult),
          dominanceDelta: JSON.stringify(deltaResult),
          fallbackReason: hasFallback ? JSON.stringify(fallbackReasons) : null,
          fallbackAcknowledged: false,
          status: finalStatus,
          modelUsed: "gpt-5.2",
          updatedAt: new Date(),
        })
        .where(eq(dominanceAnalyses.id, analysis.id))
        .returning();

      await logAudit(accountId, "DOMINANCE_ANALYSIS_COMPLETED", {
        details: {
          analysisId: analysis.id,
          runId: analysis.runId,
          competitorName: competitor.name,
          contentItemsAnalyzed: contentItems.length,
          status: finalStatus,
          fallbackReasons: hasFallback ? fallbackReasons : null,
          runVersion: nextVersion,
        },
      });

      res.json({
        success: true,
        analysis: {
          ...updated,
          contentDissection: dissectionResult,
          weaknessDetection: weaknessResult,
          dominanceStrategy: strategyResult,
          dominanceDelta: deltaResult,
          topContent: contentItems,
          contentEvidence: evidenceItems,
          fallbackReasons: hasFallback ? fallbackReasons : null,
        },
        hasFallback,
      });
    } catch (error: any) {
      console.error("[Dominance] Analysis error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/retry", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });
      if (analysis.status !== "partial" && analysis.status !== "failed") {
        return res.status(400).json({ success: false, error: "Only partial/failed analyses can be retried" });
      }

      await logAudit(accountId, "DOMINANCE_RETRY", {
        details: { analysisId: id, competitorName: analysis.competitorName, previousStatus: analysis.status },
      });

      const competitor = {
        name: analysis.competitorName,
        profileLink: analysis.competitorUrl,
        platform: "instagram",
        businessType: "competitor",
      };

      const contentItems = safeParse(analysis.topContent) || [];
      const evidenceItems = safeParse(analysis.contentEvidence) || [];
      const location = analysis.location || "Dubai, UAE";

      let dissectionResult: any, weaknessResult: any, strategyResult: any, deltaResult: any;
      let fallbackReasons: string[] = [];

      try {
        dissectionResult = await runContentDissection(competitor, contentItems, evidenceItems, location);
      } catch (err: any) {
        fallbackReasons.push(`Content dissection: ${err.message}`);
        dissectionResult = getFallbackDissection(contentItems);
      }
      try {
        weaknessResult = await runWeaknessDetection(competitor, contentItems, dissectionResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Weakness detection: ${err.message}`);
        weaknessResult = getFallbackWeakness(contentItems);
      }
      try {
        strategyResult = await runDominanceStrategy(competitor, dissectionResult, weaknessResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Dominance strategy: ${err.message}`);
        strategyResult = getFallbackStrategy();
      }
      try {
        deltaResult = await runDominanceDelta(competitor, dissectionResult, strategyResult, location);
      } catch (err: any) {
        fallbackReasons.push(`Dominance delta: ${err.message}`);
        deltaResult = getFallbackDelta();
      }

      const hasFallback = fallbackReasons.length > 0;

      const [updated] = await db.update(dominanceAnalyses)
        .set({
          contentDissection: JSON.stringify(dissectionResult),
          weaknessDetection: JSON.stringify(weaknessResult),
          dominanceStrategy: JSON.stringify(strategyResult),
          dominanceDelta: JSON.stringify(deltaResult),
          fallbackReason: hasFallback ? JSON.stringify(fallbackReasons) : null,
          fallbackAcknowledged: false,
          status: hasFallback ? "partial" : "completed",
          updatedAt: new Date(),
        })
        .where(eq(dominanceAnalyses.id, id))
        .returning();

      res.json({
        success: true,
        analysis: {
          ...updated,
          contentDissection: dissectionResult,
          weaknessDetection: weaknessResult,
          dominanceStrategy: strategyResult,
          dominanceDelta: deltaResult,
          topContent: contentItems,
          contentEvidence: evidenceItems,
          fallbackReasons: hasFallback ? fallbackReasons : null,
        },
        hasFallback,
      });
    } catch (error: any) {
      console.error("[Dominance] Retry error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/acknowledge-fallback", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });

      const [updated] = await db.update(dominanceAnalyses)
        .set({ fallbackAcknowledged: true, updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id))
        .returning();

      await logAudit(accountId, "DOMINANCE_FALLBACK_ACKNOWLEDGED", {
        details: { analysisId: id, competitorName: analysis.competitorName },
      });

      res.json({ success: true, fallbackAcknowledged: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dominance/analyses", requireCampaign, async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const analyses = await db.select().from(dominanceAnalyses)
        .where(eq(dominanceAnalyses.accountId, accountId))
        .orderBy(desc(dominanceAnalyses.createdAt));

      const parsed = analyses.map(a => ({
        ...a,
        topContent: safeParse(a.topContent),
        contentEvidence: safeParse(a.contentEvidence),
        contentDissection: safeParse(a.contentDissection),
        weaknessDetection: safeParse(a.weaknessDetection),
        dominanceStrategy: safeParse(a.dominanceStrategy),
        dominanceDelta: safeParse(a.dominanceDelta),
        fallbackReason: safeParse(a.fallbackReason),
      }));

      res.json({ success: true, analyses: parsed });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dominance/analyses/:id", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });

      res.json({
        success: true,
        analysis: {
          ...analysis,
          topContent: safeParse(analysis.topContent),
          contentEvidence: safeParse(analysis.contentEvidence),
          contentDissection: safeParse(analysis.contentDissection),
          weaknessDetection: safeParse(analysis.weaknessDetection),
          dominanceStrategy: safeParse(analysis.dominanceStrategy),
          dominanceDelta: safeParse(analysis.dominanceDelta),
          fallbackReason: safeParse(analysis.fallbackReason),
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/api/dominance/analyses/:id", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });

      await db.delete(dominanceModifications)
        .where(eq(dominanceModifications.analysisId, id));

      await db.delete(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      await logAudit(accountId, "DOMINANCE_DELETE", {
        details: { analysisId: id, competitorName: analysis.competitorName },
      });

      res.json({ success: true, deleted: id });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/dominance/:analysisId/modifications", requireCampaign, async (req, res) => {
    try {
      const { analysisId } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const mods = await db.select().from(dominanceModifications)
        .where(and(
          eq(dominanceModifications.analysisId, analysisId),
          eq(dominanceModifications.accountId, accountId)
        ))
        .orderBy(desc(dominanceModifications.createdAt));

      const parsed = mods.map(m => ({
        ...m,
        basePlan: safeParse(m.basePlan),
        adjustedPlan: safeParse(m.adjustedPlan),
        adjustments: safeParse(m.adjustments),
        overallImpact: safeParse(m.overallImpact),
        diffSummary: safeParse(m.diffSummary),
        previousBasePlan: safeParse(m.previousBasePlan),
      }));

      res.json({ success: true, modifications: parsed });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/generate-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { basePlan } = req.body;

      if (!basePlan) {
        return res.status(400).json({ success: false, error: "basePlan is required (the current orchestrator plan)" });
      }

      const [analysis] = await db.select().from(dominanceAnalyses)
        .where(and(eq(dominanceAnalyses.id, id), eq(dominanceAnalyses.accountId, accountId)));

      if (!analysis) return res.status(404).json({ success: false, error: "Analysis not found" });
      if (analysis.status !== "completed" && analysis.status !== "partial") {
        return res.status(400).json({ success: false, error: "Analysis must be completed before generating modifications" });
      }

      if (analysis.status === "partial" && !analysis.fallbackAcknowledged) {
        return res.status(400).json({
          success: false,
          error: "FALLBACK_NOT_ACKNOWLEDGED",
          message: "This analysis used fallback data. You must acknowledge the fallback or retry the analysis before generating plan modifications.",
        });
      }

      const dominanceStrategy = safeParse(analysis.dominanceStrategy);
      const weaknessDetection = safeParse(analysis.weaknessDetection);
      const dominanceDelta = safeParse(analysis.dominanceDelta);

      let modifications: any;
      let fallbackUsed = false;
      let modFallbackReason: string | null = null;

      try {
        modifications = await runPlanModificationGeneration(
          basePlan,
          dominanceStrategy,
          weaknessDetection,
          dominanceDelta,
          analysis.competitorName || "Unknown",
          analysis.location || "Dubai, UAE"
        );
      } catch (err: any) {
        modifications = getFallbackModifications(basePlan);
        fallbackUsed = true;
        modFallbackReason = err.message;
      }

      const [mod] = await db.insert(dominanceModifications).values({
        analysisId: id,
        accountId,
        basePlan: JSON.stringify(basePlan),
        adjustedPlan: JSON.stringify(modifications.adjustedPlan || modifications),
        diffSummary: JSON.stringify(modifications.diffSummary || null),
        adjustments: JSON.stringify(modifications.adjustments || []),
        overallImpact: JSON.stringify(modifications.overallImpactAssessment || null),
        competitorTargeted: analysis.competitorName,
        lifecycleStatus: "DRAFT",
        previousBasePlan: JSON.stringify(basePlan),
        rollbackAvailable: true,
        fallbackUsed,
        fallbackReason: modFallbackReason,
      }).returning();

      const [updatedMod] = await db.update(dominanceModifications)
        .set({ lifecycleStatus: "REVIEW_REQUIRED", updatedAt: new Date() })
        .where(eq(dominanceModifications.id, mod.id))
        .returning();

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "pending_approval", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id));

      await logAudit(accountId, "DOMINANCE_MOD_PROPOSED", {
        details: {
          analysisId: id,
          modificationId: mod.id,
          competitorName: analysis.competitorName,
          adjustmentsCount: modifications.adjustments?.length || 0,
          fallbackUsed,
          lifecycleStatus: "REVIEW_REQUIRED",
        },
      });

      res.json({
        success: true,
        modification: {
          ...updatedMod,
          basePlan,
          adjustedPlan: modifications.adjustedPlan || modifications,
          adjustments: modifications.adjustments || [],
          overallImpact: modifications.overallImpactAssessment || null,
          diffSummary: modifications.diffSummary || null,
        },
        modificationStatus: "REVIEW_REQUIRED",
        fallbackUsed,
      });
    } catch (error: any) {
      console.error("[Dominance] Modification generation error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/modifications/:modId/approve", requireCampaign, async (req, res) => {
    try {
      const { modId } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const approvedBy = req.body.approvedBy || "user";

      const [mod] = await db.select().from(dominanceModifications)
        .where(and(eq(dominanceModifications.id, modId), eq(dominanceModifications.accountId, accountId)));

      if (!mod) return res.status(404).json({ success: false, error: "Modification not found" });
      if (mod.lifecycleStatus !== "REVIEW_REQUIRED") {
        return res.status(400).json({ success: false, error: `Cannot approve modification in '${mod.lifecycleStatus}' state. Must be REVIEW_REQUIRED.` });
      }

      const [updated] = await db.update(dominanceModifications)
        .set({
          lifecycleStatus: "APPROVED",
          approvedBy,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dominanceModifications.id, modId))
        .returning();

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "approved", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, mod.analysisId));

      await logAudit(accountId, "DOMINANCE_MOD_APPROVED", {
        details: { modificationId: modId, analysisId: mod.analysisId, approvedBy, competitorTargeted: mod.competitorTargeted },
      });

      res.json({ success: true, lifecycleStatus: "APPROVED", modification: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/modifications/:modId/apply", requireCampaign, async (req, res) => {
    try {
      const { modId } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const [mod] = await db.select().from(dominanceModifications)
        .where(and(eq(dominanceModifications.id, modId), eq(dominanceModifications.accountId, accountId)));

      if (!mod) return res.status(404).json({ success: false, error: "Modification not found" });
      if (mod.lifecycleStatus !== "APPROVED") {
        return res.status(400).json({ success: false, error: `Cannot apply modification in '${mod.lifecycleStatus}' state. Must be APPROVED first.` });
      }

      const [updated] = await db.update(dominanceModifications)
        .set({ lifecycleStatus: "APPLIED", updatedAt: new Date() })
        .where(eq(dominanceModifications.id, modId))
        .returning();

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "applied", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, mod.analysisId));

      await logAudit(accountId, "DOMINANCE_MOD_APPLIED", {
        details: { modificationId: modId, analysisId: mod.analysisId, competitorTargeted: mod.competitorTargeted },
      });

      res.json({ success: true, lifecycleStatus: "APPLIED", modification: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/modifications/:modId/reject", requireCampaign, async (req, res) => {
    try {
      const { modId } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { reason } = req.body;

      const [mod] = await db.select().from(dominanceModifications)
        .where(and(eq(dominanceModifications.id, modId), eq(dominanceModifications.accountId, accountId)));

      if (!mod) return res.status(404).json({ success: false, error: "Modification not found" });
      if (mod.lifecycleStatus !== "REVIEW_REQUIRED" && mod.lifecycleStatus !== "APPROVED") {
        return res.status(400).json({ success: false, error: `Cannot reject modification in '${mod.lifecycleStatus}' state.` });
      }

      const [updated] = await db.update(dominanceModifications)
        .set({
          lifecycleStatus: "REJECTED",
          rejectedReason: reason || "User rejected modifications",
          updatedAt: new Date(),
        })
        .where(eq(dominanceModifications.id, modId))
        .returning();

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "rejected", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, mod.analysisId));

      await logAudit(accountId, "DOMINANCE_MOD_REJECTED", {
        details: { modificationId: modId, analysisId: mod.analysisId, reason, competitorTargeted: mod.competitorTargeted },
      });

      res.json({ success: true, lifecycleStatus: "REJECTED" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/modifications/:modId/rollback", requireCampaign, async (req, res) => {
    try {
      const { modId } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const [mod] = await db.select().from(dominanceModifications)
        .where(and(eq(dominanceModifications.id, modId), eq(dominanceModifications.accountId, accountId)));

      if (!mod) return res.status(404).json({ success: false, error: "Modification not found" });
      if (mod.lifecycleStatus !== "APPLIED") {
        return res.status(400).json({ success: false, error: "Can only rollback APPLIED modifications." });
      }
      if (!mod.rollbackAvailable) {
        return res.status(400).json({ success: false, error: "No rollback data available for this modification." });
      }

      const [updated] = await db.update(dominanceModifications)
        .set({
          lifecycleStatus: "REJECTED",
          rollbackAvailable: false,
          rejectedReason: "Rolled back to previous plan version",
          updatedAt: new Date(),
        })
        .where(eq(dominanceModifications.id, modId))
        .returning();

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "rejected", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, mod.analysisId));

      await logAudit(accountId, "DOMINANCE_ROLLBACK", {
        details: { modificationId: modId, analysisId: mod.analysisId, competitorTargeted: mod.competitorTargeted },
      });

      res.json({
        success: true,
        lifecycleStatus: "REJECTED",
        restoredPlan: safeParse(mod.previousBasePlan),
        message: "Plan rolled back to previous version.",
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/approve-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const mods = await db.select().from(dominanceModifications)
        .where(and(
          eq(dominanceModifications.analysisId, id),
          eq(dominanceModifications.accountId, accountId),
          eq(dominanceModifications.lifecycleStatus, "REVIEW_REQUIRED")
        ))
        .orderBy(desc(dominanceModifications.createdAt));

      if (mods.length === 0) {
        return res.status(400).json({ success: false, error: "No pending modifications to approve for this analysis" });
      }

      const latestMod = mods[0];
      await db.update(dominanceModifications)
        .set({ lifecycleStatus: "APPROVED", approvedBy: "user", approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(dominanceModifications.id, latestMod.id));

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "approved", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id));

      await logAudit(accountId, "DOMINANCE_MODIFICATIONS_APPROVED", {
        details: { analysisId: id, modificationId: latestMod.id },
      });

      res.json({ success: true, modificationStatus: "approved", lifecycleStatus: "APPROVED" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/dominance/:id/reject-modifications", requireCampaign, async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const { reason } = req.body;

      const mods = await db.select().from(dominanceModifications)
        .where(and(
          eq(dominanceModifications.analysisId, id),
          eq(dominanceModifications.accountId, accountId),
          eq(dominanceModifications.lifecycleStatus, "REVIEW_REQUIRED")
        ))
        .orderBy(desc(dominanceModifications.createdAt));

      if (mods.length === 0) {
        return res.status(400).json({ success: false, error: "No pending modifications to reject" });
      }

      const latestMod = mods[0];
      await db.update(dominanceModifications)
        .set({ lifecycleStatus: "REJECTED", rejectedReason: reason || "User rejected", updatedAt: new Date() })
        .where(eq(dominanceModifications.id, latestMod.id));

      await db.update(dominanceAnalyses)
        .set({ modificationStatus: "rejected", updatedAt: new Date() })
        .where(eq(dominanceAnalyses.id, id));

      await logAudit(accountId, "DOMINANCE_MODIFICATIONS_REJECTED", {
        details: { analysisId: id, modificationId: latestMod.id, reason },
      });

      res.json({ success: true, modificationStatus: "rejected", lifecycleStatus: "REJECTED" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

function generateSimulatedTopContent(competitor: any): any[] {
  const platform = competitor.platform || "instagram";
  return [
    {
      rank: 1,
      type: "reel",
      description: `Top performing ${platform} reel by ${competitor.name}`,
      estimatedViews: 45000,
      estimatedEngagement: 3200,
      estimatedComments: 280,
      estimatedShares: 850,
      estimatedSaves: 620,
      contentTheme: "transformation/results",
      postingTime: "evening",
      selectionReason: "Highest engagement rate in last 30 days based on estimated metrics",
      confidenceScore: 0.65,
      evidenceSource: "estimated",
    },
    {
      rank: 2,
      type: "carousel",
      description: `High-engagement carousel post by ${competitor.name}`,
      estimatedViews: 32000,
      estimatedEngagement: 2800,
      estimatedComments: 195,
      estimatedShares: 420,
      estimatedSaves: 380,
      contentTheme: "educational/tips",
      postingTime: "morning",
      selectionReason: "Second highest saves-to-views ratio indicating high value perception",
      confidenceScore: 0.60,
      evidenceSource: "estimated",
    },
    {
      rank: 3,
      type: "single_image",
      description: `Viral single image post by ${competitor.name}`,
      estimatedViews: 28000,
      estimatedEngagement: 1950,
      estimatedComments: 150,
      estimatedShares: 310,
      estimatedSaves: 250,
      contentTheme: "social_proof/testimonial",
      postingTime: "afternoon",
      selectionReason: "Highest share velocity in the past 2 weeks",
      confidenceScore: 0.55,
      evidenceSource: "estimated",
    },
  ];
}

async function runContentDissection(competitor: any, contentItems: any[], evidenceItems: any[], location: string): Promise<any> {
  const response = await aiChat({
    model: "gpt-5.2",
    max_tokens: 6000,
    accountId: "default",
    endpoint: "dominance-analysis",
    messages: [
      {
        role: "system",
        content: `You are a competitive content intelligence engine specializing in deep content structure analysis for the ${location} market.
Your job is to dissect high-performing competitor content and extract the exact mechanics that drive performance.
Every output must follow strict JSON schema. No prose. No loose summaries. No generic advice.
Every field must include a confidence score and evidence references where available.
If evidence is missing for a field, set value to "INSUFFICIENT_DATA" instead of guessing.
Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Perform deep content dissection on the top-performing content from competitor "${competitor.name}" (${competitor.platform}) in the ${location} market.

COMPETITOR PROFILE:
- Business type: ${competitor.businessType || "unknown"}
- Objective: ${competitor.primaryObjective || "unknown"}
- Hook styles: ${competitor.hookStyles || "unknown"}
- CTA patterns: ${competitor.ctaPatterns || "unknown"}
- Messaging tone: ${competitor.messagingTone || "unknown"}

CONTENT EVIDENCE:
${JSON.stringify(evidenceItems, null, 2)}

TOP CONTENT ITEMS:
${JSON.stringify(contentItems, null, 2)}

For EACH content item, produce a dissection with this exact structure:
{
  "dissections": [
    {
      "contentRank": 1,
      "contentType": "reel|carousel|single_image|story|video",
      "evidence": {
        "selectionReason": "why this content was selected",
        "metricsSnapshot": { "views": 0, "likes": 0, "comments": 0, "shares": 0, "saves": 0 },
        "confidenceScore": 0.0-1.0,
        "evidenceSource": "metrics|manual/video|estimated"
      },
      "hookType": {
        "value": "question|promise|shock|number|authority",
        "confidence": 0.0-1.0,
        "evidenceRefs": ["reference to evidence"],
        "description": "exact hook mechanism used",
        "strengthScore": 0.0-1.0
      },
      "offerMechanics": {
        "priceVisibility": { "value": "visible|hidden|teased|anchor_comparison", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "urgencyLevel": { "value": "none|soft|medium|hard", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "scarcitySignals": { "value": ["signal1"], "confidence": 0.0-1.0, "evidenceRefs": [] },
        "socialProofType": { "value": "testimonial|numbers|authority|celebrity|peer|none", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "psychologicalTrigger": {
        "primary": { "value": "fear|authority|aspiration|result_driven|discount_driven|exclusivity|social_validation", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "secondary": { "value": "string or null", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "emotionalIntensity": 0.0-1.0
      },
      "ctaMechanics": {
        "type": { "value": "whatsapp|dm|form|soft_cta|hard_cta|link_in_bio|swipe_up", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "placement": { "value": "beginning|middle|end|throughout", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "frictionLevel": { "value": "low|medium|high", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "conversionPath": "description of the conversion flow"
      },
      "creativeStructure": {
        "format": { "value": "vertical_video|horizontal_video|square|carousel_slides|static", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "pacing": { "value": "fast|medium|slow|variable", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "framingStyle": { "value": "talking_head|b_roll|text_overlay|mixed|product_focus", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "visualQuality": { "value": "professional|semi_pro|casual|raw", "confidence": 0.0-1.0, "evidenceRefs": [] },
        "textOverlayDensity": { "value": "none|minimal|moderate|heavy", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "performanceDrivers": [
        { "value": "key reason", "confidence": 0.0-1.0, "evidenceRefs": [] }
      ]
    }
  ],
  "overallPattern": {
    "dominantHookType": { "value": "string", "confidence": 0.0-1.0, "evidenceRefs": [] },
    "dominantPsychTrigger": { "value": "string", "confidence": 0.0-1.0, "evidenceRefs": [] },
    "dominantCTA": { "value": "string", "confidence": 0.0-1.0, "evidenceRefs": [] },
    "contentFormula": "one-line summary of their winning formula"
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runWeaknessDetection(competitor: any, contentItems: any[], dissection: any, location: string): Promise<any> {
  const response = await aiChat({
    model: "gpt-5.2",
    max_tokens: 5000,
    accountId: "default",
    endpoint: "dominance-analysis",
    messages: [
      {
        role: "system",
        content: `You are a competitive weakness detection engine analyzing content in the ${location} market.
You analyze high-performing content NOT to praise it, but to find exactly what it fails to exploit.
For every strength, find the unexploited gap. For every success, find the missed opportunity.
Every field must include confidence and evidenceRefs. If data is insufficient, use "INSUFFICIENT_DATA".
Respond with valid JSON only. No prose.`,
      },
      {
        role: "user",
        content: `Analyze weaknesses in ${competitor.name}'s top-performing content for the ${location} market.

CONTENT DISSECTION:
${JSON.stringify(dissection, null, 2)}

CONTENT ITEMS:
${JSON.stringify(contentItems, null, 2)}

Produce weakness analysis with this exact structure:
{
  "weaknesses": [
    {
      "contentRank": 1,
      "strengthExploited": {
        "value": "what this content does well",
        "confidence": 0.0-1.0,
        "evidenceRefs": [],
        "category": "hook|offer|psychology|cta|creative"
      },
      "weaknessNotAddressed": {
        "value": "what this content fails to do or exploit",
        "confidence": 0.0-1.0,
        "evidenceRefs": [],
        "category": "conversion_weakness|differentiation_gap|pricing_opacity|weak_cta|positioning_gap|trust_deficit|funnel_leak",
        "severity": "low|medium|high|critical"
      },
      "opportunityVector": {
        "value": "specific action to exploit this weakness",
        "confidence": 0.0-1.0,
        "evidenceRefs": [],
        "expectedImpact": "low|medium|high",
        "implementationDifficulty": "easy|medium|hard"
      }
    }
  ],
  "globalWeaknesses": [
    {
      "pattern": { "value": "weakness pattern across all content", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "description": "detailed description",
      "exploitStrategy": "how to systematically exploit this"
    }
  ],
  "vulnerabilityScore": { "value": 0.0-1.0, "confidence": 0.0-1.0, "evidenceRefs": [] },
  "biggestOpportunity": { "value": "one-line description", "confidence": 0.0-1.0, "evidenceRefs": [] }
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runDominanceStrategy(competitor: any, dissection: any, weaknesses: any, location: string): Promise<any> {
  const response = await aiChat({
    model: "gpt-5.2",
    max_tokens: 6000,
    accountId: "default",
    endpoint: "dominance-analysis",
    messages: [
      {
        role: "system",
        content: `You are a dominance strategy engine for the ${location} market. Your goal is NOT imitation — it is controlled strategic superiority.
For every competitor strength, generate an upgraded variant. For every weakness, generate an exploitation plan.
The output must be actionable blueprints, not advice.
For each variant, explicitly answer: "How is this SUPERIOR, not SIMILAR?"
Include confidence and evidenceRefs for every key field.
Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Generate dominance strategy against ${competitor.name} for the ${location} market.

CONTENT DISSECTION:
${JSON.stringify(dissection, null, 2)}

WEAKNESS DETECTION:
${JSON.stringify(weaknesses, null, 2)}

Generate upgraded variant blueprints with this structure:
{
  "upgradedVariants": [
    {
      "targetContentRank": 1,
      "originalStrength": { "value": "what competitor did well", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "superiorityStatement": "How is this SUPERIOR, not SIMILAR? (one sentence)",
      "upgradedHookLogic": {
        "original": "their hook approach",
        "upgraded": "superior hook approach",
        "whyBetter": { "value": "reasoning", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "strongerConversionMechanics": {
        "original": "their conversion path",
        "upgraded": "superior conversion path",
        "expectedLift": { "value": "estimated improvement", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "refinedPositioning": {
        "original": "their positioning",
        "upgraded": "differentiated positioning",
        "differentiator": { "value": "what sets this apart", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "ctaOptimization": {
        "original": "their CTA",
        "upgraded": "optimized CTA",
        "frictionReduction": { "value": "how friction is reduced", "confidence": 0.0-1.0, "evidenceRefs": [] }
      },
      "structuralUpgrades": [
        {
          "timing": "e.g. second 3, slide 2",
          "action": "what to add/change",
          "reason": { "value": "why this improves performance", "confidence": 0.0-1.0, "evidenceRefs": [] }
        }
      ]
    }
  ],
  "overallDominancePlaybook": {
    "primaryStrategy": { "value": "one-line dominance strategy", "confidence": 0.0-1.0, "evidenceRefs": [] },
    "keyDifferentiators": [
      { "value": "differentiator", "confidence": 0.0-1.0, "evidenceRefs": [] }
    ],
    "expectedOutcomeRange": {
      "conservative": "X% improvement",
      "optimistic": "Y% improvement"
    },
    "implementationPriority": [
      {
        "action": "specific action",
        "impact": "high|medium|low",
        "effort": "easy|medium|hard",
        "timeline": "immediate|1_week|2_weeks|1_month"
      }
    ]
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runDominanceDelta(competitor: any, dissection: any, strategy: any, location: string): Promise<any> {
  const response = await aiChat({
    model: "gpt-5.2",
    max_tokens: 4000,
    accountId: "default",
    endpoint: "dominance-analysis",
    messages: [
      {
        role: "system",
        content: `You are a Dominance Delta calculator for the ${location} market. For each competitor content item, you compute a structured delta that proves HOW we are better, not just different.
Every delta must answer: "What is the competitor's strength? What is their gap? What is our dominance upgrade? What are the concrete implementation steps?"
No fluffy advice. Each field must include confidence and evidenceRefs.
Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Compute Dominance Delta for each content item from ${competitor.name} in the ${location} market.

DISSECTION:
${JSON.stringify(dissection, null, 2)}

STRATEGY:
${JSON.stringify(strategy, null, 2)}

Generate this exact structure:
{
  "deltas": [
    {
      "targetContentRank": 1,
      "competitorStrength": { "value": "what they excel at", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "competitorGap": { "value": "what they miss or fail at", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "dominanceUpgrade": { "value": "what we do better and why it wins", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "implementationSteps": [
        { "step": "concrete edit in hook/CTA/proof/pacing", "category": "hook|cta|proof|pacing|creative|positioning", "priority": "critical|high|medium|low" }
      ],
      "superiorityProof": "one sentence explaining how this is superior, not similar"
    }
  ],
  "overallDominanceScore": { "value": 0.0-1.0, "confidence": 0.0-1.0, "evidenceRefs": [] },
  "dominanceSummary": "How our approach is categorically superior across all items"
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function runPlanModificationGeneration(
  basePlan: any,
  dominanceStrategy: any,
  weaknessDetection: any,
  dominanceDelta: any,
  competitorName: string,
  location: string
): Promise<any> {
  const response = await aiChat({
    model: "gpt-5.2",
    max_tokens: 5000,
    accountId: "default",
    endpoint: "dominance-analysis",
    messages: [
      {
        role: "system",
        content: `You are a strategic plan modification engine for the ${location} market. You take a base orchestrator plan and propose controlled modifications based on competitive dominance intelligence.
Every modification must be clearly marked, justified, and presented as a side-by-side comparison.
Include a diff summary for each change. Include confidence and evidenceRefs.
No silent overrides. Every change is explicit and requires approval. Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: `Given the competitive dominance analysis against "${competitorName}" in the ${location} market, propose modifications to the base orchestrator plan.

BASE PLAN:
${JSON.stringify(basePlan, null, 2)}

DOMINANCE STRATEGY:
${JSON.stringify(dominanceStrategy, null, 2)}

WEAKNESS DETECTION:
${JSON.stringify(weaknessDetection, null, 2)}

DOMINANCE DELTA:
${JSON.stringify(dominanceDelta, null, 2)}

Generate a modification proposal:
{
  "adjustments": [
    {
      "section": "which plan section is affected",
      "originalValue": "what the base plan says",
      "adjustedValue": "what the dominance-adjusted plan says",
      "reason": { "value": "why this change improves competitive positioning", "confidence": 0.0-1.0, "evidenceRefs": [] },
      "impactLevel": "low|medium|high|critical",
      "competitiveAdvantage": "specific advantage gained",
      "diffSummary": "concise summary of what changed"
    }
  ],
  "basePlanSummary": "one-line summary of original plan",
  "adjustedPlanSummary": "one-line summary of adjusted plan",
  "adjustedPlan": {},
  "diffSummary": "overall diff summary",
  "overallImpactAssessment": {
    "riskLevel": { "value": "low|medium|high", "confidence": 0.0-1.0, "evidenceRefs": [] },
    "confidenceScore": 0.0-1.0,
    "expectedLift": { "value": "estimated improvement description", "confidence": 0.0-1.0, "evidenceRefs": [] }
  },
  "competitorTargeted": "${competitorName}"
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

function getFallbackDissection(contentItems: any[]): any {
  return {
    dissections: contentItems.map((item, i) => ({
      contentRank: item.rank || i + 1,
      contentType: item.type || "unknown",
      evidence: {
        selectionReason: item.selectionReason || "INSUFFICIENT_DATA",
        metricsSnapshot: { views: item.estimatedViews || null, likes: item.estimatedEngagement || null, comments: null, shares: item.estimatedShares || null, saves: null },
        confidenceScore: 0,
        evidenceSource: "fallback",
      },
      hookType: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [], description: "AI analysis unavailable — manual review required", strengthScore: 0 },
      offerMechanics: {
        priceVisibility: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        urgencyLevel: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        scarcitySignals: { value: [], confidence: 0, evidenceRefs: [] },
        socialProofType: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      },
      psychologicalTrigger: {
        primary: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        secondary: { value: null, confidence: 0, evidenceRefs: [] },
        emotionalIntensity: 0,
      },
      ctaMechanics: {
        type: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        placement: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        frictionLevel: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        conversionPath: "AI analysis unavailable",
      },
      creativeStructure: {
        format: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        pacing: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        framingStyle: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        visualQuality: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
        textOverlayDensity: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      },
      performanceDrivers: [{ value: "AI analysis unavailable — manual dissection required", confidence: 0, evidenceRefs: [] }],
    })),
    overallPattern: {
      dominantHookType: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      dominantPsychTrigger: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      dominantCTA: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      contentFormula: "AI analysis unavailable — manual review required",
    },
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackWeakness(contentItems: any[]): any {
  return {
    weaknesses: contentItems.map((item, i) => ({
      contentRank: item.rank || i + 1,
      strengthExploited: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [], category: "unknown" },
      weaknessNotAddressed: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [], category: "unknown", severity: "unknown" },
      opportunityVector: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [], expectedImpact: "unknown", implementationDifficulty: "unknown" },
    })),
    globalWeaknesses: [],
    vulnerabilityScore: { value: 0, confidence: 0, evidenceRefs: [] },
    biggestOpportunity: { value: "AI analysis unavailable — manual review required", confidence: 0, evidenceRefs: [] },
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackStrategy(): any {
  return {
    upgradedVariants: [],
    overallDominancePlaybook: {
      primaryStrategy: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
      keyDifferentiators: [],
      expectedOutcomeRange: { conservative: "INSUFFICIENT_DATA", optimistic: "INSUFFICIENT_DATA" },
      implementationPriority: [],
    },
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackDelta(): any {
  return {
    deltas: [],
    overallDominanceScore: { value: 0, confidence: 0, evidenceRefs: [] },
    dominanceSummary: "AI analysis unavailable — manual dominance assessment required",
    _fallback: true,
    _reason: "AI model call failed",
  };
}

function getFallbackModifications(basePlan: any): any {
  return {
    adjustments: [],
    basePlanSummary: "Original plan",
    adjustedPlanSummary: "INSUFFICIENT_DATA — AI modification generation unavailable",
    adjustedPlan: basePlan,
    diffSummary: "No modifications generated — AI fallback active",
    overallImpactAssessment: {
      riskLevel: { value: "unknown", confidence: 0, evidenceRefs: [] },
      confidenceScore: 0,
      expectedLift: { value: "INSUFFICIENT_DATA", confidence: 0, evidenceRefs: [] },
    },
    competitorTargeted: "unknown",
    _fallback: true,
    _reason: "AI model call failed",
  };
}
