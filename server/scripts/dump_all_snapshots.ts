import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787414511671_qhu3cm";
  const campaignId = "campaign_1773576062201_6t0oxi";

  // 1. Orchestrator Job State
  const jobRes = await db.execute(sql`SELECT * FROM orchestrator_jobs WHERE id = ${jobId}`);
  const job = jobRes.rows[0] as any;
  console.log("=== JOB RECORD ===");
  console.log("Job ID:", job.id);
  console.log("Job Created At:", job.created_at);
  console.log("Job Updated At:", job.updated_at);
  const state = typeof job.state === 'string' ? JSON.parse(job.state) : job.state;
  console.log("Job State Keys:", Object.keys(state || {}));

  // 2. Audience Snapshot
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const audSnap = audRes.rows[0] as any;
  console.log("\n=== AUDIENCE SNAPSHOT ===");
  console.log("Audience Snap ID:", audSnap.id);
  console.log("Audience Pains:", JSON.parse(audSnap.audience_pains || "[]"));
  console.log("Audience Segments:", JSON.parse(audSnap.audience_segments || "[]"));
  console.log("Target Coverage:", typeof audSnap.target_coverage === 'string' ? JSON.parse(audSnap.target_coverage) : audSnap.target_coverage);
  console.log("Structured Signals:", JSON.parse(audSnap.structured_signals || "{}"));

  // 3. Strategic Pain Decisions / Lanes in Job State
  if (state?.painRegistry) {
    console.log("\n=== PAIN REGISTRY IN JOB STATE ===");
    console.log(JSON.stringify(state.painRegistry, null, 2));
  }
  if (state?.strategicLanes || state?.lanes) {
    console.log("\n=== STRATEGIC LANES IN JOB STATE ===");
    console.log(JSON.stringify(state.strategicLanes || state.lanes, null, 2));
  }

  // 4. Differentiation Snapshot
  const diffRes = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const diffSnap = diffRes.rows[0] as any;
  console.log("\n=== DIFFERENTIATION SNAPSHOT ===");
  console.log("Diff Snap ID:", diffSnap.id);
  console.log("Diff Status:", diffSnap.status);
  console.log("Diff Pillars:", JSON.parse(diffSnap.differentiation_pillars || "[]"));
  console.log("Mechanism Framing:", diffSnap.mechanism_framing);
  console.log("Mechanism Core:", diffSnap.mechanism_core);
  console.log("Proof Architecture:", JSON.parse(diffSnap.proof_architecture || "{}"));

  // 5. Positioning Snapshot
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const posSnap = posRes.rows[0] as any;
  console.log("\n=== POSITIONING SNAPSHOT ===");
  console.log("Pos Snap ID:", posSnap.id);
  console.log("Territory:", posSnap.territory);
  console.log("Territories:", JSON.parse(posSnap.territories || "[]"));
  console.log("Contrast Axis:", posSnap.contrast_axis);
  console.log("Strategy Cards:", JSON.parse(posSnap.strategy_cards || "[]"));

  // 6. Mechanism Snapshot
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const mechSnap = mechRes.rows[0] as any;
  console.log("\n=== MECHANISM SNAPSHOT ===");
  console.log("Mech Snap ID:", mechSnap?.id);
  console.log("Mech Data:", JSON.stringify(mechSnap, null, 2));

  // 7. Offer Snapshot
  const offRes = await db.execute(sql`SELECT * FROM offer_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const offSnap = offRes.rows[0] as any;
  console.log("\n=== OFFER SNAPSHOT ===");
  console.log("Offer Snap ID:", offSnap?.id);
  console.log("Offer Data:", JSON.stringify(offSnap, null, 2));

  // 8. Funnel Snapshot
  const funRes = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const funSnap = funRes.rows[0] as any;
  console.log("\n=== FUNNEL SNAPSHOT ===");
  console.log("Funnel Snap ID:", funSnap?.id);
  console.log("Funnel Data:", JSON.stringify(funSnap, null, 2));

  // 9. Persuasion Snapshot
  const persRes = await db.execute(sql`SELECT * FROM persuasion_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const persSnap = persRes.rows[0] as any;
  console.log("\n=== PERSUASION SNAPSHOT ===");
  console.log("Persuasion Snap ID:", persSnap?.id);
  console.log("Persuasion Data:", JSON.stringify(persSnap, null, 2));

  // 10. Channel Selection Snapshot
  const chRes = await db.execute(sql`SELECT * FROM channel_selection_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const chSnap = chRes.rows[0] as any;
  console.log("\n=== CHANNEL SELECTION SNAPSHOT ===");
  console.log("Channel Snap ID:", chSnap?.id);
  console.log("Channel Data:", JSON.stringify(chSnap, null, 2));

  process.exit(0);
}

main();
