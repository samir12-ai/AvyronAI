import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("================================================================================");
  console.log("             AVYRON WATCHTOWER FORENSIC TRACE — DATABASE AUDIT                  ");
  console.log("================================================================================");

  // 0. Table columns for pipeline_change_events and related tables
  console.log("\n--- 0. COLUMNS IN pipeline_change_events ---");
  const cols = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'pipeline_change_events'
    ORDER BY ordinal_position
  `);
  console.table(cols.rows);

  // 1. CAMPAIGN BREAKDOWN TABLE
  console.log("\n--- 1. CAMPAIGN BREAKDOWN TABLE ---");
  const campaignBreakdown = await db.execute(sql`
    SELECT 
      COALESCE(campaign_id, '(null)') as campaign_id,
      account_id,
      COUNT(*) as total_events,
      COUNT(*) FILTER (WHERE status = 'candidate') as candidate,
      COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
      COUNT(*) FILTER (WHERE status = 'archived') as archived,
      COUNT(*) FILTER (WHERE status = 'expired') as expired,
      COUNT(*) FILTER (WHERE status = 'reverted') as reverted,
      COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      MIN(created_at) as earliest_event,
      MAX(created_at) as latest_event
    FROM pipeline_change_events
    GROUP BY campaign_id, account_id
  `);
  console.table(campaignBreakdown.rows);

  // 2. ALL EVENTS EVER in pipeline_change_events
  console.log("\n--- 2. ALL EVENTS IN PIPELINE_CHANGE_EVENTS ---");
  const allEvents = await db.execute(sql`
    SELECT 
      pce.*,
      cc.name as competitor_name
    FROM pipeline_change_events pce
    LEFT JOIN ci_competitors cc ON pce.competitor_id = cc.id
    ORDER BY pce.created_at DESC
  `);
  console.log(`Total events found in DB: ${allEvents.rows.length}`);
  allEvents.rows.forEach((r: any, idx: number) => {
    console.log(`\n[Event #${idx+1}] ID: ${r.id}`);
    console.log(`  Campaign: ${r.campaign_id} | Account: ${r.account_id}`);
    console.log(`  Competitor: ${r.competitor_id} (${r.competitor_name})`);
    console.log(`  Kind: ${r.kind} | Severity: ${r.severity} | Status: ${r.status}`);
    console.log(`  CreatedAt: ${r.created_at} | ValidatedAt: ${r.validated_at} | UpdatedAt: ${r.updated_at}`);
    console.log(`  Snapshots: baseline=${r.baseline_snapshot_id}, current=${r.current_snapshot_id}`);
    console.log(`  RunId: ${r.run_id} | Scope: ${r.scope} (count=${r.scope_competitor_count})`);
    console.log(`  Evidence: ${typeof r.evidence === 'string' ? r.evidence.slice(0, 150) : JSON.stringify(r.evidence)?.slice(0, 150)}...`);
  });

  // 3. PIPELINE_SNAPSHOTS
  console.log("\n--- 3. PIPELINE_SNAPSHOTS SUMMARY ---");
  const snapshotSummary = await db.execute(sql`
    SELECT 
      ps.campaign_id,
      ps.account_id,
      ps.competitor_id,
      cc.name as competitor_name,
      COUNT(*) as snapshot_count,
      MIN(ps.created_at) as first_created,
      MAX(ps.created_at) as last_created
    FROM pipeline_snapshots ps
    LEFT JOIN ci_competitors cc ON ps.competitor_id = cc.id
    GROUP BY ps.campaign_id, ps.account_id, ps.competitor_id, cc.name
    ORDER BY ps.campaign_id, ps.competitor_id
  `);
  console.table(snapshotSummary.rows);

  const allSnapshots = await db.execute(sql`
    SELECT id, account_id, campaign_id, competitor_id, acquisition_id, run_id, created_at
    FROM pipeline_snapshots
    ORDER BY created_at DESC
    LIMIT 25
  `);
  console.log("Recent Snapshots (up to 25):", allSnapshots.rows);

  // 4. COMPETITORS INVENTORY
  console.log("\n--- 4. COMPETITORS INVENTORY ---");
  const competitorRows = await db.execute(sql`
    SELECT 
      cc.id,
      cc.account_id,
      cc.campaign_id,
      cc.name,
      cc.handle,
      cc.platform,
      cc.is_active,
      cc.created_at,
      COUNT(DISTINCT pce.id) as change_events_count,
      COUNT(DISTINCT ps.id) as snapshots_count,
      COUNT(DISTINCT cp.id) as posts_count
    FROM ci_competitors cc
    LEFT JOIN pipeline_change_events pce ON cc.id = pce.competitor_id
    LEFT JOIN pipeline_snapshots ps ON cc.id = ps.competitor_id
    LEFT JOIN ci_competitor_posts cp ON cc.id = cp.competitor_id
    GROUP BY cc.id, cc.account_id, cc.campaign_id, cc.name, cc.handle, cc.platform, cc.is_active, cc.created_at
    ORDER BY cc.campaign_id, cc.name
  `);
  console.table(competitorRows.rows);

  // 5. MI_FETCH_JOBS INVENTORY
  console.log("\n--- 5. MI_FETCH_JOBS INVENTORY ---");
  const fetchJobsSummary = await db.execute(sql`
    SELECT 
      campaign_id,
      account_id,
      status,
      COUNT(*) as count,
      MIN(created_at) as first_created,
      MAX(completed_at) as last_completed
    FROM mi_fetch_jobs
    GROUP BY campaign_id, account_id, status
    ORDER BY campaign_id, status
  `);
  console.table(fetchJobsSummary.rows);

  // 6. ALL MI_FETCH_JOBS FOR MarketMindAI (campaign_1773576062201_6t0oxi)
  console.log("\n--- 6. MI_FETCH_JOBS FOR MarketMindAI (campaign_1773576062201_6t0oxi) ---");
  const mmJobs = await db.execute(sql`
    SELECT id, account_id, campaign_id, status, error_count, created_at, completed_at
    FROM mi_fetch_jobs
    WHERE campaign_id = 'campaign_1773576062201_6t0oxi'
    ORDER BY created_at DESC
  `);
  console.table(mmJobs.rows);

  // 7. BOSS RUNS INVENTORY
  console.log("\n--- 7. BOSS RUNS INVENTORY ---");
  const bossSummary = await db.execute(sql`
    SELECT 
      campaign_id,
      account_id,
      status,
      q1_verdict,
      q2_verdict,
      COUNT(*) as count,
      MIN(created_at) as first_created,
      MAX(finished_at) as last_finished
    FROM boss_runs
    GROUP BY campaign_id, account_id, status, q1_verdict, q2_verdict
    ORDER BY campaign_id
  `);
  console.table(bossSummary.rows);

  // 8. ALL BOSS RUNS FOR MarketMindAI & Burger Station
  console.log("\n--- 8. ALL BOSS RUNS DETAILS ---");
  const bossDetails = await db.execute(sql`
    SELECT id, account_id, campaign_id, status, q1_verdict, q2_verdict, lane_runs, created_at, finished_at
    FROM boss_runs
    ORDER BY created_at DESC
    LIMIT 10
  `);
  bossDetails.rows.forEach((r: any) => {
    console.log(`BossRun ${r.id}: camp=${r.campaign_id}, status=${r.status}, Q1=${r.q1_verdict}, Q2=${r.q2_verdict}, createdAt=${r.created_at}`);
    if (r.lane_runs) {
      console.log(`  lane_runs:`, JSON.stringify(r.lane_runs).slice(0, 300));
    }
  });

  // 9. CHECK FOR ORPHAN OR UNLINKED EVENTS
  console.log("\n--- 9. ORPHAN CHECK ---");
  const unlinkedEvents = await db.execute(sql`
    SELECT pce.*
    FROM pipeline_change_events pce
    LEFT JOIN growth_campaigns gc ON pce.campaign_id = gc.id
    WHERE gc.id IS NULL
  `);
  console.log("Events with campaign_id not matching any growth_campaigns:", unlinkedEvents.rows.length);

  // 10. CHECK ALL CAMPAIGNS AND ACCOUNTS
  console.log("\n--- 10. ALL CAMPAIGNS AND ACCOUNTS ---");
  const allCamps = await db.execute(sql`
    SELECT gc.id, gc.name, gc.created_at, cs.account_id, cs.selected_platform, cs.campaign_goal_type
    FROM growth_campaigns gc
    LEFT JOIN campaign_selections cs ON gc.id = cs.selected_campaign_id
  `);
  console.table(allCamps.rows);

  process.exit(0);
}

main().catch(console.error);
