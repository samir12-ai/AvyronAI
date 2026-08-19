import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== INSPECTING ALL PIPELINE_SNAPSHOTS & PIPELINE_RUNS ===");

  const snaps = await db.execute(sql`SELECT * FROM pipeline_snapshots ORDER BY created_at DESC`);
  console.log(`Pipeline snapshots total: ${snaps.rows.length}`);
  console.table(snaps.rows);

  const pipeRuns = await db.execute(sql`SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 20`);
  console.log(`Pipeline runs total: ${pipeRuns.rows.length}`);
  console.table(pipeRuns.rows);

  process.exit(0);
}

main().catch(console.error);
