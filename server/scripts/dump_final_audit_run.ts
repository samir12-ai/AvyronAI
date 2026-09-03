import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787429278658_ba94b6";
  const planId = "757b860c-2855-41f7-a4b0-c80a5b33628d";

  console.log("=== POSITIONING SNAPSHOT ===");
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId}`);
  const pos = posRes.rows[0] as any;
  console.log("Umbrella Position Name:", pos.umbrella_position_name);
  console.log("Contrast Axis:", pos.contrast_axis);
  console.log("Narrative Direction:", pos.narrative_direction);
  console.log("Enemy Definition:", pos.enemy_definition);

  console.log("\n=== MECHANISM SNAPSHOT ===");
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId}`);
  const mech = mechRes.rows[0] as any;
  console.log("Primary Mechanism:", JSON.stringify(typeof mech.primary_mechanism === 'string' ? JSON.parse(mech.primary_mechanism) : mech.primary_mechanism, null, 2));

  console.log("\n=== STRATEGIC PLAN APPROVED LANES & BRAND SPINE ===");
  const planRes = await db.execute(sql`SELECT * FROM strategic_plans WHERE id = ${planId}`);
  const plan = planRes.rows[0] as any;
  const pJson = typeof plan.plan_json === 'string' ? JSON.parse(plan.plan_json) : plan.plan_json;
  console.log("Approved Lanes:", JSON.stringify(pJson.approvedLanes, null, 2));
  console.log("Brand Spine:", JSON.stringify(pJson.brandSpine, null, 2));
  console.log("Business Representation Strategic Summary:", JSON.stringify(pJson.businessRepresentation?.strategicSummary, null, 2));

  process.exit(0);
}

main();
