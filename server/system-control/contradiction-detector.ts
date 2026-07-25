import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { Contradiction } from "./types";
import { dedupeContradictions } from "../shared/contradictions";
import { INTEGRITY_RESTRICT_THRESHOLD } from "./constants";
import { requireContractField } from "../orchestrator/contract-registry";
import { requireIntegrityVerdict } from "./integrity-verdict";

// Phase C1: same `funnelStages` cutover as in structural-checks.ts. Both
// detectors below previously read `channelResult.output.funnelStages`
// directly — a path the engine never writes to. Now they go through the
// contract boundary helper so the registry's canonical path resolves.
type ChannelFunnelStages = {
  awareness: any[];
  nurture: any[];
  conversion: any[];
};

function getChannelFunnelStages(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null,
): ChannelFunnelStages | null {
  const fr = requireContractField<ChannelFunnelStages>(
    "channel_selection",
    "funnelStages",
    results,
    currentJobId,
  );
  return fr.status === "OK" ? fr.value : null;
}

export function detectContradictions(
  results: Map<EngineId, EngineStepResult>,
  integrityReport: IntegrityReport | null,
  currentJobId: string | null = null,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  detectBudgetScaleNoConversion(results, contradictions, currentJobId);
  detectBudgetScaleWeakIntegrity(results, integrityReport, contradictions);
  detectApprovedPlanIncompleteContext(results, contradictions);
  detectFunnelPassStructuralWeakness(results, contradictions, currentJobId);
  detectChannelSelectionPersuasionMismatch(results, contradictions);
  detectFunnelIterationConflict(results, contradictions);

  // Phase 3 (Task #66) — ingest integrity-engine LayerResult contradictions
  // into the same dedupe pool. The integrity-engine emits typed
  // Contradiction entries on `layerResult.contradictions` (see
  // server/integrity-engine/engine.ts layer3); shared taxonomy + dedupe
  // collapses any equivalent row already produced by the system-control
  // detectors above. Behavior on missing/legacy shapes is INCOMPLETE-safe:
  // an integrity engine result that lacks layerResults or contradictions
  // simply contributes nothing.
  const integrityEngineOutput = (results.get("integrity") as EngineStepResult | undefined)?.output as
    | { layerResults?: Array<{ contradictions?: Contradiction[] }> }
    | undefined;
  const integrityLayers = integrityEngineOutput?.layerResults;
  if (Array.isArray(integrityLayers)) {
    for (const layer of integrityLayers) {
      if (layer && Array.isArray(layer.contradictions)) {
        for (const c of layer.contradictions) {
          if (c && typeof c === "object") contradictions.push(c);
        }
      }
    }
  }

  // Shared dedupe: same (kind|engineA|engineB) reported by two detectors
  // collapses to the first occurrence — system-control detectors run
  // before integrity-engine entries, so the verdict-owner voice wins.
  return dedupeContradictions(contradictions);
}

/**
 * Phase R (May 2026) — Funnel ↔ Iteration contradiction.
 *
 * The Funnel engine and the Iteration engine evaluate the same conversion
 * machinery from two different windows: structural completeness vs observed
 * performance. When Funnel reports "all good" (conversion path exists,
 * strength score above floor, no structural gaps) but Iteration reports an
 * actual conversion rate well below the success threshold, the two engines
 * are pointing at different realities — the structural model says the funnel
 * works while the live performance says it does not. This is the canonical
 * symptom-of-a-deeper-bug pattern; surfacing it is what stops the system
 * from confidently scaling on top of a phantom funnel.
 *
 * Detector predicate (only fires when both engines actually succeeded):
 *   - Funnel:    hasConversionPath==true AND funnelStrengthScore >= 0.6
 *                AND no FUNNEL_GAP warnings
 *   - Iteration: at least one optimizationTarget with targetArea matching
 *                /conversion/ where currentValue is < 70% of targetValue,
 *                AND iteration's dataReliability.isWeak !== true (so the
 *                signal is not just noise).
 */
