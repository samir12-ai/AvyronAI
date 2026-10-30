import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: mechanism-role-boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const productTruth = [
    "Products are designed to combine quality and modesty.",
    "Crafted with premium fabrics for comfort.",
  ];

  it("1. Rejects positioning rewritten as mechanism", async () => {
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
              reasons: ["Mechanism describes market territory / whitespace rather than the operational or curation HOW"],
              failureType: "POSITIONING_REWRITTEN",
              feedback: "Explain the engine, method, or curation process.",
              operationalClaims: [],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Market Whitespace Framework",
        description: "We position our brand in the open territory between low-end shein dresses and overpriced abayas.",
        steps: ["Identify open market slot", "Claim territory in customer minds", "Dominate the niche"],
        logic: "Whitespace positioning lets us capture customers without direct price competition.",
      },
      positioning: {
        primaryAxis: "modest_elegance",
        contrastAxis: "fast fashion vs premium modesty",
      },
      productTruthCapabilities: productTruth,
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("POSITIONING_REWRITTEN");
    expect(verdict.mechanismRoleVerdict).toBe("INVALID_ROLE");
  });

  it("2. Rejects differentiation rewritten as mechanism", async () => {
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
              reasons: ["Mechanism claims competitive superiority without explaining how the product produces the outcome"],
              failureType: "DIFFERENTIATION_REWRITTEN",
              feedback: "State the concrete engine or workflow, not comparison claims.",
              operationalClaims: [],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Superior Quality Comparison Framework",
        description: "Our dresses are 3x more durable and 50% softer than Zara and H&M.",
        steps: ["Compare stitch density to competitors", "Demonstrate superior fabric softness", "Prove superior value"],
        logic: "Being visibly higher quality makes customers switch from alternatives.",
      },
      positioning: {
        primaryAxis: "premium_quality",
      },
      productTruthCapabilities: productTruth,
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("DIFFERENTIATION_REWRITTEN");
  });
});
