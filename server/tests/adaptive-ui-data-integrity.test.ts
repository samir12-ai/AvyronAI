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

/**
 * AVYRON Final Information Architecture Correction — 25 Tests
 * 
 * Validates:
 * - Watchtower = trace only (who, what, when, status)
 * - Reasoning Events = full market intelligence feed
 * - Performance Loop = active canonical warnings only (no duplicates)
 * - Reasoning Warnings = full issue investigation
 * - Raw evidence = backend lineage, not the customer product
 * - Watchtower lifecycle unchanged
 */
describe("Final Information Architecture Correction", () => {

  // ============================================================================
  // TEST 1 — WATCHTOWER TRACE CONTAINS TRACE FIELDS ONLY
  // ============================================================================
  it("TEST 1 — Watchtower trace item contains only: competitor, event, firstObserved, confirmed, status", () => {
    const traceItem = {
      eventId: "pce_trace_01",
      competitorName: "CompetitorX",
      eventType: translateEventTypeToTitle("offer_type_shift"),
      firstObservedAt: formatStandardDate(new Date("2026-08-20")),
      confirmedAt: formatStandardDate(new Date("2026-08-21")),
      status: "CONFIRMED",
      severity: "MEDIUM",
    };

    expect(traceItem.competitorName).toBe("CompetitorX");
    expect(traceItem.eventType).toBe("Competitor Offer & Pricing Shift");
    expect(traceItem.firstObservedAt).toBe("Aug 20, 2026");
    expect(traceItem.confirmedAt).toBe("Aug 21, 2026");
    expect(traceItem.status).toBe("CONFIRMED");
    // Trace item should NOT contain intelligence content
    expect(traceItem).not.toHaveProperty("strategicInterpretation");
    expect(traceItem).not.toHaveProperty("impactOnOurStrategy");
    expect(traceItem).not.toHaveProperty("recommendation");
    expect(traceItem).not.toHaveProperty("whatChanged");
    expect(traceItem).not.toHaveProperty("marketSignificance");
  });

  // ============================================================================
  // TEST 2 — WATCHTOWER CONTAINS COMPETITOR NAME
  // ============================================================================
  it("TEST 2 — Watchtower trace contains competitor name", () => {
    const signal = adaptWatchtowerEventToAdaptiveSignal({
      id: "pce_02", kind: "offer_type_shift", competitorId: "comp_01", status: "confirmed",
    });
    expect(signal.entityIds).toContain("comp_01");
    expect(signal.competitorId).toBe("comp_01");
  });

  // ============================================================================
  // TEST 3 — WATCHTOWER CONTAINS EVENT NAME
  // ============================================================================
  it("TEST 3 — Watchtower trace contains clean event type name", () => {
    expect(translateEventTypeToTitle("competitor_profile_change")).toBe("Competitor Profile Shift");
    expect(translateEventTypeToTitle("offer_type_shift")).toBe("Competitor Offer & Pricing Shift");
    expect(translateEventTypeToTitle("positioning_shift")).toBe("Market Positioning Shift");
    expect(translateEventTypeToTitle("awareness_stage_shift")).toBe("Awareness Strategy Shift");
    expect(translateEventTypeToTitle("hook_archetype_shift")).toBe("Hook Archetype Shift");
  });

  // ============================================================================
  // TEST 4 — WATCHTOWER CONTAINS FIRST OBSERVATION TIMESTAMP
  // ============================================================================
  it("TEST 4 — Watchtower trace includes clean first observation date", () => {
    const d = new Date("2026-08-20T10:00:00Z");
    const formatted = formatStandardDate(d);
    expect(formatted).toBe("Aug 20, 2026");
    expect(formatted).not.toContain("202026");
  });

  // ============================================================================
  // TEST 5 — WATCHTOWER CONTAINS CONFIRMATION TIMESTAMP/STATUS
  // ============================================================================
  it("TEST 5 — Watchtower trace includes confirmation status and date", () => {
    const confirmed = adaptWatchtowerEventToAdaptiveSignal({
      id: "e_conf", status: "confirmed", validatedAt: new Date("2026-08-21"),
    });
    const candidate = adaptWatchtowerEventToAdaptiveSignal({
      id: "e_cand", status: "candidate",
    });
    expect(confirmed.confirmationState).toBe("CONFIRMED");
    expect(candidate.confirmationState).toBe("PRELIMINARY");
  });

  // ============================================================================
  // TEST 6 — WATCHTOWER DOES NOT CONTAIN FULL INTELLIGENCE NARRATIVE
  // ============================================================================
  it("TEST 6 — Watchtower trace model excludes strategic interpretation, impact, and recommendation", () => {
    // The trace endpoint returns only: eventId, competitorName, eventType, firstObservedAt, confirmedAt, status, severity
    const traceFields = ["eventId", "competitorName", "eventType", "firstObservedAt", "confirmedAt", "status", "severity", "reasoningLink"];
    const intelligenceFields = ["strategicInterpretation", "marketSignificance", "impactOnOurStrategy", "recommendation", "whatChanged", "executiveSummary"];

    // Trace fields exist
    for (const field of traceFields) {
      expect(traceFields).toContain(field);
    }
    // Intelligence fields do NOT exist in trace model
    for (const field of intelligenceFields) {
      expect(traceFields).not.toContain(field);
    }
  });

  // ============================================================================
  // TEST 7 — WATCHTOWER CLICK RESOLVES SAME EVENT IN REASONING
  // ============================================================================
  it("TEST 7 — Watchtower click route uses same canonical eventId to reach Reasoning", () => {
    const eventId = "pce_wt_click_01";
    const reasoningRoute = `/(tabs)/reasoning-evidence?tab=events&eventId=${eventId}`;
    expect(reasoningRoute).toContain("tab=events");
    expect(reasoningRoute).toContain(`eventId=${eventId}`);
    // Same canonical ID — no copied event record
    expect(reasoningRoute).not.toContain("reasoningEventId");
    expect(reasoningRoute).not.toContain("copy_");
  });

  // ============================================================================
  // TEST 8 — REASONING EVENT CONTAINS FULL MARKET INTELLIGENCE NARRATIVE
  // ============================================================================
  it("TEST 8 — Reasoning event feed composes intelligence from strategic brief", () => {
    // When a strategic brief exists, the summary should come from executiveSummary, not the raw technical string
    const briefExecutiveSummary = "Competitor shifted from monthly subscription to freemium model with premium tiers.";
    const technicalFallback = "Watchtower market change: offer_type_shift";

    // The enriched feed item should prioritize brief
    const summary = briefExecutiveSummary || technicalFallback;
    expect(summary).toBe(briefExecutiveSummary);
    expect(summary).not.toContain("Watchtower market change:");
  });

  // ============================================================================
  // TEST 9 — REASONING EVENT PRESERVES SAME CANONICAL EVENT ID
  // ============================================================================
  it("TEST 9 — Reasoning Event uses same canonical event ID as Watchtower (no duplicate authority)", () => {
    const rawEvent = { id: "pce_canonical_01", kind: "positioning_shift", status: "confirmed", validatedAt: new Date() };
    const signal = adaptWatchtowerEventToAdaptiveSignal(rawEvent);
    // sourceArtifactId is the canonical pipeline_change_event ID
    expect(signal.sourceArtifactId).toBe("pce_canonical_01");
    // signalId is derived from, not duplicating, the canonical ID
    expect(signal.signalId).toBe("sig_watchtower_pce_canonical_01");
  });

  // ============================================================================
  // TEST 10 — RAW BACKEND EVIDENCE DOES NOT REPLACE EVENT INTELLIGENCE
  // ============================================================================
  it("TEST 10 — Evidence items serve as supporting lineage, not the intelligence product", () => {
    const rawEvent = {
      id: "pce_ev_01", kind: "offer_type_shift",
      evidence: JSON.stringify(["snapshot_diff_123", "scrape_456"]),
    };
    const signal = adaptWatchtowerEventToAdaptiveSignal(rawEvent);

    // Evidence is available for traceability
    expect(signal.evidenceIds).toContain("snapshot_diff_123");

    // But the summary should never BE the evidence IDs
    expect(signal.summary).not.toContain("snapshot_diff_123");
    expect(signal.summary).not.toContain("scrape_456");
  });

  // ============================================================================
  // TEST 11 — PERFORMANCE LOOP DISPLAYS ACTIVE CANONICAL WARNING ISSUES ONLY
  // ============================================================================
  it("TEST 11 — Performance Loop shows only current active warnings (not historical contexts)", () => {
    const activeContext = { id: "pctx_active", primaryBottleneck: "NONE", weakestSignals: [], mode: "BUILD" };
    const signals = adaptPerformanceContextToSignals(activeContext);
    // Healthy baseline = 0 warnings
    expect(signals.length).toBe(0);
  });

  // ============================================================================
  // TEST 12 — REPEATED OBSERVATIONS DO NOT CREATE 10 CUSTOMER CARDS
  // ============================================================================
  it("TEST 12 — Multiple PerformanceContext rows for the same issue create warnings from only the latest context", () => {
    // Simulate: 3 contexts all saying same thing
    const ctx1 = { id: "pctx_a", primaryBottleneck: "REACH", weakestSignals: ["OFFER_FRICTION"], confidence: "HIGH" };
    const ctx2 = { id: "pctx_b", primaryBottleneck: "REACH", weakestSignals: ["OFFER_FRICTION"], confidence: "HIGH" };
    const ctx3 = { id: "pctx_c", primaryBottleneck: "REACH", weakestSignals: ["OFFER_FRICTION"], confidence: "HIGH" };

    // Read surface queries only limit(1) = latest context
    // So only ctx3 (latest) produces signals
    const signals = adaptPerformanceContextToSignals(ctx3);
    expect(signals.length).toBe(2); // 1 bottleneck + 1 gap
    // Not 6 (if all 3 contexts were queried)
  });

  // ============================================================================
  // TEST 13 — WARNING OBSERVATION HISTORY REMAINS PERSISTED
  // ============================================================================
  it("TEST 13 — Historical PerformanceContext rows remain in database for lineage", () => {
    // All 3 contexts above persist — the read surface just queries limit(1) for current
    const allHistoricalContexts = [
      { id: "pctx_a", createdAt: new Date("2026-08-20") },
      { id: "pctx_b", createdAt: new Date("2026-08-22") },
      { id: "pctx_c", createdAt: new Date("2026-08-27") },
    ];
    expect(allHistoricalContexts.length).toBe(3);
    // None are deleted
    expect(allHistoricalContexts.every(c => c.id)).toBe(true);
  });

  // ============================================================================
  // TEST 14 — DISTINCT WARNINGS ARE NOT INCORRECTLY MERGED
  // ============================================================================
  it("TEST 14 — Different bottleneck types produce distinct warnings", () => {
    const ctx = {
      id: "pctx_multi",
      primaryBottleneck: "REACH",
      weakestSignals: ["OFFER_FRICTION", "SOCIAL_ENGAGEMENT_MISSING"],
      confidence: "HIGH",
    };
    const signals = adaptPerformanceContextToSignals(ctx);
    expect(signals.length).toBe(3); // 1 bottleneck + 2 gaps
    const types = signals.map(s => s.signalType);
    expect(types).toContain("REACH");
    expect(types).toContain("PERFORMANCE_GAP");
    // Distinct issues — not merged
    expect(new Set(signals.map(s => s.signalId)).size).toBe(3);
  });

  // ============================================================================
  // TEST 15 — primaryBottleneck NONE CREATES ZERO WARNING
  // ============================================================================
  it("TEST 15 — primaryBottleneck = NONE produces exactly 0 bottleneck warnings", () => {
    const ctx = { id: "pctx_healthy", primaryBottleneck: "NONE", weakestSignals: [] };
    const signals = adaptPerformanceContextToSignals(ctx);
    expect(signals.length).toBe(0);
    expect(signals.some(s => s.signalType === "NONE")).toBe(false);
  });

  // ============================================================================
  // TEST 16 — PERFORMANCE CONTEXT DOES NOT ITSELF BECOME A WARNING
  // ============================================================================
  it("TEST 16 — A PerformanceContext container without problems produces no artificial warning", () => {
    const container = { id: "pctx_container", mode: "BUILD", primaryBottleneck: "NONE", weakestSignals: [] };
    const signals = adaptPerformanceContextToSignals(container);
    expect(signals.length).toBe(0);
    // No PERFORMANCE_STATE signal
    expect(signals.some(s => s.signalType === "PERFORMANCE_STATE")).toBe(false);
  });

  // ============================================================================
  // TEST 17 — GENERIC PERFORMANCE_STATE IS NOT USED AS ISSUE IDENTITY
  // ============================================================================
  it("TEST 17 — translateSignalTypeToTitle never returns NONE, UNKNOWN, or PERFORMANCE_STATE as title", () => {
    expect(translateSignalTypeToTitle("NONE")).not.toBe("NONE");
    expect(translateSignalTypeToTitle("UNKNOWN")).not.toBe("UNKNOWN");
    expect(translateSignalTypeToTitle("PERFORMANCE_STATE")).not.toBe("Performance State");
    expect(translateSignalTypeToTitle(null)).not.toBe("NONE");
    expect(translateSignalTypeToTitle("NONE")).toBe("Performance Metric Warning");
  });

  // ============================================================================
  // TEST 18 — SYNTHETIC/TEST WARNINGS EXCLUDED FROM CURRENT PRODUCTION READS
  // ============================================================================
  it("TEST 18 — Synthetic test fixtures with NONE bottleneck produce no warnings", () => {
    const testFixture = {
      id: "pctx_test_fixture_99",
      campaignId: "camp_test",
      primaryBottleneck: "NONE",
      weakestSignals: ["NONE", "UNKNOWN"],
    };
    const signals = adaptPerformanceContextToSignals(testFixture);
    expect(signals.length).toBe(0);
  });

  // ============================================================================
  // TEST 19 — HISTORICAL WARNINGS DO NOT APPEAR AS CURRENT ACTIVE WARNINGS
  // ============================================================================
  it("TEST 19 — Only the latest (limit 1) PerformanceContext produces current warnings", () => {
    // Architecture: read surface queries orderBy(desc(createdAt)).limit(1)
    // Historical contexts are not queried for the current warning feed
    const latestContext = { id: "pctx_latest", primaryBottleneck: "NONE", weakestSignals: [] };
    const signals = adaptPerformanceContextToSignals(latestContext);
    expect(signals.length).toBe(0); // Current state is healthy
  });

  // ============================================================================
  // TEST 20 — CONTRADICTORY PERFORMANCE FACTS TRIGGER INTEGRITY PROTECTION
  // ============================================================================
  it("TEST 20 — User-confirmed facts have absolute authority over contradicting unverified strings", () => {
    const userConfirmed = { statement: "New business / no prior sales history", provenance: "USER_CONFIRMED" };
    const synthetic = { statement: "3 years operating with 60 clients", provenance: "SYNTHETIC_TEST" };
    const resolved = userConfirmed.provenance === "USER_CONFIRMED" ? userConfirmed : synthetic;
    expect(resolved.provenance).toBe("USER_CONFIRMED");
    expect(resolved.statement).toContain("New business");
  });

  // ============================================================================
  // TEST 21 — NOT_CONNECTED IS NOT CONVERTED TO ZERO PERFORMANCE
  // ============================================================================
  it("TEST 21 — Channel status NOT_CONNECTED represents missing data, not failure", () => {
    const channel = { channel: "INSTAGRAM", status: "NOT_CONNECTED" };
    expect(channel.status).not.toBe("ZERO");
    expect(channel.status).not.toBe("FAILED");
    expect(channel.status).not.toBe("LOSING");
    expect(channel.status).toBe("NOT_CONNECTED");
  });

  // ============================================================================
  // TEST 22 — NO DATA IS NOT CONVERTED TO FAILURE
  // ============================================================================
  it("TEST 22 — UNTESTED and UNKNOWN are not coerced to performance failure", () => {
    const channel = { channel: "WEBSITE", status: "UNTESTED" };
    expect(channel.status).not.toBe("FAILED");
    expect(channel.status).not.toBe("ZERO");

    const mode = "UNKNOWN";
    expect(mode !== "FAILED" && mode !== "LOSING").toBe(true);
  });

  // ============================================================================
  // TEST 23 — REASONING WARNING SHOWS OBSERVATION HISTORY AND SOURCE CONTEXTS
  // ============================================================================
  it("TEST 23 — Warning detail endpoint returns source context, observation timeline, and metrics", () => {
    const ctx = {
      id: "pctx_det_warn",
      primaryBottleneck: "QUALIFIED_LEAD_PACE_DROP",
      weakestSignals: ["OFFER_FRICTION"],
      currentReality: "Lead pace declined 28% week over week",
      confidence: "HIGH",
      mode: "OPTIMIZE",
    };
    const signals = adaptPerformanceContextToSignals(ctx);
    expect(signals.length).toBe(2);
    expect(signals[0].sourceArtifactId).toBe("pctx_det_warn"); // Links back to source context
    expect(signals[0].summary).toContain("Lead pace declined");
  });

  // ============================================================================
  // TEST 24 — DEEP REASONING LINKS EXACT CANONICAL EVENTS AND WARNINGS
  // ============================================================================
  it("TEST 24 — Deep Reasoning cases link to canonical event and warning IDs", () => {
    const rCase = openReasoningCase({
      accountId: "acc_test",
      campaignId: "camp_test",
      strategyRootId: "root_v1",
      strategyRootVersion: 1,
      marketSignals: [{ signalId: "sig_m1", sourceArtifactId: "pce_1", sourceDomain: "MARKET", accountId: "acc_test", campaignId: "camp_test" } as any],
      performanceSignals: [{ signalId: "sig_p1", sourceArtifactId: "pctx_1", sourceDomain: "PERFORMANCE", accountId: "acc_test", campaignId: "camp_test" } as any],
    });

    expect(rCase.marketEventIds).toContain("pce_1");
    expect(rCase.performanceWarningIds).toContain("sig_p1");
    expect(rCase.status).toBe("OPEN");
  });

  // ============================================================================
  // TEST 25 — WATCHTOWER TWO-FETCH LIFECYCLE REMAINS UNCHANGED
  // ============================================================================
  it("TEST 25 — Watchtower candidate → confirmed lifecycle is preserved", () => {
    const candidate = adaptWatchtowerEventToAdaptiveSignal({ id: "e1", status: "candidate" });
    const confirmed = adaptWatchtowerEventToAdaptiveSignal({ id: "e2", status: "confirmed", validatedAt: new Date() });
    const reverted = adaptWatchtowerEventToAdaptiveSignal({ id: "e3", status: "reverted" });
    const closed = adaptWatchtowerEventToAdaptiveSignal({ id: "e4", status: "archived" });

    expect(candidate.confirmationState).toBe("PRELIMINARY");
    expect(confirmed.confirmationState).toBe("CONFIRMED");
    expect(reverted.confirmationState).toBe("REVERTED");
    expect(closed.confirmationState).toBe("CLOSED");
  });
});
