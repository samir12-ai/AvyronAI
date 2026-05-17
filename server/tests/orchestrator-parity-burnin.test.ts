/**
 * Task #91 / Phase 4-C — Code-review #4 regression: continuous-stint
 * burn-in computation in `computeParityHealth`.
 *
 * Verifies:
 *   (1) A single OLD promotion (>7d) with NO revert history → module
 *       qualifies as `modulesAtCandidate` (baseline happy path).
 *   (2) promote→revert→re-promote within <7d → module STAYS in
 *       `modulesAwaitingBurnIn` (clock reset by the latest revert).
 *   (3) Old promotion + recent revert + recent re-promotion → blocker
 *       `module_burnin_incomplete=ctx-resolve` MUST appear; the module
 *       MUST NOT be in `modulesAtCandidate`.
 *
 * Runs against the real dev DB (DATABASE_URL). Inserts/cleans audit_log
 * rows for moduleId `ctx-resolve` so assertions are deterministic.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { computeParityHealth } from "../orchestrator/replay/parity/health";
import { DEFAULT_THRESHOLDS } from "../orchestrator/replay/parity/types";

const MODULE_ID = "ctx-resolve";
const MODULE_FLAG = "CTX_RESOLVE";
const DETAIL_TAG = `parity-burnin-test:${MODULE_ID}`;

async function insertAudit(eventType: string, atIso: string) {
  await pool.query(
    `INSERT INTO audit_log (id, account_id, event_type, details, execution_status, created_at)
     VALUES (gen_random_uuid(), 'system-parity-gate-test', $1, $2, 'COMPLETED', $3::timestamptz)`,
    [eventType, JSON.stringify({ moduleId: MODULE_ID, tag: DETAIL_TAG }), atIso],
  );
}

async function cleanup() {
  await pool.query(
    `DELETE FROM audit_log WHERE details LIKE $1`,
    [`%${DETAIL_TAG}%`],
  );
}

const DAY_MS = 24 * 3_600_000;
const savedEnv: Record<string, string | undefined> = {};
const TRACKED_FLAGS = ["SYS_CONTROL", "PRIORITY_MATRIX", "PLAN_SYNTHESIS", "BUDGET_LEDGER", "CTX_RESOLVE"];

describe("computeParityHealth — continuous-stint burn-in", () => {
  beforeEach(async () => {
    await cleanup();
    for (const f of TRACKED_FLAGS) {
      savedEnv[f] = process.env[`ORCH_USE_${f}`];
      process.env[`ORCH_USE_${f}`] = "current";
    }
    process.env.ORCH_USE_CTX_RESOLVE = "candidate";
  });

  afterEach(async () => {
    await cleanup();
    for (const f of TRACKED_FLAGS) {
      if (savedEnv[f] === undefined) delete process.env[`ORCH_USE_${f}`];
      else process.env[`ORCH_USE_${f}`] = savedEnv[f];
    }
  });

  it("(1) old promotion + no revert → modulesAtCandidate (baseline)", async () => {
    const nowMs = Date.now();
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 30 * DAY_MS).toISOString());
    const h = await computeParityHealth(DEFAULT_THRESHOLDS, () => nowMs);
    expect(h.modulesAtCandidate).toContain(MODULE_ID);
    expect(h.modulesAwaitingBurnIn.find(m => m.moduleId === MODULE_ID)).toBeUndefined();
  });

  it("(2) old promotion + recent revert + recent re-promote (<7d) → AWAITING (clock reset)", async () => {
    const nowMs = Date.now();
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 30 * DAY_MS).toISOString());
    await insertAudit("MODULE_FLAG_REVERTED", new Date(nowMs - 3 * DAY_MS).toISOString());
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 2 * DAY_MS).toISOString());
    const h = await computeParityHealth(DEFAULT_THRESHOLDS, () => nowMs);
    expect(h.modulesAtCandidate).not.toContain(MODULE_ID);
    const awaiting = h.modulesAwaitingBurnIn.find(m => m.moduleId === MODULE_ID);
    expect(awaiting).toBeDefined();
    expect(awaiting!.daysAtCandidate).not.toBeNull();
    expect(awaiting!.daysAtCandidate!).toBeLessThan(DEFAULT_THRESHOLDS.candidateBurnInDays);
    expect(h.blockers.some(b => b.startsWith(`module_burnin_incomplete=${MODULE_ID}`))).toBe(true);
    expect(h.readyForCutover).toBe(false);
  });

  it("(3a) health surface shape — required fields + blockers structure (code-review #5 panel-wiring integration)", async () => {
    const nowMs = Date.now();
    const h = await computeParityHealth(DEFAULT_THRESHOLDS, () => nowMs);
    // Canonical fields that the operator panel + Phase 4-D cutover
    // gate read. Each MUST be present (no `?? false` substitution).
    expect(typeof h.readyForCutover).toBe("boolean");
    expect(Array.isArray(h.blockers)).toBe(true);
    expect(Array.isArray(h.modulesAtCandidate)).toBe(true);
    expect(Array.isArray(h.modulesAwaitingBurnIn)).toBe(true);
    expect(Array.isArray(h.modulesBlocked)).toBe(true);
    expect(Array.isArray(h.modulesShadowOnly)).toBe(true);
    expect(typeof h.cassetteCount).toBe("number");
    expect(typeof h.oldestCassetteAgeH).toBe("number");
    expect(h.divergencesByClassLast24h).toBeDefined();
    expect(h.pathShapeCoverage).toBeDefined();
    // Every blocker is a non-empty string with a `name=value` shape so
    // the operator panel can render a deterministic badge row.
    for (const b of h.blockers) {
      expect(typeof b).toBe("string");
      expect(b.length).toBeGreaterThan(0);
      expect(b).toMatch(/=|<|>/);
    }
  });

  it("(3) old promotion + recent revert + recent re-promote with old promotion still in history → does NOT use ancient first row", async () => {
    const nowMs = Date.now();
    // Two old promotions before a recent revert + a single fresh re-promote.
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 60 * DAY_MS).toISOString());
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 40 * DAY_MS).toISOString());
    await insertAudit("MODULE_FLAG_REVERTED", new Date(nowMs - 1 * DAY_MS).toISOString());
    await insertAudit("MODULE_FLAG_PROMOTED", new Date(nowMs - 0.5 * DAY_MS).toISOString());
    const h = await computeParityHealth(DEFAULT_THRESHOLDS, () => nowMs);
    expect(h.modulesAtCandidate).not.toContain(MODULE_ID);
    const awaiting = h.modulesAwaitingBurnIn.find(m => m.moduleId === MODULE_ID);
    expect(awaiting).toBeDefined();
    // Continuous-stint clock must be ~0.5 days, NOT 60 days.
    expect(awaiting!.daysAtCandidate!).toBeLessThan(1);
  });
});
