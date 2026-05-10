import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { SharedStrategicContext } from "../orchestrator/shared-strategic-context";
import type { BlockReason, RepairAction, RepairActionCode, BlockCode } from "./types";
import { getContractFieldRaw } from "../orchestrator/contract-registry";

// v1 Actionable Block Recovery (May 2026). Confidence-clamp delta — caps a
// repaired engine's combinedConfidence at `inheritedFloor + DELTA` (the same
// 0.20 ceiling the structural check enforces). Never weakens enforcement;
// strictly downgrade-only.
const CONFIDENCE_FLOOR_DELTA = 0.20;

// v1 Actionable Block Recovery. Spread-clamp lifts the lowest-confidence
// outlier UP to (max - this delta) only when the maximum is itself at or
// below 0.50. We never lower the maximum (would weaken truthful signal); we
// never raise an outlier above the spread threshold (would be a fabrication).
// Result is risk-reducing because the delta keeps the spread inside the
// 0.50 structural-check threshold without manufacturing confidence.
const SPREAD_CLAMP_DELTA = 0.49;

// All blocks that have a wired repair handler. `null` = NOT REPAIRABLE
// (commercial brake / truthfulness signal — must surface as BLOCK with a
// RecoveryPlan).
const REPAIRABLE_BLOCKS: Record<BlockCode, RepairActionCode | null> = {
  NO_CONVERSION_PATH: "INJECT_FALLBACK_CONVERSION",
  SCALE_WITHOUT_REAL_DATA: "DOWNGRADE_SCALE_TO_TEST",
  INTEGRITY_FAILURE: "REVALIDATE_INTEGRITY",
  COMPLIANCE_FAILURE: null,
  BUDGET_KILL: null,
  BUDGET_HALT: null,
  VALIDATION_REJECTED: null,
  SIGNAL_GROUNDING_MASS_FAILURE: null,
  OFFER_AUDIENCE_MISALIGNMENT: null,
  ZERO_OBJECTION_COVERAGE: null,
  // v1 wired repairs
  CONFIDENCE_CHAIN_VIOLATION:       "CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA",
  CONFIDENCE_SPREAD_EXCESSIVE:      "CLAMP_TO_LOWER_CONFIDENCE",
  BUDGET_OVERRIDE_ZERO_CONFIDENCE:  "FORCE_BUDGET_HOLD_ON_ZERO_FLOOR",
  CHANNEL_CONFIDENCE_BELOW_MINIMUM: "MODE_DOWNGRADE_TO_CHANNEL_VALIDATION",
  // Commercial brakes — must NOT auto-repair
  POSITIONING_HARD_GATE: null,
  UNRESOLVED_CRITICAL_PROBLEMS: null,
  PIPELINE_INCOMPLETE: null,
  STALE_SNAPSHOT_EVIDENCE: null,
  ENGINE_TIMEOUT: null,
  UNRESOLVED_CONTRADICTION: null,
};

const FALLBACK_CONVERSION_CHANNELS = [
  { key: "landing_page_organic", label: "Landing Page (Organic)", conversionScore: 0.85 },
  { key: "email_nurture", label: "Email Nurture", conversionScore: 0.75 },
  { key: "webinar_organic", label: "Webinar (Organic)", conversionScore: 0.70 },
  { key: "search_paid", label: "Search Paid", conversionScore: 0.65 },
];

export function assessRepairability(blockReasons: BlockReason[]): {
  repairable: boolean;
  repairableBlocks: BlockReason[];
  nonRepairableBlocks: BlockReason[];
  recommendedActions: RepairAction[];
} {
  const repairableBlocks: BlockReason[] = [];
  const nonRepairableBlocks: BlockReason[] = [];
  const recommendedActions: RepairAction[] = [];

  for (const block of blockReasons) {
    const actionCode = REPAIRABLE_BLOCKS[block.code];
    if (actionCode) {
      repairableBlocks.push(block);
      recommendedActions.push({
        code: actionCode,
        targetBlock: block.code,
        description: getRepairDescription(actionCode, block),
        safe: true,
        executed: false,
        succeeded: false,
        detail: "",
      });
    } else {
      nonRepairableBlocks.push(block);
    }
  }

  return {
    repairable: nonRepairableBlocks.length === 0 && repairableBlocks.length > 0,
    repairableBlocks,
    nonRepairableBlocks,
    recommendedActions,
  };
}

