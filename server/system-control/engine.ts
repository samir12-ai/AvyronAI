import type {
  SystemControlInput,
  SystemControlVerdict,
  SystemVerdict,
  ExecutionMode,
  BlockReason,
  BlockCode,
  Downgrade,
  StructuralCheck,
  Contradiction,
  RepairAction,
} from "./types";
import {
  checkPipelineCompleteness,
  checkSnapshotFreshness,
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
  checkOfferInputSufficient,
  checkZeroObjectionCoverage,
  checkChannelConfidenceMinimum,
  checkUnresolvedCriticalProblems,
  checkConfidenceChainIntegrity,
  checkPositioningHardGate,
  checkConfidenceSpread,
  checkBudgetOverrideZeroConfidence,
  checkAnalyticalEnrichmentIntegrity,
  checkSignalLineageUnknown,
  checkConfidenceIntegrity,
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
  // Phase R T002 — snapshot freshness gate. Detects engine outputs silently
  // reused from a different jobId / NEEDS_REFRESH / schema-INCOMPATIBLE
  // snapshots. Skipped when currentJobId is not provided (legacy callers).
  structuralChecks.push(checkSnapshotFreshness(input.results, input.config.currentJobId ?? null));
  // Phase C1: pass currentJobId so the contract boundary helper applies its
  // freshness/run-id gating to the funnelStages reads in these checks.
  structuralChecks.push(checkConversionPath(input.results, input.config.currentJobId ?? null));
  structuralChecks.push(checkSignalGrounding(input.signalComposition, budgetAction));
  structuralChecks.push(checkIntegrityStatus(input.integrityReport));
  structuralChecks.push(checkCELCompliance(input.celResults));
  structuralChecks.push(checkUpstreamEngineHealth(input.results));
  structuralChecks.push(checkFunnelStructuralCompleteness(input.results, input.config.currentJobId ?? null));
  structuralChecks.push(checkValidationResult(input.results));
  structuralChecks.push(checkSignalGroundingMassFailure(input.results));
  structuralChecks.push(checkOfferInputSufficient(input.results));
  structuralChecks.push(checkOfferAudienceMisalignment(input.results));
  structuralChecks.push(checkZeroObjectionCoverage(input.results));
  structuralChecks.push(checkChannelConfidenceMinimum(input.results));

  structuralChecks.push(checkUnresolvedCriticalProblems(input.ssc));
  structuralChecks.push(checkConfidenceChainIntegrity(input.ssc));
  structuralChecks.push(checkPositioningHardGate(input.ssc));
  structuralChecks.push(checkConfidenceSpread(input.ssc));
  structuralChecks.push(checkBudgetOverrideZeroConfidence(input.ssc, input.results));
  // Runtime Truth Track (May 2026):
  //   T3.B — AEL partial-build gate (analytical-enrichment integrity)
  //   T1.A — signal-lineage unknown-dominance gate
  // Both pre-existed only as orchestrator console.warns; promoting to
  // structural FAILs so System Control downgrades execution mode instead
  // of letting downstream engines silently consume degraded inputs.
  structuralChecks.push(checkAnalyticalEnrichmentIntegrity(input.analyticalEnrichmentPartial, input.analyticalEnrichmentReason));
  structuralChecks.push(checkSignalLineageUnknown(input.signalComposition));
  structuralChecks.push(checkConfidenceIntegrity(
    input.confidenceIntegrityVerdict,
    input.confidenceIntegrityCriticalAbsent,
    input.confidenceIntegrityDegradedEngines,
  ));

  const contradictions = detectContradictions(
    input.results,
    input.integrityReport,
    input.config.currentJobId ?? null,
  );

  let blockReasons = collectBlockReasons(structuralChecks, input.results);

  const downgrades: Downgrade[] = [];

  // ────────────────────────────────────────────────────────────────────────
  // Runtime Truth Track (May 2026) — convert specific structural FAILs into
  // DOWNGRADES rather than BLOCKS. Per session-plan acceptance these gates
  // (T3.B AEL_PARTIAL, T1.A SIGNAL_LINEAGE_UNKNOWN_DOMINANT, T3.A v2
  // CONFIDENCE_INTEGRITY_DEGRADED) must downgrade execution to
  // REVIEW_REQUIRED, not halt the run. INCOMPLETE confidence integrity
  // remains a hard block (handled by collectBlockReasons).
  // ────────────────────────────────────────────────────────────────────────
  for (const sc of structuralChecks) {
    if (sc.status !== "FAIL") continue;
    if (sc.check === "analytical_enrichment_integrity") {
      downgrades.push({
        from: budgetAction || "test",
        to: "review_required",
        reason: sc.details,
        code: "ANALYTICAL_ENRICHMENT_DEGRADED",
        affectedEngine: "analytical_enrichment_layer",
      });
    } else if (sc.check === "signal_lineage_unknown") {
      downgrades.push({
        from: budgetAction || "test",
        to: "review_required",
        reason: sc.details,
        code: "LINEAGE_UNTRUSTED",
        affectedEngine: "signal_lineage",
      });
    } else if (sc.check === "confidence_integrity" && sc.details.startsWith("DEGRADED")) {
      downgrades.push({
        from: budgetAction || "test",
        to: "review_required",
        reason: sc.details,
        code: "CONFIDENCE_INTEGRITY_DEGRADED",
        affectedEngine: "confidence_integrity",
      });
    }
  }

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
        input.ssc ?? null,
      );

      const resolvedCodes = new Set(
        repairActions
          .filter(a => a.executed && a.succeeded)
          .map(a => a.targetBlock)
      );

      if (resolvedCodes.size > 0) {
        // v1 Actionable Block Recovery (May 2026): preserve the original block
        // reasons keyed by code BEFORE filtering so we can re-attach any block
        // whose post-mutation re-check still FAILs. Without this, a "succeeded"
        // mutation that didn't actually move the structural needle (or a
        // mode-flip handler that doesn't change underlying values) would
        // silently clear the block — violating "verify against post-mutation
        // state".
        const resolvedBlocksByCode = new Map<string, BlockReason>();
        for (const b of blockReasons) {
          if (resolvedCodes.has(b.code)) resolvedBlocksByCode.set(b.code, b);
        }
        blockReasons = blockReasons.filter(b => !resolvedCodes.has(b.code));

        const recheck: StructuralCheck[] = [];
        if (resolvedCodes.has("NO_CONVERSION_PATH")) {
          recheck.push(checkConversionPath(input.results, input.config.currentJobId ?? null));
          recheck.push(checkFunnelStructuralCompleteness(input.results, input.config.currentJobId ?? null));
        }
        if (resolvedCodes.has("SCALE_WITHOUT_REAL_DATA")) {
          const newBudgetAction = input.results.get("budget_governor")?.output?.decision?.action ?? null;
          recheck.push(checkSignalGrounding(input.signalComposition, newBudgetAction));
        }
        // v1 Actionable Block Recovery (May 2026): re-verify the structural
        // check whose target the pure-mutation repair just clamped. SSC was
        // mutated in place; re-checks read the post-mutation state.
        if (resolvedCodes.has("CONFIDENCE_CHAIN_VIOLATION")) {
          recheck.push(checkConfidenceChainIntegrity(input.ssc));
        }
        if (resolvedCodes.has("CONFIDENCE_SPREAD_EXCESSIVE")) {
          recheck.push(checkConfidenceSpread(input.ssc));
        }
        if (resolvedCodes.has("BUDGET_OVERRIDE_ZERO_CONFIDENCE")) {
          recheck.push(checkBudgetOverrideZeroConfidence(input.ssc, input.results));
        }
        if (resolvedCodes.has("CHANNEL_CONFIDENCE_BELOW_MINIMUM")) {
          recheck.push(checkChannelConfidenceMinimum(input.results));
        }

        for (const rc of recheck) {
          const idx = structuralChecks.findIndex(c => c.check === rc.check);
          if (idx >= 0) structuralChecks[idx] = rc;
          else structuralChecks.push(rc);
        }

        // v1 Actionable Block Recovery (May 2026): authoritative re-check gate.
        // For every re-check that still FAILs, locate the repair that targeted
        // the corresponding block code:
        //   - If the repair is a value-mutation (no modeHint) → revert. The
        //     mutation didn't actually fix the structural condition, so the
        //     block must be re-attached and the repair marked unsuccessful.
        //   - If the repair is a mode-flip (modeHint set) → exempt. Mode-flip
        //     repairs (e.g. CHANNEL_VALIDATION_REQUIRED) intentionally accept a
        //     residual structural failure in exchange for a strictly-safer
        //     execution mode, which is the doctrine-compliant resolution.
        const checkToBlockCode: Record<string, string> = {
          conversion_path: "NO_CONVERSION_PATH",
          funnel_structural_completeness: "NO_CONVERSION_PATH",
          signal_grounding: "SCALE_WITHOUT_REAL_DATA",
          confidence_chain_integrity: "CONFIDENCE_CHAIN_VIOLATION",
          confidence_spread: "CONFIDENCE_SPREAD_EXCESSIVE",
          budget_override_zero_confidence: "BUDGET_OVERRIDE_ZERO_CONFIDENCE",
          channel_confidence_minimum: "CHANNEL_CONFIDENCE_BELOW_MINIMUM",
        };
        for (const rc of recheck) {
          if (rc.status !== "FAIL") continue;
          const blockCode = checkToBlockCode[rc.check] as BlockCode | undefined;
          if (!blockCode || !resolvedCodes.has(blockCode)) continue;

          const repair = repairActions.find(a => a.targetBlock === blockCode && a.succeeded);
          if (!repair) continue;
          if (repair.modeHint) continue; // mode-flip exemption — doctrine-allowed

          // Value-mutation repair did not actually resolve the structural
          // condition. Revert: re-attach the original block and downgrade the
          // repair record so verdict synthesis sees an unresolved BLOCK.
          repair.succeeded = false;
          repair.detail = `${repair.detail} | REVERTED: post-repair re-check still FAILed (${rc.details})`;
          const originalBlock = resolvedBlocksByCode.get(blockCode);
          if (originalBlock && !blockReasons.some(b => b.code === blockCode)) {
            blockReasons.push(originalBlock);
          }
          console.warn(
            `[SystemControl] REPAIR_REVERTED | code=${repair.code} | target=${blockCode} | reason=re-check still FAILing post-mutation`
          );
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
      // Phase 6 maturity (May 2026): execute the repairable subset even when
      // non-repairable blocks coexist. Previously we skipped ALL repair actions
      // if any non-repairable block was present — leaving operators with mixed
      // failures whose independent repairable parts still required a manual
      // re-run. Now we attempt the repairable subset; the verdict still
      // reflects the non-repairable blocks (verdict derivation below is
      // unchanged), but the operator gets partial mitigation automatically.
      try {
        const partialRepairs = executeRepairActions(
          assessment.recommendedActions,
          input,
        );
        repairActions = partialRepairs.map(r => ({
          ...r,
          detail: r.succeeded
            ? `${r.detail ?? ""} (partial-repair: non-repairable blocks remain — verdict still reflects them)`.trim()
            : (r.detail ?? "Repair attempt failed"),
        }));
      } catch (e) {
        repairActions = assessment.recommendedActions.map(a => ({
          ...a,
          executed: false,
          succeeded: false,
          detail: `Partial-repair attempt threw — ${(e as Error)?.message ?? "unknown error"}`,
        }));
      }
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
    // v1 Actionable Block Recovery: a successful repair handler may emit a
    // `modeHint` (e.g. CHANNEL_VALIDATION_REQUIRED for channel-confidence
    // mode flips). When present, prefer it over the generic downgrade ladder.
    const modeHint = repairActions.find(a => a.succeeded && a.modeHint)?.modeHint;
    if (modeHint) {
      executionMode = modeHint;
    } else if (downgrades.length > 0) {
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
