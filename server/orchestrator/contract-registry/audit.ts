/**
 * Phase C2 (May 2026) — Shadow contract audit.
 *
 * Runs `validateContractCompleteness(...)` against every engine result the
 * orchestrator commits to its `results` map. Behavior is governed by the
 * `ENFORCE_ENGINE_CONTRACTS` env flag:
 *
 *   - `false` (default, C2 shadow phase):
 *       Violations are LOGGED as `[ContractAudit]` lines but never alter
 *       engine status, never fail the run, never bubble to the verdict.
 *       Used to collect real-world data on which legacy fields are still
 *       in use and which engines are emitting incomplete outputs.
 *
 *   - `true` (C4 cutover):
 *       Violations downgrade `stepResult.status` to a contract-incomplete
 *       state and surface a structured warning the verdict layer can read.
 *       NOT YET WIRED — C4 PR will add the status-mutation branch and the
 *       `CONTRACT_INCOMPLETE` BlockCode.
 *
 * Engines without a registry entry are SKIPPED — see `getContract(...)`.
 * The C0 + C1 PRs only registered `channel_selection` and `funnel`. The
 * remaining 13 engines are deferred to a follow-up PR that will populate
 * the registry from `.local/plans/15-engine-contract-map.md` after each
 * engine's real output shape is verified against production snapshots.
 *
 * IMPORTANT (failure mode):
 *  - This audit must NEVER throw. Any internal exception is caught and
 *    logged as `[ContractAudit] AUDIT_INTERNAL_ERROR ...` and the engine
 *    result is returned unchanged. Audit code is the LAST place we want
 *    to take down a pipeline.
 */

import type { EngineId, EngineStepResult } from "../priority-matrix";
import { getContract, validateContractCompleteness } from "./index";

/**
 * Read once at module load. Treat anything other than the literal string
 * "true" as false — including unset / "1" / "yes" — so accidental truthy
 * config doesn't enable enforcement before C4.
 */
export const ENFORCE_ENGINE_CONTRACTS: boolean =
  String(process.env.ENFORCE_ENGINE_CONTRACTS ?? "").toLowerCase() === "true";

export interface ContractAuditOutcome {
  engineId: EngineId;
  audited: boolean;            // false when no contract is registered
  status: "COMPLETE" | "INCOMPLETE" | "INVALID" | "LEGACY_NONE" | "SKIPPED" | "ERROR";
  missingFields: string[];
  invalidFields: { fieldId: string; reason: string }[];
  enforced: boolean;           // true once C4 flips ENFORCE_ENGINE_CONTRACTS
}

/**
 * Audit a single engine result against its contract. Idempotent and
 * side-effect-free other than `console.log(...)` for violations.
 *
 * Call site (C2): `server/orchestrator/index.ts`, immediately after each
 * `results.set(engineDef.id, stepResult)` in the engine loop. Returns the
 * outcome for downstream wiring (C4) but the C2 caller is free to ignore
 * it — the only contract is "do not throw."
 */
export function auditEngineContract(
  engineId: EngineId,
  stepResult: EngineStepResult,
  ctx: { jobId: string | null; campaignId: string | null },
): ContractAuditOutcome {
  // Only audit results the engine actually produced. Statuses that mean
  // "the engine did not run usefully" are skipped — the contract registry
  // describes successful outputs, so a SKIPPED/ERROR/TIMEOUT result has
  // nothing to validate.
  const auditableStatuses = new Set(["SUCCESS", "PARTIAL"]);
  if (!auditableStatuses.has(stepResult.status)) {
    return {
      engineId,
      audited: false,
      status: "SKIPPED",
      missingFields: [],
      invalidFields: [],
      enforced: ENFORCE_ENGINE_CONTRACTS,
    };
  }

  const contract = getContract(engineId);
  if (!contract) {
    // Pre-registry engine — silent until the registry is populated.
    return {
      engineId,
      audited: false,
      status: "LEGACY_NONE",
      missingFields: [],
      invalidFields: [],
      enforced: ENFORCE_ENGINE_CONTRACTS,
    };
  }

  let completeness;
  try {
    completeness = validateContractCompleteness(engineId, stepResult.output);
  } catch (err) {
    console.log(
      `[ContractAudit] AUDIT_INTERNAL_ERROR | engine=${engineId} | jobId=${ctx.jobId ?? "n/a"} | ` +
      `err=${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      engineId,
      audited: true,
      status: "ERROR",
      missingFields: [],
      invalidFields: [],
      enforced: ENFORCE_ENGINE_CONTRACTS,
    };
  }

  const outcome: ContractAuditOutcome = {
    engineId,
    audited: true,
    status: completeness.status as ContractAuditOutcome["status"],
    missingFields: completeness.missingRequiredOutputs,
    invalidFields: completeness.invalidFields,
    enforced: ENFORCE_ENGINE_CONTRACTS,
  };

  // Shadow logging — emitted only on a problem so healthy runs stay quiet.
  if (completeness.status === "INCOMPLETE" || completeness.status === "INVALID") {
    const summary =
      completeness.status === "INCOMPLETE"
        ? `missing=[${completeness.missingRequiredOutputs.join(",")}]`
        : `invalid=[${completeness.invalidFields.map((f) => `${f.fieldId}:${f.reason}`).join("; ")}]`;
    console.log(
      `[ContractAudit] ${ENFORCE_ENGINE_CONTRACTS ? "ENFORCED" : "SHADOW"} | ` +
      `engine=${engineId} | status=${completeness.status} | ` +
      `jobId=${ctx.jobId ?? "n/a"} | campaign=${ctx.campaignId ?? "n/a"} | ${summary}`,
    );
  }

  return outcome;
}
