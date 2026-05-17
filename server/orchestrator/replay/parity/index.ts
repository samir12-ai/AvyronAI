/**
 * Task #91 / Phase 4-C — Replay Regression Suite (reclassified Task #93 / Phase 4-E).
 *
 * Public surface for the regression observer. The cutover-era exports
 * (`revertModuleFlag`, `RevertEvent`, `setParityReady`, `recordAutoRevert`)
 * have been removed.
 */
export * from "./types";
export { classifyDivergences, RoutingTableIncompleteError } from "./classifier";
export { loadRoutingTable, DEFAULT_ROUTING_TABLE } from "./routes";
export { runParityTick, type ParityTickReport } from "./parity-job";
export { computeParityHealth } from "./health";
export { attributeDivergenceToModule, type ModuleAttribution } from "./divergence-attribution";
export {
  evaluatePathShapeCoverage,
  missingShapes,
  type PathShapeCoverageReport,
} from "./path-coverage";
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
  setParityBlockAgeHours,
  recordParityRun,
  recordParityDivergence,
  setPathCoverage,
  _resetCv15MetricsForTests,
  _readCv15Counters,
} from "./cv15-metrics";
