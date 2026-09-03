import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";
const ACCOUNT = "a2d87878-a1e9-41ea-a8a5-90beff569673";

async function main() {
  const client = await pool.connect();
  try {
    console.log("=== BUSINESS DATA LAYER FOR CAMPAIGN ===");
    const bdl = await client.query("SELECT * FROM business_data_layer WHERE campaign_id=$1", [CAMPAIGN]);
    console.log("Rows count:", bdl.rows.length);
    for (const r of bdl.rows) {
      console.log(JSON.stringify(r, null, 2));
    }

    console.log("\n=== CAMPAIGN OFFERINGS FOR CAMPAIGN ===");
    const co = await client.query("SELECT * FROM campaign_offerings WHERE campaign_id=$1", [CAMPAIGN]);
    console.log("Campaign offerings count:", co.rows.length);
    for (const r of co.rows) {
      console.log(JSON.stringify(r, null, 2));
    }

    console.log("\n=== OFFERING INPUT EVIDENCE FOR CAMPAIGN ===");
    const oie = await client.query("SELECT * FROM offering_input_evidence WHERE campaign_id=$1", [CAMPAIGN]);
    console.log("Offering input evidence count:", oie.rows.length);
    for (const r of oie.rows) {
      console.log(JSON.stringify(r, null, 2));
    }

    console.log("\n=== BUSINESS UNDERSTANDING SNAPSHOTS FOR CAMPAIGN ===");
    const bus = await client.query("SELECT * FROM business_understanding_snapshots WHERE campaign_id=$1 ORDER BY created_at DESC", [CAMPAIGN]);
    console.log("Business understanding snapshots count:", bus.rows.length);
    for (const r of bus.rows) {
      console.log(`ID: ${r.id} | Created: ${r.created_at} | Status: ${r.status}`);
      console.log("Payload:", typeof r.business_understanding === "string" ? r.business_understanding : JSON.stringify(r.business_understanding, null, 2));
    }

    console.log("\n=== PRODUCT TRUTH / FACT TABLES ===");
    const factTables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%fact%' OR table_name LIKE '%truth%' OR table_name LIKE '%doctrine%')"
    );
    console.log("Fact tables:", factTables.rows.map((t: any) => t.table_name));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
