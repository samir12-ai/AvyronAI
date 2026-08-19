import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("================================================================================");
  console.log("             AVYRON WATCHTOWER FORENSIC TRACE — FULL SCHEMA & DATA              ");
  console.log("================================================================================");

  // 1. Check all table columns for pipeline_snapshots, ci_snapshots, ci_competitor_metrics_snapshot, etc.
  const snapshotTables = await db.execute(sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_name IN ('pipeline_snapshots', 'ci_snapshots', 'ci_competitor_metrics_snapshot', 'pipeline_change_events', 'pipeline_eval_windows', 'ci_competitors', 'ci_competitor_posts', 'mi_fetch_jobs', 'growth_campaigns', 'campaign_selections', 'boss_runs')
    ORDER BY table_name, ordinal_position
  `);
  console.log("Schema Columns:");
  snapshotTables.rows.forEach((r: any) => {
    console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`);
  });

  // 2. Query pipeline_snapshots
  console.log("\n--- PIPELINE_SNAPSHOTS ROWS ---");
  const psRows = await db.execute(sql`SELECT * FROM pipeline_snapshots ORDER BY created_at DESC LIMIT 20`);
  console.log(`pipeline_snapshots count=${psRows.rows.length}:`, psRows.rows);

  // 3. Query ci_snapshots
  console.log("\n--- CI_SNAPSHOTS ROWS ---");
  const ciSnapRows = await db.execute(sql`SELECT * FROM ci_snapshots ORDER BY created_at DESC LIMIT 20`);
  console.log(`ci_snapshots count=${ciSnapRows.rows.length}:`, ciSnapRows.rows);

  // 4. Query ci_competitor_metrics_snapshot
  console.log("\n--- CI_COMPETITOR_METRICS_SNAPSHOT ROWS ---");
  const metricsSnapRows = await db.execute(sql`SELECT * FROM ci_competitor_metrics_snapshot ORDER BY created_at DESC LIMIT 20`);
  console.log(`ci_competitor_metrics_snapshot count=${metricsSnapRows.rows.length}:`, metricsSnapRows.rows.map((r: any) => ({
    id: r.id,
    accountId: r.account_id,
    campaignId: r.campaign_id,
    competitorId: r.competitor_id,
    lastFetchAt: r.last_fetch_at,
    postCount: r.post_count,
  })));

  // 5. Query ALL Competitors
  console.log("\n--- ALL CI_COMPETITORS ---");
  const compRows = await db.execute(sql`
    SELECT id, account_id, campaign_id, name, handle, platform, is_active, created_at
    FROM ci_competitors
    ORDER BY campaign_id, name
  `);
  console.table(compRows.rows);

  // 6. Query ALL Campaigns in growth_campaigns
  console.log("\n--- ALL GROWTH_CAMPAIGNS ---");
  const campRows = await db.execute(sql`
    SELECT id, name, created_at, updated_at
    FROM growth_campaigns
    ORDER BY created_at DESC
  `);
  console.table(campRows.rows);

  // 7. Query ALL Campaign Selections
  console.log("\n--- ALL CAMPAIGN SELECTIONS ---");
  const selRows = await db.execute(sql`
    SELECT id, account_id, selected_campaign_id, selected_campaign_name, selected_platform, campaign_goal_type, campaign_status, selected_at, updated_at
    FROM campaign_selections
    ORDER BY updated_at DESC
  `);
  console.table(selRows.rows);

  // 8. Query ALL Boss Runs
  console.log("\n--- ALL BOSS RUNS ---");
  const bossRows = await db.execute(sql`
    SELECT id, account_id, campaign_id, status, q1_verdict, q2_verdict, created_at, finished_at
    FROM boss_runs
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(bossRows.rows);

  // 9. Query ALL Watchtower Strategic Briefs
  console.log("\n--- ALL WATCHTOWER STRATEGIC BRIEFS ---");
  const briefRows = await db.execute(sql`
    SELECT id, account_id, campaign_id, event_id, status, title, created_at, updated_at
    FROM watchtower_strategic_briefs
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(briefRows.rows);

  // 10. Trace Event IDs cited in pipeline_change_events against snapshots
  console.log("\n--- SNAPSHOT REFERENCE TRACE IN EVENTS ---");
  const eventSnapshots = await db.execute(sql`
    SELECT 
      pce.id as event_id,
      pce.campaign_id as event_campaign,
      pce.account_id as event_account,
      pce.competitor_id,
      cc.name as competitor_name,
      cc.campaign_id as competitor_campaign,
      cc.account_id as competitor_account,
      pce.baseline_snapshot_id,
      pce.current_snapshot_id,
      pce.kind,
      pce.status,
      pce.severity,
      pce.created_at
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    ORDER BY pce.created_at DESC
  `);
  console.table(eventSnapshots.rows);

  process.exit(0);
}

main().catch(console.error);
