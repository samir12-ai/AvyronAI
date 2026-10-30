import { describe, it, expect, vi, beforeEach } from "vitest";
import * as aiModule from "../../ai-client";
import { judgePositioningFactualPosture } from "../../positioning-engine/judge";
import { judgeMechanismSemanticRole } from "../../mechanism-engine/engine";

describe("Contract: supported-capability-composition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const verifiedProductTruth = [
    "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), and LUNA SET ($40).",
    "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
    "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
    "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
  ];

  it("1. Positioning Judge accepts clean strategic synthesis composed solely of verified facts", async () => {
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
              reason: "Clean strategic synthesis: connects verified premium fabrics and modest silhouettes at affordable $35-$40 price points against cheap disposable fashion.",
              fix: "",
              embeddedFactualPredicates: [
                {
                  predicate: "premium fabrics",
                  category: "MATERIAL_COMPOSITION",
                  isSupported: true,
                  supportedByCapability: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
                },
                {
                  predicate: "modest elegant apparel",
                  category: "OTHER",
                  isSupported: true,
                  supportedByCapability: "Products are designed to combine quality and modesty, emphasizing modest fashion suitable for customers seeking elegant apparel.",
                },
                {
                  predicate: "$35 to $40 price points",
                  category: "SKU_OR_COMMERCIAL",
                  isSupported: true,
                  supportedByCapability: "The summer dresses offering includes multiple distinct SKUs such as BONBON DRESS ($35), HAYAT SET ($40), and LUNA SET ($40).",
                },
              ],
              unsupportedPredicates: [],
              operationalClaims: [
                {
                  claim: "crafted with premium fabrics",
                  role: "EXISTING_FACTUAL_CLAIM",
                  capabilityRef: "cap_fabrics",
                },
                {
                  claim: "combines quality and modesty at accessible prices",
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
        name: "Accessible Modest Elegance",
        narrativeDirection: "Sara delivers timeless modest apparel crafted with premium fabrics at accessible $35 to $40 price points.",
        enemyDefinition: "Disposable fast-fashion brands that cut corners on modesty and fabric quality.",
        contrastAxis: "fragile fast fashion vs durable modest elegance",
      },
      productTruthCapabilities: verifiedProductTruth,
    });

    expect(verdict.verdict).toBe("ACCEPTED");
    expect(verdict.factualPostureVerdict).toBe("GROUNDED");
    expect(verdict.unsupportedPredicates).toHaveLength(0);
    expect(verdict.embeddedFactualPredicates.every((p) => p.isSupported)).toBe(true);
  });

  it("2. Mechanism Judge approves clean curation & exchange architecture grounded in verified facts", async () => {
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
              axisReason: "Aligned with contrast axis",
              reasons: ["Valid curation and satisfaction architecture grounded in verified premium fabrics and 24-hour exchange capability"],
              failureType: "NONE",
              feedback: "",
              embeddedFactualPredicates: [
                {
                  predicate: "premium fabric garments",
                  category: "MATERIAL_COMPOSITION",
                  isSupported: true,
                  supportedByCapability: "The dresses and modest clothing are crafted with premium fabrics to ensure long-lasting wear and comfort.",
                },
                {
                  predicate: "24-hour exchange service",
                  category: "OPERATIONAL_PROCESS",
                  isSupported: true,
                  supportedByCapability: "Customer orders are processed with a focus on fast delivery and 24-hour product exchange capability.",
                },
              ],
              unsupportedPredicates: [],
              operationalClaims: [
                {
                  claim: "dresses crafted with premium fabrics",
                  role: "EXISTING_FACTUAL_CLAIM",
                  supportedByCapability: "cap_fabrics",
                },
                {
                  claim: "24-hour exchange capability",
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
        name: "Curated Silhouette & Exchange Architecture",
        description: "A design and customer satisfaction framework combining curated modest silhouette cuts in premium fabrics with a 24-hour exchange capability.",
        steps: ["Curate coordinated modest dress silhouettes", "Select verified premium fabrics", "Back all orders with 24-hour exchange turnaround"],
        logic: "Curated modest cuts eliminate sizing hesitation while guaranteed 24-hour exchange provides complete purchase peace of mind.",
        mechanismAuthorityRole: "STRATEGIC_SYNTHESIS",
      },
      positioning: {
        primaryAxis: "accessible_modesty",
      },
      productTruthCapabilities: verifiedProductTruth,
    });

    expect(verdict.verdict).toBe("APPROVE");
    expect(verdict.factualPostureVerdict).toBe("FACTUALLY_GROUNDED");
    expect(verdict.unsupportedPredicates).toHaveLength(0);
    expect(verdict.embeddedFactualPredicates?.every((p) => p.isSupported)).toBe(true);
  });
});
