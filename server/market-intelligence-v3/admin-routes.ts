import type { Express, Request, Response } from "express";
import { db } from "../db";
import { ciCompetitors, ciCompetitorPosts, ciCompetitorComments, miFetchJobs, miSnapshots } from "@shared/schema";
import { eq, sql, desc, and, gte, count } from "drizzle-orm";
import { getQueueDiagnostics } from "./fetch-orchestrator";

export function registerAdminMarketRoutes(app: Express) {

  app.get("/api/admin/market/overview", async (_req: Request, res: Response) => {
    try {
      const [competitorCount] = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitors);
      const [activeCompetitorCount] = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitors).where(eq(ciCompetitors.isActive, true));
      const [postCount] = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorPosts);
      const [commentCount] = await db.select({ count: sql<number>`count(*)` }).from(ciCompetitorComments);
      const [snapshotCount] = await db.select({ count: sql<number>`count(*)` }).from(miSnapshots);

      const queueDiagnostics = await getQueueDiagnostics();

      const recentJobs = await db.select({
        id: miFetchJobs.id,
        accountId: miFetchJobs.accountId,
        campaignId: miFetchJobs.campaignId,
        status: miFetchJobs.status,
        collectionMode: miFetchJobs.collectionMode,
        dataStatus: miFetchJobs.dataStatus,
        totalPostsFetched: miFetchJobs.totalPostsFetched,
        totalCommentsFetched: miFetchJobs.totalCommentsFetched,
        competitorCount: miFetchJobs.competitorCount,
        createdAt: miFetchJobs.createdAt,
        completedAt: miFetchJobs.completedAt,
        error: miFetchJobs.error,
      }).from(miFetchJobs)
        .orderBy(desc(miFetchJobs.createdAt))
        .limit(20);

      return res.json({
        inventory: {
          totalCompetitors: Number(competitorCount.count),
          activeCompetitors: Number(activeCompetitorCount.count),
          totalPosts: Number(postCount.count),
          totalComments: Number(commentCount.count),
          totalSnapshots: Number(snapshotCount.count),
        },
        queue: queueDiagnostics,
        recentJobs,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/market/competitors", async (_req: Request, res: Response) => {
    try {
      const competitors = await db.select({
        id: ciCompetitors.id,
        name: ciCompetitors.name,
        platform: ciCompetitors.platform,
        profileLink: ciCompetitors.profileLink,
        isActive: ciCompetitors.isActive,
        accountId: ciCompetitors.accountId,
        campaignId: ciCompetitors.campaignId,
        createdAt: ciCompetitors.createdAt,
        analysisLevel: ciCompetitors.analysisLevel,
        enrichmentStatus: ciCompetitors.enrichmentStatus,
        fetchMethod: ciCompetitors.fetchMethod,
        postsCollected: ciCompetitors.postsCollected,
        commentsCollected: ciCompetitors.commentsCollected,
        dataFreshnessDays: ciCompetitors.dataFreshnessDays,
        lastCheckedAt: ciCompetitors.lastCheckedAt,
      }).from(ciCompetitors)
        .orderBy(desc(ciCompetitors.createdAt))
        .limit(100);

      const enriched = competitors.map(c => ({
        ...c,
        postCount: c.postsCollected || 0,
        commentCount: c.commentsCollected || 0,
      }));

      return res.json({ competitors: enriched });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/market/freshness", async (_req: Request, res: Response) => {
    try {
      const latestSnapshots = await db.select({
        accountId: miSnapshots.accountId,
        campaignId: miSnapshots.campaignId,
        dataStatus: miSnapshots.dataStatus,
        createdAt: miSnapshots.createdAt,
        competitorHash: miSnapshots.competitorHash,
      }).from(miSnapshots)
        .orderBy(desc(miSnapshots.createdAt))
        .limit(50);

      const freshnessEntries = latestSnapshots.map(s => {
        const ageMs = Date.now() - new Date(s.createdAt!).getTime();
        const ageHours = Math.round(ageMs / 3600000 * 10) / 10;
        const isFresh = ageHours <= 24;
        return {
          accountId: s.accountId,
          campaignId: s.campaignId,
          dataStatus: s.dataStatus,
          ageHours,
          isFresh,
          createdAt: s.createdAt,
        };
      });

      return res.json({ freshness: freshnessEntries });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/market/crawler-status", async (_req: Request, res: Response) => {
    try {
      const queueDiagnostics = await getQueueDiagnostics();

      const runningJobs = await db.select({
        id: miFetchJobs.id,
        accountId: miFetchJobs.accountId,
        campaignId: miFetchJobs.campaignId,
        collectionMode: miFetchJobs.collectionMode,
        totalPostsFetched: miFetchJobs.totalPostsFetched,
        totalCommentsFetched: miFetchJobs.totalCommentsFetched,
        competitorCount: miFetchJobs.competitorCount,
        createdAt: miFetchJobs.createdAt,
      }).from(miFetchJobs)
        .where(eq(miFetchJobs.status, "RUNNING"))
        .orderBy(desc(miFetchJobs.createdAt));

      const queuedJobs = await db.select({
        id: miFetchJobs.id,
        accountId: miFetchJobs.accountId,
        campaignId: miFetchJobs.campaignId,
        createdAt: miFetchJobs.createdAt,
      }).from(miFetchJobs)
        .where(eq(miFetchJobs.status, "QUEUED"))
        .orderBy(miFetchJobs.createdAt);

      const last24h = new Date(Date.now() - 86400000);
      const [completedCount] = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
        .where(and(eq(miFetchJobs.status, "COMPLETED"), gte(miFetchJobs.completedAt, last24h)));
      const [failedCount] = await db.select({ count: sql<number>`count(*)` }).from(miFetchJobs)
        .where(and(eq(miFetchJobs.status, "FAILED"), gte(miFetchJobs.completedAt, last24h)));

      return res.json({
        queue: queueDiagnostics,
        running: runningJobs,
        queued: queuedJobs,
        last24h: {
          completed: Number(completedCount.count),
          failed: Number(failedCount.count),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
