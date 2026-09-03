import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const JOB_ID = "orch_1787671043408_hu6jv5";

async function main() {
  const client = await pool.connect();
  try {
    const aud = await client.query("SELECT id, audience_segments FROM audience_snapshots WHERE job_id=$1", [JOB_ID]);
    if (aud.rows[0]) {
      const segs = typeof aud.rows[0].audience_segments === "string" ? JSON.parse(aud.rows[0].audience_segments) : aud.rows[0].audience_segments;
      console.log("=== FULL AUDIENCE SEGMENTS FOR FRESH JOB ===");
      for (const s of segs) {
        console.log(`\nSegment Name: ${s.name}`);
        console.log(`Role: ${s.role}`);
        console.log(`Definition Claim: ${s.segmentDefinition?.claim}`);
        console.log(`Description: ${s.description}`);
        console.log("Pains:", JSON.stringify(s.pains, null, 2));
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