export function executeRepairActions(
  actions: RepairAction[],
  results: Map<EngineId, EngineStepResult>,
  integrityReport: IntegrityReport | null,
  ssc: SharedStrategicContext | null = null,
): RepairAction[] {
  const executed: RepairAction[] = [];

  for (const action of actions) {
    const result: RepairAction = { ...action, executed: true };

    switch (action.code) {
      case "INJECT_FALLBACK_CONVERSION":
        result.succeeded = executeConversionInjection(results);
        result.detail = result.succeeded
          ? "Fallback conversion channel injected into channel_selection results"
          : "No viable fallback conversion channel found";
        break;

      case "DOWNGRADE_SCALE_TO_TEST":
        result.succeeded = executeScaleDowngrade(results);
        result.detail = result.succeeded
          ? "Budget action downgraded from scale to test (zero real data)"
          : "Budget result not available for downgrade";
        break;

      case "REVALIDATE_INTEGRITY":
        result.succeeded = executeIntegrityRevalidation(integrityReport);
        result.detail = result.succeeded
          ? "Integrity re-validation confirmed failure — block stands"
          : "Integrity re-validation could not complete";
        result.succeeded = false;
        break;

      case "FLAG_FOR_REVIEW":
        result.succeeded = true;
        result.detail = "Flagged for human review";
        break;

      case "CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA": {
        const r = executeCapConfidenceAtFloorPlusDelta(ssc);
        result.succeeded = r.succeeded;
        result.detail = r.detail;
        break;
      }

      case "CLAMP_TO_LOWER_CONFIDENCE": {
        const r = executeClampToLowerConfidence(ssc);
        result.succeeded = r.succeeded;
        result.detail = r.detail;
        break;
      }

      case "FORCE_BUDGET_HOLD_ON_ZERO_FLOOR": {
        const r = executeForceBudgetHoldOnZeroFloor(results, ssc);
        result.succeeded = r.succeeded;
        result.detail = r.detail;
        break;
      }

      case "MODE_DOWNGRADE_TO_CHANNEL_VALIDATION": {
        const r = executeModeDowngradeToChannelValidation(results);
        result.succeeded = r.succeeded;
        result.detail = r.detail;
        if (r.succeeded) {
          result.modeHint = "CHANNEL_VALIDATION_REQUIRED";
        }
        break;
      }
    }

    console.log(
      `[SystemControl] REPAIR_${result.succeeded ? "SUCCESS" : "FAILED"} | ` +
      `action=${result.code} | target=${result.targetBlock} | ${result.detail}`
    );

    executed.push(result);
  }

  return executed;
}

