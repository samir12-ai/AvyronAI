import type { Express, Request, Response } from "express";
import { resolveAccountId } from "../auth";
import { scrapeReviewsForCompetitor, scrapeReviewsForCampaign } from "./reviews-scraper";
import { scrapeTiktokForCompetitor, ingestTiktokPosts, type TiktokPost } from "./tiktok-scraper";
import { db } from "../db";
import { ciCompetitors } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function validateCompetitorOwnership(competitorId: string, accountId: string, campaignId: string): Promise<boolean> {
  const [comp] = await db.select({ id: ciCompetitors.id }).from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId)));
  return !!comp;
}

export function registerReviewsTiktokRoutes(app: Express) {
  app.post("/api/ci/reviews/:competitorId/scrape", async (req: Request, res: Response) => {
    try {
      const { competitorId } = req.params;
      const accountId = resolveAccountId(req);
      const { campaignId } = req.body;

      if (!campaignId) return res.status(400).json({ error: "campaignId required" });

      const owned = await validateCompetitorOwnership(competitorId, accountId, campaignId);
      if (!owned) return res.status(403).json({ error: "Competitor not found or access denied" });

      const result = await scrapeReviewsForCompetitor(competitorId, accountId, campaignId);
      res.json({ success: !result.error, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/reviews/scrape-campaign", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.body;

      if (!campaignId) return res.status(400).json({ error: "campaignId required" });

      const results = await scrapeReviewsForCampaign(accountId, campaignId);
      const totalFetched = results.reduce((s, r) => s + r.reviewsFetched, 0);
      const totalInserted = results.reduce((s, r) => s + r.reviewsInserted, 0);
      res.json({ success: true, competitors: results.length, totalFetched, totalInserted, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/tiktok/:competitorId/scrape", async (req: Request, res: Response) => {
    try {
      const { competitorId } = req.params;
      const accountId = resolveAccountId(req);
      const { campaignId } = req.body;

      if (!campaignId) return res.status(400).json({ error: "campaignId required" });

      const owned = await validateCompetitorOwnership(competitorId, accountId, campaignId);
      if (!owned) return res.status(403).json({ error: "Competitor not found or access denied" });

      const result = await scrapeTiktokForCompetitor(competitorId, accountId, campaignId);
      res.json({ success: !result.error, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/tiktok/:competitorId/ingest", async (req: Request, res: Response) => {
    try {
      const { competitorId } = req.params;
      const accountId = resolveAccountId(req);
      const { campaignId, posts } = req.body;

      if (!campaignId) return res.status(400).json({ error: "campaignId required" });
      if (!Array.isArray(posts) || posts.length === 0) return res.status(400).json({ error: "posts array required (each: { postId, caption, hookText?, likes?, timestamp? })" });

      const owned = await validateCompetitorOwnership(competitorId, accountId, campaignId);
      if (!owned) return res.status(403).json({ error: "Competitor not found or access denied" });

      const sanitized: TiktokPost[] = posts.map((p: any) => ({
        postId: String(p.postId || p.id || `manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`),
        caption: String(p.caption || p.text || "").trim(),
        hookText: p.hookText ? String(p.hookText).trim() : undefined,
        likes: typeof p.likes === "number" ? p.likes : undefined,
        comments: typeof p.comments === "number" ? p.comments : undefined,
        shares: typeof p.shares === "number" ? p.shares : undefined,
        views: typeof p.views === "number" ? p.views : undefined,
        hashtags: Array.isArray(p.hashtags) ? p.hashtags.map(String) : [],
        permalink: p.permalink ? String(p.permalink) : undefined,
        timestamp: p.timestamp ? new Date(p.timestamp) : undefined,
      })).filter(p => p.caption.length > 0);

      const { inserted } = await ingestTiktokPosts(competitorId, accountId, sanitized);
      res.json({ success: true, received: sanitized.length, inserted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[ReviewsTiktok] Routes registered: reviews scrape/campaign, tiktok scrape/ingest");
}
