import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: mechanism-role-verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const saraTruth = [
    "Products are designed to combine quality and modesty.",
    "Crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Customer orders are processed with 24-hour product exchange capability.",
  ];

  it("1. Verifies STRATEGIC_SYNTHESIS for design curation framework", async () => {
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
              axisReason: "Aligned",
              reasons: ["Valid strategic curation synthesis"],
              failureType: "NONE",
              feedback: "",
              operationalClaims: [
                {
                  claim: "Curated sizing and silhouette standards",
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
        name: "Curated Modest Fit Standard",
        description: "A curated design and fit model standardizing coverage and modest silhouettes across collections.",
        steps: ["Audit silhouette dimensions", "Select premium fabric cuts", "Assemble coordinated sets"],
        logic: "Curated design guarantees modest wear without industrial laboratory claims.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: {
        primaryAxis: "modest_quality",
      },
      productTruthCapabilities: saraTruth,
    });

    expect(verdict.verdict).toBe("APPROVE");
    expect(verdict.mechanismAuthorityRole).toBe("STRATEGIC_SYNTHESIS");
  });

  it("2. Verifies VERIFIED_EXISTING_PROCESS when backed by Product Truth capability", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              mechanismRoleVerdict: "VALID_HOW",
              factualPostureVerdict: "FACTUALLY_GROUNDED",
              mechanismAuthorityRole: "VERIFIED_EXISTING_PROCESS",
              axisVerdict: "ALIGNED",
              axisReason: "Aligned",
              reasons: ["Directly backed by 24-hour exchange capability in Product Truth"],
              failureType: "NONE",
              feedback: "",
              operationalClaims: [
                {
                  claim: "Customer orders processed with 24-hour product exchange capability",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: "cap_exchange",
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "24-Hour Exchange Guarantee Workflow",
        description: "An operational exchange turnaround process ensuring customers can swap sizes within 24 hours.",
        steps: ["Receive exchange request", "Dispatch replacement SKU immediately", "Process return"],
        logic: "Guaranteed 24-hour exchange eliminates the sizing risk of online apparel shopping.",
        mechanismAuthorityRole: "VERIFIED_EXISTING_PROCESS",
      },
      positioning: {
        primaryAxis: "risk_reversal",
      },
      productTruthCapabilities: saraTruth,
    });

    expect(verdict.verdict).toBe("APPROVE");
    expect(verdict.mechanismAuthorityRole).toBe("VERIFIED_EXISTING_PROCESS");
  });
});
