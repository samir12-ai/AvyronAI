import { describe, it, expect } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  getDownstreamDependents,
  getUpstreamDependencies,
  isValidAuthorityName,
} from "../adaptive/authority-registry";
import {
  planRecomputeCascade,
  evaluateDependentImpact,
  sortAuthoritiesTopologically,
} from "../adaptive/cascade-planner";
import {
  commitNewStrategyRootVersion,
} from "../adaptive/root-versioner";
import {
  createExecutionSignal,
  identifyStaleExecutionTasks,
} from "../adaptive/execution-signaler";
import {
  reassembleStrategicPlanFromRoot,
} from "../adaptive/plan-assembler";
import {
  executeAdaptiveDecision,
} from "../adaptive/decision-executor";
import {
  initializeAdaptationOutcome,
  evaluateAdaptationOutcome,
} from "../adaptive/outcome-evaluator";
import {
  AdaptiveDecision,
  AdaptiveSignal,
  ReasoningCase,
  StrategicAuthorityName,
} from "../adaptive/contracts";
import { LineageIntegrityError } from "../adaptive/lineage";

describe("Phase 2 — Adaptive Execution & Targeted Strategy Recompute Test Suite", () => {
  const accountId = "acc_phase2_test";
  const campaignId = "camp_phase2_test";

  const mockRootV56 = {
    id: "root_v56_canon",
    accountId,
    campaignId,
    version: 56,
    authorityArtifactIds: {
      BUSINESS_UNDERSTANDING: "bu_snap_001",
      PRODUCT_ASSESSMENT: "pa_snap_001",
      TARGET_ASSESSMENT: "ta_snap_001",
      AUDIENCE: "aud_snap_001",
      STRATEGIC_PAIN_DECISION: "spd_snap_001",
      STRATEGIC_LANES: "lanes_snap_001",
      POSITIONING: "pos_snap_001",
      DIFFERENTIATION: "diff_snap_001",
      MECHANISM: "mech_snap_001",
      OFFER: "off_snap_001",
      AWARENESS: "awa_snap_001",
      FUNNEL: "fun_snap_001",
      PERSUASION: "per_snap_001",
      CHANNEL_SELECTION: "chan_snap_001",
      BUDGET_GOVERNOR: "bud_snap_001",
      INTEGRITY: "integ_snap_001",
    },
    primaryAxis: "AI Reliability",
    contrastAxis: "Manual Friction",
    approvedMechanism: "Active Verification Pipeline",
    approvedLanes: [{ laneId: "lane_ai_ops", segmentId: "seg_ops" }],
  };

  // TEST 1 — GENERIC AUTHORITY RESOLUTION
  it("TEST 1 — Registry resolves multiple authorities to their correct owning engines", () => {
    expect(getAuthorityDefinition("POSITIONING").ownerEngine).toBe("PositioningEngine");
    expect(getAuthorityDefinition("DIFFERENTIATION").ownerEngine).toBe("DifferentiationEngine");
    expect(getAuthorityDefinition("MECHANISM").ownerEngine).toBe("MechanismEngine");
    expect(getAuthorityDefinition("OFFER").ownerEngine).toBe("OfferEngine");
    expect(getAuthorityDefinition("FUNNEL").ownerEngine).toBe("FunnelEngine");
    expect(getAuthorityDefinition("CHANNEL_SELECTION").ownerEngine).toBe("ChannelSelectionEngine");
  });

  // TEST 2 — NO DIFFERENTIATION SPECIAL CASE
  it("TEST 2 — Adaptive executor works generically across any valid authority without special cases", () => {
    const authorities: StrategicAuthorityName[] = ["POSITIONING", "OFFER", "CHANNEL_SELECTION", "FUNNEL"];
    for (const auth of authorities) {
      expect(isValidAuthorityName(auth)).toBe(true);
      const cascade = planRecomputeCascade([auth]);
      expect(cascade.initialAuthorities).toEqual([auth]);
      expect(cascade.topologicalExecutionOrder[0]).toBe(auth);
    }
  });

  // TEST 3 — OBSERVE DOES NOT RECOMPUTE
  it("TEST 3 — OBSERVE decision executes 0 strategic engine runs and creates no new root", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_obs_1",
      reasoningCaseId: "rcase_1",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "OBSERVE",
      affectedAuthority: null,
      affectedEntityIds: [],
      evidenceIds: [],
      confidence: 0.8,
      rationale: "No action warranted.",
      createdAt: new Date().toISOString(),
    };

    let engineRunCount = 0;
    const result = await executeAdaptiveDecision(decision, mockRootV56, {}, {
      mockEngineHandler: async () => {
        engineRunCount++;
        return { result: "CHANGED" };
      },
    });

    expect(engineRunCount).toBe(0);
    expect(result.executionStatus).toBe("NO_ACTION");
    expect(result.newRoot).toBeNull();
  });

  // TEST 4 — EXECUTION_RESPONSE DOES NOT RECOMPUTE STRATEGY
  it("TEST 4 — EXECUTION_RESPONSE decision produces ExecutionSignal only without strategic recompute", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_exec_1",
      reasoningCaseId: "rcase_1",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "EXECUTION_RESPONSE",
      affectedAuthority: "PLAN_SYNTHESIS",
      affectedEntityIds: [],
      evidenceIds: ["ev_1"],
      confidence: 0.85,
      rationale: "Cadence adjustment needed.",
      createdAt: new Date().toISOString(),
    };

    let engineRunCount = 0;
    const result = await executeAdaptiveDecision(decision, mockRootV56, {}, {
      mockEngineHandler: async () => {
        engineRunCount++;
        return { result: "CHANGED" };
      },
    });

    expect(engineRunCount).toBe(0);
    expect(result.executionStatus).toBe("EXECUTION_SIGNAL_EMITTED");
    expect(result.executionSignals.length).toBe(1);
    expect(result.newRoot).toBeNull();
  });

  // TEST 5 — TARGETED POSITIONING REEVALUATION
  it("TEST 5 — POSITIONING decision executes Positioning owner first in topological order", () => {
    const cascade = planRecomputeCascade(["POSITIONING"]);
    expect(cascade.topologicalExecutionOrder[0]).toBe("POSITIONING");
  });

  // TEST 6 — TARGETED OFFER REEVALUATION
  it("TEST 6 — OFFER decision does not rerun upstream authorities (Audience, Positioning, Differentiation, Mechanism)", () => {
    const cascade = planRecomputeCascade(["OFFER"]);
    expect(cascade.authoritiesToRecompute).not.toContain("AUDIENCE");
    expect(cascade.authoritiesToRecompute).not.toContain("POSITIONING");
    expect(cascade.authoritiesToRecompute).not.toContain("DIFFERENTIATION");
    expect(cascade.authoritiesToRecompute).not.toContain("MECHANISM");
  });

  // TEST 7 — NO CHANGE PRESERVES ARTIFACT ID
  it("TEST 7 — When engine concludes NO_CHANGE_REQUIRED, current artifact remains canonical with no new Root", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_nochange_1",
      reasoningCaseId: "rcase_1",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: [],
      evidenceIds: ["ev_1"],
      confidence: 0.85,
      rationale: "Review differentiation claims.",
      createdAt: new Date().toISOString(),
    };

    const result = await executeAdaptiveDecision(decision, mockRootV56, {}, {
      mockEngineHandler: async () => ({ result: "NO_CHANGE_REQUIRED" }),
    });

    expect(result.executionStatus).toBe("NO_CHANGE_CONFIRMED");
    expect(result.newRoot).toBeNull();
    expect(result.recomputeJobs[0].result).toBe("NO_CHANGE_REQUIRED");
  });

  // TEST 8 — CHANGED AUTHORITY CREATES NEW ARTIFACT
  it("TEST 8 — Approved semantic change creates a new snapshot ID", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_change_1",
      reasoningCaseId: "rcase_1",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: [],
      evidenceIds: ["ev_1"],
      confidence: 0.9,
      rationale: "Update differentiation claim pillars.",
      createdAt: new Date().toISOString(),
    };

    const result = await executeAdaptiveDecision(decision, mockRootV56, {}, {
      mockEngineHandler: async (auth) => ({
        result: "CHANGED",
        newArtifactId: `diff_snap_002_fresh`,
      }),
    });

    expect(result.executionStatus).toBe("STRATEGY_UPDATED");
    expect(result.newRoot.authorityArtifactIds.DIFFERENTIATION).toBe("diff_snap_002_fresh");
  });

  // TEST 9 — DEPENDENCY IMPACT CHECK
  it("TEST 9 — Changed authority identifies candidate downstream dependents", () => {
    const dependents = getDownstreamDependents("DIFFERENTIATION");
    expect(dependents).toContain("MECHANISM");
    expect(dependents).toContain("OFFER");
    expect(dependents).toContain("STRATEGY_ROOT");
  });

  // TEST 10 — DEPENDENT MAY BE PRESERVED
  it("TEST 10 — Dependency relation alone does not force automatic rerun; dependent can be PRESERVED", () => {
    const evalResult = evaluateDependentImpact({
      changedAuthority: "CHANNEL_SELECTION",
      candidateDependent: "POSITIONING",
    });
    expect(evalResult.action).toBe("PRESERVE");
  });

  // TEST 11 — TARGETED DOWNSTREAM CASCADE
  it("TEST 11 — Only semantically affected dependents are scheduled for recompute", () => {
    const cascade = planRecomputeCascade(["CHANNEL_SELECTION"]);
    expect(cascade.authoritiesToRecompute).toContain("BUDGET_GOVERNOR");
    expect(cascade.authoritiesToRecompute).not.toContain("AUDIENCE");
    expect(cascade.authoritiesToRecompute).not.toContain("OFFER");
  });

  // TEST 12 — UPSTREAM CHANGE CAN CREATE BROADER CASCADE
  it("TEST 12 — Upstream foundational changes consider a wider downstream cascade set", () => {
    const cascade = planRecomputeCascade(["AUDIENCE"]);
    expect(cascade.authoritiesToRecompute).toContain("STRATEGIC_PAIN_DECISION");
    expect(cascade.authoritiesToRecompute).toContain("STRATEGIC_LANES");
    expect(cascade.authoritiesToRecompute).toContain("POSITIONING");
  });

  // TEST 13 — TOPOLOGICAL ORDER
  it("TEST 13 — Multiple affected authorities execute in dependency-safe topological order", () => {
    const sorted = sortAuthoritiesTopologically(["OFFER", "POSITIONING", "DIFFERENTIATION"]);
    expect(sorted.indexOf("POSITIONING")).toBeLessThan(sorted.indexOf("DIFFERENTIATION"));
    expect(sorted.indexOf("DIFFERENTIATION")).toBeLessThan(sorted.indexOf("OFFER"));
  });

  // TEST 14 — OLD ROOT IMMUTABLE
  it("TEST 14 — Root v56 remains unchanged after Root v57 is created", () => {
    const commit = commitNewStrategyRootVersion({
      accountId,
      campaignId,
      previousRoot: mockRootV56,
      adaptiveDecisionId: "adec_test_14",
      changedAuthorityArtifacts: { DIFFERENTIATION: "diff_snap_002" },
    });

    expect(mockRootV56.version).toBe(56);
    expect(mockRootV56.authorityArtifactIds.DIFFERENTIATION).toBe("diff_snap_001");
    expect(commit.newRoot.version).toBe(57);
  });

  // TEST 15 — NEW ROOT REUSES PRESERVED IDS
  it("TEST 15 — Unchanged authorities retain exact artifact IDs in Root v57", () => {
    const commit = commitNewStrategyRootVersion({
      accountId,
      campaignId,
      previousRoot: mockRootV56,
      adaptiveDecisionId: "adec_test_15",
      changedAuthorityArtifacts: { DIFFERENTIATION: "diff_snap_002" },
    });

    expect(commit.newRoot.authorityArtifactIds.POSITIONING).toBe("pos_snap_001");
    expect(commit.newRoot.authorityArtifactIds.OFFER).toBe("off_snap_001");
    expect(commit.newRoot.authorityArtifactIds.AUDIENCE).toBe("aud_snap_001");
  });

  // TEST 16 — CHANGED IDS PROPAGATE
  it("TEST 16 — Changed authority's new artifact ID reaches the new Root", () => {
    const commit = commitNewStrategyRootVersion({
      accountId,
      campaignId,
      previousRoot: mockRootV56,
      adaptiveDecisionId: "adec_test_16",
      changedAuthorityArtifacts: { DIFFERENTIATION: "diff_snap_002_new" },
    });

    expect(commit.newRoot.authorityArtifactIds.DIFFERENTIATION).toBe("diff_snap_002_new");
  });

  // TEST 17 — PLAN SYNTHESIS RUNS ONCE
  it("TEST 17 — Plan Synthesis runs exactly once after new Root commit", () => {
    const newRoot = {
      id: "root_v57_test",
      version: 57,
      authorityArtifactIds: { ...mockRootV56.authorityArtifactIds, DIFFERENTIATION: "diff_snap_002" },
    };

    const plan = reassembleStrategicPlanFromRoot({
      campaignId,
      accountId,
      newRoot,
      canonicalSnapshots: { DIFFERENTIATION: { pillars: ["New pillar"] } },
    });

    expect(plan.strategyRootId).toBe("root_v57_test");
    expect(plan.planVersion).toBe(57);
  });

  // TEST 18 — NO PLAN SEMANTIC PATCH
  it("TEST 18 — Old Plan is not modified in place; a new plan version is assembled", () => {
    const oldPlan = { planId: "plan_v56", planVersion: 56, sections: { diff: "old" } };
    const newRoot = { id: "root_v57", version: 57, authorityArtifactIds: {} };

    const newPlan = reassembleStrategicPlanFromRoot({
      campaignId,
      accountId,
      newRoot,
      canonicalSnapshots: {},
      previousPlanId: oldPlan.planId,
    });

    expect(newPlan.planId).not.toBe(oldPlan.planId);
    expect(newPlan.previousPlanId).toBe("plan_v56");
    expect(oldPlan.planVersion).toBe(56);
  });

  // TEST 19 — EXECUTION SIGNAL CREATED
  it("TEST 19 — Root update produces lineage-complete ExecutionSignal", () => {
    const signal = createExecutionSignal({
      campaignId,
      accountId,
      strategyRootId: "root_v57",
      strategyRootVersion: 57,
      sourceDecisionId: "adec_19",
      affectedStrategyAuthorities: ["DIFFERENTIATION"],
      actionType: "REFRESH_TASK",
    });

    expect(signal.strategyRootVersion).toBe(57);
    expect(signal.sourceDecisionId).toBe("adec_19");
    expect(signal.affectedStrategyAuthorities).toContain("DIFFERENTIATION");
  });

  // TEST 20 — TASK STALENESS IDENTIFIABLE
  it("TEST 20 — Changed authority identifies tasks depending on old authority artifact", () => {
    const existingTasks = [
      { taskId: "task_diff_1", dependsOnAuthorities: ["DIFFERENTIATION" as const] },
      { taskId: "task_channel_2", dependsOnAuthorities: ["CHANNEL_SELECTION" as const] },
    ];

    const staleAnalysis = identifyStaleExecutionTasks(["DIFFERENTIATION"], existingTasks);
    expect(staleAnalysis.staleTaskIds).toContain("task_diff_1");
    expect(staleAnalysis.staleTaskIds).not.toContain("task_channel_2");
  });

  // TEST 21 — ADAPTATION OUTCOME STARTS MONITORING
  it("TEST 21 — New Root activation creates adaptation outcome with status = MONITORING", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_21",
      reasoningCaseId: "rcase_21",
      previousRootId: "root_v56",
      previousRootVersion: 56,
      newRootId: "root_v57",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_1"],
    });

    expect(outcome.status).toBe("MONITORING");
    expect(outcome.outcomeClassification).toBe("PENDING");
  });

  // TEST 22 — FIRST PERFORMANCE SAMPLE NOT SUCCESS
  it("TEST 22 — One post-change observation cannot determine success or classify IMPROVED", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_22",
      reasoningCaseId: "rcase_22",
      previousRootId: "root_v56",
      previousRootVersion: 56,
      newRootId: "root_v57",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_1"],
      minObservations: 3,
    });

    const { updatedOutcome } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [{ contextId: "pctx_1", observedAt: new Date().toISOString(), conversionRate: 0.10 }],
      postChangeObservations: [{ contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.35 }],
    });

    expect(updatedOutcome.status).toBe("MONITORING");
    expect(updatedOutcome.outcomeClassification).toBe("INSUFFICIENT_DATA");
  });

  // TEST 23 — DEGRADED RETURNS TO REASONING
  it("TEST 23 — DEGRADED outcome creates a feedback Reasoning Case instead of automated rollback", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_23",
      reasoningCaseId: "rcase_23",
      previousRootId: "root_v56",
      previousRootVersion: 56,
      newRootId: "root_v57",
      newRootVersion: 57,
      changedAuthorities: ["OFFER"],
      baselinePerformanceContextIds: ["pctx_1"],
      minObservations: 3,
    });

    const { updatedOutcome, feedbackReasoningCase } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [{ contextId: "pctx_1", observedAt: new Date().toISOString(), conversionRate: 0.20 }],
      postChangeObservations: [
        { contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.05 },
        { contextId: "pctx_post_2", observedAt: new Date().toISOString(), conversionRate: 0.06 },
        { contextId: "pctx_post_3", observedAt: new Date().toISOString(), conversionRate: 0.04 },
      ],
    });

    expect(updatedOutcome.outcomeClassification).toBe("DEGRADED");
    expect(feedbackReasoningCase).toBeDefined();
    expect(feedbackReasoningCase?.strategyRootVersion).toBe(57);
  });

  // TEST 24 — PRELIMINARY WATCHTOWER EVENT CANNOT MUTATE STRATEGY
  it("TEST 24 — Strategy mutation is rejected when market event trigger is only PRELIMINARY", async () => {
    const prelimSignal: AdaptiveSignal = {
      signalId: "sig_prelim",
      campaignId,
      accountId,
      sourceDomain: "MARKET",
      sourceArtifactId: "pce_cand",
      entityIds: [],
      evidenceIds: [],
      signalType: "positioning_shift",
      summary: "Candidate shift",
      severity: "MEDIUM",
      confidence: 0.5,
      confirmationState: "PRELIMINARY",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_invalid_prelim",
      reasoningCaseId: "rcase_24",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "STRATEGY_CHANGE_REQUIRED",
      affectedAuthority: "POSITIONING",
      affectedEntityIds: [],
      evidenceIds: [],
      confidence: 0.9,
      rationale: "Attempting strategy change on preliminary event",
      createdAt: new Date().toISOString(),
    };

    await expect(
      executeAdaptiveDecision(decision, mockRootV56, { marketSignals: [prelimSignal] })
    ).rejects.toThrowError(LineageIntegrityError);
  });

  // TEST 25 — STALE DECISION BLOCKED
  it("TEST 25 — Decision pinned to outdated Root version cannot silently execute", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_stale",
      reasoningCaseId: "rcase_25",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 55, // Stale version (active is 56)
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: [],
      evidenceIds: [],
      confidence: 0.8,
      rationale: "Stale decision execution attempt",
      createdAt: new Date().toISOString(),
    };

    await expect(
      executeAdaptiveDecision(decision, mockRootV56, { activeRootVersion: 56 })
    ).rejects.toThrowError(LineageIntegrityError);
  });

  // TEST 26 — ROOT VERSION CONCURRENCY
  it("TEST 26 — Concurrency guard prevents duplicate root version commit", () => {
    expect(() => {
      commitNewStrategyRootVersion({
        accountId,
        campaignId,
        previousRoot: mockRootV56,
        adaptiveDecisionId: "adec_concurrent",
        changedAuthorityArtifacts: { DIFFERENTIATION: "diff_new" },
        currentActiveVersion: 57, // Already incremented by another job
      });
    }).toThrowError(LineageIntegrityError);
  });

  // TEST 27 — CROSS-CAMPAIGN BLOCK
  it("TEST 27 — Decision from Campaign A cannot mutate Campaign B strategy", async () => {
    const foreignDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_foreign",
      reasoningCaseId: "rcase_27",
      campaignId: "camp_foreign_A",
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: [],
      evidenceIds: [],
      confidence: 0.8,
      rationale: "Cross campaign attempt",
      createdAt: new Date().toISOString(),
    };

    await expect(
      executeAdaptiveDecision(foreignDecision, mockRootV56, {})
    ).rejects.toThrowError(LineageIntegrityError);
  });

  // TEST 28 — BUSINESS TRUTH PROTECTION
  it("TEST 28 — Competitor evidence alone cannot redefine Business Understanding or Product Truth", async () => {
    const competitorSignal: AdaptiveSignal = {
      signalId: "sig_comp",
      campaignId,
      accountId,
      sourceDomain: "MARKET",
      sourceArtifactId: "pce_comp_1",
      entityIds: [],
      evidenceIds: ["ev_competitor_ad_1"], // Competitor-only evidence
      signalType: "feature_launch",
      summary: "Competitor claim",
      severity: "HIGH",
      confidence: 0.9,
      confirmationState: "CONFIRMED",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_bu_tamper",
      reasoningCaseId: "rcase_28",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "BUSINESS_UNDERSTANDING",
      affectedEntityIds: [],
      evidenceIds: ["ev_competitor_ad_1"],
      confidence: 0.85,
      rationale: "Attempting to change BU based on competitor signal",
      createdAt: new Date().toISOString(),
    };

    await expect(
      executeAdaptiveDecision(decision, mockRootV56, { marketSignals: [competitorSignal] })
    ).rejects.toThrowError(LineageIntegrityError);
  });

  // TEST 29 — NO FULL RUN
  it("TEST 29 — Normal targeted reevaluation executes only specified authority and affected dependents", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_targeted_29",
      reasoningCaseId: "rcase_29",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "OFFER",
      affectedEntityIds: [],
      evidenceIds: ["ev_1"],
      confidence: 0.9,
      rationale: "Targeted offer update",
      createdAt: new Date().toISOString(),
    };

    const executedAuthorities: string[] = [];
    await executeAdaptiveDecision(decision, mockRootV56, {}, {
      mockEngineHandler: async (auth) => {
        executedAuthorities.push(auth);
        return { result: "CHANGED", newArtifactId: `${auth.toLowerCase()}_new` };
      },
    });

    // Only OFFER and its downstream dependents are recomputed; upstream are NOT rerun
    expect(executedAuthorities).toContain("OFFER");
    expect(executedAuthorities).not.toContain("BUSINESS_UNDERSTANDING");
    expect(executedAuthorities).not.toContain("AUDIENCE");
    expect(executedAuthorities).not.toContain("POSITIONING");
    expect(executedAuthorities).not.toContain("DIFFERENTIATION");
  });

  // TEST 30 — FULL ID LINEAGE
  it("TEST 30 — Complete traceable lineage is preserved across all execution artifacts", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_lineage_30",
      reasoningCaseId: "rcase_lineage_30",
      campaignId,
      accountId,
      strategyRootId: mockRootV56.id,
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: ["pillar_1"],
      evidenceIds: ["ev_conf_ad_101"],
      confidence: 0.9,
      rationale: "Traceable lineage execution",
      createdAt: new Date().toISOString(),
    };

    const result = await executeAdaptiveDecision(decision, mockRootV56, {
      reasoningCase: {
        reasoningCaseId: "rcase_lineage_30",
        accountId,
        campaignId,
        strategyRootId: mockRootV56.id,
        strategyRootVersion: 56,
        marketEventIds: ["pce_conf_1"],
        performanceWarningIds: ["sig_perf_1"],
        evidenceIds: ["ev_conf_ad_101"],
        status: "EVALUATED",
        openedAt: new Date().toISOString(),
        reasoningVersion: "1.0.0",
      },
    }, {
      mockEngineHandler: async (auth) => ({
        result: "CHANGED",
        newArtifactId: `diff_snap_002_lineage`,
      }),
      baselinePerformanceContextIds: ["pctx_base_1"],
    });

    expect(result.newRoot.previousRootId).toBe(mockRootV56.id);
    expect(result.newRoot.version).toBe(57);
    expect(result.recomputeJobs[0].adaptiveDecisionId).toBe("adec_lineage_30");
    expect(result.newPlan?.strategyRootId).toBe(result.newRoot.id);
    expect(result.executionSignals[0].sourceDecisionId).toBe("adec_lineage_30");
    expect(result.adaptationOutcome?.previousRootVersion).toBe(56);
    expect(result.adaptationOutcome?.newRootVersion).toBe(57);
  });
});
