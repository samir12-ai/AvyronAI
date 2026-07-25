/**
 * Post-run projections — Task #70 / Phase 7 — Domain Composition Cleanup.
 *
 * Pre-Task-#70 the orchestrator's `runOrchestrator()` finished by
 * inlining three independent post-run projections — `composeCommercialDNA`,
 * `summarizeConfidenceIntegrity`, and `enrichRecoveryPlan` — each guarded
 * by its own bespoke try/catch with its own log line and silent-fallback
 * shape. That created three near-identical degradation surfaces and made
 * "did the projection run?" a string-search problem across three log tags.
 *
 * This module is the single seam. It returns a `PostRunProjections` bundle
 * with per-projection status so the orchestrator's tail is one call site
 * and the run result surface is structurally identical across pass /
 * partial / failed degradation paths.
 *
 * Hard rules (carried from the inlined code):
 *   - Pure projection. NO network I/O, NO AI calls. The only side-effects
 *     are console.warn lines for operator visibility.
 *   - One try/catch per projection. A failure in one projection MUST NOT
 *     prevent the other two from running, but it MUST surface a typed
 *     status — never a silent absent value (D5 doctrine).
 *   - The `enrichRecoveryPlan` call only runs when the control verdict's
 *     recoveryPlan was already built upstream — this module is read-only
 *     with respect to the verdict object (which the orchestrator freezes
 *     before this point in the pipeline).
 *
 * D5 — every projection has a typed status of:
 *   - "ok"        — projection succeeded
 *   - "failed"    — projection threw (error surfaced + null result)
 *   - "skipped"   — preconditions unmet (e.g. no recovery plan to enrich)
 */

import type { ConfidenceProvenanceLog, ConfidenceIntegritySummary } from "../../shared/confidence-provenance";
import { summarizeConfidenceIntegrity } from "../../shared/confidence-provenance";
import { composeCommercialDNA, type CommercialDNA } from "../../../shared/commercial-dna";
import type { SharedStrategicContext } from "./shared-strategic-context";
import type { EngineId, EngineStepResult } from "./priority-matrix";

/**
 * Task #70 / Phase 7 — recovery enrichment is invoked from this module so
 * the "post-run projection" seam owns all three projections (commercial
 * DNA, confidence integrity, recovery enrichment). The orchestrator calls
 * `runRecoveryEnrichment` BEFORE freezing the control verdict, then
 * `computePostRunProjections` AFTER freeze records the observed status.
 */
export async function runRecoveryEnrichment(input: {
  campaignId: string;
  accountId: string;
  recoveryPlan: any;
  results: Map<EngineId, EngineStepResult>;
}): Promise<{ plan: any; enriched: boolean; error?: string }> {
  try {
    const { enrichRecoveryPlan } = await import("../../system-control/recovery-intelligence");
    const enriched = await enrichRecoveryPlan(input.recoveryPlan, {
      campaignId: input.campaignId,
      accountId: input.accountId,
      results: input.results,
    });
    return { plan: enriched, enriched: true };
  } catch (enrErr: any) {
    const msg = enrErr?.message ?? String(enrErr);
    console.warn(`[PostRunProjections] RECOVERY_INTELLIGENCE_FAILED | ${msg} | shipping deterministic plan`);
    return { plan: input.recoveryPlan, enriched: false, error: msg };
  }
}

export type ProjectionStatus = "ok" | "failed" | "skipped";

export interface ProjectionEnvelope<T> {
  status: ProjectionStatus;
  value: T | null;
  error?: string;
  skipReason?: string;
}

export interface PostRunProjections {
  commercialDna: ProjectionEnvelope<CommercialDNA>;
  confidenceIntegrity: ProjectionEnvelope<ConfidenceIntegritySummary>;
  recoveryEnrichment: ProjectionEnvelope<true>;
}

export interface PostRunProjectionInputs {
  campaignId: string;
  accountId: string;
  ssc: SharedStrategicContext | null | undefined;
  confidenceProvenanceLog: ConfidenceProvenanceLog;
  /** Pre-computed summary from the gating phase. Re-used when present (T3.A v2). */
  prevConfidenceSummary?: ConfidenceIntegritySummary | null;
  results: Map<EngineId, EngineStepResult>;
  /** Frozen control verdict (or null when system-control did not run). */
  controlVerdict: any | null;
}