function detectFunnelIterationConflict(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
): void {
  const funnelResult = results.get("funnel");
  const iterationResult = results.get("iteration");
  if (!funnelResult?.output || !iterationResult?.output) return;
  if (funnelResult.status !== "SUCCESS" && funnelResult.status !== "PARTIAL") return;
  if (iterationResult.status !== "SUCCESS" && iterationResult.status !== "PARTIAL") return;

  const f = funnelResult.output;
  const fHasPath = f?.hasConversionPath === true || !!f?.conversionStage || !!f?.decisionCTA;
  const fStrength = typeof f?.funnelStrengthScore === "number"
    ? f.funnelStrengthScore
    : (typeof f?.strengthScore === "number" ? f.strengthScore : null);
  const fWarnings: string[] = Array.isArray(f?.structuralWarnings) ? f.structuralWarnings : (Array.isArray(f?.warnings) ? f.warnings : []);
  const fHasGapWarning = fWarnings.some((w: string) => /FUNNEL[_ ]GAP|gap|missing/i.test(w));
  const funnelClaimsHealthy = fHasPath && (fStrength === null || fStrength >= 0.6) && !fHasGapWarning;
  if (!funnelClaimsHealthy) return;

  const it = iterationResult.output;
  const itDataWeak = it?.dataReliability?.isWeak === true;
  if (itDataWeak) return; // iteration itself flagged its data as unreliable — don't fire

  const targets: any[] = Array.isArray(it?.optimizationTargets) ? it.optimizationTargets : [];
  const conversionGap = targets.find((t: any) => {
    if (!t) return false;
    const area = String(t.targetArea || "").toLowerCase();
    if (!/convers/.test(area)) return false;
    const cur = typeof t.currentValue === "number" ? t.currentValue : null;
    const tgt = typeof t.targetValue === "number" ? t.targetValue : null;
    if (cur === null || tgt === null || tgt <= 0) return false;
    return cur < tgt * 0.7;
  });
  if (!conversionGap) return;

  const cur = conversionGap.currentValue;
  const tgt = conversionGap.targetValue;
  contradictions.push({
    kind: "validation_state_vs_decision_action",
    engineA: "funnel",
    engineB: "iteration",
    description:
      `Funnel reports healthy conversion path (hasPath=true, strength=${fStrength?.toFixed(2) ?? "n/a"}, no gap warnings) ` +
      `but Iteration measures conversion ${cur} vs target ${tgt} (${((cur / tgt) * 100).toFixed(0)}% of target) — ` +
      `structural model and observed performance disagree on whether the funnel actually converts.`,
    resolution:
      "Re-run funnel with iteration's observed-performance signals as input, OR mark funnel as STALE_STRUCTURAL_MODEL until reconciled. " +
      "Do not scale on the funnel claim while iteration shows a sub-threshold rate.",
  });
}

function detectBudgetScaleNoConversion(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
  currentJobId: string | null = null,
): void {
  const budgetResult = results.get("budget_governor");
  const channelResult = results.get("channel_selection");

  if (!budgetResult?.output || !channelResult?.output) return;

  const action = budgetResult.output.decision?.action;
  // C1 cutover: contract-boundary read replaces broken `output.funnelStages`.
  const stages = getChannelFunnelStages(results, currentJobId);
  const conversionChannels = stages?.conversion;

  if (action === "scale" && (!conversionChannels || conversionChannels.length === 0)) {
    contradictions.push({
      kind: "budget_scaling_vs_unverified_cac",
      engineA: "budget_governor",
      engineB: "channel_selection",
      description: "Budget governor recommends scaling but no conversion channel exists in the funnel",
      resolution: "Downgrade budget action from 'scale' to 'test' until conversion path is established",
    });
  }
}

