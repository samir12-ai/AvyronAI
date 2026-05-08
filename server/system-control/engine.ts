import type {
  SystemControlInput,
  SystemControlVerdict,
  SystemVerdict,
  ExecutionMode,
  BlockReason,
  Downgrade,
  StructuralCheck,
  Contradiction,
  RepairAction,
} from "./types";
import {
  checkPipelineCompleteness,
  checkConversionPath,
  checkSignalGrounding,
  checkIntegrityStatus,
  checkCELCompliance,
  checkUpstreamEngineHealth,
  checkFunnelStructuralCompleteness,
  checkBudgetFunnelAlignment,
  checkBudgetCACVerification,
  checkValidationResult,
  checkSignalGroundingMassFailure,
  checkOfferAudienceMisalignment,
  checkZeroObjectionCoverage,
  checkChannelConfidenceMinimum,
  checkUnresolvedCriticalProblems,
  checkConfidenceChainIntegrity,
  checkPositioningHardGate,
  checkConfidenceSpread,
  checkBudgetOverrideZeroConfidence,
  collectBlockReasons,
} from "./structural-checks";
import { detectContradictions } from "./contradiction-detector";
import { assessRepairability, executeRepairActions } from "./repair-actions";
import { CONTROL_VERSION, INTEGRITY_RESTRICT_THRESHOLD } from "./constants";
import { isUnverified, isVerifiedPass, isVerifiedFail } from "./types";

