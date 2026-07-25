import { db } from "../db";
import { sql } from "drizzle-orm";

export async function runMigration010() {
  console.log("[Migration-010] Adding transcript and hook_source columns to ci_competitor_posts...");

  try {
    await db.execute(sql`
      ALTER TABLE ci_competitor_posts
      ADD COLUMN IF NOT EXISTS transcript TEXT,
      ADD COLUMN IF NOT EXISTS hook_source TEXT
    `);
    console.log("[Migration-010] TikTok validation columns ready.");
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      console.log("[Migration-010] Columns already exist — skipping.");
    } else {
      console.error("[Migration-010] Error:", err.message);
    }
  }
}
