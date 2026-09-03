import { describe, it, expect } from "vitest";
import { deepScrubPlan } from "../orchestrator/plan-synthesis";

describe("Semantic Role Scrubber Diagnostic (Part 3)", () => {
  it("PRESERVES valid market observations (OBSERVED_SIGNAL)", () => {
    const inputA = {
      painId: "excluded_market_signal",
      semanticRole: "OBSERVED_SIGNAL",
      text: "Competitor customers complain about refund delays and poor support."
    };

    const result = deepScrubPlan(inputA);
    expect(result.text).toBe("Competitor customers complain about refund delays and poor support.");
  });

  it("BLOCKS / SCRUBS invalid product claims (PRODUCT_CAPABILITY)", () => {
    const inputB = {
      painId: "excluded_market_signal",
      semanticRole: "PRODUCT_CAPABILITY",
      text: "Avyron manages refunds and customer support."
    };

    const result = deepScrubPlan(inputB);
    expect(result.text).not.toContain("manages refunds");
    expect(result.text).not.toContain("customer support");
  });
});
