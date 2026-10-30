import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";

describe("Contract: positioning-role-boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const verifiedCaps = [
    "Products are designed to combine quality and modesty, emphasizing modest fashion.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear.",
  ];

  it("1. Rejects positioning candidate that acts as marketing communication advice", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REJECTED",
              positioningRoleVerdict: "INVALID",
              factualPostureVerdict: "GROUNDED",
              differentiationAlignmentVerdict: "ALIGNED",
              painLaneAlignmentVerdict: "ALIGNED",
              reason: "Candidate prescribes social media advertising tactics rather than defining strategic market positioning",
              fix: "Define the strategic territory (WHERE to compete) rather than ad copy tips.",
              operationalClaims: [],
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgePositioningFactualPosture({
      candidate: {
        name: "Social Ad Campaign Strategy",
        narrativeDirection: "Run 15-second TikTok video ads targeting college students with discount codes.",
        enemyDefinition: "Competitors who don't run retargeting ads on Instagram.",
        contrastAxis: "low ad spend vs optimized media buying",
      },
      productTruthCapabilities: verifiedCaps,
    });

    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.positioningRoleVerdict).toBe("INVALID");
  });

  it("2. Rejects positioning candidate that is an invented operational mechanism rather than positioning", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "REJECTED",
              positioningRoleVerdict: "INVALID",
              factualPostureVerdict: "UNSUPPORTED",
              differentiationAlignmentVerdict: "ALIGNED",
              painLaneAlignmentVerdict: "ALIGNED",
              reason: "Candidate specifies an operational fabric inspection protocol instead of market territory",
              fix: "Move operational workflows to Mechanism Engine; Positioning must articulate WHERE to compete.",
              operationalClaims: [
                {
                  claim: "3-stage fabric spectrometer audit workflow",
                  role: "EXISTING_FACTUAL_CLAIM",
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
        name: "Fabric Spectrometer Audit Workflow",
        narrativeDirection: "Our positioning is defined by our 3-stage fabric spectrometer audit workflow at the warehouse.",
        enemyDefinition: "Brands without optical density testing machinery.",
        contrastAxis: "untested fabrics vs spectrometer verified fabrics",
      },
      productTruthCapabilities: verifiedCaps,
    });

    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.positioningRoleVerdict).toBe("INVALID");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED");
  });
});