export function evaluateSystemControl(input: SystemControlInput, options?: { shadowMode?: boolean }): SystemControlVerdict {
  const shadowMode = options?.shadowMode ?? false;
  const startTime = Date.now();

  const budgetResult = input.results.get("budget_governor");
  const budgetAction = budgetResult?.output?.decision?.action ?? null;

  const structuralChecks: StructuralCheck[] = [];

  // Phase R: pipeline-completeness gate runs FIRST so any missing/timed-out
  // required engine is detected before downstream checks attempt to read
  // their (absent) outputs. This is the global guard against a confident
  // PASS verdict from a partially-failed pipeline.
  structuralChecks.push(checkPipelineCompleteness(input.results));
  structuralChecks.push(checkConversionPath(input.results));
  structuralChecks.push(checkSignalGrounding(input.signalComposition, budgetAction));
  structuralChecks.push(checkIntegrityStatus(input.integrityReport));
  structuralChecks.push(checkCELCompliance(input.celResults));
  structuralChecks.push(checkUpstreamEngineHealth(input.results));
  structuralChecks.push(checkFunnelStructuralCompleteness(input.results));
  structuralChecks.push(checkValidationResult(input.results));
  structuralChecks.push(checkSignalGroundingMassFailure(input.results));
  structuralChecks.push(checkOfferAudienceMisalignment(input.results));
  structuralChecks.push(checkZeroObjectionCoverage(input.results));
  structuralChecks.push(checkChannelConfidenceMinimum(input.results));

  structuralChecks.push(checkUnresolvedCriticalProblems(input.ssc));
  structuralChecks.push(checkConfidenceChainIntegrity(input.ssc));
  structuralChecks.push(checkPositioningHardGate(input.ssc));
  structuralChecks.push(checkConfidenceSpread(input.ssc));
  structuralChecks.push(checkBudgetOverrideZeroConfidence(input.ssc, input.results));

  const contradictions = detectContradictions(input.results, input.integrityReport);

  let blockReasons = collectBlockReasons(structuralChecks, input.results);

  const downgrades: Downgrade[] = [];

  const budgetFunnelCheck = checkBudgetFunnelAlignment(input.results);
  if (budgetFunnelCheck.contradiction && budgetFunnelCheck.downgrade) {
    downgrades.push(budgetFunnelCheck.downgrade);
  }

  const cacCheck = checkBudgetCACVerification(input.results);
  if (cacCheck.unverified && cacCheck.downgrade) {
    downgrades.push(cacCheck.downgrade);
  }

  if (
    input.integrityReport?.overallStatus === "PARTIAL" &&
    budgetAction === "test"
  ) {
    downgrades.push({
      from: "test",
      to: "hold",
      reason: "Integrity is PARTIAL — downgrade from test to hold until integrity improves",
      code: "INTEGRITY_PARTIAL",
      affectedEngine: "budget_governor",
    });
  }

  if (
    input.signalComposition &&
    input.signalComposition.trustedRatio < 0.3 &&
    budgetAction === "test"
  ) {
    downgrades.push({
      from: "test",
      to: "hold",
      reason: `Trusted signal ratio ${input.signalComposition.trustedRatio.toFixed(2)} is below 0.30 — downgrade from test to hold`,
      code: "LOW_SIGNAL_TRUST",
      affectedEngine: "budget_governor",
    });
  }

  let repairActions: RepairAction[] = [];
  let repairAttempted = false;

  if (blockReasons.length > 0 && !shadowMode) {
    const assessment = assessRepairability(blockReasons);

    if (assessment.repairable) {
      repairAttempted = true;
      repairActions = executeRepairActions(
        assessment.recommendedActions,
        input.results,
        input.integrityReport,
      );

      const resolvedCodes = new Set(
        repairActions
          .filter(a => a.executed && a.succeeded)
          .map(a => a.targetBlock)
      );

      if (resolvedCodes.size > 0) {
        blockReasons = blockReasons.filter(b => !resolvedCodes.has(b.code));

        const recheck: StructuralCheck[] = [];
        if (resolvedCodes.has("NO_CONVERSION_PATH")) {
          recheck.push(checkConversionPath(input.results));
          recheck.push(checkFunnelStructuralCompleteness(input.results));
        }
        if (resolvedCodes.has("SCALE_WITHOUT_REAL_DATA")) {
          const newBudgetAction = input.results.get("budget_governor")?.output?.decision?.action ?? null;
          recheck.push(checkSignalGrounding(input.signalComposition, newBudgetAction));
        }

        for (const rc of recheck) {
          const idx = structuralChecks.findIndex(c => c.check === rc.check);
          if (idx >= 0) structuralChecks[idx] = rc;
          else structuralChecks.push(rc);
        }

        const postRepairBudgetAction = input.results.get("budget_governor")?.output?.decision?.action ?? null;
        if (postRepairBudgetAction !== budgetAction) {
          downgrades.length = 0;

          const postBudgetFunnelCheck = checkBudgetFunnelAlignment(input.results);
          if (postBudgetFunnelCheck.contradiction && postBudgetFunnelCheck.downgrade) {
            downgrades.push(postBudgetFunnelCheck.downgrade);
          }

          const postCacCheck = checkBudgetCACVerification(input.results);
          if (postCacCheck.unverified && postCacCheck.downgrade) {
            downgrades.push(postCacCheck.downgrade);
          }

          if (
            input.integrityReport?.overallStatus === "PARTIAL" &&
            postRepairBudgetAction === "test"
          ) {
            downgrades.push({
              from: "test",
              to: "hold",
              reason: "Integrity is PARTIAL — downgrade from test to hold until integrity improves",
              code: "INTEGRITY_PARTIAL",
              affectedEngine: "budget_governor",
            });
          }

          if (
            input.signalComposition &&
            input.signalComposition.trustedRatio < 0.3 &&
            postRepairBudgetAction === "test"
          ) {
            downgrades.push({
              from: "test",
              to: "hold",
              reason: `Trusted signal ratio ${input.signalComposition.trustedRatio.toFixed(2)} is below 0.30 — downgrade from test to hold`,
              code: "LOW_SIGNAL_TRUST",
              affectedEngine: "budget_governor",
            });
          }
        }
      }
    } else if (assessment.repairableBlocks.length > 0) {
      repairActions = assessment.recommendedActions.map(a => ({
        ...a,
        executed: false,
        succeeded: false,
        detail: "Repair skipped — non-repairable blocks also present",
      }));
    }
  }

  let verdict: SystemVerdict;
  let executionMode: ExecutionMode;

  // Phase R (May 2026): truthful verdict derivation. A verdict can never be
  // PASS/FULL_EXECUTION when one or more required checks could not actually
  // be verified. Distinguish three block flavours:
  //   - Reliability blocks (PIPELINE_INCOMPLETE / ENGINE_TIMEOUT /
  //     STALE_SNAPSHOT_EVIDENCE) → SYSTEM_UNTRUSTED, never auto-execute, no
  //     repair (you cannot "repair" a pipeline that never ran).
  //   - Real verified failures (NO_CONVERSION_PATH etc.) → HALTED with the
  //     existing repair pathway.
  //   - Both present → SYSTEM_UNTRUSTED takes priority because the verified
  //     failures themselves can't be trusted on top of an unverified pipeline.
  const reliabilityBlockCodes = new Set<string>(["PIPELINE_INCOMPLETE", "ENGINE_TIMEOUT", "STALE_SNAPSHOT_EVIDENCE"]);
  const reliabilityBlocks = blockReasons.filter(b => reliabilityBlockCodes.has(b.code));
  const hasReliabilityBlock = reliabilityBlocks.length > 0;

  if (hasReliabilityBlock) {
    verdict = "BLOCK";
    executionMode = "SYSTEM_UNTRUSTED";
  } else if (blockReasons.length > 0) {
    verdict = "BLOCK";
    executionMode = "HALTED";
  } else if (repairAttempted && repairActions.some(a => a.succeeded)) {
    verdict = "REPAIR";
    if (downgrades.length > 0) {
      const hasScaleDowngrade = downgrades.some(d => d.from === "scale");
      const hasTestDowngrade = downgrades.some(d => d.from === "test");
      if (hasScaleDowngrade) executionMode = "TEST_ONLY";
      else if (hasTestDowngrade) executionMode = "RESTRICTED_EXECUTION";
      else executionMode = "RESTRICTED_EXECUTION";
    } else {
      executionMode = "REVIEW_REQUIRED";
    }
  } else if (downgrades.length > 0) {
    verdict = "DOWNGRADE";
    const hasScaleDowngrade = downgrades.some(d => d.from === "scale");
    const hasTestDowngrade = downgrades.some(d => d.from === "test");

    if (hasScaleDowngrade) {
      executionMode = "TEST_ONLY";
    } else if (hasTestDowngrade) {
      executionMode = "RESTRICTED_EXECUTION";
    } else {
      executionMode = "RESTRICTED_EXECUTION";
    }
  } else if (contradictions.length > 0) {
    verdict = "DOWNGRADE";
    // Phase R: when there is a contradiction with no auto-resolution path the
    // system must surface it as NEEDS_RECONCILIATION rather than silently
    // downgrade to REVIEW_REQUIRED. Funnel↔Iteration in particular cannot be
    // resolved without rerunning Funnel against Iteration's observed signals.
    const hasUnresolvable = contradictions.some(c =>
      (c.engineA === "funnel" && c.engineB === "iteration") ||
      (c.engineA === "iteration" && c.engineB === "funnel")
    );
    executionMode = hasUnresolvable ? "NEEDS_RECONCILIATION" : "REVIEW_REQUIRED";
    downgrades.push({
      from: budgetAction || "test",
      to: hasUnresolvable ? "needs_reconciliation" : "review_required",
      reason: `${contradictions.length} cross-engine contradiction(s) detected — verdict cannot be PASS until resolved` +
        (hasUnresolvable ? " (Funnel↔Iteration disagreement requires rerun, not auto-downgrade)" : ""),
      code: "CROSS_ENGINE_CONTRADICTIONS",
      affectedEngine: "system_control",
    });
  } else {
    verdict = "PASS";
    executionMode = "FULL_EXECUTION";
  }

  const durationMs = Date.now() - startTime;

  const result: SystemControlVerdict = {
    verdict,
    executionMode,
    blockReasons,
    downgrades,
    structuralChecks,
    contradictions,
    repairActions,
    repairAttempted,
    timestamp: new Date(),
    durationMs,
    controlVersion: CONTROL_VERSION,
    shadowMode,
  };

  logVerdict(result, input.config);

  return result;
}

