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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS decision_attributions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      calendar_entry_id VARCHAR NOT NULL,
      decision_id VARCHAR NOT NULL,
      weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      relevance_score DOUBLE PRECISION DEFAULT 0,
      attribution_method TEXT NOT NULL DEFAULT 'single',
      match_reason TEXT,
      account_id VARCHAR NOT NULL DEFAULT 'default',
      campaign_id VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_da_calendar_entry ON decision_attributions(calendar_entry_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_da_decision ON decision_attributions(decision_id)
  `);

  console.log("[Migration-008] Decision attribution columns ready.");
}
