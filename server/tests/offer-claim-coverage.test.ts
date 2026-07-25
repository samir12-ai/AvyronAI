import { describe, it, expect } from "vitest";
import { coerceToLabel, coerceLabelArray } from "../shared/text-policy";

/**
 * Claim coverage: when the orchestrator emits structured claim objects, the
 * builders must extract benefit/contrast/rootCause/proofRefs WITHOUT
 * dropping to "[object Object]" or losing claim-derived signal.
 */
describe("claim digest coverage", () => {
  const sampleClaim = {
    claim: "Compress sales cycle to 30 days",
    benefit: "Cut sales cycle by 67%",
    contrast: "vs. legacy 90-day pipeline",
    rootCauseUsed: "Buyers stall at proof stage",
    proofRefs: [
      { label: "Cohort A: 28 days median" },
      "Case study: Acme Corp",
      { junk: true }, // uncoercible — must be dropped
    ],
    objectionRefs: ["Will it integrate?", { label: "Internal team capacity" }],
  };

  it("coerces benefit/contrast/rootCause from structured claim", () => {
    expect(coerceToLabel(sampleClaim.benefit)).toBe("Cut sales cycle by 67%");
    expect(coerceToLabel(sampleClaim.contrast)).toBe("vs. legacy 90-day pipeline");
    expect(coerceToLabel(sampleClaim.rootCauseUsed)).toBe("Buyers stall at proof stage");
  });

  it("collects proofRefs as clean strings, drops junk", () => {
    const out = coerceLabelArray(sampleClaim.proofRefs);
    expect(out).toEqual(["Cohort A: 28 days median", "Case study: Acme Corp"]);
  });

  it("collects objectionRefs from mixed string+object array", () => {
    const out = coerceLabelArray(sampleClaim.objectionRefs);
    expect(out).toEqual(["Will it integrate?", "Internal team capacity"]);
  });

  it("falls back through .claim when no .benefit present", () => {
    const minimal = { claim: "Increase activation by 40%" };
    expect(coerceToLabel(minimal)).toBe("Increase activation by 40%");
  });

  it("returns null for empty claims (caller decides degraded marker)", () => {
    expect(coerceToLabel({})).toBeNull();
    expect(coerceToLabel(null)).toBeNull();
  });
});
