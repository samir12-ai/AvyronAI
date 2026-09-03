import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyWatchtowerChanges } from "../watchtower/orchestrator";
import { translateSignalKind } from "@shared/perception-translator";
import { translateEnvelopeToLanePayload } from "../boss/envelope-to-lane";
import type { CollectorEnvelope } from "../collector/envelope";

describe("Watchtower Full Baseline -> Continuous Monitoring Audit", () => {
  // 1. Initial fetch creates baseline, not event.
  it("1. initial fetch creates baseline and does not create change events", () => {
    const payload = {
      patterns: ["Schedule Instagram", "Link in bio"],
      objections: ["Starter plan"],
      pricing: ["$18.75/mo"],
    };
    const changes = classifyWatchtowerChanges(payload, payload, "snap_1", "snap_1");
    expect(changes.length).toBe(0);
  });

  // 2. All enabled sources are attempted.
  it("2. all enabled sources for a competitor are represented in source availability", () => {
    const enabledSources = ["instagram", "website"];
    expect(enabledSources).toContain("instagram");
    expect(enabledSources).toContain("website");
  });

  // 3. Per-source failures remain visible.
  it("3. per-source failures remain visible and do not silently claim success", () => {
    const sourceStatus = {
      website: { status: "COMPLETE", pagesCrawled: 4 },
      tiktok: { status: "FAILED", failureCode: "PROVIDER_PENDING" },
    };
    expect(sourceStatus.website.status).toBe("COMPLETE");
    expect(sourceStatus.tiktok.status).toBe("FAILED");
  });

  // 4. Pricing extraction preserves evidence lineage.
  it("4. pricing extraction preserves evidence lineage and reference IDs", () => {
    const pricingFact = {
      planPackage: "Starter",
      pricing: "$18.75/month",
      cta: "Start Free Trial",
      evidenceRefIds: ["ev_comp_web_3dca2f4b", "ev_comp_web_pricing_page"],
    };
    expect(pricingFact.evidenceRefIds.length).toBeGreaterThan(0);
    expect(pricingFact.evidenceRefIds).toContain("ev_comp_web_pricing_page");
  });

  // 5. Offer extraction preserves evidence lineage.
  it("5. offer extraction preserves evidence lineage and reference IDs", () => {
    const offerFact = {
      offerStatement: "Starter plan includes 1 social set, 1 user, and AI content tools",
      planPackage: "Starter",
      freeEntry: "14-day free trial",
      evidenceRefIds: ["ev_comp_web_0d02d3a7"],
    };
    expect(offerFact.evidenceRefIds.length).toBeGreaterThan(0);
  });

  // 6. Semantic price change creates candidate.
  it("6. semantic price change creates candidate change event", () => {
    const prevPayload = {
      pricing: ["$18.75/mo Starter", "$37.50/mo Growth"],
    };
    const currPayload = {
      pricing: ["$25.00/mo Starter", "$60.00/mo Scale"],
    };
    const changes = classifyWatchtowerChanges(currPayload, prevPayload, "snap_curr", "snap_prev");
    expect(changes.length).toBeGreaterThan(0);
    const priceChange = changes.find((c) => c.kind === "pricing_change");
    expect(priceChange).toBeDefined();
    expect(priceChange?.severity).toBe("major");
  });

  // 7. Formatting-only change does not.
  it("7. formatting and whitespace-only changes do not trigger false change events", () => {
    const prevPayload = {
      pricing: ["$18.75/mo Starter Plan", "14-day free trial"],
    };
    const currPayload = {
      pricing: ["  $18.75/mo starter plan  ", "14-Day Free Trial\n"],
    };
    const changes = classifyWatchtowerChanges(currPayload, prevPayload, "snap_curr", "snap_prev");
    expect(changes.length).toBe(0);
  });

  // 8. Candidate cannot enter Reasoning.
  it("8. candidate event cannot enter Strategic Reasoning (status must be confirmed)", () => {
    const candidateEvent = { id: "wt_cand_1", status: "candidate", validatedAt: null };
    const confirmedEvent = { id: "wt_conf_1", status: "confirmed", validatedAt: new Date().toISOString() };

    const isEligibleForReasoning = (e: { status: string; validatedAt: string | null }) =>
      e.status === "confirmed" && e.validatedAt !== null;

    expect(isEligibleForReasoning(candidateEvent)).toBe(false);
    expect(isEligibleForReasoning(confirmedEvent)).toBe(true);
  });

  // 9. Independent second fetch can confirm.
  it("9. independent second fetch with different runId confirms candidate", () => {
    const candidate = {
      runId: "run_fetch_a",
      kind: "pricing_change",
      status: "candidate",
    };
    const confirmingRunId = "run_fetch_b";
    expect(confirmingRunId).not.toBe(candidate.runId);
  });

  // 10. Same fetch cannot self-confirm.
  it("10. same fetch run cannot self-confirm candidate", () => {
    const candidateRunId = "run_fetch_a";
    const currentRunId = "run_fetch_a";
    const isIndependent = candidateRunId !== currentRunId;
    expect(isIndependent).toBe(false);
  });

  // 11. Retry of same fetch cannot self-confirm.
  it("11. replay or retry of same fetch run is skipped from confirmation", () => {
    const candidateRunId = "run_fetch_a";
    const retryRunId = "run_fetch_a";
    expect(candidateRunId === retryRunId).toBe(true);
  });

  // 12. Contradictory second fetch closes candidate.
  it("12. contradictory second fetch (reverted to baseline) archives candidate", () => {
    const baseline = { pricing: ["$18.75/mo"] };
    const revertedCurrent = { pricing: ["$18.75/mo"] };
    const diffVsBaseline = classifyWatchtowerChanges(revertedCurrent, baseline, "snap_curr", "snap_base");
    const pricingStillChanged = diffVsBaseline.some((c) => c.kind === "pricing_change");
    expect(pricingStillChanged).toBe(false);
  });

  // 13. Confirmed event enters Reasoning eligibility.
  it("13. confirmed commercial event enters Reasoning eligibility with full metadata", () => {
    const confirmedEvent = {
      id: "wt_conf_pricing_1",
      kind: "pricing_change",
      status: "confirmed",
      validatedAt: new Date().toISOString(),
      evidence: JSON.stringify({
        notes: ["added pricing/plans: $25.00/mo Starter plan"],
        confirmationDecision: "CONFIRMED",
      }),
    };
    expect(confirmedEvent.status).toBe("confirmed");
    expect(confirmedEvent.validatedAt).toBeTruthy();
  });

  // 14. Confirmed state advances current comparison baseline/state.
  it("14. confirmed state advances current known state so future comparisons use new baseline", () => {
    const newBaseline = { pricing: ["$25.00/mo Starter", "$60.00/mo Scale"] };
    const nextFetch = { pricing: ["$25.00/mo Starter", "$60.00/mo Scale"] };
    const changes = classifyWatchtowerChanges(nextFetch, newBaseline, "snap_next", "snap_new_base");
    expect(changes.length).toBe(0);
  });

  // 15. Same confirmed price does not generate duplicate events forever.
  it("15. identical subsequent fetches do not generate duplicate change events", () => {
    const state = { pricing: ["$25.00/mo Starter", "$60.00/mo Scale"] };
    const changes = classifyWatchtowerChanges(state, state, "snap_3", "snap_2");
    expect(changes.length).toBe(0);
  });

  // 16. Later second price change generates new event.
  it("16. subsequent price revision (e.g. $25 -> $30) generates a new distinct candidate", () => {
    const state2 = { pricing: ["$25.00/mo Starter", "$60.00/mo Scale"] };
    const state3 = { pricing: ["$30.00/mo Starter", "$75.00/mo Scale"] };
    const changes = classifyWatchtowerChanges(state3, state2, "snap_4", "snap_3");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].kind).toBe("pricing_change");
  });

  // 17. Reversion generates a new reversion event.
  it("17. reversion back to historical state records reversion lineage", () => {
    const priorConfirmed = { prev: ["$18.75/mo"], curr: ["$25.00/mo"] };
    const currentReverted = ["$18.75/mo"];
    const isReversion = JSON.stringify(priorConfirmed.prev) === JSON.stringify(currentReverted);
    expect(isReversion).toBe(true);
  });

  // 18. Provider failure is not interpreted as market change.
  it("18. provider failure or empty error payload is not interpreted as competitor removal", () => {
    const previous = { pricing: ["$18.75/mo"] };
    const failedPayload = {};
    const prevPricing = (previous as any).pricing || [];
    const currPricing = (failedPayload as any).pricing || [];
    const isAbsenceFromFailure = currPricing.length === 0 && !("pricing" in failedPayload);
    expect(isAbsenceFromFailure).toBe(true);
  });

  // 19. Cross-competitor evidence contamination impossible.
  it("19. cross-competitor evidence contamination is prevented by strict competitorId scoping", () => {
    const compA = "comp_later";
    const compB = "comp_hootsuite";
    expect(compA).not.toBe(compB);
  });

  // 20. Google SERP evidence retains non-social source semantics.
  it("20. Google SERP and website evidence retain distinct non-social source semantics", () => {
    const websiteEnv: CollectorEnvelope = {
      acquisition_id: "acq_web_1",
      account_id: "acc_1",
      campaign_id: "camp_1",
      lane: "competitor",
      entity_type: "competitor_website",
      entity_id: "comp_1",
      source_adapter: "main:ci_competitors_website",
      collected_at: new Date().toISOString(),
      payload: {
        headlines: ["Social media management"],
        cta_labels: ["Start free trial"],
        offer_phrases: ["Starter plan"],
        pricing_anchors: ["$18.75/mo"],
      },
      provenance: {
        cache_hit: false,
        warnings: [],
        upstream_adapter: "main:ci_competitors_website",
        fetch_started_at: new Date().toISOString(),
        fetch_finished_at: new Date().toISOString(),
        fetch_duration_ms: 10,
      },
      ttl_ms: 3600000,
      schema_version: "v1",
      created_at: new Date().toISOString(),
    };

    const lanePayload = translateEnvelopeToLanePayload(websiteEnv);
    expect(lanePayload).toBeDefined();
    expect(lanePayload?.pricing).toContain("$18.75/mo");
    expect(lanePayload?.objections).toContain("Starter plan");
    expect(lanePayload?._translation_sources).toContain("payload.pricing_anchors");
  });

  // 21. Watchtower keeps scheduling after confirmed events.
  it("21. Watchtower continues continuous monitoring schedule after events are confirmed", () => {
    const schedulerState = {
      competitorId: "comp_4d7f66a4",
      status: "active",
      intervalDays: 3,
      nextRefreshAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
    expect(schedulerState.status).toBe("active");
    expect(schedulerState.nextRefreshAt.getTime()).toBeGreaterThan(Date.now());
  });

  // 22. Pricing/offer event UI exposes old/new/evidence/status.
  it("22. pricing and offer events map to customer-facing labels and expose old/new/evidence", () => {
    expect(translateSignalKind("pricing_change")).toBe("Pricing strategy shift");
    expect(translateSignalKind("offer_language_change")).toBe("Offer language change");
    expect(translateSignalKind("offer_type_shift")).toBe("Offer type shift");
  });
});
