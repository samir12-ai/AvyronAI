import { describe, it, expect } from "vitest";
import {
  adaptWatchtowerEventToAdaptiveSignal,
  adaptPerformanceContextToSignals,
  adaptPerformanceContextToSignal,
} from "../adaptive/adapters";
import {
  openReasoningCase,
  handleWatchtowerEventTransition,
} from "../adaptive/case-coordinator";
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
  initializeAdaptationOutcome,
  evaluateAdaptationOutcome,
} from "../adaptive/outcome-evaluator";
import {
  AdaptiveSignal,
  ReasoningCase,
  AdaptiveDecision,
} from "../adaptive/contracts";
import { LineageIntegrityError } from "../adaptive/lineage";

describe("Phase 1 — Adaptive Backbone Test Suite", () => {
  const accountId = "acc_test_123";
  const campaignId = "camp_test_123";
  const rootId = "root_v56_id";
  const rootVersion = 56;

  // TEST 1 — WATCHTOWER CANDIDATE PRESERVED
  it("TEST 1 — First Observation produces a PRELIMINARY adaptive signal without auto-confirming", () => {
    const rawWatchtowerCandidate = {
      id: "pce_candidate_001",
      accountId,
      campaignId,
      competitorId: "comp_rival_1",
      kind: "positioning_shift",
      status: "candidate",
      validatedAt: null, // First observation / candidate
      severity: "medium",
      confidence: 0.8,
      evidence: JSON.stringify(["ev_landing_page_1"]),
      createdAt: new Date(),
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawWatchtowerCandidate);
    expect(signal.sourceDomain).toBe("MARKET");
    expect(signal.confirmationState).toBe("PRELIMINARY");
    expect(signal.sourceArtifactId).toBe("pce_candidate_001");
    expect(signal.signalId).toContain("sig_watchtower_pce_candidate_001");
  });

  // TEST 2 — WATCHTOWER CONFIRMATION LINEAGE
  it("TEST 2 — Confirmation preserves lineage to original candidate/event", () => {
    const rawWatchtowerConfirmed = {
      id: "pce_candidate_001", // Same canonical event ID
      accountId,
      campaignId,
      competitorId: "comp_rival_1",
      kind: "positioning_shift",
      status: "confirmed",
      validatedAt: new Date(), // Promoted by 2nd independent fetch
      severity: "high",
      confidence: 0.95,
      evidence: JSON.stringify(["ev_landing_page_1", "ev_fetch2_page_1"]),
      createdAt: new Date(),
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawWatchtowerConfirmed);
    expect(signal.sourceDomain).toBe("MARKET");
    expect(signal.confirmationState).toBe("CONFIRMED");
    expect(signal.sourceArtifactId).toBe("pce_candidate_001");
  });

  // TEST 3 — CONTRADICTED EVENT DOES NOT REMAIN AUTHORITY
  it("TEST 3 — If Watchtower closes/contradicts candidate, Reasoning no longer treats it as confirmed", () => {
    const initialSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_cand_reverted",
      accountId,
      campaignId,
      status: "candidate",
      validatedAt: null,
      evidence: JSON.stringify(["ev_tmp"]),
    });

    const reasoningCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [initialSignal],
    });

    expect(reasoningCase.status).toBe("OPEN");

    // Watchtower 2nd fetch finds reversion/contradiction -> closes candidate
    const revertedSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_cand_reverted",
      accountId,
      campaignId,
      status: "reverted",
      evidence: JSON.stringify(["ev_tmp"]),
    });

    const { updatedCase, transitionAction } = handleWatchtowerEventTransition(reasoningCase, revertedSignal);
    expect(transitionAction).toBe("CLOSE");
    expect(updatedCase.status).toBe("CLOSED");
    expect(updatedCase.metadata?.closedReason).toContain("REVERTED");
  });

  // TEST 4 — PERFORMANCE 1:N SIGNAL EXTRACTION
  it("TEST 4 — One Performance Context can produce multiple unique AdaptiveSignals", () => {
    const rawPerfContext = {
      id: "pctx_multi_99",
      businessExecutionStateId: "bstate_01",
      accountId,
      campaignId,
      mode: "OPTIMIZE",
      primaryBottleneck: "LEAD_VELOCITY_DROP",
      currentReality: "Lead volume dropped by 30%",
      weakestSignals: ["OFFER_CONVERSION_FRICTION", "PROOF_CONFIDENCE_LOW"],
      confidence: "HIGH",
      evidenceRefIds: ["ev_crm_1"],
      createdAt: new Date(),
    };

    const signals = adaptPerformanceContextToSignals(rawPerfContext);
    expect(signals.length).toBe(3);
    for (const s of signals) {
      expect(s.sourceArtifactId).toBe("pctx_multi_99");
      expect(s.sourceDomain).toBe("PERFORMANCE");
    }
  });

  // TEST 5 — REASONING ROOT PINNING
  it("TEST 5 — Every ReasoningCase contains explicit strategyRootId and strategyRootVersion", () => {
    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: "root_v56_exact",
      strategyRootVersion: 56,
    });

    expect(rCase.strategyRootId).toBe("root_v56_exact");
    expect(rCase.strategyRootVersion).toBe(56);
  });

  // TEST 6 — MARKET + PERFORMANCE CORRELATION
  it("TEST 6 — Related market and performance signals can enter one unified ReasoningCase", () => {
    const marketSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_mkt_1",
      accountId,
      campaignId,
      status: "confirmed",
      validatedAt: new Date(),
      evidence: JSON.stringify(["ev_comp_ad_1"]),
    });

    const perfSignal = adaptPerformanceContextToSignal({
      id: "pctx_perf_1",
      accountId,
      campaignId,
      primaryBottleneck: "CONVERSION_RATE_DROP",
      evidenceRefIds: ["ev_funnel_1"],
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [marketSignal],
      performanceSignals: [perfSignal],
    });

    expect(rCase.marketEventIds).toContain("pce_mkt_1");
    expect(rCase.performanceWarningIds).toContain("sig_perf_bottleneck_pctx_perf_1");
    expect(rCase.evidenceIds).toEqual(expect.arrayContaining(["ev_comp_ad_1", "ev_funnel_1"]));
  });

  // TEST 7 — MULTIPLE HYPOTHESES
  it("TEST 7 — Reasoning preserves multiple competing explanations", () => {
    const marketSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_mkt_1",
      accountId,
      campaignId,
      status: "confirmed",
      validatedAt: new Date(),
      evidence: JSON.stringify(["ev_comp_ad_1"]),
    });

    const perfSignal = adaptPerformanceContextToSignal({
      id: "pctx_perf_1",
      accountId,
      campaignId,
      primaryBottleneck: "CONVERSION_RATE_DROP",
      evidenceRefIds: ["ev_funnel_1"],
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [marketSignal],
      performanceSignals: [perfSignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [marketSignal],
      performanceSignals: [perfSignal],
    });

    expect(analysis.hypotheses.length).toBeGreaterThanOrEqual(3);
    const types = analysis.hypotheses.map(h => h.hypothesisType);
    expect(types).toContain("COMPETITIVE_PRESSURE");
    expect(types).toContain("EXECUTION_OR_DISTRIBUTION_FLUCTUATION");
    expect(types).toContain("STATISTICAL_NOISE");
  });

  // TEST 8 — CAUSAL OVERCLAIM REJECTED
  it("TEST 8 — Judge rejects certain causal conclusion when no corroborating evidence exists", () => {
    const rCase: ReasoningCase = {
      reasoningCaseId: "rcase_overclaim",
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketEventIds: ["pce_1"],
      performanceWarningIds: ["sig_1"],
      evidenceIds: ["ev_single"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      hypotheses: [
        {
          hypothesisId: "hyp_overclaim",
          reasoningCaseId: "rcase_overclaim",
          hypothesisType: "COMPETITIVE_PRESSURE",
          explanation: "Competitor definitively destroyed conversion.",
          supportingEvidenceIds: ["ev_single"],
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: 0.99, // Unjustified certainty
          status: "VALIDATED",
        },
      ],
    };

    const verdict = judgeReasoningAnalysis(rCase, [], [{ signalId: "sig_1" } as any]);
    expect(verdict.status).toBe("REJECTED");
    expect(verdict.overclaimDetected).toBe(true);
  });

  // TEST 9 — ALTERNATIVE CAUSES REQUIRED
  it("TEST 9 — Reasoning considers alternative explanations when evidence supports them", () => {
    const perfSignal = adaptPerformanceContextToSignal({
      id: "pctx_perf_1",
      accountId,
      campaignId,
      primaryBottleneck: "LEAD_QUALITY_DECLINE",
      evidenceRefIds: ["ev_lead_1"],
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      performanceSignals: [perfSignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [],
      performanceSignals: [perfSignal],
    });

    expect(analysis.alternativeCausesIdentified).toBe(true);
    const verdict = judgeReasoningAnalysis(analysis.updatedCase, [], [perfSignal]);
    expect(verdict.alternativeCausesSatisfied).toBe(true);
  });

  // TEST 10 — PRELIMINARY EVENT CANNOT TRIGGER STRATEGY CHANGE
  it("TEST 10 — Router blocks STRATEGY_CHANGE_REQUIRED when event is only PRELIMINARY", () => {
    const preliminarySignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_unconfirmed_cand",
      accountId,
      campaignId,
      status: "candidate",
      validatedAt: null, // Unconfirmed
      evidence: JSON.stringify(["ev_1"]),
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [preliminarySignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [preliminarySignal],
      performanceSignals: [],
    });

    const verdict = judgeReasoningAnalysis(analysis.updatedCase, [preliminarySignal]);

    const decision = routeAdaptiveDecision({
      reasoningCase: analysis.updatedCase,
      judgeVerdict: verdict,
      marketSignals: [preliminarySignal],
      campaignId,
      accountId,
    });

    expect(decision.decisionType).not.toBe("STRATEGY_CHANGE_REQUIRED");
    expect(decision.decisionType).not.toBe("STRATEGIC_REBUILD_REQUIRED");
    expect(decision.decisionType).toBe("OBSERVE");
  });

  // TEST 11 — CONFIRMED EVENT CAN SUPPORT REEVALUATION
  it("TEST 11 — Confirmed event + supporting evidence produces REEVALUATE_AUTHORITY", () => {
    const confirmedSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_confirmed_event",
      accountId,
      campaignId,
      status: "confirmed",
      validatedAt: new Date(),
      evidence: JSON.stringify(["ev_verified_ad"]),
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [confirmedSignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [confirmedSignal],
      performanceSignals: [],
    });

    const verdict = judgeReasoningAnalysis(analysis.updatedCase, [confirmedSignal]);

    const decision = routeAdaptiveDecision({
      reasoningCase: analysis.updatedCase,
      judgeVerdict: verdict,
      marketSignals: [confirmedSignal],
      campaignId,
      accountId,
    });

    expect(decision.decisionType).toBe("REEVALUATE_AUTHORITY");
    expect(decision.affectedAuthority).toBe("DIFFERENTIATION");
  });

  // TEST 12 — PERFORMANCE DROP DOES NOT AUTOMATICALLY INVALIDATE STRATEGY
  it("TEST 12 — Performance warning alone defaults to EXECUTION_RESPONSE rather than strategic rewrite", () => {
    const perfSignal = adaptPerformanceContextToSignal({
      id: "pctx_perf_drop",
      accountId,
      campaignId,
      primaryBottleneck: "LEAD_VELOCITY_DROP",
      evidenceRefIds: ["ev_lead_1"],
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      performanceSignals: [perfSignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [],
      performanceSignals: [perfSignal],
    });

    const verdict = judgeReasoningAnalysis(analysis.updatedCase, [], [perfSignal]);

    const decision = routeAdaptiveDecision({
      reasoningCase: analysis.updatedCase,
      judgeVerdict: verdict,
      performanceSignals: [perfSignal],
      campaignId,
      accountId,
    });

    expect(decision.decisionType).toBe("EXECUTION_RESPONSE");
    expect(decision.affectedAuthority).toBe("PLAN_SYNTHESIS");
  });

  // TEST 13 — ROUTER SMALLEST RESPONSE
  it("TEST 13 — Smallest response principle selects execution level when market signals are preliminary", () => {
    const prelimSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_prelim",
      accountId,
      campaignId,
      status: "candidate",
      validatedAt: null,
      evidence: JSON.stringify(["ev_1"]),
    });

    const perfSignal = adaptPerformanceContextToSignal({
      id: "pctx_perf",
      accountId,
      campaignId,
      primaryBottleneck: "CONVERSION_RATE_DROP",
      evidenceRefIds: ["ev_2"],
    });

    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      marketSignals: [prelimSignal],
      performanceSignals: [perfSignal],
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [prelimSignal],
      performanceSignals: [perfSignal],
    });

    const verdict = judgeReasoningAnalysis(analysis.updatedCase, [prelimSignal], [perfSignal]);

    const decision = routeAdaptiveDecision({
      reasoningCase: analysis.updatedCase,
      judgeVerdict: verdict,
      marketSignals: [prelimSignal],
      performanceSignals: [perfSignal],
      campaignId,
      accountId,
    });

    // Escalation to Strategy Rebuild blocked; smallest justified is execution response
    expect(decision.decisionType).toBe("EXECUTION_RESPONSE");
  });

  // TEST 14 — REASONING CANNOT REWRITE STRATEGY
  it("TEST 14 — Reasoning analysis cannot contain replacement strategy payloads", () => {
    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
    });

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: rCase,
      marketSignals: [],
      performanceSignals: [],
    });

    expect((analysis.updatedCase as any).positioningStatement).toBeUndefined();
    expect((analysis.updatedCase as any).differentiationPillars).toBeUndefined();
    expect((analysis.updatedCase as any).primaryOffer).toBeUndefined();
  });

  // TEST 15 — ADAPTIVE DECISION PERSISTED
  it("TEST 15 — AdaptiveDecision preserves all critical lineage and identity fields", () => {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_test_15",
      reasoningCaseId: "rcase_test_15",
      campaignId,
      accountId,
      strategyRootId: rootId,
      strategyRootVersion: rootVersion,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: ["pillar_live_mirror"],
      evidenceIds: ["ev_1", "ev_2"],
      confidence: 0.88,
      rationale: "Confirmed competitor shift pressures core mechanism claims.",
      createdAt: new Date().toISOString(),
    };

    expect(decision.adaptiveDecisionId).toBe("adec_test_15");
    expect(decision.reasoningCaseId).toBe("rcase_test_15");
    expect(decision.strategyRootVersion).toBe(56);
    expect(decision.affectedAuthority).toBe("DIFFERENTIATION");
    expect(decision.evidenceIds).toEqual(["ev_1", "ev_2"]);
  });

  // TEST 16 — OUTCOME CONTRACT ROOT TRANSITION
  it("TEST 16 — Strategy adaptation outcome contract links previous root and new root", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_test_16",
      reasoningCaseId: "rcase_test_16",
      previousRootId: "root_v56_id",
      previousRootVersion: 56,
      newRootId: "root_v57_id",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_base_1", "pctx_base_2"],
      minObservations: 3,
    });

    expect(outcome.previousRootVersion).toBe(56);
    expect(outcome.newRootVersion).toBe(57);
    expect(outcome.changedAuthorities).toEqual(["DIFFERENTIATION"]);
    expect(outcome.status).toBe("MONITORING");
  });

  // TEST 17 — FIRST POST-CHANGE OBSERVATION IS NOT SUCCESS
  it("TEST 17 — First post-change observation maintains MONITORING status and cannot conclude success", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_test_17",
      reasoningCaseId: "rcase_test_17",
      previousRootId: "root_v56_id",
      previousRootVersion: 56,
      newRootId: "root_v57_id",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_base_1"],
      minObservations: 3,
    });

    // Only 1 post-change observation
    const { updatedOutcome } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [{ contextId: "pctx_base_1", observedAt: new Date().toISOString(), conversionRate: 0.10 }],
      postChangeObservations: [{ contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.25 }],
    });

    expect(updatedOutcome.status).toBe("MONITORING");
    expect(updatedOutcome.outcomeClassification).toBe("INSUFFICIENT_DATA");
    expect(updatedOutcome.summary).toContain("Observation in progress (1/3");
  });

  // TEST 18 — OUTCOME CAN CLASSIFY IMPROVED
  it("TEST 18 — Sufficient positive post-change evidence evaluates to IMPROVED", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_test_18",
      reasoningCaseId: "rcase_test_18",
      previousRootId: "root_v56_id",
      previousRootVersion: 56,
      newRootId: "root_v57_id",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_base_1", "pctx_base_2"],
      minObservations: 3,
    });

    const { updatedOutcome } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [
        { contextId: "pctx_base_1", observedAt: new Date().toISOString(), conversionRate: 0.10 },
        { contextId: "pctx_base_2", observedAt: new Date().toISOString(), conversionRate: 0.12 },
      ],
      postChangeObservations: [
        { contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.22 },
        { contextId: "pctx_post_2", observedAt: new Date().toISOString(), conversionRate: 0.24 },
        { contextId: "pctx_post_3", observedAt: new Date().toISOString(), conversionRate: 0.23 },
      ],
    });

    expect(updatedOutcome.status).toBe("EVALUATED");
    expect(updatedOutcome.outcomeClassification).toBe("IMPROVED");
  });

  // TEST 19 — OUTCOME CAN CLASSIFY DEGRADED
  it("TEST 19 — Sufficient negative post-change evidence evaluates to DEGRADED", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_test_19",
      reasoningCaseId: "rcase_test_19",
      previousRootId: "root_v56_id",
      previousRootVersion: 56,
      newRootId: "root_v57_id",
      newRootVersion: 57,
      changedAuthorities: ["DIFFERENTIATION"],
      baselinePerformanceContextIds: ["pctx_base_1"],
      minObservations: 3,
    });

    const { updatedOutcome } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [
        { contextId: "pctx_base_1", observedAt: new Date().toISOString(), conversionRate: 0.20 },
      ],
      postChangeObservations: [
        { contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.08 },
        { contextId: "pctx_post_2", observedAt: new Date().toISOString(), conversionRate: 0.07 },
        { contextId: "pctx_post_3", observedAt: new Date().toISOString(), conversionRate: 0.09 },
      ],
    });

    expect(updatedOutcome.status).toBe("EVALUATED");
    expect(updatedOutcome.outcomeClassification).toBe("DEGRADED");
  });

  // TEST 20 — FAILED ADAPTATION RETURNS TO REASONING
  it("TEST 20 — DEGRADED outcome feeds back into Reasoning rather than directly rewriting strategy", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_test_20",
      reasoningCaseId: "rcase_test_20",
      previousRootId: "root_v56_id",
      previousRootVersion: 56,
      newRootId: "root_v57_id",
      newRootVersion: 57,
      changedAuthorities: ["OFFER"],
      baselinePerformanceContextIds: ["pctx_base_1"],
      minObservations: 3,
    });

    const { updatedOutcome, feedbackReasoningCase } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [
        { contextId: "pctx_base_1", observedAt: new Date().toISOString(), conversionRate: 0.25 },
      ],
      postChangeObservations: [
        { contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.10 },
        { contextId: "pctx_post_2", observedAt: new Date().toISOString(), conversionRate: 0.11 },
        { contextId: "pctx_post_3", observedAt: new Date().toISOString(), conversionRate: 0.09 },
      ],
    });

    expect(updatedOutcome.outcomeClassification).toBe("DEGRADED");
    expect(feedbackReasoningCase).toBeDefined();
    expect(feedbackReasoningCase?.strategyRootId).toBe("root_v57_id");
    expect(feedbackReasoningCase?.strategyRootVersion).toBe(57);
    expect(feedbackReasoningCase?.metadata?.trigger).toBe("ADAPTATION_OUTCOME_DEGRADED");
  });

  // TEST 21 — CROSS-CAMPAIGN LINEAGE BLOCKED
  it("TEST 21 — Signals from Campaign A cannot enter Campaign B reasoning case", () => {
    const foreignSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_foreign",
      accountId: "acc_other",
      campaignId: "camp_foreign_A",
      status: "confirmed",
      validatedAt: new Date(),
      evidence: JSON.stringify(["ev_foreign"]),
    });

    expect(() => {
      openReasoningCase({
        accountId,
        campaignId: "camp_target_B",
        strategyRootId: rootId,
        strategyRootVersion: rootVersion,
        marketSignals: [foreignSignal],
      });
    }).toThrowError(LineageIntegrityError);
  });

  // TEST 22 — WATCHTOWER LIFECYCLE REGRESSION
  it("TEST 22 — Watchtower two-fetch confirmation and candidate lifecycle semantics remain authoritative", () => {
    // 1. First Observation
    const cand = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_cand_test22",
      accountId,
      campaignId,
      status: "candidate",
      validatedAt: null,
      evidence: JSON.stringify(["ev_1"]),
    });
    expect(cand.confirmationState).toBe("PRELIMINARY");

    // 2. Confirmed Event
    const conf = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_cand_test22",
      accountId,
      campaignId,
      status: "confirmed",
      validatedAt: new Date(),
      evidence: JSON.stringify(["ev_1", "ev_2"]),
    });
    expect(conf.confirmationState).toBe("CONFIRMED");

    // 3. Reverted / Closed Event
    const rev = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_cand_test22",
      accountId,
      campaignId,
      status: "reverted",
      evidence: JSON.stringify(["ev_1"]),
    });
    expect(rev.confirmationState).toBe("REVERTED");
  });
});
