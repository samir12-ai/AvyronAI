import type { Express, Request, Response } from "express";
import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
import { StrategyExperienceService } from "./service";

export function registerStrategyExperienceRoutes(app: Express) {
  // 1. Generate / Regenerate Strategy
  app.post("/api/strategy/generate/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const { forceRefresh } = req.body || {};

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const result = await StrategyExperienceService.generateStrategy(campaignId, accountId, forceRefresh !== false);

      if (result.status === "ALREADY_RUNNING") {
        return res.status(409).json(result);
      }

      return res.json(result);
    } catch (error: any) {
      console.error("[StrategyExperience] Generate error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to start strategy generation" });
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
      console.error("[StrategyExperience] Run status error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get run progress" });
    }
  });

  // 3. Get Active Strategy & Version Details
  app.get("/api/strategy/active/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).user?.id || (req as any).session?.userId || (req.query?.userId as string) || "user_buffer_tester";

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const activeStrategy = await StrategyExperienceService.getActiveStrategy(campaignId, accountId, userId);
      return res.json(activeStrategy);
    } catch (error: any) {
      console.error("[StrategyExperience] Active strategy error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get active strategy" });
    }
  });

  // 4. Get Historical Strategy Versions
  app.get("/api/strategy/history/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const history = await StrategyExperienceService.getStrategyHistory(campaignId, accountId);
      return res.json({ history });
    } catch (error: any) {
      console.error("[StrategyExperience] History error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get strategy history" });
    }
  });

  // 5. Get Strategy Change Proposals
  app.get("/api/strategy/change-proposals/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).user?.id || (req as any).session?.userId || (req.query?.userId as string) || "user_buffer_tester";

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const activeStrategy = await StrategyExperienceService.getActiveStrategy(campaignId, accountId, userId);
      return res.json({ proposals: activeStrategy.pendingProposals });
    } catch (error: any) {
      console.error("[StrategyExperience] Proposals error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get change proposals" });
    }
  });

  // 6. Approve Strategic Change Proposal
  app.post("/api/strategy/change-proposals/:proposalId/approve", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { proposalId } = req.params;

      const result = await StrategyExperienceService.approveProposal(proposalId, accountId, req.body?.options);
      return res.json(result);
    } catch (error: any) {
      console.error("[StrategyExperience] Approve proposal error:", error.message);
      if (error.message?.includes("PROPOSAL_STALE")) {
        return res.status(409).json({ error: error.message, status: "STALE" });
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
      console.error("[StrategyExperience] Reject proposal error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to reject proposal" });
    }
  });

  // 8. Get Strategy Activity Timeline
  app.get("/api/strategy/activity/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const activities = await StrategyExperienceService.getStrategyActivity(campaignId, accountId);
      return res.json({ activities });
    } catch (error: any) {
      console.error("[StrategyExperience] Activity error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to get strategy activity" });
    }
  });

  // 9. Acknowledge Strategic Change / Dismiss UPDATED Badge
  app.post("/api/strategy/acknowledge-change/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const userId = (req as any).user?.id || (req as any).session?.userId || req.body?.userId || "user_buffer_tester";
      const { authority, laneId, strategyRootId, rootBundleVersion } = req.body || {};

      if (!authority || !strategyRootId || rootBundleVersion === undefined) {
        return res.status(400).json({ error: "Missing required fields: authority, strategyRootId, rootBundleVersion" });
      }

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

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
      console.error("[StrategyExperience] Acknowledge change error:", error.message);
      return res.status(500).json({ error: error.message || "Failed to record acknowledgement" });
    }
  });
}
