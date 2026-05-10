/**
 * Engine Contract Registry — Data (Phase C0 foundation)
 *
 * The single source of truth for every engine's required/optional outputs,
 * canonical paths, and downstream consumers. Declared in TypeScript because
 * the helpers (`requireContractField`, `classifyTrust`, `wrapAsEnvelope`)
 * import it directly; ts-morph CI verifier in C2 walks this table.
 *
 * SCOPE for C0: only `channel_selection` and `funnel` are populated, per
 * plan §9. The remaining 13 engines are added during C2 (shadow validation),
 * one entry per engine, by reading each engine's `types.ts` and the audit notes in
 * `.local/plans/15-engine-contract-map.md`. Until then, `getContract(id)`
 * returns `null` for them and consumers fall back to legacy direct-read
 * behavior — no runtime change.
 *
 * Risk-tier doctrine (from `15-engine-contract-map.md`):
 *   CRITICAL : market_intelligence, audience, positioning, offer, funnel,
 *              integrity, statistical_validation, budget_governor,
 *              channel_selection
 *   HIGH     : differentiation, mechanism, awareness, persuasion, iteration
 *   MEDIUM   : retention
 *
 * The two CRITICAL engines populated in C0 (channel_selection + funnel)
 * are exactly the ones whose field-mismatches the audit surfaced.
 */

