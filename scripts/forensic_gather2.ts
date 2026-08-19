import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

async function gatherTrace() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const trace: any = {};

  const activePlan = await db.execute(sql`SELECT * FROM strategic_plans WHERE campaign_id = ${campaignId} ORDER BY version DESC LIMIT 1`);
  trace.activePlan = activePlan.rows[0];

  const job = await db.execute(sql`SELECT * FROM orchestrator_jobs WHERE id = 'orch_1786957670170_4ivuno' LIMIT 1`);
  trace.job = job.rows[0];

  const root = await db.execute(sql`SELECT * FROM strategy_roots WHERE id = '8b3878cb-2de3-4588-8b02-cc941e713d8e' LIMIT 1`);
  trace.root = root.rows[0];

  const snaps = await db.execute(sql`SELECT id, engine_name, status, created_at, input_hash, payload FROM engine_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 50`);
  trace.snapshots = snaps.rows;

  const anchors = await db.execute(sql`SELECT * FROM product_anchors WHERE id = 'anchor_sfi' LIMIT 1`);
  trace.productAnchor = anchors.rows[0];

  try {
    const mi3 = await db.execute(sql`SELECT * FROM market_intelligence WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
    trace.marketIntelligence = mi3.rows[0];
  } catch (e) {
    console.log("No market_intelligence table or error");
  }

  try {
    const segments = await db.execute(sql`SELECT * FROM target_audiences WHERE campaign_id = ${campaignId} LIMIT 50`);
    trace.segments = segments.rows;
  } catch(e) {}

  fs.writeFileSync("C:/Users/mahmo/.gemini/antigravity/brain/f336cf20-23bb-4ecf-ad9a-7bee22987109/scratch/full_trace.json", JSON.stringify(trace, null, 2));
  console.log("Trace extracted successfully.");
}

gatherTrace().catch(console.error);
