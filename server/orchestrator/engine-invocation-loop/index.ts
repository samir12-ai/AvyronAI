/**
 * Task #92 / Phase 4-D — engine-invocation-loop SCAFFOLD.
 *
 * The deep extraction of the priority-ordered engine loop from
 * `runOrchestrator` is deferred to Phase 4-E. This module exists so
 * the cutover infrastructure has a typed target — the candidate path
 * will route through `runEngineInvocationLoop` once the loop body
 * lands.
 *
 * Calling the stub throws — there is no runtime path that touches it
 * while `ORCH_USE_ENGINE_LOOP` is unset. See README.md for the
 * extraction checklist.
 */

export interface EngineInvocationLoopInput {
  // Intentionally minimal — the real shape lands with the extraction.
  jobId: string;
}

export interface EngineInvocationLoopOutput {
  jobId: string;
  completedEngines: number;
}

export const ENGINE_INVOCATION_LOOP_MODULE_ID = "engine-invocation-loop";

export function runEngineInvocationLoop(_input: EngineInvocationLoopInput): Promise<EngineInvocationLoopOutput> {
  throw new Error(
    `[${ENGINE_INVOCATION_LOOP_MODULE_ID}] SCAFFOLD_NOT_WIRED — deferred to Phase 4-E. ` +
      `Doctrine OD-3 requires extraction before runOrchestrator can shrink to ≤200 lines; ` +
      `this module is a placeholder only.`,
  );
}
