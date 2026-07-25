/**
 * F10.12 — Strategy engine integration tests.
 *
 * Smoke-level integration coverage for all 5 strategy engines:
 *   budget-governor, channel-selection, iteration-engine,
 *   retention-engine, statistical-validation.
 *
 * Each engine is invoked with a minimal real-shaped input typed against
 * the engine's published input interface (NO `as any` escapes — Seal #12
 * round-2 architect requirement). Engines that call out to AI are
 * exercised on the no-AI / fallback path so the test stays deterministic
 * and offline.
 */
import { describe, it, expect } from "vitest";
import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import type { BudgetGovernorInput } from "../strategy/budget-governor/types";
import { runChannelSelectionEngine } from "../strategy/channel-selection/engine";
import type {
  ChannelAudienceInput,
  ChannelAwarenessInput,
} from "../strategy/channel-selection/types";
import { runIterationEngine } from "../strategy/iteration-engine/engine";
import { runRetentionEngine } from "../strategy/retention-engine/engine";
import type { RetentionInput } from "../strategy/retention-engine/types";
import { runStatisticalValidationEngine } from "../strategy/statistical-validation/engine";
import type {
  ValidationMIInput,
  ValidationAudienceInput,
  ValidationOfferInput,
  ValidationFunnelInput,
  ValidationAwarenessInput,
  ValidationPersuasionInput,
} from "../strategy/statistical-validation/types";

describe("F10.12 — Strategy engines integration", () => {
  it("budget-governor emits strict-enum decision.action", () => {
    const input: BudgetGovernorInput = {
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
    };
    const result = runBudgetGovernorEngine(input);
    expect(["test", "scale", "hold", "halt"]).toContain(result.decision.action);
    expect(typeof result.decision.reasoning).toBe("string");
    expect(typeof result.confidenceScore).toBe("number");
  });

  it("channel-selection emits decisionGate.outcome with strict enum", () => {
    const audience: ChannelAudienceInput = {
      audienceSegments: [],
      emotionalDrivers: [],
      awarenessLevel: "problem-aware",
      maturityIndex: 0.5,
      audiencePains: [],
      desireMap: {},
      objectionMap: {},
    };
    const awareness: ChannelAwarenessInput = {
      entryMechanismType: "informational",
      targetReadinessStage: "problem-aware",
      triggerClass: "problem_aware",
      trustRequirement: "moderate",
      funnelCompatibility: "balanced",
      awarenessStrengthScore: 0.5,
      frictionNotes: [],
    };
    const result = runChannelSelectionEngine(
      audience,
      awareness,
      null,
      null,
      null,
      null,
      "automatic",
    );
    expect(typeof result.status).toBe("string");
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
    const input: RetentionInput = {
      customerJourneyData: {
        touchpoints: [],
        avgTimeToConversion: null,
        repeatPurchaseRate: null,
        churnRate: null,
        customerLifetimeValue: null,
        retentionWindowDays: null,
        engagementDecayRate: null,
      },
      offerStructure: {
        offerName: null,
        coreOutcome: "",
        deliverables: [],
        proofStrength: null,
        riskReducers: [],
        mechanismDescription: null,
      },
      purchaseMotivations: [],
      postPurchaseObjections: [],
      campaignId: "campaign_test_f10_12",
      accountId: "acct_test_f10_12",
    };
    const result = await runRetentionEngine(input);
    expect(typeof result.status).toBe("string");
  });

  it("statistical-validation emits strict-enum validationState", async () => {
    const mi: ValidationMIInput = {
      marketDiagnosis: null,
      overallConfidence: 0.5,
      opportunitySignals: [],
      threatSignals: [],
      narrativeObjectionCount: 0,
      narrativeObjections: [],
    };
    const audience: ValidationAudienceInput = {
      objectionMap: {},
      emotionalDrivers: [],
      maturityIndex: 0.5,
      awarenessLevel: "problem-aware",
      audiencePains: [],
      desireMap: {},
      audienceSegments: [],
    };
    const offer: ValidationOfferInput = {
      offerName: "Test Offer",
      coreOutcome: "Outcome",
      mechanismDescription: "Mechanism",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.5,
      riskNotes: [],
      frictionLevel: 0.3,
    };
    const funnel: ValidationFunnelInput = {
      funnelName: "Test Funnel",
      funnelType: "lead_capture",
      stageMap: [],
      trustPath: [],
      proofPlacements: [],
      commitmentLevel: "low",
      frictionMap: [],
      entryTrigger: { mechanismType: "informational", purpose: "awareness" },
      funnelStrengthScore: 0.5,
    };
    const awareness: ValidationAwarenessInput = {
      entryMechanismType: "informational",
      targetReadinessStage: "problem-aware",
      triggerClass: "problem_aware",
      trustRequirement: "moderate",
      funnelCompatibility: "balanced",
      awarenessStrengthScore: 0.5,
      frictionNotes: [],
    };
    const persuasion: ValidationPersuasionInput = {
      persuasionMode: "logical",
      primaryInfluenceDrivers: [],
      objectionPriorities: [],
      trustSequence: [],
      persuasionStrengthScore: 0.5,
      frictionNotes: [],
      trustBarriers: [],
      objectionProofLinks: [],
      structuredObjections: [],
    };
    const result = await runStatisticalValidationEngine(
      mi,
      audience,
      offer,
      funnel,
      awareness,
      persuasion,
      "test-account-f10-12",
      [],
    );
    expect(["validated", "provisional", "weak", "rejected"]).toContain(result.validationState);
    expect(typeof result.claimConfidenceScore).toBe("number");
    expect(typeof result.evidenceStrength).toBe("number");
  });
});