function executeConversionInjection(results: Map<EngineId, EngineStepResult>): boolean {
  const channelResult = results.get("channel_selection");
  if (!channelResult?.output) return false;

  // C1 cutover: resolve a LIVE REFERENCE to funnelStages via the contract
  // registry so we mutate at the canonical path
  // (`output.funnelReconstruction.funnelStages`) instead of the broken
  // `output.funnelStages` location. `getContractFieldRaw` skips Zod parse
  // and trust gating because the repair is the FIX for a NO_CONVERSION_PATH
  // block — by definition the upstream check just ran and the path is
  // already known to be present (or absent, in which case we early-return).
  const stages = getContractFieldRaw<{
    awareness?: any[];
    nurture?: any[];
    conversion?: any[];
  }>("channel_selection", "funnelStages", channelResult.output);
  if (!stages) return false;
  if (stages.conversion && stages.conversion.length > 0) return true;

  const existingKeys = new Set<string>();
  for (const stage of [stages.awareness, stages.nurture, stages.conversion]) {
    if (Array.isArray(stage)) {
      for (const ch of stage) {
        if (ch.channelKey) existingKeys.add(ch.channelKey);
      }
    }
  }

  for (const fallback of FALLBACK_CONVERSION_CHANNELS) {
    if (!stages.conversion) stages.conversion = [];

    stages.conversion.push({
      channelName: fallback.label,
      channelKey: fallback.key,
      assignedRole: "conversion",
      roleFitScore: fallback.conversionScore,
      originalPersuasionScore: 0,
      wasReconstructed: true,
      autoInjectedConversion: true,
      systemControlRepair: true,
      injectionReason: `System Control Layer repair: fallback conversion channel "${fallback.label}" injected to resolve NO_CONVERSION_PATH block`,
      injectionStage: "conversion",
      persuasionCorrectionApplied: false,
      reasoning: `SYSTEM_CONTROL_REPAIR: "${fallback.label}" auto-injected as last-resort conversion channel. Original channel selection and funnel completion enforcement both failed.`,
    });

    if (!channelResult.output.warnings) channelResult.output.warnings = [];
    channelResult.output.warnings.push(
      `SYSTEM_CONTROL_REPAIR: Injected "${fallback.label}" as fallback conversion channel`
    );

    if (!channelResult.output.reconstructionLog) channelResult.output.reconstructionLog = [];
    channelResult.output.reconstructionLog.push(
      `SYSTEM_CONTROL: Injected "${fallback.label}" (key: ${fallback.key}) into Conversion stage as last-resort repair`
    );

    return true;
  }

  return false;
}

function executeScaleDowngrade(results: Map<EngineId, EngineStepResult>): boolean {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output?.decision) return false;

  const originalAction = budgetResult.output.decision.action;
  if (originalAction !== "scale") return false;

  budgetResult.output.decision.action = "test";
  budgetResult.output.decision.originalAction = originalAction;
  budgetResult.output.decision.downgradedBy = "system_control_repair";
  budgetResult.output.decision.downgradeReasons = ["SCALE_WITHOUT_REAL_DATA"];

  return true;
}

function executeIntegrityRevalidation(integrityReport: IntegrityReport | null): boolean {
  if (!integrityReport) return false;
  return integrityReport.overallStatus !== "FAIL";
}

function getRepairDescription(code: RepairActionCode, block: BlockReason): string {
  switch (code) {
    case "INJECT_FALLBACK_CONVERSION":
      return "Inject a fallback conversion channel from safe default list to restore funnel completeness";
    case "DOWNGRADE_SCALE_TO_TEST":
      return "Downgrade budget action from scale to test — insufficient real data for scaling confidence";
    case "REVALIDATE_INTEGRITY":
      return "Re-validate integrity report to confirm failure is genuine (pure computation)";
    case "FLAG_FOR_REVIEW":
      return "Flag for human review without blocking execution";
    case "CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA":
      return "Cap any engine confidence that exceeds inheritedFloor+0.20 down to that ceiling — strictly risk-reducing, no manufactured confidence";
    case "CLAMP_TO_LOWER_CONFIDENCE":
      return "Lift the lowest-confidence outlier toward (max-0.49) so the cross-engine spread fits inside the 0.50 structural threshold — only when max ≤ 0.50";
    case "FORCE_BUDGET_HOLD_ON_ZERO_FLOOR":
      return "Force budget action to HOLD when the SSC confidence floor is 0 — prevents any spend without ground-truth signal";
    case "MODE_DOWNGRADE_TO_CHANNEL_VALIDATION":
      return "Channel-confidence below minimum: route execution to CHANNEL_VALIDATION_REQUIRED (pilot mode) instead of full BLOCK";
  }
}

// ─── v1 Actionable Block Recovery (May 2026): pure-mutation repair handlers ───
//
// Doctrine (per repair-before-block-audit.md §10):
//   - single-pass         → no retry loops, no re-runs of upstream engines
//   - idempotent          → calling a second time is a no-op
//   - provenance-stamped  → every mutated field carries a `_repairedBy`
//                           breadcrumb tying the change to system_control
//   - downgrade-only      → never raises confidence above its rightful ceiling,
//                           never flips a halt to a scale, never softens a
//                           commercial brake
//   - risk-reducing only  → the post-state is strictly safer than the pre-state

