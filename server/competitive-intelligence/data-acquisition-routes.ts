import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getCompetitorDataCoverage } from "./data-acquisition";

async function validateCompetitorOwnership(competitorId: string, accountId: string, campaignId: string): Promise<boolean> {
  const [comp] = await db.select({ id: ciCompetitors.id }).from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));
  return !!comp;
}

export function registerDataAcquisitionRoutes(app: Express) {
  app.post("/api/ci/competitors/:id/fetch-data", async (_req, res) => {
    return res.status(410).json({ error: "DEPRECATED: Direct competitor fetch removed. All data collection now flows through the queue-based Two-Speed system. Use POST /api/ci/mi-v3/fetch-job to trigger collection via the global job queue." });
  });

  app.post("/api/ci/competitors/fetch-all", async (_req, res) => {
    return res.status(410).json({ error: "DEPRECATED: Batch fetch removed. All data collection now flows through the queue-based Two-Speed system. Use POST /api/ci/mi-v3/fetch-job to trigger collection via the global job queue." });
  });

  app.get("/api/ci/competitors/:id/data-coverage", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const owned = await validateCompetitorOwnership(id, accountId, campaignId);
      if (!owned) {
        return res.status(403).json({ error: "Competitor does not belong to this campaign" });
      }

      const coverage = await getCompetitorDataCoverage(id, accountId);
      res.json(coverage);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
