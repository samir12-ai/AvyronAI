import "dotenv/config";
import { Pool } from "pg";
import { generatePlanWithAI, PLAN_SYNTHESIS_MAX_TOKENS } from "../server/orchestrator/plan-synthesis";
import { translateStrategyPlanToBusinessLanguage } from "../server/core/business-language-layer";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const campaignId = "campaign_1786718877499_3jk4zv";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  try {
    const rootRes = await client.query("SELECT * FROM strategy_roots WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1", [campaignId]);
    const activeRoot = rootRes.rows[0];
    console.log("Using Strategy Root:", activeRoot.id, "created:", activeRoot.created_at);

    // Parse root fields
    activeRoot.brandSpine = typeof activeRoot.brand_spine === "string" ? JSON.parse(activeRoot.brand_spine) : activeRoot.brand_spine;
    activeRoot.approvedLanes = typeof activeRoot.approved_lanes === "string" ? JSON.parse(activeRoot.approved_lanes) : activeRoot.approved_lanes;
    activeRoot.approvedMechanism = typeof activeRoot.approved_mechanism === "string" ? JSON.parse(activeRoot.approved_mechanism) : activeRoot.approved_mechanism;
    activeRoot.approvedAudiencePains = typeof activeRoot.approved_audience_pains === "string" ? JSON.parse(activeRoot.approved_audience_pains) : activeRoot.approved_audience_pains;

    console.log("Root Brand Spine:", activeRoot.brandSpine?.umbrellaPositionName);
    console.log("Root Contrast Axis:", activeRoot.contrast_axis_text);
    console.log("Root Approved Lanes count:", activeRoot.approvedLanes?.length);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