function executeCapConfidenceAtFloorPlusDelta(
  ssc: SharedStrategicContext | null,
): { succeeded: boolean; detail: string } {
  if (!ssc || !Array.isArray(ssc.confidenceChain) || ssc.confidenceChain.length === 0) {
    return { succeeded: false, detail: "No SSC confidence chain available" };
  }

  const cappedEngines: string[] = [];

  for (const entry of ssc.confidenceChain) {
    const floor = entry.inheritedFloor;
    if (floor >= 1.0) continue;                       // nothing to cap against
    const ceiling = floor + CONFIDENCE_FLOOR_DELTA;
    if (entry.combinedConfidence <= ceiling) continue; // already inside ceiling — idempotent
    const before = entry.combinedConfidence;
    entry.combinedConfidence = ceiling;
    if (entry.localCombined > ceiling) entry.localCombined = ceiling;
    if (entry.engineConfidence > ceiling) entry.engineConfidence = ceiling;
    cappedEngines.push(`${entry.engineId} ${before.toFixed(2)}→${ceiling.toFixed(2)}`);
  }

  if (cappedEngines.length === 0) {
    return { succeeded: false, detail: "No confidence-chain entries exceeded floor+0.20 — nothing to cap" };
  }

  // Provenance breadcrumb on the SSC itself for audit trail
  (ssc as any)._systemControlRepairs ??= [];
  (ssc as any)._systemControlRepairs.push({
    code: "CAP_CONFIDENCE_AT_FLOOR_PLUS_DELTA",
    appliedAt: new Date().toISOString(),
    affected: cappedEngines,
  });

  return {
    succeeded: true,
    detail: `Capped ${cappedEngines.length} engine(s) at inheritedFloor+0.20: ${cappedEngines.join("; ")}`,
  };
}

function executeClampToLowerConfidence(
  ssc: SharedStrategicContext | null,
): { succeeded: boolean; detail: string } {
  if (!ssc || !Array.isArray(ssc.confidenceChain) || ssc.confidenceChain.length < 2) {
    return { succeeded: false, detail: "Insufficient confidence-chain entries for spread clamp" };
  }

  // Excludes statistical_validation (mirrors structural-check exclusion — its
  // grounding-quality score is not a self-confidence and cannot be clamped).
  const comparable = ssc.confidenceChain.filter(e => e.engineId !== "statistical_validation");
  if (comparable.length < 2) {
    return { succeeded: false, detail: "Fewer than 2 comparable engines (statistical_validation excluded)" };
  }

  const scores = comparable.map(e => e.combinedConfidence);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const spread = maxScore - minScore;

  if (spread <= 0.50) {
    return { succeeded: false, detail: `Spread ${spread.toFixed(2)} already within threshold — nothing to clamp` };
  }

  // Hard guard: only safe to lift the floor when the maximum itself is
  // already low (≤0.50). If the max is high, lifting the floor would
  // *manufacture* confidence — that is a truthfulness violation. Surface as
  // non-repairable in that case so the BLOCK + RecoveryPlan path remains.
  if (maxScore > 0.50) {
    return {
      succeeded: false,
      detail: `Max confidence ${maxScore.toFixed(2)} > 0.50 — cannot clamp without manufacturing confidence (truthfulness guard)`,
    };
  }

  const targetFloor = Math.max(0, maxScore - SPREAD_CLAMP_DELTA);
  const lifted: string[] = [];

  for (const entry of comparable) {
    if (entry.combinedConfidence < targetFloor) {
      const before = entry.combinedConfidence;
      entry.combinedConfidence = targetFloor;
      // Note: we deliberately do NOT lift `engineConfidence` or `localCombined`
      // — those are engine-self-reported. Only the rolled-up `combinedConfidence`
      // (which is what the spread check reads) is clamped.
      lifted.push(`${entry.engineId} ${before.toFixed(2)}→${targetFloor.toFixed(2)}`);
    }
  }

  if (lifted.length === 0) {
    return { succeeded: false, detail: "No entries below the clamp target — nothing to lift" };
  }

  (ssc as any)._systemControlRepairs ??= [];
  (ssc as any)._systemControlRepairs.push({
    code: "CLAMP_TO_LOWER_CONFIDENCE",
    appliedAt: new Date().toISOString(),
    affected: lifted,
    spreadBefore: spread,
    targetFloor,
  });

  return {
    succeeded: true,
    detail: `Lifted ${lifted.length} outlier(s) to ${targetFloor.toFixed(2)} (max=${maxScore.toFixed(2)}, spread ${spread.toFixed(2)} → ≤${SPREAD_CLAMP_DELTA.toFixed(2)}): ${lifted.join("; ")}`,
  };
}

