import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const audRes = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audience_snapshots'`);
  console.log("audience_snapshots columns:", audRes.rows);

  const diffRes = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'differentiation_snapshots'`);
  console.log("differentiation_snapshots columns:", diffRes.rows);

  const posRes = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'positioning_snapshots'`);
  console.log("positioning_snapshots columns:", posRes.rows);

  process.exit(0);
}

main();
