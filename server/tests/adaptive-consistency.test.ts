import { describe, it, expect } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  isValidAuthorityName,
} from "../adaptive/authority-registry";
import {
  adaptPerformanceContextToSignals,
  adaptPerformanceContextToSignal,
} from "../adaptive/adapters";
import {
  ReasoningCase,
  AdaptiveDecision,
  AdaptiveSignal,
} from "../adaptive/contracts";
import { routeAdaptiveDecision } from "../adaptive/router";
import { validateAdaptiveDecision, LineageIntegrityError } from "../adaptive/lineage";

describe("Phase 0 — Foundation Consistency Audit Test Suite", () => {
  // TEST 1 — PERFORMANCE CONTEXT IS NOT WARNING IDENTITY
  it("TEST 1 — Multiple warnings from one Performance Context container have distinct stable signal IDs", () => {
    const mockContext = {
      id: "PC_001",
      businessExecutionStateId: "bstate_99",
      accountId: "acc_1",
      campaignId: "camp_1",
      mode: "OPTIMIZE",
      primaryBottleneck: "CHANNEL_CONVERSION_DROP",
      currentReality: "Landing page conversion dropped by 25%",
      weakestSignals: ["QUALIFIED_LEAD_PACE_DROP", "PROOF_CONFIDENCE_LOW"],
      confidence: "HIGH",
      evidenceRefIds: ["ev_1", "ev_2"],
      createdAt: new Date(),
    };

    const signals = adaptPerformanceContextToSignals(mockContext);
    expect(signals.length).toBe(3); // 1 bottleneck + 2 weakest signal gaps

    const signalIds = signals.map(s => s.signalId);
    // All signal IDs must be distinct
    expect(new Set(signalIds).size).toBe(3);
    expect(signalIds).toContain("sig_perf_bottleneck_PC_001");
    expect(signalIds).toContain("sig_perf_gap_PC_001_0");
    expect(signalIds).toContain("sig_perf_gap_PC_001_1");
  });

  // TEST 2 — PERFORMANCE SIGNAL PARENT LINEAGE
  it("TEST 2 — A performance AdaptiveSignal preserves sourceArtifactId referencing parent performanceContextId", () => {
    const mockContext = {
      id: "PC_001",
      businessExecutionStateId: "bstate_99",
      accountId: "acc_1",
      campaignId: "camp_1",
      mode: "BUILD",
      primaryBottleneck: "OFFER_CLARITY",
      confidence: "MEDIUM",
      evidenceRefIds: ["ev_10"],
      createdAt: new Date(),
    };

    const signals = adaptPerformanceContextToSignals(mockContext);
    for (const sig of signals) {
      expect(sig.sourceDomain).toBe("PERFORMANCE");
      expect(sig.sourceArtifactId).toBe("PC_001"); // Parent container reference
      expect(sig.signalId).not.toBe("PC_001");     // Distinct signal ID
    }
  });

  // TEST 3 — PRODUCT TRUTH OWNER
  it("TEST 3 — Canonical Product Truth resolves to BusinessUnderstandingEngine", () => {
    const buDef = getAuthorityDefinition("BUSINESS_UNDERSTANDING");
    expect(buDef.ownerEngine).toBe("BusinessUnderstandingEngine");
    expect(buDef.canonicalTable).toBe("business_understanding_snapshots");
    expect(buDef.description).toContain("product truth facts");
  });

  // TEST 4 — PRODUCT ASSESSMENT IS NOT PRODUCT TRUTH OWNER
  it("TEST 4 — Product Assessment is an assessor evaluating fit, not canonical Product Truth owner", () => {
    const paDef = getAuthorityDefinition("PRODUCT_ASSESSMENT");
    expect(paDef.ownerEngine).toBe("ProductAssessmentEngine");
    expect(paDef.canonicalTable).toBe("product_assessments");
    expect(paDef.upstreamDependencies).toContain("BUSINESS_UNDERSTANDING");
    expect(paDef.description).toContain("without owning canonical Product Truth");
  });

  // TEST 5 — TARGET UNDERSTANDING OWNER
  it("TEST 5 — Canonical Target Understanding resolves to BusinessUnderstandingEngine", () => {
    const buDef = getAuthorityDefinition("BUSINESS_UNDERSTANDING");
    expect(buDef.ownerEngine).toBe("BusinessUnderstandingEngine");
    expect(buDef.canonicalTable).toBe("business_understanding_snapshots");
    expect(buDef.description).toContain("target understanding roles");
  });

  // TEST 6 — TARGET ASSESSMENT IS NOT TARGET OWNER
  it("TEST 6 — Target Assessment is an assessor evaluating coverage, not canonical Target Understanding owner", () => {
    const taDef = getAuthorityDefinition("TARGET_ASSESSMENT");
    expect(taDef.ownerEngine).toBe("TargetAssessmentEngine");
    expect(taDef.canonicalTable).toBe("target_assessments");
    expect(taDef.upstreamDependencies).toContain("BUSINESS_UNDERSTANDING");
    expect(taDef.description).toContain("without owning canonical Target Understanding");
  });

  // TEST 7 — REASONING OWNS DIAGNOSIS
  it("TEST 7 — ReasoningCase owns causal hypotheses and candidate affected authorities", () => {
    const reasoningCase: ReasoningCase = {
      reasoningCaseId: "rcase_100",
      accountId: "acc_1",
      campaignId: "camp_1",
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketEventIds: ["evt_comp_1"],
      performanceWarningIds: ["sig_perf_bottleneck_PC_001"],
      evidenceIds: ["ev_1", "ev_2"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["DIFFERENTIATION"],
      hypotheses: [
        {
          hypothesisId: "hyp_1",
          reasoningCaseId: "rcase_100",
          hypothesisType: "COMPETITOR_CLAIM_CONVERGENCE",
          explanation: "Competitor launched live streaming intelligence claim overlapping with primary pillar",
          supportingEvidenceIds: ["ev_1"],
          contradictingEvidenceIds: [],
          alternativeCauseIds: [],
          confidence: 0.88,
          status: "VALIDATED",
        },
      ],
    };

    expect(reasoningCase.candidateAffectedAuthorities).toContain("DIFFERENTIATION");
    expect(reasoningCase.hypotheses?.[0].status).toBe("VALIDATED");
  });

  // TEST 8 — ADAPTIVE DECISION HAS DISTINCT ROUTING OWNERSHIP
  it("TEST 8 — AdaptiveRouter produces structured AdaptiveDecision from validated reasoning case", () => {
    const reasoningCase: ReasoningCase = {
      reasoningCaseId: "rcase_100",
      accountId: "acc_1",
      campaignId: "camp_1",
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketEventIds: ["evt_comp_1"],
      performanceWarningIds: [],
      evidenceIds: ["ev_1"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["DIFFERENTIATION"],
    };

    const decision = routeAdaptiveDecision({
      reasoningCase,
      judgeVerdict: {
        status: "VALIDATED",
        confidence: 0.9,
        rationale: "Validated hypothesis: Competitor overlap requires differentiation review.",
      },
      campaignId: "camp_1",
      accountId: "acc_1",
    });

    expect(decision.decisionType).toBe("REEVALUATE_AUTHORITY");
    expect(decision.affectedAuthority).toBe("DIFFERENTIATION");
    expect(decision.strategyRootVersion).toBe(56);
    expect(decision.confidence).toBe(0.9);
  });

  // TEST 9 — ROUTER CANNOT REWRITE STRATEGY
  it("TEST 9 — Adaptive Router output identifies affectedAuthority but cannot contain replacement strategy payloads", () => {
    const reasoningCase: ReasoningCase = {
      reasoningCaseId: "rcase_100",
      accountId: "acc_1",
      campaignId: "camp_1",
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketEventIds: ["evt_comp_1"],
      performanceWarningIds: [],
      evidenceIds: ["ev_1"],
      status: "EVALUATED",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
      candidateAffectedAuthorities: ["OFFER"],
    };

    const decision = routeAdaptiveDecision({
      reasoningCase,
      judgeVerdict: {
        status: "VALIDATED",
        confidence: 0.85,
        rationale: "Offer friction identified.",
      },
      campaignId: "camp_1",
      accountId: "acc_1",
    });

    expect(decision.affectedAuthority).toBe("OFFER");

    // Must not contain replacement strategic fields
    expect((decision as any).primaryOffer).toBeUndefined();
    expect((decision as any).positioningStatement).toBeUndefined();
    expect((decision as any).differentiationPillars).toBeUndefined();

    // Violation attempt: trying to inject replacement strategy into decision metadata
    const illegalDecision = {
      ...decision,
      metadata: { primaryOffer: { coreOutcome: "Unauthorized offer rewrite" } },
    };

    expect(() => validateAdaptiveDecision(illegalDecision as any)).toThrowError(
      LineageIntegrityError
    );
  });

  // TEST 10 — ONE ENTITY ONE OWNER
  it("TEST 10 — No duplicate authority between Business Understanding, Product Assessment, Target Assessment, and Router", () => {
    const bu = getAuthorityDefinition("BUSINESS_UNDERSTANDING");
    const pa = getAuthorityDefinition("PRODUCT_ASSESSMENT");
    const ta = getAuthorityDefinition("TARGET_ASSESSMENT");

    // All must have distinct tables and owners
    expect(bu.canonicalTable).not.toBe(pa.canonicalTable);
    expect(bu.canonicalTable).not.toBe(ta.canonicalTable);
    expect(pa.canonicalTable).not.toBe(ta.canonicalTable);

    expect(bu.ownerEngine).not.toBe(pa.ownerEngine);
    expect(bu.ownerEngine).not.toBe(ta.ownerEngine);
    expect(pa.ownerEngine).not.toBe(ta.ownerEngine);
  });
});
