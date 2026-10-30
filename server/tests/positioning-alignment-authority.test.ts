import { describe, it, expect } from "vitest";
import { layer5_segmentPriorityResolution } from "../positioning-engine/engine";

describe("Positioning Alignment Authority & Lineage Integrity", () => {
  const mockAudience = {
    audienceSegments: JSON.stringify([
      {
        id: "seg_1",
        name: "Modest Summer Dress Seekers",
        painProfile: ["Pre-atomicity compound pain text A about budget and fabrics"],
      },
      {
        id: "seg_2",
        name: "Sizing and Fit Consumers",
        painProfile: ["Pre-atomicity compound pain text B about sizing"],
      },
      {
        id: "seg_3",
        name: "Quality and Reliability Seekers",
        painProfile: [
          "Received garments that are cheaply made, see-through, or poor quality; and experienced poor or unresponsive customer service when addressing order and refund issues",
        ],
      },
    ]),
    segmentDensity: JSON.stringify([
      { segment: "Quality and Reliability Seekers", densityScore: 80 },
      { segment: "Modest Summer Dress Seekers", densityScore: 50 },
      { segment: "Sizing and Fit Consumers", densityScore: 30 },
    ]),
    audiencePains: JSON.stringify([
      { canonical: "Legacy text that should never be used as semantic fallback", frequency: 5 },
    ]),
  };

  it("TEST A: Atomic child has explicit segmentId lineage and succeeds without text matching", () => {
    const painRegistry = [
      {
        painId: "seg_3_pain_1_split_1",
        segmentId: "seg_3",
        canonical: "Garments are see-through or cheaply made",
        classification: "CORE_PURCHASE",
      },
    ];

    const result = layer5_segmentPriorityResolution(mockAudience, painRegistry);
    const seg3 = result.find(s => s.segment === "Quality and Reliability Seekers");
    const seg1 = result.find(s => s.segment === "Modest Summer Dress Seekers");

    expect(seg3).toBeDefined();
    expect(seg3!.painAlignment).toBe(1.0);
    expect(seg1!.painAlignment).toBe(0.0);
  });

  it("TEST B: Atomic child wording is completely different from pre-atomicity parent, alignment still succeeds via lineage", () => {
    const painRegistry = [
      {
        painId: "seg_3_pain_3_split_2",
        segmentId: "seg_3",
        canonical: "Fabric transparency issues", // completely divergent from "Received garments that are cheaply made..."
        classification: "CORE_PURCHASE",
      },
    ];

    const result = layer5_segmentPriorityResolution(mockAudience, painRegistry);
    const seg3 = result.find(s => s.segment === "Quality and Reliability Seekers");

    expect(seg3).toBeDefined();
    expect(seg3!.painAlignment).toBeGreaterThanOrEqual(0.20);
    expect(seg3!.painAlignment).toBe(1.0);
  });

  it("TEST C: Pain belongs to another segment and does not produce false alignment", () => {
    const painRegistry = [
      {
        painId: "seg_1_pain_1",
        segmentId: "seg_1",
        canonical: "Difficulty finding budget-friendly clothes",
        classification: "SUPPORTING",
      },
    ];

    const result = layer5_segmentPriorityResolution(mockAudience, painRegistry);
    const seg3 = result.find(s => s.segment === "Quality and Reliability Seekers");
    const seg1 = result.find(s => s.segment === "Modest Summer Dress Seekers");

    expect(seg1!.painAlignment).toBe(1.0);
    expect(seg3!.painAlignment).toBe(0.0);
  });

  it("TEST D: Many unrelated pains in other segments do NOT lower target segment's alignment score (local denominator)", () => {
    const painRegistry = [
      // 1 pain for seg_3
      {
        painId: "seg_3_pain_1_split_1",
        segmentId: "seg_3",
        canonical: "Garments are see-through",
        classification: "CORE_PURCHASE",
      },
      // 20 unrelated pains in other segments
      ...Array.from({ length: 20 }, (_, i) => ({
        painId: `seg_1_pain_${i + 1}`,
        segmentId: "seg_1",
        canonical: `Unrelated pain ${i + 1}`,
        classification: "SUPPORTING",
      })),
    ];

    const result = layer5_segmentPriorityResolution(mockAudience, painRegistry);
    const seg3 = result.find(s => s.segment === "Quality and Reliability Seekers");

    // Must be evaluated with segment-local denominator, not diluted to 1/21 = 0.048
    expect(seg3).toBeDefined();
    expect(seg3!.painAlignment).toBe(1.0);
    expect(seg3!.painAlignment).toBeGreaterThanOrEqual(0.20);
  });

  it("TEST E: Missing or empty authoritative painRegistry fails closed without falling back to legacy audience text", () => {
    // Empty array
    const resultEmpty = layer5_segmentPriorityResolution(mockAudience, []);
    expect(resultEmpty.every(s => s.painAlignment === 0)).toBe(true);

    // Undefined registry
    const resultUndef = layer5_segmentPriorityResolution(mockAudience, undefined);
    expect(resultUndef.every(s => s.painAlignment === 0)).toBe(true);
  });

  it("TEST F: Split children retaining parent segment lineage (via segmentIds, sourcePainId, or ID prefix) are aligned correctly", () => {
    const painRegistry = [
      {
        painId: "seg_3_pain_1_split_1",
        segmentIds: ["seg_3"],
        sourcePainId: "seg_3_pain_1",
        canonical: "Fabric quality concerns",
        classification: "CORE_PURCHASE",
      },
      {
        painId: "seg_3_pain_1_split_2",
        segmentIds: ["seg_3"],
        sourcePainId: "seg_3_pain_1",
        canonical: "Customer service responsiveness",
        classification: "SUPPORTING",
      },
    ];

    const result = layer5_segmentPriorityResolution(mockAudience, painRegistry);
    const seg3 = result.find(s => s.segment === "Quality and Reliability Seekers");

    expect(seg3).toBeDefined();
    expect(seg3!.painAlignment).toBe(1.0);
  });
});
