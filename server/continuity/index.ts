/**
 * Seal #13 / Track #1 — Continuity layer public surface.
 */
export {
  startContinuityScheduler,
  stopContinuityScheduler,
  runContinuityTick,
  getContinuityHealth,
  getReplicaId,
  tryClaimWindow,
  markClaimCompleted,
  releaseClaimForRetry,
  WINDOW_MS,
  WINDOW_DAYS,
  DEAD_CYCLE_THRESHOLD_MS,
  _resetContinuityState,
} from "./scheduler";
export type { TickReport, PerCampaignDecision, ClaimAttempt } from "./scheduler";
export { continuityMetrics, renderContinuityMetrics } from "./metrics";
// Seal #14 / Track #2 — supervisor + chain registry.
export {
  startContinuitySupervisor,
  stopContinuitySupervisor,
  runSupervisorTick,
  getSupervisorHealth,
  _resetSupervisorState,
} from "./supervisor";
export type { SupervisorTickReport, ChainObservation } from "./supervisor";
export {
  buildChainRegistry,
  getChainRegistry,
  _resetChainRegistry,
} from "./chain-registry";
export type { ChainDescriptor, ChainIntrospector } from "./chain-registry";
export {
  classifyChainState,
} from "./health-classifier";
export type { ChainState, ClassifyInput, ClassifyResult } from "./health-classifier";
