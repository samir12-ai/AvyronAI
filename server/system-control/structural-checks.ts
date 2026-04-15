import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { ComplianceResult } from "../causal-enforcement-layer/engine";
import type { SignalComposition } from "../shared/signal-lineage";
import type { StructuralCheck, BlockReason, Downgrade, BlockCode, DowngradeCode } from "./types";
import {
  FUNNEL_STRENGTH_MINIMUM_FOR_SCALE,
  SIGNAL_TRUST_MINIMUM_FOR_LAUNCH,
  SIGNAL_GROUNDING_FAILURE_THRESHOLD,
  CHANNEL_CONFIDENCE_MINIMUM,
} from "./constants";

export function checkConversionPath(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const channelResult = results.get("channel_selection");
  if (!channelResult || channelResult.status === "SKIPPED" || channelResult.status === "ERROR") {
    return { check: "conversion_path_exists", passed: false, details: "Channel selection engine did not produce output" };
  }

  const output = channelResult.output;
  const conversionChannels = output?.funnelStages?.conversion;

  if (!conversionChannels || !Array.isArray(conversionChannels) || conversionChannels.length === 0) {
    const warnings: string[] = output?.warnings || [];
    const hasFunnelGapWarning = warnings.some((w: string) => w.includes("FUNNEL GAP"));
    return {
      check: "conversion_path_exists",
      passed: false,
      details: hasFunnelGapWarning
        ? "No conversion channel assigned and funnel completion enforcement failed"
        : "No conversion channel found in channel selection output",
    };
  }

  return { check: "conversion_path_exists", passed: true, details: `${conversionChannels.length} conversion channel(s) assigned` };
}

export function checkSignalGrounding(
  signalComposition: SignalComposition | null,
  budgetAction: string | null,
): StructuralCheck {
  if (!signalComposition) {
    return { check: "signal_grounding", passed: true, details: "No signal composition data available — check skipped" };
  }

  const hasRealData = signalComposition.realRatio > 0;
  const isScaling = budgetAction === "scale";

  if (isScaling && !hasRealData) {
    return {
      check: "signal_grounding",
      passed: false,
      details: `Budget action is "scale" but realRatio=${signalComposition.realRatio.toFixed(2)} — zero real performance data`,
    };
  }

  if (isScaling && signalComposition.trustedRatio < SIGNAL_TRUST_MINIMUM_FOR_LAUNCH) {
    return {
      check: "signal_grounding",
      passed: false,
      details: `Budget action is "scale" but trustedRatio=${signalComposition.trustedRatio.toFixed(2)} — below ${SIGNAL_TRUST_MINIMUM_FOR_LAUNCH} minimum`,
    };
  }

  return {
    check: "signal_grounding",
    passed: true,
    details: `realRatio=${signalComposition.realRatio.toFixed(2)} trustedRatio=${signalComposition.trustedRatio.toFixed(2)} budgetAction=${budgetAction}`,
  };
}

export function checkIntegrityStatus(integrityReport: IntegrityReport | null): StructuralCheck {
  if (!integrityReport) {
    return { check: "integrity_status", passed: true, details: "No integrity report available — check skipped" };
  }

  if (integrityReport.overallStatus === "FAIL") {
    return {
      check: "integrity_status",
      passed: false,
      details: `Integrity FAIL: ${integrityReport.failureReasons.join("; ")}`,
    };
  }

  return {
    check: "integrity_status",
    passed: true,
    details: `Integrity ${integrityReport.overallStatus} — leakage=${integrityReport.zeroLeakage ? "none" : "detected"} traceability=${integrityReport.traceabilityComplete ? "complete" : "incomplete"}`,
  };
}

export function checkCELCompliance(celResults: ComplianceResult[]): StructuralCheck {
  if (!celResults || celResults.length === 0) {
    return { check: "cel_compliance", passed: true, details: "No CEL results available — check skipped" };
  }

  const failed = celResults.filter((c: any) => c.passed === false || c.overallPassed === false);
  if (failed.length > 0) {
    return {
      check: "cel_compliance",
      passed: false,
      details: `${failed.length} CEL check(s) failed`,
    };
  }

  return { check: "cel_compliance", passed: true, details: `${celResults.length} CEL check(s) passed` };
}

