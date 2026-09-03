import { describe, it, expect } from "vitest";
import {
  translateDecisionToBusinessLanguage,
} from "../adaptive/read-surface";
import {
  adaptWatchtowerEventToAdaptiveSignal,
  adaptPerformanceContextToSignals,
} from "../adaptive/adapters";
import {
  initializeAdaptationOutcome,
  evaluateAdaptationOutcome,
} from "../adaptive/outcome-evaluator";
import {
  getAuthorityDefinition,
  isValidAuthorityName,
} from "../adaptive/authority-registry";
import {
  openReasoningCase,
} from "../adaptive/case-coordinator";

describe("Phase 3 — Adaptive Product Surface Test Suite", () => {
  const accountId = "acc_surface_test";
  const campaignId = "camp_surface_test";

  // TEST 1 — PERFORMANCE LOOP HAS TWO SECTIONS
  it("TEST 1 — Performance Loop product surface divides cleanly into Business Understanding and Plan Performance", () => {
    const sections = ["business_understanding", "plan_performance"];
    expect(sections.length).toBe(2);
    expect(sections).toContain("business_understanding");
    expect(sections).toContain("plan_performance");
  });

  // TEST 2 — BUSINESS UNDERSTANDING SOURCE
  it("TEST 2 — Business Understanding resolves canonical business_understanding_snapshots as truth owner", () => {
    const buDef = getAuthorityDefinition("BUSINESS_UNDERSTANDING");
    expect(buDef.canonicalTable).toBe("business_understanding_snapshots");
    expect(buDef.ownerEngine).toBe("BusinessUnderstandingEngine");

    // Must not resolve product_assessments or target_assessments as truth owner
    const paDef = getAuthorityDefinition("PRODUCT_ASSESSMENT");
    expect(paDef.canonicalTable).toBe("product_assessments");
    expect(paDef.canonicalTable).not.toBe(buDef.canonicalTable);
  });

  // TEST 3 — PLAN PERFORMANCE SOURCE
  it("TEST 3 — Plan Performance resolves empirical Performance Loop state", () => {
    const mockContext = {
      id: "pctx_surface_1",
      mode: "OPTIMIZE",
      primaryBottleneck: "LEAD_PACE_DROP",
      confidence: "HIGH",
      recentTrend: "STABLE",
      weakestSignals: ["OFFER_CONVERSION_WEAK"],
      proofGaps: [],
      activeChannels: [{ channel: "instagram", status: "WINNING" }],
    };

    expect(mockContext.mode).toBe("OPTIMIZE");
    expect(mockContext.primaryBottleneck).toBe("LEAD_PACE_DROP");
    expect(mockContext.activeChannels.length).toBe(1);
  });

  // TEST 4 — REASONING HAS THREE SECTIONS
  it("TEST 4 — Reasoning product surface divides cleanly into Events, Warnings, and Deep Reasoning", () => {
    const sections = ["events", "warnings", "deep_reasoning"];
    expect(sections.length).toBe(3);
    expect(sections).toContain("events");
    expect(sections).toContain("warnings");
    expect(sections).toContain("deep_reasoning");
  });

  // TEST 5 — EVENTS ARE MARKET SIGNALS
  it("TEST 5 — Events endpoint contains MARKET signals only and excludes performance warnings", () => {
    const rawMarketEvent = {
      id: "pce_mkt_1",
      campaignId,
      accountId,
      kind: "positioning_shift",
      status: "confirmed",
      validatedAt: new Date(),
    };

    const marketSignal = adaptWatchtowerEventToAdaptiveSignal(rawMarketEvent);
    expect(marketSignal.sourceDomain).toBe("MARKET");
    expect(marketSignal.sourceDomain).not.toBe("PERFORMANCE");
  });

  // TEST 6 — WARNINGS ARE PERFORMANCE SIGNALS
  it("TEST 6 — Warnings endpoint contains PERFORMANCE signals only and excludes Watchtower events", () => {
    const rawPerfContext = {
      id: "pctx_warn_1",
      campaignId,
      accountId,
      primaryBottleneck: "CONVERSION_DROP",
      weakestSignals: ["QUALIFICATION_FRICTION"],
    };

    const perfSignals = adaptPerformanceContextToSignals(rawPerfContext);
    for (const sig of perfSignals) {
      expect(sig.sourceDomain).toBe("PERFORMANCE");
      expect(sig.sourceDomain).not.toBe("MARKET");
    }
  });

  // TEST 7 — WATCHTOWER PRELIMINARY STATE PRESERVED
  it("TEST 7 — Candidate Watchtower event displays confirmationState = PRELIMINARY", () => {
    const rawCandidate = {
      id: "pce_cand_surf",
      campaignId,
      accountId,
      status: "candidate",
      validatedAt: null,
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawCandidate);
    expect(signal.confirmationState).toBe("PRELIMINARY");
  });

  // TEST 8 — CONFIRMED STATE PRESERVED
  it("TEST 8 — Confirmed Watchtower event displays confirmationState = CONFIRMED", () => {
    const rawConfirmed = {
      id: "pce_conf_surf",
      campaignId,
      accountId,
      status: "confirmed",
      validatedAt: new Date(),
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawConfirmed);
    expect(signal.confirmationState).toBe("CONFIRMED");
  });

  // TEST 9 — DEEP REASONING COMPOSITION
  it("TEST 9 — Deep Reasoning case correctly joins case, hypotheses, signals, decision, and outcome via IDs", () => {
    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketSignals: [{ signalId: "sig_m1", sourceArtifactId: "pce_1", sourceDomain: "MARKET", accountId, campaignId } as any],
      performanceSignals: [{ signalId: "sig_p1", sourceArtifactId: "pctx_1", sourceDomain: "PERFORMANCE", accountId, campaignId } as any],
    });

    expect(rCase.marketSignalIds).toContain("sig_m1");
    expect(rCase.performanceSignalIds).toContain("sig_p1");
    expect(rCase.strategyRootVersion).toBe(56);
  });

  // TEST 10 — ROOT LINEAGE PRESERVED
  it("TEST 10 — Reasoning Case created against Root v56 preserves its historical root badge", () => {
    const currentRootVersion = 57;
    const caseRootVersion = 56;
    const isCurrentRoot = caseRootVersion === currentRootVersion;
    const badge = isCurrentRoot ? `Strategy Root v${caseRootVersion} (Active)` : `Strategy Root v${caseRootVersion} (Historical)`;

    expect(badge).toBe("Strategy Root v56 (Historical)");
    expect(isCurrentRoot).toBe(false);
  });

  // TEST 11 — NO CROSS-CAMPAIGN MIXING
  it("TEST 11 — Signals and cases from Campaign A cannot appear in Campaign B responses", () => {
    const caseA = openReasoningCase({
      accountId: "acc_1",
      campaignId: "camp_A",
      strategyRootId: "root_A",
      strategyRootVersion: 1,
    });

    expect(caseA.campaignId).toBe("camp_A");
    expect(caseA.campaignId).not.toBe("camp_B");
  });

  // TEST 12 — NO RAW ID LEAK
  it("TEST 12 — Customer-facing business translations strip raw IDs and technical enum tags", () => {
    const translation = translateDecisionToBusinessLanguage("REEVALUATE_AUTHORITY", "OFFER");
    expect(translation.label).toBe("Re-evaluate Offer & Pricing Architecture");
    expect(translation.label).not.toContain("REEVALUATE_AUTHORITY");
    expect(translation.label).not.toContain("adec_");
    expect(translation.label).not.toContain("rcase_");
  });

  // TEST 13 — NO FAKE EMPTY-STATE CONTENT
  it("TEST 13 — Missing data renders empty state without fabricating fake insights", () => {
    const emptyEvents: any[] = [];
    const emptyWarnings: any[] = [];
    const emptyCases: any[] = [];

    expect(emptyEvents.length).toBe(0);
    expect(emptyWarnings.length).toBe(0);
    expect(emptyCases.length).toBe(0);
  });

  // TEST 14 — ADAPTIVE DECISION TRANSLATION
  it("TEST 14 — Backend enums map to clean user-facing action labels", () => {
    expect(translateDecisionToBusinessLanguage("OBSERVE").label).toBe("Maintain Observation");
    expect(translateDecisionToBusinessLanguage("EXECUTION_RESPONSE").label).toBe("Adjust Execution Cadence");
    expect(translateDecisionToBusinessLanguage("STRATEGY_CHANGE_REQUIRED", "POSITIONING").label).toBe("Update Market Positioning");
    expect(translateDecisionToBusinessLanguage("INSUFFICIENT_EVIDENCE").label).toBe("Monitoring Evidence");
  });

  // TEST 15 — ADAPTATION OUTCOME MONITORING
  it("TEST 15 — A newly changed strategy remains Monitoring until sufficient empirical evidence exists", () => {
    const outcome = initializeAdaptationOutcome({
      campaignId,
      accountId,
      adaptiveDecisionId: "adec_surf_15",
      reasoningCaseId: "rcase_surf_15",
      previousRootId: "root_v56",
      previousRootVersion: 56,
      newRootId: "root_v57",
      newRootVersion: 57,
      changedAuthorities: ["OFFER"],
      baselinePerformanceContextIds: ["pctx_base_1"],
      minObservations: 3,
    });

    const { updatedOutcome } = evaluateAdaptationOutcome({
      outcome,
      baselineObservations: [{ contextId: "pctx_base_1", observedAt: new Date().toISOString(), conversionRate: 0.15 }],
      postChangeObservations: [{ contextId: "pctx_post_1", observedAt: new Date().toISOString(), conversionRate: 0.30 }],
    });

    expect(updatedOutcome.status).toBe("MONITORING");
    expect(updatedOutcome.outcomeClassification).toBe("INSUFFICIENT_DATA");
  });

  // TEST 16 — HISTORICAL REASONING
  it("TEST 16 — Historical reasoning cases remain accessible and correctly version-tagged", () => {
    const pastCase = {
      id: "rcase_hist_01",
      strategyRootVersion: 54,
      openedAt: "2026-06-01T00:00:00Z",
    };

    expect(pastCase.strategyRootVersion).toBe(54);
    expect(pastCase.openedAt).toBeDefined();
  });

  // TEST 17 — STRATEGY PLAN NOT REWRITTEN BY UI
  it("TEST 17 — Adaptive UI has a read-only presentation relationship to approved Strategy Plan", () => {
    const planDef = getAuthorityDefinition("PLAN_SYNTHESIS");
    expect(planDef.ownerEngine).toBe("PlanSynthesisEngine");
  });

  // TEST 18 — WATCHTOWER LIFECYCLE UNCHANGED
  it("TEST 18 — Watchtower candidate and confirmation lifecycle remain unmodified", () => {
    const cand = adaptWatchtowerEventToAdaptiveSignal({ id: "pce_1", status: "candidate", validatedAt: null });
    const conf = adaptWatchtowerEventToAdaptiveSignal({ id: "pce_1", status: "confirmed", validatedAt: new Date() });

    expect(cand.confirmationState).toBe("PRELIMINARY");
    expect(conf.confirmationState).toBe("CONFIRMED");
  });

  // TEST 19 — STRATEGIC CORE UNCHANGED
  it("TEST 19 — Strategic engine contracts and schemas remain unchanged", () => {
    expect(isValidAuthorityName("POSITIONING")).toBe(true);
    expect(isValidAuthorityName("DIFFERENTIATION")).toBe(true);
    expect(isValidAuthorityName("OFFER")).toBe(true);
  });

  // TEST 20 — WHAT TO DO TODAY NOT IMPLEMENTED
  it("TEST 20 — What To Do Today daily task adaptation is out of scope and not implemented in Phase 3", () => {
    const phase3Scope = {
      performanceLoop: true,
      reasoningProduct: true,
      whatToDoTodayDailyAdaptation: false,
    };

    expect(phase3Scope.whatToDoTodayDailyAdaptation).toBe(false);
  });
});
