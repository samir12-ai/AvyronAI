import type { Express, Request, Response } from "express";
import { getActiveRoot, invalidateDownstreamOnRegeneration } from "./shared/strategy-root";

export function registerStrategyRootRoutes(app: Express) {
  app.get("/api/strategy-root/active", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const root = await getActiveRoot(campaignId, accountId);

      if (!root) {
        return res.json({ exists: false });
      }

      res.json({
        exists: true,
        id: root.id,
        runId: root.runId,
        rootHash: root.rootHash,
        primaryAxis: root.primaryAxis,
        contrastAxisText: root.contrastAxisText,
        approvedMechanism: safeJsonParse(root.approvedMechanism),
        approvedAudiencePains: safeJsonParse(root.approvedAudiencePains),
        approvedDesires: safeJsonParse(root.approvedDesires),
        approvedTransformation: root.approvedTransformation,
        approvedClaim: root.approvedClaim,
        approvedPromise: root.approvedPromise,
        miSnapshotId: root.miSnapshotId,
        audienceSnapshotId: root.audienceSnapshotId,
        positioningSnapshotId: root.positioningSnapshotId,
        differentiationSnapshotId: root.differentiationSnapshotId,
        mechanismSnapshotId: root.mechanismSnapshotId,
        status: root.status,
        createdAt: root.createdAt,
      });
    } catch (error: any) {
      console.error("[StrategyRoot] Active fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch strategy root" });
    }
  });

  console.log("[StrategyRoot] Routes registered: GET /api/strategy-root/active");
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}
