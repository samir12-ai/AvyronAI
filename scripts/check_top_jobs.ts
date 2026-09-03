import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  
  const jobs = await db.execute(sql`
    SELECT id, status, plan_id, error, created_at, completed_at
    FROM orchestrator_jobs 
    WHERE campaign_id = ${campaignId} 
    ORDER BY created_at DESC
    LIMIT 6
  `);
  console.log("=== JOBS ===");
  console.log(JSON.stringify(jobs.rows, null, 2));
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
