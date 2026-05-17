/**
 * Task #91 / Phase 4-C — `revertModuleFlag()` — single mutator.
 *
 * Doctrine `parity/no-direct-revert` (ESLint): every code path that flips
 * an `ORCH_USE_<MODULE>` flag back to `current` MUST go through this
 * helper. Direct `process.env.ORCH_USE_X = "current"` mutations and
 * direct `setModeOverride()` calls outside this file are statically
 * forbidden. The helper:
 *
 *   1. Mutates the in-process env so the next dispatch returns to safe.
 *   2. Records a `orch_module_auto_revert_total{module}` counter tick.
 *   3. Writes a `MODULE_AUTO_REVERT` audit row (best-effort; logged on
 *      failure per Seal #15 no-silent-catch doctrine).
 *   4. Returns the revert event for the caller to surface on the panel.
 *
 * Hard gate `PARITY_AUTO_REVERT_DISABLED=1` (incident-response opt-out):
 * when set, the helper returns a `suppressed=true` event WITHOUT mutating
 * the env — so the operator panel still surfaces the would-be revert.
 *
 * Shadow mode (`PARITY_SHADOW=1`): the parity job classifies but does NOT
 * invoke this helper for routing actions. The 72h burn-in surface lets
 * operators review classifications before flipping live.
 */
import { pool } from "../../../db";
import { logger } from "../../../logger";
import { pageOperatorOnBlockRevert } from "./pager";
import { recordAutoRevert } from "./cv15-metrics";

export interface RevertEvent {
  moduleId: string;
  moduleFlag: string;
  reason: string;
  at: string;
  suppressed: boolean;
}

/**
 * Single authorised mutator. The eslint rule `parity/no-direct-revert`
 * allowlists this file (and the legacy P4-B supervisor) only — every
 * other caller must funnel through here.
 */
export async function revertModuleFlag(
  moduleId: string,
  moduleFlag: string,
  reason: string,
): Promise<RevertEvent> {
  const suppressed = process.env.PARITY_AUTO_REVERT_DISABLED === "1";
  const at = new Date().toISOString();
  if (!suppressed) {
    // eslint-disable-next-line parity/no-direct-revert -- authorised mutator per Task #91 / Phase 4-C doctrine
    process.env[`ORCH_USE_${moduleFlag}`] = "current";
    recordAutoRevert(moduleId);
    logger.warn(
      { component: "parity-auto-revert", moduleId, moduleFlag, reason },
      `[ParityAutoRevert] AUTO_REVERT module=${moduleId} reason=${reason}`,
    );
  } else {
    logger.warn(
      { component: "parity-auto-revert", moduleId, moduleFlag, reason },
      `[ParityAutoRevert] SUPPRESSED (PARITY_AUTO_REVERT_DISABLED=1) module=${moduleId} reason=${reason}`,
    );
  }
  try {
    await pool.query(
      `INSERT INTO audit_log (event_type, details, execution_status, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        "MODULE_AUTO_REVERT",
        JSON.stringify({ moduleId, moduleFlag, reason, suppressed, at }),
        suppressed ? "SUPPRESSED" : "COMPLETED",
      ],
    );
    // Code-review #4 hardening: also stamp a MODULE_FLAG_REVERTED row
    // (only when not suppressed) so the burn-in clock in computeParityHealth
    // can detect a candidate-stint break. The continuous-stint computation
    // uses the latest REVERTED timestamp to cut off the eligible PROMOTED
    // history — a promote→revert→re-promote cycle within <7d must NOT pass.
    if (!suppressed) {
      await pool.query(
        `INSERT INTO audit_log (event_type, details, execution_status, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          "MODULE_FLAG_REVERTED",
          JSON.stringify({ moduleId, moduleFlag, reason, at }),
          "COMPLETED",
        ],
      );
      // Code-review #5 hardening: explicit operator page on every
      // non-suppressed BLOCK auto-revert. Dedupe key = moduleId +
      // floor(now/1h) so a divergence storm in the same hour fans in
      // to a single page (the audit row is the dedupe ledger). The
      // pager helper self-handles errors — failure to page must NOT
      // block the revert.
      const hourWindow = Math.floor(Date.now() / 3_600_000);
      const dedupeKey = `${moduleId}:${hourWindow}`;
      await pageOperatorOnBlockRevert({
        moduleId,
        moduleFlag,
        reason,
        dedupeKey,
      });
    }
  } catch (err) {
    // Seal #15 — no silent catches. Counter is already recorded; audit
    // row write failure is logged for operator visibility.
    logger.warn(
      { component: "parity-auto-revert", err: String(err) },
      `[ParityAutoRevert] AUDIT_WRITE_FAILED module=${moduleId}`,
    );
  }
  return { moduleId, moduleFlag, reason, at, suppressed };
}

/**
 * Best-effort attribution: given a path like `budgetLedger[3].decisionAction`
 * or `systemControlVerdict.integrityVerdict`, return the orchestrator
 * extraction moduleId most likely responsible. Returns `null` when no
 * deterministic mapping applies — caller MUST NOT silently coerce.
 */
export function attributeDivergenceToModule(path: string): { moduleId: string; moduleFlag: string } | null {
  if (path.startsWith("budgetLedger")) {
    return { moduleId: "budget-decision-ledger", moduleFlag: "BUDGET_LEDGER" };
  }
  if (path.startsWith("systemControlVerdict")) {
    return { moduleId: "system-control", moduleFlag: "SYS_CONTROL" };
  }
  if (path.startsWith("engineOrder") || path.startsWith("finalResult.completedEngines")) {
    return { moduleId: "priority-matrix", moduleFlag: "PRIORITY_MATRIX" };
  }
  if (path.startsWith("planPersist")) {
    return { moduleId: "plan-synthesis", moduleFlag: "PLAN_SYNTHESIS" };
  }
  if (path.startsWith("contextResolved") || path.startsWith("contextKeys") || path.startsWith("inputHashes")) {
    return { moduleId: "ctx-resolve", moduleFlag: "CTX_RESOLVE" };
  }
  return null;
}
