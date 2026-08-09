/**
 * Regression tests for the "No Offer" input-mapping failure
 * (job campaign_1773576062201_6t0oxi_realrun_1786269207908).
 *
 * Root cause: the audience engine's scaffolding prefix
 * "Problem behind objection: " leaked from the registry canonical into the
 * offer pain contract, so the prompt/validator demanded meta-tokens
 * ("problem", "behind", "objection") and the LLM converged on template text
 * with zero AEL root-cause semantics → CEL depth 0.1 → DEPTH_FAILED.
 *
 * The fix strips scaffolding at every offer-engine pain-text derivation site.
 * Thresholds, CEL, integrity, and the registry itself are UNCHANGED.
 */
import { describe, it, expect } from "vitest";
import {
  cleanPainScaffolding,
  validateOfferAlignment,
  layer1_outcomeConstruction,
} from "../offer-engine/engine";
import { enforceEngineDepthCompliance, DEPTH_GATE_THRESHOLD } from "../causal-enforcement-layer/engine";

const CORE_PAIN = {
  painId: "pain_1d009442245d792c",
  canonical: "Problem behind objection: Most marketing lacks strategic direction",
  classification: "CORE_PURCHASE",
  rank: 1,
  eligible: true,
  allowedUses: ["offer_core"],
};

const audience: any = {
  audiencePains: [CORE_PAIN],
  painRegistry: [CORE_PAIN],
  desireMap: {},
  objectionMap: {},
  emotionalDrivers: [],
};

const differentiation: any = { pillars: [], mechanismFraming: { supported: false, type: "none" } };

function makeOffer(coreOutcome: string): any {
  return {
    offerName: "Strategic Direction Recovery System",
    coreOutcome,
    mechanismDescription: "",
    deliverables: [],
    selectedPainRoles: {
      core: { painId: CORE_PAIN.painId, role: "core_purchase", mergedPainIds: [CORE_PAIN.painId] },
      objections: [],
    },
  };
}

describe("cleanPainScaffolding", () => {
  it("strips 'Problem behind objection:' prefix and keeps the real pain", () => {
    expect(cleanPainScaffolding("Problem behind objection: Most marketing lacks strategic direction"))
      .toBe("Most marketing lacks strategic direction");
  });
  it("strips 'Unresolved need:' prefix", () => {
    expect(cleanPainScaffolding("Unresolved need: belonging / community")).toBe("belonging / community");
  });
  it("leaves plain pain text untouched", () => {
    expect(cleanPainScaffolding("cost and affordability concerns")).toBe("cost and affordability concerns");
  });
  it("is case-insensitive", () => {
    expect(cleanPainScaffolding("PROBLEM BEHIND OBJECTION: fear of commitment")).toBe("fear of commitment");
  });
});

describe("validateOfferAlignment pain-echo contract with scaffolded registry pain", () => {
  it("accepts an outcome naming the REAL pain without any meta-tokens", () => {
    const offer = makeOffer(
      "Recover revenue lost when marketing lacks strategic direction by grounding every campaign in competitor complaint evidence",
    );
    const res = validateOfferAlignment(offer, differentiation, audience);
    const echoFailure = res.failures.find((f) => f.includes("exact audience pain words"));
    expect(echoFailure).toBeUndefined();
  });

  it("rejects an outcome that only parrots the scaffolding meta-tokens", () => {
    const offer = makeOffer("Eliminate the problem behind every objection you face");
    const res = validateOfferAlignment(offer, differentiation, audience);
    const echoFailure = res.failures.find((f) => f.includes("exact audience pain words"));
    expect(echoFailure).toBeDefined();
    // the demanded word list must not contain meta-tokens
    expect(echoFailure).not.toMatch(/\bbehind\b/);
    expect(echoFailure).not.toMatch(/\bobjection/);
    expect(echoFailure).not.toMatch(/\bproblem\b/);
  });

  it("still rejects an unapproved core pain (pain ID preserved)", () => {
    const offer = makeOffer("Recover from marketing that lacks strategic direction");
    offer.selectedPainRoles.core.painId = "pain_invented00000000";
    const res = validateOfferAlignment(offer, differentiation, audience);
    expect(res.failures.some((f) => f.includes("unapproved or lower-priority core pain"))).toBe(true);
  });

  it("still rejects merged pains", () => {
    const offer = makeOffer("Recover from marketing that lacks strategic direction");
    offer.selectedPainRoles.core.mergedPainIds = [CORE_PAIN.painId, "pain_other"];
    const res = validateOfferAlignment(offer, differentiation, audience);
    expect(res.failures.some((f) => f.includes("must not merge"))).toBe(true);
  });
});

describe("layer1_outcomeConstruction with scaffolded core pain", () => {
  it("never leaks the scaffolding prefix into assembled outcome text", () => {
    const l1 = layer1_outcomeConstruction(audience, { territories: [] } as any, { pillars: [] } as any, undefined);
    expect(l1.transformationStatement.toLowerCase()).not.toContain("problem behind objection");
    expect(l1.primaryOutcome.toLowerCase()).not.toContain("problem behind objection");
  });
});

describe("CEL depth gate behavior is unchanged (no threshold weakening)", () => {
  const ael: any = {
    root_causes: [
      {
        deepCause: "Users perceive the pricing as predatory and not justified by clear value, compounded by poor refund policies that erode trust",
        surfaceSignal: "refund complaints and price sensitivity",
        causalReasoning: "poor refund policies erode trust and amplify price sensitivity",
      },
    ],
    causal_chains: [
      { cause: "Users perceive pricing as predatory and refund policies as unfair", impact: "Users feel financially vulnerable and distrust the company", behavior: "hesitate to buy", pain: "trust and credibility doubts" },
    ],
    buying_barriers: [],
  };

  it("a root-cause-grounded candidate can pass the depth gate", () => {
    const texts = [
      "Refund Risk Elimination System",
      "Because poor refund policies erode trust and amplify price sensitivity, users feel financially vulnerable and distrust the company — this offer removes that barrier by exposing predatory pricing patterns and unfair refund policies before they cost you customers",
      "The Refund & Access Pipeline Failure method monitors competitor refund complaints because users perceive pricing as predatory when value is unclear",
    ];
    const res = enforceEngineDepthCompliance("offer", texts, ael);
    expect(res.causalDepthScore).toBeGreaterThanOrEqual(DEPTH_GATE_THRESHOLD);
    expect(res.depthDiagnostics.hasRootCauseGrounding).toBe(true);
  });

  it("a genuinely shallow candidate still fails the depth gate", () => {
    const texts = [
      "Growth Package",
      "Eliminate the problem behind marketing objections with strategic direction",
      "A structured method that delivers results",
    ];
    const res = enforceEngineDepthCompliance("offer", texts, ael);
    expect(res.causalDepthScore).toBeLessThan(DEPTH_GATE_THRESHOLD);
    expect(res.depthDiagnostics.hasRootCauseGrounding).toBe(false);
  });
});