export function checkUpstreamEngineHealth(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const critical: EngineId[] = ["offer", "funnel", "positioning"];
  const failures: string[] = [];

  for (const engineId of critical) {
    const result = results.get(engineId);
    if (result && (result.status === "ERROR" || result.status === "BLOCKED" || result.status === "SIGNAL_BLOCKED")) {
      failures.push(`${engineId}: ${result.status}`);
    }
  }

  if (failures.length > 0) {
    return {
      check: "upstream_engine_health",
      passed: false,
      details: `Critical engine failures: ${failures.join(", ")}`,
    };
  }

  return { check: "upstream_engine_health", passed: true, details: "All critical upstream engines healthy" };
}

export function checkFunnelStructuralCompleteness(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const channelResult = results.get("channel_selection");
  if (!channelResult?.output?.funnelStages) {
    return { check: "funnel_structural_completeness", passed: true, details: "No funnel stage data — check skipped" };
  }

  const stages = channelResult.output.funnelStages;
  const awareness = Array.isArray(stages.awareness) ? stages.awareness.length : 0;
  const nurture = Array.isArray(stages.nurture) ? stages.nurture.length : 0;
  const conversion = Array.isArray(stages.conversion) ? stages.conversion.length : 0;

  const missing: string[] = [];
  if (awareness === 0) missing.push("awareness");
  if (nurture === 0) missing.push("nurture");
  if (conversion === 0) missing.push("conversion");

  if (missing.length > 0) {
    return {
      check: "funnel_structural_completeness",
      passed: false,
      details: `Missing funnel stages: ${missing.join(", ")} (awareness=${awareness}, nurture=${nurture}, conversion=${conversion})`,
    };
  }

  return {
    check: "funnel_structural_completeness",
    passed: true,
    details: `All stages present (awareness=${awareness}, nurture=${nurture}, conversion=${conversion})`,
  };
}

export function checkBudgetFunnelAlignment(results: Map<EngineId, EngineStepResult>): {
  contradiction: boolean;
  details: string;
  downgrade: Downgrade | null;
} {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output) {
    return { contradiction: false, details: "No budget output — check skipped", downgrade: null };
  }

  const action = budgetResult.output.decision?.action;
  const funnelStrength = budgetResult.output.funnelStrengthScore ?? budgetResult.output.decision?.funnelStrengthScore ?? null;

  if (action === "scale" && funnelStrength !== null && funnelStrength < FUNNEL_STRENGTH_MINIMUM_FOR_SCALE) {
    return {
      contradiction: true,
      details: `Budget says "scale" but funnelStrength=${funnelStrength.toFixed(2)} < ${FUNNEL_STRENGTH_MINIMUM_FOR_SCALE} threshold`,
      downgrade: {
        from: "scale",
        to: "test",
        reason: `Funnel strength ${funnelStrength.toFixed(2)} is below scaling threshold ${FUNNEL_STRENGTH_MINIMUM_FOR_SCALE}`,
        code: "WEAK_FUNNEL_FOR_SCALE" as DowngradeCode,
        affectedEngine: "budget_governor",
      },
    };
  }

  return { contradiction: false, details: `Budget action=${action} funnelStrength=${funnelStrength?.toFixed(2) ?? "n/a"} — aligned`, downgrade: null };
}

export function checkBudgetCACVerification(results: Map<EngineId, EngineStepResult>): {
  unverified: boolean;
  details: string;
  downgrade: Downgrade | null;
} {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output) {
    return { unverified: false, details: "No budget output — check skipped", downgrade: null };
  }

  const action = budgetResult.output.decision?.action;
  const warnings: string[] = budgetResult.output.warnings || [];
  const hasNoCACData = warnings.some((w: string) => w.includes("No historical CPA data"));

  if (action === "scale" && hasNoCACData) {
    return {
      unverified: true,
      details: "Budget action is 'scale' but no historical CPA data exists — CAC projections unverified",
      downgrade: {
        from: "scale",
        to: "test",
        reason: "No historical CPA data — scaling with unverified CAC projections",
        code: "UNVERIFIED_CAC" as DowngradeCode,
        affectedEngine: "budget_governor",
      },
    };
  }

  return { unverified: false, details: `Budget action=${action} CPA data=${hasNoCACData ? "missing" : "present"}`, downgrade: null };
}

