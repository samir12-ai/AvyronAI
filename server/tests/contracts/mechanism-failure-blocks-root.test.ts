import { describe, it, expect } from "vitest";
import { isMechanismAuthoritative } from "../../orchestrator/index";
import { assertCompleteRoot } from "../../shared/strategy-root";
import { shouldBlockDownstream } from "../../orchestrator/priority-matrix";

describe("Contract: mechanism-failure-blocks-root", () => {
  it("1. isMechanismAuthoritative rejects null, NO_DISTINCT_MECHANISM_ESTABLISHED, and missing primaryMechanism", () => {
    expect(isMechanismAuthoritative(null)).toBe(false);
    expect(isMechanismAuthoritative(undefined)).toBe(false);

    expect(isMechanismAuthoritative({
      status: "NO_DISTINCT_MECHANISM_ESTABLISHED",
      primaryMechanism: null,
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "SUCCESS",
      primaryMechanism: null,
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "COMPLETE",
      primaryMechanism: { mechanismName: "n/a" },
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "COMPLETE",
      primaryMechanism: { mechanismName: "" },
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "AXIS_REJECTED",
      primaryMechanism: { mechanismName: "Valid Name" },
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "SEMANTIC_ROLE_BLOCKED",
      primaryMechanism: { mechanismName: "Valid Name" },
    })).toBe(false);

    expect(isMechanismAuthoritative({
      status: "COMPLETE",
      primaryMechanism: {
        mechanismName: "The Curated Modest Standard",
        mechanismPromise: "Guaranteed opaque and breathable",
      },
    })).toBe(true);
  });

  it("2. assertCompleteRoot rejects null, 'n/a', and NO_DISTINCT_MECHANISM_ESTABLISHED mechanisms", () => {
    const baseInput = {
      campaignId: "camp_1",
      accountId: "acc_1",
      primaryAxis: "modest_quality",
      contrastAxisText: "sheer vs opaque",
      audienceSnapshotId: "aud_1",
      mechanismSnapshotId: "mech_1",
      approvedAudiencePains: [
        {
          painId: "p1",
          canonical: "Dresses are see through",
          classification: "CORE_PURCHASE",
          rank: 1,
          eligible: true,
          allowedUses: ["mechanism"],
          lineage: { accountId: "acc_1", audienceSnapshotId: "aud_1" },
        },
      ],
    };

    // Case A: approvedMechanism = null
    const missingNull = assertCompleteRoot({ ...baseInput, approvedMechanism: null }, "build");
    expect(missingNull).toContain("approved_mechanism");

    // Case B: approvedMechanism = "n/a"
    const missingNa = assertCompleteRoot({ ...baseInput, approvedMechanism: "n/a" }, "build");
    expect(missingNa).toContain("approved_mechanism");

    // Case C: approvedMechanism = { status: "NO_DISTINCT_MECHANISM_ESTABLISHED" }
    const missingNoDistinct = assertCompleteRoot({
      ...baseInput,
      approvedMechanism: { status: "NO_DISTINCT_MECHANISM_ESTABLISHED", primaryMechanism: null },
    }, "build");
    expect(missingNoDistinct).toContain("approved_mechanism");

    // Case D: valid approvedMechanism passes
    const missingValid = assertCompleteRoot({
      ...baseInput,
      approvedMechanism: {
        mechanismName: "The Curated Modest Standard",
        mechanismPromise: "Verified fit and fabric",
      },
    }, "build");
    expect(missingValid).not.toContain("approved_mechanism");
  });

  it("3. shouldBlockDownstream halts pipeline on MECHANISM_INCOMPLETE / BLOCKED mechanism step", () => {
    const mechanismStepResult = {
      engineId: "mechanism" as const,
      status: "BLOCKED" as const,
      blockReason: "MECHANISM_INCOMPLETE",
      output: {
        status: "NO_DISTINCT_MECHANISM_ESTABLISHED",
        primaryMechanism: null,
      },
      durationMs: 1200,
    };

    expect(shouldBlockDownstream(mechanismStepResult)).toBe(true);
  });
});
