import { describe, it, expect } from "vitest";
import { buildDeterministicOfferSkeletons } from "../offer-engine/engine";
import { normalizeOfferResult } from "../offer-engine/normalize";
import { checkZeroObjectionCoverage, checkCELCompliance } from "../system-control/structural-checks";
import { evaluateSystemControl } from "../system-control/engine";
import { enforceGenericEngineCompliance } from "../causal-enforcement-layer/engine";
import { validateContractCompleteness } from "../orchestrator/contract-registry/index";
import type { StrategyRoot } from "../shared/strategy-root";

describe("Canonical Strategy Contract Consolidation (Parts 23-34)", () => {
  const mockStrategyRoot: Partial<StrategyRoot> = {
    id: "root_canonical_test_1",
    primaryAxis: "friction_vs_seamless",
    contrastAxisText: "Manual billing reconciliation vs automated streaming sync",
    approvedMechanism: {
      mechanismName: "Streaming Ledger Sync",
      mechanismPromise: "Eliminate silent billing leakage across disconnected SaaS tools",
      mechanismSteps: ["Hook into raw webhook feeds", "Resolve idempotent transactions", "Emit consolidated ledger events"],
    } as any,
    approvedClaim: "Sync transactions instantly without data loss",
    approvedClaims: [
      {
        claim: "Sync transactions instantly without data loss",
        benefit: "Instant financial reconciliation",
        contrast: "Manual end-of-month CSV exports",
        proofRefs: ["PR_EVENT_LOG", "PR_BENCHMARK"],
        objectionRefs: ["Buyers fear complex integration overhead"],
      },
    ] as any,
    approvedAudiencePains: [
      {
        painId: "pain_billing_leakage",
        canonical: "Billing reconciliation takes hours and leaks revenue silently",
        classification: "CORE",
        allowedUses: ["offer_core", "positioning_primary"],
      },
    ] as any,
    approvedDesires: {
      desire_1: { label: "Real-time automated transaction reconciliation" },
    } as any,
    approvedObjections: [
      {
        id: "obj_integration_overhead",
        canonical: "Buyers fear complex integration overhead and engineering downtime",
      },
      {
        id: "obj_data_security",
        canonical: "Security teams hesitate to grant API access to financial records",
      },
    ] as any,
    approvedProofTypes: ["system_architecture", "audit_log_sample"] as any,
    approvedLanes: [
      {
        laneId: "lane_fintech_ops",
        title: "Fintech Operations Teams",
        painIds: ["pain_billing_leakage"],
        segmentIds: ["seg_fintech_core"],
        valueContext: "Operations teams reconciling high-velocity payments",
      },
    ] as any,
  };

  const mockAudienceInput = {
    audiencePains: ["Billing reconciliation takes hours and leaks revenue silently"],
    desireMap: {
      desire_1: { label: "Real-time automated transaction reconciliation" },
    },
    objectionMap: {
      obj_integration_overhead: {
        id: "obj_integration_overhead",
        canonical: "Buyers fear complex integration overhead and engineering downtime",
        label: "Buyers fear complex integration overhead and engineering downtime",
      },
    },
    painRegistry: [
      {
        painId: "pain_billing_leakage",
        canonical: "Billing reconciliation takes hours and leaks revenue silently",
        classification: "CORE",
        allowedUses: ["offer_core"],
      },
    ],
  };

  const mockPositioningInput = {
    primaryAxis: "friction_vs_seamless",
    contrastAxis: "Manual vs automated",
    narrativeDirection: "Direct streaming verification",
  };

  const mockDifferentiationInput = {
    proofArchitecture: ["system_architecture", "audit_log_sample"],
  };

  it("Part 23 & 24: Offer Engine consumes canonical StrategyRoot.approvedObjections and generates non-empty objectionHandling", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot as any,
      mockAudienceInput as any,
      mockPositioningInput as any,
      mockDifferentiationInput as any,
    );

    expect(skeletons.primary).toBeDefined();
    expect(skeletons.primary.objectionHandling).toBeDefined();
    expect(skeletons.primary.objectionHandling.length).toBeGreaterThan(0);
    expect(skeletons.primary.objectionHandling[0]).toContain("Addresses: ");
    expect(skeletons.primary.objectionHandling.some(h => h.includes("integration overhead"))).toBe(true);
  });

  it("Part 27: OFFER_CONTRACT is COMPLETE when primaryOffer has valid objectionHandling", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot as any,
      mockAudienceInput as any,
      mockPositioningInput as any,
      mockDifferentiationInput as any,
    );

    const offerResult = {
      status: "COMPLETE",
      offerStrengthScore: 0.85,
      confidenceScore: 0.85,
      structuralWarnings: [],
      layerDiagnostics: {
        offerAlignmentValidation: { aligned: true, score: 0.9 },
        integrityChecks: { painAligned: true, claimAligned: true },
      },
      primaryOffer: {
        offerName: skeletons.primary.name,
        coreOutcome: skeletons.primary.outcome,
        mechanismDescription: skeletons.primary.mechanism,
        deliverables: skeletons.primary.deliverables,
        proofAlignment: skeletons.primary.proofPath,
        audienceFitExplanation: "Addresses billing reconciliation with automated streaming sync",
        riskNotes: ["Deployment requires webhook secret configuration"],
        problemStatement: skeletons.primary.problemStatement,
        proofPath: skeletons.primary.proofPath,
        objectionHandling: skeletons.primary.objectionHandling,
      },
      alternativeOffer: {
        offerName: skeletons.alternative.name,
        coreOutcome: skeletons.alternative.outcome,
        mechanismDescription: skeletons.alternative.mechanism,
        deliverables: skeletons.alternative.deliverables,
        proofAlignment: skeletons.alternative.proofPath,
        audienceFitExplanation: "Alternative implementation approach",
        riskNotes: [],
        problemStatement: skeletons.alternative.problemStatement,
        proofPath: skeletons.alternative.proofPath,
        objectionHandling: skeletons.alternative.objectionHandling,
      },
    };

    const normalized = normalizeOfferResult(offerResult);
    const audit = validateContractCompleteness("offer", normalized);

    expect(audit.status).toBe("COMPLETE");
    expect(audit.missingRequiredOutputs.length).toBe(0);
    expect(audit.invalidFields.length).toBe(0);
  });

  it("Part 23 & 25: checkZeroObjectionCoverage PASSES when offer has objection handling for audience objections", () => {
    const skeletons = buildDeterministicOfferSkeletons(
      mockStrategyRoot as any,
      mockAudienceInput as any,
      mockPositioningInput as any,
      mockDifferentiationInput as any,
    );

    const results = new Map<any, any>([
      [
        "audience",
        {
          engineId: "audience",
          status: "SUCCESS",
          output: {
            objectionMap: {
              obj_1: { canonical: "Integration is too hard" },
              obj_2: { canonical: "Security concerns" },
            },
          },
        },
      ],
      [
        "offer",
        {
          engineId: "offer",
          status: "SUCCESS",
          output: {
            primaryOffer: {
              offerName: skeletons.primary.name,
              coreOutcome: skeletons.primary.outcome,
              mechanismDescription: skeletons.primary.mechanism,
              problemStatement: skeletons.primary.problemStatement,
              objectionHandling: skeletons.primary.objectionHandling,
            },
          },
        },
      ],
    ]);

    const check = checkZeroObjectionCoverage(results);
    expect(check.status).toBe("PASS");
  });

  it("Part 26 & 28: CEL Compliance PASSES when factual claims reflect root causes and primary themes", () => {
    const mockAel = {
      isPartial: false,
      root_causes: [
        {
          id: "RC1",
          deepCause: "Disconnected financial tools cause silent opacity and hidden billing errors",
          surfaceSignal: "Billing sync opacity and lack of trust in numbers",
          causalReasoning: "Streaming ledger sync provides verifiable proof and transparent reconciliation",
          confidenceLevel: "high",
        },
      ],
      causal_chains: [
        {
          cause: "Lack of transparent transactional sync",
          impact: "Manual reconciliations and revenue leakage",
          behavior: "Finance teams delay closing books",
          pain: "Billing reconciliation takes hours",
        },
      ],
      buying_barriers: [
        {
          barrier: "Integration opacity",
          rootCause: "Fear of downtime",
          userThinking: "Engineering will take months to deploy",
          requiredResolution: "Verifiable zero-downtime streaming adapter with audit proof",
        },
      ],
    };

    const offerTexts = [
      "Streaming Ledger Sync Module",
      "Eliminate silent billing leakage across disconnected SaaS tools with transparent verification proof",
      "Streaming Ledger Sync hooks into raw webhook feeds to resolve transactions with full audit accountability and proof",
      "Billing reconciliation takes hours and leaks revenue silently due to opacity in disconnected financial tools",
      "Addresses: Buyers fear complex integration overhead with transparent verifiable proof architecture",
    ];

    const celResult = enforceGenericEngineCompliance("offer", offerTexts, mockAel as any);
    expect(celResult.passed).toBe(true);

    const celComplianceCheck = checkCELCompliance([celResult]);
    expect(celComplianceCheck.status).toBe("PASS");
  });

  it("Part 30: System Control correctly isolates Spend Block from Strategy Block in BUILD mode", () => {
    const results = new Map<any, any>();
    function makeMockResult(engineId: string, status: any = "SUCCESS", output: any = {}) {
      return { engineId, status, output: { ...output, sourceJobId: "job_1" }, durationMs: 100 };
    }

    results.set("market_intelligence", makeMockResult("market_intelligence", "SUCCESS"));
    results.set("audience", makeMockResult("audience", "SUCCESS", { audienceSegments: [{ id: "seg_1" }], objectionMap: { obj_1: { canonical: "Cost" } } }));
    results.set("positioning", makeMockResult("positioning", "SUCCESS", { territory: "Ops", confidenceScore: 0.85 }));
    results.set("differentiation", makeMockResult("differentiation", "SUCCESS"));
    results.set("mechanism", makeMockResult("mechanism", "SUCCESS"));
    results.set("offer", makeMockResult("offer", "SUCCESS", {
      status: "COMPLETE",
      primaryOffer: { coreOutcome: "outcome", objectionHandling: ["Addresses: Cost"], proofAlignment: ["proof"] },
      offerStrengthScore: 0.85,
      structuralWarnings: [],
      layerDiagnostics: { offerAlignmentValidation: { valid: true }, integrityChecks: { valid: true } },
      confidenceScore: 0.85,
    }));
    results.set("awareness", makeMockResult("awareness", "SUCCESS", {
      primaryRoute: { entryMechanismType: "problem_first", targetReadinessStage: "problem_aware", triggerClass: "external_disruption" },
    }));
    results.set("funnel", makeMockResult("funnel", "SUCCESS", { stages: [], confidenceScore: 0.85 }));
    results.set("persuasion", makeMockResult("persuasion", "SUCCESS"));
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
    }));
    results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS", { validationState: "validated" }));
    results.set("budget_governor", makeMockResult("budget_governor", "SUCCESS", {
      decision: { action: "halt" },
      killFlag: true,
      warnings: [],
    }));
    results.set("iteration", makeMockResult("iteration", "SUCCESS", { failedStrategyFlags: [] }));
    results.set("retention", makeMockResult("retention", "SUCCESS"));
    results.set("integrity", makeMockResult("integrity", "SUCCESS", {
      integrityVerdict: "PASS",
      overallIntegrityScore: 0.95,
      safeToExecute: true,
    }));

    const verdict = evaluateSystemControl({
      results,
      integrityReport: {
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
      },
      celResults: [{ engineId: "offer", passed: true, overallPassed: true, score: 1.0, violations: [] }] as any,
      signalComposition: {
        real: 10, competitor: 5, inferred: 3, fallback: 1, unknown: 1, total: 20,
        dominantType: "real", realRatio: 0.5, competitorRatio: 0.25, inferredRatio: 0.15,
        fallbackRatio: 0.05, unknownRatio: 0.05, trustedRatio: 0.75,
      },
      sglCoverageSufficient: true,
      ssc: {
        confidenceFloor: 0.5,
        confidenceChain: [
          { engineId: "audience", engineConfidence: 0.8, compositeConfidence: 0.8 } as any,
          { engineId: "positioning", engineConfidence: 0.8, compositeConfidence: 0.8 } as any,
        ],
        problemRegistry: [],
        budgetDecisions: [
          {
            action: "halt",
            killFlag: true,
            reason: "BUILD mode requires empirical organic baseline before activating paid media spend.",
          },
        ],
      } as any,
      config: { campaignId: "camp_1", accountId: "acc_1" } as any,
    });

    expect(verdict.strategyBlocked).toBe(false);
    expect(verdict.spendBlocked).toBe(true);
    expect(verdict.blockReasons.some(b => b.code === "BUDGET_KILL" || b.code === "BUDGET_HALT")).toBe(true);
  });
});
