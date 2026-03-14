import type { Express, Request, Response } from "express";
import { runOrchestrator, getOrchestratorStatus, getLatestOrchestratorRun } from "./index";
import { loadSystemContext, buildSystemPrompt } from "./agent-context";
import { db } from "../db";
import {
  strategicPlans,
  requiredWork,
  calendarEntries,
  studioItems,
  planApprovals,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export function registerOrchestratorV2Routes(app: Express) {
  app.post("/api/orchestrator/run", async (req: Request, res: Response) => {
    try {
      const { campaignId, forceRefresh, resumeFromEngine } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const accountId = "default";

      res.json({
        message: "Orchestrator started",
        status: "RUNNING",
        campaignId,
      });

      runOrchestrator({
        accountId,
        campaignId: String(campaignId),
        forceRefresh: forceRefresh || false,
        resumeFromEngine,
      }).then(result => {
        console.log(`[OrchestratorV2] Run complete: ${result.status} | ${result.completedEngines.length} engines | Plan: ${result.planId || "none"}`);
      }).catch(err => {
        console.error(`[OrchestratorV2] Run failed:`, err.message);
      });
    } catch (error: any) {
      console.error("[OrchestratorV2] Start error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orchestrator/status/:jobId", async (req: Request, res: Response) => {
    try {
      const status = await getOrchestratorStatus(req.params.jobId);
      if (!status) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orchestrator/latest/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = "default";
      const job = await getLatestOrchestratorRun(accountId, req.params.campaignId);
      if (!job) {
        return res.json({ hasRun: false });
      }
      res.json({
        hasRun: true,
        id: job.id,
        status: job.status,
        planId: job.planId,
        durationMs: job.durationMs,
        sections: job.sectionStatuses ? JSON.parse(job.sectionStatuses) : [],
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/plans/active/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = "default";
      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, req.params.campaignId),
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (!plan) {
        return res.json({ hasPlan: false });
      }

      const planData = plan.planJson ? JSON.parse(plan.planJson) : null;

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.planId, plan.id))
        .limit(1);

      const calendarStats = await db
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`count(case when status IN ('PENDING','DRAFT') then 1 end)`,
          completed: sql<number>`count(case when status IN ('COMPLETED','PUBLISHED') then 1 end)`,
        })
        .from(calendarEntries)
        .where(eq(calendarEntries.planId, plan.id));

      const studioStats = await db
        .select({
          total: sql<number>`count(*)`,
          draft: sql<number>`count(case when status = 'DRAFT' then 1 end)`,
          ready: sql<number>`count(case when status = 'READY' then 1 end)`,
          approved: sql<number>`count(case when status = 'APPROVED' then 1 end)`,
          published: sql<number>`count(case when status = 'PUBLISHED' then 1 end)`,
        })
        .from(studioItems)
        .where(eq(studioItems.planId, plan.id));

      res.json({
        hasPlan: true,
        plan: {
          id: plan.id,
          status: plan.status,
          executionStatus: plan.executionStatus,
          summary: plan.planSummary,
          emergencyStopped: plan.emergencyStopped,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          sections: planData,
        },
        requiredWork: work ? {
          id: work.id,
          periodDays: work.periodDays,
          totalPieces: work.totalContentPieces,
          reels: { required: work.totalReels, perWeek: work.reelsPerWeek },
          posts: { required: work.totalPosts, perWeek: work.postsPerWeek },
          stories: { required: work.totalStories, perDay: work.storiesPerDay },
          carousels: { required: work.totalCarousels, perWeek: work.carouselsPerWeek },
          videos: { required: work.totalVideos, perWeek: work.videosPerWeek },
          generated: work.generatedCount || 0,
          ready: work.readyCount || 0,
          scheduled: work.scheduledCount || 0,
          published: work.publishedCount || 0,
          failed: work.failedCount || 0,
          remaining: (work.totalContentPieces || 0) - (work.generatedCount || 0) - (work.readyCount || 0) - (work.publishedCount || 0),
        } : null,
        calendar: {
          total: Number(calendarStats[0]?.total) || 0,
          pending: Number(calendarStats[0]?.pending) || 0,
          completed: Number(calendarStats[0]?.completed) || 0,
        },
        studio: {
          total: Number(studioStats[0]?.total) || 0,
          draft: Number(studioStats[0]?.draft) || 0,
          ready: Number(studioStats[0]?.ready) || 0,
          approved: Number(studioStats[0]?.approved) || 0,
          published: Number(studioStats[0]?.published) || 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/approve", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(eq(strategicPlans.id, planId))
        .limit(1);

      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (plan.status !== "DRAFT" && plan.status !== "READY_FOR_REVIEW") {
        return res.status(400).json({ error: `Plan is ${plan.status}, not approvable` });
      }

      await db.update(strategicPlans)
        .set({ status: "APPROVED", updatedAt: new Date() })
        .where(eq(strategicPlans.id, planId));

      await db.insert(planApprovals).values({
        planId,
        accountId: plan.accountId,
        decision: "APPROVED",
        reason: req.body.reason || "Approved by user",
        decidedBy: "client",
      });

      res.json({ success: true, status: "APPROVED" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/reject", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const { reason } = req.body;

      await db.update(strategicPlans)
        .set({ status: "REJECTED", updatedAt: new Date() })
        .where(eq(strategicPlans.id, planId));

      await db.insert(planApprovals).values({
        planId,
        accountId: "default",
        decision: "REJECTED",
        reason: reason || "Rejected by user",
        decidedBy: "client",
      });

      res.json({ success: true, status: "REJECTED" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/system-context/:campaignId", async (req: Request, res: Response) => {
    try {
      const context = await loadSystemContext("default", req.params.campaignId);
      res.json(context);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/required-work/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = "default";
      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, req.params.campaignId),
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (!plan) return res.json({ hasWork: false });

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.planId, plan.id))
        .limit(1);

      if (!work) return res.json({ hasWork: false });

      const todayStr = new Date().toISOString().split("T")[0];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      const todayEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, plan.id),
            eq(calendarEntries.scheduledDate, todayStr)
          )
        );

      const weekEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, plan.id),
            sql`${calendarEntries.scheduledDate} >= ${todayStr}`,
            sql`${calendarEntries.scheduledDate} <= ${weekEndStr}`
          )
        );

      const pendingToday = todayEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");
      const pendingWeek = weekEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");

      res.json({
        hasWork: true,
        planId: plan.id,
        planStatus: plan.status,
        totalPieces: work.totalContentPieces,
        generated: work.generatedCount || 0,
        ready: work.readyCount || 0,
        published: work.publishedCount || 0,
        remaining: (work.totalContentPieces || 0) - (work.generatedCount || 0) - (work.readyCount || 0) - (work.publishedCount || 0),
        todayWork: pendingToday.map(e => ({
          id: e.id,
          contentType: e.contentType,
          scheduledTime: e.scheduledTime,
          title: e.title,
          status: e.status,
        })),
        weekWork: pendingWeek.map(e => ({
          id: e.id,
          contentType: e.contentType,
          scheduledDate: e.scheduledDate,
          scheduledTime: e.scheduledTime,
          title: e.title,
          status: e.status,
        })),
        breakdown: {
          reels: { required: work.totalReels, perWeek: work.reelsPerWeek },
          posts: { required: work.totalPosts, perWeek: work.postsPerWeek },
          stories: { required: work.totalStories, perDay: work.storiesPerDay },
          carousels: { required: work.totalCarousels, perWeek: work.carouselsPerWeek },
          videos: { required: work.totalVideos, perWeek: work.videosPerWeek },
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/studio/items/:itemId/status", async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const { status } = req.body;

      const validStatuses = ["DRAFT", "GENERATED", "READY", "APPROVED", "PUBLISHED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      const [item] = await db
        .select()
        .from(studioItems)
        .where(eq(studioItems.id, itemId))
        .limit(1);

      if (!item) return res.status(404).json({ error: "Studio item not found" });

      const updates: any = { status, updatedAt: new Date() };
      if (status === "PUBLISHED") {
        updates.publishedAt = new Date();
      }

      await db.update(studioItems)
        .set(updates)
        .where(eq(studioItems.id, itemId));

      if (item.planId && item.status !== status) {
        const statusToField: Record<string, string> = {
          GENERATED: "generatedCount",
          READY: "readyCount",
          APPROVED: "readyCount",
          PUBLISHED: "publishedCount",
        };

        const oldField = statusToField[item.status || ""];
        const newField = statusToField[status];

        const updates: Record<string, any> = {};
        if (oldField) {
          updates[oldField] = sql`GREATEST(${requiredWork[oldField as keyof typeof requiredWork]} - 1, 0)`;
        }
        if (newField) {
          updates[newField] = sql`${requiredWork[newField as keyof typeof requiredWork]} + 1`;
        }

        if (Object.keys(updates).length > 0) {
          await db.update(requiredWork)
            .set(updates)
            .where(eq(requiredWork.planId, item.planId));
        }

        if (status === "PUBLISHED" && item.status !== "PUBLISHED") {
          await db.update(strategicPlans)
            .set({ totalPublished: sql`${strategicPlans.totalPublished} + 1` })
            .where(eq(strategicPlans.id, item.planId));
        }
      }

      res.json({ success: true, status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/execution-pipeline/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = "default";
      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, req.params.campaignId),
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (!plan) {
        return res.json({
          stages: [
            { id: "plan", name: "Build Plan", status: "ACTION_NEEDED", count: 0 },
            { id: "approval", name: "Approval", status: "LOCKED", count: 0 },
            { id: "calendar", name: "Calendar", status: "LOCKED", count: 0 },
            { id: "creation", name: "Creation", status: "LOCKED", count: 0 },
            { id: "review", name: "Review", status: "LOCKED", count: 0 },
            { id: "publishing", name: "Publishing", status: "LOCKED", count: 0 },
          ],
        });
      }

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.planId, plan.id))
        .limit(1);

      const calendarCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(calendarEntries)
        .where(eq(calendarEntries.planId, plan.id));

      const studioCount = await db
        .select({
          total: sql<number>`count(*)`,
          ready: sql<number>`count(case when status IN ('READY','APPROVED') then 1 end)`,
          published: sql<number>`count(case when status = 'PUBLISHED' then 1 end)`,
        })
        .from(studioItems)
        .where(eq(studioItems.planId, plan.id));

      const stages = [
        {
          id: "plan",
          name: "Build Plan",
          status: "COMPLETED" as string,
          count: 1,
        },
        {
          id: "approval",
          name: "Approval",
          status: plan.status === "APPROVED" ? "COMPLETED" : plan.status === "REJECTED" ? "REJECTED" : "ACTION_NEEDED",
          count: plan.status === "APPROVED" ? 1 : 0,
        },
        {
          id: "calendar",
          name: "Calendar",
          status: Number(calendarCount[0]?.count) > 0 ? "COMPLETED" : (plan.status === "APPROVED" ? "ACTION_NEEDED" : "LOCKED"),
          count: Number(calendarCount[0]?.count) || 0,
        },
        {
          id: "creation",
          name: "Creation",
          status: (work?.generatedCount || 0) > 0 ? "IN_PROGRESS" : (Number(calendarCount[0]?.count) > 0 ? "ACTION_NEEDED" : "LOCKED"),
          count: work?.generatedCount || 0,
        },
        {
          id: "review",
          name: "Review",
          status: Number(studioCount[0]?.ready) > 0 ? "IN_PROGRESS" : "LOCKED",
          count: Number(studioCount[0]?.ready) || 0,
        },
        {
          id: "publishing",
          name: "Publishing",
          status: Number(studioCount[0]?.published) > 0 ? "IN_PROGRESS" : "LOCKED",
          count: Number(studioCount[0]?.published) || 0,
        },
      ];

      res.json({ planId: plan.id, stages });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
