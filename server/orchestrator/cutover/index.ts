/**
 * Task #92 / Phase 4-D — Controlled Runtime Cutover (`cutover/`).
 *
 * Doctrine entry point for the traffic-percent rollout from the legacy
 * inline `runOrchestrator` body (`current`) to the extracted module
 * chain (`candidate`).
 *
 * See `README.md` for the OD-1..OD-5 invariants and operator runbook.
 */

export {
  decideOrchestratorPath,
  hashJobId,
  isAllowedTrafficPercent,
  ALLOWED_TRAFFIC_PERCENTS,
  InvalidTrafficPercentError,
  type AllowedTrafficPercent,
} from "./traffic-decision";

export {
  readCutoverState,
  writeCutoverPercent,
  stampDivergenceObserved,
  nextLadderStep,
  CutoverIncrementBlockedError,
  type CutoverState,
  type CutoverActor,
} from "./state-store";

export {
  recordCandidateDivergence,
  recordCandidateThrow,
  type CandidateDivergenceObservation,
} from "./auto-revert";

export {
  renderCutoverMetrics,
  snapshotCutoverMetrics,
  recordRun,
  recordPersistCall,
  setTrafficPercent,
  type CutoverPath,
  type CutoverPersistSite,
  type DivergenceClassForMetric,
} from "./metrics";
