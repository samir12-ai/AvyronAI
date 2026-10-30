import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";

describe("Contract: positioning-judge-independence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const capabilities = [
    "Sara summer dresses are crafted with premium fabrics for comfort and durability.",
    "Sara offers 24-hour exchange capability for all purchases.",
  ];

  it("1. Distinguishes STRATEGIC_SYNTHESIS from EXISTING_FACTUAL_CLAIM", async () => {
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
              reason: "Properly separates verified facts from strategic synthesis framing",
              fix: "",
              operationalClaims: [
                {
                  claim: "Sara dresses are crafted with premium fabrics",
                  role: "EXISTING_FACTUAL_CLAIM",
                  capabilityRef: "cap_fabrics",
                },
                {
                  claim: "Sara positions as the effortless modest sanctuary for women tired of fast-fashion compromises",
                  role: "STRATEGIC_SYNTHESIS",
                  supportedByCapability: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgePositioningFactualPosture({
      candidate: {
        name: "Effortless Modest Sanctuary",
        narrativeDirection: "Sara dresses are crafted with premium fabrics, positioning as the effortless modest sanctuary for women tired of fast-fashion compromises.",
        enemyDefinition: "Brands that treat modest wear as an afterthought.",
        contrastAxis: "afterthought modest wear vs dedicated modest sanctuary",
      },
      productTruthCapabilities: capabilities,
    });

    expect(verdict.verdict).toBe("ACCEPTED");
    expect(verdict.operationalClaims).toHaveLength(2);
    expect(verdict.operationalClaims[0].role).toBe("EXISTING_FACTUAL_CLAIM");
    expect(verdict.operationalClaims[1].role).toBe("STRATEGIC_SYNTHESIS");
  });

  it("2. Overrides ACCEPTED to REJECTED if an unverified existing factual claim is present", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "ACCEPTED", // Model was overly lenient
              positioningRoleVerdict: "VALID",
              factualPostureVerdict: "UNSUPPORTED",
              differentiationAlignmentVerdict: "ALIGNED",
              painLaneAlignmentVerdict: "ALIGNED",
              reason: "Candidate includes unverified physical attribute",
              fix: "Remove unverified cooling nano-channel claims",
              operationalClaims: [
                {
                  claim: "Woven with cooling nano-channels for thermal regulation",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: null, // unsupported!
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgePositioningFactualPosture({
      candidate: {
        name: "Thermal Regulation Modesty",
        narrativeDirection: "Woven with cooling nano-channels for thermal regulation in high summer.",
        enemyDefinition: "Heavy, suffocating polyester dresses.",
        contrastAxis: "suffocating fabrics vs thermal regulated dresses",
      },
      productTruthCapabilities: capabilities,
    });

    // Code must safeguard and flip verdict to REJECTED
    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED");
  });
});
