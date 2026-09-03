/**
 * Generic Adaptive Decision Executor & Recompute Coordinator
 * 
 * Constitutional Principle:
 * REASONING OWNS DIAGNOSIS.
 * ADAPTIVE ROUTER OWNS RESPONSE ROUTING.
 * OWNING STRATEGIC ENGINES OWN CANONICAL TRUTH.
 * PLAN SYNTHESIS ONLY REASSEMBLES APPROVED CANONICAL TRUTH.
 * 
 * Key Guarantees:
 * 1. Generic across ALL strategic authorities via STRATEGY_AUTHORITY_REGISTRY.
 * 2. No special-casing for Differentiation or any single engine.
 * 3. No blind full orchestrator rerun.
 * 4. Stale Decision Guard: Rejects decisions pinned to outdated root versions.
 * 5. Preliminary Watchtower Protection: Unconfirmed candidate events cannot mutate strategy.
 * 6. Business Truth Protection: Competitor/market evidence cannot redefine first-party Business Understanding.
 * 7. Smallest safe recomputation cascade.
 */

import {
  AdaptiveDecision,
  AdaptiveSignal,
  ReasoningCase,
  StrategicAuthorityName,
  StrategyRecomputeJob,
  ExecutionSignal,
  StrategyAdaptationOutcome,
} from "./contracts";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  isValidAuthorityName,
} from "./authority-registry";
import { planRecomputeCascade } from "./cascade-planner";
import { commitNewStrategyRootVersion } from "./root-versioner";
import { createExecutionSignal } from "./execution-signaler";
import { reassembleStrategicPlanFromRoot, ReassembledPlanResult } from "./plan-assembler";
import { initializeAdaptationOutcome } from "./outcome-evaluator";
import { validateCampaignContainment, LineageIntegrityError } from "./lineage";
import { randomUUID } from "crypto";
import { dispatchAuthorityRecompute } from "./authority-dispatcher";

export interface RecomputeExecutionOptions {
  mockEngineHandler?: (
    authority: StrategicAuthorityName,
    currentArtifactId: string,
    evidenceIds: string[]
  ) => Promise<{ result: "NO_CHANGE_REQUIRED" | "CHANGED"; newArtifactId?: string; payload?: any }>;
  existingExecutionTasks?: Array<{ taskId: string; dependsOnAuthorities?: StrategicAuthorityName[] }>;
  baselinePerformanceContextIds?: string[];
  forceAllDownstream?: boolean;
}

export interface DecisionExecutionResult {
  decisionId: string;
  decisionType: string;
  executionStatus: "NO_ACTION" | "EXECUTION_SIGNAL_EMITTED" | "NO_CHANGE_CONFIRMED" | "STRATEGY_UPDATED" | "FAILED";
  recomputeJobs: StrategyRecomputeJob[];
  newRoot?: any | null;
  newPlan?: ReassembledPlanResult | null;
  executionSignals: ExecutionSignal[];
  adaptationOutcome?: StrategyAdaptationOutcome | null;
  materiallyChangedAuthorities: StrategicAuthorityName[];
  revalidatedAuthorities: StrategicAuthorityName[];
  reassembledAuthorities: StrategicAuthorityName[];
  preservedAuthorities: StrategicAuthorityName[];
  changedAuthorities: StrategicAuthorityName[];
  summary: string;
}

/**
 * Executes a canonical AdaptiveDecision generically across any strategic authority.
 */
