import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { executionTasks, strategicPlans, requiredWork } from "../shared/schema";
import { resolveExecutionPlan } from "./orchestrator/execution-plan-resolver";

import { resolveAccountId } from "./auth";
interface TaskTemplate {
  taskType: string;
  title: string;
  description: string;
  category: string;
  priority: string;
}

export function generateTasksFromPlan(planData: any, periodDays: number): TaskTemplate[] {
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
      const ba = planData?.budgetAllocation || {};
      const spendAction = String(
        ba?.holdPolicy?.spendAction || ba?.testingAndScalingGuidance?.spendAction || "hold",
      ).toLowerCase();
      const paidMediaBudget = Number(ba?.budgetDenominators?.paidMediaBudget || 0);
      const initialAllowance = Number(
        ba?.initialTestingAllowance?.amount ||
          ba?.testingAndScalingGuidance?.initialValidationTestBudget ||
          1000,
      );
      const reserveAmt = Number(
        ba?.unreleasedReserve?.amount ||
          ba?.testingAndScalingGuidance?.unreleasedReserveBudget ||
          4000,
      );
      const currency = ba?.currency || "USD";
      const prereqList: any[] = Array.isArray(ba?.channelPrerequisites) ? ba.channelPrerequisites : [];
      const gatedRetargeting = prereqList.find((cp: any) => cp?.readinessStatus === "PREREQUISITE_GATED");
      const eligibleInitialPaid = prereqList.find(
        (cp: any) => !cp?.isOrganic && cp?.initialTestingEligibility === "ELIGIBLE_WITHIN_1000_CARVEOUT",
      );

      if (spendAction === "hold" && paidMediaBudget > 0) {
        const primaryPaidName = eligibleInitialPaid?.channelName || "TikTok Paid Ads";
        tasks.push({
          taskType: "validation_setup",
          title: `Configure conversion tracking & controlled ${initialAllowance.toLocaleString("en-US")} ${currency} (20%) validation test on ${primaryPaidName}`,
          description: `Verify pixel/conversion tracking and deploy controlled initial validation testing up to ${initialAllowance.toLocaleString("en-US")} ${currency} (inside the ${Number(ba?.totalMonthlyBudget || 5000).toLocaleString("en-US")} ${currency} monthly envelope — not extra spend) on ${primaryPaidName} while holding ${reserveAmt.toLocaleString("en-US")} ${currency} (80%) in reserve under spendAction = hold.`,
          category: "validation",
          priority: "high",
        });
        if (gatedRetargeting) {
          tasks.push({
            taskType: "prerequisite_gate",
            title: `[PREREQUISITE GATED] Build >= ${gatedRetargeting.requiredWarmAudiencePool || 1000} engaged TikTok retargeting pool & >= ${gatedRetargeting.requiredLandingPageVisits || 1500} landing page visits before ${gatedRetargeting.channelName}`,
            description: `${gatedRetargeting.prerequisiteSummary || "Hold secondary retargeting allocation until warm audience pool (>= 1,000 engaged users), landing page traffic (>= 1,500 visits within 21 days), and conversion event measurement are verified."}`,
            category: "prerequisites",
            priority: "high",
          });
        }
      } else if (spendAction !== "hold" && paidMediaBudget > 0) {
        tasks.push({
          taskType: "launch",
          title: "Launch initial ad sets",
          description: "Set up and launch the first round of paid promotion",
          category: "ads",
          priority: "high",
        });
      }
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

export interface TaskComposerContext {
  budgetDecision?: string;
  budgetKillFlag?: boolean;
  integrityScore?: number;
  safeToExecute?: boolean;
  signalTrustedRatio?: number;
}

function applyStrategicGuards(templates: TaskTemplate[], context: TaskComposerContext): TaskTemplate[] {
  if (context.budgetKillFlag || context.budgetDecision === "halt") {
    console.log(`[TaskComposer] HALT_ENFORCED | No tasks generated — budget decision: ${context.budgetDecision}, killFlag: ${context.budgetKillFlag}`);
    return [];
  }

  let filtered = [...templates];

  if (context.budgetDecision === "hold") {
    filtered = filtered.filter(t => t.taskType !== "launch" && t.category !== "ads");
    const contentTasks = filtered.filter(t => t.taskType === "content_production");
    const nonContentTasks = filtered.filter(t => t.taskType !== "content_production");
    const reducedContent = contentTasks.filter((_, i) => i % 2 === 0);
    filtered = [...nonContentTasks, ...reducedContent].sort((a, b) => ((a as any).dayNumber || 0) - ((b as any).dayNumber || 0));
    console.log(`[TaskComposer] HOLD_RESTRICTION | Removed launch/ad tasks, reduced content by 50% | ${templates.length}→${filtered.length} tasks`);
  }

  if (context.safeToExecute === false) {
    filtered = filtered.filter(t => t.taskType !== "launch" && t.category !== "ads");
    filtered = filtered.map(t => ({
      ...t,
      title: `[REVIEW] ${t.title}`,
      description: `${t.description} — INTEGRITY WARNING: Strategy has structural concerns, review before executing`,
      priority: t.priority === "high" ? "normal" : t.priority,
    }));
    console.log(`[TaskComposer] INTEGRITY_DEGRADED | Marked tasks for review, blocked launches | safeToExecute=false score=${context.integrityScore}`);
  } else if ((context.integrityScore ?? 1) < 0.6) {
    filtered = filtered.map(t => t.taskType === "launch" ? { ...t, priority: "normal", description: `${t.description} — Note: Strategy integrity score is low (${((context.integrityScore ?? 0) * 100).toFixed(0)}%), proceed with caution` } : t);
    console.log(`[TaskComposer] INTEGRITY_CAUTION | Launch tasks deprioritized | score=${context.integrityScore}`);
  }

  if ((context.signalTrustedRatio ?? 1) < 0.3) {
    filtered = filtered.filter(t => t.taskType !== "launch");
    console.log(`[TaskComposer] LOW_TRUST_SIGNALS | Launch tasks removed — trusted signal ratio: ${((context.signalTrustedRatio ?? 0) * 100).toFixed(0)}%`);
  }

  return filtered;
}

export async function composeTasks(
  planId: string,
  campaignId: string,
  accountId: string,
  planData: any,
  periodDays: number,
  rootBundleId: string | null = null,
  strategicContext?: TaskComposerContext,
) {
  await db.delete(executionTasks).where(and(
    eq(executionTasks.planId, planId),
    eq(executionTasks.campaignId, campaignId)
  ));

  let templates = generateTasksFromPlan(planData, periodDays);

  if (strategicContext) {
    templates = applyStrategicGuards(templates, strategicContext);
  }

  let initialStatus = "pending";
  try {
    const [planRow] = await db
      .select({ status: strategicPlans.status, isDesignatedActive: strategicPlans.isDesignatedActive })
      .from(strategicPlans)
      .where(and(eq(strategicPlans.id, planId), eq(strategicPlans.accountId, accountId)))
      .limit(1);
    if (!planRow || planRow.status !== "APPROVED" || !planRow.isDesignatedActive) {
      initialStatus = "DRAFT";
    }
  } catch (err: any) {
    console.warn(`[TaskComposer] Could not verify plan active status, defaulting to DRAFT:`, err.message);
    initialStatus = "DRAFT";
  }

  const weeks = Math.ceil(periodDays / 7);
  let sortOrder = 0;

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
      status: initialStatus,
      sortOrder,
    };
  });

  if (values.length > 0) {
    await db.insert(executionTasks).values(values);
  }
  console.log(`[TaskComposer] Generated ${values.length} tasks for plan ${planId} with status ${initialStatus}`);
  return values;
}

