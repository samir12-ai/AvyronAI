import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = 'orch_1787419882446_lfykx4'`);
  if (audRes.rows.length > 0) {
    const snap = audRes.rows[0] as any;
    console.log("Columns:", Object.keys(snap));
    const snapData = typeof snap.snapshot_data === 'string' ? JSON.parse(snap.snapshot_data) : snap.snapshot_data;
    console.log("snapshot_data keys:", Object.keys(snapData || {}));
    if (snapData?.painRegistry) {
      console.log("painRegistry:", JSON.stringify(snapData.painRegistry, null, 2));
    }
  }
  process.exit(0);
}

main();