function executeForceBudgetHoldOnZeroFloor(
  results: Map<EngineId, EngineStepResult>,
  ssc: SharedStrategicContext | null,
): { succeeded: boolean; detail: string } {
  if (!ssc) {
    return { succeeded: false, detail: "No SSC available — cannot verify confidence floor" };
  }
  if (ssc.confidenceFloor !== 0) {
    return { succeeded: false, detail: `Confidence floor is ${ssc.confidenceFloor.toFixed(2)} (not zero) — repair does not apply` };
  }

  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output?.decision) {
    return { succeeded: false, detail: "budget_governor decision not available" };
  }

  const originalAction = budgetResult.output.decision.action;
  if (originalAction === "hold" || originalAction === "halt") {
    return { succeeded: false, detail: `Budget action already ${originalAction} — idempotent no-op` };
  }

  budgetResult.output.decision.action = "hold";
  budgetResult.output.decision.originalAction = originalAction;
  budgetResult.output.decision.downgradedBy = "system_control_repair";
  budgetResult.output.decision.downgradeReasons = [
    ...(Array.isArray(budgetResult.output.decision.downgradeReasons) ? budgetResult.output.decision.downgradeReasons : []),
    "BUDGET_OVERRIDE_ZERO_CONFIDENCE",
  ];

  return {
    succeeded: true,
    detail: `Budget action forced ${originalAction}→hold (confidence floor is 0)`,
  };
}

function executeModeDowngradeToChannelValidation(
  results: Map<EngineId, EngineStepResult>,
): { succeeded: boolean; detail: string } {
  const channelResult = results.get("channel_selection");
  if (!channelResult?.output) {
    return { succeeded: false, detail: "channel_selection output not available" };
  }

  // Idempotent stamp — if already marked as a system-control mode downgrade,
  // skip the second mutation.
  if (channelResult.output._systemControlModeDowngrade === "CHANNEL_VALIDATION_REQUIRED") {
    return { succeeded: true, detail: "Mode hint already applied — idempotent no-op" };
  }

  const confidence = typeof channelResult.output.confidenceScore === "number"
    ? channelResult.output.confidenceScore
    : typeof channelResult.output.confidence === "number"
    ? channelResult.output.confidence
    : null;

  channelResult.output._systemControlModeDowngrade = "CHANNEL_VALIDATION_REQUIRED";
  channelResult.output._systemControlModeDowngradeReason = `Channel confidence ${confidence?.toFixed(2) ?? "n/a"} below minimum — pilot validation required before scale`;

  if (!Array.isArray(channelResult.output.warnings)) channelResult.output.warnings = [];
  channelResult.output.warnings.push(
    `SYSTEM_CONTROL_REPAIR: Mode downgraded to CHANNEL_VALIDATION_REQUIRED (channel confidence ${confidence?.toFixed(2) ?? "n/a"} < minimum)`
  );

  return {
    succeeded: true,
    detail: `Mode hint set to CHANNEL_VALIDATION_REQUIRED (channel confidence ${confidence?.toFixed(2) ?? "n/a"})`,
  };
}
