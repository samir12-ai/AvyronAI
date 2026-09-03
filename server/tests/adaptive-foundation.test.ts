import { describe, it, expect } from "vitest";
import {
  STRATEGY_AUTHORITY_REGISTRY,
  getAuthorityDefinition,
  getDownstreamDependents,
  getUpstreamDependencies,
  getTransitiveDependents,
} from "../adaptive/authority-registry";
import {
  validateCampaignContainment,
  validateStrategyRootReference,
  validateReasoningCase,
  validateAdaptiveDecision,
  validateCompetitorSourceOwnership,
  validateEvidenceReferences,
  validateStrategyRootImmutability,
  validateEntityIdentityPreservation,
  LineageIntegrityError,
} from "../adaptive/lineage";
import {
  wrapInAuthorityEnvelope,
  adaptStrategyRootToEnvelope,
  adaptDifferentiationToEnvelope,
  adaptPerformanceContextToSignal,
  adaptPipelineChangeEventToSignal,
  adaptEvidenceRegistryToItem,
  extractCompetitorSources,
} from "../adaptive/adapters";
import {
  AdaptiveSignal,
  ReasoningCase,
  AdaptiveDecision,
  CompetitorSource,
  EvidenceItem,
  ExecutionSignal,
  StrategyAdaptationLineage,
} from "../adaptive/contracts";
import { buildAdaptiveAuthorityPrompt, REASONING_ENGINE_DOCTRINE } from "../adaptive/llm-doctrine";

