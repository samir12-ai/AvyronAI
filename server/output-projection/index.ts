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

export {
  UNCERTAINTY_DECISIONS,
  type UncertaintyDecision,
  type UncertaintyThresholds,
  DEFAULT_THRESHOLDS,
  type UncertaintyResult,
  aggregateConfidence,
  aggregateCompleteness,
  collectRiskFlags,
  evaluateUncertainty,
} from './uncertainty-guard';

export {
  enforceOutputType,
  enforceOutputBatch,
} from './type-enforcement';
