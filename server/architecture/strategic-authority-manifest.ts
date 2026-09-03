/**
 * AVYRON STRATEGIC AUTHORITY MANIFEST
 * 
 * Machine-readable declaration of canonical strategic authorities.
 * Used primarily for freeze tests and architectural boundary auditing.
 * Production runtime must NEVER couple dynamically to this manifest.
 */
export const STRATEGIC_AUTHORITY_MANIFEST = {
  version: "2026-09-FROZEN",
  authorities: {
    PainExistence: {
      owner: "server/audience-engine/engine.ts:constructSegments",
      validator: "SemanticAudienceJudge",
      canonicalField: "audienceSegments[].pains",
      prohibitedFallbacks: ["painMap", "regex", "PAIN_CLUSTERS", "deterministic heuristics"],
    },
    PainRegistryInitialState: {
      owner: "server/shared/audience-pain-registry.ts:buildAudiencePainRegistry",
      state: "SEMANTICALLY_NEUTRAL",
      defaultClassification: "NOT_EVALUATED",
      defaultProductFit: "UNKNOWN",
      defaultEligible: false,
      defaultAllowedUses: [],
    },
    TargetCoverage: {
      owner: "server/strategic-reasoning/target-assessment.ts:runTargetAssessmentForPain",
      table: "target_assessments",
      idPrefix: "ta_",
      defaultOnFailure: "NOT_COVERED",
    },
    ProductFit: {
      owner: "server/strategic-reasoning/product-assessment.ts:runProductAssessmentForPain",
      table: "product_assessments",
      idPrefix: "pa_",
      defaultOnFailure: "UNKNOWN",
    },
    StrategicPainDecision: {
      owner: "server/strategic-pain-decision-judge.ts:judgeStrategicPainDecision",
      table: "strategic_pain_decisions",
      idPrefix: "spd_",
      validVerdicts: ["CORE_PURCHASE", "SUPPORTING", "EXCLUDE", "DROPPED"],
      defaultOnFailure: "DROPPED",
    },
    PermissionGranting: {
      owner: "server/shared/pain-classifier.ts:refineAudiencePainRegistry",
      timing: "Post-StrategicPainDecisionJudge ONLY",
      defaultAllowedUses: [],
    },
    LaneAuthority: {
      owner: "server/shared/lane-grouper.ts:runLaneGrouper",
      field: "strategy_roots.approved_lanes",
      inputRequirement: "Judged CORE_PURCHASE and SUPPORTING pains only with eligible: true",
    },
    PositioningAuthority: {
      owner: "server/positioning-engine/engine.ts:runPositioningEngineV3",
      inputRequirement: "strategyRoots.approvedLanes and brandSpine",
    },
    ChannelAuthority: {
      owner: "server/strategy/channel-selection/engine.ts:runChannelSelectionWithAIProposal",
      mode: "DYNAMIC_AI_PROPOSAL_ONLY",
    },
    PlanSynthesis: {
      owner: "server/orchestrator/plan-synthesis.ts:assemblePlan",
      mode: "ASSEMBLER_ONLY",
      semanticInventionForbidden: true,
    },
  },
} as const;
