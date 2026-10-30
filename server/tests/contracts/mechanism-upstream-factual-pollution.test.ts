import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: mechanism-upstream-factual-pollution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const verifiedProductTruth = [
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
  ];

  const upstreamPollutedPositioning = {
    primaryAxis: "modest_quality",
    contrastAxis: "sheer disposable dresses vs guaranteed opaque apparel",
    enemyDefinition: "Disposable fast-fashion brands that cut corners on fabric opacity and curation standards.",
  };

  it("1. Rejects mechanism candidate that adopted unverified operational QA claims from upstream Positioning", async () => {
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
              reasons: ["Candidate adopted unverified operational curation and opacity assurance standards from Positioning. Product Truth establishes no QA testing workflow."],
              failureType: "UNSUPPORTED_CAPABILITIES",
              feedback: "Remove unverified opacity assurance and curation testing protocols. Ground in verified exchange and styling.",
              embeddedFactualPredicates: [
                {
                  predicate: "curation standards and opacity testing protocol",
                  category: "OPERATIONAL_PROCESS",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "No curation or opacity testing protocol documented in Product Truth",
                },
              ],
              unsupportedPredicates: ["curation standards and opacity testing protocol"],
              operationalClaims: [
                {
                  claim: "curation standards and opacity testing protocol",
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
        name: "Fabric Curation & Opacity Assurance Protocol",
        description: "An operational curation standard and opacity testing protocol verifying fabric density before release.",
        steps: ["Inspect fabric density", "Filter against opacity standards", "Dispatch verified modest garments"],
        logic: "Strict curation and testing standards guarantee garments are completely non-sheer.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: upstreamPollutedPositioning,
      productTruthCapabilities: verifiedProductTruth,
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED_FACTUAL_CLAIM");
    expect(verdict.failureType).toBe("UNSUPPORTED_CAPABILITIES");
    expect(verdict.unsupportedPredicates).toContain("curation standards and opacity testing protocol");
  });
});
