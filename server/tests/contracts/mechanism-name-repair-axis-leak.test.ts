import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeRepairedMechanismName,
  validateMechanismName,
  judgeMechanismSemanticRole,
} from "../../mechanism-engine/engine";
import * as aiModule from "../../ai-client";

describe("Contract: mechanism-name-repair-axis-leak", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. sanitizeRepairedMechanismName strips 'Whitespace_Positioning' and axis labels from repaired names", () => {
    expect(
      sanitizeRepairedMechanismName("The Opacity Qualification Whitespace_Positioning", "whitespace_positioning")
    ).toBe("The Opacity Qualification");

    expect(
      sanitizeRepairedMechanismName("The Opacity Fabric Validation whitespace positioning", "whitespace_positioning")
    ).toBe("The Opacity Fabric Validation");

    expect(
      sanitizeRepairedMechanismName("The Curation Protocol Positioning Framework", "simplicity")
    ).toBe("The Curation Protocol");

    expect(
      sanitizeRepairedMechanismName('"The Fit Qualification Protocol Whitespace"', "whitespace_positioning")
    ).toBe("The Fit Qualification Protocol");
  });

  it("2. validateMechanismName rejects names contaminated with positioning or whitespace terminology", () => {
    const contaminated1 = validateMechanismName("The Opacity Qualification Whitespace_Positioning");
    expect(contaminated1.valid).toBe(false);
    expect(contaminated1.reason).toContain("positioning strategy terminology");

    const contaminated2 = validateMechanismName("The Modest Curation Whitespace");
    expect(contaminated2.valid).toBe(false);
    expect(contaminated2.reason).toContain("positioning strategy terminology");

    // Cleaned sanitized version passes name validation
    const clean = validateMechanismName("The Curated Modest Standard");
    expect(clean.valid).toBe(true);
  });

  it("3. Hostile Semantic Role Judge does not reject clean sanitized names for POSITIONING_REWRITTEN", async () => {
    vi.spyOn(aiModule, "aiChat").mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "APPROVE",
              axisVerdict: "ALIGNED",
              axisReason: "Operational curation standard delivers on contrast axis",
              reasons: ["Operational curation HOW cleanly separates from positioning"],
              failureType: "NONE",
              operationalClaims: [],
              feedback: "",
            }),
          },
        },
      ],
    } as any);

    const verdict = await judgeMechanismSemanticRole({
      candidate: {
        name: "The Curated Modest Standard",
        description: "Standardized multi-point vetting and curation for dress fit and fabric density.",
        steps: ["Review fabric opacity and density", "Standardize silhouette coverage", "Release curated collection"],
        logic: "Curation standard ensures zero sheer garments reach the customer.",
      },
      positioning: {
        primaryAxis: "whitespace_positioning",
        contrastAxis: "sheer fast-fashion vs curated opaque modesty",
      },
      productTruthCapabilities: ["Products are designed to combine quality and modesty."],
      accountId: "acc_test",
    });

    expect(verdict.failureType).not.toBe("POSITIONING_REWRITTEN");
    expect(verdict.verdict).toBe("APPROVE");
  });
});
