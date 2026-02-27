import type { Express, Request, Response } from "express";
import { db } from "../db";
import {
  strategicBlueprints,
  strategicPlans,
  planApprovals,
  requiredWork,
  calendarEntries,
  studioItems,
  businessDataLayer,
} from "@shared/schema";
import { eq, and, sql, ne, inArray } from "drizzle-orm";
import { logAudit } from "../audit";
import { logAuditEvent } from "./audit-logger";
import { aiChat } from "../ai-client";

function deriveDistributionFromBusinessData(bizData: any): {
  reelsPerWeek: number;
  postsPerWeek: number;
  storiesPerDay: number;
  carouselsPerWeek: number;
  videosPerWeek: number;
} {
  const objective = bizData?.funnelObjective || "AWARENESS";
  const budgetStr = bizData?.monthlyBudget || "0";
  const budget = parseInt(budgetStr.replace(/[^0-9]/g, "")) || 0;
  const businessType = (bizData?.businessType || "").toLowerCase();

  const isVisualBusiness = ["photography", "fashion", "beauty", "food", "restaurant", "fitness", "travel", "real estate", "interior design", "art", "design"].some(t => businessType.includes(t));
  const isServiceBusiness = ["consulting", "coaching", "legal", "accounting", "saas", "tech", "software", "agency", "clinic", "medical", "dental"].some(t => businessType.includes(t));

  let volumeMultiplier = 1;
  if (budget >= 5000) volumeMultiplier = 1.5;
  else if (budget >= 2000) volumeMultiplier = 1.2;
  else if (budget <= 500) volumeMultiplier = 0.7;

  let base = { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };

  switch (objective) {
    case "AWARENESS":
      base = isVisualBusiness
        ? { reelsPerWeek: 4, postsPerWeek: 1, storiesPerDay: 2, carouselsPerWeek: 1, videosPerWeek: 1 }
        : { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 1, videosPerWeek: 0 };
      break;
    case "LEADS":
      base = isServiceBusiness
        ? { reelsPerWeek: 2, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 }
        : { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
    case "SALES":
      base = isVisualBusiness
        ? { reelsPerWeek: 3, postsPerWeek: 2, storiesPerDay: 2, carouselsPerWeek: 2, videosPerWeek: 1 }
        : { reelsPerWeek: 2, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 0 };
      break;
    case "AUTHORITY":
      base = isServiceBusiness
        ? { reelsPerWeek: 1, postsPerWeek: 3, storiesPerDay: 1, carouselsPerWeek: 3, videosPerWeek: 1 }
        : { reelsPerWeek: 2, postsPerWeek: 2, storiesPerDay: 1, carouselsPerWeek: 2, videosPerWeek: 1 };
      break;
  }

  return {
    reelsPerWeek: Math.max(1, Math.round(base.reelsPerWeek * volumeMultiplier)),
    postsPerWeek: Math.max(1, Math.round(base.postsPerWeek * volumeMultiplier)),
    storiesPerDay: Math.max(0, Math.round(base.storiesPerDay * volumeMultiplier)),
    carouselsPerWeek: Math.max(0, Math.round(base.carouselsPerWeek * volumeMultiplier)),
    videosPerWeek: Math.max(0, Math.round(base.videosPerWeek * volumeMultiplier)),
  };
}

async function generateCreativeContent(
  contentType: string,
  title: string | null,
  scheduledDate: string,
  planContext: string
): Promise<{ caption: string; creativeBrief: string; ctaCopy: string }> {
  const prompt = `You are an expert social media content creator. Generate content for a ${contentType} post.

Title/Theme: ${title || "Brand content"}
Scheduled Date: ${scheduledDate}
Campaign Context: ${planContext}

Return ONLY valid JSON with these exact keys:
{
  "caption": "An engaging social media caption (100-200 chars, include relevant hashtags)",
  "creativeBrief": "A detailed creative brief for the visual/media (50-100 words describing what to create)",
  "ctaCopy": "A compelling call-to-action (3-6 words)"
}`;

  const response = await aiChat({
    model: "gpt-5-nano",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 500,
    accountId: "default",
    endpoint: "strategic-execution",
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned empty response");

  const parsed = JSON.parse(content);
  if (!parsed.caption || !parsed.creativeBrief || !parsed.ctaCopy) {
    throw new Error("AI response missing required fields");
  }

  return {
    caption: parsed.caption,
    creativeBrief: parsed.creativeBrief,
    ctaCopy: parsed.ctaCopy,
  };
}

function requirePlanStatus(...allowedStatuses: string[]) {
  return async (req: Request, res: Response, next: Function) => {
    const planId = req.params.planId || req.params.id;
    if (!planId) return res.status(400).json({ error: "MISSING_PLAN_ID" });

    const [plan] = await db
      .select()
      .from(strategicPlans)
      .where(eq(strategicPlans.id, planId))
      .limit(1);

    if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });
    if (!allowedStatuses.includes(plan.status)) {
      return res.status(409).json({
        error: "STATUS_GATE",
        message: `Plan status must be one of [${allowedStatuses.join(", ")}], currently: ${plan.status}`,
        currentStatus: plan.status,
      });
    }
    (req as any).plan = plan;
    next();
  };
}

function requireExecutionIdle() {
  return async (req: Request, res: Response, next: Function) => {
    const plan = (req as any).plan;
    if (plan.executionStatus === "RUNNING") {
      return res.status(409).json({
        error: "EXECUTION_LOCKED",
        message: "Another execution is currently running for this plan. Wait for it to finish or trigger emergency stop.",
        executionStatus: plan.executionStatus,
      });
    }
    next();
  };
}

function calcTotals(distribution: any, periodDays: number): any {
  const weeks = Math.ceil(periodDays / 7);
  const days = periodDays;

  const reelsPerWeek = parseInt(distribution?.reelsPerWeek) || 0;
  const postsPerWeek = parseInt(distribution?.postsPerWeek) || 0;
  const storiesPerDay = parseInt(distribution?.storiesPerDay) || 0;
  const carouselsPerWeek = parseInt(distribution?.carouselsPerWeek) || 0;
  const videosPerWeek = parseInt(distribution?.videosPerWeek) || 0;

  const totalReels = reelsPerWeek * weeks;
  const totalPosts = postsPerWeek * weeks;
  const totalStories = storiesPerDay * days;
  const totalCarousels = carouselsPerWeek * weeks;
  const totalVideos = videosPerWeek * weeks;
  const totalContentPieces = totalReels + totalPosts + totalStories + totalCarousels + totalVideos;

  const designerItems = totalCarousels;
  const videoItems = totalReels + totalVideos;
  const writerItems = totalStories + totalPosts;

  return {
    reelsPerWeek,
    postsPerWeek,
    storiesPerDay,
    carouselsPerWeek,
    videosPerWeek,
    totalReels,
    totalPosts,
    totalStories,
    totalCarousels,
    totalVideos,
    totalContentPieces,
    designerItems,
    writerItems,
    videoItems,
  };
}

function generateCalendarSlots(
  planId: string,
  campaignId: string,
  accountId: string,
  work: any,
  startDate: Date,
  periodDays: number
): any[] {
  const slots: any[] = [];
  const contentQueue: { type: string; count: number }[] = [];

  if (work.totalReels > 0) contentQueue.push({ type: "reel", count: work.totalReels });
  if (work.totalPosts > 0) contentQueue.push({ type: "post", count: work.totalPosts });
  if (work.totalCarousels > 0) contentQueue.push({ type: "carousel", count: work.totalCarousels });
  if (work.totalVideos > 0) contentQueue.push({ type: "video", count: work.totalVideos });
  if (work.totalStories > 0) contentQueue.push({ type: "story", count: work.totalStories });

  const allItems: { type: string; index: number }[] = [];
  for (const q of contentQueue) {
    for (let i = 0; i < q.count; i++) {
      allItems.push({ type: q.type, index: i });
    }
  }

  if (allItems.length === 0) return [];

  const gap = periodDays / allItems.length;
  const postTimes = ["09:00", "12:00", "15:00", "18:00", "20:00"];

  for (let i = 0; i < allItems.length; i++) {
    const dayOffset = Math.floor(i * gap);
    const d = new Date(startDate);
    d.setDate(d.getDate() + dayOffset);
    const dateStr = d.toISOString().split("T")[0];
    const time = postTimes[i % postTimes.length];

    slots.push({
      planId,
      campaignId,
      accountId,
      contentType: allItems[i].type,
      scheduledDate: dateStr,
      scheduledTime: time,
      title: `${allItems[i].type.charAt(0).toUpperCase() + allItems[i].type.slice(1)} #${allItems[i].index + 1}`,
      status: "DRAFT",
      sourceLabel: "auto-generated",
    });
  }

  return slots;
}

export async function emergencyStopAllRunningPlans(accountId: string, reason: string): Promise<void> {
  await db
    .update(strategicPlans)
    .set({
      emergencyStopped: true,
      emergencyStoppedAt: new Date(),
      emergencyStoppedReason: reason,
    })
    .where(and(
      eq(strategicPlans.accountId, accountId),
      eq(strategicPlans.executionStatus, "RUNNING"),
    ));
}

export function registerExecutionRoutes(app: Express) {
  app.post("/api/execution/plans/generate", async (req: Request, res: Response) => {
    try {
      const { blueprintId, campaignId, accountId = "default", periodDays = 30 } = req.body;

      if (!blueprintId || !campaignId) {
        return res.status(400).json({ error: "blueprintId and campaignId are required" });
      }

      const [blueprint] = await db
        .select()
        .from(strategicBlueprints)
        .where(eq(strategicBlueprints.id, blueprintId))
        .limit(1);

      if (!blueprint) {
        return res.status(404).json({ error: "BLUEPRINT_NOT_FOUND" });
      }

      if (!blueprint.orchestratorPlan) {
        return res.status(400).json({
          error: "NO_ORCHESTRATOR_PLAN",
          message: "Blueprint must have a completed orchestrator plan before generating an execution plan.",
        });
      }

      let planJson: any;
      try {
        planJson = JSON.parse(blueprint.orchestratorPlan);
      } catch {
        return res.status(500).json({ error: "INVALID_PLAN_JSON", message: "Orchestrator plan JSON is corrupt." });
      }

      let bizData: any = null;
      try {
        const bizRows = await db.select().from(businessDataLayer)
          .where(and(
            eq(businessDataLayer.campaignId, campaignId),
            eq(businessDataLayer.accountId, accountId)
          ))
          .limit(1);
        if (bizRows.length > 0) bizData = bizRows[0];
      } catch (err) {
        console.log("[Execution] Business data fetch skipped:", (err as Error).message);
      }

      const distribution = planJson.contentDistributionPlan || {};
      const weeklyCalendar = distribution.weeklyCalendar || [];

      const calendarReels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "reel").length;
      const calendarPosts = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "post" || d.contentType?.toLowerCase() === "static post").length;
      const calendarStories = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "story").length;
      const calendarCarousels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "carousel").length;
      const calendarVideos = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "video").length;

      const bizDerived = deriveDistributionFromBusinessData(bizData);

      const reelsPerWeek = calendarReels > 0 ? calendarReels : bizDerived.reelsPerWeek;
      const postsPerWeek = calendarPosts > 0 ? calendarPosts : bizDerived.postsPerWeek;
      const storiesPerDay = calendarStories > 0 ? 1 : bizDerived.storiesPerDay;
      const carouselsPerWeek = calendarCarousels > 0 ? calendarCarousels : bizDerived.carouselsPerWeek;
      const videosPerWeek = calendarVideos > 0 ? calendarVideos : bizDerived.videosPerWeek;

      const parsedDistribution = { reelsPerWeek, postsPerWeek, storiesPerDay, carouselsPerWeek, videosPerWeek };
      const totals = calcTotals(parsedDistribution, periodDays);

      const summary = [
        planJson.contentDistributionPlan ? `Distribution: ${distribution.platforms?.length || 0} platforms` : null,
        planJson.creativeTestingMatrix ? `Creative Tests: ${planJson.creativeTestingMatrix.tests?.length || 0}` : null,
        planJson.budgetAllocationStructure ? `Budget: ${planJson.budgetAllocationStructure.totalRecommended || "TBD"}` : null,
        `Total Content: ${totals.totalContentPieces} pieces over ${periodDays} days`,
      ]
        .filter(Boolean)
        .join(" | ");

      const [plan] = await db
        .insert(strategicPlans)
        .values({
          accountId,
          blueprintId,
          campaignId,
          planJson: JSON.stringify(planJson),
          planSummary: summary,
          status: "DRAFT",
          executionStatus: "IDLE",
        })
        .returning();

      await logAudit(accountId, "PLAN_GENERATED", {
        details: { planId: plan.id, blueprintId, campaignId, summary, totalContent: totals.totalContentPieces },
      });

      res.json({
        success: true,
        plan,
        parsedDistribution,
        totals,
      });
    } catch (err: any) {
      console.error("Plan generation error:", err);
      res.status(500).json({ error: "PLAN_GENERATION_FAILED", message: err.message });
    }
  });

  app.get("/api/execution/plans/:planId", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

      const work = await db.select().from(requiredWork).where(eq(requiredWork.planId, planId));
      const entries = await db.select().from(calendarEntries).where(eq(calendarEntries.planId, planId));
      const items = await db.select().from(studioItems).where(eq(studioItems.planId, planId));
      const approvals = await db.select().from(planApprovals).where(eq(planApprovals.planId, planId));

      const workRec = work[0] || null;

      res.json({
        success: true,
        plan,
        requiredWork: workRec,
        calendarEntries: entries,
        studioItems: items,
        approvals,
        progress: {
          totalRequired: workRec?.totalContentPieces || 0,
          calendarGenerated: entries.length,
          studioCreated: items.length,
          published: items.filter((i) => i.status === "PUBLISHED").length,
          scheduled: items.filter((i) => i.status === "SCHEDULED").length,
          ready: items.filter((i) => i.status === "READY").length,
          failed: items.filter((i) => i.status === "FAILED").length,
          draft: items.filter((i) => i.status === "DRAFT").length,
        },
        branches: {
          DESIGNER: { total: workRec?.designerItems || 0, label: "Designer" },
          WRITER: { total: workRec?.writerItems || 0, label: "Writer" },
          VIDEO: { total: workRec?.videoItems || 0, label: "Video" },
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/execution/plans", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const plans = await db
        .select()
        .from(strategicPlans)
        .where(eq(strategicPlans.accountId, accountId))
        .orderBy(sql`${strategicPlans.createdAt} DESC`);

      res.json({ success: true, plans });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/execution/plans/:planId/approve",
    requirePlanStatus("DRAFT", "READY_FOR_REVIEW"),
    async (req: Request, res: Response) => {
      try {
        const plan = (req as any).plan;
        const { reason, decidedBy = "client" } = req.body;

        await db
          .update(strategicPlans)
          .set({ status: "APPROVED", updatedAt: new Date() })
          .where(eq(strategicPlans.id, plan.id));

        await db.insert(planApprovals).values({
          planId: plan.id,
          accountId: plan.accountId,
          decision: "APPROVED",
          reason: reason || "Approved by client",
          decidedBy,
        });

        await logAudit(plan.accountId, "PLAN_APPROVED", {
          details: { planId: plan.id, decidedBy },
        });

        res.json({ success: true, planId: plan.id, status: "APPROVED" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/api/execution/plans/:planId/reject",
    requirePlanStatus("DRAFT", "READY_FOR_REVIEW"),
    async (req: Request, res: Response) => {
      try {
        const plan = (req as any).plan;
        const { reason, decidedBy = "client" } = req.body;

        if (!reason) {
          return res.status(400).json({ error: "Rejection reason is required" });
        }

        await db
          .update(strategicPlans)
          .set({ status: "REJECTED", updatedAt: new Date() })
          .where(eq(strategicPlans.id, plan.id));

        await db.insert(planApprovals).values({
          planId: plan.id,
          accountId: plan.accountId,
          decision: "REJECTED",
          reason,
          decidedBy,
        });

        await logAudit(plan.accountId, "PLAN_REJECTED", {
          details: { planId: plan.id, reason, decidedBy },
        });

        res.json({ success: true, planId: plan.id, status: "REJECTED" });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post("/api/execution/plans/:planId/emergency-stop", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const { reason } = req.body;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

      if (plan.emergencyStopped) {
        return res.status(409).json({ error: "ALREADY_STOPPED", message: "Emergency stop already active." });
      }

      await db
        .update(strategicPlans)
        .set({
          emergencyStopped: true,
          emergencyStoppedAt: new Date(),
          emergencyStoppedReason: reason || "Manual emergency stop",
          executionStatus: "PAUSED",
          updatedAt: new Date(),
        })
        .where(eq(strategicPlans.id, planId));

      await logAudit(plan.accountId, "EMERGENCY_STOP_TRIGGERED", {
        details: { planId, reason, previousExecutionStatus: plan.executionStatus },
      });

      res.json({ success: true, planId, emergencyStopped: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/execution/plans/:planId/resume", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

      if (!plan.emergencyStopped) {
        return res.status(409).json({ error: "NOT_STOPPED", message: "Plan is not in emergency stop state." });
      }

      await db
        .update(strategicPlans)
        .set({
          emergencyStopped: false,
          emergencyStoppedAt: null,
          emergencyStoppedReason: null,
          executionStatus: "IDLE",
          updatedAt: new Date(),
        })
        .where(eq(strategicPlans.id, planId));

      await logAudit(plan.accountId, "EXECUTION_RESUMED", {
        details: { planId },
      });

      res.json({ success: true, planId, emergencyStopped: false, executionStatus: "IDLE" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(
    "/api/execution/plans/:planId/execute-calendar",
    requirePlanStatus("APPROVED"),
    requireExecutionIdle(),
    async (req: Request, res: Response) => {
      try {
        const plan = (req as any).plan;
        const { periodDays = 30, startDate } = req.body;

        if (plan.emergencyStopped) {
          return res.status(409).json({ error: "EMERGENCY_STOPPED", message: "Cannot execute while emergency stop is active." });
        }

        await db
          .update(strategicPlans)
          .set({ executionStatus: "RUNNING", updatedAt: new Date() })
          .where(eq(strategicPlans.id, plan.id));

        try {
          let planJson: any;
          try {
            planJson = JSON.parse(plan.planJson);
          } catch {
            throw new Error("Plan JSON is corrupt");
          }

          let execBizData: any = null;
          try {
            const execBizRows = await db.select().from(businessDataLayer)
              .where(and(
                eq(businessDataLayer.campaignId, plan.campaignId),
                eq(businessDataLayer.accountId, plan.accountId)
              ))
              .limit(1);
            if (execBizRows.length > 0) execBizData = execBizRows[0];
          } catch (err) {
            console.log("[Execution] Business data fetch for calendar skipped:", (err as Error).message);
          }

          const distribution = planJson.contentDistributionPlan || {};
          const weeklyCalendar = distribution.weeklyCalendar || [];

          const calReels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "reel").length;
          const calPosts = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "post" || d.contentType?.toLowerCase() === "static post").length;
          const calStories = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "story").length;
          const calCarousels = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "carousel").length;
          const calVideos = weeklyCalendar.filter((d: any) => d.contentType?.toLowerCase() === "video").length;

          const execBizDerived = deriveDistributionFromBusinessData(execBizData);

          const reelsPerWeek = calReels > 0 ? calReels : execBizDerived.reelsPerWeek;
          const postsPerWeek = calPosts > 0 ? calPosts : execBizDerived.postsPerWeek;
          const storiesPerDay = calStories > 0 ? 1 : execBizDerived.storiesPerDay;
          const carouselsPerWeek = calCarousels > 0 ? calCarousels : execBizDerived.carouselsPerWeek;
          const videosPerWeek = calVideos > 0 ? calVideos : execBizDerived.videosPerWeek;

          const parsedDistribution = { reelsPerWeek, postsPerWeek, storiesPerDay, carouselsPerWeek, videosPerWeek };
          const totals = calcTotals(parsedDistribution, periodDays);

          const existingWork = await db
            .select()
            .from(requiredWork)
            .where(and(eq(requiredWork.planId, plan.id), eq(requiredWork.campaignId, plan.campaignId)))
            .limit(1);

          let workRecord;
          if (existingWork.length > 0) {
            [workRecord] = await db
              .update(requiredWork)
              .set({ ...totals, ...parsedDistribution, periodDays, updatedAt: new Date() })
              .where(eq(requiredWork.id, existingWork[0].id))
              .returning();
          } else {
            [workRecord] = await db
              .insert(requiredWork)
              .values({
                planId: plan.id,
                campaignId: plan.campaignId,
                accountId: plan.accountId,
                periodDays,
                ...parsedDistribution,
                ...totals,
              })
              .returning();
          }

          await logAudit(plan.accountId, "REQUIRED_WORK_CALCULATED", {
            details: { planId: plan.id, ...totals },
          });

          const existingEntries = await db
            .select()
            .from(calendarEntries)
            .where(eq(calendarEntries.planId, plan.id));

          if (existingEntries.length > 0) {
            await db
              .update(strategicPlans)
              .set({
                executionStatus: "COMPLETED",
                generatedToCalendarAt: new Date(),
                totalCalendarEntries: existingEntries.length,
                updatedAt: new Date(),
              })
              .where(eq(strategicPlans.id, plan.id));

            return res.json({
              success: true,
              idempotent: true,
              message: "Calendar already generated for this plan. Skipped re-generation.",
              calendarEntries: existingEntries.length,
              requiredWork: workRecord,
            });
          }

          const start = startDate ? new Date(startDate) : new Date();
          const slots = generateCalendarSlots(plan.id, plan.campaignId, plan.accountId, totals, start, periodDays);

          if (slots.length > 0) {
            await db.insert(calendarEntries).values(slots);
          }

          await db
            .update(strategicPlans)
            .set({
              executionStatus: "COMPLETED",
              status: "GENERATED_TO_CALENDAR",
              generatedToCalendarAt: new Date(),
              totalCalendarEntries: slots.length,
              updatedAt: new Date(),
            })
            .where(eq(strategicPlans.id, plan.id));

          await logAudit(plan.accountId, "CALENDAR_ENTRIES_GENERATED", {
            details: { planId: plan.id, entries: slots.length, periodDays },
          });

          res.json({
            success: true,
            calendarEntries: slots.length,
            requiredWork: workRecord,
            totals,
          });
        } catch (innerErr: any) {
          await db
            .update(strategicPlans)
            .set({ executionStatus: "FAILED", updatedAt: new Date() })
            .where(eq(strategicPlans.id, plan.id));

          await logAudit(plan.accountId, "EXECUTION_FAILED", {
            details: { planId: plan.id, error: innerErr.message },
          });

          throw innerErr;
        }
      } catch (err: any) {
        console.error("Calendar execution error:", err);
        res.status(500).json({ error: "CALENDAR_EXECUTION_FAILED", message: err.message });
      }
    }
  );

  app.get("/api/execution/calendar-entries/:entryId", async (req: Request, res: Response) => {
    try {
      const { entryId } = req.params;
      const [entry] = await db
        .select()
        .from(calendarEntries)
        .where(eq(calendarEntries.id, entryId))
        .limit(1);

      if (!entry) {
        return res.status(404).json({ success: false, error: "ENTRY_NOT_FOUND" });
      }

      res.json({ success: true, entry });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/execution/calendar-entries/:entryId/generate", async (req: Request, res: Response) => {
    try {
      const { entryId } = req.params;

      const [entry] = await db
        .select()
        .from(calendarEntries)
        .where(eq(calendarEntries.id, entryId))
        .limit(1);

      if (!entry) {
        return res.status(404).json({ error: "ENTRY_NOT_FOUND", message: "Calendar entry not found." });
      }

      if (entry.status !== "DRAFT" && entry.status !== "FAILED") {
        return res.status(409).json({
          error: "INVALID_ENTRY_STATUS",
          message: `Calendar entry must be DRAFT or FAILED to generate content. Current status: ${entry.status}`,
          currentStatus: entry.status,
        });
      }

      const [plan] = await db
        .select()
        .from(strategicPlans)
        .where(eq(strategicPlans.id, entry.planId))
        .limit(1);

      if (!plan) {
        return res.status(404).json({ error: "PLAN_NOT_FOUND", message: "Associated plan not found." });
      }

      if (plan.emergencyStopped) {
        return res.status(409).json({ error: "EMERGENCY_STOPPED", message: "Cannot generate while emergency stop is active." });
      }

      const approvals = await db
        .select()
        .from(planApprovals)
        .where(and(eq(planApprovals.planId, plan.id), eq(planApprovals.decision, "APPROVED")))
        .limit(1);

      if (approvals.length === 0) {
        return res.status(403).json({
          error: "APPROVAL_GATE_FAILED",
          message: "Plan must have an explicit APPROVED approval record before creative generation can begin.",
        });
      }

      const existingItem = await db
        .select()
        .from(studioItems)
        .where(eq(studioItems.calendarEntryId, entry.id))
        .limit(1);

      if (existingItem.length > 0 && existingItem[0].status !== "FAILED") {
        return res.json({
          success: true,
          idempotent: true,
          message: "Content already generated for this calendar entry.",
          studioItem: existingItem[0],
        });
      }

      const isRetry = existingItem.length > 0 && existingItem[0].status === "FAILED";

      let planContext = "Marketing campaign content";
      try {
        const planJson = JSON.parse(plan.planJson || "{}");
        const brand = planJson.brandIdentity?.brandName || planJson.brandName || "";
        const industry = planJson.marketAnalysis?.industry || planJson.industry || "";
        const tone = planJson.contentStrategy?.toneOfVoice || planJson.toneOfVoice || "";
        planContext = `Brand: ${brand}. Industry: ${industry}. Tone: ${tone}.`.replace(/\.\s*\./g, ".");
      } catch {}

      let aiContent: { caption: string; creativeBrief: string; ctaCopy: string };
      try {
        aiContent = await generateCreativeContent(
          entry.contentType,
          entry.title,
          entry.scheduledDate,
          planContext
        );
      } catch (aiErr: any) {
        await db
          .update(calendarEntries)
          .set({ status: "FAILED", errorReason: aiErr.message, updatedAt: new Date() })
          .where(eq(calendarEntries.id, entry.id));

        await logAudit(plan.accountId, "AI_CREATIVE_FAILED", {
          details: { planId: plan.id, entryId: entry.id, error: aiErr.message },
        });

        return res.status(500).json({
          error: "AI_GENERATION_FAILED",
          message: aiErr.message,
          entryId: entry.id,
        });
      }

      let item;
      if (isRetry && existingItem[0]) {
        [item] = await db
          .update(studioItems)
          .set({
            caption: aiContent.caption,
            creativeBrief: aiContent.creativeBrief,
            ctaCopy: aiContent.ctaCopy,
            status: "DRAFT",
            errorReason: null,
            updatedAt: new Date(),
          })
          .where(eq(studioItems.id, existingItem[0].id))
          .returning();
      } else {
        [item] = await db
          .insert(studioItems)
          .values({
            planId: plan.id,
            campaignId: plan.campaignId,
            calendarEntryId: entry.id,
            accountId: plan.accountId,
            contentType: entry.contentType,
            title: entry.title,
            caption: aiContent.caption,
            creativeBrief: aiContent.creativeBrief,
            ctaCopy: aiContent.ctaCopy,
            status: "DRAFT",
          })
          .returning();
      }

      await db
        .update(calendarEntries)
        .set({ studioItemId: item.id, status: "AI_GENERATED", aiGeneratedAt: new Date(), updatedAt: new Date() })
        .where(eq(calendarEntries.id, entry.id));

      await logAudit(plan.accountId, "AI_CREATIVE_GENERATED", {
        details: { planId: plan.id, entryId: entry.id, studioItemId: item.id, contentType: entry.contentType },
      });

      res.json({
        success: true,
        studioItem: item,
        calendarEntryId: entry.id,
        contentType: entry.contentType,
      });
    } catch (err: any) {
      console.error("Single entry generation error:", err);
      res.status(500).json({ error: "GENERATION_FAILED", message: err.message });
    }
  });

  app.post("/api/execution/plans/:planId/reset-failed", async (req: Request, res: Response) => {
    const requestId = `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { planId } = req.params;
      const accountId = (req.query.accountId as string) || (req.body?.accountId as string) || "default";
      const campaignId = (req.query.campaignId as string) || (req.body?.campaignId as string) || null;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND", requestId });

      if (plan.accountId !== accountId) {
        return res.status(403).json({ error: "ACCOUNT_MISMATCH", message: "Plan does not belong to this account.", requestId });
      }

      if (campaignId && plan.campaignId !== campaignId) {
        return res.status(403).json({ error: "CAMPAIGN_MISMATCH", message: "Plan does not belong to this campaign.", requestId });
      }

      const resettableStatuses = ["APPROVED", "GENERATED_TO_CALENDAR", "CREATIVE_GENERATED", "REVIEW", "SCHEDULED", "PUBLISHED"];
      if (!resettableStatuses.includes(plan.status)) {
        return res.status(409).json({
          error: "PLAN_NOT_RESETTABLE",
          message: `Plan must be in an active pipeline state to reset failed entries. Current status: ${plan.status}.`,
          currentStatus: plan.status,
          allowedStatuses: resettableStatuses,
          requestId,
        });
      }

      const failedEntries = await db
        .select()
        .from(calendarEntries)
        .where(and(eq(calendarEntries.planId, planId), eq(calendarEntries.status, "FAILED")));

      if (failedEntries.length === 0) {
        return res.json({ success: true, message: "No failed entries to reset.", resetCount: 0, studioDeleted: 0, requestId });
      }

      let studioDeleted = 0;
      await db.transaction(async (tx) => {
        await tx
          .update(calendarEntries)
          .set({ status: "DRAFT", errorReason: null, updatedAt: new Date() })
          .where(and(eq(calendarEntries.planId, planId), eq(calendarEntries.status, "FAILED")));

        const failedItemIds = failedEntries.map(e => e.id);
        for (const entryId of failedItemIds) {
          const deleted = await tx
            .delete(studioItems)
            .where(and(eq(studioItems.calendarEntryId, entryId), eq(studioItems.status, "FAILED")))
            .returning();
          studioDeleted += deleted.length;
        }

        await tx
          .update(strategicPlans)
          .set({ executionStatus: "IDLE", totalFailed: 0, updatedAt: new Date() })
          .where(eq(strategicPlans.id, planId));
      });

      await logAudit(plan.accountId, "FAILED_ENTRIES_RESET", {
        details: { requestId, planId, campaignId: plan.campaignId, entriesReset: failedEntries.length, studioDeleted, timestamp: new Date().toISOString() },
      });

      res.json({ success: true, resetCount: failedEntries.length, studioDeleted, requestId, message: `Reset ${failedEntries.length} failed entries to DRAFT.` });
    } catch (err: any) {
      await logAudit("default", "FAILED_RESET_ERROR", {
        details: { requestId, error: err.message, planId: req.params.planId },
      }).catch(() => {});
      res.status(500).json({ error: "RESET_FAILED", message: err.message, requestId });
    }
  });

  app.get("/api/execution/plans/:planId/progress", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "PLAN_NOT_FOUND" });

      const work = await db.select().from(requiredWork).where(eq(requiredWork.planId, planId));
      const entries = await db.select().from(calendarEntries).where(eq(calendarEntries.planId, planId));
      const items = await db.select().from(studioItems).where(eq(studioItems.planId, planId));

      const totalRequired = work[0]?.totalContentPieces || 0;
      const published = items.filter((i) => i.status === "PUBLISHED").length;
      const scheduled = items.filter((i) => i.status === "SCHEDULED").length;
      const ready = items.filter((i) => i.status === "READY").length;
      const studioFailed = items.filter((i) => i.status === "FAILED").length;
      const draft = items.filter((i) => i.status === "DRAFT").length;
      const canceled = items.filter((i) => i.status === "CANCELED").length;

      const calendarFailed = entries.filter((e) => e.status === "FAILED").length;
      const calendarDraft = entries.filter((e) => e.status === "DRAFT").length;
      const failed = studioFailed + calendarFailed;

      const progressPercent = totalRequired > 0 ? Math.round(((published + scheduled + ready) / totalRequired) * 100) : 0;

      const workRecord = work[0] || null;
      const branches = {
        DESIGNER: { total: workRecord?.designerItems || 0, label: "Designer" },
        WRITER: { total: workRecord?.writerItems || 0, label: "Writer" },
        VIDEO: { total: workRecord?.videoItems || 0, label: "Video" },
      };

      res.json({
        success: true,
        planId,
        status: plan.status,
        executionStatus: plan.executionStatus,
        emergencyStopped: plan.emergencyStopped,
        totalRequired,
        calendarGenerated: entries.length,
        calendarDraft,
        calendarFailed,
        studioTotal: items.length,
        published,
        scheduled,
        ready,
        draft,
        failed,
        canceled,
        progressPercent,
        branches,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/execution/dashboard", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string | undefined;

      const planConditions = [eq(strategicPlans.accountId, accountId)];
      if (campaignId) planConditions.push(eq(strategicPlans.campaignId, campaignId));

      const plans = await db
        .select()
        .from(strategicPlans)
        .where(and(...planConditions));

      const workConditions = [eq(requiredWork.accountId, accountId)];
      if (campaignId) workConditions.push(eq(requiredWork.campaignId, campaignId));

      const allWork = await db
        .select()
        .from(requiredWork)
        .where(and(...workConditions));

      const itemConditions = [eq(studioItems.accountId, accountId)];
      if (campaignId) itemConditions.push(eq(studioItems.campaignId, campaignId));

      const allItems = await db
        .select()
        .from(studioItems)
        .where(and(...itemConditions));

      const totalPlans = plans.length;
      const activePlans = plans.filter((p) => !["REJECTED", "DRAFT"].includes(p.status)).length;
      const emergencyStoppedPlans = plans.filter((p) => p.emergencyStopped).length;

      const totalRequired = allWork.reduce((sum, w) => sum + (w.totalContentPieces || 0), 0);
      const totalPublished = allItems.filter((i) => i.status === "PUBLISHED").length;
      const totalScheduled = allItems.filter((i) => i.status === "SCHEDULED").length;
      const totalReady = allItems.filter((i) => i.status === "READY").length;
      const totalFailed = allItems.filter((i) => i.status === "FAILED").length;
      const totalDraft = allItems.filter((i) => i.status === "DRAFT").length;
      const totalCanceled = allItems.filter((i) => i.status === "CANCELED").length;

      const overallProgress = totalRequired > 0 ? Math.round(((totalPublished + totalScheduled + totalReady) / totalRequired) * 100) : 0;

      res.json({
        success: true,
        account: {
          totalPlans,
          activePlans,
          emergencyStoppedPlans,
          totalRequired,
          totalPublished,
          totalScheduled,
          totalReady,
          totalDraft,
          totalFailed,
          totalCanceled,
          overallProgress,
        },
        plans: plans.map((p) => ({
          id: p.id,
          status: p.status,
          executionStatus: p.executionStatus,
          emergencyStopped: p.emergencyStopped,
          totalCalendarEntries: p.totalCalendarEntries,
          totalStudioItems: p.totalStudioItems,
          totalFailed: p.totalFailed,
          totalCanceled: p.totalCanceled,
          createdAt: p.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/execution/calendar-entries", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      let matchingPlans = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, campaignId),
            sql`${strategicPlans.status} IN ('APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'REVIEW', 'SCHEDULED', 'PUBLISHED')`
          )
        )
        .orderBy(sql`${strategicPlans.createdAt} DESC`);

      if (matchingPlans.length === 0) {
        matchingPlans = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              sql`${strategicPlans.status} IN ('APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'REVIEW', 'SCHEDULED', 'PUBLISHED')`
            )
          )
          .orderBy(sql`${strategicPlans.createdAt} DESC`);
      }

      if (matchingPlans.length === 0) {
        return res.json({ success: true, entries: [], planId: null, message: "No approved plan found for this campaign." });
      }

      let bestPlan = matchingPlans[0];
      let entries: any[] = [];

      for (const plan of matchingPlans) {
        const planEntries = await db
          .select()
          .from(calendarEntries)
          .where(
            and(
              eq(calendarEntries.planId, plan.id),
              eq(calendarEntries.accountId, accountId)
            )
          )
          .orderBy(sql`${calendarEntries.scheduledDate} ASC, ${calendarEntries.scheduledTime} ASC`);

        if (planEntries.length > 0) {
          bestPlan = plan;
          entries = planEntries;
          break;
        }
      }

      res.json({
        success: true,
        planId: bestPlan.id,
        planStatus: bestPlan.status,
        executionStatus: bestPlan.executionStatus,
        entries,
      });
    } catch (err: any) {
      console.error("Calendar entries fetch error:", err);
      res.status(500).json({ error: "FETCH_FAILED", message: err.message });
    }
  });

  app.get("/api/execution/plans/:planId/calendar", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const entries = await db
        .select()
        .from(calendarEntries)
        .where(eq(calendarEntries.planId, planId))
        .orderBy(sql`${calendarEntries.scheduledDate} ASC, ${calendarEntries.scheduledTime} ASC`);

      res.json({ success: true, entries });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/execution/plans/:planId/studio", async (req: Request, res: Response) => {
    try {
      const { planId } = req.params;
      const items = await db
        .select()
        .from(studioItems)
        .where(eq(studioItems.planId, planId))
        .orderBy(sql`${studioItems.createdAt} DESC`);

      res.json({ success: true, items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/execution/required-work", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      const matchingPlans = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, campaignId),
            sql`${strategicPlans.status} IN ('APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'REVIEW', 'SCHEDULED', 'PUBLISHED')`
          )
        )
        .orderBy(sql`${strategicPlans.createdAt} DESC`);

      if (matchingPlans.length === 0) {
        return res.json({
          success: true,
          requiredWork: null,
          branches: { DESIGNER: { total: 0, label: "Designer" }, WRITER: { total: 0, label: "Writer" }, VIDEO: { total: 0, label: "Video" } },
          message: "No active plan found for this campaign.",
        });
      }

      const activePlanIds = matchingPlans.map(p => p.id);
      const work = await db
        .select()
        .from(requiredWork)
        .where(and(
          inArray(requiredWork.planId, activePlanIds),
          eq(requiredWork.campaignId, campaignId)
        ))
        .orderBy(sql`${requiredWork.createdAt} DESC`)
        .limit(1);

      const workRec = work[0] || null;

      res.json({
        success: true,
        planId: workRec?.planId || activePlanIds[0],
        requiredWork: workRec,
        branches: {
          DESIGNER: { total: workRec?.designerItems || 0, label: "Designer" },
          WRITER: { total: workRec?.writerItems || 0, label: "Writer" },
          VIDEO: { total: workRec?.videoItems || 0, label: "Video" },
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/execution/studio-items/:itemId/status", async (req: Request, res: Response) => {
    try {
      const { itemId } = req.params;
      const { status } = req.body;

      const validStatuses = ["DRAFT", "READY", "SCHEDULED", "PUBLISHED", "FAILED", "CANCELED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      const [item] = await db.select().from(studioItems).where(eq(studioItems.id, itemId)).limit(1);
      if (!item) return res.status(404).json({ error: "STUDIO_ITEM_NOT_FOUND" });

      const updateData: any = { status, updatedAt: new Date() };
      if (status === "PUBLISHED") updateData.publishedAt = new Date();

      await db.update(studioItems).set(updateData).where(eq(studioItems.id, itemId));

      await logAudit(item.accountId, "STUDIO_ITEM_STATUS_CHANGED", {
        details: { itemId, previousStatus: item.status, newStatus: status },
      });

      res.json({ success: true, itemId, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
