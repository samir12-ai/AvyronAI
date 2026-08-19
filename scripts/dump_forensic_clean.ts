import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== COMPREHENSIVE FORENSIC DUMP 2 ===");

  // 1. All growth campaigns
  const camps = await db.execute(sql`SELECT * FROM growth_campaigns`);
  console.log(`\n--- ALL GROWTH_CAMPAIGNS (Total: ${camps.rows.length}) ---`);
  console.table(camps.rows);

  // 2. All campaign selections
  const sels = await db.execute(sql`SELECT * FROM campaign_selections`);
  console.log(`\n--- ALL CAMPAIGN SELECTIONS (Total: ${sels.rows.length}) ---`);
  console.table(sels.rows);

  // 3. All pipeline change events
  const pce = await db.execute(sql`SELECT * FROM pipeline_change_events`);
  console.log(`\n--- ALL PIPELINE CHANGE EVENTS (Total: ${pce.rows.length}) ---`);
  console.table(pce.rows);

  // 4. All pipeline snapshots
  const snaps = await db.execute(sql`SELECT * FROM pipeline_snapshots`);
  console.log(`\n--- ALL PIPELINE SNAPSHOTS (Total: ${snaps.rows.length}) ---`);
  console.table(snaps.rows);

  // 5. All boss runs
  const boss = await db.execute(sql`SELECT * FROM boss_runs`);
  console.log(`\n--- ALL BOSS RUNS (Total: ${boss.rows.length}) ---`);
  console.table(boss.rows.map((b: any) => ({
    id: b.id,
    accountId: b.account_id,
    campaignId: b.campaign_id,
    status: b.status,
    q1Verdict: b.q1_verdict,
    q2Verdict: b.q2_verdict,
    createdAt: b.created_at,
    finishedAt: b.finished_at
  })));

  // 6. All watchtower strategic briefs
  const briefs = await db.execute(sql`SELECT * FROM watchtower_strategic_briefs`);
  console.log(`\n--- ALL STRATEGIC BRIEFS (Total: ${briefs.rows.length}) ---`);
  console.table(briefs.rows);

  // 7. Check if there are any other tables with "watchtower" or "signal" or "change" or "event"
  const allTables = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log("\n--- ALL PUBLIC TABLES IN DATABASE ---");
  console.log(allTables.rows.map((r: any) => r.table_name).join(", "));

  process.exit(0);
}

main().catch(console.error);