import { z } from "zod";
import type { EngineId } from "../priority-matrix";
import type { EngineContract } from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Local Zod schemas (mirror the TS interfaces in the engines' own types.ts).
// We intentionally keep these lightweight and structural — the goal is to
// catch shape regressions (missing fields, wrong primitive types), not to
// re-derive every engine's full domain validation. Tighter shapes can be
// substituted later by importing the engine's own Zod export when one exists.
// ────────────────────────────────────────────────────────────────────────────

/** ChannelCandidate — see server/strategy/channel-selection/types.ts */
const ChannelCandidateSchema = z.object({
  channelKey: z.string().optional(),
  channelName: z.string().optional(),
  fitScore: z.number().optional(),
  scalability: z.number().optional(),
}).passthrough();

/** FunnelStageAssignment — see server/strategy/channel-selection/types.ts:137 */
const FunnelStageAssignmentSchema = z.object({
  channelName: z.string(),
  channelKey: z.string(),
  assignedRole: z.string(),
}).passthrough();

const FunnelStagesSchema = z.object({
  awareness: z.array(FunnelStageAssignmentSchema),
  nurture: z.array(FunnelStageAssignmentSchema),
  conversion: z.array(FunnelStageAssignmentSchema),
});

const DecisionGateScoringSchema = z.object({
  funnelIntegrityScore: z.number(),
  persuasionAlignmentScore: z.number(),
  budgetRealism: z.number(),
  channelScalability: z.number(),
  compositeGateScore: z.number(),
}).passthrough();

/** FunnelCandidate (loose — full shape lives in funnel-engine/types.ts). */
const FunnelCandidateSchema = z.object({}).passthrough();

const FunnelStageObjectSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

const TrustPathAnalysisSchema = z.object({
  score: z.number(),
  steps: z.number(),
  gaps: z.array(z.string()),
}).passthrough();

// ────────────────────────────────────────────────────────────────────────────
// Engine version imports — single source of truth for version-pinning. We
// import these here so a version bump in the engine automatically invalidates
// every persisted snapshot through the trust classifier.
// ────────────────────────────────────────────────────────────────────────────

import { ENGINE_VERSION as CHANNEL_SELECTION_ENGINE_VERSION } from "../../strategy/channel-selection/constants";
import { ENGINE_VERSION as FUNNEL_ENGINE_VERSION } from "../../funnel-engine/constants";
import { ENGINE_VERSION as MARKET_INTELLIGENCE_ENGINE_VERSION } from "../../market-intelligence-v3/constants";
import { AUDIENCE_ENGINE_VERSION } from "../../audience-engine/constants";
import { POSITIONING_ENGINE_VERSION } from "../../positioning-engine/constants";
import { ENGINE_VERSION as OFFER_ENGINE_VERSION } from "../../offer-engine/constants";
import { ENGINE_VERSION as AWARENESS_ENGINE_VERSION } from "../../awareness-engine/constants";
import { ENGINE_VERSION as INTEGRITY_ENGINE_VERSION } from "../../integrity-engine/constants";
import { ENGINE_VERSION as STATISTICAL_VALIDATION_ENGINE_VERSION } from "../../strategy/statistical-validation/constants";
import { ENGINE_VERSION as BUDGET_GOVERNOR_ENGINE_VERSION } from "../../strategy/budget-governor/constants";
import { ENGINE_VERSION as DIFFERENTIATION_ENGINE_VERSION } from "../../differentiation-engine/constants";
import { ENGINE_VERSION as MECHANISM_ENGINE_VERSION } from "../../mechanism-engine/constants";
import { ENGINE_VERSION as PERSUASION_ENGINE_VERSION } from "../../persuasion-engine/constants";
import { ENGINE_VERSION as ITERATION_ENGINE_VERSION } from "../../strategy/iteration-engine/constants";
import { ENGINE_VERSION as RETENTION_ENGINE_VERSION } from "../../strategy/retention-engine/constants";

// ────────────────────────────────────────────────────────────────────────────
// C2 shared schemas — kept loose on purpose. The shadow-audit goal is
// presence + non-empty + obvious-shape detection. We do NOT want false
// positives flooding `[ContractAudit]` logs from engines that emit
// well-formed but evolving sub-objects. Tighter schemas can be swapped in
// per engine after shadow data confirms the real shape is stable.
// ────────────────────────────────────────────────────────────────────────────

const LooseObjectSchema = z.object({}).passthrough();
const NumberZeroToOneSchema = z.number().min(0).max(1);
const StringArraySchema = z.array(z.string());
const SignalItemArraySchema = z.array(z.any()); // SignalItem shape varies across audience modes

// ────────────────────────────────────────────────────────────────────────────
// Contract entries (C0 scope: channel_selection + funnel only)
// ────────────────────────────────────────────────────────────────────────────

const CHANNEL_SELECTION_CONTRACT: EngineContract = {
  engineId: "channel_selection",
  engineVersion: CHANNEL_SELECTION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    {
      id: "primaryChannel",
      path: ["primaryChannel"],
      shape: ChannelCandidateSchema,
      emptyIsMissing: true,
      consumers: [
        "build_plan_layer.channel_strategy",
        "system_control.channel_confidence_minimum",
      ],
    },
    {
      id: "confidenceScore",
      path: ["confidenceScore"],
      shape: z.number().min(0).max(1),
      emptyIsMissing: false,
      consumers: ["system_control.channel_confidence_minimum"],
    },
    {
      // The bug that triggered this whole layer: 4 consumers were reading
      // `output.funnelStages` directly while the engine writes the value
      // at `output.funnelReconstruction.funnelStages`. After C1 cutover
      // every consumer reads through this contract field; legacy path
      // dropped in C5 (2026-05-09) — engine source verified to emit only
      // the canonical nested path; live shadow run produced 0 violations.
      id: "funnelStages",
      path: ["funnelReconstruction", "funnelStages"],
      shape: FunnelStagesSchema,
      emptyIsMissing: true,
      consumers: [
        "system_control.funnel_structural_completeness",
        "system_control.conversion_path_exists",
        "system_control.contradiction_detector.funnel_iteration",
        "system_control.repair_actions.inject_conversion",
        "build_plan_layer.funnel_block",
      ],
    },
    {
      id: "conversionChannelAssigned",
      path: ["conversionChannelAssigned"],
      shape: z.boolean(),
      emptyIsMissing: false,
      consumers: ["system_control.conversion_path_exists"],
    },
    {
      id: "decisionGateScoring",
      path: ["decisionGateScoring"],
      shape: DecisionGateScoringSchema,
      emptyIsMissing: true,
      consumers: ["system_control.weak_funnel_for_scale"],
    },
  ],
  optionalOutputs: [
    {
      // H3 (2026-05-10) — TRANSITIONAL D5 EXCEPTION (sunset: H8).
      // Canonical channel-decision GATE outcome. Held in `optionalOutputs`
      // during the engine-emit rollout window so legacy snapshots are not
      // retroactively flagged STALE. Important caveats per code review:
      //   - `validateContractCompleteness()` validates `requiredOutputs` only;
      //     optional fields are NOT checked at the pipeline gate. Pipeline-
      //     level enforcement of doctrine D5 (missing → CONTRACT_INCOMPLETE)
      //     does NOT apply until promoted to `requiredOutputs`.
      //   - Runtime D5 enforcement still applies on the consumer side: each
      //     consumer that reads this value MUST go through
      //     `requireContractField("channel_selection","decisionGateOutcome",…)`
      //     which returns INCOMPLETE on absence regardless of optional/required.
      //   - Strict-enum shape (z.enum) IS enforced when the value is present:
      //     wrong vocabularies still cause INVALID.
      // Sunset criteria: promote to `requiredOutputs` in H8 once channel
      // engine emits this field on 100% of new runs (verified via shadow logs
      // for ≥7 days with zero `LEGACY_HIT` for this field id).
      id: "decisionGateOutcome",
      path: ["primaryChannel", "decisionGate", "outcome"],
      shape: z.enum(["recommended", "support_channel", "exploratory"]),
      emptyIsMissing: false,
      consumers: [
        "build_plan_layer.channel_strategy",
        "system_control.channel_decision_gate",
        "audit_control.channel_panel",
      ],
    },
    {
      id: "commercialOrchestration",
      path: ["commercialOrchestration"],
      shape: z.any().nullable(),
      emptyIsMissing: false,
      consumers: ["build_plan_layer.commercial_dna"],
    },
    {
      id: "rejectedChannels",
      path: ["rejectedChannels"],
      shape: z.array(z.any()),
      emptyIsMissing: false,
      consumers: ["audit_control.channel_rationale"],
    },
    {
      id: "correctionAuditTrail",
      path: ["correctionAuditTrail"],
      shape: z.array(z.any()),
      emptyIsMissing: false,
      consumers: ["audit_control.engine_corrections"],
    },
  ],
  requiredBy: [
    "system_control.funnel_structural_completeness",
    "system_control.conversion_path_exists",
    "system_control.channel_confidence_minimum",
    "system_control.contradiction_detector.funnel_iteration",
    "build_plan_layer",
    "iteration_engine.funnel_input",
  ],
};

