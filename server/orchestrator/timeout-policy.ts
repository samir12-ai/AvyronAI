import { ENGINE_PRIORITY_ORDER, type EngineId } from "./priority-matrix";

export const ENGINE_TIMEOUT_BUDGET_MS: Readonly<Record<EngineId, number>> = {
  market_intelligence: 300_000,
  audience: 900_000,
  positioning: 900_000,
  differentiation: 600_000,
  mechanism: 600_000,
  offer: 600_000,
  awareness: 600_000,
  funnel: 300_000,
  persuasion: 600_000,
  integrity: 180_000,
  statistical_validation: 300_000,
  budget_governor: 180_000,
  channel_selection: 600_000,
  iteration: 300_000,
  retention: 300_000,
};

export const BUILD_PLAN_TIMEOUT_MS = 180_000;
export const PIPELINE_TOTAL_TIMEOUT_MS = 45 * 60_000;
export const ENGINE_TIMEOUT_WARNING_RATIO = 0.8;

function assertTimeoutPolicyCoverage(): void {
  const engineIds = ENGINE_PRIORITY_ORDER.map((engine) => engine.id);
  const configuredIds = Object.keys(ENGINE_TIMEOUT_BUDGET_MS);
  const missing = engineIds.filter((engineId) => !(engineId in ENGINE_TIMEOUT_BUDGET_MS));
  const unknown = configuredIds.filter((engineId) => !engineIds.includes(engineId as EngineId));

  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `[timeout-policy] policy must cover exactly the registered engines; missing=[${missing.join(",")}] unknown=[${unknown.join(",")}]`,
    );
  }
}

assertTimeoutPolicyCoverage();

export function getEngineTimeoutMs(engineId: EngineId): number {
  return ENGINE_TIMEOUT_BUDGET_MS[engineId];
}
