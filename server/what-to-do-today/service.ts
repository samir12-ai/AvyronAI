/**
 * What To Do Today — Daily Execution Service
 * 
 * Manages daily plan generation, idempotency, persistence, task lifecycle,
 * and rolling channel coverage tracking.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { buildExecutionPlanningContext } from "./context-builder";
import { generateValidatedDailyPlan } from "./judge";
import { TaskStatus, DailyPlanDraft, ExecutionPlanningContext } from "./contracts";
import { resolveExecutionPlan } from "../orchestrator/execution-plan-resolver";
import { logger } from "../logger";

export type HydratedExecutionTask = schema.DailyExecutionTaskRow & {
  channelMode?: string;
  laneTitle?: string;
  buyingTension?: string;
  funnelStage?: string;
  proofRequirement?: string;
  conversionAction?: string;
  destinationUrl?: string;
  sourceStrategyVersion?: number;
};

export interface ExecutionDayPayload {
  executionDayId: string;
  campaignId: string;
  accountId: string;
  businessDate: string;
  strategyRootId: string;
  strategyRootVersion: number | null;
  rootBundleId?: string;
  rootBundleVersion?: number;
  strategicPlanId: string;
  strategicPlanVersion: number;
  strategyName: string;
  dailyMission: string;
  executionRationale: string;
  status: string;
  primaryChannel: string;
  primaryChannelMode?: string;
  tasks: Array<HydratedExecutionTask>;
  tasksByPriority: {
    mustDo: Array<HydratedExecutionTask>;
    shouldDo: Array<HydratedExecutionTask>;
    optional: Array<HydratedExecutionTask>;
    waitingBlocked: Array<HydratedExecutionTask>;
    completed: Array<HydratedExecutionTask>;
  };
  channelPlan: Array<{
    channel: string;
    channelName?: string;
    mode?: string;
    channelMode?: string;
    role: string;
    allocationPct?: number;
    monthlyAmount?: number;
    currency?: string;
    executionIntent: string;
    whyToday: string;
    currentTaskTitle?: string | null;
    coverageState: string;
    recentTaskCount?: number;
    recentCompletedTaskCount?: number;
  }>;
  rejectedPaidChannels?: string[];
  rejectedOrganicChannels?: string[];
  generatedAt: string;
}

export class WhatToDoTodayService {
  private static inFlightGenerations = new Map<string, Promise<ExecutionDayPayload>>();

  /**
   * Retrieves existing execution day for the given date, or generates and persists a new one.
   * STRICT IDEMPOTENCY & LINEAGE PINNING: For (campaignId, businessDate, strategicPlanId, strategyRootId, rootBundleId),
   * repeated calls return the same executionDayId; if the active strategy plan changed, stale days are superseded.
   */
  static async getOrCreateTodayPlan(
    campaignId: string,
    businessDateInput?: string,
    forceRegenerate: boolean = false,
    accountIdParam?: string
  ): Promise<ExecutionDayPayload> {
    const businessDate = businessDateInput || new Date().toISOString().split("T")[0];
    const lockKey = `${campaignId}::${businessDate}`;

    if (!forceRegenerate && this.inFlightGenerations.has(lockKey)) {
      return this.inFlightGenerations.get(lockKey)!;
    }

    const runPromise = this._getOrCreateTodayPlanInternal(campaignId, businessDate, forceRegenerate, accountIdParam);
    this.inFlightGenerations.set(lockKey, runPromise);
    try {
      return await runPromise;
    } finally {
      this.inFlightGenerations.delete(lockKey);
    }
  }

  private static async _getOrCreateTodayPlanInternal(
    campaignId: string,
    businessDate: string,
    forceRegenerate: boolean,
    accountIdParam?: string
  ): Promise<ExecutionDayPayload> {
    // 1. Build Bounded Execution Planning Context from Designated Active Plan
    const context = await buildExecutionPlanningContext(campaignId, businessDate, accountIdParam);

    // 2. Check existing execution_days rows for this date (or latest in Demo Mode)
    const conditions = [
      eq(schema.executionDays.campaignId, campaignId),
      eq(schema.executionDays.businessDate, businessDate),
    ];
    if (accountIdParam) {
      conditions.push(eq(schema.executionDays.accountId, accountIdParam));
    }
    let existingDays = await db
      .select()
      .from(schema.executionDays)
      .where(and(...conditions))
      .orderBy(desc(schema.executionDays.generationVersion), desc(schema.executionDays.createdAt));

    if (existingDays.length === 0 && process.env.AVYRON_DEMO_MODE === "1" && !forceRegenerate) {
      existingDays = await db
        .select()
        .from(schema.executionDays)
        .where(eq(schema.executionDays.campaignId, campaignId))
        .orderBy(desc(schema.executionDays.generationVersion), desc(schema.executionDays.createdAt))
        .limit(1);
    }

    const approvedPlatformsSet = new Set(context.channelHierarchy.approvedChannels.map(c => c.platform));

    const expectedDomain = (context.productUrl || context.funnelJourney?.destinationUrl || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "")
      .toLowerCase();
    const expectedCtaLower = String(context.funnelJourney?.ctaPrimary || "").toLowerCase();

    const isTaskSetAlignedWithStrategy = (dayTasks: schema.DailyExecutionTaskRow[]) => {
      if (dayTasks.length === 0) return false;
      const hasPrimaryChannelTask = dayTasks.some(t => t.channel === context.channelHierarchy.primaryChannel);
      const hasUnapprovedChannelTask = dayTasks.some(t => !approvedPlatformsSet.has(t.channel as any));
      const hasUngroundedCtaDestination = dayTasks.some(t => {
        const destLower = String(t.ctaDestination || "").toLowerCase();
        if (!destLower) return true;
        if (expectedDomain && destLower.includes(expectedDomain)) return false;
        if (expectedCtaLower && destLower.includes(expectedCtaLower)) return false;
        return Boolean(expectedDomain || expectedCtaLower);
      });
      return hasPrimaryChannelTask && !hasUnapprovedChannelTask && !hasUngroundedCtaDestination;
    };

    if (!forceRegenerate && existingDays.length > 0) {
      for (const candidateDay of existingDays) {
        if (candidateDay.status === "SUPERSEDED" || candidateDay.status === "ARCHIVED") {
          continue;
        }
        const lineageMatches =
          candidateDay.strategicPlanId === context.strategicPlanId &&
          candidateDay.strategyRootId === context.strategyRootId &&
          candidateDay.rootBundleId === context.rootBundleId;

        if (lineageMatches) {
          const dayTasks = await db
            .select()
            .from(schema.dailyExecutionTasks)
            .where(eq(schema.dailyExecutionTasks.executionDayId, candidateDay.id));

          if (isTaskSetAlignedWithStrategy(dayTasks)) {
            logger.info(`[WhatToDoToday] Returning lineage-verified execution day ${candidateDay.id} for date ${businessDate}`);
            return this.hydrateExecutionDayPayload(candidateDay, context);
          }
        }
      }
    }

    // 3. Generate Validated Daily Plan (Generator -> Semantic Judge -> Targeted Repair)
    const { plan, judgeReport, attempts } = await generateValidatedDailyPlan(context);
    logger.info(`[WhatToDoToday] Validated plan created in ${attempts} attempt(s) with Judge score ${judgeReport.score}`);

    // 4. Durable DB-level concurrency/idempotency lock + active plan version re-verification before commit
    const committedDay = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${campaignId}), hashtext(${businessDate}))`);

      // Re-verify active designated plan version before committing tasks
      const [currentActivePlan] = await tx
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.campaignId, campaignId),
            eq(schema.strategicPlans.isDesignatedActive, true),
            eq(schema.strategicPlans.status, "APPROVED")
          )
        )
        .orderBy(desc(schema.strategicPlans.version), desc(schema.strategicPlans.createdAt))
        .limit(1);

      if (
        !currentActivePlan ||
        currentActivePlan.id !== context.strategicPlanId ||
        (currentActivePlan.version || 1) !== context.strategicPlanVersion
      ) {
        throw new Error(
          `STALE_STRATEGY_GENERATION_ABORTED: Active plan changed during generation (expected ${context.strategicPlanId} v${context.strategicPlanVersion}, found ${currentActivePlan?.id || "none"} v${currentActivePlan?.version || 0}).`
        );
      }

      // Re-query execution_days inside the transaction lock for cross-worker idempotency
      const lockedDays = await tx
        .select()
        .from(schema.executionDays)
        .where(and(...conditions))
        .orderBy(desc(schema.executionDays.generationVersion), desc(schema.executionDays.createdAt));

      if (!forceRegenerate && lockedDays.length > 0) {
        for (const candidateDay of lockedDays) {
          if (candidateDay.status === "SUPERSEDED" || candidateDay.status === "ARCHIVED") {
            continue;
          }
          const lineageMatches =
            candidateDay.strategicPlanId === context.strategicPlanId &&
            candidateDay.strategyRootId === context.strategyRootId &&
            candidateDay.rootBundleId === context.rootBundleId;

          if (lineageMatches) {
            const dayTasks = await tx
              .select()
              .from(schema.dailyExecutionTasks)
              .where(eq(schema.dailyExecutionTasks.executionDayId, candidateDay.id));

            if (isTaskSetAlignedWithStrategy(dayTasks)) {
              logger.info(`[WhatToDoToday] Returning concurrent lineage-verified execution day ${candidateDay.id} for date ${businessDate}`);
              return candidateDay;
            }
          }
        }
      }

      // Supersede any stale/mismatched execution_days for this date while preserving DONE tasks
      let nextGenVersion = 1;
      for (const oldDay of lockedDays) {
        if (oldDay.generationVersion >= nextGenVersion) {
          nextGenVersion = oldDay.generationVersion + 1;
        }
        if (oldDay.status !== "SUPERSEDED") {
          await tx
            .update(schema.executionDays)
            .set({ status: "SUPERSEDED", updatedAt: new Date() })
            .where(eq(schema.executionDays.id, oldDay.id));

          const oldTasks = await tx
            .select({ id: schema.dailyExecutionTasks.id, status: schema.dailyExecutionTasks.status })
            .from(schema.dailyExecutionTasks)
            .where(eq(schema.dailyExecutionTasks.executionDayId, oldDay.id));

          for (const ot of oldTasks) {
            if (ot.status !== "DONE" && ot.status !== "COMPLETED") {
              await tx
                .update(schema.dailyExecutionTasks)
                .set({ status: "STALE", updatedAt: new Date() })
                .where(eq(schema.dailyExecutionTasks.id, ot.id));
            }
          }
        }
      }

      // Persist Execution Day
      const [insertedDay] = await tx
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
          generationVersion: nextGenVersion,
        })
        .returning();

      // Persist Tasks
      const taskValues = plan.tasks.map((t, idx) => ({
        executionDayId: insertedDay.id,
        campaignId: context.campaignId,
        strategyRootId: context.strategyRootId,
        laneId: t.laneId || context.approvedLanes[0]?.laneId || null,
        title: t.title,
        description: t.description,
        taskType: t.taskType,
        priority: t.priority,
        status: t.priority === "WAITING_BLOCKED" ? "BLOCKED" : "PLANNED",
        channel: t.channel,
        channelRole: t.channel === context.channelHierarchy.primaryChannel ? "PRIMARY" : "SUPPORTING",
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
        await tx.insert(schema.dailyExecutionTasks).values(taskValues);
      }

      // Update Channel Coverage Rolling Memory (strictly for approved channels)
      const existingCoverages = await tx
        .select()
        .from(schema.executionChannelCoverage)
        .where(eq(schema.executionChannelCoverage.campaignId, context.campaignId));

      for (const cov of existingCoverages) {
        if (!approvedPlatformsSet.has(cov.channel as any)) {
          await tx
            .delete(schema.executionChannelCoverage)
            .where(eq(schema.executionChannelCoverage.id, cov.id));
        }
      }

      for (const cp of plan.channelPlan) {
        const existingCoverage = existingCoverages.find(c => c.channel === cp.channel);
        const hasActiveTask = plan.tasks.some(t => t.channel === cp.channel && t.priority !== "WAITING_BLOCKED");

        if (existingCoverage) {
          await tx
            .update(schema.executionChannelCoverage)
            .set({
              strategicRole: cp.role,
              lastExecutionDate: hasActiveTask ? businessDate : existingCoverage.lastExecutionDate,
              recentTaskCount: existingCoverage.recentTaskCount + (hasActiveTask ? 1 : 0),
              currentCoverageState: cp.coverageState,
              executionDayId: insertedDay.id,
              updatedAt: new Date(),
            })
            .where(eq(schema.executionChannelCoverage.id, existingCoverage.id));
        } else {
          await tx.insert(schema.executionChannelCoverage).values({
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

      return insertedDay;
    });

    return this.hydrateExecutionDayPayload(committedDay, context);
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
  private static async hydrateExecutionDayPayload(
    day: schema.ExecutionDayRow,
    contextParam?: ExecutionPlanningContext
  ): Promise<ExecutionDayPayload> {
    const context =
      contextParam ||
      (await buildExecutionPlanningContext(day.campaignId, day.businessDate, day.accountId));

    const rawTasks = await db
      .select()
      .from(schema.dailyExecutionTasks)
      .where(eq(schema.dailyExecutionTasks.executionDayId, day.id))
      .orderBy(schema.dailyExecutionTasks.sequenceOrder);

    const primaryChannel = context.channelHierarchy.primaryChannel;
    const primaryChannelMode = context.channelHierarchy.primaryChannelMode;
    const strategyName = context.strategyName;

    const tasks: Array<HydratedExecutionTask> = rawTasks.map(t => {
      const chDec =
        context.channelHierarchy.approvedChannels.find(c => c.platform === t.channel) ||
        context.channelHierarchy.approvedChannels[0];
      const laneCtx =
        context.approvedLanes.find(l => l.laneId === t.laneId) ||
        context.approvedLanes[0];
      const stageIdx = t.channel === primaryChannel ? Math.min(1, Math.max(0, (laneCtx?.funnelStages?.length || 1) - 1)) : 0;
      const stageCtx = laneCtx?.funnelStages?.[stageIdx] || laneCtx?.funnelStages?.[0];

      const lanePrimaryCta =
        laneCtx?.primaryCta ||
        stageCtx?.cta ||
        context.funnelJourney?.ctaPrimary ||
        "Start Your Free Song Trial";
      const rawCtaDest = String(t.ctaDestination || "").trim();
      const hydratedCtaDest =
        !rawCtaDest
          ? `${lanePrimaryCta}${context.productUrl ? ` (${context.productUrl})` : ""}`
          : /^https?:\/\/\S+$/i.test(rawCtaDest)
            ? `${lanePrimaryCta} (${rawCtaDest})`
            : rawCtaDest;

      return {
        ...t,
        ctaDestination: hydratedCtaDest,
        channelMode: chDec?.mode || primaryChannelMode,
        laneTitle: laneCtx?.title || (laneCtx as any)?.laneTitle || t.laneId || undefined,
        buyingTension: laneCtx?.buyingTension || laneCtx?.primaryPain || undefined,
        funnelStage: stageCtx?.stageName || "Consideration & Preview Validation",
        proofRequirement:
          t.proofRequired ||
          (stageCtx as any)?.proofRequirement ||
          laneCtx?.proofRequirements?.[0] ||
          undefined,
        conversionAction:
          stageCtx?.conversionAction ||
          laneCtx?.conversionAction ||
          undefined,
        destinationUrl: context.productUrl || t.ctaDestination || undefined,
        sourceStrategyVersion: context.strategicPlanVersion,
      };
    });

    // Group tasks by customer-facing sections
    const mustDo = tasks.filter(t => t.priority === "MUST_DO" && t.status !== "DONE" && t.status !== "STALE");
    const shouldDo = tasks.filter(t => t.priority === "SHOULD_DO" && t.status !== "DONE" && t.status !== "STALE");
    const optional = tasks.filter(t => t.priority === "OPTIONAL" && t.status !== "DONE" && t.status !== "STALE");
    const waitingBlocked = tasks.filter(t => (t.priority === "WAITING_BLOCKED" || t.status === "BLOCKED") && t.status !== "STALE");
    const completed = tasks.filter(t => t.status === "DONE");

    // Fetch channel coverage
    const coverages = await db
      .select()
      .from(schema.executionChannelCoverage)
      .where(eq(schema.executionChannelCoverage.campaignId, day.campaignId));

    const channelPlan = context.channelHierarchy.approvedChannels.map(chDec => {
      const ch = chDec.platform;
      const cov = coverages.find(c => c.channel === ch);
      const chTask = tasks.find(t => t.channel === ch && t.status !== "STALE");
      const isPrimary = ch === primaryChannel;

      return {
        channel: ch,
        channelName: chDec.channelName,
        mode: chDec.mode,
        channelMode: chDec.mode,
        role: isPrimary ? "PRIMARY" : "SUPPORTING",
        allocationPct: chDec.allocationPct,
        monthlyAmount: chDec.monthlyAmount,
        currency: chDec.currency,
        executionIntent:
          chDec.rationale ||
          (isPrimary
            ? `Primary ${chDec.mode.toLowerCase()} proof anchor and emotional storytelling hub (${chDec.allocationPct ?? 60}% effort share)`
            : `Supporting ${chDec.mode.toLowerCase()} discovery and reach engine (${chDec.allocationPct ?? 40}% effort share)`),
        whyToday: chTask
          ? (chTask.priority === "WAITING_BLOCKED" ? "Staged to run once primary proof asset is created" : `Active ${chDec.mode.toLowerCase()} task executing today`)
          : "Staged in coverage rotation",
        currentTaskTitle: chTask?.title || null,
        coverageState: cov?.currentCoverageState || (chTask ? "ACTIVE" : "ROTATION_DUE"),
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
      strategyRootVersion: context.strategyRootVersion,
      rootBundleId: day.rootBundleId,
      rootBundleVersion: context.rootBundleVersion,
      strategicPlanId: day.strategicPlanId,
      strategicPlanVersion: context.strategicPlanVersion,
      strategyName,
      dailyMission: day.dailyMission,
      executionRationale: day.executionRationale || "",
      status: day.status,
      primaryChannel,
      primaryChannelMode,
      tasks,
      tasksByPriority: {
        mustDo,
        shouldDo,
        optional,
        waitingBlocked,
        completed,
      },
      channelPlan,
      rejectedPaidChannels: context.channelHierarchy.rejectedPaidChannels,
      rejectedOrganicChannels: context.channelHierarchy.rejectedOrganicChannels,
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
