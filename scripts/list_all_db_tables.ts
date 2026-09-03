import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const res = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);
  console.log("ALL PUBLIC TABLES IN DB:");
  for (const r of res.rows as any[]) {
    console.log(r.table_name);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
