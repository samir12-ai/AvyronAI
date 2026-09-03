import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const spdRes = await db.execute(sql`SELECT * FROM strategic_pain_decisions WHERE job_id = 'orch_1787419882446_lfykx4'`);
  console.log("Strategic Pain Decisions count:", spdRes.rows.length);
  for (const row of spdRes.rows as any[]) {
    console.log(`\nPain ID: ${row.pain_id}`);
    console.log(`Final Classification: ${row.final_classification}`);
    console.log(`Status: ${row.status}`);
    console.log(`Reason: ${row.reason}`);
  }
  process.exit(0);
}

main();
