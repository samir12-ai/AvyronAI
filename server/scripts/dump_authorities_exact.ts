import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787420716056_rbf142";
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("=================================================");
  console.log("PART 1 — EXACT AUTHORITY CHAIN DUMP");
  console.log("=================================================\n");

  // 1. Business Understanding
  const buRes = await db.execute(sql`SELECT * FROM business_understanding_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const buSnap = buRes.rows[0] as any;
  const bu = typeof buSnap?.business_understanding === 'string' ? JSON.parse(buSnap.business_understanding) : buSnap?.business_understanding;
  console.log("=== BUSINESS UNDERSTANDING SNAPSHOT ===");
  console.log("Snapshot ID:", buSnap?.id);
  console.log("Authority ID:", bu?.businessUnderstandingAuthorityId);
  console.log("Campaign Offering ID:", bu?.campaignOfferingId || bu?.campaignOffering?.id);
  console.log("Target Understanding Authority ID:", bu?.targetUnderstanding?.targetUnderstandingAuthorityId);
  console.log("Product Truth Facts:", JSON.stringify(bu?.campaignOffering?.productTruthFacts, null, 2));

  // 2. Audience Snapshot
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = ${jobId}`);
  const audSnap = audRes.rows[0] as any;
  console.log("\n=== AUDIENCE SNAPSHOT ===");
  console.log("Snapshot ID:", audSnap?.id);
  console.log("Target Coverage:", JSON.stringify(audSnap?.target_coverage, null, 2));
  console.log("Audience Segments:", JSON.stringify(audSnap?.audience_segments, null, 2));

  // 3. Strategic Pain Decision for seg_3_pain_1
  const spdRes = await db.execute(sql`SELECT * FROM strategic_pain_decisions WHERE job_id = ${jobId} AND pain_id = 'seg_3_pain_1'`);
  console.log("\n=== STRATEGIC PAIN DECISION (seg_3_pain_1) ===");
  console.log(JSON.stringify(spdRes.rows[0], null, 2));

  // 4. Differentiation Snapshot
  const diffRes = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE job_id = ${jobId}`);
  const diffSnap = diffRes.rows[0] as any;
  console.log("\n=== DIFFERENTIATION SNAPSHOT ===");
  console.log("Snapshot ID:", diffSnap?.id);
  console.log("Pillars:", JSON.stringify(diffSnap?.pillars, null, 2));
  console.log("Proof Architecture:", JSON.stringify(diffSnap?.proof_architecture, null, 2));
  console.log("Mechanism Core:", JSON.stringify(diffSnap?.mechanism_core, null, 2));

  // 5. Positioning Snapshot
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId}`);
  const posSnap = posRes.rows[0] as any;
  console.log("\n=== POSITIONING SNAPSHOT ===");
  console.log("Snapshot ID:", posSnap?.id);
  console.log("Umbrella Positioning:", posSnap?.umbrella_position_name || posSnap?.name);
  console.log("Contrast Axis:", posSnap?.contrast_axis);
  console.log("Narrative Direction:", posSnap?.narrative_direction);
  console.log("Territories:", JSON.stringify(posSnap?.territories, null, 2));
  console.log("Selected Territory:", JSON.stringify(posSnap?.selected_territory, null, 2));

  // 6. Mechanism Snapshot
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId}`);
  const mechSnap = mechRes.rows[0] as any;
  console.log("\n=== MECHANISM SNAPSHOT ===");
  console.log("Snapshot ID:", mechSnap?.id);
  console.log("Primary Mechanism:", JSON.stringify(mechSnap?.primary_mechanism, null, 2));
  console.log("Alternative Mechanism:", JSON.stringify(mechSnap?.alternative_mechanism, null, 2));

  // 7. Offer Snapshot
  const offerRes = await db.execute(sql`SELECT * FROM offer_snapshots WHERE job_id = ${jobId}`);
  const offerSnap = offerRes.rows[0] as any;
  console.log("\n=== OFFER SNAPSHOT ===");
  console.log("Snapshot ID:", offerSnap?.id);
  console.log("Offer Name:", offerSnap?.offer_name);
  console.log("Core Outcome:", offerSnap?.core_outcome);
  console.log("Deliverables:", JSON.stringify(offerSnap?.deliverables, null, 2));
  console.log("Mechanism Description:", offerSnap?.mechanism_description);

  process.exit(0);
}

main().catch(err => {
  console.error("Error in dump:", err);
  process.exit(1);
});
