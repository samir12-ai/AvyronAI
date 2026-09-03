import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const audRes = await db.execute(sql`SELECT audience_pains FROM audience_snapshots WHERE job_id = 'orch_1787419882446_lfykx4'`);
  if (audRes.rows.length > 0) {
    const raw = audRes.rows[0].audience_pains;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    console.log("Audience pains in snapshot:", JSON.stringify(parsed, null, 2));
  }
  process.exit(0);
}

main();
