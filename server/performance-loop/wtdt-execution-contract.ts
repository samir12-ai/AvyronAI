/**
 * Avyron — WTDT Execution Contract for Performance.
 *
 * DOCTRINE:
 * 1. What To Do Today tells Performance: WHAT WAS SUPPOSED TO HAPPEN.
 * 2. Performance observes: WHAT ACTUALLY HAPPENED.
 * 3. Reasoning explains: WHY THERE IS A GAP.
 * 4. READ-ONLY CONTRACT: WTDT -> Performance is strictly read-only execution context.
 *    Performance must NOT modify strategic meaning inside WTDT.
 * 5. Execution Contract provides:
 *    - taskId, campaignId, laneId, channel, contentType, contentObjective,
 *    - audience, painDesire, proofIntent, offerContext, ctaIntent, funnelRole,
 *    - dueDate, requiredQuantity, matchedQuantity, remainingQuantity,
 *    - strategyRootId, sourceDecisionIds / execution signal lineage.
 */

import { db } from "../db";
import { dailyExecutionTasks, type DailyExecutionTaskRow } from "@shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";

export interface WTDTExecutionExpectation {
  taskId: string;
  campaignId: string;
  laneId: string | null;
  channel: string;
  contentType: string;
  contentObjective: string;
  audience: string | null;
  painDesire: string | null;
  proofIntent: string | null;
  offerContext: string | null;
  ctaIntent: string | null;
  funnelRole: string | null;
  dueDate: Date | null;
  requiredQuantity: number;
  matchedQuantity: number;
  remainingQuantity: number;
  executionLifecycleState: "NOT_YET_DUE" | "PARTIALLY_EXECUTED" | "EXECUTED" | "UNVERIFIED" | "NOT_EXECUTED" | "BLOCKED";
  strategyRootId: string;
  sourceDecisionIds: string[];
  sourceExecutionSignalIds: string[];
  title: string;
  description: string;
  status: string;
}

/**
 * Reads pending or active execution expectations from WTDT for a campaign.
 * Performance uses this as READ-ONLY context to evaluate what actually happened.
 */
export async function getOutstandingExecutionExpectations(
  accountId: string,
  campaignId: string
): Promise<WTDTExecutionExpectation[]> {
  const rows = await db
    .select()
    .from(dailyExecutionTasks)
    .where(and(
      eq(dailyExecutionTasks.campaignId, campaignId),
      inArray(dailyExecutionTasks.status, ["PLANNED", "ACTIVE", "MUST_DO", "SHOULD_DO"])
    ))
    .orderBy(desc(dailyExecutionTasks.createdAt))
    .limit(20);

  return rows.map((r) => ({
    taskId: r.id,
    campaignId: r.campaignId,
    laneId: r.laneId || null,
    channel: r.channel || "WEBSITE",
    contentType: r.taskType || "CONTENT",
    contentObjective: r.objective || r.title,
    audience: (r.productionBlueprint as any)?.targetAudience || null,
    painDesire: r.reason || null,
    proofIntent: r.proofRequired || null,
    offerContext: (r.productionBlueprint as any)?.offerContext || null,
    ctaIntent: r.ctaDestination || null,
    funnelRole: (r.productionBlueprint as any)?.funnelRole || null,
    dueDate: r.dueDate || null,
    requiredQuantity: r.requiredQuantity ?? 1,
    matchedQuantity: r.matchedQuantity ?? 0,
    remainingQuantity: r.remainingQuantity ?? (r.requiredQuantity ?? 1),
    executionLifecycleState: (r.executionLifecycleState as any) || "NOT_YET_DUE",
    strategyRootId: r.strategyRootId,
    sourceDecisionIds: Array.isArray(r.sourceDecisionIds) ? (r.sourceDecisionIds as string[]) : [],
    sourceExecutionSignalIds: Array.isArray(r.sourceExecutionSignalIds) ? (r.sourceExecutionSignalIds as string[]) : [],
    title: r.title,
    description: r.description,
    status: r.status,
  }));
}

/**
 * Evaluates the lifecycle state of an execution task based on due date, timezone, and execution progress.
 */
export function computeTaskLifecycleState(params: {
  dueDate: Date | null;
  requiredQuantity: number;
  matchedQuantity: number;
  now?: Date;
}): "NOT_YET_DUE" | "PARTIALLY_EXECUTED" | "EXECUTED" | "NOT_EXECUTED" {
  const now = params.now || new Date();
  const matched = params.matchedQuantity;
  const required = Math.max(1, params.requiredQuantity);

  if (matched >= required) {
    return "EXECUTED";
  }

  if (matched > 0 && matched < required) {
    return "PARTIALLY_EXECUTED";
  }

  if (params.dueDate && now.getTime() > params.dueDate.getTime()) {
    return "NOT_EXECUTED";
  }

  return "NOT_YET_DUE";
}
