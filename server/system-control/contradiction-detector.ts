import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { Contradiction } from "./types";
import { INTEGRITY_RESTRICT_THRESHOLD } from "./constants";

export function detectContradictions(
  results: Map<EngineId, EngineStepResult>,
  integrityReport: IntegrityReport | null,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  detectBudgetScaleNoConversion(results, contradictions);
  detectBudgetScaleWeakIntegrity(results, integrityReport, contradictions);
  detectApprovedPlanIncompleteContext(results, contradictions);
  detectFunnelPassStructuralWeakness(results, contradictions);
  detectChannelSelectionPersuasionMismatch(results, contradictions);

  return contradictions;
}

function detectBudgetScaleNoConversion(
  results: Map<EngineId, EngineStepResult>,
  contradictions: Contradiction[],
): void {
  const budgetResult = results.get("budget_governor");
  const channelResult = results.get("channel_selection");

  if (!budgetResult?.output || !channelResult?.output) return;

  const action = budgetResult.output.decision?.action;
  const conversionChannels = channelResult.output.funnelStages?.conversion;

  if (action === "scale" && (!conversionChannels || conversionChannels.length === 0)) {
    contradictions.push({
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

  if (action === "scale" && integrityReport.overallStatus === "PARTIAL") {
    contradictions.push({
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
    if (!result || result.status === "SKIPPED" || result.status === "ERROR" || result.status === "BLOCKED") {
      missing.push(engineId);
    }
  }

  if (missing.length > 0) {
    const budgetResult = results.get("budget_governor");
    const action = budgetResult?.output?.decision?.action;
    if (action && action !== "halt") {
      contradictions.push({
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
): void {
  const funnelResult = results.get("funnel");
  const channelResult = results.get("channel_selection");

  if (!funnelResult || !channelResult?.output) return;

  if (funnelResult.status === "SUCCESS") {
    const stages = channelResult.output.funnelStages;
    if (stages) {
      const awarenessCount = Array.isArray(stages.awareness) ? stages.awareness.length : 0;
      const nurtureCount = Array.isArray(stages.nurture) ? stages.nurture.length : 0;
      const conversionCount = Array.isArray(stages.conversion) ? stages.conversion.length : 0;

      if (awarenessCount === 0 || nurtureCount === 0 || conversionCount === 0) {
        contradictions.push({
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
      engineA: "channel_selection",
      engineB: "persuasion",
      description: "Channel selection detected persuasion mode incompatibility with assigned channels",
      resolution: "Review channel-persuasion alignment — funnel reconstruction may reassign roles",
    });
  }
}
