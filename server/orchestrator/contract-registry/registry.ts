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
      // every consumer reads through this contract field; the legacy path
      // is tolerated until shadow logs prove no one needs it.
      id: "funnelStages",
      path: ["funnelReconstruction", "funnelStages"],
      legacyPaths: [["funnelStages"]],
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

export const ENGINE_CONTRACT_REGISTRY: Partial<Record<EngineId, EngineContract>> = {
  channel_selection: CHANNEL_SELECTION_CONTRACT,
  funnel: FUNNEL_CONTRACT,
  // C2 will add: market_intelligence, audience, positioning, differentiation,
  // mechanism, offer, awareness, persuasion, integrity, statistical_validation,
  // budget_governor, iteration, retention.
};
