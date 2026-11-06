import type { Express, Request, Response } from "express";
import { resolveAccountId, AuthConfigurationError } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError, AuthenticationRequiredError } from "../auth-helpers";
import { StrategyExperienceService, ProposalApplyError } from "./service";

function handleAuthOrOwnershipError(error: any, res: Response): boolean {
  if (
    error instanceof AuthConfigurationError ||
    error instanceof AuthenticationRequiredError ||
    error?.name === "AuthConfigurationError" ||
    error?.name === "AuthenticationRequiredError" ||
    error?.message?.includes("Authentication required")
  ) {
    res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: error.message || "Authentication required" });
    return true;
  }
  return handleOwnershipError(error, res);
}

export function registerStrategyExperienceRoutes(app: Express) {
  // 1. Generate / Regenerate Strategy
  app.post("/api/strategy/generate/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const {
        forceRefresh,
        recoveryMode,
        fromStage,
        expectedOfferingName,
        expectedTargetMarket,
        expectedContextFingerprint,
      } = req.body || {};

      await assertCampaignBelongsTo(accountId, campaignId);

      const effectiveRecoveryMode:
        | "REUSE_EVIDENCE_RECOMPUTE_ANALYSIS"
        | "REBUILD_FROM_STORED_EVIDENCE"
        | "FULL_REFRESH" =
        recoveryMode === "REBUILD_FROM_STORED_EVIDENCE"
          ? "REBUILD_FROM_STORED_EVIDENCE"
          : recoveryMode === "REUSE_EVIDENCE_RECOMPUTE_ANALYSIS"
          ? "REUSE_EVIDENCE_RECOMPUTE_ANALYSIS"
          : recoveryMode === "FULL_REFRESH"
          ? "FULL_REFRESH"
          : forceRefresh === false
          ? "REUSE_EVIDENCE_RECOMPUTE_ANALYSIS"
          : "FULL_REFRESH";

      const effectiveForceRefresh =
        effectiveRecoveryMode === "FULL_REFRESH" && forceRefresh !== false;

      const result = await StrategyExperienceService.generateStrategy(campaignId, accountId, {
        forceRefresh: effectiveForceRefresh,
        recoveryMode: effectiveRecoveryMode,
        fromStage,
        expectedOfferingName,
        expectedTargetMarket,
        expectedContextFingerprint,
      });

      if (result.status === "ALREADY_RUNNING" && effectiveForceRefresh) {
        return res.status(409).json(result);
      }
      if (result.status === "CANNOT_CONTINUE") {
        return res.status(409).json(result);
      }

      return res.json(result);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Generate error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to start strategy generation" });
    }
  });

  // 1b. Get Continuation Plan for an Interrupted Run
  app.get("/api/strategy/continuation-plan/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");
      const fromStage = (req.query?.fromStage as any) || undefined;

      await assertCampaignBelongsTo(accountId, campaignId);

      const plan = await StrategyExperienceService.getContinuationPlan(campaignId, accountId, {
        fromStage,
      });
      return res.json(plan);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Continuation plan error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to resolve continuation plan" });
    }
  });

  // 1c. Continue Interrupted Pipeline
  app.post("/api/strategy/continue/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");
      const {
        fromStage,
        expectedOfferingName,
        expectedTargetMarket,
        expectedContextFingerprint,
      } = req.body || {};

      await assertCampaignBelongsTo(accountId, campaignId);

      const result = await StrategyExperienceService.continuePipeline(campaignId, accountId, {
        fromStage,
        expectedOfferingName,
        expectedTargetMarket,
        expectedContextFingerprint,
      });

      if (result.status === "CANNOT_CONTINUE" || result.status === "ALREADY_COMPLETED") {
        return res.status(409).json(result);
      }

      return res.json(result);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Continue pipeline error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to continue pipeline" });
    }
  });

  // 2. Get Live Run Progress
  app.get("/api/strategy/runs/:runId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { runId } = req.params;

      const progress = await StrategyExperienceService.getRunProgress(runId, accountId);
      if (!progress) {
        return res.status(404).json({ error: "Orchestration run not found" });
      }

      return res.json(progress);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Run status error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get run progress" });
    }
  });

  // 3. Get Active Strategy & Version Details
  app.get("/api/strategy/active/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).userId || (req as any).user?.id || (req as any).session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Authenticated user context required" });
      }

      await assertCampaignBelongsTo(accountId, campaignId);

      const activeStrategy = await StrategyExperienceService.getActiveStrategy(campaignId, accountId, userId);
      return res.json(activeStrategy);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Active strategy error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get active strategy" });
    }
  });

  // 4. Get Historical Strategy Versions
  app.get("/api/strategy/history/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;

      await assertCampaignBelongsTo(accountId, campaignId);

      const history = await StrategyExperienceService.getStrategyHistory(campaignId, accountId);
      return res.json({ history });
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] History error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get strategy history" });
    }
  });

  // 5. Get Strategy Change Proposals
  app.get("/api/strategy/change-proposals/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).userId || (req as any).user?.id || (req as any).session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Authenticated user context required" });
      }

      await assertCampaignBelongsTo(accountId, campaignId);

      const activeStrategy = await StrategyExperienceService.getActiveStrategy(campaignId, accountId, userId);
      return res.json({ proposals: activeStrategy.pendingProposals });
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Proposals error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get change proposals" });
    }
  });

  // 6. Approve Strategic Change Proposal
  app.post("/api/strategy/change-proposals/:proposalId/approve", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { proposalId } = req.params;
      const options = req.body?.options || req.body || {};

      const result = await StrategyExperienceService.approveProposal(String(proposalId), accountId, options);
      return res.json(result);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      if (error instanceof ProposalApplyError || error?.name === "ProposalApplyError" || typeof error?.statusCode === "number") {
        return res.status(error.statusCode || 422).json({
          error: error.code || "PROPOSAL_APPLY_REJECTED",
          code: error.code || "PROPOSAL_APPLY_REJECTED",
          message: error.message,
          status: error.code === "PROPOSAL_STALE" ? "STALE" : "REJECTED",
        });
      }
      console.error("[StrategyExperience] Approve proposal error:", error.message);
      if (error.message?.includes("PROPOSAL_STALE")) {
        return res.status(409).json({ error: error.message, code: "PROPOSAL_STALE", status: "STALE" });
      }
      return res.status(500).json({ error: error.message || "Failed to approve proposal" });
    }
  });

  // 7. Reject Strategic Change Proposal
  app.post("/api/strategy/change-proposals/:proposalId/reject", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { proposalId } = req.params;
      const { reason } = req.body || {};

      const result = await StrategyExperienceService.rejectProposal(proposalId, accountId, reason);
      return res.json(result);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Reject proposal error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to reject proposal" });
    }
  });

  // 8. Get Strategy Activity Timeline
  app.get("/api/strategy/activity/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;

      await assertCampaignBelongsTo(accountId, campaignId);

      const activities = await StrategyExperienceService.getStrategyActivity(campaignId, accountId);
      return res.json({ activities });
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Activity error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get strategy activity" });
    }
  });

  // 9. Acknowledge Strategic Change / Dismiss UPDATED Badge
  app.post("/api/strategy/acknowledge-change/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).userId || (req as any).user?.id || (req as any).session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Authenticated user context required" });
      }
      const { authority, laneId, strategyRootId, rootBundleVersion } = req.body || {};

      if (!authority || !strategyRootId || rootBundleVersion === undefined) {
        return res.status(400).json({ error: "Missing required fields: authority, strategyRootId, rootBundleVersion" });
      }

      await assertCampaignBelongsTo(accountId, campaignId);

      const result = await StrategyExperienceService.acknowledgeChange({
        accountId,
        campaignId,
        userId,
        strategyRootId,
        rootBundleVersion: Number(rootBundleVersion),
        authority,
        laneId: laneId || null,
      });

      return res.json(result);
    } catch (error: any) {
      if (handleAuthOrOwnershipError(error, res)) return;
      console.error("[StrategyExperience] Acknowledge change error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to record acknowledgement" });
    }
  });
}