export function checkValidationResult(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const validationResult = results.get("statistical_validation");
  if (!validationResult || validationResult.status === "SKIPPED") {
    return { check: "validation_result", passed: true, details: "No statistical validation result — check skipped" };
  }

  const output = validationResult.output;
  const result = output?.result || output?.validationResult || output?.status;

  if (result === "rejected" || result === "REJECTED" || result === "fail" || result === "FAIL") {
    return {
      check: "validation_result",
      passed: false,
      details: `Statistical validation result="${result}" — strategy rejected by validation engine`,
    };
  }

  return { check: "validation_result", passed: true, details: `Statistical validation result="${result || "n/a"}"` };
}

export function checkSignalGroundingMassFailure(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const failedEngines: string[] = [];
  const allEngines = Array.from(results.entries());

  for (const [engineId, result] of allEngines) {
    if (result.status === "SIGNAL_BLOCKED" || result.status === "ERROR") {
      failedEngines.push(engineId);
    }
  }

  if (failedEngines.length >= SIGNAL_GROUNDING_FAILURE_THRESHOLD) {
    return {
      check: "signal_grounding_mass_failure",
      passed: false,
      details: `${failedEngines.length} engines in SIGNAL_BLOCKED/ERROR state (threshold=${SIGNAL_GROUNDING_FAILURE_THRESHOLD}): ${failedEngines.join(", ")}`,
    };
  }

  return {
    check: "signal_grounding_mass_failure",
    passed: true,
    details: `${failedEngines.length} engine(s) in failure state — below threshold of ${SIGNAL_GROUNDING_FAILURE_THRESHOLD}`,
  };
}

export function checkOfferAudienceMisalignment(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const offerResult = results.get("offer");
  if (!offerResult?.output) {
    return { check: "offer_audience_misalignment", passed: true, details: "No offer output — check skipped" };
  }

  const output = offerResult.output;
  const warnings: string[] = Array.isArray(output.structuralWarnings) ? output.structuralWarnings : [];
  const alignmentValidation = output.layerDiagnostics?.offerAlignmentValidation || output.offerAlignmentValidation;

  const hasPainMisalignment = warnings.some((w: string) =>
    w.includes("does not reflect any identified audience pain") ||
    w.includes("Market language preservation failed") ||
    w.includes("completely disconnected from market language")
  );

  const alignmentFailed = alignmentValidation && alignmentValidation.aligned === false;

  const integrityChecks = output.layerDiagnostics?.integrityChecks;
  const painNotAligned = integrityChecks && integrityChecks.painAligned === false;

  if (hasPainMisalignment || (alignmentFailed && painNotAligned)) {
    return {
      check: "offer_audience_misalignment",
      passed: false,
      details: `Offer does not address audience pains — ${hasPainMisalignment ? "pain signal mismatch detected" : "alignment validation failed with pain misalignment"}`,
    };
  }

  return { check: "offer_audience_misalignment", passed: true, details: "Offer addresses audience pains" };
}

export function checkZeroObjectionCoverage(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const offerResult = results.get("offer");
  const audienceResult = results.get("audience");
  if (!offerResult?.output || !audienceResult?.output) {
    return { check: "zero_objection_coverage", passed: true, details: "No offer/audience output — check skipped" };
  }

  const objectionMap = audienceResult.output.objectionMap || {};
  const objections = Object.keys(objectionMap);

  if (objections.length === 0) {
    return { check: "zero_objection_coverage", passed: true, details: "No audience objections declared — check not applicable" };
  }

  const offerOutput = offerResult.output;
  const primaryOffer = offerOutput.primaryOffer || offerOutput;
  const objectionHandling = Array.isArray(primaryOffer.objectionHandling) ? primaryOffer.objectionHandling : [];
  const riskNotes = Array.isArray(primaryOffer.riskNotes) ? primaryOffer.riskNotes : [];
  const proofAlignment = Array.isArray(primaryOffer.proofAlignment) ? primaryOffer.proofAlignment :
    (Array.isArray(primaryOffer.proofLayer?.alignedProofTypes) ? primaryOffer.proofLayer.alignedProofTypes : []);

  const hasAnyCoverage = objectionHandling.length > 0 || proofAlignment.length > 0 ||
    riskNotes.some((n: string) => n.toLowerCase().includes("objection") || n.toLowerCase().includes("risk"));

  if (!hasAnyCoverage) {
    return {
      check: "zero_objection_coverage",
      passed: false,
      details: `${objections.length} audience objection(s) exist but offer has zero objection coverage — no objection handling, proof alignment, or risk mitigation`,
    };
  }

  return { check: "zero_objection_coverage", passed: true, details: `Objection coverage present for ${objections.length} audience objection(s)` };
}