const FUNNEL_CONTRACT: EngineContract = {
  engineId: "funnel",
  engineVersion: FUNNEL_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    {
      id: "primaryFunnel",
      path: ["primaryFunnel"],
      shape: FunnelCandidateSchema,
      emptyIsMissing: true,
      consumers: [
        "channel_selection.funnel_input",
        "build_plan_layer.funnel_block",
        "persuasion.funnel_depth",
      ],
    },
    {
      id: "funnelStrengthScore",
      path: ["funnelStrengthScore"],
      shape: z.number().min(0).max(1),
      emptyIsMissing: false,
      consumers: [
        "budget_governor.funnel_alignment",
        "system_control.budget_funnel_alignment",
      ],
    },
    {
      id: "trustPathGaps",
      path: ["trustPathAnalysis", "gaps"],
      shape: z.array(z.string()),
      emptyIsMissing: false,
      consumers: ["system_control.contradiction_detector.funnel_iteration"],
    },
    {
      id: "trustPathAnalysis",
      path: ["trustPathAnalysis"],
      shape: TrustPathAnalysisSchema,
      emptyIsMissing: true,
      consumers: ["system_control.contradiction_detector.funnel_iteration"],
    },
    {
      id: "confidenceScore",
      path: ["confidenceScore"],
      shape: z.number().min(0).max(1),
      emptyIsMissing: false,
      consumers: ["system_control.confidence_chain_integrity"],
    },
  ],
  optionalOutputs: [
    {
      id: "alternativeFunnel",
      path: ["alternativeFunnel"],
      shape: z.any().nullable(),
      emptyIsMissing: false,
      consumers: ["audit_control.funnel_alternatives"],
    },
    {
      id: "frictionMap",
      path: ["frictionMap"],
      shape: z.any(),
      emptyIsMissing: false,
      consumers: ["build_plan_layer.friction_block"],
    },
    {
      id: "strategyAcceptability",
      path: ["strategyAcceptability"],
      shape: z.any().optional(),
      emptyIsMissing: false,
      consumers: ["audit_control.acceptability"],
    },
    {
      id: "primaryFunnelStageMap",
      path: ["primaryFunnel", "stageMap"],
      shape: z.array(FunnelStageObjectSchema),
      emptyIsMissing: true,
      consumers: ["persuasion.funnel_depth", "integrity.funnel_text"],
    },
  ],
  requiredBy: [
    "channel_selection",
    "persuasion",
    "budget_governor",
    "system_control",
    "build_plan_layer",
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Registry table — partial map keyed by EngineId. Engines not present here
// are interpreted by `getContract(...)` as "no contract registered yet"
// (caller must fall back to legacy direct-read behavior). C2 fills the rest.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// C2 expansion — 7 additional engines covering all CRITICAL-tier gating
// paths. Schemas are intentionally loose (presence + non-empty); the
// `[ContractAudit] SHADOW` logs will tell us if real engine output ever
// deviates before we tighten anything for C4 enforcement.
// ────────────────────────────────────────────────────────────────────────────

const MARKET_INTELLIGENCE_CONTRACT: EngineContract = {
  engineId: "market_intelligence",
  engineVersion: MARKET_INTELLIGENCE_ENGINE_VERSION,
  // MI is the one engine where reuse across runs is legitimate (market data
  // is stable inside a freshness window). All other engines are per-run.
  livenessRule: "reuse_allowed",
  requiredOutputs: [
    { id: "signalData",        path: ["signalData"],        shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["audience", "positioning", "differentiation", "funnel", "offer", "persuasion", "awareness", "integrity", "statistical_validation", "system_control.signal_grounding"] },
    { id: "confidenceData",    path: ["confidenceData"],    shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["audience", "positioning", "awareness", "persuasion", "statistical_validation", "system_control.confidence_chain_integrity"] },
    { id: "marketState",       path: ["marketState"],       shape: z.string(),        emptyIsMissing: true,  consumers: ["positioning", "awareness", "integrity"] },
    { id: "trajectoryData",    path: ["trajectoryData"],    shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["positioning", "statistical_validation"] },
    { id: "dominanceData",     path: ["dominanceData"],     shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["differentiation", "funnel", "offer"] },
    // H5 (2026-05-10): legacyPaths dropped — engine source verified to emit
    // `signalComposition` only inside `diagnosticsData` (engine.ts:1224 spread).
    // No root-level fallback; consumers go through the canonical nested path.
    { id: "signalComposition", path: ["diagnosticsData", "signalComposition"], shape: LooseObjectSchema, emptyIsMissing: true, consumers: ["system_control.signal_grounding", "budget_governor"] },
  ],
  optionalOutputs: [
    { id: "narrativeSynthesis", path: ["narrativeSynthesis"], shape: z.string().nullable(), emptyIsMissing: false, consumers: ["differentiation", "awareness"] },
    { id: "marketDiagnosis",    path: ["marketDiagnosis"],    shape: z.string().nullable(), emptyIsMissing: false, consumers: ["differentiation", "funnel", "offer", "persuasion", "awareness", "integrity", "statistical_validation"] },
    { id: "objectionMapData",   path: ["objectionMapData"],   shape: z.any(),               emptyIsMissing: false, consumers: ["audience", "persuasion"] },
    { id: "diagnosticsData",    path: ["diagnosticsData"],    shape: LooseObjectSchema,     emptyIsMissing: false, consumers: ["audit_control.mi_panel", "system_control.signal_grounding"] },
  ],
  requiredBy: ["audience", "positioning", "differentiation", "funnel", "offer", "persuasion", "awareness", "integrity", "statistical_validation", "system_control"],
};

const AUDIENCE_CONTRACT: EngineContract = {
  engineId: "audience",
  engineVersion: AUDIENCE_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    // C5 (2026-05-09): legacy path `audiencePains` (snapshot column name)
    // dropped — engine source verified to return `painMap` at root in-memory
    // (engine.ts:2099); snapshot reads via getLatestAudienceSnapshot already
    // map audiencePains→painMap before exposing the object.
    { id: "audiencePains",     path: ["painMap"],          shape: SignalItemArraySchema, emptyIsMissing: true, consumers: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection", "system_control.zero_objection_coverage", "system_control.offer_audience_misalignment"] },
    { id: "desireMap",         path: ["desireMap"],        shape: SignalItemArraySchema, emptyIsMissing: true, consumers: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection"] },
    { id: "objectionMap",      path: ["objectionMap"],     shape: z.any(),               emptyIsMissing: true, consumers: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection", "system_control.zero_objection_coverage"] },
    { id: "emotionalDrivers",  path: ["emotionalDrivers"], shape: SignalItemArraySchema, emptyIsMissing: true, consumers: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection"] },
    { id: "audienceSegments",  path: ["audienceSegments"], shape: z.array(z.any()),      emptyIsMissing: true, consumers: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection"] },
    { id: "awarenessLevel",    path: ["awarenessLevel"],   shape: LooseObjectSchema,     emptyIsMissing: true, consumers: ["differentiation", "awareness", "persuasion", "funnel", "offer", "channel_selection"] },
    { id: "maturityIndex",     path: ["maturityIndex"],    shape: LooseObjectSchema,     emptyIsMissing: true, consumers: ["differentiation", "awareness", "persuasion", "channel_selection"] },
    { id: "structuredSignals", path: ["structuredSignals"], shape: LooseObjectSchema,    emptyIsMissing: true, consumers: ["positioning", "statistical_validation", "persuasion"] },
    { id: "transformationMap", path: ["transformationMap"], shape: SignalItemArraySchema, emptyIsMissing: true, consumers: ["offer", "funnel"] },
  ],
  optionalOutputs: [
    { id: "buyerPsychologyProfile", path: ["buyerPsychologyProfile"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["awareness", "persuasion", "offer"] },
    { id: "audienceSophistication", path: ["audienceSophistication"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["persuasion", "positioning"] },
  ],
  requiredBy: ["differentiation", "funnel", "offer", "awareness", "persuasion", "integrity", "channel_selection", "positioning", "statistical_validation", "system_control"],
};

const POSITIONING_CONTRACT: EngineContract = {
  engineId: "positioning",
  engineVersion: POSITIONING_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "territories",           path: ["territories"],           shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["differentiation", "funnel", "offer", "mechanism", "awareness", "persuasion", "integrity"] },
    { id: "primaryTerritory",      path: ["territory"],             shape: z.any().nullable(),    emptyIsMissing: true,  consumers: ["differentiation", "awareness"] },
    { id: "enemyDefinition",       path: ["enemyDefinition"],       shape: z.string(),            emptyIsMissing: true,  consumers: ["differentiation", "funnel", "offer", "mechanism", "awareness", "persuasion", "integrity"] },
    { id: "contrastAxis",          path: ["contrastAxis"],          shape: z.string(),            emptyIsMissing: true,  consumers: ["differentiation", "funnel", "offer", "mechanism", "awareness", "persuasion", "integrity"] },
    { id: "narrativeDirection",    path: ["narrativeDirection"],    shape: z.string(),            emptyIsMissing: true,  consumers: ["differentiation", "funnel", "offer", "mechanism", "awareness", "persuasion", "integrity"] },
    { id: "differentiationVector", path: ["differentiationVector"], shape: StringArraySchema,     emptyIsMissing: true,  consumers: ["differentiation", "mechanism"] },
    { id: "confidenceScore",       path: ["confidenceScore"],       shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["mechanism", "awareness", "persuasion", "integrity", "system_control.positioning_hard_gate", "system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "strategyCards",      path: ["strategyCards"],      shape: z.array(z.any()), emptyIsMissing: false, consumers: ["differentiation", "audit_control.positioning_panel"] },
    { id: "categoryGameDesign", path: ["categoryGameDesign"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["offer", "persuasion", "commercial_dna"] },
    { id: "signalTraceability", path: ["signalTraceability"], shape: LooseObjectSchema, emptyIsMissing: false, consumers: ["audit_control.positioning_panel"] },
  ],
  requiredBy: ["differentiation", "funnel", "offer", "mechanism", "awareness", "persuasion", "integrity", "system_control"],
};

const OFFER_CONTRACT: EngineContract = {
  engineId: "offer",
  engineVersion: OFFER_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "primaryOffer",                path: ["primaryOffer"],                                          shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["funnel", "awareness", "persuasion", "integrity", "channel_selection", "statistical_validation", "budget_governor", "retention", "build_plan_layer.offer_block", "system_control.offer_audience_misalignment", "system_control.zero_objection_coverage"] },
    { id: "primaryOfferCoreOutcome",     path: ["primaryOffer", "coreOutcome"],                           shape: z.string(),        emptyIsMissing: true,  consumers: ["funnel", "awareness", "persuasion", "channel_selection", "retention", "build_plan_layer.offer_block"] },
    { id: "primaryOfferObjectionHandling", path: ["primaryOffer", "objectionHandling"],                   shape: StringArraySchema, emptyIsMissing: true,  consumers: ["system_control.zero_objection_coverage"] },
    { id: "primaryOfferProofAlignment",  path: ["primaryOffer", "proofAlignment"],                        shape: StringArraySchema, emptyIsMissing: true,  consumers: ["funnel", "persuasion", "system_control.zero_objection_coverage"] },
    { id: "offerStrengthScore",          path: ["offerStrengthScore"],                                    shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["budget_governor", "funnel", "awareness", "persuasion", "channel_selection", "statistical_validation"] },
    { id: "structuralWarnings",          path: ["structuralWarnings"],                                    shape: StringArraySchema, emptyIsMissing: false, consumers: ["system_control.offer_audience_misalignment"] },
    // C5 (2026-05-09): legacy root path dropped — engine source verified to return `layerDiagnostics: { ...diagnostics }` only (engine.ts:2226/2268/2398/3069).
    { id: "offerAlignmentValidation",    path: ["layerDiagnostics", "offerAlignmentValidation"],          shape: LooseObjectSchema, emptyIsMissing: true, consumers: ["system_control.offer_audience_misalignment"] },
    { id: "integrityChecks",             path: ["layerDiagnostics", "integrityChecks"],                   shape: LooseObjectSchema, emptyIsMissing: true, consumers: ["system_control.offer_audience_misalignment"] },
    { id: "confidenceScore",             path: ["confidenceScore"],                                       shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "signalGrounding", path: ["signalGrounding"], shape: LooseObjectSchema, emptyIsMissing: false, consumers: ["audit_control.offer_panel", "statistical_validation"] },
  ],
  requiredBy: ["funnel", "awareness", "persuasion", "integrity", "channel_selection", "statistical_validation", "budget_governor", "retention", "system_control", "build_plan_layer"],
};

const AWARENESS_CONTRACT: EngineContract = {
  engineId: "awareness",
  engineVersion: AWARENESS_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "primaryRoute",                       path: ["primaryRoute"],                                shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["persuasion", "integrity", "funnel", "channel_selection", "statistical_validation", "build_plan_layer.awareness_block"] },
    { id: "primaryRouteEntryMechanismType",     path: ["primaryRoute", "entryMechanismType"],          shape: z.string(),            emptyIsMissing: true,  consumers: ["funnel.entry_trigger", "persuasion", "channel_selection"] },
    { id: "primaryRouteTargetReadinessStage",   path: ["primaryRoute", "targetReadinessStage"],        shape: z.string(),            emptyIsMissing: true,  consumers: ["funnel", "persuasion", "channel_selection", "statistical_validation"] },
    { id: "primaryRouteTriggerClass",           path: ["primaryRoute", "triggerClass"],                shape: z.string(),            emptyIsMissing: true,  consumers: ["funnel", "persuasion", "channel_selection"] },
    { id: "primaryRouteTrustRequirement",       path: ["primaryRoute", "trustRequirement"],            shape: z.string(),            emptyIsMissing: true,  consumers: ["persuasion", "channel_selection"] },
    { id: "primaryRouteFunnelCompatibility",    path: ["primaryRoute", "funnelCompatibility"],         shape: z.string(),            emptyIsMissing: true,  consumers: ["funnel", "channel_selection"] },
    { id: "primaryRouteAwarenessStrengthScore", path: ["primaryRoute", "awarenessStrengthScore"],      shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["persuasion", "channel_selection", "statistical_validation", "system_control.confidence_chain_integrity"] },
    { id: "dataReliability",                    path: ["dataReliability"],                             shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["statistical_validation", "system_control.signal_grounding"] },
  ],
  optionalOutputs: [
    { id: "structuralWarnings", path: ["structuralWarnings"], shape: StringArraySchema, emptyIsMissing: false, consumers: ["system_control.contradiction_detector"] },
  ],
  requiredBy: ["persuasion", "integrity", "funnel", "channel_selection", "statistical_validation", "system_control", "build_plan_layer"],
};

const INTEGRITY_CONTRACT: EngineContract = {
  engineId: "integrity",
  engineVersion: INTEGRITY_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "overallIntegrityScore", path: ["overallIntegrityScore"], shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["awareness", "persuasion", "system_control.integrity_status"] },
    { id: "safeToExecute",         path: ["safeToExecute"],         shape: z.boolean(),           emptyIsMissing: false, consumers: ["awareness", "persuasion", "build_plan_layer", "system_control.integrity_status"] },
    // Canonical integrity VERDICT: 'PASS' | 'PARTIAL' | 'FAIL'.
    // Distinct from the engine-execution `status` field (COMPLETE | INTEGRITY_FAILED).
    // NO LEGACY FALLBACK — per Integrity contract hardening (May 2026):
    // engines that fail to emit `overallStatus` must trip CONTRACT_INCOMPLETE.
    // Reading the engine-execution `status` field as a verdict is forbidden,
    // because COMPLETE/INTEGRITY_FAILED do not equal PASS/PARTIAL/FAIL.
    { id: "overallStatus",         path: ["overallStatus"],         shape: z.enum(["PASS", "PARTIAL", "FAIL"]), emptyIsMissing: true, consumers: ["system_control.integrity_status", "system_control.contradiction_detector.budget_scale_weak_integrity"] },
    // H4 (2026-05-10): canonical integrity VERDICT under a semantically-explicit
    // name. `overallStatus` is retained for back-compat (FE SystemIntegrityPanel
    // reads it); new consumers MUST prefer `integrityVerdict`. Engine emits
    // both with identical values; agent-stream-semantic-separation.test.ts
    // proves the field name no longer collides with execution-status semantics.
    // H4 back-compat (May 2026): during the transition window, `integrityVerdict`
    // is the canonical field for the F2 integrity verdict, but the engine also
    // emits the legacy `overallStatus` with the same value. Snapshots persisted
    // before the H4 rollout (and reliability test fixtures) only set
    // `overallStatus` — the registry resolves to that legacy path so contract
    // completeness is preserved. New code should write/read `integrityVerdict`
    // and the legacy path will be removed once all consumers have migrated.
    { id: "integrityVerdict",      path: ["integrityVerdict"],      shape: z.enum(["PASS", "PARTIAL", "FAIL"]), emptyIsMissing: true, legacyPaths: [["overallStatus"]], consumers: ["system_control.integrity_status", "system_control.contradiction_detector.budget_scale_weak_integrity"] },
    { id: "zeroLeakage",           path: ["zeroLeakage"],           shape: z.boolean(),           emptyIsMissing: false, consumers: ["system_control.integrity_status"] },
    { id: "traceabilityComplete",  path: ["traceabilityComplete"],  shape: z.boolean(),           emptyIsMissing: false, consumers: ["system_control.integrity_status"] },
    { id: "failureReasons",        path: ["failureReasons"],        shape: StringArraySchema,     emptyIsMissing: false, consumers: ["system_control.integrity_status", "recovery_planner"] },
    { id: "structuralWarnings",    path: ["structuralWarnings"],    shape: StringArraySchema,     emptyIsMissing: false, consumers: ["awareness", "persuasion"] },
    { id: "flaggedInconsistencies",path: ["flaggedInconsistencies"],shape: StringArraySchema,     emptyIsMissing: false, consumers: ["awareness", "persuasion", "system_control.contradiction_detector"] },
    { id: "layerResults",          path: ["layerResults"],          shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["awareness", "persuasion"] },
  ],
  optionalOutputs: [],
  requiredBy: ["awareness", "persuasion", "build_plan_layer", "system_control"],
};

const STATISTICAL_VALIDATION_CONTRACT: EngineContract = {
  engineId: "statistical_validation",
  engineVersion: STATISTICAL_VALIDATION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    // C5 (2026-05-09): legacy paths dropped — engine source verified to return `validationState` at root (engine.ts:1432).
    // H1 (2026-05-10): shape tightened from z.string() to strict enum.
    // Canonical statistical-validation VERDICT vocabulary (lowercase, per
    // validation-judgement.ts:4 and engine.ts:1370-1378). Distinct from
    // the engine-execution `status` field. Reading `status` as a verdict
    // is forbidden (Doctrine D1 — no semantic fallback for live decisions).
    { id: "validationState",        path: ["validationState"],        shape: z.enum(["validated", "provisional", "weak", "rejected"]), emptyIsMissing: true, consumers: ["budget_governor", "channel_selection", "system_control.validation_result"] },
    { id: "claimConfidenceScore",   path: ["claimConfidenceScore"],   shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["budget_governor", "channel_selection"] },
    { id: "evidenceStrength",       path: ["evidenceStrength"],       shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["budget_governor", "channel_selection"] },
    { id: "assumptionFlags",        path: ["assumptionFlags"],        shape: StringArraySchema,     emptyIsMissing: false, consumers: ["channel_selection"] },
    { id: "claimValidations",       path: ["claimValidations"],       shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["audit_control.validation_panel", "build_plan_layer"] },
    { id: "signalClusters",         path: ["signalClusters"],         shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["audit_control.validation_panel"] },
    { id: "signalBackedClaimRatio", path: ["signalBackedClaimRatio"], shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["system_control.signal_grounding"] },
    // C5 (2026-05-09): legacy path dropped — engine source verified to return `originTypeDistribution` at root (engine.ts:1456).
    { id: "originTypeDistribution", path: ["originTypeDistribution"], shape: LooseObjectSchema, emptyIsMissing: true, consumers: ["system_control.signal_grounding", "budget_governor"] },
    { id: "confidenceExplanation",  path: ["confidenceExplanation"],  shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["audit_control.validation_panel", "recovery_intelligence"] },
  ],
  optionalOutputs: [
    { id: "commercialJudgement", path: ["commercialJudgement"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["build_plan_layer.causal_narrative"] },
    { id: "structuralWarnings",  path: ["structuralWarnings"],  shape: StringArraySchema,  emptyIsMissing: false, consumers: ["recovery_planner"] },
  ],
  requiredBy: ["budget_governor", "channel_selection", "system_control", "build_plan_layer"],
};

const BUDGET_GOVERNOR_CONTRACT: EngineContract = {
  engineId: "budget_governor",
  engineVersion: BUDGET_GOVERNOR_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "decision",            path: ["decision"],                              shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["channel_selection", "retention", "system_control.budget_funnel_alignment", "system_control.budget_cac_verification", "system_control.budget_override_zero_confidence", "system_control.contradiction_detector.budget_scale_no_conversion", "system_control.contradiction_detector.budget_scale_weak_integrity", "repair_actions", "build_plan_layer.budget_block"] },
    // H3 (2026-05-10): shape tightened from z.string() to strict enum.
    // Canonical budget action vocabulary (lowercase, per types.ts:34 and
    // engine.ts:218-255). No semantic fallback to verdict/status (Doctrine D1).
    { id: "decisionAction",      path: ["decision", "action"],                    shape: z.enum(["test", "scale", "hold", "halt"]), emptyIsMissing: true,  consumers: ["channel_selection", "system_control.budget_funnel_alignment", "system_control.budget_cac_verification", "system_control.budget_override_zero_confidence", "system_control.contradiction_detector.budget_scale_no_conversion", "repair_actions"] },
    { id: "decisionReasoning",   path: ["decision", "reasoning"],                 shape: z.string(),        emptyIsMissing: true,  consumers: ["build_plan_layer.budget_block", "audit_control.budget_panel"] },
    { id: "testBudgetRange",     path: ["testBudgetRange"],                       shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["channel_selection", "build_plan_layer.budget_block"] },
    { id: "scaleBudgetRange",    path: ["scaleBudgetRange"],                      shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["channel_selection", "build_plan_layer.budget_block"] },
    { id: "killFlag",            path: ["killFlag"],                              shape: z.boolean(),       emptyIsMissing: false, consumers: ["channel_selection", "system_control.collectBlockReasons"] },
    { id: "killReasons",         path: ["killReasons"],                           shape: StringArraySchema, emptyIsMissing: false, consumers: ["recovery_planner", "build_plan_layer.budget_block"] },
    { id: "guardResult",         path: ["guardResult"],                           shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["system_control.budget_cac_verification"] },
    // C5 (2026-05-09): legacy path dropped — engine source verified to return `guardResult: { ..., warnings: [...] }` (engine.ts:464,501).
    { id: "guardResultWarnings", path: ["guardResult", "warnings"],               shape: StringArraySchema, emptyIsMissing: false, consumers: ["system_control.budget_cac_verification"] },
    { id: "expansionPermission", path: ["expansionPermission"],                   shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["channel_selection"] },
    { id: "cacAssumptionCheck",  path: ["cacAssumptionCheck"],                    shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["system_control.budget_cac_verification"] },
    { id: "confidenceScore",     path: ["confidenceScore"],                       shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "structuralWarnings", path: ["structuralWarnings"], shape: StringArraySchema, emptyIsMissing: false, consumers: ["recovery_planner"] },
    { id: "commercialStrategy", path: ["commercialStrategy"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["build_plan_layer.causal_narrative", "commercial_dna"] },
  ],
  requiredBy: ["channel_selection", "retention", "system_control", "build_plan_layer", "recovery_planner"],
};

// ────────────────────────────────────────────────────────────────────────────
// HIGH/MEDIUM tier engines — added so the registry covers all 15. These
// engines do not directly gate the System Control PASS/BLOCK verdict, but
// their outputs feed downstream consumers (build_plan_layer, contradiction
// detector, audit_control). Registering them lets shadow validation surface
// any missing fields so we have full coverage before flipping
// `ENFORCE_ENGINE_CONTRACTS=true`. Schemas stay loose — presence + obvious
// shape — until shadow logs prove tighter shapes are safe.
// Field IDs derived from `.local/plans/engine-contract-global-enforcement.md`
// §4.3 cross-referenced against each engine's `*/types.ts`.
// ────────────────────────────────────────────────────────────────────────────

const DIFFERENTIATION_CONTRACT: EngineContract = {
  engineId: "differentiation",
  engineVersion: DIFFERENTIATION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "pillars",            path: ["pillars"],            shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["mechanism", "offer", "awareness", "persuasion", "integrity", "build_plan_layer.differentiation_block"] },
    { id: "mechanismFraming",   path: ["mechanismFraming"],   shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["mechanism", "offer", "persuasion"] },
    { id: "mechanismCore",      path: ["mechanismCore"],      shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["mechanism", "offer", "persuasion"] },
    { id: "claimStructures",    path: ["claimStructures"],    shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["mechanism", "offer", "persuasion", "integrity"] },
    { id: "proofArchitecture",  path: ["proofArchitecture"],  shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["mechanism", "offer", "persuasion", "integrity"] },
    { id: "authorityMode",      path: ["authorityMode"],      shape: z.string(),            emptyIsMissing: true,  consumers: ["persuasion", "integrity"] },
    { id: "confidenceScore",    path: ["confidenceScore"],    shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["mechanism", "system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "trustPriorityMap",      path: ["trustPriorityMap"],      shape: z.array(z.any()), emptyIsMissing: false, consumers: ["persuasion"] },
    { id: "stabilityResult",       path: ["stabilityResult"],       shape: LooseObjectSchema, emptyIsMissing: false, consumers: ["audit_control.differentiation_panel"] },
    { id: "collisionDiagnostics",  path: ["collisionDiagnostics"],  shape: z.array(z.any()), emptyIsMissing: false, consumers: ["audit_control.differentiation_panel"] },
    { id: "celDepthCompliance",    path: ["celDepthCompliance"],    shape: z.any().nullable(), emptyIsMissing: false, consumers: ["system_control.cel_depth"] },
  ],
  requiredBy: ["mechanism", "offer", "awareness", "persuasion", "integrity", "build_plan_layer", "system_control"],
};

const MECHANISM_CONTRACT: EngineContract = {
  engineId: "mechanism",
  engineVersion: MECHANISM_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "primaryMechanism",       path: ["primaryMechanism"],                     shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["offer", "persuasion", "awareness", "integrity", "build_plan_layer.mechanism_block"] },
    { id: "mechanismName",          path: ["primaryMechanism", "mechanismName"],    shape: z.string(),        emptyIsMissing: true,  consumers: ["offer", "persuasion", "awareness", "integrity"] },
    { id: "mechanismType",          path: ["primaryMechanism", "mechanismType"],    shape: z.string(),        emptyIsMissing: true,  consumers: ["offer", "persuasion", "awareness"] },
    { id: "mechanismSteps",         path: ["primaryMechanism", "mechanismSteps"],   shape: StringArraySchema, emptyIsMissing: true,  consumers: ["offer", "persuasion", "build_plan_layer.mechanism_block"] },
    { id: "mechanismPromise",       path: ["primaryMechanism", "mechanismPromise"], shape: z.string(),        emptyIsMissing: true,  consumers: ["offer", "persuasion", "awareness"] },
    { id: "axisConsistency",        path: ["axisConsistency"],                      shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["system_control.axis_consistency", "integrity"] },
    { id: "confidenceScore",        path: ["confidenceScore"],                      shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["offer", "persuasion", "system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "alternativeMechanism",   path: ["alternativeMechanism"],   shape: z.any().nullable(),  emptyIsMissing: false, consumers: ["audit_control.mechanism_panel"] },
    { id: "inheritedConfidence",    path: ["inheritedConfidence"],    shape: z.number().optional(), emptyIsMissing: false, consumers: ["audit_control.mechanism_panel"] },
    { id: "rawLLMConfidence",       path: ["rawLLMConfidence"],       shape: z.number().optional(), emptyIsMissing: false, consumers: ["audit_control.mechanism_panel"] },
    { id: "alternativeMechanisms",  path: ["alternativeMechanisms"],  shape: z.array(z.any()).optional(), emptyIsMissing: false, consumers: ["audit_control.mechanism_panel"] },
  ],
  requiredBy: ["offer", "persuasion", "awareness", "integrity", "build_plan_layer", "system_control"],
};

const PERSUASION_CONTRACT: EngineContract = {
  engineId: "persuasion",
  engineVersion: PERSUASION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "primaryRoute",                  path: ["primaryRoute"],                                shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["integrity", "build_plan_layer.persuasion_block", "system_control.persuasion_strength"] },
    { id: "persuasionMode",                path: ["primaryRoute", "persuasionMode"],              shape: z.string(),        emptyIsMissing: true,  consumers: ["integrity", "system_control.contradiction_detector.awareness_persuasion_mismatch"] },
    { id: "primaryInfluenceDrivers",       path: ["primaryRoute", "primaryInfluenceDrivers"],     shape: StringArraySchema, emptyIsMissing: true,  consumers: ["integrity", "build_plan_layer.persuasion_block"] },
    { id: "objectionPriorities",           path: ["primaryRoute", "objectionPriorities"],         shape: z.array(z.any()),  emptyIsMissing: true,  consumers: ["integrity", "system_control.zero_objection_coverage"] },
    { id: "trustSequence",                 path: ["primaryRoute", "trustSequence"],               shape: StringArraySchema, emptyIsMissing: true,  consumers: ["integrity", "build_plan_layer.persuasion_block"] },
    { id: "persuasionStrengthScore",       path: ["primaryRoute", "persuasionStrengthScore"],     shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["budget_governor", "channel_selection", "system_control.persuasion_strength", "system_control.confidence_chain_integrity"] },
    { id: "boundaryCheck",                 path: ["boundaryCheck"],                               shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["integrity", "system_control.boundary_violations"] },
    { id: "dataReliability",               path: ["dataReliability"],                             shape: LooseObjectSchema, emptyIsMissing: true,  consumers: ["system_control.signal_grounding"] },
  ],
  optionalOutputs: [
    { id: "alternativeRoute",      path: ["alternativeRoute"],      shape: z.any().nullable(), emptyIsMissing: false, consumers: ["audit_control.persuasion_panel"] },
    { id: "rejectedRoute",         path: ["rejectedRoute"],         shape: z.any().nullable(), emptyIsMissing: false, consumers: ["audit_control.persuasion_panel"] },
    { id: "structuralWarnings",    path: ["structuralWarnings"],    shape: StringArraySchema, emptyIsMissing: false, consumers: ["recovery_planner"] },
    { id: "autoCorrection",        path: ["autoCorrection"],        shape: z.any().optional(), emptyIsMissing: false, consumers: ["audit_control.persuasion_panel"] },
    { id: "strategyAcceptability", path: ["strategyAcceptability"], shape: z.any().optional(), emptyIsMissing: false, consumers: ["audit_control.acceptability"] },
  ],
  requiredBy: ["integrity", "budget_governor", "channel_selection", "build_plan_layer", "system_control"],
};

