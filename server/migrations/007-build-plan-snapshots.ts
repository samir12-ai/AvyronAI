import { sql } from "drizzle-orm";
import { db } from "../db";

export async function migrateBuildPlanSnapshots() {
  console.log("[Migration-007] Creating build_plan_snapshots table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS build_plan_snapshots (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL DEFAULT 'default',
      campaign_id VARCHAR NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUCCESS',
      plan TEXT,
      actionability_score DOUBLE PRECISION DEFAULT 0,
      failed_blocks TEXT,
      attempts INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("[Migration-007] build_plan_snapshots table ready.");
}
