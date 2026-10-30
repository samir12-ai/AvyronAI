import { describe, it, expect } from "vitest";
import { runPositioningEngine } from "../../positioning-engine/engine";
import { runLaneGrouper } from "../../shared/lane-grouper";
import { validateAuthorityBoundaries } from "../../shared/authority-validator";

describe("Contract: One-Track Provider-Free Deterministic Execution", () => {
  it("1. Positioning Engine fails closed offline when painRegistry is missing without invoking external providers", async () => {
    const result = await runPositioningEngine(
      "acc_offline_1",
      "camp_offline_1",
      "mi_snap_1",
      "aud_snap_1",
      null,
      "job_offline_1",
      undefined,
      []
    );

    expect(result.status).toBe("MISSING_DEPENDENCY");
    expect(result.statusMessage).toContain("POSITIONING_CANONICAL_INPUT_MISSING");
  });

  it("2. Lane Grouper executes purely offline without provider dependencies", async () => {
    const lanes = await runLaneGrouper([], [], {
      accountId: "acc_offline_1",
      campaignId: "camp_offline_1",
    });

    expect(lanes).toEqual([]);
  });

  it("3. Authority Validator enforces Product Truth offline deterministically", () => {
    const result = validateAuthorityBoundaries({
      engineId: "mechanism",
      centralProblemTexts: [],
      operationalClaims: [
        {
          claim: "Unverified provider claim",
          role: "EXISTING_FACTUAL_CLAIM",
          capabilityRef: "unregistered_cap",
        },
      ],
      selectedPains: [],
      capabilities: [],
    });

    expect(result.passed).toBe(false);
    expect(result.violations[0].kind).toBe("UNSUPPORTED_CAPABILITY");
  });
});
