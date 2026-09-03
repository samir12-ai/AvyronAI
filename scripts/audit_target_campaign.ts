import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  console.log(`=== AUDITING CAMPAIGN: ${campaignId} ===\n`);

  // 1. Check orchestrator_jobs
  const jobs = await db.execute(sql`
    SELECT * 
    FROM orchestrator_jobs 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
  `);
  console.log(`--- ORCHESTRATOR JOBS (${jobs.rows.length}) ---`);
  for (const j of jobs.rows as any[]) {
    console.log(`ID: ${j.id}, Status: ${j.status}, created_at: ${j.created_at}, updated_at: ${j.updated_at}, error: ${j.error}`);
  }

  // 2. Check strategic_plans
  const plans = await db.execute(sql`
    SELECT id, job_id, campaign_id, lane_id, status, created_at, updated_at
    FROM strategic_plans 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
  `);
  console.log(`\n--- STRATEGIC PLANS (${plans.rows.length}) ---`);
  for (const p of plans.rows as any[]) {
    console.log(`ID: ${p.id}, JobID: ${p.job_id}, LaneID: ${p.lane_id}, Status: ${p.status}, created_at: ${p.created_at}`);
  }

  // 3. Check strategy_roots
  const roots = await db.execute(sql`
    SELECT id, job_id, campaign_id, lane_id, status, created_at
    FROM strategy_roots 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
  `);
  console.log(`\n--- STRATEGY ROOTS (${roots.rows.length}) ---`);
  for (const r of roots.rows as any[]) {
    console.log(`ID: ${r.id}, JobID: ${r.job_id}, LaneID: ${r.lane_id}, Status: ${r.status}, created_at: ${r.created_at}`);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
