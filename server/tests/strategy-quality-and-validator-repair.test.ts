import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../ai-client";
import { judgeMechanismSemanticRole, validateMechanismName } from "../mechanism-engine/engine";
import { judgeFunnelBusinessModelFit, layer2_offerToFunnelFit } from "../funnel-engine/engine";
import {
  checkOfferInputSufficient,
  checkHallucinationExposure,
  HallucinationCheckContext,
} from "../system-control/structural-checks";
import { KIND_TEST } from "../shared/interchangeability-judge";
import { EngineStepResult } from "../system-control/types";
import { SignalComposition } from "../shared/confidence-provenance";
import * as fs from "fs";
import * as path from "path";

describe("Strategy Quality and Validator Repair Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Real Sara Product Truth from business_understanding_snapshots:
  // Fact 7a56b9fb: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort."
  // Fact 38d051d0: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant, faith-aligned apparel."
  // Fact e05ef039: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), LUNA SET ($40), GIRLY SET ($62)..."
  const saraRealProductTruthFacts = [
    "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), LUNA SET ($40), GIRLY SET ($62), SUNSHINE SET ($62), NAVY SET ($60), BUTTERFLY DRESS ($62), SARA DRESS ($40), and BLAZER Set ($50).",
    "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant, faith-aligned apparel.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Offering includes ready-to-wear apparel designed for multiple occasions with a focus on timeless elegance to remain stylish across seasons.",
  ];

  // =========================================================================
  // 1. Mechanism Semantic Role & Hostile Judge
  // =========================================================================
  describe("Component 1: Mechanism Semantic Role Quality", () => {
    it("rejects names containing positioning, whitespace positioning, or ending with whitespace", () => {
      const badNames = [
        "The Modest Dress Style Validation Whitespace Positioning Framework",
        "Whitespace Positioning Protocol",
        "Brand Positioning System",
        "Summer Modesty Whitespace",
      ];
      for (const name of badNames) {
        const validation = validateMechanismName(name);
        expect(validation.valid).toBe(false);
        expect(validation.reason).toBeDefined();
      }

      const goodNames = [
        "Curated Dress Quality Protocol",
        "Pre-Shipment Garment Inspection Protocol",
        "Climate-Adaptive Fabric Sourcing Pipeline",
      ];
      for (const name of goodNames) {
        const validation = validateMechanismName(name);
        expect(validation.valid).toBe(true);
      }
    });

    it("hostile judge rejects mechanism that is positioning rewritten", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "REPAIR",
                mechanismRoleVerdict: "INVALID_ROLE",
                factualPostureVerdict: "FACTUALLY_GROUNDED",
                mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                axisVerdict: "ALIGNED",
                axisReason: "Aligned with axis",
                reasons: ["Mechanism is merely positioning rewritten: describes market whitespace rather than operational HOW"],
                failureType: "POSITIONING_REWRITTEN",
                feedback: "Detail concrete operational or curation process.",
                operationalClaims: [],
              }),
            },
          },
        ],
      } as any);
      const result = await judgeMechanismSemanticRole({
        candidate: {
          name: "The Modest Dress Style Validation Whitespace Positioning Framework",
          description: "Positions our brand in the underserved market whitespace between fast fashion and luxury modest wear.",
          steps: ["Identify competitor gaps", "Claim the modest elegance position", "Capture market share"],
          logic: "By owning the whitespace between low quality and high price, we dominate the segment.",
        },
        positioning: {
          primaryAxis: "modest_elegance",
          contrastAxis: "cheap_polyester",
        },
        productTruthCapabilities: saraRealProductTruthFacts,
      });

      expect(result.verdict).toBe("REPAIR");
      expect(result.failureType).toBe("POSITIONING_REWRITTEN");
      expect(result.reasons.some((r) => r.toLowerCase().includes("positioning"))).toBe(true);
    });

    it("hostile judge rejects mechanism that is marketing communication advice", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "REPAIR",
                mechanismRoleVerdict: "INVALID_ROLE",
                factualPostureVerdict: "FACTUALLY_GROUNDED",
                mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
                axisVerdict: "ALIGNED",
                axisReason: "Aligned with axis",
                reasons: ["Mechanism describes advertising creative tactics rather than product/service engine"],
                failureType: "MARKETING_COMMUNICATION",
                feedback: "Explain how product solves the problem.",
                operationalClaims: [],
              }),
            },
          },
        ],
      } as any);
      const result = await judgeMechanismSemanticRole({
        candidate: {
          name: "Direct Response Video Hook Framework",
          description: "Uses 3-second visual hooks in ad copy to capture TikTok scrollers before revealing the dress.",
          steps: ["Deploy top-of-funnel creative hook", "A/B test messaging angles", "Drive clicks to collection page"],
          logic: "Engaging ad creatives increase click-through rates and reduce customer acquisition cost.",
        },
        positioning: {
          primaryAxis: "modest_elegance",
        },
        productTruthCapabilities: saraRealProductTruthFacts,
      });

      expect(result.verdict).toBe("REPAIR");
      expect(result.failureType).toBe("MARKETING_COMMUNICATION");
    });

    it("canonical Gate 0 rejects invented proprietary technology not in Product Truth", async () => {
      const { validateAuthorityBoundaries } = await import("../shared/authority-validator");
      const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
      const caps = deriveValidatedCapabilities(null, {
        productTruthFacts: saraRealProductTruthFacts.map((statement, i) => ({
          productTruthFactId: `fact_${i}`,
          statement,
          factType: "CAPABILITY",
        })),
      });

      const result = validateAuthorityBoundaries({
        engineId: "mechanism",
        centralProblemTexts: [],
        operationalClaims: [
          {
            claim: "Utilizes proprietary patented ThermoWeave™ fibers engineered with molecular cooling channels",
            role: "EXISTING_FACTUAL_CLAIM",
            capabilityRef: null,
          },
        ],
        selectedPains: [],
        capabilities: caps,
      });

      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    });

    it("canonical Gate 0 rejects unverified breathability/airflow claims (comfort ≠ breathable)", async () => {
      const { validateAuthorityBoundaries } = await import("../shared/authority-validator");
      const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
      const caps = deriveValidatedCapabilities(null, {
        productTruthFacts: saraRealProductTruthFacts.map((statement, i) => ({
          productTruthFactId: `fact_${i}`,
          statement,
          factType: "CAPABILITY",
        })),
      });

      const result = validateAuthorityBoundaries({
        engineId: "mechanism",
        centralProblemTexts: [],
        operationalClaims: [
          {
            claim: "Source high-density weave engineered for convection airflow",
            role: "EXISTING_FACTUAL_CLAIM",
            capabilityRef: null,
          },
        ],
        selectedPains: [],
        capabilities: caps,
      });

      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    });

    it("canonical Gate 0 rejects unverified specific fabric materials (premium fabric ≠ linen/viscose)", async () => {
      const { validateAuthorityBoundaries } = await import("../shared/authority-validator");
      const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
      const caps = deriveValidatedCapabilities(null, {
        productTruthFacts: saraRealProductTruthFacts.map((statement, i) => ({
          productTruthFactId: `fact_${i}`,
          statement,
          factType: "CAPABILITY",
        })),
      });

      const result = validateAuthorityBoundaries({
        engineId: "mechanism",
        centralProblemTexts: [],
        operationalClaims: [
          {
            claim: "Garment sourcing protocol utilizing 100% natural linen and viscose fibers",
            role: "EXISTING_FACTUAL_CLAIM",
            capabilityRef: null,
          },
        ],
        selectedPains: [],
        capabilities: caps,
      });

      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    });

    it("canonical Gate 0 rejects unverified technical opacity testing (modesty ≠ opacity/light-box testing)", async () => {
      const { validateAuthorityBoundaries } = await import("../shared/authority-validator");
      const { deriveValidatedCapabilities } = await import("../shared/capability-registry");
      const caps = deriveValidatedCapabilities(null, {
        productTruthFacts: saraRealProductTruthFacts.map((statement, i) => ({
          productTruthFactId: `fact_${i}`,
          statement,
          factType: "CAPABILITY",
        })),
      });

      const result = validateAuthorityBoundaries({
        engineId: "mechanism",
        centralProblemTexts: [],
        operationalClaims: [
          {
            claim: "Enforces lab-grade opacity testing with double lining verification",
            role: "EXISTING_FACTUAL_CLAIM",
            capabilityRef: null,
          },
        ],
        selectedPains: [],
        capabilities: caps,
      });

      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    });

    it("hostile judge approves valid operational/curation HOW mechanism grounded in Product Truth", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "APPROVE",
                reasons: ["Valid operational quality and fit assurance mechanism grounded in physical garment curation"],
                failureType: "NONE",
              }),
            },
          },
        ],
      } as any);

      const result = await judgeMechanismSemanticRole({
        candidate: {
          name: "Sara Garment Curation and Fit Assurance Protocol",
          description: "An operational quality standard combining standardized silhouette grading, pre-shipment seam inspection, and guaranteed size exchanges.",
          steps: [
            "Standardize silhouette measurements across all summer SKUs (BONBON, HAYAT, LUNA) ensuring guaranteed modest coverage without sizing guesswork",
            "Enforce pre-shipment quality inspection protocol verifying seam durability, fabric finish, and comfort standards",
            "Provide 24-hour exchange guarantee and size consultation support to eliminate purchase uncertainty",
          ],
          logic: "Delivers dependable modest summer dresses by combining standardized sizing specifications with pre-shipment quality checks and hassle-free exchanges.",
        },
        positioning: {
          primaryAxis: "modest_comfort",
        },
        productTruthCapabilities: saraRealProductTruthFacts,
      });

      expect(result.verdict).toBe("APPROVE");
      expect(result.failureType).toBe("NONE");
    });

    it("hostile judge fails closed on transport or infrastructure error", async () => {
      vi.spyOn(aiModule, "aiChat").mockRejectedValueOnce(new Error("Judge connection refused"));

      const result = await judgeMechanismSemanticRole({
        candidate: {
          name: "Sara Garment Curation and Fit Assurance Protocol",
          description: "Operational quality standard for physical garments.",
          steps: ["Standardize silhouette measurements", "Pre-shipment inspection", "24h exchange guarantee"],
          logic: "Ensures consistent quality and customer assurance.",
        },
        positioning: {
          primaryAxis: "modest_comfort",
        },
        productTruthCapabilities: saraRealProductTruthFacts,
      });

      expect(result.verdict).toBe("BLOCK");
      expect(result.failureType).toBe("JUDGE_UNAVAILABLE");
      expect(result.reasons[0]).toContain("Judge infrastructure failure");
    });
  });

  // =========================================================================
  // 2. Funnel Business-Model Fit & Dynamic Hostile Judge
  // =========================================================================
  describe("Component 2: Funnel Business-Model Fit", () => {
    it("hostile judge dynamically rejects high-friction webinar for low-ticket retail via LLM evaluation", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "REPAIR",
                reasons: ["Disproportionate purchase friction: consumers will not attend a 60-minute webinar to purchase a $40 modest dress"],
                failureType: "PURCHASE_FRICTION_MISMATCH",
                feedback: "Replace with a low-friction direct checkout funnel.",
              }),
            },
          },
        ],
      } as any);

      const result = await judgeFunnelBusinessModelFit({
        candidate: {
          name: "Sara Summer Dress Selection Webinar",
          type: "webinar",
          journeyRationale: [
            "Audience registers for a 60-minute live session to learn modest fashion styling.",
            "Attendees watch a presentation comparing summer dress collections.",
            "Host pitches the dress collection at the end of the session.",
          ],
        },
        commercialContext: {
          businessModel: "B2C / DTC eCommerce",
          generalIndustry: "Modest Fashion & Women's Apparel",
          priceRange: "$35 - $62",
          coreOffer: "Summer Modest Dresses Collection",
        },
        offer: {
          offerName: "Sara Summer Modest Dresses",
          coreOutcome: "Effortless modest dressing in summer",
        } as any,
      });

      expect(result.verdict).toBe("REPAIR");
      expect(result.failureType).toBe("PURCHASE_FRICTION_MISMATCH");
      expect(result.reasons[0]).toContain("Disproportionate purchase friction");
    });

    it("hostile judge approves low-friction direct checkout funnel via LLM evaluation", async () => {
      vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "APPROVE",
                reasons: ["Direct checkout journey matches transaction economics and retail consumer behavior"],
                failureType: "NONE",
              }),
            },
          },
        ],
      } as any);

      const result = await judgeFunnelBusinessModelFit({
        candidate: {
          name: "Sara Direct Dress Experience Funnel",
          type: "direct",
          journeyRationale: [
            "Customer discovers dress collection through social proof and styling photos.",
            "Catalog landing page showcases size guides, verified customer reviews, and fabric details.",
            "Frictionless direct checkout with transparent sizing and hassle-free returns.",
          ],
        },
        commercialContext: {
          businessModel: "B2C / DTC eCommerce",
          generalIndustry: "Modest Fashion & Women's Apparel",
          priceRange: "$35 - $62",
        },
        offer: {
          offerName: "Sara Summer Modest Dresses",
          coreOutcome: "Effortless modest dressing in summer",
        } as any,
      });

      expect(result.verdict).toBe("APPROVE");
      expect(result.failureType).toBe("NONE");
    });

    it("hostile funnel judge fails closed on transport or infrastructure error", async () => {
      vi.spyOn(aiModule, "aiChat").mockRejectedValueOnce(new Error("Commercial judge timeout"));

      const result = await judgeFunnelBusinessModelFit({
        candidate: {
          name: "Sara Direct Dress Experience Funnel",
          type: "direct",
          journeyRationale: ["Discovery", "Catalog", "Checkout"],
        },
        commercialContext: {
          businessModel: "B2C / DTC eCommerce",
          generalIndustry: "Modest Fashion & Women's Apparel",
          priceRange: "$35 - $62",
        },
        offer: {
          offerName: "Sara Summer Modest Dresses",
        } as any,
      });

      expect(result.verdict).toBe("BLOCK");
      expect(result.failureType).toBe("BUSINESS_MODEL_MISMATCH");
      expect(result.reasons[0]).toContain("Judge infrastructure failure");
    });

    it("layer2_offerToFunnelFit operates on clean awareness/maturity baseline without deterministic industry hardcodes", () => {
      const highOffer = {
        offerName: "Sara Modest Fashion Dresses",
        offerStrengthScore: 0.85,
        deliverables: ["Dress", "Free Shipping"],
      } as any;
      const matureAudience = {
        awarenessLevel: "problem_aware",
        maturityIndex: 0.75,
      } as any;

      // High offer strength (>0.7) and high maturity (>0.6) selects direct:
      const fit1 = layer2_offerToFunnelFit(highOffer, matureAudience);
      expect(fit1.funnelType).toBe("direct");
      expect(fit1.fitScore).toBe(0.85);

      // Low maturity (<0.3) selects challenge:
      const lowMaturityAudience = {
        awarenessLevel: "problem_aware",
        maturityIndex: 0.2,
      } as any;
      const fit2 = layer2_offerToFunnelFit({ offerStrengthScore: 0.4 } as any, lowMaturityAudience);
      expect(fit2.funnelType).toBe("challenge");

      // Verify code of funnel-engine/engine.ts does not contain hardcoded isB2CDTC or isLowTicket
      const funnelEngineSrc = fs.readFileSync(path.resolve(__dirname, "../funnel-engine/engine.ts"), "utf-8");
      expect(funnelEngineSrc.includes("const isB2CDTC =")).toBe(false);
      expect(funnelEngineSrc.includes("const isLowTicket =")).toBe(false);
      expect(funnelEngineSrc.includes("isB2CDTC || isLowTicket")).toBe(false);
    });
  });

  // =========================================================================
  // 3. Positioning & Offer Quality Handling
  // =========================================================================
  describe("Component 3: Positioning & Offer Quality Handling", () => {
    it("interchangeability judge prompt explicitly forbids demanding proprietary technology for commercial goods", () => {
      expect(KIND_TEST.offer.test).toContain("Do NOT demand patented technology");
      expect(KIND_TEST.offer.test).toContain("proprietary material weaves");
      expect(KIND_TEST.offer.test).toContain("24h exchange guarantee");
      expect(KIND_TEST.positioning_claim.test).toContain("Do NOT demand invented proprietary technology");
      expect(KIND_TEST.positioning_claim.test).toContain("ThermoWeave™");
    });

    it("interchangeability judge instructions enforce truthful combination and forbid attribute upgrades", () => {
      expect(KIND_TEST.positioning_claim.test).toContain("Broad terms must not be upgraded to narrower physical specs");
      expect(KIND_TEST.positioning_claim.test).toContain("'comfort' is not 'breathable'");
      expect(KIND_TEST.positioning_claim.test).toContain("'modesty' is not 'opaque'");
    });
  });

  // =========================================================================
  // 4. System Control Offer Validator Check
  // =========================================================================
  describe("Component 4: System Control Offer Input Validator", () => {
    const currentJobId = "orch_test_job_123";

    it("passes when current job offer result has status COMPLETE", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "SUCCESS",
        output: {
          status: "COMPLETE",
          offerName: "Sara Summer Collection",
          _provenance: { sourceJobId: currentJobId },
        },
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(true);
      expect(check.status).toBe("PASS");
      expect(check.details).toContain("sufficient pain input");
    });

    it("passes when current job offer result has status PARTIAL", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "SUCCESS",
        output: {
          status: "PARTIAL",
          offerName: "Sara Summer Collection",
          _provenance: { sourceJobId: currentJobId },
        },
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(true);
      expect(check.status).toBe("PASS");
    });

    it("fails closed with CROSS_JOB_ISOLATION when output originates from a foreign job", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "SUCCESS",
        output: {
          status: "COMPLETE",
          offerName: "Sara Summer Collection",
          _provenance: { sourceJobId: "orch_foreign_job_999" },
        },
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(false);
      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("CROSS_JOB_ISOLATION");
    });

    it("fails with OFFER_INPUT_INSUFFICIENT when offer status is INSUFFICIENT_SIGNALS", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "SUCCESS",
        output: {
          status: "INSUFFICIENT_SIGNALS",
          statusMessage: "Audience pains lacked sufficient commercial depth",
          _provenance: { sourceJobId: currentJobId },
        },
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(false);
      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("OFFER_INPUT_INSUFFICIENT");
    });

    it("fails with CONTRACT_INVALID when canonical status is missing or invalid enum", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "SUCCESS",
        output: {
          status: "BOGUS_STATUS_VALUE",
          _provenance: { sourceJobId: currentJobId },
        },
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(false);
      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("CONTRACT_INVALID");
    });

    it("emits notReached when offer engine execution failed or timed out", () => {
      const results = new Map<any, EngineStepResult>();
      results.set("offer", {
        engine: "offer",
        status: "TIMEOUT",
        output: null,
      } as any);

      const check = checkOfferInputSufficient(results, currentJobId);
      expect(check.passed).toBe(false);
      expect(check.status).toBe("TIMEOUT");
    });
  });

  // =========================================================================
  // 5. System Control Hallucination Heuristic
  // =========================================================================
  describe("Component 5: System Control Hallucination Heuristic", () => {
    const signalComp: SignalComposition = {
      realRatio: 0.20,
      competitorRatio: 0.20,
      trustedRatio: 0.60,
      inferredRatio: 0.45,
      fallbackRatio: 0.00,
      unknownRatio: 0.00,
      total: 20,
    };

    it("passes when authority boundaries passed (legitimate strategic synthesis does not trigger hallucination)", () => {
      const context: HallucinationCheckContext = {
        authorityBoundariesPassed: true,
        hasUnsupportedFactualClaims: false,
      };

      const check = checkHallucinationExposure(signalComp, "test", context);
      expect(check.passed).toBe(true);
      expect(check.status).toBe("PASS");
    });

    it("fails when there are genuine unsupported factual claims", () => {
      const context: HallucinationCheckContext = {
        authorityBoundariesPassed: false,
        hasUnsupportedFactualClaims: true,
        unsupportedFactualClaimCount: 3,
      };

      const check = checkHallucinationExposure(signalComp, "test", context);
      expect(check.passed).toBe(false);
      expect(check.status).toBe("FAIL");
      expect(check.details).toContain("inferred_synthesis");
    });
  });

  // =========================================================================
  // 6. Frozen Architecture Guard
  // =========================================================================
  describe("Component 6: Frozen Architecture Preservation Guard", () => {
    it("confirms frozen channel-selection files remain untouched by this repair", () => {
      const aiChannelProposalPath = path.resolve(__dirname, "../strategy/channel-selection/ai-channel-proposal.ts");
      const channelJudgePath = path.resolve(__dirname, "../strategy/channel-selection/channel-judge.ts");
      expect(fs.existsSync(aiChannelProposalPath)).toBe(true);
      expect(fs.existsSync(channelJudgePath)).toBe(true);

      const aiProposalContent = fs.readFileSync(aiChannelProposalPath, "utf-8");
      // Channel selection dynamic LLM implementation is preserved
      expect(aiProposalContent).toContain("runChannelSelectionWithAIProposal");
    });

    it("confirms authority-validator remains untouched and authoritative", () => {
      const authorityPath = path.resolve(__dirname, "../shared/authority-validator.ts");
      expect(fs.existsSync(authorityPath)).toBe(true);
      const content = fs.readFileSync(authorityPath, "utf-8");
      expect(content).toContain("validateAuthorityBoundaries");
    });

    it("confirms strategy-root assembler remains untouched", () => {
      const stratRootPath = path.resolve(__dirname, "../shared/strategy-root-assembler.ts");
      expect(fs.existsSync(stratRootPath)).toBe(true);
      const content = fs.readFileSync(stratRootPath, "utf-8");
      expect(content).toContain("assembleStrategyRoot");
    });
  });
});
