import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyBatchEvidenceUnits,
  classifyBatchWithAdaptiveSplitting,
  runDynamicCustomerVoiceExtraction,
  isRecoverableTechnicalError,
  type DeduplicatedEvidenceUnit,
  type SplitRecoveryMetrics,
} from "../audience-engine/semantic-reasoner";
import * as aiClient from "../ai-client";

vi.mock("../ai-client", () => ({
  aiGemini: vi.fn(),
  aiChat: vi.fn(),
  estimateCostUsd: vi.fn(() => 0),
  recordAiCost: vi.fn(),
  AICallError: class AICallError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "AICallError";
      this.code = code;
    }
  },
}));

describe("Audience Semantic Reasoner — Adaptive Failed-Batch Splitting Suite", () => {
  const dummyBusinessContext = {
    heroProduct: "Modest Summer Dresses",
    businessName: "Sara-ft",
    market: "UAE",
    category: "Women's Fashion",
  };

  const createUnits = (count: number, prefix: string = "ev_"): DeduplicatedEvidenceUnit[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      text: `Evidence quote ${i + 1} regarding modest summer fabric and sizing.`,
      sourceType: "market_voice" as const,
      canonicalCompetitorId: "comp_1",
      canonicalBrandName: "BrandA",
      platform: "reddit",
      rawOccurrenceCount: 1,
      likesCount: 5,
      originalIds: [`orig_${i + 1}`],
    }));
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // TEST A: 25-unit parent times out. 12/13 children succeed.
  it("TEST A: 25-unit parent times out -> splits into 12 + 13 children which succeed -> all 25 units classified, no providerFailure", async () => {
    const parentUnits = createUnits(25, "ev_parent_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    vi.mocked(aiClient.aiChat).mockImplementation(async (opts: any) => {
      const userPrompt = opts.messages?.find((m: any) => m.role === "user")?.content || "";
      const idMatches = [...userPrompt.matchAll(/\[Unit\s+\d+\]\s+ID:\s*([^\s|]+)/g)].map(m => m[1]);

      // If called with full 25 units, simulate timeout
      if (idMatches.length === 25) {
        throw new Error("OpenAI call timed out after 45000ms");
      }

      // Children succeed
      const classifications = idMatches.map((id, idx) => ({
        evidenceUnitId: id,
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: `Grounded claim for ${id}`,
        semanticClaims: [
          {
            claimId: `clm_${idx}`,
            claimKind: "friction_problem",
            meaning: `Meaning for ${id}`,
            semanticScope: "CATEGORY_RECURRING",
            transferability: "SAME_MARKET",
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      }));

      return {
        choices: [
          {
            message: {
              content: JSON.stringify(classifications),
            },
          },
        ],
      } as any;
    });

    const results = await classifyBatchWithAdaptiveSplitting(
      parentUnits,
      dummyBusinessContext,
      "acc_123",
      "camp_123",
      "Batch 22/26",
      metrics
    );

    expect(results.length).toBe(25);
    expect(metrics.parentBatchesSplit).toBe(1);
    expect(metrics.childBatchesCreated).toBe(2);
    expect(metrics.recoveredBatches).toBe(1);
    expect(vi.mocked(aiClient.aiGemini)).not.toHaveBeenCalled();

    // Verify all 25 original IDs are preserved in order
    for (let i = 0; i < 25; i++) {
      expect(results[i].evidenceUnitId).toBe(parentUnits[i].id);
    }
  });

  // TEST B: One child times out once, smaller split succeeds -> all evidence preserved, no duplicate classifications.
  it("TEST B: Subdivided child also times out -> splits recursively until leaf batches succeed", async () => {
    const parentUnits = createUnits(25, "ev_deep_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    vi.mocked(aiClient.aiChat).mockImplementation(async (opts: any) => {
      const userPrompt = opts.messages?.find((m: any) => m.role === "user")?.content || "";
      const idMatches = [...userPrompt.matchAll(/\[Unit\s+\d+\]\s+ID:\s*([^\s|]+)/g)].map(m => m[1]);

      // Parent (25) and Child B (13) time out; smaller batches (<= 12) succeed
      if (idMatches.length >= 13) {
        throw new Error("ETIMEDOUT: Connection timed out");
      }

      const classifications = idMatches.map((id, idx) => ({
        evidenceUnitId: id,
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: `Grounded claim for ${id}`,
        semanticClaims: [
          {
            claimId: `clm_${idx}`,
            claimKind: "friction_problem",
            meaning: `Meaning for ${id}`,
            semanticScope: "CATEGORY_RECURRING",
            transferability: "SAME_MARKET",
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      }));

      return {
        choices: [
          {
            message: {
              content: JSON.stringify(classifications),
            },
          },
        ],
      } as any;
    });

    const results = await classifyBatchWithAdaptiveSplitting(
      parentUnits,
      dummyBusinessContext,
      "acc_123",
      "camp_123",
      "Batch 1/1",
      metrics
    );

    expect(results.length).toBe(25);
    // Parent (25) split into 12 + 13; then Child B (13) split into 6 + 7
    expect(metrics.parentBatchesSplit).toBe(2);
    expect(metrics.childBatchesCreated).toBe(4);
    expect(metrics.recoveredBatches).toBe(2);

    // Verify set uniqueness & preservation
    const classifiedIds = results.map(r => r.evidenceUnitId);
    expect(new Set(classifiedIds).size).toBe(25);
  });

  // TEST C: Smallest recoverable child exhausts provider retries -> fails closed, no fabricated pains.
  it("TEST C: Minimal unit exhausts retries -> fails closed without fabricating pains", async () => {
    const singleUnit = createUnits(1, "ev_single_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    vi.mocked(aiClient.aiChat).mockRejectedValue(new Error("OpenAI call timed out after 45000ms"));

    await expect(
      classifyBatchWithAdaptiveSplitting(
        singleUnit,
        dummyBusinessContext,
        "acc_123",
        "camp_123",
        "Batch 1/1",
        metrics
      )
    ).rejects.toThrow(/timed out/);
  });

  // TEST D: Hard quota/provider billing error -> immediate fail fast, no recursive splitting.
  it("TEST D: Hard quota / auth / billing errors fail fast without recursive splitting", async () => {
    const parentUnits = createUnits(25, "ev_hard_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    const hardErr: any = new Error("insufficient_quota: You have exceeded your current quota.");
    hardErr.status = 429;
    vi.mocked(aiClient.aiChat).mockRejectedValue(hardErr);

    await expect(
      classifyBatchWithAdaptiveSplitting(
        parentUnits,
        dummyBusinessContext,
        "acc_123",
        "camp_123",
        "Batch 1/1",
        metrics
      )
    ).rejects.toThrow(/insufficient_quota/);

    // No splits attempted for hard non-recoverable error
    expect(metrics.parentBatchesSplit).toBe(0);
    expect(metrics.childBatchesCreated).toBe(0);
  });

  // TEST E: Normal batches never split.
  it("TEST E: Normal batches succeed on first attempt without splitting", async () => {
    const parentUnits = createUnits(25, "ev_normal_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    vi.mocked(aiClient.aiChat).mockImplementation(async (opts: any) => {
      const userPrompt = opts.messages?.find((m: any) => m.role === "user")?.content || "";
      const idMatches = [...userPrompt.matchAll(/\[Unit\s+\d+\]\s+ID:\s*([^\s|]+)/g)].map(m => m[1]);

      const classifications = idMatches.map((id, idx) => ({
        evidenceUnitId: id,
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: `Claim for ${id}`,
        semanticClaims: [
          {
            claimId: `clm_${idx}`,
            claimKind: "friction_problem",
            meaning: `Meaning for ${id}`,
            semanticScope: "CATEGORY_RECURRING",
            transferability: "SAME_MARKET",
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      }));

      return {
        choices: [
          {
            message: {
              content: JSON.stringify(classifications),
            },
          },
        ],
      } as any;
    });

    const results = await classifyBatchWithAdaptiveSplitting(
      parentUnits,
      dummyBusinessContext,
      "acc_123",
      "camp_123",
      "Batch 1/1",
      metrics
    );

    expect(results.length).toBe(25);
    expect(metrics.parentBatchesSplit).toBe(0);
    expect(metrics.childBatchesCreated).toBe(0);
  });

  // TEST F: Gemini is never called.
  it("TEST F: Gemini is never called during batch execution or splitting", async () => {
    const parentUnits = createUnits(25, "ev_nogemini_");
    const metrics: SplitRecoveryMetrics = { parentBatchesSplit: 0, childBatchesCreated: 0, recoveredBatches: 0 };

    vi.mocked(aiClient.aiChat).mockImplementation(async (opts: any) => {
      // Assert OpenAI parameters
      expect(opts.forceProvider).toBe("openai");
      const userPrompt = opts.messages?.find((m: any) => m.role === "user")?.content || "";
      const idMatches = [...userPrompt.matchAll(/\[Unit\s+\d+\]\s+ID:\s*([^\s|]+)/g)].map(m => m[1]);

      const classifications = idMatches.map((id, idx) => ({
        evidenceUnitId: id,
        primaryForm: "PAIN",
        semanticType: "PAIN",
        claim: `Claim for ${id}`,
        semanticClaims: [
          {
            claimId: `clm_${idx}`,
            claimKind: "friction_problem",
            meaning: `Meaning for ${id}`,
            semanticScope: "CATEGORY_RECURRING",
            transferability: "SAME_MARKET",
            confidence: 0.9,
          },
        ],
        confidence: 0.9,
      }));

      return {
        choices: [
          {
            message: {
              content: JSON.stringify(classifications),
            },
          },
        ],
      } as any;
    });

    await classifyBatchWithAdaptiveSplitting(
      parentUnits,
      dummyBusinessContext,
      "acc_123",
      "camp_123",
      "Batch 1/1",
      metrics
    );

    expect(vi.mocked(aiClient.aiGemini)).not.toHaveBeenCalled();
  });
});
