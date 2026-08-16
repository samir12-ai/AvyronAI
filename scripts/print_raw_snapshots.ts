import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const tables = [
    'mi_snapshots',
    'audience_snapshots',
    'positioning_snapshots',
    'differentiation_snapshots',
    'mechanism_snapshots',
    'offer_snapshots',
    'funnel_snapshots',
    'persuasion_snapshots',
    'strategy_roots'
  ];

  for (const table of tables) {
    console.log(`\n===================================`);
    console.log(`TABLE: ${table}`);
    console.log(`===================================`);
    const q = `SELECT * FROM "${table}" WHERE campaign_id = '${campaignId}' ORDER BY created_at DESC LIMIT 1`;
    const res = await db.execute(sql.raw(q));
    if (res.rows.length > 0) {
      const row = res.rows[0];
      Object.keys(row).forEach(k => {
        const val = row[k];
        const valStr = typeof val === 'object' ? JSON.stringify(val).substring(0, 200) : String(val).substring(0, 200);
        console.log(`- ${k}: ${valStr}`);
      });
    } else {
      console.log("No rows found.");
    }
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
