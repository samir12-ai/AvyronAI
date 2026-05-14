/**
 * F10.12 — Strategy engine integration tests.
 *
 * Smoke-level integration coverage for all 5 strategy engines:
 *   budget-governor, channel-selection, iteration-engine,
 *   retention-engine, statistical-validation.
 *
 * Each engine is invoked with a minimal real-shaped input and we assert
 * on the canonical contract fields the registry / system-control depends
 * on (D2/D3 doctrine — strict-enum verdict-shaped fields). Engines that
 * call out to AI are exercised on the no-AI / fallback path so the test
 * stays deterministic and offline.
 */
import { describe, it, expect } from "vitest";
import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import { runChannelSelectionEngine } from "../strategy/channel-selection/engine";
import { runIterationEngine } from "../strategy/iteration-engine/engine";
import { runRetentionEngine } from "../strategy/retention-engine/engine";
import { runStatisticalValidationEngine } from "../strategy/statistical-validation/engine";

describe("F10.12 — Strategy engines integration", () => {
  it("budget-governor emits strict-enum decision.action", () => {
    const result = runBudgetGovernorEngine({
      offerStrength: 0.6,
      offerProofScore: 0.5,
      offerCompleteness: true,
      funnelStrengthScore: 0.55,
      funnelFrictionScore: 0.3,
      funnelProjections: { expectedConversionRate: 0.02, expectedCPA: 50, expectedROAS: 2.5 },
      channelRisk: 0.3,
      validationConfidence: 0.5,
      validationState: "provisional",
      marketIntensity: 0.5,
      competitorSpendEstimate: 1000,
      audienceSize: "medium",
      currentBudget: 1000,
      historicalCPA: null,
      historicalROAS: null,
    });
    expect(["test", "scale", "hold", "halt"]).toContain(result.decision.action);
    expect(typeof result.decision.reasoning).toBe("string");
    expect(typeof result.confidenceScore).toBe("number");
  });

  it("channel-selection emits decisionGate.outcome with strict enum", () => {
    const result = runChannelSelectionEngine(
      { audienceSize: "medium", primaryChannelPreferences: [], demographics: {} as any, behavioralSignals: [] } as any,
      { triggerClass: "problem_aware", entryClass: "informational", awarenessLevel: "problem-aware", maturityIndex: 0.5 } as any,
      null,
      null,
      null,
      null,
      "automatic",
    );
    expect(result.status).toBeDefined();
    if (result.primaryChannel?.decisionGate) {
      expect(["recommended", "support_channel", "exploratory"]).toContain(
        result.primaryChannel.decisionGate.outcome,
      );
    }
  });

  it("iteration-engine returns canonical status on empty inputs (benchmark exploration path)", async () => {
    const result = await runIterationEngine(null, null, null, null);
    expect(typeof result.status).toBe("string");
    expect(Array.isArray(result.nextTestHypotheses)).toBe(true);
    expect(typeof result.engineVersion).toBe("number");
  });

  it("retention-engine returns fallback result on sparse data (no AI call)", async () => {
    const result = await runRetentionEngine({
      customerJourneyData: {
        touchpoints: [], avgTimeToConversion: null, repeatPurchaseRate: null,
        churnRate: null, customerLifetimeValue: null, retentionWindowDays: null,
        engagementDecayRate: null,
      },
      offerStructure: {
        offerName: null, coreOutcome: "", deliverables: [], proofStrength: null,
        riskReducers: [], mechanismDescription: null,
      },
      purchaseMotivations: [],
      postPurchaseObjections: [],
      campaignId: "campaign_test_f10_12",
      accountId: "acct_test_f10_12",
    });
    expect(typeof result.status).toBe("string");
  });

  it("statistical-validation emits strict-enum validationState", async () => {
    const result = await runStatisticalValidationEngine(
      { competitorClaims: [], topicalDensity: {}, overallConfidence: 0.5 } as any,
      { painMap: [], desireMap: [], audienceSegments: [], maturityIndex: 0.5 } as any,
      { coreOutcome: "Outcome", mechanismDescription: "Mechanism", hooks: [] } as any,
      { stages: [], strengthScore: 0.5 } as any,
      { triggerClass: "problem_aware", entryClass: "informational" } as any,
      { persuasionMode: "logical", drivers: [] } as any,
      "test-account-f10-12",
      [],
    );
    expect(["validated", "provisional", "weak", "rejected"]).toContain(result.validationState);
    expect(typeof result.claimConfidenceScore).toBe("number");
    expect(typeof result.evidenceStrength).toBe("number");
  });
});
