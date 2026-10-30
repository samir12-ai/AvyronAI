import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";

describe("Contract: positioning-generator-authority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const saraRealProductTruthFacts = [
    { statement: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), and LUNA SET ($40)." },
    { statement: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel." },
    { statement: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort." },
    { statement: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability." },
  ];

  it("1. Rejects positioning statement asserting fictional operational QA or testing system", async () => {
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
              reason: "Positioning claims unverified operational testing system: 'rigorous quality control process ensuring no see-through issues'",
              fix: "Remove invented QA/QC testing claims. Positioning should articulate market territory and contrast lens.",
              operationalClaims: [
                {
                  claim: "Rigorous quality control process that ensures no see-through issues",
                  role: "EXISTING_FACTUAL_CLAIM",
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
        name: "Premium Modest Quality",
        narrativeDirection: "Sara offers a rigorous quality control process that ensures no see-through issues in every garment.",
        enemyDefinition: "Fast-fashion brands whose fabric sourcing and quality assurance system fails customer expectations.",
        contrastAxis: "unverified cheap clothing vs guaranteed non-sheer apparel",
      },
      productTruthCapabilities: saraRealProductTruthFacts.map((f) => f.statement),
    });

    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED");
    expect(verdict.operationalClaims.some((c) => c.role === "EXISTING_FACTUAL_CLAIM" && !c.capabilityRef)).toBe(true);
  });

  it("2. Approves legitimate strategic positioning that establishes market angle without operational fabrications", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "ACCEPTED",
              positioningRoleVerdict: "VALID",
              factualPostureVerdict: "GROUNDED",
              differentiationAlignmentVerdict: "ALIGNED",
              painLaneAlignmentVerdict: "ALIGNED",
              reason: "Clean strategic contrast territory grounded in premium fabric and modest elegance without claiming unverified processes",
              fix: "",
              operationalClaims: [
                {
                  claim: "Crafted with premium fabrics for lasting wear",
                  role: "EXISTING_FACTUAL_CLAIM",
                  capabilityRef: "cap_fabrics",
                },
                {
                  claim: "Designed for women seeking modest elegance without sacrificing style",
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
        name: "Timeless Modest Elegance",
        narrativeDirection: "Sara delivers graceful, stylish summer dresses crafted with premium fabrics designed for modest living.",
        enemyDefinition: "Disposable fast fashion that sacrifices dignity and durability for cheap production.",
        contrastAxis: "cheap fast fashion vs premium modest style",
      },
      productTruthCapabilities: saraRealProductTruthFacts.map((f) => f.statement),
    });

    expect(verdict.verdict).toBe("ACCEPTED");
    expect(verdict.factualPostureVerdict).toBe("GROUNDED");
    expect(verdict.positioningRoleVerdict).toBe("VALID");
  });
});
