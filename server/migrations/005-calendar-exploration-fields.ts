import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateCalendarExplorationFields() {
  console.log("[Migration-005] Adding exploration fields to calendar_entries and growth_campaigns...");

  await db.execute(sql`
    ALTER TABLE calendar_entries
    ADD COLUMN IF NOT EXISTS is_exploration BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS exploration_intent TEXT,
    ADD COLUMN IF NOT EXISTS exploration_hypothesis TEXT
  `);

  await db.execute(sql`
    ALTER TABLE growth_campaigns
    ADD COLUMN IF NOT EXISTS exploration_budget_percent DOUBLE PRECISION
  `);

  console.log("[Migration-005] Exploration fields ready.");
}
