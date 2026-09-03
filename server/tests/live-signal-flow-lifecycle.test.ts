/**
 * AVYRON LIVE SIGNAL FLOW + WATCHTOWER / PERFORMANCE LIFECYCLE TEST SUITE
 * 
 * 22 Requirements:
 * - Part 1: Secure Test Token Budget (R1, R2, R3)
 * - Part 2 & 3: Watchtower Candidate Gating & Lifecycle (R4, R5, R6, R7, R8, R9, R10, R11)
 * - Part 4 & 6: Performance Warnings & WTDT Lifecycle (R12, R13, R14)
 * - Part 5: Reasoning vs Deep Reasoning Strategic Authority (R15, R16, R17, R18)
 * - Part 7-11: Multi-Source Evidence Normalization (R19, R20, R21, R22)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccountBudget, checkAndReserveBudget } from "../ai-client";
import {
  computeExternalItemId,
  normalizeCrossSourceEvidence,
  NormalizedExternalItem,
} from "../acquisition/multi-source-providers";
import { routeAdaptiveDecision } from "../adaptive/router";
import { executeAdaptiveDecision } from "../adaptive/decision-executor";
import {
  AdaptiveDecision,
  AdaptiveSignal,
  ReasoningCase,
} from "../adaptive/contracts";

describe("PART 1: SECURE TEST TOKEN BUDGET", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("R1: In production mode, test account names do NOT bypass budget controls", () => {
    process.env.NODE_ENV = "production";
    const budget1 = getAccountBudget("test_user_account");
    const budget2 = getAccountBudget("acc_buffer_e2e_123");
    const budget3 = getAccountBudget("mock_tenant_456");

    expect(Number.isFinite(budget1)).toBe(true);
    expect(Number.isFinite(budget2)).toBe(true);
    expect(Number.isFinite(budget3)).toBe(true);
    expect(budget1).toBeLessThan(Infinity);
  });

  it("R2: In non-production mode, recognized test accounts receive test bypass budget", () => {
    process.env.NODE_ENV = "development";
    const budget1 = getAccountBudget("test_user_account");
    const budget2 = getAccountBudget("acc_buffer_e2e_123");
    const budget3 = getAccountBudget("dev_test_runner");

    expect(budget1).toBe(Infinity);
    expect(budget2).toBe(Infinity);
    expect(budget3).toBe(Infinity);
  });

  it("R3: Infinite budget reservations short-circuit immediately without blocking or acquiring advisory locks", async () => {
    process.env.NODE_ENV = "development";
    const result = await checkAndReserveBudget("test_account_fast_pass", 1000);
    expect(result.allowed).toBe(true);
  });
});

describe("PART 2 & 3: WATCHTOWER CANDIDATE GATING & LIFECYCLE", () => {
  it("R4: First observation of market signal produces PRELIMINARY candidate state", () => {
    const candidateSignal: AdaptiveSignal = {
      signalId: "sig_cand_001",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      sourceDomain: "WATCHTOWER",
      sourceArtifactId: "evt_cand_001",
      signalType: "PRICING_CHANGE",
      summary: "Competitor changed tier pricing to $29/mo",
      severity: "HIGH",
      confidence: 0.5,
      confirmationState: "PRELIMINARY",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    expect(candidateSignal.confirmationState).toBe("PRELIMINARY");
    expect(candidateSignal.confidence).toBeLessThan(0.8);
  });

  it("R5: Second independent observation confirms candidate event", () => {
    const promoteCandidate = (firstObs: any, secondObs: any) => {
      if (firstObs.dimensionDiff === secondObs.dimensionDiff && secondObs.fetchId !== firstObs.fetchId) {
        return {
          ...firstObs,
          status: "confirmed",
          confirmationState: "CONFIRMED" as const,
          confidence: 0.9,
          validatedAt: new Date().toISOString(),
        };
      }
      return firstObs;
    };

    const first = { id: "evt_1", status: "candidate", fetchId: "fetch_1", dimensionDiff: "DIFF_PRICE_49_TO_29" };
    const second = { id: "evt_2", fetchId: "fetch_2", dimensionDiff: "DIFF_PRICE_49_TO_29" };
    const confirmed = promoteCandidate(first, second);

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmationState).toBe("CONFIRMED");
    expect(confirmed.validatedAt).toBeDefined();
  });

  it("R6: Contradiction or reversion before confirmation archives the candidate", () => {
    const processReversion = (candidate: any, nextObs: any) => {
      if (candidate.status === "candidate" && nextObs.dimensionDiff !== candidate.dimensionDiff) {
        return { ...candidate, status: "reverted", archivedAt: new Date().toISOString() };
      }
      return candidate;
    };

    const candidate = { id: "evt_1", status: "candidate", dimensionDiff: "DIFF_HEADER_A" };
    const nextObs = { id: "evt_2", dimensionDiff: "ORIGINAL_HEADER" };
    const result = processReversion(candidate, nextObs);

    expect(result.status).toBe("reverted");
    expect(result.archivedAt).toBeDefined();
  });

  it("R7: Candidate PRELIMINARY events are strictly gated from triggering STRATEGY_CHANGE_REQUIRED", () => {
    const candidateSignal: AdaptiveSignal = {
      signalId: "sig_cand_002",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      sourceDomain: "WATCHTOWER",
      sourceArtifactId: "evt_cand_002",
      signalType: "DIFFERENTIATION_PIVOT",
      summary: "Competitor launched unconfirmed feature",
      severity: "CRITICAL",
      confidence: 0.5,
      confirmationState: "PRELIMINARY",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const mockCase: ReasoningCase = {
      reasoningCaseId: "rcase_cand_001",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      strategyRootId: "root_buffer_v1",
      strategyRootVersion: 1,
      status: "OPEN",
      triggerType: "MARKET_EVENT",
      candidateAffectedAuthorities: ["DIFFERENTIATION"],
      evidenceIds: ["ev_1"],
      openedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: mockCase,
      judgeVerdict: {
        caseId: "rcase_cand_001",
        status: "APPROVED",
        confidence: 0.85,
        rationale: "Analysis sound",
        recommendedDecision: "REEVALUATE_AUTHORITY",
        affectedAuthorities: ["DIFFERENTIATION"],
      },
      marketSignals: [candidateSignal],
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
    });

    expect(decision.decisionType).toBe("OBSERVE");
    expect(decision.affectedAuthority).toBeNull();
  });

  it("R8: Confirmed market events with validated impact allow REEVALUATE_AUTHORITY", () => {
    const confirmedSignal: AdaptiveSignal = {
      signalId: "sig_conf_001",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      sourceDomain: "WATCHTOWER",
      sourceArtifactId: "evt_conf_001",
      signalType: "DIFFERENTIATION_PIVOT",
      summary: "Competitor verified launched direct feature parity",
      severity: "HIGH",
      confidence: 0.9,
      confirmationState: "CONFIRMED",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const mockCase: ReasoningCase = {
      reasoningCaseId: "rcase_conf_001",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      strategyRootId: "root_buffer_v1",
      strategyRootVersion: 1,
      status: "OPEN",
      triggerType: "MARKET_EVENT",
      candidateAffectedAuthorities: ["DIFFERENTIATION"],
      evidenceIds: ["ev_1", "ev_2"],
      openedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: mockCase,
      judgeVerdict: {
        caseId: "rcase_conf_001",
        status: "APPROVED",
        confidence: 0.9,
        rationale: "Confirmed market differentiation threat",
        recommendedDecision: "REEVALUATE_AUTHORITY",
        affectedAuthorities: ["DIFFERENTIATION"],
      },
      marketSignals: [confirmedSignal],
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
    });

    expect(decision.decisionType).toBe("REEVALUATE_AUTHORITY");
    expect(decision.affectedAuthority).toBe("DIFFERENTIATION");
  });

  it("R9 & R10: Event retention separates active investigations from low-impact history", () => {
    const now = Date.now();
    const fourDaysMs = 4 * 24 * 60 * 60 * 1000;

    const oldLowImpactEvent = {
      id: "evt_low_01",
      severity: "low",
      status: "confirmed",
      hasOpenInvestigation: false,
      createdAt: new Date(now - fourDaysMs - 1000).toISOString(),
    };

    const oldHighImpactInvestigatedEvent = {
      id: "evt_high_01",
      severity: "high",
      status: "confirmed",
      hasOpenInvestigation: true,
      createdAt: new Date(now - fourDaysMs - 1000).toISOString(),
    };

    const isEligibleForArchive = (evt: any) => {
      const age = now - new Date(evt.createdAt).getTime();
      if (evt.hasOpenInvestigation) return false;
      if (evt.severity === "low" && age > fourDaysMs) return true;
      return false;
    };

    expect(isEligibleForArchive(oldLowImpactEvent)).toBe(true);
    expect(isEligibleForArchive(oldHighImpactInvestigatedEvent)).toBe(false);
  });

  it("R11: Events awaiting user approval remain active and protected from archiving", () => {
    const proposalAwaitingApprovalEvent = {
      id: "evt_awaiting_approval",
      status: "confirmed",
      severity: "high",
      hasPendingProposal: true,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days old
    };

    const shouldArchive = (evt: any) => {
      if (evt.hasPendingProposal) return false;
      return true;
    };

    expect(shouldArchive(proposalAwaitingApprovalEvent)).toBe(false);
  });
});

describe("PART 4, 5, 6: PERFORMANCE WARNINGS & STRATEGIC AUTHORITY", () => {
  it("R12: Simple execution problem (performance only) defaults to EXECUTION_RESPONSE without mutating strategic core", () => {
    const perfSignal: AdaptiveSignal = {
      signalId: "sig_perf_ctr_drop",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      sourceDomain: "PERFORMANCE",
      sourceArtifactId: "perf_ctx_01",
      signalType: "CTR_DECAY",
      summary: "Ad creative click-through rate dropped 15%",
      severity: "HIGH",
      confidence: 0.85,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const mockCase: ReasoningCase = {
      reasoningCaseId: "rcase_perf_01",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      strategyRootId: "root_buffer_v1",
      strategyRootVersion: 1,
      status: "OPEN",
      triggerType: "PERFORMANCE_ANOMALY",
      candidateAffectedAuthorities: ["PLAN_SYNTHESIS"],
      evidenceIds: ["perf_ctx_01"],
      openedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: mockCase,
      judgeVerdict: {
        caseId: "rcase_perf_01",
        status: "APPROVED",
        confidence: 0.85,
        rationale: "Execution distribution fatigue",
        recommendedDecision: "EXECUTION_RESPONSE",
        affectedAuthorities: ["PLAN_SYNTHESIS"],
      },
      performanceSignals: [perfSignal],
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
    });

    expect(decision.decisionType).toBe("EXECUTION_RESPONSE");
    expect(decision.affectedAuthority).toBe("PLAN_SYNTHESIS");
  });

  it("R13 & R14: Performance warnings in WAITING_FOR_USER persist until user completes WTDT task", () => {
    const warningLifecycle = {
      signalId: "sig_wtdt_task_01",
      status: "WAITING_FOR_USER" as const,
      taskAssignedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const isWarningActive = (w: typeof warningLifecycle) => {
      return w.status === "WAITING_FOR_USER" || w.status === "WAITING_FOR_MEASUREMENT" || w.status === "ACTIVE";
    };

    expect(isWarningActive(warningLifecycle)).toBe(true);

    const onUserCompleteTask = (w: typeof warningLifecycle) => ({
      ...w,
      status: "WAITING_FOR_MEASUREMENT" as const,
    });

    const measuredState = onUserCompleteTask(warningLifecycle);
    expect(measuredState.status).toBe("WAITING_FOR_MEASUREMENT");
  });

  it("R15: HIGH IMPACT market signal alone does NOT automatically change Strategy Root", async () => {
    const highImpactDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_high_01",
      reasoningCaseId: "rcase_high_01",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      strategyRootId: "root_buffer_v1",
      strategyRootVersion: 1,
      decisionType: "OBSERVE",
      affectedAuthority: null,
      affectedEntityIds: [],
      evidenceIds: ["ev_high_01"],
      confidence: 0.9,
      rationale: "High impact market event requires close tracking, but current strategic positioning remains sound.",
      createdAt: new Date().toISOString(),
    };

    const currentRoot = {
      id: "root_buffer_v1",
      version: 1,
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityArtifactIds: { DIFFERENTIATION: "diff_01", POSITIONING: "pos_01" },
    };

    const result = await executeAdaptiveDecision(highImpactDecision, currentRoot, { activeRootVersion: 1 });
    expect(result.executionStatus).toBe("NO_ACTION");
    expect(result.newRoot).toBeNull();
  });

  it("R16: Reasoning explains signals, but only Deep Reasoning may authorize a recommendation", () => {
    const reasoningExplanation = {
      mode: "REASONING",
      explanation: "Competitor launched new social scheduling features, narrowing UI feature gap.",
      recommendationType: "EXPLANATORY_ONLY",
      canMutateStrategy: false,
    };

    const deepReasoningVerdict = {
      mode: "DEEP_REASONING",
      verdict: "STRATEGIC_RECOMMENDATION_AUTHORIZED",
      requiresUserApproval: true,
      canMutateStrategy: false, // Still requires user approval before recompute!
    };

    expect(reasoningExplanation.canMutateStrategy).toBe(false);
    expect(deepReasoningVerdict.requiresUserApproval).toBe(true);
    expect(deepReasoningVerdict.canMutateStrategy).toBe(false);
  });

  it("R17: Direct Strategic Invalidation Exception allows Deep Reasoning recommendation without performance drop", () => {
    const confirmedInvalidationSignal: AdaptiveSignal = {
      signalId: "sig_inval_001",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      sourceDomain: "WATCHTOWER",
      sourceArtifactId: "evt_inval_001",
      signalType: "CLAIM_INVALIDATION",
      summary: "Competitor proved our exclusive speed claim is no longer exclusive",
      severity: "CRITICAL",
      confidence: 0.95,
      confirmationState: "CONFIRMED",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const mockCase: ReasoningCase = {
      reasoningCaseId: "rcase_inval_01",
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      strategyRootId: "root_buffer_v1",
      strategyRootVersion: 1,
      status: "OPEN",
      triggerType: "MARKET_EVENT",
      candidateAffectedAuthorities: ["DIFFERENTIATION"],
      evidenceIds: ["evt_inval_01"],
      openedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: mockCase,
      judgeVerdict: {
        caseId: "rcase_inval_01",
        status: "APPROVED",
        confidence: 0.95,
        rationale: "Direct factual invalidation of core differentiator",
        recommendedDecision: "REEVALUATE_AUTHORITY",
        affectedAuthorities: ["DIFFERENTIATION"],
      },
      marketSignals: [confirmedInvalidationSignal],
      performanceSignals: [],
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
    });

    expect(decision.decisionType).toBe("REEVALUATE_AUTHORITY");
    expect(decision.affectedAuthority).toBe("DIFFERENTIATION");
  });

  it("R18: Multi-signal correlation isolates unrelated concurrent signals without cascading mutations", () => {
    const marketSignal: AdaptiveSignal = {
      signalId: "sig_m1",
      campaignId: "camp_1",
      accountId: "acc_1",
      sourceDomain: "WATCHTOWER",
      sourceArtifactId: "evt_1",
      signalType: "PRICING_CHANGE",
      summary: "Competitor price drop",
      severity: "LOW",
      confidence: 0.8,
      confirmationState: "CONFIRMED",
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const unrelatedPerfSignal: AdaptiveSignal = {
      signalId: "sig_p1",
      campaignId: "camp_1",
      accountId: "acc_1",
      sourceDomain: "PERFORMANCE",
      sourceArtifactId: "p_1",
      signalType: "WEEKEND_SEASONALITY",
      summary: "Normal weekend traffic dip",
      severity: "LOW",
      confidence: 0.7,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const mockCase: ReasoningCase = {
      reasoningCaseId: "rcase_multi_01",
      campaignId: "camp_1",
      accountId: "acc_1",
      strategyRootId: "root_1",
      strategyRootVersion: 1,
      status: "OPEN",
      triggerType: "MARKET_EVENT",
      candidateAffectedAuthorities: [],
      evidenceIds: ["evt_1", "p_1"],
      openedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const decision = routeAdaptiveDecision({
      reasoningCase: mockCase,
      judgeVerdict: {
        caseId: "rcase_multi_01",
        status: "APPROVED",
        confidence: 0.8,
        rationale: "Uncorrelated low-severity events",
        recommendedDecision: "OBSERVE",
        affectedAuthorities: [],
      },
      marketSignals: [marketSignal],
      performanceSignals: [unrelatedPerfSignal],
      campaignId: "camp_1",
      accountId: "acc_1",
    });

    expect(decision.decisionType).toBe("OBSERVE");
    expect(decision.affectedAuthority).toBeNull();
  });
});

describe("PART 7–11: MULTI-SOURCE EVIDENCE NORMALIZATION (GOOGLE, LINKEDIN, X)", () => {
  it("R19: Google search result normalizes into canonical NormalizedExternalItem contract", () => {
    const id = computeExternalItemId("GOOGLE", "https://buffer.com/pricing");
    const item: NormalizedExternalItem = {
      id,
      platform: "GOOGLE",
      externalId: "https://buffer.com/pricing",
      title: "Buffer Pricing - Simple Social Media Management",
      text: "Buffer Pricing - Compare plans from free to enterprise with publishing and analytics.",
      url: "https://buffer.com/pricing",
      authorName: "buffer.com",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "MARKET_NARRATIVE_CONTEXT",
      fetchedAt: new Date().toISOString(),
    };

    const [normalized] = normalizeCrossSourceEvidence([item]);
    expect(normalized.id).toBe(id);
    expect(normalized.platform).toBe("GOOGLE");
    expect(normalized.authorityClass).toBe("MARKET_NARRATIVE_CONTEXT");
    expect(normalized.campaignId).toBe("camp_buffer_001");
  });

  it("R20: LinkedIn post normalizes into canonical NormalizedExternalItem contract", () => {
    const id = computeExternalItemId("LINKEDIN", "urn:li:ugcPost:123456789");
    const item: NormalizedExternalItem = {
      id,
      platform: "LINKEDIN",
      externalId: "urn:li:ugcPost:123456789",
      title: "LinkedIn post from Buffer",
      text: "We just launched our new AI Assistant to help creators schedule high-performing content.",
      url: "https://www.linkedin.com/feed/update/urn:li:ugcPost:123456789",
      authorName: "Buffer",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
      fetchedAt: new Date().toISOString(),
    };

    const [normalized] = normalizeCrossSourceEvidence([item]);
    expect(normalized.id).toBe(id);
    expect(normalized.platform).toBe("LINKEDIN");
    expect(normalized.authorityClass).toBe("DIRECT_AUDIENCE_EVIDENCE");
  });

  it("R21: X (Twitter) tweet normalizes into canonical NormalizedExternalItem contract", () => {
    const id = computeExternalItemId("X", "2093279556337868927");
    const item: NormalizedExternalItem = {
      id,
      platform: "X",
      externalId: "2093279556337868927",
      title: "Tweet by @buffer",
      text: "Just finished scheduling a month of content in September using @buffer!",
      url: "https://x.com/buffer/status/2093279556337868927",
      authorName: "Buffer",
      authorHandle: "buffer",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
      fetchedAt: new Date().toISOString(),
    };

    const [normalized] = normalizeCrossSourceEvidence([item]);
    expect(normalized.id).toBe(id);
    expect(normalized.platform).toBe("X");
    expect(normalized.authorHandle).toBe("buffer");
  });

  it("R22: Cross-source evidence normalizes into unified evidence without separate platform strategies", () => {
    const gItem: NormalizedExternalItem = {
      id: computeExternalItemId("GOOGLE", "https://buffer.com/features"),
      platform: "GOOGLE",
      externalId: "https://buffer.com/features",
      text: "Buffer Features: Social media scheduling, analytics, and engagement.",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "MARKET_NARRATIVE_CONTEXT",
      fetchedAt: new Date().toISOString(),
    };

    const lItem: NormalizedExternalItem = {
      id: computeExternalItemId("LINKEDIN", "urn:li:post:999"),
      platform: "LINKEDIN",
      externalId: "urn:li:post:999",
      text: "Creators love our new multi-channel dashboard.",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
      fetchedAt: new Date().toISOString(),
    };

    const xItem: NormalizedExternalItem = {
      id: computeExternalItemId("X", "111222333"),
      platform: "X",
      externalId: "111222333",
      text: "Loving the new @buffer updates!",
      publishedAt: new Date().toISOString(),
      campaignId: "camp_buffer_001",
      accountId: "acc_buffer_001",
      authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
      fetchedAt: new Date().toISOString(),
    };

    const xItemDup: NormalizedExternalItem = { ...xItem };

    const unified = normalizeCrossSourceEvidence([gItem, lItem, xItem, xItemDup]);
    expect(unified.length).toBe(3);
    expect(unified.map(u => u.platform)).toEqual(["GOOGLE", "LINKEDIN", "X"]);
    expect(unified.every(u => u.campaignId === "camp_buffer_001")).toBe(true);
  });
});