export async function executeAdaptiveDecision(
  decision: AdaptiveDecision,
  currentRoot: {
    id: string;
    version: number;
    authorityArtifactIds: Record<string, string>;
    primaryAxis?: string;
    contrastAxis?: string;
    approvedMechanism?: string;
    approvedLanes?: any[];
    [key: string]: any;
  },
  context: {
    reasoningCase?: ReasoningCase;
    marketSignals?: AdaptiveSignal[];
    performanceSignals?: AdaptiveSignal[];
    activeRootVersion?: number;
  },
  options?: RecomputeExecutionOptions
): Promise<DecisionExecutionResult> {
  const { campaignId, accountId } = decision;

  // 1. Cross-Campaign & Tenant Containment Guard
  if (currentRoot.campaignId && currentRoot.campaignId !== campaignId) {
    throw new LineageIntegrityError(
      `Cross-campaign execution breach: Decision campaign "${campaignId}" does not match Root campaign "${currentRoot.campaignId}".`
    );
  }
  if (currentRoot.accountId && currentRoot.accountId !== accountId) {
    throw new LineageIntegrityError(
      `Cross-tenant execution breach: Decision account "${accountId}" does not match Root account "${currentRoot.accountId}".`
    );
  }


  // 2. Stale Decision Guard
  const activeVersion = context.activeRootVersion ?? currentRoot.version;
  if (decision.strategyRootVersion !== activeVersion || decision.strategyRootId !== currentRoot.id) {
    throw new LineageIntegrityError(
      `[StaleDecisionError] Decision pinned to Root ${decision.strategyRootId} (v${decision.strategyRootVersion}) cannot execute. Current active Root is ${currentRoot.id} (v${activeVersion}).`
    );
  }

  // 3. Preliminary Watchtower Confirmation Guard
  const hasPreliminaryMarketEvent = (context.marketSignals || []).some(
    s => s.confirmationState === "PRELIMINARY"
  );
  const hasConfirmedMarketEvent = (context.marketSignals || []).some(
    s => s.confirmationState === "CONFIRMED"
  );

  if (
    hasPreliminaryMarketEvent &&
    !hasConfirmedMarketEvent &&
    (decision.decisionType === "STRATEGY_CHANGE_REQUIRED" || decision.decisionType === "STRATEGIC_REBUILD_REQUIRED")
  ) {
    throw new LineageIntegrityError(
      "[WatchtowerConfirmationError] Cannot execute strategy change against unconfirmed PRELIMINARY Watchtower market event."
    );
  }

  // 4. Handle Non-Strategic Decision Types
  if (decision.decisionType === "OBSERVE" || decision.decisionType === "INSUFFICIENT_EVIDENCE") {
    return {
      decisionId: decision.adaptiveDecisionId,
      decisionType: decision.decisionType,
      executionStatus: "NO_ACTION",
      recomputeJobs: [],
      newRoot: null,
      newPlan: null,
      executionSignals: [],
      adaptationOutcome: null,
      changedAuthorities: [],
      preservedAuthorities: Object.keys(currentRoot.authorityArtifactIds || {}) as StrategicAuthorityName[],
      summary: `Decision ${decision.decisionType} executed: 0 strategic engine runs. Strategy remains canonical.`,
    };
  }

  if (decision.decisionType === "EXECUTION_RESPONSE") {
    const execSignal = createExecutionSignal({
      campaignId,
      accountId,
      strategyRootId: currentRoot.id,
      strategyRootVersion: currentRoot.version,
      sourceDecisionId: decision.adaptiveDecisionId,
      sourceReasoningCaseId: decision.reasoningCaseId,
      sourceEventIds: context.reasoningCase?.marketEventIds || [],
      sourcePerformanceWarningIds: context.reasoningCase?.performanceWarningIds || [],
      affectedStrategyAuthorities: decision.affectedAuthority ? [decision.affectedAuthority] : ["PLAN_SYNTHESIS"],
      actionType: "REFRESH_TASK",
      priority: "HIGH",
      existingExecutionTasks: options?.existingExecutionTasks || [],
    });

    return {
      decisionId: decision.adaptiveDecisionId,
      decisionType: decision.decisionType,
      executionStatus: "EXECUTION_SIGNAL_EMITTED",
      recomputeJobs: [],
      newRoot: null,
      newPlan: null,
      executionSignals: [execSignal],
      adaptationOutcome: null,
      changedAuthorities: [],
      preservedAuthorities: Object.keys(currentRoot.authorityArtifactIds || {}) as StrategicAuthorityName[],
      summary: "Decision EXECUTION_RESPONSE executed: Emitted execution signal for What To Do Today. No strategic engine rerun.",
    };
  }

  // 5. Business Understanding First-Party Truth Protection Guard
  const primaryAuthority = decision.affectedAuthority;
  if (primaryAuthority === "BUSINESS_UNDERSTANDING") {
    const hasFirstPartyAuthority = decision.evidenceIds.some(ev => ev.startsWith("ev_user_") || ev.startsWith("ev_first_party_"));
    if (!hasFirstPartyAuthority && context.marketSignals && context.marketSignals.length > 0) {
      throw new LineageIntegrityError(
        "[BusinessTruthProtectionError] Competitor or market signals alone cannot redefine first-party Business Understanding or Product Truth."
      );
    }
  }

  // 6. Generic Authority Resolution & Cascade Planning
  const initialAuthorities: StrategicAuthorityName[] = primaryAuthority ? [primaryAuthority] : [];
  if (initialAuthorities.length === 0) {
    throw new Error(`[AdaptiveDecisionExecutor] Decision ${decision.adaptiveDecisionId} missing affectedAuthority.`);
  }

  const cascadePlan = planRecomputeCascade(initialAuthorities, {
    reasoningRationale: decision.rationale,
    forceAllDownstream: decision.decisionType === "STRATEGIC_REBUILD_REQUIRED" || options?.forceAllDownstream,
  });

  const recomputeJobs: StrategyRecomputeJob[] = [];
  const changedAuthorityArtifacts: Record<StrategicAuthorityName, string> = {} as any;
  const canonicalSnapshots: Record<string, any> = {};

  // 7. Execute Recomputations in Topological Order
  for (const authority of cascadePlan.topologicalExecutionOrder) {
    const def = getAuthorityDefinition(authority);
    const sourceArtifactId = currentRoot.authorityArtifactIds?.[authority] || `artifact_${authority.toLowerCase()}_v${currentRoot.version}`;

    const job: StrategyRecomputeJob = {
      recomputeJobId: `rjob_${randomUUID().slice(0, 12)}`,
      accountId,
      campaignId,
      sourceRootId: currentRoot.id,
      sourceRootVersion: currentRoot.version,
      adaptiveDecisionId: decision.adaptiveDecisionId,
      reasoningCaseId: decision.reasoningCaseId,
      authority,
      sourceArtifactId,
      status: "RUNNING",
      result: "PENDING",
      evidenceIds: decision.evidenceIds,
      startedAt: new Date().toISOString(),
    };

    let engineResult: { result: "NO_CHANGE_REQUIRED" | "CHANGED"; newArtifactId?: string; payload?: any };

    try {
      if (options?.mockEngineHandler) {
        engineResult = await options.mockEngineHandler(authority, sourceArtifactId, decision.evidenceIds);
      } else {
        const targetLaneId = decision.affectedLaneIds?.[0];
        engineResult = await dispatchAuthorityRecompute(authority, {
          campaignId,
          accountId,
          targetLaneId,
          currentRoot,
          decision,
          sourceArtifactId,
          evidenceIds: decision.evidenceIds,
        });
      }
    } catch (err: any) {
      console.warn(`[DecisionExecutor] Authority ${authority} recomputation failed/blocked: ${err.message}`);
      job.status = "FAILED";
      job.result = "FAILED";
      job.completedAt = new Date().toISOString();
      recomputeJobs.push(job);

      return {
        decisionId: decision.adaptiveDecisionId,
        decisionType: decision.decisionType,
        executionStatus: "FAILED",
        recomputeJobs,
        newRoot: null,
        newPlan: null,
        executionSignals: [],
        adaptationOutcome: null,
        materiallyChangedAuthorities: [],
        revalidatedAuthorities: [],
        reassembledAuthorities: [],
        preservedAuthorities: Object.keys(STRATEGY_AUTHORITY_REGISTRY) as StrategicAuthorityName[],
        changedAuthorities: [],
        summary: `Recomputation BLOCKED for ${authority}: ${err.message} [Code: ${err.code || "EXECUTION_ERROR"}]`,
      };
    }

    job.status = "COMPLETED";
    job.result = engineResult.result;
    job.outputArtifactId = engineResult.newArtifactId || sourceArtifactId;
    job.completedAt = new Date().toISOString();
    recomputeJobs.push(job);

    if (engineResult.result === "CHANGED" && engineResult.newArtifactId) {
      changedAuthorityArtifacts[authority] = engineResult.newArtifactId;
      canonicalSnapshots[authority] = engineResult.payload || { authority, id: engineResult.newArtifactId };
    }
  }

  // 8. Classify Authority Outcomes: Materially Changed vs Revalidated vs Reassembled vs Preserved
  const changedList = Object.keys(changedAuthorityArtifacts) as StrategicAuthorityName[];
  const materiallyChangedAuthorities = changedList.filter(a => initialAuthorities.includes(a));
  if (materiallyChangedAuthorities.length === 0 && changedList.length > 0) {
    materiallyChangedAuthorities.push(changedList[0]);
  }

  const revalidatedAuthorities = cascadePlan.topologicalExecutionOrder.filter(
    a => !materiallyChangedAuthorities.includes(a) && a !== "PLAN_SYNTHESIS"
  );

  const reassembledAuthorities: StrategicAuthorityName[] = ["PLAN_SYNTHESIS"];

  const allRegistryAuthorities = Object.keys(STRATEGY_AUTHORITY_REGISTRY) as StrategicAuthorityName[];
  const preservedAuthorities = allRegistryAuthorities.filter(
    a => !materiallyChangedAuthorities.includes(a) && !revalidatedAuthorities.includes(a) && a !== "PLAN_SYNTHESIS"
  );

  if (materiallyChangedAuthorities.length === 0 && changedList.length === 0) {
    return {
      decisionId: decision.adaptiveDecisionId,
      decisionType: decision.decisionType,
      executionStatus: "NO_CHANGE_CONFIRMED",
      recomputeJobs,
      newRoot: null,
      newPlan: null,
      executionSignals: [],
      adaptationOutcome: null,
      materiallyChangedAuthorities: [],
      revalidatedAuthorities,
      reassembledAuthorities: [],
      preservedAuthorities: allRegistryAuthorities,
      changedAuthorities: [],
      summary: `Targeted recomputation of [${initialAuthorities.join(", ")}] concluded NO_CHANGE_REQUIRED. Current strategy preserved.`,
    };
  }

  // 9. Commit New Immutable Strategy Root Version
  const rootCommit = commitNewStrategyRootVersion({
    accountId,
    campaignId,
    previousRoot: currentRoot,
    adaptiveDecisionId: decision.adaptiveDecisionId,
    reasoningCaseId: decision.reasoningCaseId,
    changedAuthorityArtifacts,
    sourceEventIds: context.reasoningCase?.marketEventIds || [],
    sourcePerformanceWarningIds: context.reasoningCase?.performanceWarningIds || [],
    evidenceIds: decision.evidenceIds,
    currentActiveVersion: activeVersion,
  });

  // 10. Run Plan Synthesis ONCE
  const newPlan = reassembleStrategicPlanFromRoot({
    campaignId,
    accountId,
    newRoot: rootCommit.newRoot,
    canonicalSnapshots,
  });

  // 11. Emit Canonical Execution Signals
  const execSignal = createExecutionSignal({
    campaignId,
    accountId,
    strategyRootId: rootCommit.newRoot.id,
    strategyRootVersion: rootCommit.newRoot.version,
    sourceDecisionId: decision.adaptiveDecisionId,
    sourceReasoningCaseId: decision.reasoningCaseId,
    sourceEventIds: context.reasoningCase?.marketEventIds || [],
    sourcePerformanceWarningIds: context.reasoningCase?.performanceWarningIds || [],
    affectedLaneIds: decision.affectedLaneIds || (decision.metadata?.affectedLaneIds as string[]) || [],
    affectedStrategyAuthorities: rootCommit.changedAuthorities,
    actionType: "REFRESH_TASK",
    priority: "HIGH",
    existingExecutionTasks: options?.existingExecutionTasks || [],
  });

  // 12. Initialize Adaptation Outcome Monitoring
  const outcome = initializeAdaptationOutcome({
    campaignId,
    accountId,
    adaptiveDecisionId: decision.adaptiveDecisionId,
    reasoningCaseId: decision.reasoningCaseId || `rcase_auto_${randomUUID().slice(0, 8)}`,
    previousRootId: currentRoot.id,
    previousRootVersion: currentRoot.version,
    newRootId: rootCommit.newRoot.id,
    newRootVersion: rootCommit.newRoot.version,
    changedAuthorities: rootCommit.changedAuthorities,
    baselinePerformanceContextIds: options?.baselinePerformanceContextIds || [],
    minObservations: 3,
  });

  return {
    decisionId: decision.adaptiveDecisionId,
    decisionType: decision.decisionType,
    executionStatus: "STRATEGY_UPDATED",
    recomputeJobs,
    newRoot: rootCommit.newRoot,
    newPlan,
    executionSignals: [execSignal],
    adaptationOutcome: outcome,
    materiallyChangedAuthorities,
    revalidatedAuthorities,
    reassembledAuthorities,
    preservedAuthorities,
    changedAuthorities: materiallyChangedAuthorities,
    summary: `Committed Root v${rootCommit.newRoot.version}. Material change: [${materiallyChangedAuthorities.join(", ")}]. Revalidated: [${revalidatedAuthorities.join(", ")}]. Preserved: [${preservedAuthorities.join(", ")}]. Assembled Plan ${newPlan.planId}.`,
  };
}
