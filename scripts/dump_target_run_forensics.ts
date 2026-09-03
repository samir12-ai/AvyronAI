import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function main() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  const jobId = 'orch_1787429278658_ba94b6';
  const planId = '757b860c-2855-41f7-a4b0-c80a5b33628d';

  console.log(`=== DUMPING FORENSIC DATA FOR RUN ${jobId} / PLAN ${planId} ===`);

  // 1. Orchestrator Job
  const jobRes = await db.execute(sql`SELECT * FROM orchestrator_jobs WHERE id = ${jobId}`);
  const job = jobRes.rows[0];

  // 2. Strategic Plan
  const planRes = await db.execute(sql`SELECT * FROM strategic_plans WHERE id = ${planId}`);
  const plan = planRes.rows[0];

  // 3. Strategy Root (by run_id or campaign_id)
  const rootRes = await db.execute(sql`SELECT * FROM strategy_roots WHERE run_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 3`);

  // 4. Funnel Snapshot for this job
  const funnelRes = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE job_id = ${jobId}`);
  const funnelSnap = funnelRes.rows[0];

  // 5. Persuasion Snapshot for this job
  const persuasionRes = await db.execute(sql`SELECT * FROM persuasion_snapshots WHERE job_id = ${jobId}`);
  const persuasionSnap = persuasionRes.rows[0];

  // 6. Awareness Snapshot for this job
  const awarenessRes = await db.execute(sql`SELECT * FROM awareness_snapshots WHERE job_id = ${jobId}`);
  const awarenessSnap = awarenessRes.rows[0];

  // 7. Offer Snapshot for this job
  const offerRes = await db.execute(sql`SELECT * FROM offer_snapshots WHERE job_id = ${jobId}`);
  const offerSnap = offerRes.rows[0];

  // 8. Positioning Snapshot for this job
  const positioningRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId}`);
  const positioningSnap = positioningRes.rows[0];

  // 9. Mechanism Snapshot for this job
  const mechanismRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId}`);
  const mechanismSnap = mechanismRes.rows[0];

  // 10. Differentiation Snapshot for this job
  const diffRes = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE job_id = ${jobId}`);
  const diffSnap = diffRes.rows[0];

  // 11. Audience Snapshot for this job
  const audienceRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = ${jobId}`);
  const audienceSnap = audienceRes.rows[0];

  // 12. Strategic Pain Decisions for this job
  const spdRes = await db.execute(sql`SELECT * FROM strategic_pain_decisions WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC`);

  const dump = {
    job,
    plan,
    roots: rootRes.rows,
    funnelSnap,
    persuasionSnap,
    awarenessSnap,
    offerSnap,
    positioningSnap,
    mechanismSnap,
    diffSnap,
    audienceSnap,
    strategicPainDecisions: spdRes.rows,
  };

  fs.writeFileSync('scripts/target_run_dump.json', JSON.stringify(dump, null, 2), 'utf8');
  console.log('Target run dump successfully written to scripts/target_run_dump.json');
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
