import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import {
  validateMechanismName,
  judgeMechanismSemanticRole,
} from "../../mechanism-engine/engine";
import { validateAuthorityBoundaries } from "../../shared/authority-validator";
import { deriveValidatedCapabilities } from "../../shared/capability-registry";

describe("Contract: pain-inversion-hallucination", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const customerPain = "Dresses from online retailers are often see-through and cheaply made";

  const saraCapabilities = [
    {
      productTruthFactId: "pt_modesty",
      statement: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "pt_fabrics",
      statement: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "pt_exchange",
      statement: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
      factType: "CAPABILITY",
    },
  ];

  it("1. Rejects pain-inversion candidate that invents an opacity testing protocol in response to see-through pain", async () => {
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
              reasons: ["Mechanism asserts unverified operational testing darkroom without Product Truth capability backing"],
              failureType: "UNSUPPORTED_CAPABILITIES",
              feedback: "Ground the mechanism in verified Product Truth capabilities rather than fabricating internal testing protocols.",
              operationalClaims: [
                {
                  claim: "Sara tests all incoming dress fabrics in an opacity inspection darkroom",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    // Semantic role judge check
    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Opacity Inspection Protocol",
        description: "In response to see-through dress complaints, Sara tests all incoming dress fabrics in an opacity inspection darkroom.",
        steps: ["Receive fabric bolt", "Test light lux penetration in darkroom", "Reject bolts with <95% opacity rating"],
        logic: "Darkroom testing ensures no sheer fabrics are used in production.",
      },
      positioning: {
        primaryAxis: "modest_quality",
        contrastAxis: "see-through fast-fashion vs verified opaque modest wear",
      },
      productTruthCapabilities: saraCapabilities.map((c) => c.statement),
      accountId: "acc_sara",
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("UNSUPPORTED_CAPABILITIES");
  });

  it("2. Accepts legitimate mechanism that resolves customer pain through real capabilities without fabricating testing processes", () => {
    const validatedCaps = deriveValidatedCapabilities(null, {
      productTruthFacts: saraCapabilities as any,
    } as any);

    // Legitimate curation / silhouette standard anchored on real capabilities
    const nameCheck = validateMechanismName(
      "The Curated Modest Standard",
      "modest dresses and quality apparel",
      null,
      validatedCaps
    );
    expect(nameCheck.valid).toBe(true);

    const fabricCap = validatedCaps.find((c) => c.statement.includes("premium fabrics"));
    expect(fabricCap).toBeDefined();

    // Authority boundary check passes when citing real capability
    const authCheck = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [customerPain],
      selectedPains: [
        {
          painId: "p_sheer",
          canonical: customerPain,
          classification: "CORE_PURCHASE",
          rank: 1,
        },
      ],
      capabilities: validatedCaps,
      operationalClaims: [
        {
          claim: "Crafted with premium fabrics for modest apparel",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: fabricCap!.capabilityId,
        },
        {
          claim: "Curated collection standard ensures modest cuts and coverage",
          role: "STRATEGIC_SYNTHESIS",
          capabilityRef: null,
        },
      ],
    });

    expect(authCheck.passed).toBe(true);
    expect(authCheck.canonicalFactualClaims.length).toBe(1);
    expect(authCheck.canonicalFactualClaims[0].canonicalStatement).toContain("premium fabrics");
  });
});