export function registerTaskComposerRoutes(app: Express) {
  app.get("/api/execution-tasks/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId as string;
      const requestedPlanId = typeof req.query.planId === "string" && req.query.planId.trim() ? req.query.planId.trim() : null;

      let plan: typeof strategicPlans.$inferSelect | undefined;
      if (requestedPlanId) {
        [plan] = await db
          .select()
          .from(strategicPlans)
          .where(and(eq(strategicPlans.id, requestedPlanId), eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId)))
          .limit(1);
      } else {
        const resolved = await resolveExecutionPlan({
          accountId,
          campaignId,
          intent: "read",
        });
        plan = resolved.plan || undefined;
        if (!plan) {
          [plan] = await db
            .select()
            .from(strategicPlans)
            .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId)))
            .orderBy(desc(strategicPlans.isDesignatedActive), desc(strategicPlans.createdAt))
            .limit(1);
        }
      }

      if (!plan) return res.json({ hasTasks: false, tasks: [] });

      const tasks = await db.select().from(executionTasks)
        .where(and(eq(executionTasks.planId, plan.id), eq(executionTasks.campaignId, campaignId)));

      const today = tasks.filter(t => t.dayNumber === 1 || t.priority === "high");
      const thisWeek = tasks.filter(t => t.weekNumber === 1);
      const blocked = tasks.filter(t => t.status === "blocked");
      const pending = tasks.filter(t => t.status === "pending");

      res.json({
        hasTasks: tasks.length > 0,
        planId: plan.id,
        planStatus: plan.status,
        isDesignatedActive: Boolean(plan.isDesignatedActive),
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
        .where(eq(executionTasks.id, req.params.taskId as string));

      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/execution-tasks/generate", async (req: Request, res: Response) => {
    try {
      const { campaignId, planId } = req.body;
      if (!campaignId || !planId) return res.status(400).json({ error: "campaignId and planId required" });
      const accountId = resolveAccountId(req);

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      const planData = plan.planJson ? JSON.parse(plan.planJson) : null;
      const [work] = await db.select().from(requiredWork).where(eq(requiredWork.planId, planId)).limit(1);
      const periodDays = work?.periodDays || 30;

      const strategicContext: TaskComposerContext = {};

      if (plan.executionStatus === "HALTED") {
        strategicContext.budgetDecision = "halt";
        strategicContext.budgetKillFlag = true;
        console.log(`[TaskComposer] GENERATE_ENDPOINT | Plan executionStatus=HALTED — blocking task generation`);
      }

      if (planData) {
        if (planData.degraded === true && !strategicContext.budgetKillFlag) {
          const summary = planData.strategicSummary?.strategy || "";
          if (summary.includes("HALTED")) {
            strategicContext.budgetDecision = "halt";
            strategicContext.budgetKillFlag = true;
            console.log(`[TaskComposer] GENERATE_ENDPOINT | HALT detected from plan strategy summary — blocking task generation`);
          } else {
            strategicContext.safeToExecute = false;
            strategicContext.integrityScore = 0.3;
            console.log(`[TaskComposer] GENERATE_ENDPOINT | Degraded plan detected — marking tasks for review`);
          }
        }
      }

      const tasks = await composeTasks(planId, campaignId, accountId, planData, periodDays, plan.rootBundleId, strategicContext);
      res.json({ success: true, count: tasks.length });
    } catch (err: any) {
      console.error("[TaskComposer] Generate error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[TaskComposer] Routes registered");
}
