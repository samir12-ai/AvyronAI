import { describe, it, expect } from "vitest";
import {
  stripInternalTokens,
  extractGroundingRefs,
  coerceToLabel,
  coerceLabelArray,
  looksLikeSyntheticKey,
  isHumanReadable,
} from "../shared/text-policy";
import { normalizeOfferResult } from "../offer-engine/normalize";

describe("text-policy", () => {
  it("strips [RC#] [BB#] [CC#] tokens but keeps surrounding text", () => {
    const out = stripInternalTokens("Reduce churn [RC1] via onboarding [BB2]");
    expect(out).toBe("Reduce churn via onboarding");
    expect(out).not.toMatch(/\[/);
  });

  it("strips RC1: / BB2 - prefix forms", () => {
    expect(stripInternalTokens("RC1: lack of activation")).toBe("lack of activation");
    expect(stripInternalTokens("BB2 - cost objection")).toBe("cost objection");
  });

  it("removes synthetic indexed keys", () => {
    expect(stripInternalTokens("Address objection_0 and desire_2 fully")).toBe("Address and fully");
  });

  it("extractGroundingRefs collects refs without mutating", () => {
    const r = extractGroundingRefs("[RC1] backed by [BB2] addresses objection_0");
    expect(r.groundingRefs).toEqual(["RC1", "BB2"]);
    expect(r.syntheticKeys).toEqual(["objection_0"]);
  });

  it("coerceToLabel never returns [object Object]", () => {
    const obj = { id: "objection_0", label: "Cost too high" };
    expect(coerceToLabel(obj)).toBe("Cost too high");
    expect(coerceToLabel({ random: "no label fields" })).toBeNull();
    expect(coerceToLabel({})).toBeNull();
    expect(coerceToLabel(null)).toBeNull();
    // Must NEVER produce literal "[object Object]"
    expect(String(coerceToLabel({}))).not.toContain("[object Object]");
  });

  it("coerceToLabel rejects synthetic keys as labels", () => {
    expect(coerceToLabel("objection_0")).toBeNull();
    expect(coerceToLabel({ name: "desire_3" })).toBeNull();
  });

  it("coerceLabelArray drops uncoercible items and reports", () => {
    const violations: string[] = [];
    const out = coerceLabelArray(
      ["clean string", { label: "from object" }, { junk: 1 }, null, "objection_0"],
      (reason) => violations.push(reason),
    );
    expect(out).toEqual(["clean string", "from object"]);
    expect(violations.length).toBe(3);
  });

  it("isHumanReadable / looksLikeSyntheticKey", () => {
    expect(looksLikeSyntheticKey("objection_2")).toBe(true);
    expect(looksLikeSyntheticKey("Cost concern")).toBe(false);
    expect(isHumanReadable("Reduce churn")).toBe(true);
    expect(isHumanReadable("[RC1]")).toBe(false);
    expect(isHumanReadable("objection_0")).toBe(false);
  });
});

describe("normalizeOfferResult", () => {
  const baseCandidate = (overrides: any = {}) => ({
    offerName: "name",
    coreOutcome: "outcome",
    mechanismDescription: "mechanism",
    deliverables: [],
    proofAlignment: [],
    audienceFitExplanation: "",
    riskNotes: [],
    ...overrides,
  });

  it("strips tokens from primary offer fields and writes lineage", () => {
    const result = {
      primaryOffer: baseCandidate({
        offerName: "Eliminate churn [RC1]",
        coreOutcome: "Reduce drop-off [BB2] addressing objection_0",
        deliverables: ["Audit [CC1]", "Plan"],
      }),
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.offerName).toBe("Eliminate churn");
    expect(n.primaryOffer.coreOutcome).toBe("Reduce drop-off addressing");
    expect(n.primaryOffer.deliverables).toEqual(["Audit", "Plan"]);
    expect(n.lineage.groundingRefs.sort()).toEqual(["BB2", "CC1", "RC1"]);
    expect(n.lineage.syntheticKeys).toContain("objection_0");
  });

  it("never emits [object Object] for object-shaped fields", () => {
    const result = {
      primaryOffer: baseCandidate({
        offerName: { label: "Real name", id: "junk_0" },
        deliverables: [{ label: "Module A" }, { junk: 1 }, "Module C"],
      }),
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.offerName).toBe("Real name");
    expect(n.primaryOffer.deliverables).toEqual(["Module A", "Module C"]);
    const json = JSON.stringify(n);
    expect(json).not.toContain("[object Object]");
    expect(json).not.toMatch(/objection_\d+/);
  });

  it("forwards engine contract violations into lineage", () => {
    const result = {
      primaryOffer: baseCandidate(),
      layerDiagnostics: { contractViolations: [{ field: "skeleton.x", reason: "uncoercible_value" }] },
    };
    const n = normalizeOfferResult(result as any);
    expect(n.lineage.contractViolations.find((v) => v.field === "skeleton.x")).toBeTruthy();
  });

  it("preserves clean fields untouched", () => {
    const result = {
      primaryOffer: baseCandidate({
        offerName: "Compress sales cycle",
        coreOutcome: "Move from 90 days to 30 days",
      }),
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.offerName).toBe("Compress sales cycle");
    expect(n.primaryOffer.coreOutcome).toBe("Move from 90 days to 30 days");
    expect(n.lineage.groundingRefs).toEqual([]);
  });
});