function detectBudgetScaleWeakIntegrity(
  results: Map<EngineId, EngineStepResult>,
  integrityReport: IntegrityReport | null,
  contradictions: Contradiction[],
): void {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output || !integrityReport) return;

  const action = budgetResult.output.decision?.action;

  // Phase 3 (Task #66) — canonical integrity-verdict read. INCOMPLETE
  // skips the contradiction (cannot prove disagreement without a
  // verified verdict); FAIL is handled by checkIntegrityStatus + the
  // budget-governor block path, not here.
  const verdict = requireIntegrityVerdict(integrityReport);
  if (action === "scale" && verdict.status === "OK" && verdict.value === "PARTIAL") {
    contradictions.push({
      kind: "budget_scaling_vs_integrity_partial",
      engineA: "budget_governor",
      engineB: "system_integrity",
      description: "Budget governor recommends scaling but system integrity is only PARTIAL",
      resolution: "Downgrade budget action to 'test' until integrity passes fully",
    });
  }
}

function detectApprovedPlanIncompleteContext(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
): void {
  const criticalEngines: EngineId[] = ["audience", "positioning", "offer", "funnel"];
  const missing: string[] = [];

  for (const engineId of criticalEngines) {
    const result = results.get(engineId);
    if (!result || result.status === "SKIPPED" || result.status === "ERROR" || result.status === "BLOCKED" || result.status === "TIMEOUT") {
      missing.push(engineId);
    }
  }

  if (missing.length > 0) {
    const budgetResult = results.get("budget_governor");
    const action = budgetResult?.output?.decision?.action;
    if (action && action !== "halt") {
      contradictions.push({
        kind: "approved_plan_vs_incomplete_context",
        engineA: "orchestrator",
        engineB: missing.join(", "),
        description: `Plan proceeding with budget action "${action}" but critical engines are missing/failed: ${missing.join(", ")}`,
        resolution: "Block plan generation until critical engines produce valid output",
      });
    }
  }
}

function detectFunnelPassStructuralWeakness(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
  currentJobId: string | null = null,
): void {
  const funnelResult = results.get("funnel");
  const channelResult = results.get("channel_selection");

  if (!funnelResult || !channelResult?.output) return;

  if (funnelResult.status === "SUCCESS") {
    // C1 cutover: contract-boundary read replaces broken `output.funnelStages`.
    const stages = getChannelFunnelStages(results, currentJobId);
    if (stages) {
      const awarenessCount = Array.isArray(stages.awareness) ? stages.awareness.length : 0;
      const nurtureCount = Array.isArray(stages.nurture) ? stages.nurture.length : 0;
      const conversionCount = Array.isArray(stages.conversion) ? stages.conversion.length : 0;

      if (awarenessCount === 0 || nurtureCount === 0 || conversionCount === 0) {
        contradictions.push({
          kind: "validation_state_vs_decision_action",
          engineA: "funnel",
          engineB: "channel_selection",
          description: `Funnel engine passed (SUCCESS) but channel selection has incomplete stage coverage: awareness=${awarenessCount}, nurture=${nurtureCount}, conversion=${conversionCount}`,
          resolution: "Flag for review — funnel may need structural reinforcement",
        });
      }
    }
  }
}

function detectChannelSelectionPersuasionMismatch(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
): void {
  const channelResult = results.get("channel_selection");
  if (!channelResult?.output) return;

  const warnings: string[] = channelResult.output.warnings || [];
  const persuasionMismatch = warnings.some((w: string) =>
    w.includes("Persuasion incompatibility") || w.includes("Persuasion mode") && w.includes("incompatible")
  );

  if (persuasionMismatch) {
    contradictions.push({
      kind: "channel_recommendation_vs_low_confidence",
      engineA: "channel_selection",
      engineB: "persuasion",
      description: "Channel selection detected persuasion mode incompatibility with assigned channels",
      resolution: "Review channel-persuasion alignment — funnel reconstruction may reassign roles",
    });
  }
}
