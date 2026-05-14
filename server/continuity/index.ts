/**
 * Seal #13 / Track #1 — Continuity layer public surface.
 */
export {
  startContinuityScheduler,
  stopContinuityScheduler,
  runContinuityTick,
  getContinuityHealth,
  WINDOW_MS,
  WINDOW_DAYS,
  DEAD_CYCLE_THRESHOLD_MS,
  _resetContinuityState,
} from "./scheduler";
export type { TickReport, PerCampaignDecision } from "./scheduler";
export { continuityMetrics, renderContinuityMetrics } from "./metrics";
