import { describe, it, expect, vi, beforeEach } from "vitest";
import { hydrateRequiredUpstreamForResume } from "../../orchestrator/resume-hydration";
import { assembleStrategyRootInput } from "../../shared/strategy-root-assembler";
import { assertCompleteRoot } from "../../shared/strategy-root";
import { db } from "../../db";
import {
  audienceSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  miSnapshots,
  aelSnapshots,
  strategicPainDecisions,
  targetAssessments,
  productAssessments,
} from "@shared/schema";
import { getTableName } from "drizzle-orm";

vi.mock("../../shared/lane-grouper", () => ({
  runLaneGrouper: vi.fn().mockResolvedValue([
    {
      laneId: "lane_core_1",
      title: "Automated Onboarding Acceleration",
      primaryPainId: "pain_1",
      supportingPainIds: [],
      segmentIds: ["seg_1"],
      confidence: 0.95,
    },
  ]),
}));

describe("Contract: Official Resume Hydration Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const getTable = (t: any) => {
    if (t === audienceSnapshots) return "audience_snapshots";
    if (t === positioningSnapshots) return "positioning_snapshots";
    if (t === differentiationSnapshots) return "differentiation_snapshots";
    if (t === miSnapshots) return "mi_snapshots";
    if (t === aelSnapshots) return "ael_snapshots";
    if (t === strategicPainDecisions) return "strategic_pain_decisions";
    if (t === targetAssessments) return "target_assessments";
    if (t === productAssessments) return "product_assessments";
    try {
      return getTableName(t);
    } catch {
      return t?.name || t?._?.name;
    }
  };

  const accountId = "acc_resume_test_1";
  const campaignId = "camp_resume_test_1";

  const mockAudienceRow = {
    id: "aud_snap_1",
    accountId,
    campaignId,
    audienceSegments: JSON.stringify([
      {
        id: "seg_1",
        name: "Enterprise Buyer",
        pains: [
          {
            claimId: "pain_1",
            painId: "pain_1",
            description: "High onboarding churn due to complexity",
          },
        ],
      },
    ]),
    structuredSignals: JSON.stringify({
      pain_clusters: [
        {
          label: "High onboarding churn due to complexity",
          confidence: 0.9,
          evidence: ["churn metrics"],
        },
      ],
      desire_clusters: [],
      pattern_clusters: [],
      root_causes: [],
      psychological_drivers: [],
    }),
    targetCoverage: JSON.stringify({
      status: "COVERED",
      evaluations: [{ painId: "pain_1", decision: "COVERED" }],
    }),
    audiencePains: "[]",
    desireMap: "[]",
    objectionMap: "[]",
    transformationMap: "[]",
    emotionalDrivers: "[]",
    segmentDensity: "[]",
    awarenessLevel: "{}",
    maturityIndex: "{}",
    audienceIntentDistribution: "{}",
    inputSummary: "{}",
  };

  const mockDiffRow = {
    id: "diff_snap_1",
    accountId,
    campaignId,
    status: "COMPLETE",
    audienceSnapshotId: "aud_snap_1",
    differentiationPillars: JSON.stringify([
      {
        pillarName: "One-Click Automated Ingestion",
        evidence: ["Proven 90% setup reduction"],
      },
    ]),
    claimStructures: JSON.stringify([]),
    proofArchitecture: JSON.stringify([]),
    inputHash: "hash_diff_1",
  };

  const mockPosRow = {
    id: "pos_snap_1",
    accountId,
    campaignId,
    status: "COMPLETE",
    audienceSnapshotId: "aud_snap_1",
    contrastAxis: "Legacy manual overhead vs Zero-touch automation",
    territory: JSON.stringify({ name: "Self-Driving Infrastructure" }),
    territories: JSON.stringify([]),
    differentiationVector: JSON.stringify([]),
    proofSignals: JSON.stringify([]),
    strategyCards: JSON.stringify([]),
    inputHash: "hash_pos_1",
  };

  const mockMiRow = {
    id: "mi_snap_1",
    accountId,
    campaignId,
    status: "COMPLETE",
    signalData: "[]",
    multiSourceSignals: "{}",
    telemetry: JSON.stringify({ contentHash: "hash_mi_1" }),
  };

  const mockSpdRows = [
    {
      accountId,
      campaignId,
      painId: "pain_1",
      finalClassification: "CORE_PURCHASE",
      strategicPainDecisionAuthorityId: "spd_auth_1",
      reason: "High strategic materiality and direct purchase trigger",
    },
  ];

  const mockTaRows = [
    {
      accountId,
      campaignId,
      painId: "pain_1",
      decision: "COVERED",
      targetAssessmentAuthorityId: "ta_auth_1",
    },
  ];

  const mockPaRows = [
    {
      accountId,
      campaignId,
      painId: "pain_1",
      fitType: "DIRECT_FIT",
      productAssessmentAuthorityId: "pa_auth_1",
      payload: JSON.stringify({ reason: "Direct feature match" }),
    },
  ];

  const mockAelRow = {
    id: "ael_snap_1",
    accountId,
    campaignId,
    package: JSON.stringify({ summary: "mock enrichment" }),
  };

  function setupDbSelectMock(overrides?: {
    omitAudience?: boolean;
    omitDiff?: boolean;
    omitPos?: boolean;
    omitMi?: boolean;
  }) {
    vi.spyOn(db, "select").mockImplementation((() => ({
      from: (table: any) => {
        const tableName = getTable(table);
        const getRows = () => {
          if (tableName === "audience_snapshots") {
            return overrides?.omitAudience ? [] : [mockAudienceRow];
          }
          if (tableName === "differentiation_snapshots") {
            return overrides?.omitDiff ? [] : [mockDiffRow];
          }
          if (tableName === "positioning_snapshots") {
            return overrides?.omitPos ? [] : [mockPosRow];
          }
          if (tableName === "mi_snapshots") {
            return overrides?.omitMi ? [] : [mockMiRow];
          }
          if (tableName === "ael_snapshots") {
            return [mockAelRow];
          }
          if (tableName === "strategic_pain_decisions") {
            return mockSpdRows;
          }
          if (tableName === "target_assessments") {
            return mockTaRows;
          }
          if (tableName === "product_assessments") {
            return mockPaRows;
          }
          return [];
        };

        const createQueryChain = () => ({
          orderBy: () => ({
            limit: (n: number) => Promise.resolve(getRows().slice(0, n)),
            then: (onFulfilled: any, onRejected: any) =>
              Promise.resolve(getRows()).then(onFulfilled, onRejected),
          }),
          limit: (n: number) => Promise.resolve(getRows().slice(0, n)),
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve(getRows()).then(onFulfilled, onRejected),
        });

        return {
          where: () => createQueryChain(),
        };
      },
    })) as any);
  }

  it("1. Successfully hydrates audience, painRegistry, strategicLanes, differentiation, and positioning for resume at mechanism", async () => {
    setupDbSelectMock();

    const ctx: any = {};
    const result = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "mechanism",
      accountId,
      campaignId,
      jobId: "job_resume_test_1",
      ctx,
    });

    expect(result.gaps).toEqual([]);
    expect(result.hydrated).toContain("audience");
    expect(result.hydrated).toContain("pain_registry");
    expect(result.hydrated).toContain("strategic_lanes");
    expect(result.hydrated).toContain("differentiation");
    expect(result.hydrated).toContain("positioning");

    // Lineage and integrity checks
    expect(ctx.audienceSnapshotId).toBe("aud_snap_1");
    expect(ctx.differentiationSnapshotId).toBe("diff_snap_1");
    expect(ctx.positioningSnapshotId).toBe("pos_snap_1");
    expect(ctx.painRegistry).toBeDefined();
    expect(ctx.painRegistry.length).toBe(1);

    const pain = ctx.painRegistry[0];
    expect(pain.painId).toBe("pain_1");
    expect(pain.classification).toBe("CORE_PURCHASE");
    expect(pain.eligible).toBe(true);
    expect(pain.lineage).toEqual({
      accountId,
      audienceSnapshotId: "aud_snap_1",
    });

    // Strategic lanes check
    expect(ctx.strategicLanes).toBeDefined();
    expect(ctx.strategicLanes.length).toBeGreaterThan(0);

    // StrategyRoot Pre-build Contract Check: 0 missing fields
    const simulatedMechResult = {
      status: "COMPLETE",
      primaryMechanism: {
        mechanismName: "Zero-Touch Pipeline Ingestion Engine",
        mechanismType: "proprietary_process",
        mechanismPromise: "Eliminate 90% onboarding churn through automated ingestion",
        axisAlignment: {
          primaryAxis: "Zero-touch automation",
        },
      },
    };

    const rootInput = await assembleStrategyRootInput({
      campaignId,
      accountId,
      jobId: "job_resume_test_1",
      miSnapshotId: "mi_snap_1",
      audienceSnapshotId: ctx.audienceSnapshotId,
      positioningSnapshotId: ctx.positioningSnapshotId,
      differentiationSnapshotId: ctx.differentiationSnapshotId,
      mechanismSnapshotId: "mech_snap_simulated_1",
      mechanismResult: simulatedMechResult,
      positioningSnapshot: ctx.positioning,
      differentiationContext: ctx.differentiation,
      audienceOverride: ctx.audience,
      painRegistry: ctx.painRegistry,
      approvedLanes: ctx.strategicLanes,
    });

    const missing = assertCompleteRoot(rootInput, "build");
    expect(missing).toEqual([]);
  });

  it("2. Fails closed and reports gaps when upstream audience snapshot is missing", async () => {
    setupDbSelectMock({ omitAudience: true });

    const ctx: any = {};
    const result = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "mechanism",
      accountId,
      campaignId,
      jobId: "job_resume_test_gap_1",
      ctx,
    });

    expect(result.gaps).toContain("audience");
    expect(ctx.audience).toBeUndefined();
  });

  it("3. Fails closed and reports gaps when upstream positioning snapshot is missing", async () => {
    setupDbSelectMock({ omitPos: true });

    const ctx: any = {};
    const result = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "mechanism",
      accountId,
      campaignId,
      jobId: "job_resume_test_gap_2",
      ctx,
    });

    expect(result.gaps).toContain("positioning");
    expect(ctx.positioning).toBeUndefined();
  });

  it("4. Fails closed and reports gaps when upstream differentiation snapshot is missing", async () => {
    setupDbSelectMock({ omitDiff: true });

    const ctx: any = {};
    const result = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "mechanism",
      accountId,
      campaignId,
      jobId: "job_resume_test_gap_3",
      ctx,
    });

    expect(result.gaps).toContain("differentiation");
    expect(ctx.differentiation).toBeUndefined();
  });

  it("5. Verifies resume hydration executes purely offline via DB with zero scraper calls", async () => {
    setupDbSelectMock();

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const ctx: any = {};
    const result = await hydrateRequiredUpstreamForResume({
      resumeFromEngine: "mechanism",
      accountId,
      campaignId,
      jobId: "job_resume_test_pure_offline",
      ctx,
    });

    expect(result.gaps).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