function logVerdict(verdict: SystemControlVerdict, config: { campaignId: string; accountId: string }): void {
  // Phase R (May 2026): only count *verified* PASS as passed. A check that
  // returned NOT_REACHED/TIMEOUT/STALE/UNKNOWN/SKIPPED is unverified and must
  // never be reported as "passed" in dashboards or logs.
  const checksPass = verdict.structuralChecks.filter(isVerifiedPass).length;
  const checksFail = verdict.structuralChecks.filter(isVerifiedFail).length;
  const checksUnverified = verdict.structuralChecks.filter(isUnverified).length;
  const checksSkipped = verdict.structuralChecks.filter(c => c.status === "SKIPPED").length;
  const checksTotal = verdict.structuralChecks.length;

  console.log(
    `[SystemControl] ${verdict.shadowMode ? "SHADOW" : "ACTIVE"} | ` +
    `verdict=${verdict.verdict} | mode=${verdict.executionMode} | ` +
    `blocks=${verdict.blockReasons.length} | downgrades=${verdict.downgrades.length} | ` +
    `contradictions=${verdict.contradictions.length} | ` +
    `repairs=${verdict.repairActions.filter(a => a.succeeded).length}/${verdict.repairActions.length} | ` +
    `checks=${checksPass}/${checksTotal} verified-pass (failed=${checksFail}, unverified=${checksUnverified}, skipped=${checksSkipped}) | ` +
    `campaign=${config.campaignId} | ${verdict.durationMs}ms`
  );

  if (verdict.blockReasons.length > 0) {
    for (const block of verdict.blockReasons) {
      console.log(`[SystemControl] BLOCK_REASON | code=${block.code} | severity=${block.severity} | ${block.description}`);
    }
  }

  if (verdict.downgrades.length > 0) {
    for (const dg of verdict.downgrades) {
      console.log(`[SystemControl] DOWNGRADE | ${dg.from}→${dg.to} | code=${dg.code} | engine=${dg.affectedEngine} | ${dg.reason}`);
    }
  }

  if (verdict.repairActions.length > 0) {
    for (const ra of verdict.repairActions) {
      const status = !ra.executed ? "PENDING" : ra.succeeded ? "RESOLVED" : "FAILED";
      console.log(`[SystemControl] REPAIR_ACTION | ${status} | code=${ra.code} | target=${ra.targetBlock} | ${ra.detail || ra.description}`);
    }
  }

  if (verdict.contradictions.length > 0) {
    for (const c of verdict.contradictions) {
      console.log(`[SystemControl] CONTRADICTION | ${c.engineA} vs ${c.engineB} | ${c.description}`);
    }
  }

  for (const check of verdict.structuralChecks) {
    if (isVerifiedFail(check)) {
      console.log(`[SystemControl] CHECK_FAILED | ${check.check} | ${check.details}`);
    } else if (isUnverified(check)) {
      console.log(`[SystemControl] CHECK_UNVERIFIED | ${check.check} | status=${check.status} | ${check.unverifiedReason ?? check.details}`);
    }
  }

  const sscChecks = verdict.structuralChecks.filter(c =>
    c.check.startsWith("unresolved_critical") ||
    c.check.startsWith("confidence_chain") ||
    c.check.startsWith("positioning_hard") ||
    c.check.startsWith("confidence_spread") ||
    c.check.startsWith("budget_override_zero")
  );
  if (sscChecks.length > 0) {
    const sscPass = sscChecks.filter(isVerifiedPass).length;
    const sscFail = sscChecks.filter(isVerifiedFail).length;
    const sscUnverified = sscChecks.filter(isUnverified).length;
    console.log(`[SystemControl] SSC_CHECKS | verified-pass=${sscPass} failed=${sscFail} unverified=${sscUnverified} | total=${sscChecks.length}`);
  }
}
