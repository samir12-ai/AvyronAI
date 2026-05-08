import { db } from "../db";
import { sql } from "drizzle-orm";

export async function migrateSystemControlVerdicts() {
  console.log("[Migration-011] Creating system_control_verdicts table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_control_verdicts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL,
      campaign_id VARCHAR NOT NULL,
      job_id VARCHAR,
      verdict TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      block_reasons TEXT,
      downgrades TEXT,
      structural_checks TEXT,
      contradictions TEXT,
      repair_actions TEXT,
      repair_attempted BOOLEAN DEFAULT false,
      checks_total INTEGER DEFAULT 0,
      checks_passed INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      control_version TEXT,
      shadow_mode BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scv_account_campaign
    ON system_control_verdicts (account_id, campaign_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scv_verdict
    ON system_control_verdicts (verdict)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_scv_created
    ON system_control_verdicts (created_at DESC)
  `);

  // Phase 2 (May 2026) — additive: persist commercial judgement payload (JSON-as-text)
  await db.execute(sql`
    ALTER TABLE system_control_verdicts
    ADD COLUMN IF NOT EXISTS commercial_judgement TEXT
  `);

  // Phase 3 (May 2026) — additive: persist universal recovery plan (JSON-as-text)
  await db.execute(sql`
    ALTER TABLE system_control_verdicts
    ADD COLUMN IF NOT EXISTS recovery_plan TEXT
  `);

  console.log("[Migration-011] system_control_verdicts table ready.");
}
