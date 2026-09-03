import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1773576062201_6t0oxi";

  try {
    const res = await client.query(`
      SELECT id, plan_json
      FROM strategic_plans
      WHERE campaign_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [campaignId]);

    if (res.rows.length === 0) {
      console.log("No plan found");
      return;
    }

    const planId = res.rows[0].id;
    const plan = JSON.parse(res.rows[0].plan_json);
    console.log("Plan ID:", planId);
    console.log("\n=== APPROVED LANES ===");
    console.log(JSON.stringify(plan.approvedLanes, null, 2));

    console.log("\n=== BUYER CONVERSION JOURNEYS ===");
    console.log(JSON.stringify(plan.buyerConversionJourneys, null, 2));

    console.log("\n=== CONTENT PILLARS ===");
    console.log(JSON.stringify(plan.contentDistribution?.contentPillars, null, 2));

    console.log("\n=== CREATIVE TESTS ===");
    console.log(JSON.stringify(plan.creativeTesting?.tests, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
