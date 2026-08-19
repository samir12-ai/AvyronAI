import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1786718877499_3jk4zv";

  try {
    console.log("=== Strategy Roots ===");
    const roots = await client.query("SELECT id, brand_spine, approved_lanes, created_at FROM strategy_roots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 5", [campaignId]);
    roots.rows.forEach(r => {
      console.log(`Root ID: ${r.id} | Date: ${r.created_at}`);
      console.log("Brand Spine:", r.brand_spine);
      console.log("Approved Lanes count:", (r.approved_lanes || []).length);
    });

    console.log("\n=== Strategic Plans ===");
    const plans = await client.query("SELECT id, status, plan_summary, created_at, plan_json FROM strategic_plans WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 5", [campaignId]);
    plans.rows.forEach(p => {
      console.log(`Plan ID: ${p.id} | Status: ${p.status} | Date: ${p.created_at}`);
      console.log("Plan Summary:", p.plan_summary?.slice(0, 120));
      if (p.plan_json) {
        const pj = JSON.parse(p.plan_json);
        console.log("Strategic Summary keys:", Object.keys(pj.strategicSummary || {}));
        console.log("Strategy:", pj.strategicSummary?.strategy?.slice(0, 150));
        console.log("Has Business Representation:", !!pj.businessRepresentation);
      }
    });

    console.log("\n=== System Control Verdicts ===");
    const verdicts = await client.query("SELECT id, verdict, proposed_mode, created_at FROM system_control_verdicts WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 5", [campaignId]);
    verdicts.rows.forEach(v => {
      console.log(`Verdict ID: ${v.id} | Verdict: ${v.verdict} | Mode: ${v.proposed_mode} | Date: ${v.created_at}`);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
