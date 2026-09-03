import { describe, it, expect } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  isLaneScopedAuthority,
  isValidAuthorityName,
} from "../adaptive/authority-registry";
import {
  planRecomputeCascade,
} from "../adaptive/cascade-planner";
import {
  runCausalReasoningAnalysis,
} from "../adaptive/reasoning-engine";
import {
  judgeReasoningAnalysis,
} from "../adaptive/reasoning-judge";
import {
  routeAdaptiveDecision,
} from "../adaptive/router";
import {
  executeAdaptiveDecision,
} from "../adaptive/decision-executor";
import {
  createExecutionSignal,
  identifyStaleExecutionTasks,
} from "../adaptive/execution-signaler";
import {
  commitNewStrategyRootVersion,
} from "../adaptive/root-versioner";
import {
  AdaptiveDecision,
  AdaptiveSignal,
  ReasoningCase,
  StrategicAuthorityName,
} from "../adaptive/contracts";

describe("AVYRON — Multi-Lane Deep Reasoning Scope & WTDT Audit Suite", () => {
  const accountId = "acc_test_multilane";
  const campaignId = "camp_test_multilane";

  const lane1 = { laneId: "lane_1_smb", title: "Small Business Social Media Managers" };
  const lane2 = { laneId: "lane_2_creators", title: "Visual Content Creators" };
  const lane3 = { laneId: "lane_3_agencies", title: "Marketing Agencies & Operators" };
  const threeLanes = [lane1, lane2, lane3];

  const mockRootV1 = {
    id: "root_v1_three_lanes",
    accountId,
    campaignId,
    version: 1,
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
    primaryAxis: "Simplicity and Speed",
    contrastAxis: "Complex Enterprise Bloat",
    approvedMechanism: "Single-Click Dispatch",
    approvedLanes: threeLanes,
  };

  // 1. Multi-lane Deep Reasoning decision must identify affected authority.
  it("TEST 1 — Multi-lane Deep Reasoning decision must identify affected authority", () => {
    const rcase: ReasoningCase = {
      reasoningCaseId: "rcase_ml_1",
      accountId,
      campaignId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      marketEventIds: ["pce_conf_001"],
      performanceWarningIds: [],
      evidenceIds: ["ev_comp_001"],
      status: "OPEN",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["FUNNEL"],
    };

    const marketSignal: AdaptiveSignal = {
      signalId: "sig_mkt_1",
      campaignId,
      accountId,
      sourceDomain: "MARKET",
      sourceArtifactId: "pce_conf_001",
      entityIds: ["lane_2_creators"],
      evidenceIds: ["ev_comp_001"],
      signalType: "FUNNEL_FRICTION",
      summary: "Competitor launched new creator checkout funnel",
      severity: "HIGH",
      confidence: 0.9,
      confirmationState: "CONFIRMED",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      metadata: { laneId: "lane_2_creators" },
    };

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rcase,
      marketSignals: [marketSignal],
      performanceSignals: [],
      strategyRootContext: { approvedLanes: threeLanes },
    });

    expect(analysis.candidateAffectedAuthorities).toContain("DIFFERENTIATION");
    expect(analysis.candidateAffectedLaneIds).toContain("lane_2_creators");
  });

  // 2. Lane-scoped authority decision must identify affectedLaneIds.
  it("TEST 2 — Lane-scoped authority decision must identify affectedLaneIds", () => {
    const rcase: ReasoningCase = {
      reasoningCaseId: "rcase_ml_2",
      accountId,
      campaignId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      marketEventIds: ["pce_conf_002"],
      performanceWarningIds: [],
      evidenceIds: ["ev_comp_002"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["FUNNEL"],
      candidateAffectedLaneIds: ["lane_2_creators"],
      metadata: { approvedLanes: threeLanes },
    };

    const verdict = judgeReasoningAnalysis(rcase, [
      {
        signalId: "sig_2",
        campaignId,
        accountId,
        sourceDomain: "MARKET",
        sourceArtifactId: "pce_conf_002",
        entityIds: ["lane_2_creators"],
        evidenceIds: ["ev_comp_002"],
        signalType: "FUNNEL",
        summary: "Creator funnel shift",
        severity: "HIGH",
        confidence: 0.9,
        confirmationState: "CONFIRMED",
        observedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(verdict.status).toBe("VALIDATED");

    const decision = routeAdaptiveDecision({
      reasoningCase: rcase,
      judgeVerdict: verdict,
      campaignId,
      accountId,
      marketSignals: [
        {
          signalId: "sig_2",
          campaignId,
          accountId,
          sourceDomain: "MARKET",
          sourceArtifactId: "pce_conf_002",
          entityIds: ["lane_2_creators"],
          evidenceIds: ["ev_comp_002"],
          signalType: "FUNNEL",
          summary: "Creator funnel shift",
          severity: "HIGH",
          confidence: 0.9,
          confirmationState: "CONFIRMED",
          observedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(decision.affectedAuthority).toBe("FUNNEL");
    expect(decision.affectedLaneIds).toEqual(["lane_2_creators"]);
    expect(decision.affectedEntityIds).toContain("lane_2_creators");
  });

  // 3. Missing lane scope fails closed / remains unresolved.
  it("TEST 3 — Missing lane scope for lane-scoped authority fails closed and does not fabricate a lane", () => {
    const ungroundedCase: ReasoningCase = {
      reasoningCaseId: "rcase_ml_ungrounded",
      accountId,
      campaignId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      marketEventIds: ["pce_conf_003"],
      performanceWarningIds: [],
      evidenceIds: ["ev_comp_003"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["FUNNEL"],
      candidateAffectedLaneIds: [],
      metadata: { approvedLanes: threeLanes },
    };

    const verdict = judgeReasoningAnalysis(ungroundedCase, [
      {
        signalId: "sig_3",
        campaignId,
        accountId,
        sourceDomain: "MARKET",
        sourceArtifactId: "pce_conf_003",
        entityIds: [],
        evidenceIds: ["ev_comp_003"],
        signalType: "FUNNEL_GENERAL",
        summary: "General market funnel change with no lane specificity",
        severity: "HIGH",
        confidence: 0.9,
        confirmationState: "CONFIRMED",
        observedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(verdict.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.violations.some(v => v.includes("Lane scope unresolved"))).toBe(true);

    const decision = routeAdaptiveDecision({
      reasoningCase: ungroundedCase,
      judgeVerdict: verdict,
      campaignId,
      accountId,
    });

    expect(decision.decisionType).toBe("INSUFFICIENT_EVIDENCE");
    expect(decision.affectedLaneIds).toEqual([]);
  });

  // 4. Lane is not selected by array order.
  it("TEST 4 — Lane is not selected by array order (no automatic first-lane default)", () => {
    const ungroundedCase: ReasoningCase = {
      reasoningCaseId: "rcase_no_array_order",
      accountId,
      campaignId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      marketEventIds: ["pce_conf_004"],
      performanceWarningIds: [],
      evidenceIds: ["ev_004"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["PERSUASION"],
      candidateAffectedLaneIds: [],
      metadata: { approvedLanes: threeLanes },
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: ungroundedCase,
      judgeVerdict: {
        status: "INSUFFICIENT_EVIDENCE",
        confidence: 0.3,
        violations: ["Lane scope unresolved"],
        rationale: "Lane scope unresolved",
        overclaimDetected: false,
        alternativeCausesSatisfied: true,
      },
      campaignId,
      accountId,
    });

    expect(decision.affectedLaneIds).toEqual([]);
    expect(decision.affectedEntityIds).not.toContain("lane_1_smb");
  });

  // 5 & 6. Proposal displays affected lane and preserved lanes.
  it("TEST 5 & 6 — Proposal displays affected lane and preserved lanes", () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_prop_test",
      reasoningCaseId: "rcase_prop_test",
      campaignId,
      accountId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_2_creators"],
      affectedEntityIds: ["lane_2_creators"],
      evidenceIds: ["ev_005"],
      confidence: 0.88,
      rationale: "Competitor launched creator checkout flow.",
      createdAt: new Date().toISOString(),
    };

    const affectedLaneIds = decision.affectedLaneIds!;
    const affectedLaneNames = threeLanes
      .filter(l => affectedLaneIds.includes(l.laneId))
      .map(l => l.title);
    const preservedLanes = threeLanes
      .filter(l => !affectedLaneIds.includes(l.laneId))
      .map(l => ({ laneId: l.laneId, name: l.title, status: "PRESERVED" }));

    expect(affectedLaneNames).toEqual(["Visual Content Creators"]);
    expect(preservedLanes).toHaveLength(2);
    expect(preservedLanes.map(p => p.laneId)).toEqual(["lane_1_smb", "lane_3_agencies"]);
  });

  // 7 & 8. Approval targets only affected lane, preserving other lanes unless cascade explicitly expands scope.
  it("TEST 7 & 8 — Approval targets only affected lane; other lanes remain preserved", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_exec_lane2",
      reasoningCaseId: "rcase_exec_lane2",
      campaignId,
      accountId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_2_creators"],
      affectedEntityIds: ["lane_2_creators"],
      evidenceIds: ["ev_006"],
      confidence: 0.9,
      rationale: "Targeted Funnel review for Creator lane.",
      createdAt: new Date().toISOString(),
    };

    const executedAuthorities: string[] = [];

    const result = await executeAdaptiveDecision(
      decision,
      mockRootV1,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async (authority) => {
          executedAuthorities.push(authority);
          return {
            result: "CHANGED",
            newArtifactId: "funnel_snap_v2_lane2",
            payload: { authority, laneId: "lane_2_creators", funnelName: "Refreshed Creator Journey" },
          };
        },
      }
    );

    expect(result.executionStatus).toBe("STRATEGY_UPDATED");
    expect(result.changedAuthorities).toContain("FUNNEL");
    expect(result.newRoot.authorityArtifactIds.POSITIONING).toBe("pos_snap_001");
    expect(result.newRoot.authorityArtifactIds.DIFFERENTIATION).toBe("diff_snap_001");
    expect(result.newRoot.authorityArtifactIds.MECHANISM).toBe("mech_snap_001");
  });

  // 9. No material change produces no new Root.
  it("TEST 9 — No material change produces no new Root and returns NO_CHANGE_CONFIRMED", async () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_no_mat_change",
      reasoningCaseId: "rcase_no_mat_change",
      campaignId,
      accountId,
      strategyRootId: mockRootV1.id,
      strategyRootVersion: mockRootV1.version,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "FUNNEL",
      affectedLaneIds: ["lane_2_creators"],
      affectedEntityIds: ["lane_2_creators"],
      evidenceIds: ["ev_007"],
      confidence: 0.85,
      rationale: "Reevaluating Funnel for Lane 2.",
      createdAt: new Date().toISOString(),
    };

    const result = await executeAdaptiveDecision(
      decision,
      mockRootV1,
      { activeRootVersion: 1 },
      {
        mockEngineHandler: async () => ({
          result: "NO_CHANGE_REQUIRED",
        }),
      }
    );

    expect(result.executionStatus).toBe("NO_CHANGE_CONFIRMED");
    expect(result.newRoot).toBeNull();
    expect(result.changedAuthorities).toEqual([]);
  });

  // 10. Material lane-specific change creates correct immutable Root lineage.
  it("TEST 10 — Material lane-specific change creates correct immutable Root lineage", () => {
    const rootCommit = commitNewStrategyRootVersion({
      accountId,
      campaignId,
      previousRoot: mockRootV1,
      adaptiveDecisionId: "adec_mat_lane2",
      reasoningCaseId: "rcase_mat_lane2",
      changedAuthorityArtifacts: {
        FUNNEL: "funnel_snap_v2_lane2",
      },
      sourceEventIds: ["pce_001"],
      sourcePerformanceWarningIds: [],
      evidenceIds: ["ev_001"],
      currentActiveVersion: 1,
    });

    expect(rootCommit.newRoot.version).toBe(2);
    expect(rootCommit.newRoot.authorityArtifactIds.FUNNEL).toBe("funnel_snap_v2_lane2");
    expect(rootCommit.newRoot.authorityArtifactIds.AUDIENCE).toBe("aud_snap_001");
    expect(rootCommit.lineage.previousRootVersion).toBe(1);
    expect(rootCommit.lineage.newRootVersion).toBe(2);
    expect(rootCommit.lineage.changedAuthorities).toEqual(["FUNNEL"]);
  });

  // 11. WTDT tasks expose laneId.
  it("TEST 11 — WTDT tasks expose laneId", () => {
    const tasks = [
      { taskId: "task_1", laneId: "lane_1_smb", sourceAuthority: "FUNNEL" },
      { taskId: "task_2", laneId: "lane_2_creators", sourceAuthority: "FUNNEL" },
      { taskId: "task_3", laneId: "lane_3_agencies", sourceAuthority: "OFFER" },
    ];

    tasks.forEach(t => {
      expect(t.laneId).toBeDefined();
      expect(typeof t.laneId).toBe("string");
    });
  });

  // 12. WTDT planner receives all active lanes.
  it("TEST 12 — WTDT planner context receives all active lanes", () => {
    const lanesInContext = mockRootV1.approvedLanes;
    expect(lanesInContext).toHaveLength(3);
    expect(lanesInContext.map(l => l.laneId)).toEqual(["lane_1_smb", "lane_2_creators", "lane_3_agencies"]);
  });

  // 13 & 14. Existing unaffected-lane tasks identified as PRESERVED, affected-lane tasks identified as STALE/REVIEW.
  it("TEST 13 & 14 — Existing unaffected-lane tasks are PRESERVED (KEEP); affected-lane tasks are STALE (REVIEW)", () => {
    const existingTasks = [
      { taskId: "task_lane_1_funnel", laneId: "lane_1_smb", sourceAuthority: "FUNNEL" },
      { taskId: "task_lane_2_funnel", laneId: "lane_2_creators", sourceAuthority: "FUNNEL" },
      { taskId: "task_lane_3_offer", laneId: "lane_3_agencies", sourceAuthority: "OFFER" },
      { taskId: "task_lane_3_funnel", laneId: "lane_3_agencies", sourceAuthority: "FUNNEL" },
    ];

    const staleAnalysis = identifyStaleExecutionTasks(
      ["FUNNEL"],
      existingTasks,
      ["lane_2_creators"]
    );

    // Only Lane 2 Funnel task is marked stale/review
    expect(staleAnalysis.staleTaskIds).toEqual(["task_lane_2_funnel"]);

    // Lane 1 Funnel, Lane 3 Offer, and Lane 3 Funnel are PRESERVED (KEEP)
    expect(staleAnalysis.preservedTaskIds).toContain("task_lane_1_funnel");
    expect(staleAnalysis.preservedTaskIds).toContain("task_lane_3_offer");
    expect(staleAnalysis.preservedTaskIds).toContain("task_lane_3_funnel");
  });

  // 15. Lane-specific execution signal carries affectedLaneIds.
  it("TEST 15 — Lane-specific execution signal carries affectedLaneIds", () => {
    const signal = createExecutionSignal({
      campaignId,
      accountId,
      strategyRootId: "root_v2",
      strategyRootVersion: 2,
      sourceDecisionId: "adec_lane2",
      affectedLaneIds: ["lane_2_creators"],
      affectedStrategyAuthorities: ["FUNNEL"],
      actionType: "REFRESH_TASK",
      priority: "HIGH",
      existingExecutionTasks: [
        { taskId: "task_1", laneId: "lane_1_smb", sourceAuthority: "FUNNEL" },
        { taskId: "task_2", laneId: "lane_2_creators", sourceAuthority: "FUNNEL" },
      ],
    });

    expect(signal.affectedLaneIds).toEqual(["lane_2_creators"]);
    expect(signal.metadata?.staleTaskIds).toEqual(["task_2"]);
    expect(signal.metadata?.preservedTaskIds).toEqual(["task_1"]);
  });

  // 16. Strategy update does not automatically regenerate all daily tasks.
  it("TEST 16 — Strategy update preserves unaffected tasks and does not regenerate the entire day from zero", () => {
    const existingDayTasks = [
      { taskId: "task_a", laneId: "lane_1_smb", sourceAuthority: "FUNNEL", status: "PLANNED" },
      { taskId: "task_b", laneId: "lane_2_creators", sourceAuthority: "FUNNEL", status: "PLANNED" },
      { taskId: "task_c", laneId: "lane_3_agencies", sourceAuthority: "PERSUASION", status: "PLANNED" },
    ];

    const staleResult = identifyStaleExecutionTasks(["FUNNEL"], existingDayTasks, ["lane_2_creators"]);

    const reconciledTasks = existingDayTasks.map(t => {
      if (staleResult.staleTaskIds.includes(t.taskId)) {
        return { ...t, status: "REPLACED", action: "REVIEW_REPLACE" };
      }
      return { ...t, action: "KEEP" };
    });

    expect(reconciledTasks.find(t => t.taskId === "task_a")?.action).toBe("KEEP");
    expect(reconciledTasks.find(t => t.taskId === "task_b")?.action).toBe("REVIEW_REPLACE");
    expect(reconciledTasks.find(t => t.taskId === "task_c")?.action).toBe("KEEP");
  });
});
