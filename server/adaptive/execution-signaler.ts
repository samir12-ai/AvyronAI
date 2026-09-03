/**
 * Adaptive Execution Signaler
 * 
 * Constitutional Principle:
 * Emits canonical ExecutionSignal rows for What To Do Today downstream consumers.
 * Identifies potentially stale execution tasks based on changed strategic authorities
 * without directly mutating daily tasks in Phase 2.
 */

import {
  ExecutionSignal,
  ExecutionSignalAction,
  ExecutionSignalPriority,
  StrategicAuthorityName,
} from "./contracts";
import { randomUUID } from "crypto";

export interface EmitSignalParams {
  campaignId: string;
  accountId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  sourceDecisionId?: string | null;
  sourceReasoningCaseId?: string | null;
  sourceEventIds?: string[];
  sourcePerformanceWarningIds?: string[];
  affectedLaneIds?: string[];
  affectedStrategyAuthorities: StrategicAuthorityName[];
  actionType: ExecutionSignalAction;
  priority?: ExecutionSignalPriority;
  metadata?: Record<string, any>;
  existingExecutionTasks?: Array<{
    taskId: string;
    authorityArtifactIds?: Record<string, string>;
    dependsOnAuthorities?: StrategicAuthorityName[];
  }>;
}

export interface StaleTaskIdentification {
  staleTaskIds: string[];
  preservedTaskIds: string[];
  reason: string;
}

/**
 * Identifies existing execution tasks that depend on invalidated authority artifacts,
 * respecting strategic lane isolation.
 */
export function identifyStaleExecutionTasks(
  changedAuthorities: StrategicAuthorityName[],
  existingTasks: Array<{
    taskId: string;
    laneId?: string | null;
    authorityArtifactIds?: Record<string, string>;
    dependsOnAuthorities?: StrategicAuthorityName[];
    sourceAuthority?: string;
  }> = [],
  affectedLaneIds: string[] = []
): StaleTaskIdentification {
  const staleTaskIds: string[] = [];
  const preservedTaskIds: string[] = [];

  for (const task of existingTasks) {
    const taskDeps = task.dependsOnAuthorities || (task.sourceAuthority ? [task.sourceAuthority as StrategicAuthorityName] : []);
    const matchesAuthority = taskDeps.some(dep => changedAuthorities.includes(dep));

    if (matchesAuthority) {
      // If authority is affected, check lane scope:
      if (affectedLaneIds.length > 0) {
        if (task.laneId && affectedLaneIds.includes(task.laneId)) {
          staleTaskIds.push(task.taskId); // Matches affected lane -> REVIEW / REPLACE
        } else if (!task.laneId) {
          staleTaskIds.push(task.taskId); // Unscoped task depending on changed authority -> REVIEW
        } else {
          preservedTaskIds.push(task.taskId); // Belongs to unaffected lane -> KEEP
        }
      } else {
        staleTaskIds.push(task.taskId);
      }
    } else {
      preservedTaskIds.push(task.taskId);
    }
  }

  return {
    staleTaskIds,
    preservedTaskIds,
    reason: `Identified ${staleTaskIds.length} task(s) requiring review and ${preservedTaskIds.length} preserved task(s) across changed authorities [${changedAuthorities.join(", ")}]${affectedLaneIds.length > 0 ? ` on lane(s) [${affectedLaneIds.join(", ")}]` : ""}.`,
  };
}

/**
 * Emits an ExecutionSignal and attaches any identified stale task IDs into metadata.
 */
export function createExecutionSignal(params: EmitSignalParams): ExecutionSignal {
  const {
    campaignId,
    accountId,
    strategyRootId,
    strategyRootVersion,
    sourceDecisionId = null,
    sourceReasoningCaseId = null,
    sourceEventIds = [],
    sourcePerformanceWarningIds = [],
    affectedLaneIds = [],
    affectedStrategyAuthorities,
    actionType,
    priority = "HIGH",
    metadata = {},
    existingExecutionTasks = [],
  } = params;

  const staleAnalysis = identifyStaleExecutionTasks(affectedStrategyAuthorities, existingExecutionTasks, affectedLaneIds);

  return {
    executionSignalId: `esig_${randomUUID().slice(0, 12)}`,
    campaignId,
    accountId,
    strategyRootId,
    strategyRootVersion,
    sourceDecisionId,
    sourceReasoningCaseId,
    sourceEventIds,
    sourcePerformanceWarningIds,
    affectedLaneIds,
    affectedStrategyAuthorities,
    actionType,
    priority,
    metadata: {
      ...metadata,
      staleTaskIds: staleAnalysis.staleTaskIds,
      preservedTaskIds: staleAnalysis.preservedTaskIds,
      staleAnalysisReason: staleAnalysis.reason,
    },
    createdAt: new Date().toISOString(),
  };
}
