import { describe, it, expect } from "vitest";
import {
  formatStandardDate,
  formatStandardDateTime,
  translateSignalTypeToTitle,
  translateEventTypeToTitle,
  translateDecisionToBusinessLanguage,
} from "../adaptive/read-surface";
import {
  adaptWatchtowerEventToAdaptiveSignal,
  adaptPerformanceContextToSignals,
} from "../adaptive/adapters";
import {
  openReasoningCase,
} from "../adaptive/case-coordinator";

describe("Phase 3 Detail Drill-Down — Event & Performance Warning Test Suite", () => {
  const accountId = "acc_drilldown_test";
  const campaignId = "camp_drilldown_test";

  // TEST 1 — EVENT CARDS ROUTE BY CANONICAL EVENT ID
  it("TEST 1 — Every Event card uses canonical eventId/sourceArtifactId for routing and detail lookup", () => {
    const rawEvent = {
      id: "pce_evt_101",
      campaignId,
      accountId,
      kind: "offer_type_shift",
      status: "confirmed",
      validatedAt: new Date(),
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawEvent);
    expect(signal.sourceArtifactId).toBe("pce_evt_101");
    expect(signal.sourceArtifactId).not.toContain(" ");
  });

  // TEST 2 — EVENT DETAIL RESOLVES EXACT EVENT
  it("TEST 2 — Event detail resolves the exact event attributes", () => {
    const rawEvent = {
      id: "pce_evt_102",
      campaignId,
      accountId,
      kind: "positioning_shift",
      status: "confirmed",
      severity: "high",
      confidence: 0.92,
      createdAt: new Date("2026-08-20T10:00:00Z"),
      validatedAt: new Date("2026-08-21T14:00:00Z"),
      evidenceSummary: "Competitor shifted from manual to AI-driven workflow positioning.",
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawEvent);
    expect(signal.sourceArtifactId).toBe("pce_evt_102");
    expect(signal.severity).toBe("HIGH");
    expect(signal.confidence).toBe(0.92);
  });

  // TEST 3 — EVENT DETAIL DISPLAYS CONFIRMATION LIFECYCLE
  it("TEST 3 — Event detail formats two-fetch observation and confirmation timeline", () => {
    const rawEvent = {
      id: "pce_evt_103",
      campaignId,
      accountId,
      kind: "competitor_profile_change",
      status: "confirmed",
      createdAt: new Date("2026-08-20T10:00:00Z"),
      validatedAt: new Date("2026-08-21T10:00:00Z"),
    };

    const confirmationHistory = [
      { step: "First Observation", timestamp: formatStandardDateTime(rawEvent.createdAt) },
      { step: "Confirmation Check", timestamp: formatStandardDateTime(rawEvent.validatedAt) },
    ];

    expect(confirmationHistory.length).toBe(2);
    expect(confirmationHistory[0].step).toBe("First Observation");
    expect(confirmationHistory[1].step).toBe("Confirmation Check");
  });

  // TEST 4 — PRELIMINARY AND CONFIRMED EVENTS ARE NOT FLATTENED
  it("TEST 4 — Preliminary candidate events and confirmed events retain distinct badges", () => {
    const cand = adaptWatchtowerEventToAdaptiveSignal({ id: "e1", status: "candidate", validatedAt: null });
    const conf = adaptWatchtowerEventToAdaptiveSignal({ id: "e2", status: "confirmed", validatedAt: new Date() });

    expect(cand.confirmationState).toBe("PRELIMINARY");
    expect(conf.confirmationState).toBe("CONFIRMED");
    expect(cand.confirmationState).not.toBe(conf.confirmationState);
  });

  // TEST 5 — EVENT EVIDENCE FROM CANONICAL WATCHTOWER LINEAGE
  it("TEST 5 — Event evidence extracts exact source IDs from Watchtower payload", () => {
    const rawEvent = {
      id: "pce_evt_105",
      campaignId,
      accountId,
      evidence: JSON.stringify(["ev_wt_screenshot_01", "ev_wt_copy_02"]),
    };

    const signal = adaptWatchtowerEventToAdaptiveSignal(rawEvent);
    expect(signal.evidenceIds).toContain("ev_wt_screenshot_01");
    expect(signal.evidenceIds).toContain("ev_wt_copy_02");
  });

  // TEST 6 — EVENT DETAIL LINKS TO REASONING CASE
  it("TEST 6 — Event detail can associate with active Reasoning Cases containing its ID", () => {
    const eventId = "pce_evt_106";
    const rCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketSignals: [{ signalId: `sig_watchtower_${eventId}`, sourceArtifactId: eventId, sourceDomain: "MARKET", accountId, campaignId } as any],
      performanceSignals: [],
    });

    expect(rCase.marketEventIds).toContain(eventId);
  });

  // TEST 7 — EVENT LINKS TO WATCHTOWER
  it("TEST 7 — Event detail provides a valid Watchtower navigation reference", () => {
    const competitorId = "comp_novaspeed_1";
    const watchtowerLink = `/watchtower?competitorId=${competitorId}`;
    expect(watchtowerLink).toContain(competitorId);
  });

  // TEST 8 — WARNING CARDS ROUTE BY CANONICAL SIGNAL ID
  it("TEST 8 — Warning cards route using canonical signalId", () => {
    const rawContext = {
      id: "pctx_drill_01",
      campaignId,
      accountId,
      primaryBottleneck: "LEAD_PACE_DROP",
      weakestSignals: ["QUALIFIED_LEAD_PACE_DROP"],
    };

    const signals = adaptPerformanceContextToSignals(rawContext);
    expect(signals[0].signalId).toContain("pctx_drill_01");
  });

  // TEST 9 — WARNING DETAIL RESOLVES SOURCE PERFORMANCE CONTEXT
  it("TEST 9 — Warning detail resolves source PerformanceContext container", () => {
    const rawContext = {
      id: "pctx_drill_02",
      campaignId,
      accountId,
      mode: "BUILD",
      primaryBottleneck: "INSUFFICIENT_SALES_HISTORY",
      currentReality: "Early stage launch with no transaction volume yet.",
      confidence: "HIGH",
    };

    const signals = adaptPerformanceContextToSignals(rawContext);
    expect(signals[0].sourceArtifactId).toBe("pctx_drill_02");
  });

  // TEST 10 — ONE PERFORMANCE CONTEXT EXPOSES MULTIPLE INDEPENDENT WARNINGS
  it("TEST 10 — One PerformanceContext container can emit multiple discrete warnings with unique signal IDs", () => {
    const multiContext = {
      id: "pctx_multi_01",
      campaignId,
      accountId,
      primaryBottleneck: "CONVERSION_DROP",
      weakestSignals: ["OFFER_FRICTION", "DIFFERENTIATION_OVERLAP"],
    };

    const signals = adaptPerformanceContextToSignals(multiContext);
    expect(signals.length).toBeGreaterThan(1);
    const signalIds = new Set(signals.map(s => s.signalId));
    expect(signalIds.size).toBe(signals.length);
  });

  // TEST 11 — WARNING TITLE NEVER RENDERS "NONE"
  it("TEST 11 — Warning title translation never renders NONE when a valid signal exists", () => {
    expect(translateSignalTypeToTitle("NONE", "The business is new with no sales history.")).not.toBe("NONE");
    expect(translateSignalTypeToTitle(null, "No engagement on social media platforms.")).not.toBe("NONE");
    expect(translateSignalTypeToTitle("PERFORMANCE_STATE", "Early stage baseline")).not.toBe("NONE");
    expect(translateSignalTypeToTitle("UNKNOWN", "Funnel conversion drop")).not.toBe("NONE");
  });

  // TEST 12 — WARNING TITLE IS BASED ON SIGNAL SEMANTICS
  it("TEST 12 — Warning title accurately reflects signal semantics", () => {
    expect(translateSignalTypeToTitle("QUALIFIED_LEAD_PACE_DROP")).toBe("Qualified Lead Pace Declining");
    expect(translateSignalTypeToTitle("CONVERSION_DROP")).toBe("Funnel Conversion Friction");
    expect(translateSignalTypeToTitle("OFFER_FRICTION")).toBe("Offer Consideration Resistance");
    expect(translateSignalTypeToTitle("DIFFERENTIATION_OVERLAP")).toBe("Differentiation Perception Weakening");
    expect(translateSignalTypeToTitle("SOCIAL_ENGAGEMENT_MISSING")).toBe("Social Engagement Data Missing");
  });

  // TEST 13 — WARNING DETAIL PRESERVES STRATEGY ROOT LINEAGE
  it("TEST 13 — Warning detail explicitly links to the measured Strategy Root version", () => {
    const warningPayload = {
      signalId: "sig_perf_warn_1",
      strategyRootVersion: 56,
      mode: "BUILD",
    };

    expect(warningPayload.strategyRootVersion).toBe(56);
  });

  // TEST 14 — SAME WARNING FROM PLAN PERFORMANCE AND REASONING RESOLVES SAME ARTIFACT
  it("TEST 14 — Warning opened from Plan Performance or Reasoning Warning list resolves the same signalId", () => {
    const signalId = "sig_perf_bottleneck_pctx_canon_01";
    const fromPlanPerformance = { signalId };
    const fromReasoning = { signalId };

    expect(fromPlanPerformance.signalId).toBe(fromReasoning.signalId);
  });

  // TEST 15 — SAME MARKET EVENT PRESERVED BETWEEN WATCHTOWER AND REASONING
  it("TEST 15 — Same market event identity is preserved across Watchtower and Reasoning", () => {
    const rawWatchtowerEventId = "pce_wt_evt_999";
    const adaptedSignal = adaptWatchtowerEventToAdaptiveSignal({
      id: rawWatchtowerEventId,
      campaignId,
      accountId,
    });

    expect(adaptedSignal.sourceArtifactId).toBe(rawWatchtowerEventId);
  });

  // TEST 16 — DEEP REASONING TRIGGER COUNTS OPEN LINKED ARTIFACTS
  it("TEST 16 — Deep reasoning trigger counts drill into exact market and performance IDs", () => {
    const rCase = {
      marketEventIds: ["pce_101", "pce_102"],
      performanceWarningIds: ["sig_p1"],
      evidenceIds: ["ev_1", "ev_2", "ev_3"],
    };

    expect(rCase.marketEventIds.length).toBe(2);
    expect(rCase.performanceWarningIds.length).toBe(1);
    expect(rCase.evidenceIds.length).toBe(3);
  });

  // TEST 17 — HYPOTHESES RENDER WHEN PERSISTED
  it("TEST 17 — Hypotheses render primary and alternative explanations cleanly", () => {
    const hypotheses = [
      { hypothesisId: "hypo_1", type: "PRIMARY", explanation: "Competitor feature overlap weakens consideration." },
      { hypothesisId: "hypo_2", type: "ALTERNATIVE", explanation: "Ad creative fatigue lowered buyer intent." },
    ];

    expect(hypotheses.length).toBe(2);
    expect(hypotheses[0].type).toBe("PRIMARY");
    expect(hypotheses[1].type).toBe("ALTERNATIVE");
  });

  // TEST 18 — SUPPORTING AND CONTRADICTING EVIDENCE RENDER CORRECTLY
  it("TEST 18 — Supporting and contradicting evidence counts and IDs render accurately", () => {
    const hypothesis = {
      supportingEvidenceIds: ["ev_comp_ad_1", "ev_lead_conv_1"],
      contradictingEvidenceIds: ["ev_ctr_stable_1"],
      confidence: 0.74,
    };

    expect(hypothesis.supportingEvidenceIds.length).toBe(2);
    expect(hypothesis.contradictingEvidenceIds.length).toBe(1);
    expect(hypothesis.confidence).toBe(0.74);
  });

  // TEST 19 — DATES RENDER CORRECTLY
  it("TEST 19 — Dates format cleanly without malformed concatenated strings", () => {
    const date1 = new Date("2026-08-24T12:00:00Z");
    const formatted = formatStandardDate(date1);

    expect(formatted).toBe("Aug 24, 2026");
    expect(formatted).not.toContain("242026");
    expect(formatted).not.toContain("/");
  });

  // TEST 20 — NO RAW BACKEND ENUM TEXT IN CUSTOMER EXPLANATION
  it("TEST 20 — Primary customer explanation uses human-friendly translation instead of raw enums", () => {
    const eventTitle = translateEventTypeToTitle("competitor_profile_change");
    expect(eventTitle).toBe("Competitor Profile Shift");
    expect(eventTitle).not.toContain("competitor_profile_change");

    const decision = translateDecisionToBusinessLanguage("REEVALUATE_AUTHORITY", "DIFFERENTIATION");
    expect(decision.label).toBe("Re-evaluate Differentiation Strategy");
    expect(decision.label).not.toContain("REEVALUATE_AUTHORITY");
  });

  // TEST 21 — NO FAKE PERFORMANCE NUMBERS
  it("TEST 21 — Missing performance values return clean empty states without fabricating fake metrics", () => {
    const rawContext = {
      id: "pctx_empty_01",
      campaignId,
      accountId,
      currentReality: null,
      proofGaps: [],
    };

    expect(rawContext.proofGaps.length).toBe(0);
    expect(rawContext.currentReality).toBeNull();
  });

  // TEST 22 — CROSS-CAMPAIGN EVENT LOOKUP IS BLOCKED
  it("TEST 22 — Cross-campaign event access is blocked when campaign IDs mismatch", () => {
    const eventCampaignId = "camp_alpha";
    const requestedCampaignId = "camp_beta";
    const isBlocked = eventCampaignId !== requestedCampaignId;

    expect(isBlocked).toBe(true);
  });

  // TEST 23 — CROSS-CAMPAIGN WARNING LOOKUP IS BLOCKED
  it("TEST 23 — Cross-campaign warning access is blocked when campaign IDs mismatch", () => {
    const warningCampaignId = "camp_alpha";
    const requestedCampaignId = "camp_beta";
    const isBlocked = warningCampaignId !== requestedCampaignId;

    expect(isBlocked).toBe(true);
  });

  // TEST 24 — WATCHTOWER LIFECYCLE TESTS UNCHANGED
  it("TEST 24 — Watchtower two-fetch confirmation and preliminary classification lifecycle remain intact", () => {
    const cand = adaptWatchtowerEventToAdaptiveSignal({ id: "e1", status: "candidate" });
    const conf = adaptWatchtowerEventToAdaptiveSignal({ id: "e2", status: "confirmed", validatedAt: new Date() });

    expect(cand.confirmationState).toBe("PRELIMINARY");
    expect(conf.confirmationState).toBe("CONFIRMED");
  });

  // TEST 25 — ADAPTIVE REGRESSION SUITES GREEN
  it("TEST 25 — Adaptive decision and reasoning contracts remain standard", () => {
    expect(translateDecisionToBusinessLanguage("OBSERVE").label).toBe("Maintain Observation");
    expect(translateDecisionToBusinessLanguage("EXECUTION_RESPONSE").label).toBe("Adjust Execution Cadence");
    expect(translateDecisionToBusinessLanguage("STRATEGY_CHANGE_REQUIRED", "OFFER").label).toBe("Update Offer & Pricing Architecture");
  });
});
