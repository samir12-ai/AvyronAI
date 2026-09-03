import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";
const ACCOUNT = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const AUD_SNAP = "f771e8ba-40bf-4742-ab30-17177ecd681b";
const JOB_ID = "orch_1787659544899_kjkup2";

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== 1. CAMPAIGN SELECTION ===");
    const cs = await client.query("SELECT * FROM campaign_selections WHERE selected_campaign_id=$1 OR account_id=$2", [CAMPAIGN, ACCOUNT]);
    console.log("campaign_selections count:", cs.rows.length);
    for (const r of cs.rows) {
      console.log(JSON.stringify(r, null, 2));
    }

    console.log("\n=== 2. BUSINESS DATA LAYER ===");
    try {
      const bdl = await client.query("SELECT * FROM business_data_layer WHERE campaign_id=$1 OR account_id=$2", [CAMPAIGN, ACCOUNT]);
      console.log("business_data_layer count:", bdl.rows.length);
      for (const r of bdl.rows) {
        console.log(JSON.stringify(r, null, 2));
      }
    } catch (e: any) {
      console.log("business_data_layer query error:", e.message);
    }

    console.log("\n=== 3. BRAND CONFIG / BUSINESS PROFILE / SETTINGS TABLES ===");
    const allTables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%brand%' OR table_name LIKE '%business%' OR table_name LIKE '%profile%' OR table_name LIKE '%setting%' OR table_name LIKE '%offering%' OR table_name LIKE '%truth%' OR table_name LIKE '%target%')"
    );
    console.log("Relevant tables:", allTables.rows.map((t: any) => t.table_name));

    for (const t of allTables.rows) {
      try {
        const rows = await client.query(`SELECT * FROM ${t.table_name} LIMIT 3`);
        console.log(`\nTable ${t.table_name} (sample ${rows.rows.length} rows):`);
        if (rows.rows.length > 0) {
          console.log("  Cols:", Object.keys(rows.rows[0]));
          console.log("  Sample row 1:", JSON.stringify(rows.rows[0], null, 2).substring(0, 400));
        }
      } catch (e: any) {
        console.log(`Table ${t.table_name} error:`, e.message);
      }
    }

    console.log("\n=== 4. AUDIENCE SNAPSHOT INPUT SUMMARY & DATA ===");
    const aud = await client.query("SELECT id, job_id, input_summary, target_coverage, structured_signals, audience_segments FROM audience_snapshots WHERE id=$1", [AUD_SNAP]);
    if (aud.rows[0]) {
      console.log("Audience Snapshot ID:", aud.rows[0].id);
      console.log("input_summary:", typeof aud.rows[0].input_summary === "string" ? aud.rows[0].input_summary : JSON.stringify(aud.rows[0].input_summary, null, 2));
      console.log("target_coverage:", typeof aud.rows[0].target_coverage === "string" ? aud.rows[0].target_coverage : JSON.stringify(aud.rows[0].target_coverage, null, 2));
      console.log("audience_segments:", typeof aud.rows[0].audience_segments === "string" ? aud.rows[0].audience_segments.substring(0, 600) : JSON.stringify(aud.rows[0].audience_segments, null, 2).substring(0, 600));
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
