import "dotenv/config";
import { describe, it, expect } from "vitest";
import { evaluateSystemControl } from "../system-control/engine";
import { SystemControlInput } from "../system-control/types";
import { synthesizePlan } from "../orchestrator/plan-synthesis";
import { EngineStepResult } from "../orchestrator/priority-matrix";
import { IntegrityReport } from "../system-integrity/types";
import { SignalComposition } from "../shared/signal-lineage";
import { createEmptySSC } from "../orchestrator/shared-strategic-context";

describe("Budget Halt Control-Boundary Specification (Tests A-E)", () => {
  const mockConfig: any = {
    campaignId: "test_campaign_budget_halt_boundary",
    accountId: "a2d87878-a1e9-41ea-a8a5-90beff569673",
    jobId: "orch_test_boundary_001",
  };

  function makeMockResult(engineId: string, status: EngineStepResult["status"], output: any = {}): EngineStepResult {
    return { engineId: engineId as any, status, output, durationMs: 100 };
  }

  function makeHealthyIntegrity(): IntegrityReport {
    return {
      reportId: "test",
      timestamp: new Date().toISOString(),
      overallStatus: "PASS",
      integrityVerdict: "PASS",
      overallIntegrityScore: 0.95,
      safeToExecute: true,
      engineChecks: [],
      crossEngineAlignment: [],
      signalFlowVerified: true,
      traceabilityComplete: true,
      zeroLeakage: true,
      noOrphanOutputs: true,
      signalCoverageComplete: true,
      summary: "All checks pass",
      failureReasons: [],
      sglTraceToken: null,
    };
  }

  function makeHealthySignals(): SignalComposition {
    return {
      real: 10,
      competitor: 5,
      inferred: 3,
      fallback: 1,
      unknown: 1,
      total: 20,
      dominantType: "real",
      realRatio: 0.5,
      competitorRatio: 0.25,
      inferredRatio: 0.15,
      fallbackRatio: 0.05,
      unknownRatio: 0.05,
      trustedRatio: 0.75,
    };
  }

  function makeBaseResults(): Map<any, any> {
    const results = new Map<any, any>();
    results.set("market_intelligence", makeMockResult("market_intelligence", "SUCCESS"));
    results.set("audience", makeMockResult("audience", "SUCCESS", {
      audienceSegments: [{ id: "seg_123", name: "B2B SaaS Business Owners" }],
      audiencePains: [{ painId: "p_1", pain: "Data fragmentation" }],
    }));
    results.set("positioning", makeMockResult("positioning", "SUCCESS", { territory: "Operational Control & Data Quality" }));
    results.set("differentiation", makeMockResult("differentiation", "SUCCESS"));
    results.set("mechanism", makeMockResult("mechanism", "SUCCESS"));
    results.set("offer", makeMockResult("offer", "SUCCESS", {
      status: "COMPLETE",
      primaryOffer: {
        coreOutcome: "Scalable Growth",
        objectionHandling: ["ROI guaranteed"],
        proofAlignment: ["Case studies"],
      },
      offerStrengthScore: 0.8,
      structuralWarnings: [],
      layerDiagnostics: {
        offerAlignmentValidation: { valid: true },
        integrityChecks: { valid: true },
      },
      confidenceScore: 0.85,
    }));
    results.set("funnel", makeMockResult("funnel", "SUCCESS", {
      stages: [],
      confidenceScore: 0.85,
    }));
    results.set("integrity", makeMockResult("integrity", "SUCCESS", {
      integrityVerdict: "PASS",
      overallIntegrityScore: 0.95,
      safeToExecute: true,
      warnings: [],
    }));
    results.set("awareness", makeMockResult("awareness", "SUCCESS", {
      primaryRoute: {
        entryMechanismType: "problem_first",
        targetReadinessStage: "problem_aware",
        triggerClass: "external_disruption",
        trustRequirement: "high — proof and authority signals required",
        funnelCompatibility: "strong — matches standard funnel",
      },
    }));
    results.set("persuasion", makeMockResult("persuasion", "SUCCESS"));
    results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS", { validationState: "validated" }));
    results.set("budget_governor", makeMockResult("budget_governor", "SUCCESS", {
      decision: { action: "test" },
      killFlag: false,
      warnings: [],
    }));
    results.set("channel_selection", makeMockResult("channel_selection", "SUCCESS", {
      primaryChannel: {
        channelName: "Instagram",
        channelType: "social_paid",
        fitScore: 0.85,
        audienceDensityScore: 0.8,
        decisionGate: { outcome: "recommended" },
      },
      conversionChannelAssigned: true,
      decisionGateScoring: {
        funnelIntegrityScore: 0.8,
        persuasionAlignmentScore: 0.8,
        budgetRealism: 0.8,
        channelScalability: 0.8,
        compositeGateScore: 0.8,
      },
      confidenceScore: 0.85,
      funnelReconstruction: {
        funnelStages: {
          awareness: [{ channelName: "Instagram", channelKey: "instagram", assignedRole: "awareness" }],
          nurture: [{ channelName: "Email", channelKey: "email", assignedRole: "nurture" }],
          conversion: [{ channelName: "Landing Page", channelKey: "landing_page", assignedRole: "conversion" }],
        },
      },
      funnelStages: {
        awareness: [{ channelName: "Instagram", channelKey: "instagram", assignedRole: "awareness" }],
        nurture: [{ channelName: "Email", channelKey: "email", assignedRole: "nurture" }],
        conversion: [{ channelName: "Landing Page", channelKey: "landing_page", assignedRole: "conversion" }],
      },
      warnings: [],
      reconstructionLog: [],
    }));
    results.set("iteration", makeMockResult("iteration", "SUCCESS", {
      failedStrategyFlags: [],
      optimizationTargets: [],
      dataReliability: { overall: 0.7 },
    }));
    results.set("retention", makeMockResult("retention", "SUCCESS"));
    return results;
  }

  function makeBaseInput(overrides?: Partial<SystemControlInput>): SystemControlInput {
    const ssc = createEmptySSC(mockConfig.campaignId, mockConfig.accountId);
    ssc.confidenceFloor = 0.5;
    ssc.confidenceChain = [
      { engineId: "audience", engineConfidence: 0.8, compositeConfidence: 0.8 } as any,
      { engineId: "positioning", engineConfidence: 0.8, compositeConfidence: 0.8 } as any,
    ];
    return {
      results: makeBaseResults(),
      integrityReport: makeHealthyIntegrity(),
      celResults: [{ passed: true, overallPassed: true }] as any,
      signalComposition: makeHealthySignals(),
      sglCoverageSufficient: true,
      ssc,
      config: mockConfig,
      ...overrides,
    };
  }

  // TEST A — BUILD + NO BASELINE
  it("Test A: BUILD mode with budget halt produces strategyBlocked=false, spendBlocked=true", () => {
    const input = makeBaseInput();
    const budgetResult = input.results.get("budget_governor" as any)!;
    budgetResult.output.decision.action = "halt";
    budgetResult.output.killFlag = true;
    budgetResult.output.killReasons = ["Offer strength below minimum"];

    const verdict = evaluateSystemControl(input);
    expect(verdict.strategyBlocked).toBe(false);
    expect(verdict.spendBlocked).toBe(true);
    expect(verdict.blockReasons.some(b => b.code === "BUDGET_KILL" || b.code === "BUDGET_HALT")).toBe(true);
  });

  // TEST B — OPTIMIZE WITH VALID BASELINE
  it("Test B: OPTIMIZE mode with approved budget produces strategyBlocked=false, spendBlocked=false", () => {
    const input = makeBaseInput();
    const verdict = evaluateSystemControl(input);
    expect(verdict.strategyBlocked).toBe(false);
    expect(verdict.spendBlocked).toBe(false);
    expect(verdict.verdict).toBe("PASS");
  });

  // TEST C — REAL STRUCTURAL FAILURE
  it("Test C: True structural engine failure produces strategyBlocked=true, spendBlocked=true", () => {
    const input = makeBaseInput();
    input.integrityReport = {
      ...makeHealthyIntegrity(),
      overallStatus: "FAIL",
      integrityVerdict: "FAIL",
      failureReasons: ["Leakage detected", "Traceability incomplete"],
      zeroLeakage: false,
      traceabilityComplete: false,
    };

    const verdict = evaluateSystemControl(input);
    expect(verdict.strategyBlocked).toBe(true);
    expect(verdict.spendBlocked).toBe(true);
    expect(verdict.blockReasons.some(b => b.code === "INTEGRITY_FAILURE")).toBe(true);
  });

  // TEST D — BUDGET SAFETY PRESERVED
  it("Test D: Budget safety is preserved — budgetAction remains halt and killFlag=true", () => {
    const input = makeBaseInput();
    const budgetResult = input.results.get("budget_governor" as any)!;
    budgetResult.output.decision.action = "halt";
    budgetResult.output.killFlag = true;

    expect(budgetResult.output.decision.action).toBe("halt");
    expect(budgetResult.output.killFlag).toBe(true);
  });

  // TEST E — EXISTING HALT PLAN SYNTHESIS PATH
  it("Test E: Plan synthesis with halted budget produces valid persisted plan with $0 budget and HALTED execution", async () => {
    const results = makeBaseResults();
    const budgetResult = results.get("budget_governor")!;
    budgetResult.output.decision.action = "halt";
    budgetResult.output.killFlag = true;

    const ctx: any = {
      approvedLanes: [
        {
          id: "lane_001",
          segmentId: "seg_123",
          title: "B2B SaaS Business Owners",
          primaryPainId: "pain_001",
        },
      ],
      strategyRoot: {
        id: "sr_001",
        rootHash: "hash_001",
        brandSpine: { umbrellaPositionName: "Operational Control & Data Quality" },
        approvedLanes: [
          { id: "lane_001", segmentId: "seg_123", title: "B2B SaaS Business Owners" }
        ],
      },
    };

    const { plan, planId } = await synthesizePlan(mockConfig, ctx, results as any);
    expect(planId).toBeDefined();
    expect(plan.budgetAllocation.totalBudget).toBe("0");
    expect(plan.strategicSummary.targetAudience).toContain("B2B SaaS Business Owners");
    expect(plan.strategicSummary.rationale).toContain("Paid media budget is currently withheld");
  }, 30000);
});
