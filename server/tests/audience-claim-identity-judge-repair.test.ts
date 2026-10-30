import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as aiClient from "../ai-client";
import { db } from "../db";
import {
  constructSegments,
  applyGroupingRepairDeterministically,
  reconcileAndValidateSegmentCandidates,
  buildSegmentClaimManifest,
  validateAndNormalizeJudgeBatchVerdicts,
  buildAudienceFailureAttribution,
  getRecentAudienceJudgeDiagnostics,
  clearAudienceJudgeDiagnosticsForTest,
  getLatestAudienceSnapshot,
} from "../audience-engine/engine";
import { extractCanonicalSegmentPains } from "../shared/audience-pain-registry";
import { executeEngine, buildSectionStatusEntry } from "../orchestrator/index";
import { enrichRecoveryPlan } from "../system-control/recovery-intelligence";
import { buildRecoveryPlan } from "../system-control/recovery-planner";
import { StrategyExperienceService } from "../strategy-experience/service";
import { assembleAudiencePositioningData } from "../audience-positioning-service";
import { LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";

const wrapAiChatContent = (payload: unknown) =>
  ({
    choices: [
      {
        message: {
          content: typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      },
    ],
    usage: { promptTokens: 80, completionTokens: 80, totalTokens: 160 },
  }) as any;

const extractBatchAllowedClaimIdsFromJudgePrompt = (promptText: string): string[] => {
  const m = promptText.match(/CURRENT CLAIM MANIFEST BATCH \((\[[\s\S]*?\])\)\./);
  if (m?.[1]) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }
  const blockMatch = promptText.match(
    /CURRENT CLAIM MANIFEST BATCH \(Evaluate exactly these IDs\):\s*(\[[\s\S]*?\])\s*CANONICAL BUSINESS & TARGET CONTEXT:/
  );
  if (blockMatch?.[1]) {
    try {
      const arr = JSON.parse(blockMatch[1]);
      if (Array.isArray(arr)) return arr.map((x: any) => String(x.claimId));
    } catch {
      // fall through
    }
  }
  return [];
};

describe("Audience Claim Identity, Judge Validation, Diagnostics, and Failure Attribution (Cases A–M + Integration)", () => {
  let dbInsertSpy: ReturnType<typeof vi.spyOn>;
  let dbUpdateSpy: ReturnType<typeof vi.spyOn>;
  let dbDeleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearAudienceJudgeDiagnosticsForTest();

    // Enforce zero shared-database mutations across every test in this file
    dbInsertSpy = vi.spyOn(db, "insert" as any).mockImplementation(() => {
      throw new Error("FORBIDDEN_SHARED_DB_MUTATION: db.insert must not be called in offline isolation tests");
    });
    dbUpdateSpy = vi.spyOn(db, "update" as any).mockImplementation(() => {
      throw new Error("FORBIDDEN_SHARED_DB_MUTATION: db.update must not be called in offline isolation tests");
    });
    dbDeleteSpy = vi.spyOn(db, "delete" as any).mockImplementation(() => {
      throw new Error("FORBIDDEN_SHARED_DB_MUTATION: db.delete must not be called in offline isolation tests");
    });

    // Default read-only DB mock so no test touches PostgreSQL
    vi.spyOn(db, "select" as any).mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }));
    vi.spyOn(db, "execute" as any).mockImplementation(async () => ({ rows: [] }));
  });

  afterEach(() => {
    expect(dbInsertSpy).not.toHaveBeenCalled();
    expect(dbUpdateSpy).not.toHaveBeenCalled();
    expect(dbDeleteSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  /**
   * Reconstructed 14 discovered pains modeled on the audited Baklawati 400g incident
   * (disc_pain_1..14, where disc_pain_14 was misplaced into objections and disc_pain_4 was omitted).
   */
  const buildDiscoveredPains14 = () =>
    Array.from({ length: 14 }, (_, idx) => {
      const n = idx + 1;
      const text =
        n === 4
          ? "Gift box presentation lacks individual piece labeling for corporate recipients"
          : n === 14
          ? "Pastry corners arrive crushed when courier parcels are stacked in transit"
          : `Discovered customer pain statement #${n} regarding Baklawati 400g selection`;
      return {
        claimId: `disc_pain_${n}`,
        id: `disc_pain_${n}`,
        claim: text,
        pain: text,
        evidenceIds: [`ev_${n}`],
        frequency: 2,
        category: "Customer Experience",
        isDirectCustomerLanguage: true,
        businessRelevance: "HIGH" as const,
        relevanceReason: "Directly impacts repeat gifting orders",
      };
    });

  const buildEvidenceUnits14 = () =>
    Array.from({ length: 14 }, (_, idx) => {
      const n = idx + 1;
      return {
        id: `ev_${n}`,
        sourceType: "customer_review" as const,
        sourceActor: "REVIEWER",
        platform: "google_reviews",
        text:
          n === 4
            ? "We sent the 400g box to clients and wished each piece had a small flavor guide."
            : n === 14
            ? "The baklava tasted great, though the corners were crushed in courier shipping."
            : `Verified customer review #${n} describing experience with 400g pastry box.`,
        specificityScore: 0.9,
        recencyScore: 0.9,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE" as const,
        originType: "customer" as const,
      };
    });

  it("Case A & Case B (Idempotence) — Audited Misplacement Reproduction: restores disc_pain_14 from objections to pains, inserts disc_pain_4, eliminates 17-entry/16-unique collision, is idempotent when applied twice, and succeeds on attempt 2", async () => {
    const discoveredPains = buildDiscoveredPains14();
    const evidenceUnits = buildEvidenceUnits14();

    // Historical incident shape (Attempt 1 proposer output):
    // - 12 discovered pains in pains (disc_pain_1..3, disc_pain_5..13)
    // - disc_pain_14 misplaced in objections
    // - disc_pain_4 omitted altogether
    // Note: normalizeSegmentCandidate also creates seg_1_def and seg_1_role (2 items).
    // In the buggy pre-fix code, pushing disc_pain_4 and disc_pain_14 into pains without
    // removing disc_pain_14 from objections produced:
    //   2 (seg_1_def, seg_1_role) + 14 (pains) + 1 (misplaced disc_pain_14 in objections) = 17 entries with 16 unique IDs.
    const attempt1Segments = [
      {
        id: "seg_1",
        name: "Gifting & Hospitality Buyers",
        role: "BUYER",
        description: "Buyers purchasing Baklawati 400g boxes for corporate and family gifting",
        pains: discoveredPains
          .filter((p) => p.claimId !== "disc_pain_4" && p.claimId !== "disc_pain_14")
          .map((p) => ({
            claimId: p.claimId,
            claim: p.claim,
            evidenceIds: p.evidenceIds,
          })),
        desires: [],
        objections: [
          // Misplaced discovered pain disc_pain_14 placed in objections instead of pains!
          {
            claimId: "disc_pain_14",
            claim: discoveredPains[13].claim,
            evidenceIds: ["ev_14"],
          },
        ],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1"],
      },
    ];

    const repairAssignments = [
      { claimId: "disc_pain_4", assignToSegmentIndex: 0 },
      { claimId: "disc_pain_14", assignToSegmentIndex: 0 },
    ];

    // Apply deterministic repair once and twice (Case B: idempotence)
    const repairedOnce = applyGroupingRepairDeterministically(
      attempt1Segments,
      repairAssignments,
      discoveredPains
    );
    const repairedTwice = applyGroupingRepairDeterministically(
      repairedOnce.segments,
      repairAssignments,
      discoveredPains
    );
    expect(repairedTwice.segments).toEqual(repairedOnce.segments);

    const seg0 = repairedOnce.segments[0];
    expect(seg0.pains).toHaveLength(14);
    expect(seg0.pains.map((p: any) => p.claimId)).toContain("disc_pain_4");
    expect(seg0.pains.map((p: any) => p.claimId)).toContain("disc_pain_14");
    expect(seg0.objections.map((o: any) => o.claimId)).not.toContain("disc_pain_14");
    expect(seg0.objections).toHaveLength(0);

    // Verify manifest after repair has exactly 16 entries (seg_1_def, seg_1_role, and 14 pains) with 16 unique keys
    const postRepairValidation = reconcileAndValidateSegmentCandidates(repairedOnce.segments, discoveredPains);
    expect(postRepairValidation.valid).toBe(true);
    const postRepairManifest = buildSegmentClaimManifest(postRepairValidation.segments);
    expect(postRepairManifest).toHaveLength(16);
    expect(new Set(postRepairManifest.map((m) => m.evaluationKey)).size).toBe(16);

    // Now verify full constructSegments execution with mocked LLM boundaries
    const judgeBatchKeyCounts: number[] = [];
    const aiSpy = vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      const promptText = opts.messages.map((m: any) => m.content).join("\n");

      if (opts.endpoint === "audience-engine-v3-segments") {
        // Attempt 1 proposer returns the misplaced/incomplete segmentation
        // Note: reconcileAndValidateSegmentCandidates deterministically restores misplaced disc_pain_14
        // during pre-Judge validation and flags only disc_pain_4 as missing in GROUPING_INCOMPLETE!
        return wrapAiChatContent({ segments: attempt1Segments });
      }

      if (opts.endpoint === "audience-engine-v3-grouping-repair") {
        expect(promptText).toContain("disc_pain_4");
        return wrapAiChatContent({ assignments: repairAssignments });
      }

      if (opts.endpoint === "audience-engine-v3-judge") {
        const batchKeys = extractBatchAllowedClaimIdsFromJudgePrompt(promptText);
        expect(batchKeys.length).toBeGreaterThan(0);
        // Ensure the Judge NEVER receives duplicate evaluation keys in any batch
        expect(new Set(batchKeys).size).toBe(batchKeys.length);
        judgeBatchKeyCounts.push(batchKeys.length);

        return wrapAiChatContent({
          verdicts: batchKeys.map((id) => ({
            claimId: id,
            status: "VALID",
          })),
        });
      }

      if (opts.endpoint === "audience-engine-v3-pain-consolidation") {
        // Keep all 14 atomic pains unmerged
        return wrapAiChatContent({ canonicalPains: [] });
      }

      return wrapAiChatContent({});
    });

    const segments = await constructSegments(
      [],
      [],
      [],
      [],
      { level: "developing", score: 0.6 } as any,
      { level: "solution_aware", score: 0.7 } as any,
      {
        industry: "Consumer Packaged Goods — Gourmet Sweets",
        coreOffer: "Baklawati 400g Assorted Pistachio Baklava Gift Box",
        targetAudience: "Gifting & Hospitality Buyers",
      },
      evidenceUnits as any,
      "tenant_synth_test",
      "snap_mi_case_a",
      {
        jobId: "run_case_a",
        campaignId: "camp_synth_a",
        doctrine: { campaignOfferingId: "off_synth_400g" },
      } as any,
      undefined,
      discoveredPains
    );

    expect(aiSpy).toHaveBeenCalled();
    expect(segments).toHaveLength(1);
    expect(segments[0].pains).toHaveLength(14);
    expect(segments[0].objections).toHaveLength(0);
    // 16 unique evaluation items split across Batch 0 (15 items) and Batch 1 (1 item)
    expect(judgeBatchKeyCounts).toEqual([15, 1]);

    const diags = getRecentAudienceJudgeDiagnostics("run_case_a");
    expect(diags).toHaveLength(2);
    for (const d of diags) {
      expect(d.validationOutcome).toBe("VALID_PASS");
      expect(d.duplicateKeys).toHaveLength(0);
    }

    // Repaired-success orchestration verification: verify that once Audience succeeds with the repaired segments,
    // the orchestrator advances to the next stage (differentiation) without upstream priority/cascade blocking.
    const repairedResultsMap = new Map<any, any>([
      [
        "market_intelligence",
        {
          engineId: "market_intelligence",
          status: "SUCCESS",
          snapshotId: "snap_mi_case_a",
          output: { status: "COMPLETE", competitors: [{ name: "Comp A" }] },
          durationMs: 100,
        },
      ],
      [
        "market_voice",
        {
          engineId: "market_voice",
          status: "SUCCESS",
          output: { status: "COMPLETE", approvedEvidenceIds: evidenceUnits.map((u) => u.id) },
          durationMs: 100,
        },
      ],
      [
        "audience",
        {
          engineId: "audience",
          status: "SUCCESS",
          snapshotId: "snap_aud_case_a_repaired",
          output: {
            status: "COMPLETE",
            snapshotId: "snap_aud_case_a_repaired",
            audienceSegments: segments,
            painMap: segments[0].pains,
          },
          durationMs: 200,
        },
      ],
    ]);

    const audSuccessSection = buildSectionStatusEntry(
      { id: "audience", name: "Audience Engine" },
      repairedResultsMap.get("audience")
    );
    expect(audSuccessSection.status).toBe("SUCCESS");
    expect(audSuccessSection.failureCategory).toBeUndefined();

    // Calling executeEngine("differentiation", ...) with repaired Audience in resultsMap passes priority & upstream gates
    // and enters the differentiation stage (where we stop at the mocked boundary without DB writes).
    const nextStageStep = await executeEngine(
      "differentiation",
      {
        miSnapshotId: "snap_mi_case_a",
        audienceSnapshotId: "snap_aud_case_a_repaired",
        audience: { audienceSegments: segments, audiencePains: segments[0].pains },
        depthGateStatus: {},
        inputHashes: { mi: "h_mi", audience: "h_aud" },
      } as any,
      { accountId: "tenant_synth_test", campaignId: "camp_synth_a" } as any,
      repairedResultsMap,
      "run_case_a"
    );
    // It was NOT skipped by MARKET_REALITY priority violation or upstream audience block
    expect(nextStageStep.blockReason || "").not.toMatch(
      /higher-priority MARKET_REALITY layer has blocking result|Blocked by upstream failure in audience/i
    );
    // And our dbInsertSpy intercepted and blocked the downstream snapshot persistence (zero real DB writes)
    expect(dbInsertSpy.mock.results.every((r: any) => r.type === "throw")).toBe(true);
    dbInsertSpy.mockClear();
  });

  it("Case C — Legitimate Cross-Segment Pain Sharing: scopes evaluationKey per segment while preserving canonicalClaimId", () => {
    const discoveredPains = buildDiscoveredPains14().slice(0, 2);
    const validEvidenceIds = new Set(["ev_1", "ev_2"]);

    const rawSegments = [
      {
        id: "seg_1",
        name: "Corporate Gifters",
        role: "BUYER",
        description: "Corporate gifting buyers",
        pains: [
          {
            claimId: "disc_pain_1",
            claim: discoveredPains[0].claim,
            evidenceIds: ["ev_1"],
          },
        ],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1"],
      },
      {
        id: "seg_2",
        name: "Family Hosts",
        role: "END_CONSUMER",
        description: "Family hospitality buyers",
        pains: [
          {
            claimId: "disc_pain_1",
            claim: discoveredPains[0].claim,
            evidenceIds: ["ev_1"],
          },
          {
            claimId: "disc_pain_2",
            claim: discoveredPains[1].claim,
            evidenceIds: ["ev_2"],
          },
        ],
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1", "ev_2"],
      },
    ];

    const validation = reconcileAndValidateSegmentCandidates(rawSegments, discoveredPains, validEvidenceIds);
    expect(validation.valid).toBe(true);

    const { manifest } = buildSegmentClaimManifest(validation.segments);
    const allEvalKeys = manifest.map((m) => m.evaluationKey);
    expect(new Set(allEvalKeys).size).toBe(allEvalKeys.length);

    const painItems = manifest.filter((m) => m.claimType === "pains");
    expect(painItems.map((m) => m.evaluationKey)).toEqual([
      "seg_1::disc_pain_1",
      "seg_2::disc_pain_1",
      "disc_pain_2",
    ]);
    expect(painItems[0].canonicalClaimId).toBe("disc_pain_1");
    expect(painItems[1].canonicalClaimId).toBe("disc_pain_1");
    expect(painItems[2].canonicalClaimId).toBe("disc_pain_2");

    const extractedPains = extractCanonicalSegmentPains(validation.segments);
    expect(extractedPains).toHaveLength(3);
    const sharedExtracted = extractedPains.filter((p) => p.canonicalClaimId === "disc_pain_1");
    expect(sharedExtracted).toHaveLength(2);
    expect(new Set(sharedExtracted.map((p) => p.painId)).size).toBe(2);
  });

  it("Case D — Ambiguous Duplicate Input: fails pre-Judge validation with CLAIM_IDENTITY_CONFLICT before any Judge call", () => {
    const discoveredPains = buildDiscoveredPains14().slice(0, 2);
    const validEvidenceIds = new Set(["ev_1", "ev_2"]);

    const conflictingSegments = [
      {
        id: "seg_1",
        name: "Segment One",
        role: "BUYER",
        description: "Primary buyer segment",
        pains: [
          {
            claimId: "disc_pain_1",
            claim: discoveredPains[0].claim,
            evidenceIds: ["ev_1"],
          },
          {
            claimId: "disc_pain_2",
            claim: discoveredPains[1].claim,
            evidenceIds: ["ev_2"],
          },
        ],
        desires: [],
        objections: [
          // Same claimId as disc_pain_1, but different conflicting text so it is NOT an unambiguous misplaced copy
          {
            claimId: "disc_pain_1",
            claim: "Completely different objection statement reusing disc_pain_1 identifier",
            evidenceIds: ["ev_2"],
          },
        ],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1", "ev_2"],
      },
    ];

    const validation = reconcileAndValidateSegmentCandidates(
      conflictingSegments,
      discoveredPains,
      validEvidenceIds
    );
    expect(validation.valid).toBe(false);
    expect(validation.rejections[0].rejectionCode).toBe("CLAIM_IDENTITY_CONFLICT");
    expect(validation.rejections[0].offendingClaimIds).toContain("disc_pain_1");
  });

  it("Case E — Legitimate Derived Objection: preserves distinct objection derived from a pain with its own claimId and derivedFromPainId provenance", () => {
    const discoveredPains = buildDiscoveredPains14().slice(0, 2);
    const validEvidenceIds = new Set(["ev_1", "ev_2"]);

    const rawSegments = [
      {
        id: "seg_1",
        name: "Quality-Conscious Buyers",
        role: "BUYER",
        description: "Quality-conscious pastry gift buyers",
        pains: [
          {
            claimId: "disc_pain_1",
            claim: discoveredPains[0].claim,
            evidenceIds: ["ev_1"],
          },
          {
            claimId: "disc_pain_2",
            claim: discoveredPains[1].claim,
            evidenceIds: ["ev_2"],
          },
        ],
        desires: [],
        objections: [
          {
            claimId: "obj_derived_from_pain_1",
            derivedFromPainId: "disc_pain_1",
            claim: "Doubts that standard courier insurance covers crushed gift tins on arrival",
            evidenceIds: ["ev_1"],
          },
        ],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1", "ev_2"],
      },
    ];

    const validation = reconcileAndValidateSegmentCandidates(rawSegments, discoveredPains, validEvidenceIds);
    expect(validation.valid).toBe(true);
    expect(validation.segments[0].pains).toHaveLength(2);
    expect(validation.segments[0].objections).toHaveLength(1);
    expect(validation.segments[0].objections[0].claimId).toBe("obj_derived_from_pain_1");
    expect(validation.segments[0].objections[0].derivedFromPainId).toBe("disc_pain_1");

    const { manifest } = buildSegmentClaimManifest(validation.segments);
    const nonMetaKeys = manifest
      .filter((m) => m.claimType !== "segmentDefinition" && m.claimType !== "role")
      .map((m) => m.evaluationKey);
    expect(nonMetaKeys).toEqual(["disc_pain_1", "disc_pain_2", "obj_derived_from_pain_1"]);
    const derivedEntry = manifest.find((m) => m.evaluationKey === "obj_derived_from_pain_1");
    expect(derivedEntry?.derivedFromPainId).toBe("disc_pain_1");
  });

  it("Case F & Case G — Equivalent Duplicate Judge Verdicts: collapses truly equivalent duplicate verdicts across all decision-relevant fields, records anomaly, and verifies full coverage", () => {
    const batchManifest = [
      {
        claimId: "disc_pain_1",
        evaluationKey: "disc_pain_1",
        canonicalClaimId: "disc_pain_1",
        segmentId: "seg_1",
        segmentPrefix: "seg_1",
        claimType: "pains",
        text: "Pain 1",
        evidenceIds: ["ev_1"],
      },
      {
        claimId: "disc_pain_2",
        evaluationKey: "disc_pain_2",
        canonicalClaimId: "disc_pain_2",
        segmentId: "seg_1",
        segmentPrefix: "seg_1",
        claimType: "pains",
        text: "Pain 2",
        evidenceIds: ["ev_2"],
      },
    ];
    const allManifestIds = new Set(["disc_pain_1", "disc_pain_2"]);

    const rawVerdicts = [
      { claimId: "disc_pain_1", status: "APPROVED" },
      { claimId: "disc_pain_1", status: "VALID" }, // Equivalent after normalization
      { claimId: "disc_pain_2", status: "APPROVED" },
    ];

    const result = validateAndNormalizeJudgeBatchVerdicts(rawVerdicts, batchManifest, allManifestIds, 0);
    expect(result.valid).toBe(true);
    expect(result.normalizedVerdicts).toHaveLength(2);
    expect(result.collapsedEquivalentDuplicateKeys).toEqual(["disc_pain_1"]);
    expect(result.duplicateKeys).toEqual(["disc_pain_1"]);
    expect(result.missingKeys).toHaveLength(0);
  });

  it("Case H — Same-Status Non-Equivalent Duplicate Verdicts: rejects duplicates that share status UNSUPPORTED/INVALID but differ in rejectionCode, critique, or repairDirective", () => {
    const batchManifest = [
      {
        claimId: "disc_pain_1",
        evaluationKey: "disc_pain_1",
        canonicalClaimId: "disc_pain_1",
        segmentId: "seg_1",
        segmentPrefix: "seg_1",
        claimType: "pains",
        text: "Pain 1",
        evidenceIds: ["ev_1"],
      },
    ];
    const allManifestIds = new Set(["disc_pain_1"]);

    const rawVerdicts = [
      {
        claimId: "disc_pain_1",
        status: "UNSUPPORTED",
        rejectionCode: "UNSUPPORTED_CLAIM",
        critique: "Evidence ev_1 does not mention transit crushing",
        repairDirective: "Drop claim or cite review mentioning transit",
      },
      {
        claimId: "disc_pain_1",
        status: "UNSUPPORTED",
        rejectionCode: "FABRICATED_DETAIL",
        critique: "Claim invents specific percentage of broken pastries",
        repairDirective: "Remove percentage",
      },
    ];

    const result = validateAndNormalizeJudgeBatchVerdicts(rawVerdicts, batchManifest, allManifestIds, 0);
    expect(result.valid).toBe(false);
    expect(result.defectReason).toContain("SAME_STATUS_NON_EQUIVALENT_DUPLICATE");
    expect(result.duplicateKeys).toEqual(["disc_pain_1"]);
  });

  it("Case I — Contradictory, Missing (Duplicate Masking Missing), Unknown, and Wrong-Batch Verdicts: fails closed with exact defect classification", () => {
    const batch0Manifest = ["k1", "k2", "k3"].map((id) => ({
      claimId: id,
      evaluationKey: id,
      canonicalClaimId: id,
      segmentId: "seg_1",
      segmentPrefix: "seg_1",
      claimType: "pains",
      text: `Text ${id}`,
      evidenceIds: ["ev_1"],
    }));
    const allManifestIds = new Set(["k1", "k2", "k3", "k4"]);

    // 1. Contradictory duplicate (APPROVED + UNSUPPORTED for k1)
    const contradictoryRes = validateAndNormalizeJudgeBatchVerdicts(
      [
        { claimId: "k1", status: "APPROVED" },
        { claimId: "k1", status: "UNSUPPORTED", rejectionCode: "UNSUPPORTED_PAIN", critique: "Not in ev_1" },
        { claimId: "k2", status: "APPROVED" },
        { claimId: "k3", status: "APPROVED" },
      ],
      batch0Manifest,
      allManifestIds,
      0
    );
    expect(contradictoryRes.valid).toBe(false);
    expect(contradictoryRes.defectReason).toContain("CONTRADICTORY_DUPLICATE");
    expect(contradictoryRes.conflictingDuplicateKeys).toEqual(["k1"]);
    expect(contradictoryRes.normalizedVerdicts).toHaveLength(0);

    // 2. Duplicate masking missing key (3 verdicts returned for 3-item batch, but k1 is duplicated and k3 is missing)
    const missingRes = validateAndNormalizeJudgeBatchVerdicts(
      [
        { claimId: "k1", status: "APPROVED" },
        { claimId: "k1", status: "APPROVED" },
        { claimId: "k2", status: "APPROVED" },
      ],
      batch0Manifest,
      allManifestIds,
      0
    );
    expect(missingRes.valid).toBe(false);
    expect(missingRes.missingKeys).toEqual(["k3"]);
    expect(missingRes.defectReason).toContain("MISSING_EVALUATION_KEYS");

    // 3. Wrong-batch key (k4 belongs to batch 1, not batch 0)
    const wrongBatchRes = validateAndNormalizeJudgeBatchVerdicts(
      [
        { claimId: "k1", status: "APPROVED" },
        { claimId: "k2", status: "APPROVED" },
        { claimId: "k3", status: "APPROVED" },
        { claimId: "k4", status: "APPROVED" },
      ],
      batch0Manifest,
      allManifestIds,
      0
    );
    expect(wrongBatchRes.valid).toBe(false);
    expect(wrongBatchRes.wrongBatchKeys).toEqual(["k4"]);
    expect(wrongBatchRes.defectReason).toContain("WRONG_BATCH_EVALUATION_KEYS");

    // 4. Unknown invented key (k_invented_99 is not in any batch)
    const unknownKeyRes = validateAndNormalizeJudgeBatchVerdicts(
      [
        { claimId: "k1", status: "APPROVED" },
        { claimId: "k2", status: "APPROVED" },
        { claimId: "k3", status: "APPROVED" },
        { claimId: "k_invented_99", status: "APPROVED" },
      ],
      batch0Manifest,
      allManifestIds,
      0
    );
    expect(unknownKeyRes.valid).toBe(false);
    expect(unknownKeyRes.unknownKeys).toEqual(["k_invented_99"]);
    expect(unknownKeyRes.defectReason).toContain("UNKNOWN_EVALUATION_KEYS");
  });

  it("Case J & Case K — Retry Isolation & Semantic Unsupported Claim: clears batch cache when candidate changes and repairs semantic UNSUPPORTED via structural patch without misclassifying as technical failure", async () => {
    const discoveredPains = buildDiscoveredPains14().slice(0, 2);
    const evidenceUnits = buildEvidenceUnits14().slice(0, 2);

    const attempt1Segments = [
      {
        id: "seg_1",
        name: "Gourmet Buyers",
        role: "BUYER",
        description: "Gourmet pastry buyers",
        pains: [
          {
            claimId: "disc_pain_1",
            claim: discoveredPains[0].claim,
            evidenceIds: ["ev_1"],
          },
          {
            claimId: "disc_pain_2",
            claim: discoveredPains[1].claim,
            evidenceIds: ["ev_2"],
          },
        ],
        desires: [],
        objections: [
          {
            claimId: "obj_unsupported",
            claim: "Unsupported claim that customers demand sugar-free keto baklava",
            evidenceIds: ["ev_1"],
          },
        ],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1", "ev_2"],
      },
    ];

    let judgeEvaluationCount = 0;
    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      const promptText = opts.messages.map((m: any) => m.content).join("\n");

      if (opts.endpoint === "audience-engine-v3-segments") {
        return wrapAiChatContent({ segments: attempt1Segments });
      }

      if (opts.endpoint === "audience-engine-v3-judge") {
        judgeEvaluationCount++;
        const batchKeys = extractBatchAllowedClaimIdsFromJudgePrompt(promptText);
        if (judgeEvaluationCount === 1) {
          // Attempt 1 Judge: semantically rejects obj_unsupported
          return wrapAiChatContent({
            verdicts: batchKeys.map((id) =>
              id === "obj_unsupported"
                ? {
                    claimId: id,
                    status: "INVALID",
                    rejectionCode: "UNSUPPORTED_OBJECTIVE",
                    critique: "ev_1 does not mention keto or sugar-free demands",
                    repairDirective: "Replace with an objection grounded in ev_1",
                  }
                : { claimId: id, status: "VALID" }
            ),
          });
        }
        // Attempt 2 Judge: re-evaluates the updated candidate from scratch (because candidateFingerprint changed)
        return wrapAiChatContent({
          verdicts: batchKeys.map((id) => ({
            claimId: id,
            status: "VALID",
          })),
        });
      }

      if (opts.endpoint === "audience-engine-v3-segments-repair") {
        // Proposer patch replaces obj_unsupported with grounded text
        return wrapAiChatContent({
          repairs: [
            {
              claimId: "obj_unsupported",
              action: "REPLACE",
              repairedClaim: {
                claim: "Concerned about gift box freshness during multi-day delivery",
                evidenceIds: ["ev_1"],
              },
            },
          ],
        });
      }

      if (opts.endpoint === "audience-engine-v3-pain-consolidation") {
        return wrapAiChatContent({ canonicalPains: [] });
      }

      return wrapAiChatContent({});
    });

    const segments = await constructSegments(
      [],
      [],
      [],
      [],
      { level: "developing", score: 0.6 } as any,
      { level: "solution_aware", score: 0.7 } as any,
      {
        industry: "Gourmet Sweets",
        coreOffer: "Baklawati 400g",
        targetAudience: "Gourmet Buyers",
      },
      evidenceUnits as any,
      "tenant_synth_jk",
      "snap_mi_jk",
      {
        jobId: "run_case_jk",
        campaignId: "camp_synth_jk",
        doctrine: { campaignOfferingId: "off_synth_400g" },
      } as any,
      undefined,
      discoveredPains
    );

    expect(judgeEvaluationCount).toBe(2);
    expect(segments[0].objections).toHaveLength(1);
    expect(segments[0].objections[0].claim).toBe("Concerned about gift box freshness during multi-day delivery");
  });

  it("Case K (Bounded Judge Contract Repair) & Case L (Early Technical vs Exhausted Attribution): distinguishes attempt 2 of 4 halt from 4 of 4 retry exhaustion", () => {
    const earlyTechErr = new LLMReliabilityError(
      "Judge returned conflicting duplicate verdicts for disc_pain_14",
      "CONTRACT_FAILURE",
      [
        {
          rule: "JUDGE_RESPONSE_CONTRACT_FAILURE",
          claimId: "disc_pain_14",
          rejectionCode: "JUDGE_EVALUATION_DUPLICATES",
          reason: "CONTRADICTORY_DUPLICATE: [disc_pain_14]",
          offendingClaimIds: ["disc_pain_14"],
        },
      ],
      {
        engine: "AudienceEngine-V3",
        touchpoint: "segment_generation",
        attempts: 2,
        maxAttempts: 4,
        technicalRetries: 0,
        finalVerdict: "HONEST_FAIL",
        repairLog: [],
      }
    );

    const attrEarly = buildAudienceFailureAttribution(earlyTechErr, []);
    expect(attrEarly.category).toBe("JUDGE_CONTRACT_FAILURE");
    expect(attrEarly.attemptsUsed).toBe(2);
    expect(attrEarly.maxAttempts).toBe(4);
    expect(attrEarly.retryBudgetExhausted).toBe(false);
    expect(attrEarly.summary).toContain("on attempt 2 of 4");
    expect(attrEarly.summary).not.toContain("after maximum retries");

    // Contrast with a genuinely exhausted 4-of-4 failure
    const exhaustedErr = new LLMReliabilityError(
      "AudienceSegmentation failed after 4 attempts",
      "CONTRACT_FAILURE",
      [
        {
          rule: "JUDGE_RESPONSE_CONTRACT_FAILURE",
          claimId: "disc_pain_14",
          rejectionCode: "JUDGE_EVALUATION_INCOMPLETE",
          reason: "MISSING_EVALUATION_KEYS: [disc_pain_14]",
          offendingClaimIds: ["disc_pain_14"],
        },
      ],
      {
        engine: "AudienceEngine-V3",
        touchpoint: "segment_generation",
        attempts: 4,
        maxAttempts: 4,
        technicalRetries: 0,
        finalVerdict: "HONEST_FAIL",
        repairLog: [],
      }
    );

    const attrExhausted = buildAudienceFailureAttribution(exhaustedErr, []);
    expect(attrExhausted.retryBudgetExhausted).toBe(true);
    expect(attrExhausted.summary).toContain("after maximum retries (4/4)");
  });

  it("Case L & Case M + Integration — Raw Diagnostic Capture Before Validation Throw, Orchestrator Step Wiring, Recovery Attribution, API Progress Mapping, and Stale Snapshot Guard", async () => {
    const discoveredPains = buildDiscoveredPains14().slice(0, 2);
    const evidenceUnits = buildEvidenceUnits14().slice(0, 2);

    const validCandidate = [
      {
        id: "seg_1",
        name: "Gourmet Buyers",
        role: "BUYER",
        description: "Gourmet buyers",
        pains: discoveredPains.map((p) => ({
          claimId: p.claimId,
          claim: p.claim,
          evidenceIds: p.evidenceIds,
        })),
        desires: [],
        objections: [],
        motivations: [],
        outcomes: [],
        groundingRefs: ["ev_1", "ev_2"],
      },
    ];

    vi.spyOn(aiClient, "aiChat").mockImplementation(async (opts: any) => {
      const promptText = opts.messages.map((m: any) => m.content).join("\n");
      if (opts.endpoint === "audience-engine-v3-judge") {
        const batchKeys = extractBatchAllowedClaimIdsFromJudgePrompt(promptText);
        // Judge persistently returns contradictory duplicate verdicts for disc_pain_1
        return wrapAiChatContent({
          verdicts: [
            ...batchKeys.map((k) => ({ claimId: k, status: "VALID" })),
            {
              claimId: "disc_pain_1",
              status: "INVALID",
              rejectionCode: "UNSUPPORTED_PAIN",
              critique: "Contradictory duplicate verdict in synthetic Judge response",
            },
          ],
        });
      }
      return wrapAiChatContent({ segments: validCandidate });
    });

    let caughtError: any = null;
    try {
      await constructSegments(
        [],
        [],
        [],
        [],
        { level: "developing", score: 0.6 } as any,
        { level: "solution_aware", score: 0.7 } as any,
        {
          industry: "Gourmet Sweets",
          coreOffer: "Baklawati 400g",
          targetAudience: "Gourmet Buyers",
        },
        evidenceUnits as any,
        "tenant_synth_m",
        "snap_mi_m",
        {
          jobId: "run_case_m_fail",
          campaignId: "camp_synth_m",
          doctrine: { campaignOfferingId: "off_synth_400g" },
        } as any,
        undefined,
        discoveredPains
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const diags = getRecentAudienceJudgeDiagnostics("run_case_m_fail");
    expect(diags.length).toBeGreaterThan(0);
    // Raw response was retained BEFORE validation rejected it
    expect(diags[0].rawResponse).toContain("Contradictory duplicate verdict in synthetic Judge response");
    expect(diags[0].contradictoryDuplicateKeys).toEqual(["disc_pain_1"]);
    expect(diags[0].validationOutcome).toBe("CONTRACT_ERROR");

    const failureAttribution = buildAudienceFailureAttribution(caughtError, diags);
    expect(failureAttribution.category).toBe("JUDGE_CONTRACT_FAILURE");
    expect(failureAttribution.code).toBe("JUDGE_EVALUATION_DUPLICATES");
    expect(failureAttribution.retryBudgetExhausted).toBe(true);

    // 2. Verify Orchestrator sectionStatuses builder and downstream cascade skip via executeEngine
    const audienceBlockedStepResult = {
      engineId: "audience" as const,
      status: "BLOCKED" as const,
      output: {
        status: "INCOMPLETE",
        statusMessage: failureAttribution.summary,
        snapshotId: "",
        failureAttribution,
        judgeDiagnostics: diags,
      },
      blockReason: failureAttribution.summary,
      durationMs: 350,
    };

    const resultsMap = new Map<any, any>([
      [
        "market_intelligence",
        {
          engineId: "market_intelligence",
          status: "SUCCESS",
          snapshotId: "snap_mi_valid_123",
          output: { competitors: [{ name: "Comp A" }], marketState: "ESTABLISHED_COMPETITION" },
          durationMs: 120,
        },
      ],
      ["audience", audienceBlockedStepResult],
    ]);

    const mockCtx: any = {
      miSnapshotId: "snap_mi_valid_123",
      audienceSnapshotId: undefined,
      depthGateStatus: {},
      inputHashes: { mi: "hash_mi_1" },
    };
    const mockConfig: any = {
      accountId: "tenant_synth_m",
      campaignId: "camp_synth_m",
    };

    // Execute downstream engine ("differentiation") through real executeEngine:
    // It must be skipped due to upstream block in audience!
    const diffStepResult = await executeEngine(
      "differentiation",
      mockCtx,
      mockConfig,
      resultsMap,
      "run_case_m_fail"
    );
    expect(diffStepResult.status).toBe("SKIPPED");
    expect(diffStepResult.blockReason).toMatch(
      /higher-priority MARKET_REALITY layer has blocking result|Blocked by upstream failure in audience/i
    );
    resultsMap.set("differentiation", diffStepResult);

    // Ensure Audience snapshotId is NEVER set to MI snapshotId when Audience fails
    expect(mockCtx.audienceSnapshotId).toBeUndefined();
    expect(mockCtx.audienceSnapshotId).not.toBe(mockCtx.miSnapshotId);

    const audStatusEntry = buildSectionStatusEntry(
      { id: "audience", name: "Audience Engine" },
      audienceBlockedStepResult as any
    );
    const diffStatusEntry = buildSectionStatusEntry(
      { id: "differentiation", name: "Differentiation Engine" },
      diffStepResult
    );
    expect(audStatusEntry.failureCategory).toBe("JUDGE_CONTRACT_FAILURE");
    expect(audStatusEntry.failureCode).toBe("JUDGE_EVALUATION_DUPLICATES");
    expect(diffStatusEntry.status).toBe("SKIPPED");
    expect(diffStatusEntry.upstreamBlocked).toBe(true);

    // 3. Verify RecoveryIntelligence attributes this halt to technical_pipeline_interruption, NOT system_data_insufficiency or INSUFFICIENT_AUDIENCE_DATA
    const deterministicPlan = buildRecoveryPlan(
      {
        verdict: "BLOCK",
        executionMode: "SYSTEM_UNTRUSTED",
        blockReasons: [
          {
            code: "PIPELINE_INCOMPLETE",
            description: failureAttribution.summary,
            source: "audience",
            severity: "critical",
          },
        ],
        downgrades: [],
        structuralChecks: [],
        contradictions: [],
        repairActions: [],
        repairAttempted: false,
        timestamp: new Date(),
        durationMs: 500,
        controlVersion: "3.0",
        shadowMode: false,
      },
      {
        campaignId: "camp_synth_m",
        accountId: "tenant_synth_m",
        results: resultsMap,
      }
    );

    expect(deterministicPlan).not.toBeNull();
    const enrichedPlan = await enrichRecoveryPlan(deterministicPlan!, {
      campaignId: "camp_synth_m",
      accountId: "tenant_synth_m",
      results: resultsMap,
    });

    expect(enrichedPlan.intelligence?.commercialDisease).toBe("technical_pipeline_interruption");
    expect(enrichedPlan.intelligence?.commercialDisease).not.toBe("system_data_insufficiency");
    expect(enrichedPlan.intelligence?.buyerPsychologyConstraint).toContain("TECHNICAL_PIPELINE_INTERRUPTION");
    expect(enrichedPlan.intelligence?.buyerPsychologyConstraint).not.toContain("INSUFFICIENT_AUDIENCE_DATA");

    // 4. Verify StrategyExperienceService.getRunProgress maps technical failure and upstream-skipped stages accurately
    const mockJobRow = {
      id: "run_case_m_fail",
      accountId: "tenant_synth_m",
      campaignId: "camp_synth_m",
      status: "BLOCKED",
      durationMs: 500,
      completedAt: new Date(),
      error: `Blocked at Audience Engine: ${failureAttribution.summary}`,
      planId: null,
      sectionStatuses: JSON.stringify([
        {
          id: "market_intelligence",
          name: "Market Intelligence Engine",
          status: "SUCCESS",
          summary: "Found 12 competitors. Market state: ESTABLISHED_COMPETITION.",
        },
        audStatusEntry,
        diffStatusEntry,
      ]),
    };

    vi.spyOn(db, "select" as any).mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [mockJobRow],
          orderBy: () => ({
            limit: async () => [mockJobRow],
          }),
        }),
      }),
    }));

    const progress = await StrategyExperienceService.getRunProgress("run_case_m_fail", "tenant_synth_m");
    expect(progress).not.toBeNull();
    const audStage = progress!.stages.find((s) => s.id === "audience");
    const diffStage = progress!.stages.find((s) => s.id === "differentiation");
    expect(audStage?.status).toBe("BLOCKED");
    expect(audStage?.failureCategory).toBe("JUDGE_CONTRACT_FAILURE");
    expect(audStage?.upstreamBlocked).toBeUndefined();
    expect(diffStage?.status).toBe("BLOCKED");
    expect(diffStage?.rawStatus).toBe("SKIPPED");
    expect(diffStage?.upstreamBlocked).toBe(true);

    // 5. Verify getLatestAudienceSnapshot and assembleAudiencePositioningData refuse stale older snapshots when a newer job blocked at Audience
    const olderSnapshotRow = {
      id: "snap_aud_old_run",
      accountId: "tenant_synth_m",
      campaignId: "camp_synth_m",
      runId: "run_older_success",
      createdAt: new Date("2026-10-14T10:00:00Z"),
      audienceSegments: JSON.stringify([{ name: "Old Stale Segment" }]),
      audiencePains: JSON.stringify([{ canonical: "Old Stale Pain" }]),
    };
    const newerBlockedJobRow = {
      ...mockJobRow,
      createdAt: new Date("2026-10-14T15:00:00Z"),
    };

    let selectCallIdx = 0;
    vi.spyOn(db, "select" as any).mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              selectCallIdx++;
              // Call 1 in getLatestAudienceSnapshot queries audienceSnapshots; Call 2 queries orchestratorJobs
              if (selectCallIdx === 1) return [olderSnapshotRow];
              return [newerBlockedJobRow];
            },
          }),
          limit: async () => [],
        }),
      }),
    }));

    const latestSnap = await getLatestAudienceSnapshot("tenant_synth_m", "camp_synth_m");
    expect(latestSnap).toBeNull();

    // Also verify assembleAudiencePositioningData suppresses stale audRow when no active root exists and latest job blocked at Audience
    let apSelectIdx = 0;
    vi.spyOn(db, "select" as any).mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              apSelectIdx++;
              // 1: strategicPlans (empty), 2: strategyRoots (empty), 3: audienceSnapshots (olderSnapshotRow), 4: orchestratorJobs (newerBlockedJobRow)
              if (apSelectIdx === 3) return [olderSnapshotRow];
              if (apSelectIdx === 4) return [newerBlockedJobRow];
              return [];
            },
          }),
          limit: async () => [],
        }),
      }),
    }));

    const viewModel = await assembleAudiencePositioningData("camp_synth_m", "tenant_synth_m");
    expect(viewModel.hasAudience).toBe(false);
    expect(viewModel.targetAudience.title).toBe("");
  });
});
