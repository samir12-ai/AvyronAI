import { describe, it, expect } from "vitest";
import { validateAuthorityBoundaries } from "../../shared/authority-validator";
import type { ValidatedCapability } from "../../shared/capability-registry";

describe("Contract: Unsupported Operational Claim Gate (Factual Claim Grounding)", () => {
  const canonicalCapabilities: ValidatedCapability[] = [
    {
      capabilityId: "cap_fabric_100",
      statement: "Garments are tailored from 100% long-staple organic cotton with reinforced double stitching.",
      sourceFactId: "fact_cotton_truth_1",
      factType: "CAPABILITY",
    },
    {
      capabilityId: "cap_exchange_policy",
      statement: "Complimentary 30-day domestic exchanges on unworn merchandise.",
      sourceFactId: "fact_exchange_truth_2",
      factType: "CAPABILITY",
    },
  ];

  it("1. Rejects persistence of unsupported operational claim prose when attached to an unrelated valid capabilityRef", () => {
    const rawHallucinatedClaim = "Proprietary supersonic nano-weave reflects 99% of infrared thermal energy.";
    
    const result = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: rawHallucinatedClaim,
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: "cap_fabric_100",
        },
      ],
      selectedPains: [],
      capabilities: canonicalCapabilities,
    });

    expect(result.passed).toBe(true);
    expect(result.canonicalFactualClaims?.length).toBe(1);

    const canonicalClaim = result.canonicalFactualClaims![0];
    expect(canonicalClaim.canonicalStatement).toBe(canonicalCapabilities[0].statement);
    expect(canonicalClaim.canonicalStatement).not.toContain("supersonic");
    expect(canonicalClaim.canonicalStatement).not.toContain("nano-weave");
    expect(canonicalClaim.canonicalStatement).not.toContain("infrared");
    expect(canonicalClaim.sourceFactId).toBe("fact_cotton_truth_1");
    expect(canonicalClaim.capabilityRef).toBe("cap_fabric_100");
  });

  it("2. Fails closed when an operational claim cites an invented capabilityRef not in Product Truth", () => {
    const result = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Proprietary molecular chilling weave.",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: "cap_invented_999",
        },
      ],
      selectedPains: [],
      capabilities: canonicalCapabilities,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(result.canonicalFactualClaims?.length).toBe(0);
  });

  it("3. Fails closed when an EXISTING_FACTUAL_CLAIM provides no capabilityRef", () => {
    const result = validateAuthorityBoundaries({
      engineId: "offer",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Ships worldwide in 2 hours.",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: null,
        },
      ],
      selectedPains: [],
      capabilities: canonicalCapabilities,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.kind === "UNSUPPORTED_CAPABILITY")).toBe(true);
    expect(result.canonicalFactualClaims?.length).toBe(0);
  });
});
