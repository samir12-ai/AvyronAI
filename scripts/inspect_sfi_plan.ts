import "dotenv/config";
import { Pool } from "pg";

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const campaignId = "campaign_1786718877499_3jk4zv";

    // 1. Inspect strategic_plans
    const sp = await client.query("SELECT * FROM strategic_plans WHERE campaign_id = $1", [campaignId]);
    console.log("=== STRATEGIC PLANS ===");
    console.log("Count:", sp.rows.length);
    if (sp.rows.length > 0) {
      const row = sp.rows[0];
      console.log("Plan row keys:", Object.keys(row));
      console.log("Plan details:", {
        id: row.id,
        campaign_id: row.campaign_id,
        status: row.status,
        approval_status: row.approval_status,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      console.log("Sections in plan:", row.sections ? Object.keys(row.sections) : (typeof row.plan === 'object' ? Object.keys(row.plan) : "no sections key"));
      console.log("Full plan snippet:", JSON.stringify(row).slice(0, 1500));
    }

    // 2. Inspect strategy_roots
    const sr = await client.query("SELECT * FROM strategy_roots WHERE campaign_id = $1 ORDER BY id DESC LIMIT 2", [campaignId]);
    console.log("\n=== STRATEGY ROOTS ===");
    console.log("Count:", sr.rows.length);
    if (sr.rows.length > 0) {
      console.log("Strategy root 0 keys:", Object.keys(sr.rows[0]));
      console.log("Strategy root 0 summary:", {
        id: sr.rows[0].id,
        brand_spine: sr.rows[0].brand_spine,
        status: sr.rows[0].status,
        version: sr.rows[0].version,
        lanes: sr.rows[0].lanes ? (Array.isArray(sr.rows[0].lanes) ? sr.rows[0].lanes.length : Object.keys(sr.rows[0].lanes)) : "no lanes",
      });
      console.log("Strategy root 0 snippet:", JSON.stringify(sr.rows[0]).slice(0, 1500));
    }

    // 3. Inspect system_control_verdicts
    const sc = await client.query("SELECT * FROM system_control_verdicts WHERE campaign_id = $1 ORDER BY id DESC LIMIT 3", [campaignId]);
    console.log("\n=== SYSTEM CONTROL VERDICTS ===");
    console.log("Count:", sc.rows.length);
    for (const v of sc.rows) {
      console.log("Verdict row:", {
        id: v.id,
        verdict: v.verdict,
        status: v.status,
        created_at: v.created_at,
        details: v.details || v.reason || v.reasons,
      });
    }

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
