import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: strategic-synthesis-factual-predicate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const realProductTruth = [
    "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
  ];

  it("1. Positioning Judge rejects STRATEGIC_SYNTHESIS containing unsupported embedded factual predicates", async () => {
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
              reason: "Candidate asserts unsupported physical attributes: 'natural breathable fabrics' not established in Product Truth",
              fix: "Remove unverified 'natural' and 'breathable' material predicates. Ground strictly in verified 'premium fabrics'.",
              embeddedFactualPredicates: [
                {
                  predicate: "premium natural fabrics",
                  category: "MATERIAL_COMPOSITION",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Product Truth establishes 'premium fabrics', not natural fiber composition",
                },
                {
                  predicate: "breathable fabric airflow",
                  category: "PHYSICAL_PERFORMANCE",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Breathability performance is not documented in Product Truth",
                },
              ],
              unsupportedPredicates: ["premium natural fabrics", "breathable fabric airflow"],
              operationalClaims: [
                {
                  claim: "crafted from premium natural fabrics with breathable fabric airflow",
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
        name: "Natural Breathable Modesty",
        narrativeDirection: "Sara delivers summer dresses crafted from premium natural fabrics with breathable fabric airflow.",
        enemyDefinition: "Synthetic fast fashion that traps summer heat.",
        contrastAxis: "synthetic stifling clothes vs natural breathable dresses",
      },
      productTruthCapabilities: realProductTruth,
    });

    expect(verdict.verdict).toBe("REJECTED");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED");
    expect(verdict.unsupportedPredicates).toContain("premium natural fabrics");
    expect(verdict.unsupportedPredicates).toContain("breathable fabric airflow");
  });

  it("2. Mechanism Judge rejects STRATEGIC_SYNTHESIS containing unsupported physical performance predicates", async () => {
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
              reasons: ["Mechanism asserts unverified physical performance: 'guaranteed opacity' and 'cooling linen weave'"],
              failureType: "UNSUPPORTED_CAPABILITIES",
              feedback: "Remove unverified cooling and opacity guarantees. Rely on verified premium fabric and styling.",
              embeddedFactualPredicates: [
                {
                  predicate: "cooling linen weave",
                  category: "MATERIAL_COMPOSITION",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Linen weave is not in Product Truth",
                },
                {
                  predicate: "guaranteed fabric opacity",
                  category: "PHYSICAL_PERFORMANCE",
                  isSupported: false,
                  supportedByCapability: null,
                  reasonIfNotSupported: "Opacity guarantee is unverified",
                },
              ],
              unsupportedPredicates: ["cooling linen weave", "guaranteed fabric opacity"],
              operationalClaims: [
                {
                  claim: "cooling linen weave with guaranteed fabric opacity",
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
        name: "Layered Cooling Architecture",
        description: "A curation framework using cooling linen weave with guaranteed fabric opacity for modest summer wear.",
        steps: ["Select cooling linen weave", "Ensure guaranteed fabric opacity", "Package coordinate set"],
        logic: "Natural linen ensures heat dissipation while structured weave prevents sheer transparency.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: {
        primaryAxis: "breathable_modesty",
      },
      productTruthCapabilities: realProductTruth,
    });

    expect(verdict.verdict).toBe("REPAIR");
    expect(verdict.factualPostureVerdict).toBe("UNSUPPORTED_FACTUAL_CLAIM");
    expect(verdict.failureType).toBe("UNSUPPORTED_CAPABILITIES");
    expect(verdict.unsupportedPredicates).toContain("cooling linen weave");
    expect(verdict.unsupportedPredicates).toContain("guaranteed fabric opacity");
  });
});
