import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const sp = await client.query("SELECT * FROM strategic_plans WHERE id = $1", ["f769dc1d-c022-4670-ac35-61b43d4d0c1b"]);
    if (sp.rows.length > 0) {
      const planJson = typeof sp.rows[0].plan_json === 'string' ? JSON.parse(sp.rows[0].plan_json) : sp.rows[0].plan_json;
      fs.writeFileSync("scripts/sfi_plan_dump.json", JSON.stringify(planJson, null, 2));
      console.log("Dumped full plan_json to scripts/sfi_plan_dump.json");
      console.log("Top-level keys in plan_json:", Object.keys(planJson));
    }

    const sr = await client.query("SELECT * FROM strategy_roots WHERE campaign_id = $1 ORDER BY id DESC LIMIT 5", ["campaign_1786718877499_3jk4zv"]);
    fs.writeFileSync("scripts/sfi_roots_dump.json", JSON.stringify(sr.rows, null, 2));
    console.log("Dumped strategy roots to scripts/sfi_roots_dump.json");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
