import "dotenv/config";
import { Pool } from "pg";

async function traceDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1786718877499_3jk4zv";

  try {
    console.log("==================== PHASE 1: STRATEGY ROOTS ====================");
    const rootsRes = await client.query(
      `SELECT id, run_id, root_hash, status, created_at, 
              contrast_axis_text, primary_axis,
              LENGTH(approved_lanes::text) as lanes_len,
              LENGTH(brand_spine::text) as spine_len
       FROM strategy_roots 
       WHERE campaign_id = $1 
       ORDER BY created_at DESC`,
      [campaignId]
    );
    console.table(rootsRes.rows);

    console.log("\n==================== PHASE 1: STRATEGIC PLANS ====================");
    const plansRes = await client.query(
      `SELECT id, version, status, created_at, updated_at,
              LENGTH(plan_json::text) as plan_json_len,
              plan_summary
       FROM strategic_plans 
       WHERE campaign_id = $1 
       ORDER BY created_at DESC`,
      [campaignId]
    );
    console.table(plansRes.rows.map(r => ({
      id: r.id,
      version: r.version,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      plan_summary: (r.plan_summary || "").slice(0, 80)
    })));

    for (const plan of plansRes.rows) {
      console.log(`\n--- Plan ID: ${plan.id} (v${plan.version}, status: ${plan.status}, created: ${plan.created_at}) ---`);
      const fullPlan = await client.query(`SELECT plan_json FROM strategic_plans WHERE id = $1`, [plan.id]);
      if (fullPlan.rows[0]?.plan_json) {
        const pj = JSON.parse(fullPlan.rows[0].plan_json);
        console.log("Plan JSON Keys:", Object.keys(pj));
        console.log("Strategic Summary Strategy:\n", pj.strategicSummary?.strategy);
        console.log("Brand Spine inside Plan JSON:\n", JSON.stringify(pj.brandSpine, null, 2));
        console.log("Approved Lanes inside Plan JSON count:", pj.approvedLanes?.length);
        if (pj.businessRepresentation) {
          console.log("Business Representation Strategy:\n", pj.businessRepresentation?.strategicSummary?.strategy);
        }
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

traceDatabase().catch(console.error);
