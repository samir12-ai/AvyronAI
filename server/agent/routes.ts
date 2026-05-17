import type { Express, Request, Response } from "express";
import { AgentOperator } from "./index";
import { registerDualAnalysisRoutes } from "./dual-analysis-routes";

import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
export function registerAgentRoutes(app: Express) {
  registerDualAnalysisRoutes(app);
  app.post("/api/agent/run-stream", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // P0-4 (launch-closure Wave 1): body-supplied campaignId must belong
      // to the authed account, otherwise the agent would create snapshots
      // and run multi-engine work attributed to attacker.accountId but
      // pointed at victim.campaignId — cross-tenant pollution.
      try { await assertCampaignBelongsTo(accountId, String(campaignId)); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      const send = (event: object) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      send({ type: "started", campaignId, totalEngines: 15 });

      await new AgentOperator().runWithStream(
        { accountId, campaignId: String(campaignId) },
        send
      );

      if (!res.writableEnded) res.end();
    } catch (error: any) {
      console.error("[AgentRoutes] run-stream error:", error.message);
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
          res.end();
        }
      } catch (writeErr) {
        // Seal #15: surface write-after-end failures on the SSE channel. The
        // client has already disconnected — we cannot recover, but operators
        // must see this rather than have it vanish into the void.
        console.error("[AgentRoutes] SSE_ERROR_WRITE_FAILED", { error: (writeErr as Error)?.message });
      }
    }
  });

  console.log("[AgentRoutes] Routes registered: POST /api/agent/run-stream");
}
