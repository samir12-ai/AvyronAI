import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function checkAccountOfferings() {
  const r = await db.execute(sql`SELECT * FROM campaign_offerings WHERE account_id = 'f020f6c7-15d8-4129-90a6-83a40558c642'`);
  console.log(r.rows);
  process.exit(0);
}
checkAccountOfferings().catch(console.error);
