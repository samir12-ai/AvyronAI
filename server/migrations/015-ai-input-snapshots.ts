/**
 * Migration 015 — Phase 6 / Task #69 step 5: AI Input Snapshot persistence layer.
 *
 * Captures the EXACT input shape sent to every LLM call alongside the model
 * name, prompt fingerprint, and resolved provenance. The table is the
 * record-of-truth for the replay/audit lane.
 *
 * This PR ships the table only. The `persistAiInputSnapshot(...)` wrapper
 * lives at `server/shared/ai-replay/persistAiInputSnapshot.ts`. The 15
 * per-engine call sites are tracked as a follow-up so each engine's payload
 * shape can be validated against its prompt fixture before turning the
 * shadow flag on.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function migrateAiInputSnapshots() {
  console.log("[Migration-015] Creating ai_input_snapshots table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_input_snapshots (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id      VARCHAR NOT NULL DEFAULT 'default',
      campaign_id     VARCHAR NOT NULL,
      job_id          VARCHAR,
      engine_id       TEXT    NOT NULL,
      engine_version  INTEGER DEFAULT 0,
      model           TEXT    NOT NULL,
      prompt_fingerprint TEXT NOT NULL,
      input_payload   TEXT    NOT NULL,
      input_bytes     INTEGER DEFAULT 0,
      context_summary TEXT,
      provenance      TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_input_snapshots_engine_campaign ON ai_input_snapshots (engine_id, campaign_id, created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_input_snapshots_job_id ON ai_input_snapshots (job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_input_snapshots_account_campaign ON ai_input_snapshots (account_id, campaign_id, created_at DESC)`);

  console.log("[Migration-015] Done. ai_input_snapshots created with 3 indices.");
}
