import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateRhythmSnapshotColumns() {
  console.log("[Migration-006] Adding rhythm snapshot columns to strategic_plans and plan_approvals...");

  await db.execute(sql`
    ALTER TABLE strategic_plans
    ADD COLUMN IF NOT EXISTS approved_rhythm_json TEXT
  `);

  await db.execute(sql`
    ALTER TABLE plan_approvals
    ADD COLUMN IF NOT EXISTS rhythm_snapshot_json TEXT
  `);

  console.log("[Migration-006] Rhythm snapshot columns ready.");
}
