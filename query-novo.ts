import "dotenv/config";
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function run() {
  try {
    const res = await db.execute(sql`SELECT created_at FROM ci_competitor_posts WHERE competitor_id = '766e7b76-1bc7-4f52-9640-5f3d3a7b6c9d' ORDER BY created_at DESC LIMIT 1`);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
