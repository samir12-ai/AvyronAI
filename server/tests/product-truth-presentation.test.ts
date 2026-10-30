import { describe, it, expect } from "vitest";
import {
  classifyStrategicClaim,
  classifyBrandSpine,
  classifyOffer,
  classifyContentPillars,
  classifyPlanAgainstProductTruth,
  PRODUCT_TRUTH_LABELS,
} from "../shared/product-truth-classifier";

describe("Product Truth Classification & Presentation Suite", () => {
  // Canonical sample facts matching the prompt's example & real fixtures
  const sampleTruthFacts = [
    {
      productTruthFactId: "fact_1",
      statement: "Our dresses use premium fabrics designed for comfort and durability.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "fact_2",
      statement: "The summer dresses offering includes multiple distinct SKUs priced between $35 and $62.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "fact_3",
      statement: "Fast delivery and 24-hour product exchange capability.",
      factType: "CAPABILITY",
    },
  ];

  describe("1. Supported Claim Verification", () => {
    it("preserves supported claim without modification and labels it 'Supported by Product Truth'", () => {
      const claim = "Our dresses use premium fabrics designed for comfort and durability.";
      const res = classifyStrategicClaim(claim, sampleTruthFacts);

      expect(res.status).toBe("SUPPORTED");
      expect(res.label).toBe(PRODUCT_TRUTH_LABELS.SUPPORTED);
      expect(res.isSupported).toBe(true);
      expect(res.isProposed).toBe(false);
      expect(res.text).toBe(claim); // unmutated
    });

    it("verifies operational capabilities (fast delivery, 24-hour exchange) are recognized as supported", () => {
      const claim = "Customer orders are processed with fast delivery and 24-hour product exchange.";
      const res = classifyStrategicClaim(claim, sampleTruthFacts);

      expect(res.status).toBe("SUPPORTED");
      expect(res.label).toBe("Supported by Product Truth");
      expect(res.isSupported).toBe(true);
    });
  });

  describe("2. Proposed Strategic Idea Verification", () => {
    it("identifies idea going beyond product truth, rewrites to concise recommendation wording, and labels 'Proposed — requires implementation or verification'", () => {
      const unsupportedIdea = "Our dresses guarantee opacity and breathability.";
      const res = classifyStrategicClaim(unsupportedIdea, sampleTruthFacts, { kind: "positioning" });

      expect(res.status).toBe("PROPOSED");
      expect(res.label).toBe(PRODUCT_TRUTH_LABELS.PROPOSED);
      expect(res.isProposed).toBe(true);
      expect(res.isSupported).toBe(false);

      // Verify that assertive capability phrasing is rewritten to concise proposal wording
      expect(res.text).not.toContain("guarantee opacity");
      expect(res.text).toBe("Proposed positioning: modest summer dresses focused on comfort and opacity.");
      // Ensure no repetitive qualification boilerplate inside the sentence
      expect(res.text).not.toContain("subject to verifying");
    });

    it("ensures transformations are strictly idempotent across multiple passes", () => {
      const unsupportedIdea = "Our dresses guarantee opacity and breathability.";
      const pass1 = classifyStrategicClaim(unsupportedIdea, sampleTruthFacts, { kind: "positioning" });
      const pass2 = classifyStrategicClaim(pass1.text, sampleTruthFacts, { kind: "positioning" });

      expect(pass2.text).toBe(pass1.text);
      expect(pass2.text).not.toMatch(/Proposed positioning:.*Proposed/i);
      expect(pass2.status).toBe("PROPOSED");
    });

    it("preserves audience/market observations without converting them into product capabilities", () => {
      const contrastAxis = "Our summer dresses offering includes multiple distinct SKUs crafted with premium fabrics that ensure opacity and long-lasting comfort, directly addressing the widespread failure of modest summer dresses to deliver breathable, natural-feeling materials without sacrificing modesty.";
      const res = classifyStrategicClaim(contrastAxis, sampleTruthFacts, { kind: "positioning" });

      expect(res.status).toBe("PROPOSED");
      // Market failure observation is preserved verbatim as a market observation
      expect(res.text).toContain("widespread failure of modest summer dresses to deliver breathable, natural-feeling materials without sacrificing modesty");
      // Does not introduce breathability as a product capability
      expect(res.text).toContain("Proposed positioning: focus on verified opacity");
      expect(res.text).not.toContain("Proposed positioning on breathability");
    });

    it("preserves the strategic idea rather than discarding it", () => {
      const unsupportedIdea = "Premium fabric curation that ensures opacity and breathable comfort in warm climates.";
      const res = classifyStrategicClaim(unsupportedIdea, sampleTruthFacts, { kind: "positioning" });

      expect(res.status).toBe("PROPOSED");
      expect(res.label).toBe("Proposed — requires implementation or verification");
      // The idea is kept, not dropped
      expect(res.text).toContain("opacity");
      expect(res.text).toContain("comfort");
    });
  });

  describe("3. Downstream Integrity & Propagation", () => {
    it("propagates label and conditional wording across Brand Spine, Offer, and Content Pillars", () => {
      const rawBrandSpine = {
        umbrellaPositionName: "Modest Summer Dress Opacity Gap",
        contrastAxis: "Our summer dresses offering includes multiple distinct SKUs crafted with premium fabrics that ensure opacity and long-lasting comfort.",
        narrativeDirection: "By providing a curated range of modest summer dresses made from premium, non-see-through fabrics designed for durability and comfort.",
        coreDifferentiationPillars: [
          "Multiple distinct SKUs with transparent pricing ($35-$62), premium fabric use for comfort and durability, fast delivery and 24-hour exchange.",
          "Certified opacity guarantee and natural fabric composition.",
        ],
      };

      const enrichedSpine = classifyBrandSpine(rawBrandSpine, sampleTruthFacts);

      // Contrast Axis has opacity -> must be PROPOSED and conditioned
      expect(enrichedSpine.contrastAxisGrounded.status).toBe("PROPOSED");
      expect(enrichedSpine.contrastAxisGrounded.label).toBe("Proposed — requires implementation or verification");
      expect(enrichedSpine.contrastAxis).not.toContain("ensure opacity");

      // Narrative Direction has non-see-through -> must be PROPOSED
      expect(enrichedSpine.narrativeDirectionGrounded.status).toBe("PROPOSED");
      expect(enrichedSpine.narrativeDirectionGrounded.label).toBe("Proposed — requires implementation or verification");

      // Pillar 1 is supported
      const p1 = classifyStrategicClaim(enrichedSpine.coreDifferentiationPillars[0], sampleTruthFacts);
      expect(p1.status).toBe("SUPPORTED");
      expect(p1.label).toBe("Supported by Product Truth");

      // Pillar 2 has certified opacity guarantee -> proposed
      const p2 = classifyStrategicClaim(enrichedSpine.coreDifferentiationPillars[1], sampleTruthFacts);
      expect(p2.status).toBe("PROPOSED");
      expect(p2.label).toBe("Proposed — requires implementation or verification");
    });

    it("ensures proposed ideas in content pillars cannot become unqualified factual claims", () => {
      const rawPillars = [
        {
          pillar: "Fabric Quality & Comfort Proof",
          examples: ["Carousels detailing premium fabric craftsmanship and opacity"],
        },
        {
          pillar: "Operational Reliability & 24-Hour Exchange",
          examples: ["Reels explaining fast delivery and 24-hour exchange policy"],
        },
      ];

      const classified = classifyContentPillars(rawPillars, sampleTruthFacts);

      // Pillar 1 (opacity) must be PROPOSED
      expect(classified[0].truthStatus).toBe("PROPOSED");
      expect(classified[0].truthLabel).toBe("Proposed — requires implementation or verification");

      // Pillar 2 (operational reliability) must be SUPPORTED
      expect(classified[1].truthStatus).toBe("SUPPORTED");
      expect(classified[1].truthLabel).toBe("Supported by Product Truth");
    });

    it("classifies entire plan structure consistently", () => {
      const samplePlan = {
        strategicSummary: {
          strategy: "We offer distinct SKUs crafted with premium fabrics that ensure opacity and long-lasting comfort.",
        },
        offer: {
          offerName: "Curated Modest Dress Portfolio",
          coreOutcome: "Deliver distinct SKUs priced between $35 and $62 crafted with premium fabrics for comfort and durability.",
        },
      };

      const enrichedPlan = classifyPlanAgainstProductTruth(samplePlan, sampleTruthFacts);

      expect(enrichedPlan.strategicSummary.truthStatus).toBe("PROPOSED");
      expect(enrichedPlan.strategicSummary.truthLabel).toBe("Proposed — requires implementation or verification");

      expect(enrichedPlan.offer.truthStatus).toBe("SUPPORTED");
      expect(enrichedPlan.offer.truthLabel).toBe("Supported by Product Truth");
    });
  });
});
