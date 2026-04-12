import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateDecisionAttribution() {
  console.log("[Migration-008] Adding decision attribution columns...");

  await db.execute(sql`
    ALTER TABLE strategy_decisions
    ADD COLUMN IF NOT EXISTS campaign_id VARCHAR
  `);

  await db.execute(sql`
    ALTER TABLE decision_outcomes
    ADD COLUMN IF NOT EXISTS campaign_id VARCHAR
  `);

  await db.execute(sql`
    ALTER TABLE calendar_entries
    ADD COLUMN IF NOT EXISTS source_decision_id VARCHAR
  `);

  console.log("[Migration-008] Decision attribution columns ready.");
}
