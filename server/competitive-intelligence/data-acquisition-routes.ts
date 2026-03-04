import type { Express } from "express";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { fetchCompetitorData, fetchAllCompetitors, getCompetitorDataCoverage } from "./data-acquisition";
import { acquireStickySession, releaseStickySession } from "./proxy-pool-manager";
import * as crypto from "crypto";

async function validateCompetitorOwnership(competitorId: string, accountId: string, campaignId: string): Promise<boolean> {
  const [comp] = await db.select({ id: ciCompetitors.id }).from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));
  return !!comp;
}

export function registerDataAcquisitionRoutes(app: Express) {
  app.post("/api/ci/competitors/:id/fetch-data", async (req, res) => {
    let proxyCtx: ReturnType<typeof acquireStickySession> = null;
    try {
      const { id } = req.params;
      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const owned = await validateCompetitorOwnership(id, accountId, campaignId);
      if (!owned) {
        return res.status(403).json({ error: "Competitor does not belong to this campaign" });
      }

      const competitorHash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
      proxyCtx = acquireStickySession(accountId, campaignId, competitorHash);
      if (proxyCtx) {
        console.log(`[DataAcq Route] Pool session acquired: session=${proxyCtx.session.sessionId}`);
      }

      const forceRefresh = req.body.forceRefresh === true;
      console.log(`[DataAcq Route] Auto-fetch for competitor ${id}, campaign=${campaignId}, force=${forceRefresh}`);
      const result = await fetchCompetitorData(id, accountId, forceRefresh, proxyCtx ?? undefined);
      res.json(result);
    } catch (error: any) {
      console.error(`[DataAcq Route] Fetch error:`, error.message);
      res.status(500).json({ error: error.message, status: "BLOCKED" });
    } finally {
      if (proxyCtx) releaseStickySession(proxyCtx);
    }
  });

  app.post("/api/ci/competitors/fetch-all", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      console.log(`[DataAcq Route] Fetch all competitors for campaign ${campaignId}`);
      const results = await fetchAllCompetitors(accountId, campaignId);

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
