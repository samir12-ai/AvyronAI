import { vi, describe, it, expect, beforeEach } from "vitest";
import { validateCrossEngineStrategyConsistency, StrategyConsistencyError } from "../orchestrator/plan-synthesis";

// Mock the aiChat client
const mockAiChat = vi.fn();
vi.mock("../ai-client", () => ({
  aiChat: (...args: any[]) => mockAiChat(...args),
}));

describe("Cross-Engine Semantic Consistency Judge Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails deterministically when target audience segment ID mismatch is detected", async () => {
    const results = new Map<string, any>();
    results.set("audience", {
      status: "SUCCESS",
      output: {
        segments: [{ id: "segment_b2b_agency", name: "B2B Agency Owners" }],
      },
    });
    results.set("positioning", {
      status: "SUCCESS",
      output: {
        targetSegmentId: "segment_b2c_retail",
      },
    });

    const strategyRoot = {
      approvedAudiencePains: [],
      approvedObjections: [],
      approvedClaims: [],
      approvedMechanism: null,
      approvedPositioningContext: null,
    };

    const res = await validateCrossEngineStrategyConsistency(results, strategyRoot, "test_account");
    expect(res.valid).toBe(false);
    expect(res.conflict).toContain("Target audience segment ID mismatch");
    expect(res.responsibleEngines).toEqual(["positioning"]);
    expect(res.recommendedRegenerationTarget).toBe("positioning");
    expect(mockAiChat).not.toHaveBeenCalled();
  });

  it("passes when target segment ID matches and LLM Semantic Judge rules consistent", async () => {
    const results = new Map<string, any>();
    results.set("audience", {
      status: "SUCCESS",
      output: {
        segments: [{ id: "segment_b2b_agency", name: "B2B Agency Owners" }],
      },
    });
    results.set("positioning", {
      status: "SUCCESS",
      output: {
        targetSegmentId: "segment_b2b_agency",
      },
    });

    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({ consistent: true }),
          },
        },
      ],
    });

    const strategyRoot = {
      approvedAudiencePains: [],
      approvedObjections: [],
      approvedClaims: [],
      approvedMechanism: null,
      approvedPositioningContext: null,
    };

    const res = await validateCrossEngineStrategyConsistency(results, strategyRoot, "test_account");
    expect(res.valid).toBe(true);
    expect(mockAiChat).toHaveBeenCalledTimes(1);
  });

  it("fails semantically and returns repair target when LLM Semantic Judge detects contradiction", async () => {
    const results = new Map<string, any>();
    results.set("audience", {
      status: "SUCCESS",
      output: {
        segments: [{ id: "segment_b2b_agency", name: "B2B Agency Owners" }],
      },
    });
    results.set("positioning", {
      status: "SUCCESS",
      output: {
        targetSegmentId: "segment_b2b_agency",
      },
    });

    mockAiChat.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              consistent: false,
              conflict: "Offer strategy is discount/bargain focused, which directly contradicts the premium authority positioning stance.",
              canonicalFields: ["positioning.territories", "offer.coreOutcome"],
              responsibleEngines: ["offer"],
              recommendedRegenerationTarget: "offer",
            }),
          },
        },
      ],
    });

    const strategyRoot = {
      approvedAudiencePains: [],
      approvedObjections: [],
      approvedClaims: [],
      approvedMechanism: null,
      approvedPositioningContext: null,
    };

    const res = await validateCrossEngineStrategyConsistency(results, strategyRoot, "test_account");
    expect(res.valid).toBe(false);
    expect(res.conflict).toContain("Offer strategy is discount/bargain focused");
    expect(res.responsibleEngines).toEqual(["offer"]);
    expect(res.recommendedRegenerationTarget).toBe("offer");
    expect(mockAiChat).toHaveBeenCalledTimes(1);
  });

  it("correctly throws StrategyConsistencyError with custom properties on failure", () => {
    const err = new StrategyConsistencyError(
      "Premium vs discount contradiction",
      ["positioning.territories", "offer.coreOutcome"],
      ["offer"],
      "offer"
    );

    expect(err.message).toBe("STRATEGY_CONSISTENCY_FAILED: Premium vs discount contradiction");
    expect(err.conflict).toBe("Premium vs discount contradiction");
    expect(err.canonicalFields).toEqual(["positioning.territories", "offer.coreOutcome"]);
    expect(err.responsibleEngines).toEqual(["offer"]);
    expect(err.recommendedRegenerationTarget).toBe("offer");
  });
});
