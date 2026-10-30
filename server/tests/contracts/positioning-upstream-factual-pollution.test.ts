import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";

describe("Contract: positioning-upstream-factual-pollution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const verifiedProductTruth = [
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
  ];

  const upstreamPollutedDifferentiation = "Sara uniquely utilizes premium natural breathable fabrics in modest summer dresses at affordable prices.";

  it("1. Rejects positioning candidate that adopted unverified factual narrative from Differentiation", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REJECTED",
              positioningRoleVerdict: "VALID",
              factualPostureVerdict: "UNSUPPORTED",
              differentiationAlignmentVerdict: "ALIGNED",
              painLaneAlignmentVerdict: "ALIGNED",
              reason: "Candidate adopts unverified material predicates from upstream Differentiation: 'natural breathable fabrics'. Product Truth establishes only 'premium fabrics'. Upstream strategic context is not factual authority.",
              fix: "Remove 'natural' and 'breathable' material predicates. Ground strictly in verified 'premium fabrics'.",
              embeddedFactualPredicates: [
                {
                  predicate: "premium natural fabrics",
                  category: "MATERIAL_COMPOSITION",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Product Truth does not verify natural fabric composition for dresses",
                },
                {
                  predicate: "fabric breathability",
                  category: "PHYSICAL_PERFORMANCE",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Product Truth does not verify breathability performance",
                },
              ],
              unsupportedPredicates: ["premium natural fabrics", "fabric breathability"],
              operationalClaims: [
                {
                  claim: "premium natural fabrics designed for fabric breathability",
                  role: "STRATEGIC_SYNTHESIS",
                  capabilityRef: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgePositioningFactualPosture({
      candidate: {
        name: "Curated Breathable Elegance",
        narrativeDirection: "Sara delivers modest summer wear crafted from premium natural fabrics designed for fabric breathability.",
        enemyDefinition: "Fast fashion that traps heat in synthetic blends.",
        contrastAxis: "synthetic stifling apparel vs breathable natural modest wear",
      },
      differentiation: upstreamPollutedDifferentiation,
      productTruthCapabilities: verifiedProductTruth,
    });

    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED");
    expect(verdict.unsupportedPredicates.length).toBeGreaterThan(0);
    expect(verdict.reason).toContain("Differentiation");
  });
});
