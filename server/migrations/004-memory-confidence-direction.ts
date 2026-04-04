import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateMemoryConfidenceDirection() {
  console.log("[Migration-004] Adding confidence_score, direction and context fields to strategy_memory...");

  await db.execute(sql`
    ALTER TABLE strategy_memory
    ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION DEFAULT 0.5,
    ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'neutral',
    ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS decay_rate DOUBLE PRECISION DEFAULT 0.95,
    ADD COLUMN IF NOT EXISTS validation_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS industry TEXT,
    ADD COLUMN IF NOT EXISTS platform TEXT,
    ADD COLUMN IF NOT EXISTS campaign_type TEXT,
    ADD COLUMN IF NOT EXISTS funnel_objective TEXT
  `);

  await db.execute(sql`
    UPDATE strategy_memory
    SET
      confidence_score = CASE
        WHEN is_winner = true THEN 0.85
        WHEN is_winner = false AND score < 0 THEN 0.15
        ELSE 0.5
      END,
      direction = CASE
        WHEN is_winner = true THEN 'reinforce'
        WHEN is_winner = false AND score < 0 THEN 'avoid'
        ELSE 'neutral'
      END,
      last_validated_at = NOW()
    WHERE last_validated_at IS NULL
  `);

  console.log("[Migration-004] strategy_memory confidence_score and direction columns ready.");
}
