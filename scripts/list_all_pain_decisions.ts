import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  const res = await db.execute(sql`
    SELECT pain_id, final_classification, status, job_id, reason, payload
    FROM strategic_pain_decisions
    WHERE campaign_id = ${campaignId}
    ORDER BY created_at DESC
  `);
  console.log(`=== ALL STRATEGIC PAIN DECISIONS (${res.rows.length}) ===`);
  for (const r of res.rows as any[]) {
    console.log(`PainID: ${r.pain_id} | Final: ${r.final_classification} | Status: ${r.status} | Job: ${r.job_id}`);
    console.log(`  Reason: ${r.reason}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
