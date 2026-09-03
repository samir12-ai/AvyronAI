import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
    const campaignId = "camp_mtewrp8kkom3";

    // 1. Get MI snapshots for this campaign
    const miSnaps = await client.query(`
      SELECT *
      FROM mi_snapshots
      WHERE account_id = $1
      ORDER BY created_at DESC
    `, [accountId]);
    console.log("=== MI SNAPSHOTS ===");
    console.log(`Count: ${miSnaps.rows.length}`);
    for (const r of miSnaps.rows) {
      console.log(`MI Snapshot ID: ${r.id}, Status: ${r.status}, MarketState: ${r.market_state}, CreatedAt: ${r.created_at}`);
      console.log(`Data Freshness: ${r.data_freshness}, Overall Confidence: ${r.overall_confidence}`);
      console.log(`Signal Data length: ${r.signal_data?.length}`);
      console.log(`Multi-Source Signals length: ${r.multi_source_signals?.length}`);
      if (r.multi_source_signals) {
        try {
          const mss = JSON.parse(r.multi_source_signals);
          console.log("MSS keys:", Object.keys(mss));
          console.log("MSS sample:", JSON.stringify(mss).slice(0, 300));
        } catch {}
      }
    }

    // 2. Check all tables where account_id or campaign_id matches
    console.log("\n=== SUMMARY OF ALL ROWS FOR CAMPAIGN camp_mtewrp8kkom3 ===");
    const tables = [
      "ci_competitors", "competitor_sources", "ci_competitor_posts", "ci_competitor_comments",
      "ci_competitor_reviews", "competitor_website_snapshots", "mi_fetch_jobs", "mi_refresh_schedule",
      "mi_snapshots", "audience_snapshots", "positioning_snapshots", "differentiation_snapshots",
      "mechanism_snapshots", "offer_snapshots", "awareness_snapshots", "funnel_snapshots",
      "persuasion_snapshots", "orchestrator_jobs", "strategic_plans", "system_control_verdicts"
    ];

    for (const t of tables) {
      try {
        const count = await client.query(`SELECT count(*) as count FROM ${t} WHERE account_id = $1 OR campaign_id = $2`, [accountId, campaignId]);
        console.log(`Table ${t.padEnd(30)}: ${count.rows[0].count} rows`);
      } catch (e: any) {
        console.log(`Table ${t.padEnd(30)}: ERROR (${e.message})`);
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
