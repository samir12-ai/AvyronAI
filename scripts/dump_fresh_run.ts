import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1786718877499_3jk4zv";

  try {
    const res = await client.query(`
      SELECT plan_json
      FROM orchestrator_jobs
      WHERE campaign_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [campaignId]);

    if (res.rows.length === 0) {
      console.log("No job found");
      return;
    }

    const planStr = res.rows[0].plan_json;
    fs.writeFileSync("scratch/dump_fixed.json", planStr);
    console.log("Wrote to scratch/dump_fixed.json");

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
