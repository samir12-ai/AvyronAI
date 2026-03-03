import { logAudit } from "../audit";

const ISOLATION_ALLOWED_CALLER = "MARKET_INTELLIGENCE_V3";

const MIV3_PROTECTED_DOMAINS = [
  "COMPETITOR_DATA",
  "DOMINANCE",
  "CTA_ANALYSIS",
  "CONFIDENCE",
  "SNAPSHOTS",
  "SIGNAL_COMPUTE",
  "TRAJECTORY",
  "INTENT_CLASSIFICATION",
] as const;

type ProtectedDomain = typeof MIV3_PROTECTED_DOMAINS[number];

const BLOCKED_ENGINES = [
  "BUILD_A_PLAN_ORCHESTRATOR",
  "STORYTELLING_ENGINE",
  "OFFER_ENGINE",
  "BUDGET_ENGINE",
  "AUTOPILOT",
  "CREATIVE_ENGINE",
  "LEAD_ENGINE",
  "FULFILLMENT_ENGINE",
] as const;

export function validateEngineIsolation(caller: string): void {
  if (caller !== ISOLATION_ALLOWED_CALLER) {
    const violation = {
      caller,
      allowed: ISOLATION_ALLOWED_CALLER,
      timestamp: new Date().toISOString(),
    };
    console.error(`[MIv3] CI_ENGINE_ISOLATION_VIOLATION | caller=${caller}`);
    logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
      details: { type: "ENGINE_CALLER_VIOLATION", ...violation },
      riskLevel: "CRITICAL",
    }).catch(() => {});
    throw new Error(`Engine isolation violation: ${caller} is not allowed to invoke Market Intelligence V3. Only ${ISOLATION_ALLOWED_CALLER} is permitted.`);
  }
}

export function validateDomainOwnership(caller: string, domain: string): void {
  if (caller !== ISOLATION_ALLOWED_CALLER) {
    console.error(`[MIv3] DOMAIN_OWNERSHIP_VIOLATION | caller=${caller} | domain=${domain}`);
    logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
      details: { type: "DOMAIN_OWNERSHIP_VIOLATION", caller, domain, protectedDomains: [...MIV3_PROTECTED_DOMAINS] },
      riskLevel: "CRITICAL",
    }).catch(() => {});
    throw new Error(`Domain ownership violation: ${caller} cannot access ${domain}. MIv3 is the sole owner of: ${MIV3_PROTECTED_DOMAINS.join(", ")}.`);
  }
}

export function rejectBlockedEngine(engineName: string, endpoint: string): void {
  const isBlocked = (BLOCKED_ENGINES as readonly string[]).includes(engineName);
  if (isBlocked) {
    console.error(`[MIv3] BLOCKED_ENGINE_REJECTION | engine=${engineName} | endpoint=${endpoint}`);
    logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
      details: { type: "BLOCKED_ENGINE_ATTEMPT", engineName, endpoint },
      riskLevel: "HIGH",
    }).catch(() => {});
    throw new Error(`ISOLATION VIOLATION: Engine '${engineName}' is not allowed in Market Intelligence V3 context.`);
  }
}

export function assertSnapshotReadOnly(caller: string, operation: string): void {
  const writeOps = ["INSERT", "UPDATE", "DELETE", "COMPUTE", "RUN", "EXECUTE", "WRITE"];
  const isWrite = writeOps.some(op => operation.toUpperCase().includes(op));
  if (isWrite && caller !== ISOLATION_ALLOWED_CALLER) {
    console.error(`[MIv3] SNAPSHOT_WRITE_VIOLATION | caller=${caller} | operation=${operation}`);
    logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
      details: { type: "SNAPSHOT_WRITE_ATTEMPT", caller, operation },
      riskLevel: "CRITICAL",
    }).catch(() => {});
    throw new Error(`ISOLATION VIOLATION: ${caller} attempted write operation '${operation}' on MIv3 snapshots. Only reads are permitted for non-MIv3 engines.`);
  }
}

export function assertNoPlanWrites(): void {
  logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
    details: { type: "PLAN_WRITE_ATTEMPT" },
    riskLevel: "CRITICAL",
  }).catch(() => {});
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT write to strategic_plans or plan_documents.");
}

export function assertNoOrchestrator(): void {
  logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
    details: { type: "ORCHESTRATOR_INVOCATION_ATTEMPT" },
    riskLevel: "CRITICAL",
  }).catch(() => {});
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT invoke Build a Plan Orchestrator.");
}

export function assertNoAutopilot(): void {
  logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
    details: { type: "AUTOPILOT_INVOCATION_ATTEMPT" },
    riskLevel: "CRITICAL",
  }).catch(() => {});
  throw new Error("ISOLATION VIOLATION: Market Intelligence V3 must NOT trigger Autopilot.");
}

export function assertNoComputeFromExternal(caller: string, computeFunction: string): void {
  if (caller !== ISOLATION_ALLOWED_CALLER) {
    console.error(`[MIv3] EXTERNAL_COMPUTE_VIOLATION | caller=${caller} | fn=${computeFunction}`);
    logAudit("system", "CI_ENGINE_ISOLATION_VIOLATION", {
      details: { type: "EXTERNAL_COMPUTE_CALL", caller, computeFunction },
      riskLevel: "CRITICAL",
    }).catch(() => {});
    throw new Error(`ISOLATION VIOLATION: ${caller} attempted to call compute function '${computeFunction}'. Only MIv3 engine may run compute operations. External consumers must read snapshots only.`);
  }
}

export function getProtectedDomains(): readonly string[] {
  return MIV3_PROTECTED_DOMAINS;
}

export function getBlockedEngines(): readonly string[] {
  return BLOCKED_ENGINES;
}