const ITERATION_CONTRACT: EngineContract = {
  engineId: "iteration",
  engineVersion: ITERATION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "nextTestHypotheses",     path: ["nextTestHypotheses"],     shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.iteration_block", "system_control.contradiction_detector.funnel_iteration"] },
    { id: "optimizationTargets",    path: ["optimizationTargets"],    shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.iteration_block"] },
    { id: "iterationPlan",          path: ["iterationPlan"],          shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.iteration_block"] },
    { id: "boundaryCheck",          path: ["boundaryCheck"],          shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["system_control.boundary_violations"] },
    { id: "dataReliability",        path: ["dataReliability"],        shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["system_control.signal_grounding"] },
    { id: "confidenceScore",        path: ["confidenceScore"],        shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "failedStrategyFlags",        path: ["failedStrategyFlags"],        shape: z.array(z.any()), emptyIsMissing: false, consumers: ["audit_control.iteration_panel", "recovery_planner"] },
    { id: "structuralWarnings",         path: ["structuralWarnings"],         shape: StringArraySchema, emptyIsMissing: false, consumers: ["recovery_planner"] },
    { id: "strategyAcceptability",      path: ["strategyAcceptability"],      shape: z.any().optional(), emptyIsMissing: false, consumers: ["audit_control.acceptability"] },
    { id: "commercialIterationStrategy", path: ["commercialIterationStrategy"], shape: z.any().nullable(), emptyIsMissing: false, consumers: ["build_plan_layer.causal_narrative", "commercial_dna"] },
  ],
  requiredBy: ["build_plan_layer", "system_control"],
};

const RETENTION_CONTRACT: EngineContract = {
  engineId: "retention",
  engineVersion: RETENTION_ENGINE_VERSION,
  livenessRule: "current_run_only",
  requiredOutputs: [
    { id: "retentionLoops",     path: ["retentionLoops"],     shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.retention_block"] },
    { id: "churnRiskFlags",     path: ["churnRiskFlags"],     shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.retention_block", "system_control.churn_risk"] },
    { id: "ltvExpansionPaths",  path: ["ltvExpansionPaths"],  shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.retention_block"] },
    { id: "upsellTriggers",     path: ["upsellTriggers"],     shape: z.array(z.any()),      emptyIsMissing: true,  consumers: ["build_plan_layer.retention_block"] },
    { id: "guardResult",        path: ["guardResult"],        shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["system_control.retention_guard"] },
    { id: "boundaryCheck",      path: ["boundaryCheck"],      shape: LooseObjectSchema,     emptyIsMissing: true,  consumers: ["system_control.boundary_violations"] },
    { id: "confidenceScore",    path: ["confidenceScore"],    shape: NumberZeroToOneSchema, emptyIsMissing: false, consumers: ["system_control.confidence_chain_integrity"] },
  ],
  optionalOutputs: [
    { id: "structuralWarnings",            path: ["structuralWarnings"],            shape: StringArraySchema, emptyIsMissing: false, consumers: ["recovery_planner"] },
    { id: "dataReliability",               path: ["dataReliability"],               shape: LooseObjectSchema, emptyIsMissing: false, consumers: ["system_control.signal_grounding"] },
    { id: "strategyAcceptability",         path: ["strategyAcceptability"],         shape: z.any().optional(), emptyIsMissing: false, consumers: ["audit_control.acceptability"] },
    { id: "commercialRetentionEconomics",  path: ["commercialRetentionEconomics"],  shape: z.any().nullable(), emptyIsMissing: false, consumers: ["build_plan_layer.causal_narrative", "commercial_dna"] },
  ],
  requiredBy: ["build_plan_layer", "system_control"],
};

export const ENGINE_CONTRACT_REGISTRY: Partial<Record<EngineId, EngineContract>> = {
  channel_selection: CHANNEL_SELECTION_CONTRACT,
  funnel: FUNNEL_CONTRACT,
  market_intelligence: MARKET_INTELLIGENCE_CONTRACT,
  audience: AUDIENCE_CONTRACT,
  positioning: POSITIONING_CONTRACT,
  offer: OFFER_CONTRACT,
  awareness: AWARENESS_CONTRACT,
  integrity: INTEGRITY_CONTRACT,
  statistical_validation: STATISTICAL_VALIDATION_CONTRACT,
  budget_governor: BUDGET_GOVERNOR_CONTRACT,
  differentiation: DIFFERENTIATION_CONTRACT,
  mechanism: MECHANISM_CONTRACT,
  persuasion: PERSUASION_CONTRACT,
  iteration: ITERATION_CONTRACT,
  retention: RETENTION_CONTRACT,
};