export function checkChannelConfidenceMinimum(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const channelResult = results.get("channel_selection");
  if (!channelResult?.output) {
    return { check: "channel_confidence_minimum", passed: true, details: "No channel selection output — check skipped" };
  }

  const output = channelResult.output;
  const confidence = typeof output.confidenceScore === "number" ? output.confidenceScore :
    typeof output.confidence === "number" ? output.confidence : null;

  if (confidence === null) {
    return { check: "channel_confidence_minimum", passed: true, details: "No channel confidence score available — check skipped" };
  }

  if (confidence < CHANNEL_CONFIDENCE_MINIMUM) {
    return {
      check: "channel_confidence_minimum",
      passed: false,
      details: `Channel selection confidence=${confidence.toFixed(2)} is below minimum threshold ${CHANNEL_CONFIDENCE_MINIMUM}`,
    };
  }

  return { check: "channel_confidence_minimum", passed: true, details: `Channel confidence=${confidence.toFixed(2)} meets minimum ${CHANNEL_CONFIDENCE_MINIMUM}` };
}

export function collectBlockReasons(checks: StructuralCheck[], results: Map<EngineId, EngineStepResult>): BlockReason[] {
  const blocks: BlockReason[] = [];

  const budgetResult = results.get("budget_governor");
  const killFlag = budgetResult?.output?.killFlag === true;
  const budgetAction = budgetResult?.output?.decision?.action;

  if (killFlag) {
    blocks.push({
      code: "BUDGET_KILL",
      description: "Budget governor kill flag is active",
      source: "budget_governor",
      severity: "critical",
    });
  }

  if (budgetAction === "halt") {
    blocks.push({
      code: "BUDGET_HALT",
      description: "Budget governor decision is halt",
      source: "budget_governor",
      severity: "critical",
    });
  }

  for (const check of checks) {
    if (check.passed) continue;

    switch (check.check) {
      case "conversion_path_exists":
        blocks.push({
          code: "NO_CONVERSION_PATH",
          description: check.details,
          source: "structural_check",
          severity: "critical",
        });
        break;
      case "signal_grounding":
        blocks.push({
          code: "SCALE_WITHOUT_REAL_DATA",
          description: check.details,
          source: "structural_check",
          severity: "critical",
        });
        break;
      case "integrity_status":
        blocks.push({
          code: "INTEGRITY_FAILURE",
          description: check.details,
          source: "system_integrity",
          severity: "critical",
        });
        break;
      case "cel_compliance":
        blocks.push({
          code: "COMPLIANCE_FAILURE",
          description: check.details,
          source: "cel_enforcement",
          severity: "high",
        });
        break;
      case "validation_result":
        blocks.push({
          code: "VALIDATION_REJECTED",
          description: check.details,
          source: "statistical_validation",
          severity: "critical",
        });
        break;
      case "signal_grounding_mass_failure":
        blocks.push({
          code: "SIGNAL_GROUNDING_MASS_FAILURE",
          description: check.details,
          source: "structural_check",
          severity: "critical",
        });
        break;
      case "offer_audience_misalignment":
        blocks.push({
          code: "OFFER_AUDIENCE_MISALIGNMENT",
          description: check.details,
          source: "offer_engine",
          severity: "high",
        });
        break;
      case "zero_objection_coverage":
        blocks.push({
          code: "ZERO_OBJECTION_COVERAGE",
          description: check.details,
          source: "offer_engine",
          severity: "high",
        });
        break;
      case "channel_confidence_minimum":
        blocks.push({
          code: "CHANNEL_CONFIDENCE_BELOW_MINIMUM",
          description: check.details,
          source: "channel_selection",
          severity: "high",
        });
        break;
    }
  }

  return blocks;
}
