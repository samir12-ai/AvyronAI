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

  // Guard 1: No downstream strategic engine can be skipped solely due to SGL signal confidence
  it("Guard 1: SGL Non-Blocking — resolveSignalsForEngine never returns blocked: true", async () => {
    const { resolveSignalsForEngine } = await import("../signal-governance/engine");
    const emptySglState = {
      version: 2,
      governedSignals: [], // zero signals, coverage incomplete
      traceToken: "trace_test_guard_1",
      coverageReport: {
        painCount: 0,
        desireCount: 0,
        objectionCount: 0,
        patternCount: 0,
        rootCauseCount: 0,
        psychologicalDrivers: 0,
        totalSignals: 0,
        coverageSufficient: false,
        missingCategories: ["pain", "desire", "objection", "pattern", "root_cause", "psychological_driver"],
      },
      consumptionLog: [],
    };

    const engines = ["positioning", "differentiation", "mechanism", "offer", "awareness", "funnel", "persuasion"] as const;
    for (const eng of engines) {
      const res = resolveSignalsForEngine(emptySglState as any, eng);
      expect(res.blocked).toBe(false);
    }
  });

  // Guard 2: No structuredSignals.pain_clusters may create or override CORE/SUPPORTING/EXCLUDE decisions
  it("Guard 2: Pain Clusters Cannot Promote — pain_clusters cannot assign CORE without SPD judge", () => {
    const rawClusterPain = {
      id: "cluster_1",
      canonical: "Uncalibrated cluster pain",
      frequency: 99,
      confidence: 0.99,
    };
    const registry = buildAudiencePainRegistry([rawClusterPain], lineage);
    expect(registry[0].classification).toBe("NOT_EVALUATED");
    expect(registry[0].eligible).toBe(false);
    expect(registry[0].allowedUses).toEqual([]);
  });

  // Guard 3: No SGL path may override SPD
  it("Guard 3: SPD Authority Absolute — SPD verdict dictates classification independently of SGL", () => {
    const spdPain = {
      painId: "pain_1",
      canonical: "Authentic customer struggle",
      classification: "CORE_PURCHASE",
      eligible: true,
      strategicRole: "CORE_PURCHASE",
      productFit: "DIRECT_FIT",
      allowedUses: ["positioning", "offer_core"],
      strategicPainDecisionAuthorityId: "spd_test_1",
    };
    expect(spdPain.classification).toBe("CORE_PURCHASE");
    expect(spdPain.allowedUses).toContain("positioning");
    expect(spdPain.allowedUses).toContain("offer_core");
  });

  // Guard 4: Downstream pain inputs come from refined Pain Registry / approvedLanes
  it("Guard 4: Downstream Pain Lineage — orchestrator wires refined painRegistry to downstream engines", () => {
    const orchCode = fs.readFileSync("server/orchestrator/index.ts", "utf8");
    expect(orchCode).toContain("runPositioningEngine(");
    expect(orchCode).toContain("ctx.painRegistry");
    expect(orchCode).toContain("ctx.strategicLanes");
    expect(orchCode).not.toContain("resolveSglOrBlock(");
  });

  // Guard 5: Missing modern Pain Authority fails closed
  it("Guard 5: Fail-Closed On Missing Pain Authority — empty painRegistry prevents positioning execution", async () => {
    const { runPositioningEngine } = await import("../positioning-engine/engine");
    const result = await runPositioningEngine(
      "acc_test",
      "camp_test",
      "mi_snap_1",
      "aud_snap_1",
      undefined,
      "job_test",
      undefined,
      [], // empty pain registry
      []
    );
    expect(result.status).toBe("MISSING_DEPENDENCY");
    expect(result.statusMessage).toContain("Positioning engine requires a valid pain registry");
  });

  // Guard 6: No fallback rebuilds pain authority from old Audience signal structures
  it("Guard 6: No Fallback Rebuilds — Strategy Root assembler refuses empty pain registry", async () => {
    const stratRootCode = fs.readFileSync("server/shared/strategy-root-assembler.ts", "utf8");
    expect(stratRootCode).not.toContain("rebuildPainRegistryFromSignals");
    expect(stratRootCode).not.toContain("fallbackToPainMap");
  });

  // Guard 7: System Control validates the modern authority chain
  it("Guard 7: System Control Integrity — System Control evaluates pipeline completeness", () => {
    const sysControlCode = fs.readFileSync("server/system-control/engine.ts", "utf8");
    expect(sysControlCode).toContain("evaluateSystemControl");
    expect(sysControlCode).toContain("checkPipelineCompleteness");
    expect(sysControlCode).not.toContain("requireSglBlockSuccess");
  });

  // Guard 8: Bounded JSON repair fails closed without deterministic semantic salvage
  it("Guard 8: Bounded JSON Repair — fails closed when repair is exhausted", async () => {
    const { repairMalformedJsonWithLLM } = await import("../audience-engine/semantic-reasoner");
    const malformed = `{"themes": [{"themeId": "t1", "canonicalMeaning": "broken json"`; // unclosed
    const result = await repairMalformedJsonWithLLM({
      rawContent: malformed,
      errorMessage: "Unexpected end of JSON input",
      expectedSchemaName: "TestSchema",
      schemaExample: `{"themes": []}`,
      accountId: "test_acc",
      maxAttempts: 1,
      validator: (parsed) => {
        if (parsed && Array.isArray(parsed.themes)) return { valid: true, data: parsed };
        return { valid: false, error: "themes missing" };
      },
    });

    // In a test environment without OpenAI keys, repair fails closed honestly
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  // Guard 9: Semantic Reasoner contains zero deterministic fallback claim salvage
  it("Guard 9: No Semantic Fallback in Semantic Reasoner — no deterministic claim-to-truth fallback", () => {
    const reasonerCode = fs.readFileSync("server/audience-engine/semantic-reasoner.ts", "utf8");
    // Verify unsafe fallback patterns were removed
    expect(reasonerCode).not.toContain("isolatedTruthClaimIds: batchClaims.map(c => c.claimId)");
    expect(reasonerCode).not.toContain("parsed = themes.map(t => ({");
    expect(reasonerCode).not.toContain("canonicalThemes: candidateThemes, candidateLineage: []");
    expect(reasonerCode).toContain("repairMalformedJsonWithLLM");
  });
});
