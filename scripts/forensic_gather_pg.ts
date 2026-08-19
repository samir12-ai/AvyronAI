import "dotenv/config";
import { Pool } from "pg";
import * as fs from "fs";

async function gatherTrace() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const trace: any = {};
  
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const plans = await pool.query("SELECT * FROM strategic_plans WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1", [campaignId]);
    trace.activePlan = plans.rows[0];

    const jobs = await pool.query("SELECT * FROM orchestrator_jobs WHERE id = 'orch_1786957670170_4ivuno' LIMIT 1");
    trace.job = jobs.rows[0];

    const roots = await pool.query("SELECT * FROM strategy_roots WHERE id = '8b3878cb-2de3-4588-8b02-cc941e713d8e' LIMIT 1");
    trace.root = roots.rows[0];

    const snaps = await pool.query("SELECT id, engine_name, status, created_at, input_hash, payload FROM engine_snapshots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 50", [campaignId]);
    trace.snapshots = snaps.rows;

    const anchors = await pool.query("SELECT * FROM product_anchors WHERE id = 'anchor_sfi' LIMIT 1");
    trace.productAnchor = anchors.rows[0];

    try {
      const mi3 = await pool.query("SELECT * FROM market_intelligence_records WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 50", [campaignId]);
      trace.marketIntelligence = mi3.rows;
    } catch(e) {
      console.log("no market_intelligence_records");
    }

    try {
      const mi3alt = await pool.query("SELECT * FROM competitor_analysis WHERE campaign_id = $1 LIMIT 50", [campaignId]);
      trace.marketIntelligenceAlt = mi3alt.rows;
    } catch(e) {}

    try {
      const segs = await pool.query("SELECT * FROM target_audiences WHERE campaign_id = $1 LIMIT 50", [campaignId]);
      trace.segments = segs.rows;
    } catch(e) {}
    
    fs.writeFileSync("C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/full_trace_pg.json", JSON.stringify(trace, null, 2));
    console.log("Trace extracted successfully via pg.");

  } finally {
    await pool.end();
  }
}

gatherTrace().catch(console.error);
