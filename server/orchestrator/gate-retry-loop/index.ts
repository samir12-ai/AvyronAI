/**
 * Task #90 / Phase 4-B — gate-retry-loop.
 *
 * Extracts the mid-pipeline gate-retry decision-and-execution block from
 * `runOrchestrator` (~lines 3980-4090). The retry POLICY already lives in
 * `server/decision-policy/retry-policy.ts` (planRetry, U5c cutover); this
 * module is the EXECUTION wrapper — it consults the policy, kicks off the
 * retry with the same per-engine timeout race, runs the post-retry gate
 * check, and returns a typed envelope describing what happened.
 *
 * Doctrine:
 *   - D1: no semantic fallback on `severity` / `retryDecision.onFinalFailure`.
 *     Both are strict-enum reads.
 *   - D3: `GateRetryOutcome.kind` is a strict 4-value union.
 *   - D5: returns one of the four kinds — caller dispatches on `kind`
 *     and MUST handle all four (TypeScript exhaustiveness).
 *
 * This module does NOT mutate the orchestrator's `results` map, the
 * `ssc.problemRegistry`, or the loop's `overallStatus`. All of those
 * side-effects remain at the orchestrator seam — the module returns the
 * intent and the caller applies it. That keeps the module pure (no `db`
 * import, no SSC mutation) and lets the orchestrator continue to own
 * the `break` semantics for the engine loop.
 */

import { planRetry } from "../../decision-policy/retry-policy";
import type { EngineStepResult } from "../priority-matrix";
import { getEngineTimeoutMs, runWithEngineTimeout } from "../engine-timeout-policy";

export type EngineTimeoutMs = number;

export interface MidPipelineGate {
  shouldRetry: boolean;
  reason: string;
  severity: "critical" | "high" | "medium";
  missingFieldId?: string;
  setConfidenceFloor?: number;
}

export interface GateRetryInput {
  engineId: string;
  engineName: string;
  engineIndex: number;
  gateResult: MidPipelineGate;
  /** Deprecated compatibility input. The canonical policy always wins. */
  engineTimeoutMs?: EngineTimeoutMs;
  executeEngine: () => Promise<EngineStepResult>;
  checkMidPipelineGate: (engineId: string, retryResult: EngineStepResult) => MidPipelineGate | null;
}

/**
 * Discriminator-typed outcome the orchestrator dispatches on.
 */
export type GateRetryOutcome =
  | {
      kind: "no_retry_continue";
      /** planRetry rationale string, preserved for log shape. */
      policyRationale: string;
    }
  | {
      kind: "no_retry_block";
      policyRationale: string;
      blockReason: string;
    }
  | {
      kind: "retry_passed";
      retryResult: EngineStepResult;
      policyRationale: string;
    }
  | {
      kind: "retry_failed_continue";
      retryResult: EngineStepResult;
      policyRationale: string;
      retryGate: MidPipelineGate;
    }
  | {
      kind: "retry_failed_block";
      retryResult: EngineStepResult;
      policyRationale: string;
      retryGate: MidPipelineGate;
      blockReason: string;
    };

export async function runGateRetryLoop(input: GateRetryInput): Promise<GateRetryOutcome> {
  const retryDecision = planRetry({
    engineId: input.engineId,
    gateShouldRetry: input.gateResult.shouldRetry,
    gateSeverity: input.gateResult.severity,
    missingFieldId: input.gateResult.missingFieldId,
  });

  if (!retryDecision.retry) {
    if (retryDecision.onFinalFailure === "BLOCK") {
      return {
        kind: "no_retry_block",
        policyRationale: retryDecision.rationale,
        blockReason: `Critical gate failure (no retry): ${input.gateResult.reason}`,
      };
    }
    return {
      kind: "no_retry_continue",
      policyRationale: retryDecision.rationale,
    };
  }

  const timeoutMs = getEngineTimeoutMs(input.engineId as import("../priority-matrix").EngineId);
  const retryResult = await runWithEngineTimeout<EngineStepResult>({
    engineId: input.engineId,
    engineName: input.engineName,
    attempt: 2,
    configuredBudgetMs: timeoutMs,
    currentStage: () => "mid_pipeline_gate_retry",
    run: input.executeEngine,
    onTimeout: () => ({
      engineId: input.engineId as import("../priority-matrix").EngineId,
      status: "TIMEOUT",
      output: null,
      durationMs: timeoutMs,
      error: `Retry timed out after ${timeoutMs / 1000}s`,
    }),
  });

  const retryGate = input.checkMidPipelineGate(input.engineId, retryResult);

  if (retryGate?.shouldRetry === false && !retryGate) {
    // unreachable — narrows below.
  }

  // The original orchestrator code branches on `retryGate?.gateFailed`.
  // `MidPipelineGateResult.gateFailed` and `shouldRetry` are linked — for
  // parity, we treat any truthy retryGate as "gate still failing after
  // retry". The orchestrator inline path only ever assigns `retryGate`
  // when the post-retry gate check reports a failure, so this matches
  // the same observable shape.
  if (retryGate) {
    if (retryDecision.onFinalFailure === "BLOCK") {
      return {
        kind: "retry_failed_block",
        retryResult,
        policyRationale: retryDecision.rationale,
        retryGate,
        blockReason: `Critical gate failure after retry: ${input.gateResult.reason}`,
      };
    }
    return {
      kind: "retry_failed_continue",
      retryResult,
      policyRationale: retryDecision.rationale,
      retryGate,
    };
  }

  return {
    kind: "retry_passed",
    retryResult,
    policyRationale: retryDecision.rationale,
  };
}
