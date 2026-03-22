import type { Express, Request, Response } from "express";
import { AgentOperator } from "./index";

export function registerAgentRoutes(app: Express) {
  app.post("/api/agent/run-stream", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

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
        { accountId: (req as any).accountId || "default", campaignId: String(campaignId) },
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
      } catch {}
    }
  });

  console.log("[AgentRoutes] Routes registered: POST /api/agent/run-stream");
}