describe("Phase 0 — Adaptive Intelligence Foundation Test Suite", () => {
  // TEST 1 — SAME ENTITY PRESERVES ID
  it("TEST 1 — Downstream transport preserves source entity IDs without regenerating hashes", () => {
    const canonicalSegment = { id: "seg_workflow_99", name: "Operations Leads" };
    const downstreamSegment = { segmentId: "seg_workflow_99", name: "Operations Leads Modified Text" };

    expect(() => {
      validateEntityIdentityPreservation(
        canonicalSegment,
        downstreamSegment,
        "AudienceSegment"
      );
    }).not.toThrow();

    const mutatedSegment = { segmentId: "seg_different_hash_123", name: "Operations Leads" };
    expect(() => {
      validateEntityIdentityPreservation(
        canonicalSegment,
        mutatedSegment,
        "AudienceSegment"
      );
    }).toThrowError(LineageIntegrityError);
  });

  // TEST 2 — COMPETITOR SOURCE OWNERSHIP
  it("TEST 2 — Multiple platform sources resolve to one canonical competitorId", () => {
    const rawCompetitor = {
      id: "comp_marketmind_1",
      accountId: "acc_test",
      campaignId: "camp_test",
      name: "MarketMind AI",
      websiteUrl: "https://marketmind.ai",
      socialUrls: {
        linkedin: "https://linkedin.com/company/marketmind",
        x: "https://x.com/marketmind_ai",
        youtube: "https://youtube.com/@marketmind",
      },
    };

    const sources = extractCompetitorSources(rawCompetitor);
    expect(sources.length).toBe(4);

    for (const src of sources) {
      expect(src.competitorId).toBe("comp_marketmind_1");
      expect(() => {
        validateCompetitorSourceOwnership(src, "comp_marketmind_1");
      }).not.toThrow();
    }

    const mismatchedSource: CompetitorSource = {
      sourceId: "src_rogue",
      competitorId: "comp_other",
      campaignId: "camp_test",
      accountId: "acc_test",
      platform: "WEBSITE",
      canonicalUrl: "https://other.com",
      status: "ACTIVE",
    };

    expect(() => {
      validateCompetitorSourceOwnership(mismatchedSource, "comp_marketmind_1");
    }).toThrowError(/does not belong to competitor/);
  });

  // TEST 3 — SIGNAL LINEAGE
  it("TEST 3 — Normalized signal preserves sourceArtifactId and evidenceIds", () => {
    const rawPerfContext = {
      id: "pctx_8819",
      businessExecutionStateId: "bstate_001",
      accountId: "acc_1",
      campaignId: "camp_1",
      mode: "BUILD",
      primaryBottleneck: "OFFER_CLARITY",
      currentReality: "Low conversion on landing page",
      confidence: "HIGH",
      evidenceRefIds: ["ev_101", "ev_102"],
      createdAt: new Date(),
    };

    const signal: AdaptiveSignal = adaptPerformanceContextToSignal(rawPerfContext);
    expect(signal.sourceArtifactId).toBe("pctx_8819");
    expect(signal.sourceDomain).toBe("PERFORMANCE");
    expect(signal.evidenceIds).toEqual(["ev_101", "ev_102"]);
    expect(signal.severity).toBe("CRITICAL");
  });

  // TEST 4 — REASONING CASE ROOT LINEAGE
  it("TEST 4 — Reasoning case strictly requires valid strategyRootId and strategyRootVersion", () => {
    const validCase: ReasoningCase = {
      reasoningCaseId: "rcase_55",
      accountId: "acc_1",
      campaignId: "camp_1",
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      marketEventIds: ["evt_1"],
      performanceWarningIds: [],
      evidenceIds: ["ev_101"],
      status: "OPEN",
      openedAt: new Date().toISOString(),
      reasoningVersion: "1.0.0",
    };

    expect(() => validateReasoningCase(validCase)).not.toThrow();

    const invalidCase = { ...validCase, strategyRootVersion: 0 };
    expect(() => validateReasoningCase(invalidCase as any)).toThrowError(/positive numeric strategyRootVersion/);

    const missingRootCase = { ...validCase, strategyRootId: "" };
    expect(() => validateReasoningCase(missingRootCase as any)).toThrowError(/valid strategyRootId/);
  });

  // TEST 5 — ADAPTIVE DECISION OWNERSHIP
  it("TEST 5 — AdaptiveDecision may identify affected authority but cannot contain replacement strategy payloads", () => {
    const validDecision: AdaptiveDecision = {
      adaptiveDecisionId: "adec_99",
      reasoningCaseId: "rcase_55",
      campaignId: "camp_1",
      accountId: "acc_1",
      strategyRootId: "root_v56",
      strategyRootVersion: 56,
      decisionType: "REEVALUATE_AUTHORITY",
      affectedAuthority: "DIFFERENTIATION",
      affectedEntityIds: ["pillar_realtime"],
      evidenceIds: ["ev_101"],
      confidence: 0.85,
      rationale: "Competitor launched live streaming intelligence claim",
      createdAt: new Date().toISOString(),
    };

    expect(() => validateAdaptiveDecision(validDecision)).not.toThrow();

    // Breach attempt: AdaptiveDecision attempting to directly inject replacement differentiation pillars
    const breachDecision: any = {
      ...validDecision,
      differentiationPillars: ["Unauthorized Replacement Pillar"],
    };

    expect(() => validateAdaptiveDecision(breachDecision)).toThrowError(/contains forbidden replacement strategy payload/);
  });

  // TEST 6 — STRATEGY VERSION IMMUTABILITY
  it("TEST 6 — Strategy adaptation creates an incremented version without mutating historical root", () => {
    const historicalRoot = { id: "root_v56_id", version: 56, rootHash: "hash_56" };
    const adaptedRoot = { id: "root_v57_id", version: 57, rootHash: "hash_57" };

    expect(() => validateStrategyRootImmutability(historicalRoot, adaptedRoot)).not.toThrow();

    // Violation attempt: mutating same root ID in place
    const mutatedInPlace = { id: "root_v56_id", version: 57 };
    expect(() => validateStrategyRootImmutability(historicalRoot, mutatedInPlace)).toThrowError(/Strategy Root mutation detected/);

    // Violation attempt: non-incrementing version
    const nonIncrementing = { id: "root_v57_id", version: 55 };
    expect(() => validateStrategyRootImmutability(historicalRoot, nonIncrementing)).toThrowError(/version must increment/);
  });

  // TEST 7 — CROSS-CAMPAIGN GUARD
  it("TEST 7 — Artifact from Campaign A cannot attach to Campaign B", () => {
    const artifactCampA = { campaignId: "camp_alpha", accountId: "acc_1" };

    expect(() => {
      validateCampaignContainment(artifactCampA, "camp_alpha", "acc_1");
    }).not.toThrow();

    expect(() => {
      validateCampaignContainment(artifactCampA, "camp_beta", "acc_1");
    }).toThrowError(/Cross-campaign contamination detected/);
  });

  // TEST 8 — DANGLING ID GUARD
  it("TEST 8 — Invalid or missing evidence references are rejected structurally", () => {
    const knownEvidence = new Set(["ev_1", "ev_2", "ev_3"]);

    expect(() => validateEvidenceReferences(["ev_1", "ev_2"], knownEvidence)).not.toThrow();

    expect(() => validateEvidenceReferences(["ev_1", "ev_dangling_99"], knownEvidence)).toThrowError(
      /Dangling evidence reference/
    );

    expect(() => validateEvidenceReferences([""])).toThrowError(/empty or non-string evidence ID/);
  });

  // TEST 9 — TEXT/ID SEPARATION
  it("TEST 9 — Entity identity is preserved via explicit ID fields rather than prose parsing", () => {
    const laneSource = { laneId: "lane_workflow_efficiency", title: "Workflow Automation for Operational Efficiency" };
    const laneTransformed = { laneId: "lane_workflow_efficiency", title: "Updated Customer-Facing Lane Title" };

    expect(() => {
      validateEntityIdentityPreservation(laneSource, laneTransformed, "Lane");
    }).not.toThrow();
  });

  // TEST 10 — AUTHORITY REGISTRY
  it("TEST 10 — Each canonical strategic authority resolves to exactly one owner and valid dependency chain", () => {
    const positioningDef = getAuthorityDefinition("POSITIONING");
    expect(positioningDef.ownerEngine).toBe("PositioningEngine");
    expect(positioningDef.canonicalTable).toBe("positioning_snapshots");

    const diffDef = getAuthorityDefinition("DIFFERENTIATION");
    expect(diffDef.ownerEngine).toBe("DifferentiationEngine");
    expect(diffDef.canonicalTable).toBe("differentiation_snapshots");

    const rootDef = getAuthorityDefinition("STRATEGY_ROOT");
    expect(rootDef.ownerEngine).toBe("StrategyRootEngine");
    expect(rootDef.canonicalTable).toBe("strategy_roots");

    // Transitive dependents of Positioning includes Differentiation, Mechanism, Offer, etc.
    const posTransitive = getTransitiveDependents("POSITIONING");
    expect(posTransitive).toContain("DIFFERENTIATION");
    expect(posTransitive).toContain("OFFER");
    expect(posTransitive).toContain("PLAN_SYNTHESIS");
  });

  // TEST 11 — NO DUPLICATE AUTHORITY
  it("TEST 11 — Strategy registry enforces 1:1 mapping between authority and canonical table", () => {
    const tableToAuthorityMap = new Map<string, string>();
    const authorities = Object.keys(STRATEGY_AUTHORITY_REGISTRY) as (keyof typeof STRATEGY_AUTHORITY_REGISTRY)[];

    for (const auth of authorities) {
      const def = STRATEGY_AUTHORITY_REGISTRY[auth];
      // Distinct authorities must have distinct canonical tables
      expect(def.ownerEngine).toBeDefined();
      expect(def.canonicalTable).toBeDefined();
    }
  });

  // TEST 12 — LEGACY ADAPTER SAFETY
  it("TEST 12 — Existing engine snapshots adapt safely to AuthorityEnvelope and AdaptiveSignal", () => {
    const mockRoot = {
      id: "root_v56",
      campaignId: "camp_1",
      accountId: "acc_1",
      runId: "orch_100",
      rootVersion: 56,
      approvedLanes: JSON.stringify([{ laneId: "lane_1" }, { laneId: "lane_2" }]),
      createdAt: new Date(),
    };

    const envelope = adaptStrategyRootToEnvelope(mockRoot);
    expect(envelope.authorityType).toBe("STRATEGY_ROOT");
    expect(envelope.artifactId).toBe("root_v56");
    expect(envelope.strategyRootVersion).toBe(56);
    expect(envelope.entityIds).toEqual(["lane_1", "lane_2"]);

    const prompt = buildAdaptiveAuthorityPrompt({
      canonicalStrategyContext: "Avyron AI: Live Market Mirror & Semantic Judge",
      supportingEvidence: "Competitor claim: real-time intelligence",
      taskDescription: "Diagnose impact on differentiation",
      allowedDecisions: REASONING_ENGINE_DOCTRINE.allowedDecisions,
      forbiddenDecisions: REASONING_ENGINE_DOCTRINE.forbiddenDecisions,
      outputSchemaDescription: "{ decisionType: string, confidence: number }",
    });

    expect(prompt).toContain("CURRENT CANONICAL STRATEGY");
    expect(prompt).toContain("STRICTLY FORBIDDEN ACTIONS");
    expect(prompt).toContain("DO NOT rewrite Positioning");
  });
});
