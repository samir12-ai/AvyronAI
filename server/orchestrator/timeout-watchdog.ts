import type { EngineId, EngineStepResult } from "./priority-matrix";
import { ENGINE_TIMEOUT_WARNING_RATIO } from "./timeout-policy";

export interface EngineWatchdogInput {
  engineId: EngineId;
  engineName: string;
  attempt: number;
  budgetMs: number;
  getStage?: () => string | undefined;
  execute: () => Promise<EngineStepResult>;
}

/**
 * Runs one engine attempt under its explicit budget. Both handles are always
 * cleared when the attempt settles, so a successful/failed attempt cannot
 * later emit a stale warning or timeout into a subsequent retry.
 */
export async function runEngineAttemptWithWatchdog(
  input: EngineWatchdogInput,
): Promise<EngineStepResult> {
  const startedAt = Date.now();
  let settled = false;
  let warningHandle: ReturnType<typeof setTimeout> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const clearHandles = () => {
    if (warningHandle !== null) clearTimeout(warningHandle);
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    warningHandle = null;
    timeoutHandle = null;
  };

  const timeoutResult = new Promise<EngineStepResult>((resolve) => {
    warningHandle = setTimeout(() => {
      if (settled) return;
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        `[Orchestrator] ENGINE_TIMEOUT_WARNING | engine=${input.engineId} | elapsedMs=${elapsedMs} | budgetMs=${input.budgetMs} | attempt=${input.attempt} | stage=${input.getStage?.() ?? "unknown"}`,
      );
    }, Math.floor(input.budgetMs * ENGINE_TIMEOUT_WARNING_RATIO));

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      console.warn(
        `[Orchestrator] ENGINE_TIMEOUT | engine=${input.engineName} | budgetMs=${input.budgetMs} | attempt=${input.attempt} — marking TIMEOUT`,
      );
      resolve({
        engineId: input.engineId,
        status: "TIMEOUT",
        output: null,
        durationMs: input.budgetMs,
        error: `Engine timed out after ${input.budgetMs / 1000}s`,
      });
    }, input.budgetMs);
  });

  try {
    return await Promise.race([input.execute(), timeoutResult]);
  } finally {
    settled = true;
    clearHandles();
  }
}