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
  contentDna,
  goalDecompositions,
  growthSimulations,
  executionTasks,
  planAssumptions,
} from "@shared/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { validateRootIntegrity, detectStaleness, computeCalendarDeviation } from "../root-bundle";
import { computeFulfillment } from "../fulfillment-engine";
import { buildCausalNarrative } from "../narrative-layer";

import { resolveAccountId } from "../auth";
export function registerOrchestratorV2Routes(app: Express) {
  app.post("/api/orchestrator/run", async (req: Request, res: Response) => {
    try {
      const { campaignId, forceRefresh, resumeFromEngine } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const accountId = resolveAccountId(req);

      const lockResult = await db.execute(
        sql`INSERT INTO orchestrator_jobs (id, campaign_id, account_id, status, created_at, section_statuses)
            SELECT ${'lock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)},
                   ${String(campaignId)}, ${accountId}, 'RUNNING', NOW(), '[]'
            WHERE NOT EXISTS (
              SELECT 1 FROM orchestrator_jobs
              WHERE campaign_id = ${String(campaignId)} AND account_id = ${accountId}
                AND status = 'RUNNING'
                AND created_at > NOW() - INTERVAL '30 minutes'
            )
            RETURNING id`
      );
      if (!lockResult.rows?.length) {
        const existing = await db.execute(
          sql`SELECT id FROM orchestrator_jobs
              WHERE campaign_id = ${String(campaignId)} AND account_id = ${accountId}
                AND status = 'RUNNING' AND created_at > NOW() - INTERVAL '30 minutes'
              LIMIT 1`
        );
        return res.status(409).json({
          error: "An orchestrator run is already in progress for this campaign",
          jobId: existing.rows?.[0]?.id || null,
          status: "ALREADY_RUNNING",
        });
      }

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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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

      const safeJson = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

      const [goalDecomp] = await db.select().from(goalDecompositions)
        .where(and(eq(goalDecompositions.campaignId, req.params.campaignId), eq(goalDecompositions.accountId, accountId)))
        .orderBy(desc(goalDecompositions.createdAt)).limit(1);

      const [simulation] = await db.select().from(growthSimulations)
        .where(and(eq(growthSimulations.campaignId, req.params.campaignId), eq(growthSimulations.accountId, accountId)))
        .orderBy(desc(growthSimulations.createdAt)).limit(1);

      const tasks = await db.select().from(executionTasks)
        .where(eq(executionTasks.planId, plan.id));

      const assumptions = await db.select().from(planAssumptions)
        .where(eq(planAssumptions.planId, plan.id));

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
        goalDecomposition: goalDecomp ? {
          id: goalDecomp.id,
          goalType: goalDecomp.goalType,
          goalTarget: goalDecomp.goalTarget,
          goalLabel: goalDecomp.goalLabel,
          timeHorizonDays: goalDecomp.timeHorizonDays,
          feasibility: goalDecomp.feasibility,
          feasibilityScore: goalDecomp.feasibilityScore,
          feasibilityExplanation: goalDecomp.feasibilityExplanation,
          funnelMath: safeJson(goalDecomp.funnelMath),
          confidenceScore: goalDecomp.confidenceScore,
          assumptions: safeJson(goalDecomp.assumptions),
        } : null,
        simulation: simulation ? {
          id: simulation.id,
          conservativeCase: safeJson(simulation.conservativeCase),
          baseCase: safeJson(simulation.baseCase),
          upsideCase: safeJson(simulation.upsideCase),
          confidenceScore: simulation.confidenceScore,
          keyAssumptions: safeJson(simulation.keyAssumptions),
          bottleneckAlerts: safeJson(simulation.bottleneckAlerts),
          constraintSimulation: safeJson(simulation.constraintSimulation),
        } : null,
        executionTasks: {
          total: tasks.length,
          byStatus: {
            pending: tasks.filter(t => t.status === "pending").length,
            inProgress: tasks.filter(t => t.status === "in_progress").length,
            completed: tasks.filter(t => t.status === "completed").length,
            blocked: tasks.filter(t => t.status === "blocked").length,
          },
          today: tasks.filter(t => t.priority === "high" || t.weekNumber === 1).slice(0, 5).map(t => ({
            id: t.id, title: t.title, type: t.taskType, priority: t.priority, status: t.status,
          })),
        },
        assumptions: assumptions.map(a => ({
          assumption: a.assumption,
          confidence: a.confidence,
          impactSeverity: a.impactSeverity,
          source: a.source,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/approve", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const forceApprove = req.body.force === true;

      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(eq(strategicPlans.id, planId))
        .limit(1);

      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (plan.status !== "DRAFT" && plan.status !== "READY_FOR_REVIEW") {
        return res.status(400).json({ error: `Plan is ${plan.status}, not approvable` });
      }

      const warnings: string[] = [];

      if (plan.rootBundleId) {
        const integrity = await validateRootIntegrity(planId);
        if (!integrity.valid) {
          warnings.push(...integrity.issues);
        }

        const staleness = await detectStaleness(plan.campaignId, plan.accountId);
        if (staleness.isStale) {
          warnings.push(`Root staleness detected: ${staleness.reason}`);
        }
      }

      const [work] = await db.select().from(requiredWork)
        .where(eq(requiredWork.planId, planId)).limit(1);

      if (work) {
        const calCounts = await db.select({
          reels: sql<number>`count(case when content_type = 'REEL' then 1 end)`,
          posts: sql<number>`count(case when content_type = 'POST' then 1 end)`,
          stories: sql<number>`count(case when content_type = 'STORY' then 1 end)`,
          carousels: sql<number>`count(case when content_type = 'CAROUSEL' then 1 end)`,
          videos: sql<number>`count(case when content_type = 'VIDEO' then 1 end)`,
        }).from(calendarEntries).where(eq(calendarEntries.planId, planId));

        const deviation = computeCalendarDeviation(
          {
            reels: work.totalReels || 0,
            posts: work.totalPosts || 0,
            stories: work.totalStories || 0,
            carousels: work.totalCarousels || 0,
            videos: work.totalVideos || 0,
          },
          {
            reels: Number(calCounts[0]?.reels) || 0,
            posts: Number(calCounts[0]?.posts) || 0,
            stories: Number(calCounts[0]?.stories) || 0,
            carousels: Number(calCounts[0]?.carousels) || 0,
            videos: Number(calCounts[0]?.videos) || 0,
          }
        );

        if (!deviation.passesThreshold) {
          warnings.push(`Calendar deviation exceeds threshold: max ${deviation.maxDeviation}% (limit 5%)`);
        }
      }

      if (warnings.length > 0 && !forceApprove) {
        return res.status(409).json({
          success: false,
          blocked: true,
          warnings,
          message: "Plan approval blocked due to integrity issues. Set force=true to override.",
        });
      }

      const updated = await db.update(strategicPlans)
        .set({ status: "APPROVED", updatedAt: new Date() })
        .where(and(eq(strategicPlans.id, planId), or(eq(strategicPlans.status, "DRAFT"), eq(strategicPlans.status, "READY_FOR_REVIEW"))))
        .returning({ id: strategicPlans.id });

      if (!updated.length) {
        return res.status(409).json({ error: "Plan was already approved or changed by another request" });
      }

      await db.insert(planApprovals).values({
        planId,
        accountId: plan.accountId,
        decision: "APPROVED",
        reason: req.body.reason || (warnings.length > 0 ? `Force-approved with warnings: ${warnings.join("; ")}` : "Approved by user"),
        decidedBy: "client",
      });

      res.json({ success: true, status: "APPROVED", warnings });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/plans/:planId/reject", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const { reason } = req.body;

      const [plan] = await db.select({ id: strategicPlans.id }).from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      await db.update(strategicPlans)
        .set({ status: "REJECTED", updatedAt: new Date() })
        .where(eq(strategicPlans.id, planId));

      await db.insert(planApprovals).values({
        planId,
        accountId: resolveAccountId(req),
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
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;

      const fulfillment = await computeFulfillment(campaignId, accountId);

      if (!fulfillment.planId && fulfillment.total.required === 0) return res.json({ hasWork: false });

      const [work] = await db
        .select()
        .from(requiredWork)
        .where(eq(requiredWork.campaignId, campaignId))
        .orderBy(desc(requiredWork.createdAt))
        .limit(1);

      if (!work) return res.json({ hasWork: false });

      const planId = fulfillment.planId || work.planId;

      const todayStr = new Date().toISOString().split("T")[0];
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split("T")[0];

      const todayEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, planId),
            eq(calendarEntries.scheduledDate, todayStr)
          )
        );

      const weekEntries = await db
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.planId, planId),
            sql`${calendarEntries.scheduledDate} >= ${todayStr}`,
            sql`${calendarEntries.scheduledDate} <= ${weekEndStr}`
          )
        );

      const pendingToday = todayEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");
      const pendingWeek = weekEntries.filter(e => e.status === "PENDING" || e.status === "DRAFT");

      res.json({
        hasWork: fulfillment.total.remaining > 0,
        planId,
        totalPieces: fulfillment.total.required,
        fulfilled: fulfillment.total.fulfilled,
        remaining: fulfillment.total.remaining,
        progressPercent: fulfillment.progressPercent,
        branches: {
          STORIES: fulfillment.byBranch.STORIES,
          POSTS: fulfillment.byBranch.POSTS,
          REELS: fulfillment.byBranch.REELS,
        },
        byStatus: fulfillment.byStatus,
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
          reels: { required: fulfillment.byBranch.REELS.required, fulfilled: fulfillment.byBranch.REELS.fulfilled, remaining: fulfillment.byBranch.REELS.remaining, perWeek: work.reelsPerWeek },
          posts: { required: fulfillment.byBranch.POSTS.required, fulfilled: fulfillment.byBranch.POSTS.fulfilled, remaining: fulfillment.byBranch.POSTS.remaining, perWeek: work.postsPerWeek },
          stories: { required: fulfillment.byBranch.STORIES.required, fulfilled: fulfillment.byBranch.STORIES.fulfilled, remaining: fulfillment.byBranch.STORIES.remaining, perDay: work.storiesPerDay },
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


  app.get("/api/orchestrator/summaries/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;
      const job = await getLatestOrchestratorRun(accountId, campaignId);
      if (!job) {
        return res.json({ hasSummaries: false, engines: [] });
      }

      const sections: Array<{ id: string; name: string; status: string; summary?: string | null }> =
        job.sectionStatuses ? JSON.parse(job.sectionStatuses) : [];

      let hasSummaries = sections.some(s => s.summary && s.summary !== "Pending");

      if (!hasSummaries && sections.some(s => s.status === "SUCCESS")) {
        const { summarizeEngine } = await import("../agent/summarizers");
        const base = `http://localhost:${process.env.PORT || 5000}`;
        const q = `?campaignId=${encodeURIComponent(campaignId)}`;
        async function safe(url: string) {
          try { const r = await fetch(url); if (!r.ok) return null; return r.json(); } catch { return null; }
        }

        const engineApiMap: Record<string, string> = {
          audience: `/api/audience-engine/latest${q}`,
          positioning: `/api/positioning-engine/latest${q}`,
          differentiation: `/api/differentiation-engine/latest${q}`,
          mechanism: `/api/mechanism-engine/latest${q}`,
          offer: `/api/offer-engine/latest${q}`,
          awareness: `/api/awareness-engine/latest${q}`,
          funnel: `/api/funnel-engine/latest${q}`,
          persuasion: `/api/persuasion-engine/latest${q}`,
          integrity: `/api/integrity-engine/latest${q}`,
          statistical_validation: `/api/strategy/statistical-validation/latest${q}`,
          budget_governor: `/api/strategy/budget-governor/latest${q}`,
          channel_selection: `/api/strategy/channel-selection/latest${q}`,
          iteration: `/api/strategy/iteration-engine/latest${q}`,
          retention: `/api/strategy/retention-engine/latest${q}`,
        };

        const snapshotResults = await Promise.all(
          sections.filter(s => s.status === "SUCCESS" && engineApiMap[s.id])
            .map(async s => {
              const data = await safe(`${base}${engineApiMap[s.id]}`);
              return { id: s.id, data };
            })
        );

        let miOutput: any = null;
        try {
          const miRes = await db.execute(
            sql`SELECT competitor_data, signal_data, market_state, overall_confidence, dominance_data
                FROM mi_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`
          );
          const row = miRes.rows?.[0];
          if (row) {
            const safeP = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
            const competitors = safeP(row.competitor_data);
            miOutput = {
              competitors: Array.isArray(competitors) ? competitors : [],
              marketState: row.market_state,
              angleSaturation: undefined,
            };
          }
        } catch {}

        const outputMap: Record<string, any> = {};
        if (miOutput) outputMap.market_intelligence = miOutput;
        for (const { id, data } of snapshotResults) {
          if (data) outputMap[id] = { output: data };
        }

        for (const sec of sections) {
          if (sec.status === "SUCCESS" && !sec.summary && outputMap[sec.id]) {
            sec.summary = summarizeEngine(sec.id as any, outputMap[sec.id], sec.status);
          }
        }
        hasSummaries = sections.some(s => !!s.summary);
      }

      const engines = sections.map(sec => ({
        id: sec.id,
        name: sec.name,
        status: sec.status,
        summary: sec.summary || null,
      }));

      res.json({
        hasSummaries,
        jobId: job.id,
        jobStatus: job.status,
        durationMs: job.durationMs,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        engines,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Engine Table Summary — aggregates all 15 engines in parallel
  app.get("/api/engines/table-summary", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      if (!campaignId) return res.status(400).json({ error: "campaignId required" });

      const base = `http://localhost:${process.env.PORT || 5000}`;
      const q = `?campaignId=${encodeURIComponent(campaignId)}`;

      async function safe(url: string) {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return r.json();
        } catch { return null; }
      }

      const [
        audience, positioning, differentiation, mechanism,
        offer, awareness, funnel, persuasion,
        integrity, statVal, budget, channel,
        iteration, retention,
      ] = await Promise.all([
        safe(`${base}/api/audience-engine/latest${q}`),
        safe(`${base}/api/positioning-engine/latest${q}`),
        safe(`${base}/api/differentiation-engine/latest${q}`),
        safe(`${base}/api/mechanism-engine/latest${q}`),
        safe(`${base}/api/offer-engine/latest${q}`),
        safe(`${base}/api/awareness-engine/latest${q}`),
        safe(`${base}/api/funnel-engine/latest${q}`),
        safe(`${base}/api/persuasion-engine/latest${q}`),
        safe(`${base}/api/integrity-engine/latest${q}`),
        safe(`${base}/api/strategy/statistical-validation/latest${q}`),
        safe(`${base}/api/strategy/budget-governor/latest${q}`),
        safe(`${base}/api/strategy/channel-selection/latest${q}`),
        safe(`${base}/api/strategy/iteration-engine/latest${q}`),
        safe(`${base}/api/strategy/retention-engine/latest${q}`),
      ]);

      // Pull MI snapshot from DB
      let miRow: any = null;
      try {
        const miRes = await db.execute(
          sql`SELECT id, status, overall_confidence, narrative_synthesis, market_diagnosis, market_state, created_at
              FROM mi_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`
        );
        miRow = miRes.rows?.[0] ?? null;
      } catch { /* ignore */ }

      function score(val: number | undefined | null): string {
        if (val == null) return "—";
        return (Math.round(val * 1000) / 10).toFixed(1) + "%";
      }

      const rows = [
        {
          num: "01",
          engine: "Market Intelligence",
          status: miRow?.status ?? "—",
          keyOutput: miRow?.market_diagnosis
            ? String(miRow.market_diagnosis).slice(0, 300)
            : miRow?.narrative_synthesis
              ? String(miRow.narrative_synthesis).slice(0, 300)
              : "No data",
          score: miRow?.overall_confidence != null ? score(miRow.overall_confidence) : "—",
          notes: miRow?.market_state ?? "",
        },
        {
          num: "02",
          engine: "Audience",
          status: audience?.id ? "COMPLETE" : "—",
          keyOutput: (() => {
            const awarenessLvl = audience?.awarenessLevel?.level ?? audience?.awarenessLevel;
            const maturityLvl = audience?.maturityIndex?.level ?? audience?.maturityIndex;
            let topPain: string | null = null;
            try {
              const pains = typeof audience?.audiencePains === "string"
                ? JSON.parse(audience.audiencePains)
                : audience?.audiencePains;
              topPain = Array.isArray(pains) && pains[0]?.canonical
                ? `Top pain: ${pains[0].canonical}`
                : null;
            } catch { /* ignore */ }
            const segs = audience?.audienceSegments?.length
              ? `${audience.audienceSegments.length} segments`
              : null;
            return [
              awarenessLvl ? `Awareness level: ${awarenessLvl}` : null,
              maturityLvl ? `Maturity: ${maturityLvl}` : null,
              topPain,
              segs,
            ].filter(Boolean).join(" | ") || "No data";
          })(),
          score: audience?.maturityIndex?.confidenceScore != null
            ? score(audience.maturityIndex.confidenceScore)
            : audience?.awarenessLevel?.confidenceScore != null
              ? score(audience.awarenessLevel.confidenceScore)
              : "—",
          notes: "",
        },
        {
          num: "03",
          engine: "Positioning",
          status: positioning?.status ?? (positioning?.id ? "COMPLETE" : "—"),
          keyOutput: [
            positioning?.territory?.name ? `Territory: ${positioning.territory.name}` : null,
            positioning?.narrativeDirection ? `Direction: ${positioning.narrativeDirection}` : null,
            positioning?.differentiationVector ? `Vector: ${positioning.differentiationVector}` : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: positioning?.confidenceScore != null ? score(positioning.confidenceScore) : "—",
          notes: positioning?.statusMessage ?? "",
        },
        {
          num: "04",
          engine: "Differentiation",
          status: differentiation?.status ?? "—",
          keyOutput: [
            differentiation?.differentiationPillars?.length
              ? `${differentiation.differentiationPillars.length} pillars: ${differentiation.differentiationPillars.slice(0, 2).map((p: any) => p.name).join(", ")}`
              : null,
            differentiation?.mechanismCore?.mechanismName
              ? `Mechanism: ${differentiation.mechanismCore.mechanismName}`
              : null,
            differentiation?.authorityMode?.mode
              ? `Authority: ${differentiation.authorityMode.mode}`
              : null,
            differentiation?.claimScores?.totalClaims != null
              ? `${differentiation.claimScores.totalClaims} claims | avg score: ${score(differentiation.claimScores.averageScore)}`
              : null,
            differentiation?.stabilityResult?.stable != null
              ? `Stability: ${differentiation.stabilityResult.stable ? "Stable" : "Unstable"}`
              : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: differentiation?.confidenceScore != null ? score(differentiation.confidenceScore) : "—",
          notes: differentiation?.statusMessage ?? "",
        },
        {
          num: "05",
          engine: "Mechanism",
          status: mechanism?.status ?? (mechanism?.exists ? "COMPLETE" : "—"),
          keyOutput: mechanism?.primaryMechanism
            ? [
                `Name: ${mechanism.primaryMechanism.mechanismName}`,
                mechanism.primaryMechanism.mechanismDescription
                  ? mechanism.primaryMechanism.mechanismDescription.slice(0, 200)
                  : null,
                mechanism.primaryMechanism.mechanismSteps?.length
                  ? `${mechanism.primaryMechanism.mechanismSteps.length} steps`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: mechanism?.confidenceScore != null ? score(mechanism.confidenceScore) : "—",
          notes: mechanism?.statusMessage ?? "",
        },
        {
          num: "06",
          engine: "Offer",
          status: offer?.status ?? "—",
          keyOutput: offer?.primaryOffer
            ? [
                offer.primaryOffer.offerName ? `Offer: ${offer.primaryOffer.offerName}` : null,
                offer.primaryOffer.pricePoint ? `Price: ${offer.primaryOffer.pricePoint}` : null,
                offer.primaryOffer.valueStack?.length
                  ? `${offer.primaryOffer.valueStack.length}-item value stack`
                  : null,
                offer.primaryOffer.guarantee ? `Guarantee: ${offer.primaryOffer.guarantee}` : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: offer?.offerStrengthScore != null
            ? score(offer.offerStrengthScore)
            : offer?.confidenceScore != null
              ? score(offer.confidenceScore)
              : "—",
          notes: offer?.statusMessage ?? "",
        },
        {
          num: "07",
          engine: "Awareness",
          status: awareness?.status ?? (awareness?.exists ? "COMPLETE" : "—"),
          keyOutput: awareness?.primaryRoute
            ? [
                `Route: ${awareness.primaryRoute.routeName}`,
                `Type: ${awareness.primaryRoute.entryMechanismType}`,
                awareness.primaryRoute.targetReadinessStage
                  ? `Stage: ${awareness.primaryRoute.targetReadinessStage}`
                  : null,
                awareness.primaryRoute.trustRequirement
                  ? `Trust: ${awareness.primaryRoute.trustRequirement}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: awareness?.awarenessStrengthScore != null
            ? score(awareness.awarenessStrengthScore)
            : awareness?.primaryRoute?.awarenessStrengthScore != null
              ? score(awareness.primaryRoute.awarenessStrengthScore)
              : "—",
          notes: awareness?.statusMessage ?? "",
        },
        {
          num: "08",
          engine: "Funnel",
          status: funnel?.status ?? "—",
          keyOutput: funnel?.primaryFunnel
            ? [
                `Funnel: ${funnel.primaryFunnel.funnelName}`,
                `Type: ${funnel.primaryFunnel.funnelType}`,
                funnel.primaryFunnel.stageMap?.length
                  ? `${funnel.primaryFunnel.stageMap.length} stages`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: funnel?.confidenceScore != null ? score(funnel.confidenceScore) : "—",
          notes: funnel?.statusMessage ?? "",
        },
        {
          num: "09",
          engine: "Persuasion",
          status: persuasion?.status ?? (persuasion?.exists ? "COMPLETE" : "—"),
          keyOutput: persuasion?.primaryRoute
            ? [
                `Mode: ${persuasion.primaryRoute.persuasionMode}`,
                persuasion.primaryRoute.primaryInfluenceDrivers?.length
                  ? `Drivers: ${persuasion.primaryRoute.primaryInfluenceDrivers.slice(0, 3).join(", ")}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: persuasion?.persuasionStrengthScore != null
            ? score(persuasion.persuasionStrengthScore)
            : persuasion?.primaryRoute?.persuasionStrengthScore != null
              ? score(persuasion.primaryRoute.persuasionStrengthScore)
              : "—",
          notes: persuasion?.statusMessage ?? "",
        },
        {
          num: "10",
          engine: "Integrity",
          status: integrity?.status ?? (integrity?.exists ? "COMPLETE" : "—"),
          keyOutput: [
            integrity?.overallIntegrityScore != null
              ? `Integrity score: ${score(integrity.overallIntegrityScore)}`
              : null,
            integrity?.safeToExecute != null
              ? `Safe to execute: ${integrity.safeToExecute ? "YES" : "NO"}`
              : null,
            integrity?.layerResults?.filter((l: any) => l.passed === false)?.length
              ? `${integrity.layerResults.filter((l: any) => !l.passed).length} layer(s) failed`
              : integrity?.layerResults?.length
                ? `All ${integrity.layerResults.length} layers passed`
                : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: integrity?.overallIntegrityScore != null ? score(integrity.overallIntegrityScore) : "—",
          notes: integrity?.statusMessage ?? "",
        },
        {
          num: "11",
          engine: "Statistical Validation",
          status: statVal?.status ?? (statVal?.exists ? "COMPLETE" : "—"),
          keyOutput: statVal?.result
            ? [
                `State: ${statVal.result.validationState}`,
                statVal.result.claimConfidenceScore != null
                  ? `Claim confidence: ${score(statVal.result.claimConfidenceScore)}`
                  : null,
                statVal.result.evidenceStrength != null
                  ? `Evidence: ${score(statVal.result.evidenceStrength)}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: statVal?.result?.claimConfidenceScore != null
            ? score(statVal.result.claimConfidenceScore)
            : "—",
          notes: statVal?.statusMessage ?? "",
        },
        {
          num: "12",
          engine: "Budget Governor",
          status: budget?.snapshot?.status ?? "—",
          keyOutput: budget?.snapshot?.result?.decision
            ? [
                `Action: ${budget.snapshot.result.decision.action}`,
                budget.snapshot.result.decision.reasoning
                  ? budget.snapshot.result.decision.reasoning.slice(0, 200)
                  : budget.snapshot.statusMessage
                    ? budget.snapshot.statusMessage.slice(0, 200)
                    : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: "—",
          notes: budget?.snapshot?.statusMessage ?? "",
        },
        {
          num: "13",
          engine: "Channel Selection",
          status: channel?.status ?? "—",
          keyOutput: channel?.result?.primaryChannel
            ? [
                `Primary: ${channel.result.primaryChannel.channelName}`,
                `Fit: ${score(channel.result.primaryChannel.fitScore)}`,
                channel.result.primaryChannel.audienceDensityScore != null
                  ? `Audience density: ${score(channel.result.primaryChannel.audienceDensityScore)}`
                  : null,
                channel.result.channelMix?.length
                  ? `${channel.result.channelMix.length} channels in mix`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: channel?.result?.primaryChannel?.fitScore != null
            ? score(channel.result.primaryChannel.fitScore)
            : "—",
          notes: channel?.statusMessage ?? "",
        },
        {
          num: "14",
          engine: "Iteration",
          status: iteration?.status ?? (iteration?.exists ? "COMPLETE" : "—"),
          keyOutput: [
            iteration?.nextTestHypotheses?.length
              ? `${iteration.nextTestHypotheses.length} test hypothesis: ${iteration.nextTestHypotheses[0]?.hypothesis ?? ""}`
              : null,
            iteration?.optimizationTargets?.length
              ? `${iteration.optimizationTargets.length} optimization target(s)`
              : null,
          ].filter(Boolean).join(" | ") || "No data",
          score: "—",
          notes: iteration?.statusMessage ?? "",
        },
        {
          num: "15",
          engine: "Retention",
          status: retention?.snapshot?.status ?? "—",
          keyOutput: retention?.snapshot?.result?.retentionLoops?.length
            ? [
                `${retention.snapshot.result.retentionLoops.length} retention loop(s)`,
                `Loop 1: ${retention.snapshot.result.retentionLoops[0]?.name}`,
                retention.snapshot.result.retentionLoops[0]?.type
                  ? `Type: ${retention.snapshot.result.retentionLoops[0].type}`
                  : null,
              ].filter(Boolean).join(" | ")
            : "No data",
          score: "—",
          notes: retention?.snapshot?.statusMessage ?? "",
        },
      ];

      res.json({ rows });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/narrative/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const narrative = await buildCausalNarrative(req.params.campaignId, accountId);
      res.json(narrative);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
