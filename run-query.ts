import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function run() {
  const result = await db.execute(sql`SELECT * FROM business_data_layer WHERE campaign_id = 'campaign_1773576062201_6t0oxi'`);
  console.log(result.rows);
  
  process.exit(0);
}
run().catch(console.error);