/**
 * Compute all three post-run projections in a single call. Caller assigns
 * the returned envelopes into the run-result fields they expose.
 *
 * Side-effects: console.warn on per-projection failure (matches prior
 * orchestrator log shape so existing dashboards keep working).
 */
export async function computePostRunProjections(
  input: PostRunProjectionInputs,
): Promise<PostRunProjections> {
  // ── 1. Commercial DNA — pure projection over commercialSignals ──
  let commercialDna: ProjectionEnvelope<CommercialDNA>;
  try {
    const dna = composeCommercialDNA(input.campaignId, input.ssc?.commercialSignals || null);
    console.log(`[Orchestrator] COMMERCIAL_DNA_COMPOSED | engines=${dna.consistency.contributingEngineCount}/5 | full=${dna.consistency.hasFullDna} | contradictions=${dna.consistency.contradictions.length}`);
    if (dna.consistency.contradictions.length > 0) {
      for (const c of dna.consistency.contradictions) {
        console.warn(`[Orchestrator] DNA_CONTRADICTION | ${c}`);
      }
    }
    commercialDna = { status: "ok", value: dna };
  } catch (dnaErr: any) {
    console.warn(`[Orchestrator] COMMERCIAL_DNA_COMPOSE_FAILED | ${dnaErr.message}`);
    commercialDna = { status: "failed", value: null, error: dnaErr?.message ?? String(dnaErr) };
  }

  // ── 2. Confidence integrity — re-use earlier compute if present ──
  let confidenceIntegrity: ProjectionEnvelope<ConfidenceIntegritySummary>;
  try {
    const summary = input.prevConfidenceSummary
      ?? summarizeConfidenceIntegrity(input.confidenceProvenanceLog);
    console.log(
      `[Orchestrator] CONFIDENCE_INTEGRITY | verdict=${summary.verdict} | ` +
      `engines=${summary.totalEngines} | ` +
      `direct=${summary.byProvenance.direct_evidence} | ` +
      `inferred=${summary.byProvenance.inferred_synthesis} | ` +
      `defaultFloor=${summary.byProvenance.default_floor} | ` +
      `absent=${summary.byProvenance.absent} | ` +
      `criticalAbsent=[${summary.criticalAbsentEngines.join(",")}]`
    );
    if (summary.verdict === "INCOMPLETE") {
      console.warn(
        `[Orchestrator] CONFIDENCE_INCOMPLETE | ` +
        `criticalAbsentEngines=${summary.criticalAbsentEngines.join(",")} | ` +
        `reason=critical_engine_emitted_no_confidence_field`
      );
    }
    confidenceIntegrity = { status: "ok", value: summary };
  } catch (ciErr: any) {
    console.warn(`[Orchestrator] CONFIDENCE_INTEGRITY_FAILED | ${ciErr.message}`);
    confidenceIntegrity = { status: "failed", value: null, error: ciErr?.message ?? String(ciErr) };
  }

  // ── 3. Recovery enrichment — strategist overlay if recoveryPlan exists ──
  // NOTE on D4: the orchestrator freezes `controlVerdict` BEFORE this
  // module runs (Task #67 / T-S5-C5). Pre-Task-#70 the recovery
  // enrichment call mutated `controlVerdict.recoveryPlan` in place — that
  // mutation is now structurally impossible after the freeze, so the
  // enrichment is invoked only when the caller wires it BEFORE the freeze.
  // This module records an envelope describing whether enrichment was
  // attempted / succeeded; the caller is responsible for the actual
  // mutation while the verdict is still mutable.
  let recoveryEnrichment: ProjectionEnvelope<true>;
  const recoveryPlan = input.controlVerdict?.recoveryPlan;
  if (!recoveryPlan) {
    recoveryEnrichment = {
      status: "skipped",
      value: null,
      skipReason: "no_recovery_plan_to_enrich",
    };
  } else if (recoveryPlan.intelligence) {
    // already enriched upstream (the orchestrator runs enrichRecoveryPlan
    // BEFORE freeze so the recovery plan is mutable at the point of
    // enrichment); we record the success status here.
    recoveryEnrichment = { status: "ok", value: true };
  } else {
    recoveryEnrichment = {
      status: "failed",
      value: null,
      error: "recovery_plan_present_but_not_enriched",
    };
  }

  return { commercialDna, confidenceIntegrity, recoveryEnrichment };
}
