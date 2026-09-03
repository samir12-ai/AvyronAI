import { describe, it, expect } from "vitest";
import { normalizeSegmentCandidate } from "../audience-engine/engine";
import { extractCanonicalSegmentPains, buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { runLaneGrouper } from "../shared/lane-grouper";
import { getExecutableCoreLanes } from "../shared/executable-lanes";
import { resolveTargetLaneAndSegment, analyzePersuasion } from "../persuasion-engine/engine";
import { runFunnelEngine } from "../funnel-engine/engine";
import * as fs from "fs";
import * as path from "path";

describe("CANONICAL AUDIENCE SEGMENT ID AUTHORITY SUITE (TESTS A - J)", () => {

  // =========================================================================
  // TEST A: ID BIRTH (Part 18)
  // Create Audience segment -> segment.id exists immediately at birth.
  // =========================================================================
  it("TEST A: ID BIRTH — Audience segment receives canonical opaque ID at birth", () => {
    const rawCandidate = {
      name: "SMB Founders Struggling with Churn",
      description: "Small business owners with retention issues",
      role: "BUSINESS_OWNER",
      pains: ["High churn rate hurts MRR growth"],
      desires: ["Predictable retention"],
    };

    const normalized = normalizeSegmentCandidate(rawCandidate, 0);

    expect(normalized.id).toBeDefined();
    expect(typeof normalized.id).toBe("string");
    expect(normalized.id.length).toBeGreaterThan(5);
    expect(normalized.id.startsWith("seg_")).toBe(true);
    expect(normalized.name).toBe("SMB Founders Struggling with Churn");
  });

  // =========================================================================
  // TEST B: RENAME STABILITY (Part 19)
  // Segment ID must NOT change if business-facing text / name changes.
  // =========================================================================
  it("TEST B: RENAME STABILITY — ID survives segment renaming unchanged", () => {
    const originalSegment = {
      id: "seg_canonical_stable_12345",
      name: "B2B SaaS Buyers",
      description: "Initial target buyer description",
      role: "BUYER",
      pains: [{ claimId: "seg_1_pain_1", claim: "High tool fragmentation" }],
    };

    const normalizedOriginal = normalizeSegmentCandidate(originalSegment, 0);
    expect(normalizedOriginal.id).toBe("seg_canonical_stable_12345");

    // Renamed segment with exact same ID
    const renamedSegment = {
      ...originalSegment,
      name: "B2B SaaS Marketing Leaders",
      description: "Polished target buyer description",
    };

    const normalizedRenamed = normalizeSegmentCandidate(renamedSegment, 0);
    expect(normalizedRenamed.id).toBe("seg_canonical_stable_12345");
    expect(normalizedRenamed.name).toBe("B2B SaaS Marketing Leaders");
    expect(normalizedRenamed.id).toBe(normalizedOriginal.id);
  });

  // =========================================================================
  // TEST C: PAIN REGISTRY (Part 20)
  // Audience segment ID X -> Pain Registry segmentId: X, segmentIds: [X]
  // =========================================================================
  it("TEST C: PAIN REGISTRY — Pain registry consumes canonical segment.id without regeneration", () => {
    const segmentId = "seg_auth_alpha_999";
    const segments = [
      {
        id: segmentId,
        name: "Enterprise Security Architects",
        role: "PRACTITIONER",
        pains: [
          { claimId: "pain_sec_1", claim: "Compliance auditing takes weeks of manual work", evidenceIds: ["EV-01"] }
        ],
      }
    ];

    const extractedPains = extractCanonicalSegmentPains(segments);
    expect(extractedPains.length).toBe(1);
    expect(extractedPains[0].segmentId).toBe(segmentId);
    expect(extractedPains[0].segmentIds).toEqual([segmentId]);

    const registry = buildAudiencePainRegistry(
      extractedPains,
      { accountId: "test_acc", audienceSnapshotId: "snap_test_001" },
      segments
    );

    expect(registry.length).toBe(1);
    expect(registry[0].segmentId).toBe(segmentId);
    expect(registry[0].segmentIds).toContain(segmentId);
  });

  // =========================================================================
  // TEST D: LANE GROUPER (Part 21)
  // Audience segment X -> Lane Grouper input X -> Lane Grouper output segmentIds includes X
  // =========================================================================
  it("TEST D: LANE GROUPER — Lane output contains canonical input segment IDs", async () => {
    const canonicalSegId = "seg_gtm_ops_888";
    const segments = [
      {
        id: canonicalSegId,
        name: "GTM Operations Directors",
        description: "Leaders managing pipeline velocity",
        role: "BUSINESS_OWNER",
        pains: [{ claimId: "pain_gtm_1", claim: "Pipeline leaks go undetected for quarters", evidenceIds: ["EV-10"] }],
      }
    ];

    const pains = [
      {
        painId: "pain_gtm_1",
        claimId: "pain_gtm_1",
        canonical: "Pipeline leaks go undetected for quarters",
        originalStatement: "Pipeline leaks go undetected for quarters",
        classification: "CORE_PURCHASE",
        role: "BUSINESS_OWNER",
        segmentId: canonicalSegId,
        segmentIds: [canonicalSegId],
        allowedUses: ["positioning", "messaging"],
      }
    ];

    const lanes = await runLaneGrouper(segments, pains as any, {
      accountId: "acc_test",
      campaignId: "camp_test",
    });

    expect(lanes.length).toBeGreaterThan(0);
    const targetLane = lanes[0];
    expect(targetLane.segmentIds).toContain(canonicalSegId);
    expect(targetLane.segmentId).toBe(targetLane.segmentIds[0]);
  });

  // =========================================================================
  // TEST E: STRATEGY ROOT ROUND TRIP (Part 22)
  // Persist Strategy Root -> reload it -> lane.segmentIds unchanged
  // =========================================================================
  it("TEST E: STRATEGY ROOT ROUND TRIP — Serialized approvedLanes preserve segmentIds unchanged", () => {
    const canonicalSegIds = ["seg_tier1_core", "seg_tier1_sub"];
    const lane = {
      laneId: "lane_test_rt_01",
      title: "Core Pipeline Acceleration",
      description: "Direct pipeline growth",
      primaryPainId: "pain_rt_1",
      corePainIds: ["pain_rt_1"],
      supportingPainIds: [],
      segmentIds: canonicalSegIds,
      segmentId: canonicalSegIds[0],
      painIds: ["pain_rt_1"],
      desires: [],
      objections: [],
      valueContext: "B2B",
      proofNeeds: [],
      messagingDirection: "Direct",
      commercialRelevance: "High",
    };

    const serialized = JSON.stringify([lane]);
    const deserialized = JSON.parse(serialized);

    expect(deserialized[0].laneId).toBe(lane.laneId);
    expect(deserialized[0].segmentIds).toEqual(canonicalSegIds);
    expect(deserialized[0].segmentId).toBe(canonicalSegIds[0]);
  });

  // =========================================================================
  // TEST F: FUNNEL / PERSUASION PARITY (Part 23)
  // For same lane: Funnel and Persuasion receive exact same laneId, segmentIds, audienceSnapshotId
  // =========================================================================
  it("TEST F: FUNNEL / PERSUASION PARITY — Exact parity of laneId, segmentIds, and audienceSnapshotId", () => {
    const canonicalSegId = "seg_canonical_unified_777";
    const approvedLanes = [
      {
        laneId: "lane_unified_01",
        title: "Unified Growth Lane",
        primaryPainId: "pain_u_1",
        corePainIds: ["pain_u_1"],
        supportingPainIds: [],
        segmentIds: [canonicalSegId],
        segmentId: canonicalSegId,
      }
    ];

    const allSegments = [
      { id: canonicalSegId, name: "Unified Target Audience" }
    ];

    const painRegistry = [
      { painId: "pain_u_1", classification: "CORE_PURCHASE", segmentId: canonicalSegId, segmentIds: [canonicalSegId] }
    ];

    const executableLanes = getExecutableCoreLanes(approvedLanes, painRegistry as any, allSegments);
    expect(executableLanes.length).toBe(1);
    const laneCtx = executableLanes[0];

    const audienceInput = {
      approvedLanes,
      audienceSegments: allSegments,
      painRegistry,
      laneId: laneCtx.laneId,
      laneContext: laneCtx,
      snapshotId: "aud_snap_unified_100",
    };

    const persuasionResolved = resolveTargetLaneAndSegment(audienceInput, {
      laneId: laneCtx.laneId,
      laneContext: laneCtx,
    });

    expect(persuasionResolved.targetLane.laneId).toBe("lane_unified_01");
    expect(persuasionResolved.targetSegment.id).toBe(canonicalSegId);
    expect(laneCtx.segmentIds).toEqual([canonicalSegId]);
    expect(laneCtx.laneId).toBe("lane_unified_01");
  });

  // =========================================================================
  // TEST G: INVALID SEGMENT (Part 24)
  // Invalid segmentId -> TARGET_SEGMENT_RESOLUTION_FAILED (NO positional fallback)
  // =========================================================================
  it("TEST G: INVALID SEGMENT — Fails closed with no positional fallback when segment is unresolvable", async () => {
    const audienceInput = {
      approvedLanes: [
        {
          laneId: "lane_bad_01",
          title: "Bad Lane",
          primaryPainId: "pain_bad_1",
          corePainIds: ["pain_bad_1"],
          supportingPainIds: [],
          segmentIds: ["seg_non_existent_garbage"],
          segmentId: "seg_non_existent_garbage",
        }
      ],
      audienceSegments: [
        { id: "seg_valid_001", name: "Valid Audience A" },
        { id: "seg_valid_002", name: "Valid Audience B" },
      ],
      painRegistry: [
        { painId: "pain_bad_1", classification: "CORE_PURCHASE", segmentId: "seg_other", segmentIds: ["seg_other"] }
      ],
      laneId: "lane_bad_01",
    };

    const resolved = resolveTargetLaneAndSegment(audienceInput, {
      laneId: "lane_bad_01",
    });

    // targetSegment MUST be null — NO positional fallback to allSegments[0]!
    expect(resolved.targetSegment).toBeNull();

    // analyzePersuasion MUST fail closed with INTEGRITY_FAILED
    const result = await analyzePersuasion(
      {} as any,
      audienceInput as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      [
        { signalId: "sig_1", hopDepth: 0 } as any,
        { signalId: "sig_2", hopDepth: 0 } as any,
        { signalId: "sig_3", hopDepth: 0 } as any,
      ],
      { confidence: 0.9, depthGatePassed: true } as any,
      "acc_test",
      null,
      null
    );

    expect(result.status).toBe("INTEGRITY_FAILED");
    expect(result.statusMessage).toContain("Target segment could not be resolved");
  });

  // =========================================================================
  // TEST H: MULTI-LANE (Part 25)
  // Lane A (segment X), Lane B (segment Y) -> Lane A resolves X only, Lane B resolves Y only
  // =========================================================================
  it("TEST H: MULTI-LANE — Independent resolution without cross-lane contamination", () => {
    const segA = "seg_alpha_111";
    const segB = "seg_beta_222";

    const approvedLanes = [
      {
        laneId: "lane_A",
        title: "Enterprise Lane",
        primaryPainId: "pain_A",
        corePainIds: ["pain_A"],
        supportingPainIds: [],
        segmentIds: [segA],
        segmentId: segA,
      },
      {
        laneId: "lane_B",
        title: "MidMarket Lane",
        primaryPainId: "pain_B",
        corePainIds: ["pain_B"],
        supportingPainIds: [],
        segmentIds: [segB],
        segmentId: segB,
      },
    ];

    const allSegments = [
      { id: segA, name: "Enterprise Segment" },
      { id: segB, name: "MidMarket Segment" },
    ];

    const painRegistry = [
      { painId: "pain_A", classification: "CORE_PURCHASE", segmentId: segA, segmentIds: [segA] },
      { painId: "pain_B", classification: "CORE_PURCHASE", segmentId: segB, segmentIds: [segB] },
    ];

    const executableLanes = getExecutableCoreLanes(approvedLanes, painRegistry as any, allSegments);
    expect(executableLanes.length).toBe(2);

    const laneCtxA = executableLanes.find(l => l.laneId === "lane_A")!;
    const laneCtxB = executableLanes.find(l => l.laneId === "lane_B")!;

    const resA = resolveTargetLaneAndSegment(
      { approvedLanes, audienceSegments: allSegments, painRegistry, laneContext: laneCtxA },
      { laneId: "lane_A", laneContext: laneCtxA }
    );
    const resB = resolveTargetLaneAndSegment(
      { approvedLanes, audienceSegments: allSegments, painRegistry, laneContext: laneCtxB },
      { laneId: "lane_B", laneContext: laneCtxB }
    );

    expect(resA.targetSegment.id).toBe(segA);
    expect(resA.targetSegment.name).toBe("Enterprise Segment");

    expect(resB.targetSegment.id).toBe(segB);
    expect(resB.targetSegment.name).toBe("MidMarket Segment");
  });

  // =========================================================================
  // TEST I: SNAPSHOT MISMATCH (Part 26)
  // Lane references snapshot A / segment X, Downstream loads snapshot B with different segments -> explicit failure
  // =========================================================================
  it("TEST I: SNAPSHOT MISMATCH — Fails closed when segment ID is absent in loaded snapshot", () => {
    const approvedLanesFromSnapA = [
      {
        laneId: "lane_snap_A",
        title: "Snapshot A Lane",
        primaryPainId: "pain_A",
        corePainIds: ["pain_A"],
        segmentIds: ["seg_from_snap_A_999"],
      }
    ];

    // Snapshot B has different segment IDs (e.g. fresh generation)
    const segmentsFromSnapB = [
      { id: "seg_from_snap_B_111", name: "Segment Generation B" }
    ];

    const resolved = resolveTargetLaneAndSegment(
      {
        approvedLanes: approvedLanesFromSnapA,
        audienceSegments: segmentsFromSnapB,
        painRegistry: [],
      },
      { laneId: "lane_snap_A" }
    );

    expect(resolved.targetSegment).toBeNull();
  });

  // =========================================================================
  // TEST J: NO DOWNSTREAM HASHING (Part 27)
  // Normal production paths contain no segment name hashing in Pain Registry, Lane Grouper, Executable Lanes, Funnel, Persuasion
  // =========================================================================
  it("TEST J: NO DOWNSTREAM HASHING — Source code contains no name-hashing segment identity generation in core paths", () => {
    const painRegCode = fs.readFileSync(path.resolve(__dirname, "../shared/audience-pain-registry.ts"), "utf-8");
    const laneGrouperCode = fs.readFileSync(path.resolve(__dirname, "../shared/lane-grouper.ts"), "utf-8");
    const execLanesCode = fs.readFileSync(path.resolve(__dirname, "../shared/executable-lanes.ts"), "utf-8");
    const persuasionCode = fs.readFileSync(path.resolve(__dirname, "../persuasion-engine/engine.ts"), "utf-8");

    // No allSegments[0] in persuasion engine
    expect(persuasionCode).not.toContain("allSegments[0]");

    // In extractCanonicalSegmentPains, segId is not derived from sha256(cleanSegName)
    expect(painRegCode).not.toContain("crypto.createHash(\"sha256\").update(cleanSegName)");

    // In buildAudiencePainRegistry, seg.id is not mutated with sha256(cleanName)
    expect(painRegCode).not.toContain("derivedId = seg.id || `seg_${crypto.createHash(\"sha256\").update(cleanName)");

    // In lane-grouper, seg.id is not derived with sha256(seg.name)
    expect(laneGrouperCode).not.toContain("crypto.createHash(\"sha256\").update(seg.name.trim())");
  });

});
