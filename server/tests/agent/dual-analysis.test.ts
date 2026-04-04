import { describe, it, expect } from "vitest";
import {
  applyClassificationGuard,
  getRecommendedEnginesForClassification,
} from "../../agent/dual-analysis-routes";

// ── applyClassificationGuard ────────────────────────────────────────────────

describe("applyClassificationGuard", () => {
  it("returns no_data when no competitor and no user data", () => {
    expect(applyClassificationGuard("no_data", false, false)).toBe("no_data");
  });

  it("returns no_change when both sides are stable and AI says no_change", () => {
    expect(applyClassificationGuard("no_change", true, true)).toBe("no_change");
  });

  it("falls back to market_shift_only when AI says no_data but competitor data exists", () => {
    expect(applyClassificationGuard("no_data", true, false)).toBe("market_shift_only");
  });

  it("falls back to execution_gap_only when AI says no_data but user data exists", () => {
    expect(applyClassificationGuard("no_data", false, true)).toBe("execution_gap_only");
  });

  it("falls back to both_changed when AI says no_data but both data sources exist", () => {
    expect(applyClassificationGuard("no_data", true, true)).toBe("both_changed");
  });

  it("corrects market_shift_only to execution_gap_only when no competitor data", () => {
    expect(applyClassificationGuard("market_shift_only", false, true)).toBe("execution_gap_only");
  });

  it("corrects execution_gap_only to market_shift_only when no user data", () => {
    expect(applyClassificationGuard("execution_gap_only", true, false)).toBe("market_shift_only");
  });

  it("falls back deterministically on invalid AI classification string", () => {
    expect(applyClassificationGuard("garbage_value", true, true)).toBe("both_changed");
    expect(applyClassificationGuard("garbage_value", true, false)).toBe("market_shift_only");
    expect(applyClassificationGuard("garbage_value", false, true)).toBe("execution_gap_only");
    expect(applyClassificationGuard("garbage_value", false, false)).toBe("no_data");
  });
});

// ── getRecommendedEnginesForClassification ───────────────────────────────────

describe("getRecommendedEnginesForClassification", () => {
  it("returns market refresh engines for market_shift_only", () => {
    const engines = getRecommendedEnginesForClassification("market_shift_only");
    expect(engines).toContain("market_intelligence");
    expect(engines).toContain("awareness");
    expect(engines).toContain("channel_selection");
  });

  it("returns execution repair engines for execution_gap_only", () => {
    const engines = getRecommendedEnginesForClassification("execution_gap_only");
    expect(engines).toContain("iteration");
    expect(engines).toContain("retention");
    expect(engines).not.toContain("market_intelligence");
  });

  it("returns all engines for both_changed", () => {
    const engines = getRecommendedEnginesForClassification("both_changed");
    expect(engines).toContain("market_intelligence");
    expect(engines).toContain("awareness");
    expect(engines).toContain("channel_selection");
    expect(engines).toContain("iteration");
    expect(engines).toContain("retention");
  });

  it("returns empty array for no_change", () => {
    expect(getRecommendedEnginesForClassification("no_change")).toEqual([]);
  });

  it("returns empty array for no_data", () => {
    expect(getRecommendedEnginesForClassification("no_data")).toEqual([]);
  });

  it("does not include content_dna (not a valid orchestrator engine)", () => {
    for (const cls of ["market_shift_only", "execution_gap_only", "both_changed", "no_change", "no_data"] as const) {
      expect(getRecommendedEnginesForClassification(cls)).not.toContain("content_dna");
    }
  });

  it("does not include objection_map (not a valid orchestrator engine)", () => {
    for (const cls of ["market_shift_only", "execution_gap_only", "both_changed", "no_change", "no_data"] as const) {
      expect(getRecommendedEnginesForClassification(cls)).not.toContain("objection_map");
    }
  });
});

// ── AI-failure fallback behavior ────────────────────────────────────────────

describe("AI-failure fallback via applyClassificationGuard", () => {
  it("when AI returns empty string, guard derives from data presence", () => {
    const result = applyClassificationGuard("", true, true);
    expect(result).toBe("both_changed");
  });

  it("when AI returns undefined-like, guard derives correctly", () => {
    const result = applyClassificationGuard("undefined", false, false);
    expect(result).toBe("no_data");
  });
});
