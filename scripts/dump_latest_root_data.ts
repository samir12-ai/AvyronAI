import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const rootId = "90260ef4-e150-4fa3-b4a2-48795fd90ae1";

  try {
    const root = await client.query("SELECT * FROM strategy_roots WHERE id = $1", [rootId]);
    if (root.rows.length > 0) {
      console.log("Root found:", rootId);
      fs.writeFileSync("scripts/latest_root_dump.json", JSON.stringify(root.rows[0], null, 2));
      console.log("Saved root dump to scripts/latest_root_dump.json");
    }

    const plans = await client.query("SELECT id, status, plan_summary, plan_json, created_at FROM strategic_plans WHERE campaign_id = 'campaign_1786718877499_3jk4zv' ORDER BY created_at DESC LIMIT 2");
    if (plans.rows.length > 0) {
      fs.writeFileSync("scripts/latest_plan_dump.json", JSON.stringify(plans.rows[0], null, 2));
      console.log("Saved latest plan to scripts/latest_plan_dump.json");
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
