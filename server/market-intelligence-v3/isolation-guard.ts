const ISOLATION_ALLOWED_CALLER = "MARKET_INTELLIGENCE_V3";

export function validateEngineIsolation(caller: string): void {
  if (caller !== ISOLATION_ALLOWED_CALLER) {
    console.error(`[MIv3] CI_ENGINE_ISOLATION_VIOLATION | caller=${caller}`);
    throw new Error(`Engine isolation violation: ${caller} is not allowed to invoke Market Intelligence V3. Only ${ISOLATION_ALLOWED_CALLER} is permitted.`);
  }
}

export function assertNoPlanWrites(): void {
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT write to strategic_plans or plan_documents.");
}

export function assertNoOrchestrator(): void {
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT invoke Build a Plan Orchestrator.");
}

export function assertNoAutopilot(): void {
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT trigger Autopilot.");
}
