import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = 'orch_1787419882446_lfykx4'`);
  console.log("Found audience snapshots:", audRes.rows.length);
  if (audRes.rows.length > 0) {
    const snap = audRes.rows[0] as any;
    const snapData = typeof snap.snapshot_data === 'string' ? JSON.parse(snap.snapshot_data) : snap.snapshot_data;
    console.log("Audience pains count:", (snapData?.audiencePains || []).length);
    console.log(JSON.stringify(snapData?.audiencePains, null, 2));
  }
  process.exit(0);
}

main();
