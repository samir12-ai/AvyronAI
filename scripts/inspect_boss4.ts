import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== INSPECTING BOSS RUN 4 & PIPELINE RUNS FOR MARKETMIND ===");

  const boss4 = await db.execute(sql`
    SELECT * FROM boss_runs WHERE id = 'boss_mssv8x64_dfrnoxes'
  `);
  console.log("Boss Run 4:", JSON.stringify(boss4.rows[0], null, 2));

  // Inspect pipeline_runs for MarketMindAI campaign
  const pipeRuns = await db.execute(sql`
    SELECT id, account_id, campaign_id, competitor_id, lane, status, warnings, created_at
    FROM pipeline_runs
    WHERE campaign_id = 'campaign_1773576062201_6t0oxi' OR account_id = 'a2d87878-a1e9-41ea-a8a5-90beff569673'
    ORDER BY created_at DESC
  `);
  console.log(`\nPipeline Runs count=${pipeRuns.rows.length}:`);
  console.table(pipeRuns.rows);

  // Inspect pipeline_snapshots for MarketMindAI / Account a2d87878-a1e9-41ea-a8a5-90beff569673
  const snaps = await db.execute(sql`
    SELECT * FROM pipeline_snapshots
    WHERE campaign_id = 'campaign_1773576062201_6t0oxi' OR account_id = 'a2d87878-a1e9-41ea-a8a5-90beff569673'
    ORDER BY created_at DESC
  `);
  console.log(`\nPipeline Snapshots for Account: count=${snaps.rows.length}:`);
  console.table(snaps.rows);

  // Inspect pipeline_eval_windows for MarketMindAI
  const evalWindows = await db.execute(sql`
    SELECT * FROM pipeline_eval_windows
    WHERE campaign_id = 'campaign_1773576062201_6t0oxi' OR account_id = 'a2d87878-a1e9-41ea-a8a5-90beff569673'
    ORDER BY created_at DESC
  `);
  console.log(`\nEval Windows count=${evalWindows.rows.length}:`);
  console.table(evalWindows.rows);

  // Inspect all pipeline_change_events across the entire database again
  const pceAll = await db.execute(sql`SELECT * FROM pipeline_change_events`);
  console.log(`\nTotal pipeline_change_events in whole database: ${pceAll.rows.length}`);
  console.table(pceAll.rows);

  // Inspect snapshot_archive or audit_log
  const snapArchive = await db.execute(sql`SELECT * FROM snapshot_archive LIMIT 10`);
  console.log(`\nSnapshot Archive count=${snapArchive.rows.length}`);

  process.exit(0);
}

main().catch(console.error);
