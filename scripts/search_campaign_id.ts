import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Get all table names
  const res = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  
  const tables = res.rows.map((r: any) => r.table_name);
  console.log(`Found tables: ${tables.join(", ")}`);
  
  for (const table of tables) {
    try {
      // Check if table has a campaign_id column or campaignId column
      const columnsRes = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = ${table}
      `);
      const cols = columnsRes.rows.map((c: any) => c.column_name);
      
      const hasId = cols.includes('id');
      const hasCampaignId = cols.includes('campaign_id') || cols.includes('campaignId');
      
      if (hasId) {
        const checkId = await db.execute(sql.raw(`SELECT count(*) FROM "${table}" WHERE "id" = 'campaign_1786718877499_3jk4zv'`));
        if (parseInt(checkId.rows[0].count) > 0) {
          console.log(`Table "${table}" has matching row by "id"!`);
        }
      }
      if (hasCampaignId) {
        const colName = cols.includes('campaign_id') ? 'campaign_id' : 'campaignId';
        const checkCampId = await db.execute(sql.raw(`SELECT count(*) FROM "${table}" WHERE "${colName}" = 'campaign_1786718877499_3jk4zv'`));
        if (parseInt(checkCampId.rows[0].count) > 0) {
          console.log(`Table "${table}" has matching row by "${colName}"!`);
        }
      }
    } catch (e: any) {
      console.error(`Error checking table ${table}:`, e.message);
    }
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
