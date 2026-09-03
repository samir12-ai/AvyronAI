import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  
  console.log(`=== TOP JOBS FOR CAMPAIGN ${campaignId} ===`);
  const jobs = await db.execute(sql`
    SELECT id, blueprint_id, status, plan_id, error, created_at, completed_at, execution_mode
    FROM orchestrator_jobs 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
    LIMIT 15
  `);
  console.table(jobs.rows);

  console.log(`\n=== CHECKING ALL STRATEGY ROOTS FOR CAMPAIGN ${campaignId} ===`);
  const roots = await db.execute(sql`
    SELECT id, run_id, campaign_id, status, created_at, positioning_snapshot_id, differentiation_snapshot_id, mechanism_snapshot_id
    FROM strategy_roots 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(roots.rows);

  console.log(`\n=== CHECKING ALL FUNNEL SNAPSHOTS FOR CAMPAIGN ${campaignId} ===`);
  const funnels = await db.execute(sql`
    SELECT id, job_id, campaign_id, status, engine_version, confidence_score, created_at, offer_snapshot_id, positioning_snapshot_id
    FROM funnel_snapshots 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(funnels.rows);

  console.log(`\n=== CHECKING ALL PERSUASION SNAPSHOTS FOR CAMPAIGN ${campaignId} ===`);
  const persuasions = await db.execute(sql`
    SELECT id, job_id, campaign_id, status, engine_version, confidence_score, created_at, awareness_snapshot_id, funnel_snapshot_id
    FROM persuasion_snapshots 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(persuasions.rows);
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
