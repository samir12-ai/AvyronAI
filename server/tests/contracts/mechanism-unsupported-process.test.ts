import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import {
  validateMechanismName,
  judgeMechanismSemanticRole,
} from "../../mechanism-engine/engine";
import { validateAuthorityBoundaries } from "../../shared/authority-validator";
import { deriveValidatedCapabilities } from "../../shared/capability-registry";

describe("Contract: mechanism-unsupported-process", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const saraRealProductTruthFacts = [
    {
      productTruthFactId: "pt_1",
      statement: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), and LUNA SET ($40).",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "pt_2",
      statement: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "pt_3",
      statement: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
      factType: "CAPABILITY",
    },
    {
      productTruthFactId: "pt_4",
      statement: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
      factType: "CAPABILITY",
    },
  ];

  it("1. validateMechanismName validates structural hygiene only and delegates capability checks to judge", () => {
    expect(validateMechanismName("").valid).toBe(false);
    expect(validateMechanismName("Unnamed Mechanism").valid).toBe(false);
    expect(validateMechanismName("The Opacity Whitespace Positioning").valid).toBe(false);
    expect(validateMechanismName("The Curated Modest Standard").valid).toBe(true);
    expect(validateMechanismName("Curated Silhouette Architecture").valid).toBe(true);
  });

  it("2. judgeMechanismSemanticRole rejects candidate 'Opacity Validation System' asserting unsupported testing protocol", async () => {
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
              reasons: ["Mechanism asserts unverified operational process: Opacity Validation System without Product Truth backing"],
              failureType: "UNSUPPORTED_CAPABILITIES",
              feedback: "Do not invent internal testing protocols not in Product Truth.",
              operationalClaims: [
                {
                  claim: "Sara uses a 3-step opacity validation protocol to test fabric light transmission before cutting",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: null,
                },
              ],
            }),
          },
        },
      ],
    } as any);

    const capsStatements = saraRealProductTruthFacts.map((f) => f.statement);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "Opacity Validation System",
        description: "Sara uses a 3-step opacity validation protocol to test fabric light transmission before cutting.",
        steps: ["Place fabric on light table", "Measure opacity rating", "Approve only 100% non-sheer fabrics"],
        logic: "Opacity testing eliminates see-through dresses at the factory floor.",
      },
      positioning: {
        primaryAxis: "modest_quality",
        contrastAxis: "sheer see-through dresses vs guaranteed opacity",
      },
      productTruthCapabilities: capsStatements,
      accountId: "acc_sara",
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.failureType).toBe("UNSUPPORTED_CAPABILITIES");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED_FACTUAL_CLAIM");
    expect(verdict.reasons[0]).toContain("unverified operational process");
  });

  it("3. validateAuthorityBoundaries rejects operational claim for Opacity Validation without capabilityRef", () => {
    const validatedCaps = deriveValidatedCapabilities(null, {
      productTruthFacts: saraRealProductTruthFacts as any,
    } as any);

    const check = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: ["See-through dresses embarrass customers"],
      selectedPains: [],
      capabilities: validatedCaps,
      operationalClaims: [
        {
          claim: "Sara operates an internal Opacity Validation System",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
    });

    expect(check.passed).toBe(false);
    expect(check.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(check.canonicalFactualClaims.length).toBe(0);
  });
});
