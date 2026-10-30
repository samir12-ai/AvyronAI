import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: mechanism-generator-authority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const saraTruth = [
    "Products are designed to combine quality and modesty, emphasizing modest fashion.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear.",
  ];

  it("1. Treats Positioning and Differentiation as strategic context, not Product Truth", async () => {
    // Positioning had hallucinated "rigorous quality control process" in narrative
    // Mechanism judge rejects candidate that adopts this hallucination as a factual company process
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REPAIR",
              mechanismRoleVerdict: "VALID_HOW",
              factualPostureVerdict: "UNSUPPORTED_FACTUAL_CLAIM",
              mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
              axisVerdict: "ALIGNED",
              axisReason: "Aligned with contrast axis",
              reasons: ["Adopted upstream narrative metaphor as an operational company QA process without Product Truth backing"],
              failureType: "UNSUPPORTED_CAPABILITIES",
              feedback: "Ground the mechanism in verified capabilities or frame as a curation/silhouette standard rather than an internal QA process.",
              operationalClaims: [
                {
                  claim: "Company executes a 5-point quality assurance testing protocol",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Premium Fabric Quality Assurance System",
        description: "Executing the positioning directive by operating a 5-point quality assurance testing protocol on all fabric rolls.",
        steps: ["Inspect bolt", "Perform light box test", "Tag certified non-sheer"],
        logic: "Operational testing guarantees opacity.",
      },
      positioning: {
        primaryAxis: "quality_assurance",
        contrastAxis: "unverified clothing vs rigorous QA verified clothing",
      },
      productTruthCapabilities: saraTruth,
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("UNSUPPORTED_CAPABILITIES");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED_FACTUAL_CLAIM");
  });

  it("2. Approves curation-based mechanism that aligns with positioning without fabricating testing processes", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              mechanismRoleVerdict: "VALID_HOW",
              factualPostureVerdict: "FACTUALLY_GROUNDED",
              mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
              axisVerdict: "ALIGNED",
              axisReason: "Silhouette curation delivers on modest quality axis",
              reasons: ["Legitimate curation and design architecture HOW without claiming unverified testing labs"],
              failureType: "NONE",
              feedback: "",
              operationalClaims: [
                {
                  claim: "Curated silhouette standards and layered cut architecture",
                  role: "STRATEGIC_SYNTHESIS",
                  supportedByCapability: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Curated Silhouette Architecture",
        description: "A specialized design and curation standard that selects high-density weaves and multi-layer cuts for modest elegance.",
        steps: [
          "Select premium fabrics meeting drape and density criteria",
          "Structure patterns with modest neckline and sleeve coverage",
          "Curate seasonally adaptable dress sets"
        ],
        logic: "Curation and structured pattern design structurally ensure modesty and elegance without needing laboratory testing.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: {
        primaryAxis: "modest_elegance",
        contrastAxis: "sheer fast fashion vs curated modest elegance",
      },
      productTruthCapabilities: saraTruth,
    });

    expect(verdict.verdict).toBe("APPROVE");
    expect(verdict.factualPostureVerdict).toBe("FACTUALLY_GROUNDED");
    expect(verdict.mechanismAuthorityRole).toBe("STRATEGIC_SYNTHESIS");
  });
});
