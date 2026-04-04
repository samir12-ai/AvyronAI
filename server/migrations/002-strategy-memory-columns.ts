import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateStrategyMemoryColumns() {
  console.log("[Migration-002] Adding engine_name, plan_id, strategy_fingerprint columns to strategy_memory...");

  await db.execute(sql`
    ALTER TABLE strategy_memory
    ADD COLUMN IF NOT EXISTS engine_name text,
    ADD COLUMN IF NOT EXISTS plan_id varchar,
    ADD COLUMN IF NOT EXISTS strategy_fingerprint text
  `);

  console.log("[Migration-002] strategy_memory columns added (or already exist).");
}
