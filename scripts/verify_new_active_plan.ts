import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

const CAMPAIGN = "campaign_1773576062201_6t0oxi";
const ACCOUNT = "a2d87878-a1e9-41ea-a8a5-90beff569673";

async function main() {
  const client = await pool.connect();
  try {
    const planRes = await client.query(
      "SELECT id, campaign_id, created_at, plan_json FROM strategic_plans WHERE campaign_id=$1 AND account_id=$2 ORDER BY created_at DESC LIMIT 1",
      [CAMPAIGN, ACCOUNT]
    );
    if (planRes.rows[0]) {
      const p = planRes.rows[0];
      console.log("=== LATEST STRATEGIC PLAN IN DB ===");
      console.log(`Plan ID: ${p.id}`);
      console.log(`Created At: ${p.created_at}`);
      const data = typeof p.plan_json === "string" ? JSON.parse(p.plan_json) : p.plan_json;
      console.log("Strategic Lanes:", JSON.stringify(data.approvedLanes || data.strategicLanes, null, 2));
      console.log("Brand Spine:", JSON.stringify(data.brandSpine, null, 2));
      console.log("Buyer Conversion Journeys:", Array.isArray(data.buyerConversionJourneys) ? data.buyerConversionJourneys.length : (data.buyerConversionJourney ? 1 : 0));
    }

    // Query active plan endpoint on localhost:8808
    try {
      console.log("\n=== TESTING HTTP ENDPOINT http://localhost:8808/api/plans/active/" + CAMPAIGN + " ===");
      const resp = await fetch(`http://localhost:8808/api/plans/active/${CAMPAIGN}`, {
        headers: { "x-account-id": ACCOUNT }
      });
      const json = await resp.json();
      console.log("HTTP Status:", resp.status);
      console.log("Response hasPlan:", json.hasPlan);
      console.log("Response runId:", json.runId);
      console.log("Response plan ID:", json.plan?.id);
    } catch (err: any) {
      console.log("HTTP fetch error:", err.message);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
