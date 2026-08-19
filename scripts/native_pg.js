require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

async function extractTrace() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const trace = {};
  const campaignId = 'campaign_1786718877499_3jk4zv';
  
  try {
    const plans = await pool.query("SELECT * FROM strategic_plans WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1", [campaignId]);
    trace.activePlan = plans.rows[0];

    const roots = await pool.query("SELECT * FROM strategy_roots WHERE id = '8b3878cb-2de3-4588-8b02-cc941e713d8e' LIMIT 1");
    trace.root = roots.rows[0];

    const tables = [
      'audience_snapshots', 'positioning_snapshots', 'differentiation_snapshots',
      'mechanism_snapshots', 'offer_snapshots', 'funnel_snapshots',
      'persuasion_snapshots', 'awareness_snapshots', 'market_memory', 'ci_market_analyses',
      'commercial_reasoning_snapshots', 'pipeline_snapshots', 'build_plan_snapshots', 'ci_snapshots', 'mi_snapshots'
    ];
    
    trace.engineData = {};
    for (const table of tables) {
      try {
        const snap = await pool.query(`SELECT * FROM ${table} WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1`, [campaignId]);
        if (snap.rows.length > 0) {
          trace.engineData[table] = snap.rows[0];
        }
      } catch(e) {
      }
    }
    
    fs.writeFileSync("C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/full_trace_pg.json", JSON.stringify(trace, null, 2));
    console.log("Extracted engine snapshots.");

  } finally {
    await pool.end();
  }
}
extractTrace();
