/**
 * What To Do Today — Daily Execution Service
 * 
 * Manages daily plan generation, idempotency, persistence, task lifecycle,
 * and rolling channel coverage tracking.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { buildExecutionPlanningContext } from "./context-builder";
import { generateValidatedDailyPlan } from "./judge";
import { TaskStatus, DailyPlanDraft } from "./contracts";
import { logger } from "../logger";

export interface ExecutionDayPayload {
  executionDayId: string;
  campaignId: string;
  accountId: string;
  businessDate: string;
  strategyRootId: string;
  strategyRootVersion: number;
  strategicPlanId: string;
  strategicPlanVersion: number;
  strategyName: string;
  dailyMission: string;
  executionRationale: string;
  status: string;
  primaryChannel: string;
  tasks: Array<schema.DailyExecutionTaskRow>;
  tasksByPriority: {
    mustDo: Array<schema.DailyExecutionTaskRow>;
    shouldDo: Array<schema.DailyExecutionTaskRow>;
    optional: Array<schema.DailyExecutionTaskRow>;
    waitingBlocked: Array<schema.DailyExecutionTaskRow>;
    completed: Array<schema.DailyExecutionTaskRow>;
  };
  channelPlan: Array<{
    channel: string;
    role: string;
    executionIntent: string;
    whyToday: string;
    currentTaskTitle?: string | null;
    coverageState: string;
    recentTaskCount?: number;
    recentCompletedTaskCount?: number;
  }>;
  generatedAt: string;
}

export class WhatToDoTodayService {
  /**
   * Retrieves existing execution day for the given date, or generates and persists a new one.
   * STRICT IDEMPOTENCY: For (campaignId, businessDate), repeated calls return the same executionDayId.
   */
  static async getOrCreateTodayPlan(
    campaignId: string,
    businessDateInput?: string,
    forceRegenerate: boolean = false
  ): Promise<ExecutionDayPayload> {
    const businessDate = businessDateInput || new Date().toISOString().split("T")[0];

    // 1. Check if execution day already exists for this date
    if (!forceRegenerate) {
      const [existingDay] = await db
        .select()
        .from(schema.executionDays)
        .where(
          and(
            eq(schema.executionDays.campaignId, campaignId),
            eq(schema.executionDays.businessDate, businessDate)
          )
        )
        .orderBy(desc(schema.executionDays.generationVersion))
        .limit(1);

      if (existingDay) {
        logger.info(`[WhatToDoToday] Returning existing execution day ${existingDay.id} for date ${businessDate}`);
        return this.hydrateExecutionDayPayload(existingDay);
      }
    }

    // 2. Build Bounded Execution Planning Context
    const context = await buildExecutionPlanningContext(campaignId, businessDate);

    // 3. Generate Validated Daily Plan (Generator -> Semantic Judge -> Targeted Repair)
    const { plan, judgeReport, attempts } = await generateValidatedDailyPlan(context);
    logger.info(`[WhatToDoToday] Validated plan created in ${attempts} attempt(s) with Judge score ${judgeReport.score}`);

    // 4. Persist Execution Day
    const [insertedDay] = await db
      .insert(schema.executionDays)
      .values({
        accountId: context.accountId,
        campaignId: context.campaignId,
        businessDate: context.businessDate,
        strategyRootId: context.strategyRootId,
        rootBundleId: context.rootBundleId,
        strategicPlanId: context.strategicPlanId,
        dailyMission: plan.dailyMission,
        executionRationale: plan.executionRationale,
        status: "ACTIVE",
        generationVersion: 1,
      })
      .returning();

    // 5. Persist Tasks
    const taskValues = plan.tasks.map((t, idx) => ({
      executionDayId: insertedDay.id,
      campaignId: context.campaignId,
      strategyRootId: context.strategyRootId,
      laneId: t.laneId || null,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
      status: t.priority === "WAITING_BLOCKED" ? "BLOCKED" : "PLANNED",
      channel: t.channel,
      channelRole: t.channelRole,
      objective: t.objective,
      reason: t.reason,
      expectedOutcome: t.expectedOutcome,
      sourceAuthority: t.sourceAuthority,
      sourceDecisionIds: t.sourceDecisionIds || [],
      estimatedEffort: t.estimatedEffort,
      sequenceOrder: idx + 1,
      dependencies: t.dependencies || [],
      executionApproach: t.executionApproach,
      proofRequired: t.proofRequired,
      ctaDestination: t.ctaDestination,
    }));

    if (taskValues.length > 0) {
      await db.insert(schema.dailyExecutionTasks).values(taskValues);
    }

    // 6. Update Channel Coverage Rolling Memory
    for (const cp of plan.channelPlan) {
      const existingCoverage = await db
        .select()
        .from(schema.executionChannelCoverage)
        .where(
          and(
            eq(schema.executionChannelCoverage.campaignId, context.campaignId),
            eq(schema.executionChannelCoverage.channel, cp.channel)
          )
        )
        .limit(1);

      const hasActiveTask = plan.tasks.some(t => t.channel === cp.channel && t.priority !== "WAITING_BLOCKED");

      if (existingCoverage.length > 0) {
        await db
          .update(schema.executionChannelCoverage)
          .set({
            strategicRole: cp.role,
            lastExecutionDate: hasActiveTask ? businessDate : existingCoverage[0].lastExecutionDate,
            recentTaskCount: existingCoverage[0].recentTaskCount + (hasActiveTask ? 1 : 0),
            currentCoverageState: cp.coverageState,
            executionDayId: insertedDay.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.executionChannelCoverage.id, existingCoverage[0].id));
      } else {
        await db.insert(schema.executionChannelCoverage).values({
          campaignId: context.campaignId,
          channel: cp.channel,
          strategicRole: cp.role,
          lastExecutionDate: hasActiveTask ? businessDate : null,
          recentTaskCount: hasActiveTask ? 1 : 0,
          recentCompletedTaskCount: 0,
          currentCoverageState: cp.coverageState,
          executionDayId: insertedDay.id,
        });
      }
    }

    return this.hydrateExecutionDayPayload(insertedDay);
  }

  /**
   * Updates task lifecycle status (e.g. PLANNED -> ACTIVE -> DONE).
   */
  static async updateTaskStatus(taskId: string, status: TaskStatus): Promise<schema.DailyExecutionTaskRow> {
    const completedAt = status === "DONE" ? new Date() : null;

    const [updatedTask] = await db
      .update(schema.dailyExecutionTasks)
      .set({
        status,
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.dailyExecutionTasks.id, taskId))
      .returning();

    if (!updatedTask) {
      throw new Error(`TASK_NOT_FOUND: Execution task ${taskId} does not exist.`);
    }

    // If completed, bump channel coverage completed count
    if (status === "DONE") {
      const [coverage] = await db
        .select()
        .from(schema.executionChannelCoverage)
        .where(
          and(
            eq(schema.executionChannelCoverage.campaignId, updatedTask.campaignId),
            eq(schema.executionChannelCoverage.channel, updatedTask.channel)
          )
        )
        .limit(1);

      if (coverage) {
        await db
          .update(schema.executionChannelCoverage)
          .set({
            recentCompletedTaskCount: coverage.recentCompletedTaskCount + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.executionChannelCoverage.id, coverage.id));
      }
    }

    return updatedTask;
  }

  /**
   * Hydrates full ExecutionDayPayload with tasks and channel ecosystem.
   */
  private static async hydrateExecutionDayPayload(day: schema.ExecutionDayRow): Promise<ExecutionDayPayload> {
    const tasks = await db
      .select()
      .from(schema.dailyExecutionTasks)
      .where(eq(schema.dailyExecutionTasks.executionDayId, day.id))
      .orderBy(schema.dailyExecutionTasks.sequenceOrder);

    // Group tasks by customer-facing sections
    const mustDo = tasks.filter(t => t.priority === "MUST_DO" && t.status !== "DONE");
    const shouldDo = tasks.filter(t => t.priority === "SHOULD_DO" && t.status !== "DONE");
    const optional = tasks.filter(t => t.priority === "OPTIONAL" && t.status !== "DONE");
    const waitingBlocked = tasks.filter(t => t.priority === "WAITING_BLOCKED" || t.status === "BLOCKED");
    const completed = tasks.filter(t => t.status === "DONE");

    // Fetch channel coverage
    const coverages = await db
      .select()
      .from(schema.executionChannelCoverage)
      .where(eq(schema.executionChannelCoverage.campaignId, day.campaignId));

    // Resolve Strategy Root & Bundle version
    const [root] = await db.select().from(schema.strategyRoots).where(eq(schema.strategyRoots.id, day.strategyRootId)).limit(1);
    const [bundle] = await db.select().from(schema.rootBundles).where(eq(schema.rootBundles.id, day.rootBundleId)).limit(1);
    const [plan] = await db.select().from(schema.strategicPlans).where(eq(schema.strategicPlans.id, day.strategicPlanId)).limit(1);

    let mechName = "Market Intelligence Simplicity and Ease";
    try {
      const mech = typeof root?.approvedMechanism === "string" ? JSON.parse(root.approvedMechanism) : root?.approvedMechanism;
      if (mech?.mechanismName) mechName = mech.mechanismName;
    } catch {}

    const primaryTask = tasks.find(t => t.channelRole === "PRIMARY");
    const primaryChannel = primaryTask?.channel || "YOUTUBE";

    const coreChannels = ["YOUTUBE", "INSTAGRAM", "TIKTOK", "FACEBOOK", "X"];
    const channelPlan = coreChannels.map(ch => {
      const cov = coverages.find(c => c.channel === ch);
      const chTask = tasks.find(t => t.channel === ch);
      const isPrimary = ch === primaryChannel;

      return {
        channel: ch,
        role: isPrimary ? "PRIMARY" : "SUPPORTING",
        executionIntent: isPrimary
          ? "Primary proof anchor and authority demonstration"
          : `Native supporting execution of ${mechName}`,
        whyToday: chTask
          ? (chTask.priority === "WAITING_BLOCKED" ? "Staged to run once primary proof asset is created" : "Active native task executing today")
          : "Staged in coverage rotation",
        currentTaskTitle: chTask?.title || null,
        coverageState: cov?.currentCoverageState || (chTask ? "ACTIVE" : "PENDING_PREREQUISITE"),
        recentTaskCount: cov?.recentTaskCount || (chTask ? 1 : 0),
        recentCompletedTaskCount: cov?.recentCompletedTaskCount || 0,
      };
    });

    return {
      executionDayId: day.id,
      campaignId: day.campaignId,
      accountId: day.accountId,
      businessDate: day.businessDate,
      strategyRootId: day.strategyRootId,
      strategyRootVersion: bundle?.version || 56,
      strategicPlanId: day.strategicPlanId,
      strategicPlanVersion: plan?.version || 1,
      strategyName: mechName,
      dailyMission: day.dailyMission,
      executionRationale: day.executionRationale || "",
      status: day.status,
      primaryChannel,
      tasks,
      tasksByPriority: {
        mustDo,
        shouldDo,
        optional,
        waitingBlocked,
        completed,
      },
      channelPlan,
      generatedAt: day.generatedAt ? day.generatedAt.toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Retrieves execution days history for a campaign.
   */
  static async getExecutionDaysHistory(campaignId: string): Promise<Array<schema.ExecutionDayRow>> {
    return db
      .select()
      .from(schema.executionDays)
      .where(eq(schema.executionDays.campaignId, campaignId))
      .orderBy(desc(schema.executionDays.businessDate));
  }
}
