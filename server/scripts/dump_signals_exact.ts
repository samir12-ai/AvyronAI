import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787420716056_rbf142";
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = ${jobId}`);
  const aud = audRes.rows[0] as any;
  const ss = typeof aud.structured_signals === 'string' ? JSON.parse(aud.structured_signals) : aud.structured_signals;

  console.log("=== STRUCTURED SIGNALS ===");
  console.log("Root causes:", JSON.stringify(ss?.root_causes, null, 2));
  console.log("Psychological drivers:", JSON.stringify(ss?.psychological_drivers, null, 2));
  console.log("Pain clusters:", JSON.stringify(ss?.pain_clusters, null, 2));
  console.log("Desire clusters:", JSON.stringify(ss?.desire_clusters, null, 2));

  process.exit(0);
}

main();
