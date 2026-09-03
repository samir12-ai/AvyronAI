import { describe, expect, it } from "vitest";
import fs from "fs";
import { buildAudiencePainRegistry, type AuthoritativeAudiencePain } from "../shared/audience-pain-registry";
import { runLaneGrouper } from "../shared/lane-grouper";
import { assembleStrategyRootInput } from "../shared/strategy-root-assembler";
import { assertCompleteRoot } from "../shared/strategy-root";

describe("Architecture Freeze Guard", () => {
  const lineage = { accountId: "acc_freeze_test", audienceSnapshotId: "aud_snap_freeze_test" };

  // Test A: Neutral Registry
  it("Test A: Neutral Registry — initial registry must NOT output CORE or early permissions for any pain", () => {
    const rawPains = [
      { canonical: "Issues with refunds and returns including delays, refusals, and complicated processes causing customer frustration" },
      { canonical: "Difficulty finding breathable modest dresses that are also modern and stylish" },
    ];

    const registry = buildAudiencePainRegistry(rawPains, lineage);

    expect(registry.length).toBe(2);
    for (const pain of registry) {
      expect(pain.classification).toBe("NOT_EVALUATED");
      expect(pain.productFit).toBe("UNKNOWN");
      expect(pain.eligible).toBe(false);
      expect(pain.allowedUses).toEqual([]);
      expect(pain.classifierVersion).toBe("initial_neutral_registry");
    }
  });

  // Test B: UNKNOWN Cannot Promote
  it("Test B: UNKNOWN Cannot Promote — productFit=UNKNOWN must never produce eligible=true or allowed uses", () => {
    const registry = buildAudiencePainRegistry(
      [{ canonical: "High pricing concerns for wholesale orders", productFit: "UNKNOWN" }],
      lineage
    );

    const pain = registry[0];
    expect(pain.productFit).toBe("UNKNOWN");
    expect(pain.eligible).toBe(false);
    expect(pain.allowedUses).toEqual([]);
    expect(pain.classification).not.toBe("CORE_PURCHASE");
    expect(pain.classification).not.toBe("SUPPORTING");
  });

  // Test C: No Legacy Classifier in Production Call Path
  it("Test C: No Legacy Classifier in Production Path — orchestrator and strategy-root do not call legacy regex classifiers", () => {
    const orchCode = fs.readFileSync("server/orchestrator/index.ts", "utf8");
    const stratRootCode = fs.readFileSync("server/shared/strategy-root-assembler.ts", "utf8");
    const painClassifierCode = fs.readFileSync("server/shared/pain-classifier.ts", "utf8");

    expect(orchCode).not.toContain("classifyAudiencePainDetailed");
    expect(orchCode).not.toContain("classifyAudiencePain(");
    expect(stratRootCode).not.toContain("classifyAudiencePainDetailed");
    expect(stratRootCode).not.toContain("classifyAudiencePain(");
    expect(painClassifierCode).not.toContain("classifyAudiencePainDetailed");
  });

  // Test D: SPD Required For CORE
  it("Test D: SPD Required For CORE — unrefined pains without SPD lineage cannot qualify as CORE or SUPPORTING", () => {
    const unrefinedRegistry = buildAudiencePainRegistry(
      [{ canonical: "Procurement logistics delays and supply chain opacity" }],
      lineage
    );

    expect(unrefinedRegistry[0].strategicPainDecisionAuthorityId).toBeUndefined();
    expect(unrefinedRegistry[0].classification).toBe("NOT_EVALUATED");
    expect(unrefinedRegistry[0].eligible).toBe(false);
  });

  // Test E: Permissions Require SPD
  it("Test E: Permissions Require SPD — no strategic permissions granted before final strategic decision", () => {
    const rawPains = [
      { canonical: "Quality and fit inconsistencies" },
      { canonical: "Price and proof concerns" },
    ];
    const registry = buildAudiencePainRegistry(rawPains, lineage);

    expect(registry.every((p) => p.allowedUses.length === 0)).toBe(true);
    expect(registry.every((p) => p.prohibitedUses.length > 0)).toBe(true);
  });

  // Test F: Strategy Root Cannot Rebuild Authority
  it("Test F: Strategy Root Cannot Rebuild Authority — missing refined Pain Registry produces fail-closed INCOMPLETE", async () => {
    const baseInput = {
      campaignId: "camp_freeze",
      accountId: "acc_freeze_test",
      audienceSnapshotId: "aud_snap_freeze_test",
      miSnapshotId: "mi_snap_1",
      positioningSnapshotId: "pos_snap_1",
      differentiationSnapshotId: "diff_snap_1",
      mechanismSnapshotId: "mech_snap_1",
      primaryAxis: "Reliability",
      contrastAxisText: "Cheap vs Reliable",
      approvedMechanism: { id: "mech_1" },
      audienceOverride: {
        audiencePains: [{ canonical: "Raw unrefined pain" }],
        desireMap: {},
        objectionMap: {},
        emotionalDrivers: [],
      },
      sortedClaims: [],
      audienceObjections: [],
      proofTypes: [],
      positioningContext: {},
      brandSpine: { id: "spine_1" },
      approvedLanes: [],
      // painRegistry is deliberately omitted / null
    };

    const assembled = await assembleStrategyRootInput(baseInput as any);
    const missing = assertCompleteRoot(assembled, "build");
    expect(missing).toContain("approved_audience_pains");
  });

  // Test G: Lane Authority
  it("Test G: Lane Authority — unrefined or neutral pains cannot become approved strategic lanes", async () => {
    const neutralRegistry = buildAudiencePainRegistry(
      [
        { canonical: "Issues with refunds and returns" },
        { canonical: "Difficulty finding stylish modest dresses" },
      ],
      lineage
    );

    const lanes = await runLaneGrouper(neutralRegistry, [
      { id: "seg_1", name: "Modest Shoppers", role: "BUYER", segmentDefinition: "Shoppers looking for modest fashion" }
    ]);

    expect(lanes).toEqual([]);
  });
});
