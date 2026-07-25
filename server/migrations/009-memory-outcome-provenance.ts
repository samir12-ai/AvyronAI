import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateMemoryOutcomeProvenance() {
  console.log("[Migration-009] Adding source_outcome_id to strategy_memory...");

  await db.execute(sql`
    ALTER TABLE strategy_memory
    ADD COLUMN IF NOT EXISTS source_outcome_id VARCHAR
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_sm_source_outcome ON strategy_memory(source_outcome_id)
    WHERE source_outcome_id IS NOT NULL
  `);

  console.log("[Migration-009] Memory outcome provenance column ready.");
}
