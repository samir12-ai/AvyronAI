import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { BlockReason, RepairAction, RepairActionCode, BlockCode } from "./types";
import { getContractFieldRaw } from "../orchestrator/contract-registry";

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
  CHANNEL_CONFIDENCE_BELOW_MINIMUM: null,
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
): RepairAction[] {
  const executed: RepairAction[] = [];

  for (const action of actions) {
    const result = { ...action, executed: true };

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
  }
}
