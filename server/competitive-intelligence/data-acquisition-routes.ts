import type { Express } from "express";
import { fetchCompetitorData, fetchAllCompetitors, getCompetitorDataCoverage } from "./data-acquisition";

export function registerDataAcquisitionRoutes(app: Express) {
  app.post("/api/ci/competitors/:id/fetch-data", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const forceRefresh = req.body.forceRefresh === true;

      console.log(`[DataAcq Route] Auto-fetch for competitor ${id}, force=${forceRefresh}`);
      const result = await fetchCompetitorData(id, accountId, forceRefresh);
      res.json(result);
    } catch (error: any) {
      console.error(`[DataAcq Route] Fetch error:`, error.message);
      res.status(500).json({ error: error.message, status: "BLOCKED" });
    }
  });

  app.post("/api/ci/competitors/fetch-all", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";

      console.log(`[DataAcq Route] Fetch all competitors for account ${accountId}`);
      const results = await fetchAllCompetitors(accountId);

      const summary = {
        total: results.length,
        success: results.filter(r => r.status === "SUCCESS").length,
        partial: results.filter(r => r.status === "PARTIAL").length,
        blocked: results.filter(r => r.status === "BLOCKED").length,
        cooldown: results.filter(r => r.status === "COOLDOWN").length,
        totalPosts: results.reduce((s, r) => s + r.postsCollected, 0),
        totalComments: results.reduce((s, r) => s + r.commentsCollected, 0),
      };

      res.json({ results, summary });
    } catch (error: any) {
      console.error(`[DataAcq Route] Fetch-all error:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ci/competitors/:id/data-coverage", async (req, res) => {
    try {
      const { id } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const coverage = await getCompetitorDataCoverage(id, accountId);
      res.json(coverage);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
