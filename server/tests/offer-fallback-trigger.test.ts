import { describe, it, expect } from "vitest";
import { normalizeOfferResult } from "../offer-engine/normalize";

/**
 * Fallback discipline: when upstream signal is missing, the engine should
 * mark fields as degraded rather than silently substituting a generic
 * template that looks confident. The normalizer preserves these markers.
 */
describe("fallback / degradation surface", () => {
  it("propagates degraded markers without polishing them away", () => {
    const result = {
      primaryOffer: {
        offerName: "axis offer",
        coreOutcome: "axis outcome (degraded — upstream data missing)",
        mechanismDescription: "Structured delivery system using axis (degraded — mechanism missing)",
        deliverables: [],
        proofAlignment: [],
        audienceFitExplanation: "",
        riskNotes: [],
      },
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.coreOutcome).toContain("degraded");
    expect(n.primaryOffer.mechanismDescription).toContain("degraded");
  });

  it("does not invent content when arrays are empty", () => {
    const result = {
      primaryOffer: {
        offerName: "name",
        coreOutcome: "outcome",
        mechanismDescription: "mechanism",
        deliverables: [],
        proofAlignment: [],
        audienceFitExplanation: "",
        riskNotes: [],
        proofPath: [],
        objectionHandling: [],
      },
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.proofPath).toEqual([]);
    expect(n.primaryOffer.objectionHandling).toEqual([]);
    expect(n.primaryOffer.deliverables).toEqual([]);
  });

  it("records a contract violation when string field cannot be coerced", () => {
    const result = {
      primaryOffer: {
        offerName: { random: "no label fields here" }, // uncoercible
        coreOutcome: "outcome",
        mechanismDescription: "mechanism",
        deliverables: [],
        proofAlignment: [],
        audienceFitExplanation: "",
        riskNotes: [],
      },
    };
    const n = normalizeOfferResult(result as any);
    expect(n.lineage.contractViolations.find((v) => v.field === "primaryOffer.offerName")).toBeTruthy();
    expect(JSON.stringify(n)).not.toContain("[object Object]");
  });

  it("does not strip non-token underscores in body text (only display tokens)", () => {
    const result = {
      primaryOffer: {
        offerName: "name",
        coreOutcome: "Cut cycle from 90_days baseline", // not a synthetic key shape
        mechanismDescription: "m",
        deliverables: [],
        proofAlignment: [],
        audienceFitExplanation: "",
        riskNotes: [],
      },
    };
    const n = normalizeOfferResult(result as any);
    expect(n.primaryOffer.coreOutcome).toContain("90_days");
  });
});
