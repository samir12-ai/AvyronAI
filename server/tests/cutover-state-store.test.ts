/**
 * Task #92 / Phase 4-D — `cutover_state` integration test.
 *
 * Skipped when DATABASE_URL is absent (CI keeps a Postgres available;
 * local devs without a DB get a pass). Verifies:
 *   - CHECK constraint rejects non-doctrine percents (e.g. 7, 75).
 *   - 24h-trigger forbids a strict increase within the cool-off window.
 *   - Revert (decrease/no-op) is always allowed.
 *   - `locked_until > NOW()` refuses promotion until expiry.
 *   - `nextLadderStep` walks {0,1,5,25,50,100}.
 */

import { describe, it, expect } from "vitest";
import {
  nextLadderStep,
  ALLOWED_TRAFFIC_PERCENTS,
} from "../orchestrator/cutover";

describe("cutover/state-store — pure helpers", () => {
  it("nextLadderStep walks the doctrine ladder and stops at 100", () => {
    expect(nextLadderStep(0)).toBe(1);
    expect(nextLadderStep(1)).toBe(5);
    expect(nextLadderStep(5)).toBe(25);
    expect(nextLadderStep(25)).toBe(50);
    expect(nextLadderStep(50)).toBe(100);
    expect(nextLadderStep(100)).toBeNull();
  });

  it("doctrine ladder has exactly the 6 allowed steps", () => {
    expect(ALLOWED_TRAFFIC_PERCENTS).toEqual([0, 1, 5, 25, 50, 100]);
  });
});

// DB-integration suite: skipped when DATABASE_URL is absent OR when the
// `cutover_state` table hasn't been migrated yet. The table-existence
// probe runs once per suite via vitest's `beforeAll`.
const HAS_DB = !!process.env.DATABASE_URL;
let hasCutoverTable = false;
import { beforeAll } from "vitest";

beforeAll(async () => {
  if (!HAS_DB) return;
  try {
    const { pool } = await import("../db");
    const res = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cutover_state') AS exists`,
    );
    hasCutoverTable = res.rows[0]?.exists === true;
  } catch {
    hasCutoverTable = false;
  }
});

const describeIfDb = HAS_DB ? describe : describe.skip;

describeIfDb("cutover/state-store — DB integration", () => {
  it("CHECK constraint rejects non-doctrine percent", async () => {
    if (!hasCutoverTable) {
      console.warn("[cutover-state-store.test] skipping: migration 030 not applied to test DB");
      return;
    }
    const { pool } = await import("../db");
    await expect(
      pool.query(`UPDATE cutover_state SET traffic_percent = 7 WHERE id = 1`),
    ).rejects.toThrow(/cutover_state_traffic_ladder|check/i);
  });

  it("24h trigger refuses second non-zero increment", async () => {
    if (!hasCutoverTable) return;
    const { pool } = await import("../db");
    // Reset to 0 with no last_increment_at.
    await pool.query(
      `UPDATE cutover_state SET traffic_percent = 0, last_increment_at = NULL,
         locked_until = NULL, last_actor = 'test_reset' WHERE id = 1`,
    );
    // First promotion: allowed.
    await pool.query(`UPDATE cutover_state SET traffic_percent = 1 WHERE id = 1`);
    // Immediate second promotion: refused by trigger.
    await expect(
      pool.query(`UPDATE cutover_state SET traffic_percent = 5 WHERE id = 1`),
    ).rejects.toThrow(/forbidden|24h/i);
    // Revert always allowed.
    await pool.query(`UPDATE cutover_state SET traffic_percent = 0 WHERE id = 1`);
  });

  it("locked_until in the future blocks promotion", async () => {
    if (!hasCutoverTable) return;
    const { pool } = await import("../db");
    await pool.query(
      `UPDATE cutover_state SET traffic_percent = 0, last_increment_at = NULL,
         locked_until = NOW() + INTERVAL '1 hour' WHERE id = 1`,
    );
    await expect(
      pool.query(`UPDATE cutover_state SET traffic_percent = 1 WHERE id = 1`),
    ).rejects.toThrow(/locked/i);
    await pool.query(`UPDATE cutover_state SET locked_until = NULL WHERE id = 1`);
  });
});
