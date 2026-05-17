export {
  OUTPUT_TYPES,
  SECTIONS,
  type OutputType,
  type Section,
  canSectionConsume,
  validateSectionConsumption,
  getConsumableOutputs,
  getProducibleOutputs,
  OutputTypeError,
} from './output-types';

export {
  EngineOutputSchema,
  type EngineOutput,
  EngineContractError,
  validateEngineOutput,
  wrapEngineOutput,
} from './engine-contract';

export {
  MARKET_MODES,
  AWARENESS_LEVELS,
  COMPETITION_LEVELS,
  PRICING_BANDS,
  GROWTH_DIRECTIONS,
  type MarketMode,
  type AwarenessLevel,
  type CompetitionLevel,
  type PricingBand,
  type GrowthDirection,
  type StrategicContext,
  ContextKernelError,
  buildStrategicContext,
} from './context-kernel';

export {
  type EngineDeclaration,
  EngineRegistryError,
  EngineRegistry,
  globalRegistry,
  ENGINE_DECLARATIONS,
} from './engine-registry';

export {
  resolveOutputDestination,
  validateExecutionRoute,
  getValidRoutesForOutput,
} from './execution-map';

// Phase 3 (Task #66) — uncertainty-guard is now metrics-only; the
// PROCEED/DOWNGRADE/BLOCK verdict was relocated to
// `server/system-control/pre-plan-gate.ts::decidePrePlanGate()` so
// verdict-emission authority lives in one directory. The removed
// exports (UNCERTAINTY_DECISIONS, UncertaintyDecision, UncertaintyResult,
// DEFAULT_THRESHOLDS, evaluateUncertainty) are intentionally not
// re-exported — callers must compose `analyzeUncertaintyMetrics` with
// `decidePrePlanGate`.
export {
  type UncertaintyThresholds,
  type UncertaintyMetrics,
  DEFAULT_UNCERTAINTY_THRESHOLDS,
  aggregateConfidence,
  aggregateCompleteness,
  collectRiskFlags,
  analyzeUncertaintyMetrics,
} from './uncertainty-guard';

export {
  enforceOutputType,
  enforceOutputBatch,
} from './type-enforcement';
