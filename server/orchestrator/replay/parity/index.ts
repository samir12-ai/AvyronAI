/**
 * Task #91 / Phase 4-C — Parity Validation + Divergence Tracking.
 *
 * Public surface for the parity gate. See per-file docstrings for
 * doctrine references.
 */
export * from "./types";
export { classifyDivergences, RoutingTableIncompleteError } from "./classifier";
export { loadRoutingTable, DEFAULT_ROUTING_TABLE } from "./routes";
export { runParityTick, type ParityTickReport } from "./parity-job";
export { computeParityHealth } from "./health";
export {
  evaluatePathShapeCoverage,
  missingShapes,
  type PathShapeCoverageReport,
} from "./path-coverage";
export {
  revertModuleFlag,
  attributeDivergenceToModule,
  type RevertEvent,
} from "./auto-revert";
export {
  startParityScheduler,
  stopParityScheduler,
  setParityCandidateFactory,
  getParitySchedulerHealth,
  runOneParityTick,
  type ParitySchedulerHealth,
} from "./scheduler";
export {
  renderCv15Metrics,
  setParityReady,
  setParityBlockAgeHours,
  recordParityRun,
  recordParityDivergence,
  recordAutoRevert,
  setPathCoverage,
  _resetCv15MetricsForTests,
  _readCv15Counters,
} from "./cv15-metrics";
