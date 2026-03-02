import type { EngineOutput } from './engine-contract';

export const UNCERTAINTY_DECISIONS = ['PROCEED', 'DOWNGRADE', 'BLOCK'] as const;
export type UncertaintyDecision = (typeof UNCERTAINTY_DECISIONS)[number];

export interface UncertaintyThresholds {
  confidenceProceed: number;
  confidenceDowngrade: number;
  completenessProceed: number;
  completenessDowngrade: number;
  maxCriticalRiskFlags: number;
}

export const DEFAULT_THRESHOLDS: UncertaintyThresholds = {
  confidenceProceed: 60,
  confidenceDowngrade: 40,
  completenessProceed: 60,
  completenessDowngrade: 40,
  maxCriticalRiskFlags: 2,
};

export interface UncertaintyResult {
  decision: UncertaintyDecision;
  aggregatedConfidence: number;
  aggregatedCompleteness: number;
  riskFlags: string[];
  reasoning: string;
}

export function aggregateConfidence(outputs: EngineOutput[]): number {
  if (outputs.length === 0) return 0;
  const total = outputs.reduce((sum, o) => sum + o.confidence, 0);
  return Math.round(total / outputs.length);
}

export function aggregateCompleteness(outputs: EngineOutput[]): number {
  if (outputs.length === 0) return 0;
  return Math.round(Math.min(...outputs.map(o => o.dataCompleteness)));
}

export function collectRiskFlags(outputs: EngineOutput[]): string[] {
  const flags: string[] = [];
  for (const output of outputs) {
    if (output.riskFlag) {
      flags.push(`[${output.scope}] ${output.riskFlag}`);
    }
  }
  return flags;
}

export function evaluateUncertainty(
  outputs: EngineOutput[],
  thresholds: UncertaintyThresholds = DEFAULT_THRESHOLDS
): UncertaintyResult {
  if (outputs.length === 0) {
    return {
      decision: 'BLOCK',
      aggregatedConfidence: 0,
      aggregatedCompleteness: 0,
      riskFlags: [],
      reasoning: 'No engine outputs to evaluate — cannot proceed with empty data.',
    };
  }

  const confidence = aggregateConfidence(outputs);
  const completeness = aggregateCompleteness(outputs);
  const riskFlags = collectRiskFlags(outputs);
  const criticalFlagCount = riskFlags.length;

  if (criticalFlagCount > thresholds.maxCriticalRiskFlags) {
    return {
      decision: 'BLOCK',
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning: `Too many risk flags (${criticalFlagCount}/${thresholds.maxCriticalRiskFlags} max). ` +
        `Flags: [${riskFlags.join('; ')}]. Plan generation halted.`,
    };
  }

  if (confidence < thresholds.confidenceDowngrade || completeness < thresholds.completenessDowngrade) {
    return {
      decision: 'BLOCK',
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning: `Confidence (${confidence}%) or completeness (${completeness}%) below minimum threshold ` +
        `(${thresholds.confidenceDowngrade}%). Insufficient data for reliable plan.`,
    };
  }

  if (confidence < thresholds.confidenceProceed || completeness < thresholds.completenessProceed) {
    return {
      decision: 'DOWNGRADE',
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning: `Confidence (${confidence}%) or completeness (${completeness}%) below proceed threshold ` +
        `(${thresholds.confidenceProceed}%). Recommendations marked as low-confidence.`,
    };
  }

  return {
    decision: 'PROCEED',
    aggregatedConfidence: confidence,
    aggregatedCompleteness: completeness,
    riskFlags,
    reasoning: `All thresholds met. Confidence: ${confidence}%, Completeness: ${completeness}%, ` +
      `Risk flags: ${criticalFlagCount}.`,
  };
}
