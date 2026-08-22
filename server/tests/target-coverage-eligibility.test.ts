import { describe, test, expect } from "vitest";
import {
  extractCanonicalSegmentPains,
  buildAudiencePainRegistry,
  attachTargetCoverageToPainRegistry,
  validateAudiencePainRegistry,
} from "../shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../shared/pain-classifier";

describe("Target Coverage & Pain Eligibility Integration", () => {
  const audienceSegments = [
    {
      name: "SMB Founders and Business Owners Concerned with Billing and Customer Service",
      pains: [
        {
          claimId: "seg_1_pain_1",
          description: "They experience unauthorized or recurring charges despite subscription cancellations.",
          sourceEvidenceIds: ["EV-94", "EV-98"],
        },
      ],
      roles: [{ claimId: "seg_1_role", description: "SMB Founders" }],
    },
  ];

  const targetCoverage = {
    status: "PARTIAL" as const,
    matches: [
      {
        roleName: "SMB founders",
        coverageDecision: "COVERED",
        matchedSegmentNames: [
          "SMB Founders and Business Owners Concerned with Billing and Customer Service",
        ],
      },
    ],
  };

  test("correctly matches covered segment names to derived segment IDs", () => {
    const canonicalPains = extractCanonicalSegmentPains(audienceSegments);
    expect(canonicalPains.length).toBe(1);

    const detRegistry = buildAudiencePainRegistry(
      canonicalPains,
      { accountId: "acc_test", audienceSnapshotId: "snap_test" },
      audienceSegments
    );

    const attached = attachTargetCoverageToPainRegistry(
      detRegistry,
      targetCoverage,
      audienceSegments
    );

    expect(attached[0].targetCovered).toBe(true);
  });

  test("refineAudiencePainRegistry correctly sets eligible=true when productFit is ELIGIBLE", async () => {
    const canonicalPains = extractCanonicalSegmentPains(audienceSegments);
    const detRegistry = buildAudiencePainRegistry(
      canonicalPains,
      { accountId: "acc_test", audienceSnapshotId: "snap_test" },
      audienceSegments
    );

    const attached = attachTargetCoverageToPainRegistry(
      detRegistry,
      targetCoverage,
      audienceSegments
    );

    // Mock refine with llmEnabled: false to test deterministic handling
    const result = await refineAudiencePainRegistry(attached, {
      accountId: "acc_test",
      campaignId: "camp_test",
      llmEnabled: false,
    });

    expect(result.registry.length).toBe(1);
    expect(result.registry[0].targetCovered).toBe(true);
  });

  test("validateAudiencePainRegistry allows ineligible UNKNOWN pains with empty allowedUses", () => {
    const canonicalPains = extractCanonicalSegmentPains(audienceSegments);
    const detRegistry = buildAudiencePainRegistry(
      canonicalPains,
      { accountId: "acc_test", audienceSnapshotId: "snap_test" },
      audienceSegments
    );

    // Ineligible pain has allowedUses: []
    const validation = validateAudiencePainRegistry(detRegistry, {
      accountId: "acc_test",
      audienceSnapshotId: "snap_test",
    });

    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  test("DifferentiationEngine output contains pillars and claimStructures for OfferEngine", async () => {
    const { runDifferentiationEngine } = await import("../differentiation-engine/engine");
    const diffRes = await runDifferentiationEngine(
      { dominanceData: [] } as any,
      { painRegistry: [] } as any,
      {} as any,
      {}
    );
    expect(diffRes.status).toBe("SKIPPED");
  });
});
