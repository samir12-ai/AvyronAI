/**
 * Task #92 / Phase 4-D — `cutover_state` reader/writer.
 *
 * Singleton row (id=1). All writes go through this module so the
 * `[Orchestrator/Cutover] PERCENT_CHANGE` audit log is emitted from
 * exactly one place and the in-process metrics gauge is kept in sync.
 *
 * The 24h-increment guard and CHECK constraint live in migration
 * `030_cutover_state.sql` — this module surfaces the resulting
 * Postgres errors as typed exceptions so callers can render an
 * operator-friendly message on the panel.
 */

import { pool } from "../../db";
import {
  ALLOWED_TRAFFIC_PERCENTS,
  isAllowedTrafficPercent,
  InvalidTrafficPercentError,
  type AllowedTrafficPercent,
} from "./traffic-decision";
import { setTrafficPercent } from "./metrics";

export interface CutoverState {
  trafficPercent: AllowedTrafficPercent;
  lastIncrementAt: Date | null;
  lastRevertAt: Date | null;
  lastDivergenceAt: Date | null;
  lockedUntil: Date | null;
  lastActor: string | null;
  lastReason: string | null;
  updatedAt: Date;
}

export type CutoverActor = "operator" | "auto_revert" | "boot" | "test";

export class CutoverIncrementBlockedError extends Error {
  constructor(public readonly pgMessage: string) {
    super(`cutover_state: increment refused — ${pgMessage}`);
    this.name = "CutoverIncrementBlockedError";
  }
}

interface CutoverStateRow {
  traffic_percent: number;
  last_increment_at: Date | null;
  last_revert_at: Date | null;
  last_divergence_at: Date | null;
  locked_until: Date | null;
  last_actor: string | null;
  last_reason: string | null;
  updated_at: Date;
}

function rowToState(row: CutoverStateRow): CutoverState {
  if (!isAllowedTrafficPercent(row.traffic_percent)) {
    // D5: a row outside the doctrine ladder is a contract violation
    // (the CHECK constraint should have prevented it). Surface loud.
    throw new InvalidTrafficPercentError(row.traffic_percent);
  }
  return {
    trafficPercent: row.traffic_percent,
    lastIncrementAt: row.last_increment_at,
    lastRevertAt: row.last_revert_at,
    lastDivergenceAt: row.last_divergence_at,
    lockedUntil: row.locked_until,
    lastActor: row.last_actor,
    lastReason: row.last_reason,
    updatedAt: row.updated_at,
  };
}

export async function readCutoverState(): Promise<CutoverState> {
  const res = await pool.query<CutoverStateRow>(
    `SELECT traffic_percent, last_increment_at, last_revert_at,
            last_divergence_at, locked_until, last_actor, last_reason, updated_at
     FROM cutover_state WHERE id = 1 LIMIT 1`,
  );
  if (res.rows.length === 0) {
    // The migration seeds id=1; an absent row is a contract violation.
    throw new Error("cutover_state: singleton row missing — migration 030 not applied");
  }
  const state = rowToState(res.rows[0]);
  setTrafficPercent(state.trafficPercent);
  return state;
}

/**
 * Write a new traffic-percent. Audited via console.log; metrics gauge
 * refreshed on success. Throws CutoverIncrementBlockedError when the
 * 24h trigger refuses the increment.
 */
export async function writeCutoverPercent(
  next: number,
  actor: CutoverActor,
  reason: string,
  lockedUntil?: Date | null,
): Promise<CutoverState> {
  if (!isAllowedTrafficPercent(next)) {
    throw new InvalidTrafficPercentError(next);
  }
  const prior = await readCutoverState();
  try {
    const res = await pool.query<CutoverStateRow>(
      `UPDATE cutover_state
         SET traffic_percent = $1,
             locked_until = $2,
             last_actor = $3,
             last_reason = $4
       WHERE id = 1
       RETURNING traffic_percent, last_increment_at, last_revert_at,
                 last_divergence_at, locked_until, last_actor, last_reason, updated_at`,
      [next, lockedUntil ?? null, actor, reason],
    );
    const written = rowToState(res.rows[0]);
    setTrafficPercent(written.trafficPercent);
    console.log(
      `[Orchestrator/Cutover] PERCENT_CHANGE | from=${prior.trafficPercent} | to=${written.trafficPercent} | actor=${actor} | reason=${reason}`,
    );
    return written;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("forbidden") || msg.includes("locked")) {
      throw new CutoverIncrementBlockedError(msg);
    }
    throw err;
  }
}

/**
 * Stamp a divergence observation onto the singleton row. Does NOT
 * change the traffic-percent — only the auto-revert path does that.
 */
export async function stampDivergenceObserved(now: Date = new Date()): Promise<void> {
  await pool.query(
    `UPDATE cutover_state SET last_divergence_at = $1 WHERE id = 1`,
    [now],
  );
}

/**
 * Resolve the next step on the {0,1,5,25,50,100} ladder. Returns null
 * when current is already 100.
 */
export function nextLadderStep(current: AllowedTrafficPercent): AllowedTrafficPercent | null {
  const idx = ALLOWED_TRAFFIC_PERCENTS.indexOf(current);
  if (idx < 0 || idx === ALLOWED_TRAFFIC_PERCENTS.length - 1) return null;
  return ALLOWED_TRAFFIC_PERCENTS[idx + 1];
}
