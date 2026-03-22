import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { executionTasks, strategicPlans, requiredWork } from "../shared/schema";

interface TaskTemplate {
  taskType: string;
  title: string;
  description: string;
  category: string;
  priority: string;
}

function generateTasksFromPlan(planData: any, periodDays: number): TaskTemplate[] {
  const tasks: TaskTemplate[] = [];
  const weeks = Math.ceil(periodDays / 7);

  const dist = planData?.contentDistribution;
  if (!dist) return tasks;

  for (let w = 1; w <= weeks; w++) {
    if (dist.reelsPerWeek > 0) {
      tasks.push({
        taskType: "content_production",
        title: `Write ${dist.reelsPerWeek} reel scripts`,
        description: `Script writing for Week ${w} reels based on content pillars`,
        category: "scripting",
        priority: w === 1 ? "high" : "normal",
      });
      tasks.push({
        taskType: "content_production",
        title: `Record ${dist.reelsPerWeek} reels`,
        description: `Film and edit reels for Week ${w}`,
        category: "filming",
        priority: "normal",
      });
    }

    if (dist.carouselsPerWeek > 0) {
      tasks.push({
        taskType: "content_production",
        title: `Design ${dist.carouselsPerWeek} carousels`,
        description: `Create carousel designs for Week ${w}`,
        category: "design",
        priority: "normal",
      });
    }

    if (dist.postsPerWeek > 0) {
      tasks.push({
        taskType: "content_production",
        title: `Create ${dist.postsPerWeek} posts`,
        description: `Write and design feed posts for Week ${w}`,
        category: "creation",
        priority: "normal",
      });
    }

    if (w === 1) {
      tasks.push({
        taskType: "launch",
        title: "Launch initial ad sets",
        description: "Set up and launch the first round of paid promotion",
        category: "ads",
        priority: "high",
      });
    }

    if (w > 1) {
      tasks.push({
        taskType: "optimization",
        title: `Week ${w} performance review`,
        description: `Review metrics, adjust content mix if needed`,
        category: "review",
        priority: w % 2 === 0 ? "high" : "normal",
      });
    }

    tasks.push({
      taskType: "engagement",
      title: `Respond to inbound leads/messages`,
      description: `Answer DMs, comments, and WhatsApp inquiries for Week ${w}`,
      category: "community",
      priority: "high",
    });

    tasks.push({
      taskType: "review",
      title: `Weekly review & planning`,
      description: `Analyze Week ${w} performance and plan adjustments`,
      category: "planning",
      priority: "normal",
    });
  }

  return tasks;
}

export async function composeTasks(
  planId: string,
  campaignId: string,
  accountId: string,
  planData: any,
  periodDays: number,
  rootBundleId: string | null = null
) {
  await db.delete(executionTasks).where(and(
    eq(executionTasks.planId, planId),
    eq(executionTasks.campaignId, campaignId)
  ));

  const templates = generateTasksFromPlan(planData, periodDays);
  if (templates.length === 0) return [];

  const weeks = Math.ceil(periodDays / 7);
  let sortOrder = 0;
  let taskIdx = 0;

  const values = templates.map((t, i) => {
    const weekNum = Math.min(Math.floor(i / (templates.length / weeks)) + 1, weeks);
    const dayInWeek = (i % 7) + 1;
    const dayNum = (weekNum - 1) * 7 + dayInWeek;
    sortOrder++;

    return {
      planId,
      campaignId,
      accountId,
      rootBundleId,
      taskType: t.taskType,
      dayNumber: Math.min(dayNum, periodDays),
      weekNumber: weekNum,
      title: t.title,
      description: t.description,
      category: t.category,
      priority: t.priority,
      status: "pending",
      sortOrder,
    };
  });

  await db.insert(executionTasks).values(values);
  console.log(`[TaskComposer] Generated ${values.length} tasks for plan ${planId}`);
  return values;
}

export function registerTaskComposerRoutes(app: Express) {
  app.get("/api/execution-tasks/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const [plan] = await db.select().from(strategicPlans)
        .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, req.params.campaignId)))
        .orderBy(desc(strategicPlans.createdAt)).limit(1);

      if (!plan) return res.json({ hasTasks: false, tasks: [] });

      const tasks = await db.select().from(executionTasks)
        .where(and(eq(executionTasks.planId, plan.id), eq(executionTasks.campaignId, req.params.campaignId)));

      const today = tasks.filter(t => t.dayNumber === 1 || t.priority === "high");
      const thisWeek = tasks.filter(t => t.weekNumber === 1);
      const blocked = tasks.filter(t => t.status === "blocked");
      const pending = tasks.filter(t => t.status === "pending");

      res.json({
        hasTasks: tasks.length > 0,
        planId: plan.id,
        total: tasks.length,
        byStatus: {
          pending: pending.length,
          inProgress: tasks.filter(t => t.status === "in_progress").length,
          completed: tasks.filter(t => t.status === "completed").length,
          blocked: blocked.length,
        },
        today: today.slice(0, 5).map(t => ({ id: t.id, title: t.title, type: t.taskType, priority: t.priority, status: t.status })),
        thisWeek: thisWeek.map(t => ({ id: t.id, title: t.title, type: t.taskType, day: t.dayNumber, priority: t.priority, status: t.status, category: t.category })),
        allTasks: tasks.map(t => ({
          id: t.id, title: t.title, description: t.description, type: t.taskType,
          day: t.dayNumber, week: t.weekNumber, priority: t.priority, status: t.status, category: t.category,
        })),
      });
    } catch (err: any) {
      console.error("[TaskComposer] Fetch error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/execution-tasks/:taskId/status", async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      const valid = ["pending", "in_progress", "completed", "blocked", "cancelled"];
      if (!valid.includes(status)) return res.status(400).json({ error: `Invalid status. Use: ${valid.join(", ")}` });

      await db.update(executionTasks)
        .set({ status, updatedAt: new Date() })
        .where(eq(executionTasks.id, req.params.taskId));

      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/execution-tasks/generate", async (req: Request, res: Response) => {
    try {
      const { campaignId, planId } = req.body;
      if (!campaignId || !planId) return res.status(400).json({ error: "campaignId and planId required" });
      const accountId = req.body.accountId || "default";

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      const planData = plan.planJson ? JSON.parse(plan.planJson) : null;
      const [work] = await db.select().from(requiredWork).where(eq(requiredWork.planId, planId)).limit(1);
      const periodDays = work?.periodDays || 30;

      const tasks = await composeTasks(planId, campaignId, accountId, planData, periodDays, plan.rootBundleId);
      res.json({ success: true, count: tasks.length });
    } catch (err: any) {
      console.error("[TaskComposer] Generate error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[TaskComposer] Routes registered");
}
