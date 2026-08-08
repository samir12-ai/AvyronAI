import type { EngineId } from "./priority-matrix";

export const BUILD_PLAN_TIMEOUT_MS = 180_000;

/**
 * Last-resort safety ceiling for a whole pipeline run. It caps the remaining
 * budget of an individual attempt but never replaces per-engine budgets.
 */
export const PIPELINE_TOTAL_TIMEOUT_MS = 45 * 60_000;

/**
 * Canonical wall-clock budgets for a single engine attempt.
 *
 * These are orchestration watchdogs, not AI-client request timeouts. A real
 * timeout remains fail-closed; this map only prevents unrelated engines from
 * inheriting an arbitrary one-size-fits-all ceiling.
 */
export const ENGINE_TIMEOUT_BUDGET_MS = {
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
} as const satisfies Record<EngineId, number>;

export type TimeoutPolicyTarget = EngineId | "build_plan_layer";

type TimeoutPolicyEnvironment = Readonly<Record<string, string | undefined>>;

function readGlobalTimeoutOverride(env: TimeoutPolicyEnvironment = process.env): number | null {
  const raw = env.ENGINE_TIMEOUT_MS_OVERRIDE;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 60_000 && parsed <= 1_800_000
    ? parsed
    : null;
}

/**
 * The override intentionally only raises a budget. It is useful for controlled
 * audit runs but cannot silently shorten an engine's production safety budget.
 */
export function getEngineTimeoutMs(
  target: TimeoutPolicyTarget,
  env: TimeoutPolicyEnvironment = process.env,
): number {
  const configured = target === "build_plan_layer"
    ? BUILD_PLAN_TIMEOUT_MS
    : ENGINE_TIMEOUT_BUDGET_MS[target];
  const override = readGlobalTimeoutOverride(env);
  return override === null ? configured : Math.max(configured, override);
}

export interface EngineTimeoutWarning {
  engineId: string;
  engineName: string;
  attempt: number;
  elapsedMs: number;
  configuredBudgetMs: number;
  currentStage?: string;
}

export interface TimeoutRaceInput<T> {
  engineId: string;
  engineName: string;
  attempt: number;
  configuredBudgetMs: number;
  run: () => Promise<T>;
  onTimeout: () => T;
  currentStage?: () => string | undefined;
  onWarning?: (warning: EngineTimeoutWarning) => void;
  /** Test-only clock hooks; production uses native timers. */
  setTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Runs an attempt against its configured budget. Both warning and timeout
 * handles are cleared in finally, including rejected/cancelled attempts, so a
 * settled attempt cannot emit a retroactive timeout later in the pipeline.
 */
export async function runWithEngineTimeout<T>(input: TimeoutRaceInput<T>): Promise<T> {
  const startedAt = Date.now();
  const warningAtMs = Math.floor(input.configuredBudgetMs * 0.8);
  const setTimer = input.setTimer ?? setTimeout;
  const clearTimer = input.clearTimer ?? clearTimeout;
  let warningHandle: ReturnType<typeof setTimeout> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeout = new Promise<T>((resolve) => {
      timeoutHandle = setTimer(() => resolve(input.onTimeout()), input.configuredBudgetMs);
    });
    const warning = setTimer(() => {
      const warningPayload: EngineTimeoutWarning = {
        engineId: input.engineId,
        engineName: input.engineName,
        attempt: input.attempt,
        elapsedMs: Date.now() - startedAt,
        configuredBudgetMs: input.configuredBudgetMs,
        currentStage: input.currentStage?.(),
      };
      if (input.onWarning) {
        input.onWarning(warningPayload);
        return;
      }
      console.warn(
        `[Orchestrator] ENGINE_TIMEOUT_WARNING | engine=${warningPayload.engineId} ` +
        `elapsedMs=${warningPayload.elapsedMs} budgetMs=${warningPayload.configuredBudgetMs} ` +
        `attempt=${warningPayload.attempt} stage=${warningPayload.currentStage ?? "unavailable"}`,
      );
    }, warningAtMs);
    warningHandle = warning;
    return await Promise.race([input.run(), timeout]);
  } finally {
    if (warningHandle !== null) clearTimer(warningHandle);
    if (timeoutHandle !== null) clearTimer(timeoutHandle);
  }
}