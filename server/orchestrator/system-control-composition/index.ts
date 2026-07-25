/**
 * Task #90 / Phase 4-B — system-control-composition.
 *
 * Composes the post-engine control-verdict pipeline:
 *
 *   1. evaluateSystemControl(...) — deterministic verdict from results +
 *      integrity report + CEL results + signal composition + AEL flags +
 *      MI gate rejections + confidence-integrity verdict.
 *   2. designSystemJudgement(...) — commercial overlay (principal call).
 *   3. buildRecoveryPlan(...) → runRecoveryEnrichment(...) — recovery plan
 *      for BLOCK verdicts (strategist overlay).
 *   4. Object.freeze(controlVerdict) — F2/F6 doctrine, post-composition
 *      immutability.
 *
 * This module owns the COMPOSITION ORDER + the freeze invariant. The
 * individual primitives (`evaluateSystemControl`, `buildRecoveryPlan`,
 * `runRecoveryEnrichment`) remain in their own modules; we only orchestrate
 * the call sequence and the read of the canonical verdict shape.
 *
 * Doctrine:
 *   - D1: every read of `controlVerdict.verdict` / `.executionMode` /
 *     `.integrityVerdict` is a direct dotted access, never an `?? alt`
 *     fallback expression.
 *   - D3: composition consumes the strict-enum SystemControlVerdict shape.
 *   - D5: returns a `ComposedSystemControl` envelope with `verdict: null`
 *     when evaluateSystemControl threw — caller MUST detect null and
 *     route through the legacy partial-degradation branch.
 *
 * Side-effect ownership:
 *   - This module DOES freeze the verdict (the freeze invariant IS the
 *     point of the composition seam). Storing the verdict to DB
 *     (`storeControlVerdict`) and the back-compat budget-ledger mirror
 *     remain at the orchestrator seam because they need the `db` handle
 *     and the `budgetDecisionLedger` array.
 */

import { evaluateSystemControl } from "../../system-control/engine";
import type { SystemControlVerdict } from "../../system-control/types";
import type { EngineId, EngineStepResult } from "../priority-matrix";
import type { SharedStrategicContext } from "../shared-strategic-context";

export interface SystemControlCompositionInput {
  results: Map<EngineId, EngineStepResult>;
  integrityReport: any | null;
  celResults: any[];
  signalComposition: any | null;
  sglCoverageSufficient: boolean | null;
  ssc: SharedStrategicContext | null;
  analyticalEnrichmentPartial: boolean;
  analyticalEnrichmentReason: string | null;
  analyticalEnrichmentDownstreamConsumers: number;
  miGateRejections: any[];
  confidenceIntegrityVerdict: any;
  confidenceIntegrityCriticalAbsent: string[];
  confidenceIntegrityDegradedEngines: string[];
  campaignId: string;
  accountId: string;
  currentJobId: string;
  /** Async overlay — invoked after evaluateSystemControl, before freeze. */
  applyCommercialOverlay?: (verdict: SystemControlVerdict) => Promise<void>;
  /** Async overlay — invoked when verdict is BLOCK, before freeze. */
  applyRecoveryPlanOverlay?: (verdict: SystemControlVerdict) => Promise<void>;
}

export interface ComposedSystemControl {
  /** Frozen verdict; `null` when evaluateSystemControl threw. */
  verdict: SystemControlVerdict | null;
  /** Error message when verdict is null (D5 — never silently absent). */
  error: string | null;
}

export async function composeSystemControl(
  input: SystemControlCompositionInput,
): Promise<ComposedSystemControl> {
  let verdict: SystemControlVerdict | null = null;
  try {
    verdict = evaluateSystemControl({
      results: input.results,
      integrityReport: input.integrityReport,
      celResults: input.celResults,
      signalComposition: input.signalComposition,
      sglCoverageSufficient: input.sglCoverageSufficient,
      ssc: input.ssc,
      analyticalEnrichmentPartial: input.analyticalEnrichmentPartial,
      analyticalEnrichmentReason: input.analyticalEnrichmentReason,
      analyticalEnrichmentDownstreamConsumers: input.analyticalEnrichmentDownstreamConsumers,
      miGateRejections: input.miGateRejections,
      confidenceIntegrityVerdict: input.confidenceIntegrityVerdict,
      confidenceIntegrityCriticalAbsent: input.confidenceIntegrityCriticalAbsent,
      confidenceIntegrityDegradedEngines: input.confidenceIntegrityDegradedEngines,
      config: {
        campaignId: input.campaignId,
        accountId: input.accountId,
        currentJobId: input.currentJobId,
      },
    });
  } catch (err: any) {
    // Doctrine: never silently swallow. Surface the error on the envelope
    // so the orchestrator emits its existing SYSTEM_CONTROL_FAILED log
    // line at the seam.
    return { verdict: null, error: err?.message ?? String(err) };
  }

  if (input.applyCommercialOverlay && verdict) {
    try {
      await input.applyCommercialOverlay(verdict);
    } catch (cjErr: any) {
      // Mirror the inline `SYSTEM_CONTROL_COMMERCIAL_FAILED` behavior —
      // commercial overlay failures are non-fatal; verdict still freezes.
      console.warn(
        `[Orchestrator] SYSTEM_CONTROL_COMMERCIAL_FAILED | ${cjErr?.message ?? String(cjErr)}`,
      );
    }
  }

  if (input.applyRecoveryPlanOverlay && verdict && verdict.verdict === "BLOCK") {
    try {
      await input.applyRecoveryPlanOverlay(verdict);
    } catch (rpErr: any) {
      console.warn(
        `[Orchestrator] RECOVERY_PLAN_FAILED | ${rpErr?.message ?? String(rpErr)}`,
      );
    }
  }

  // Freeze invariant — F2/F6 doctrine. Post-composition mutation is
  // structurally impossible after this point.
  if (verdict) {
    try {
      Object.freeze(verdict);
    } catch (frzErr: any) {
      console.warn(
        `[Orchestrator] CONTROL_VERDICT_FREEZE_FAILED | ${frzErr?.message ?? String(frzErr)}`,
      );
    }
  }

  return { verdict, error: null };
}
