import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787414511671_qhu3cm";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const planId = "416b4e0f-3488-457e-9e63-ed344ff2e3df";

  console.log("=================================================");
  console.log("AUDITING JOB:", jobId);
  console.log("=================================================");

  // 1. Job Record
  const jobRes = await db.execute(sql`SELECT * FROM orchestrator_jobs WHERE id = ${jobId}`);
  const job = jobRes.rows[0] as any;
  console.log("JOB STATUS:", job?.status);
  console.log("JOB ERROR:", job?.error);

  // 2. Strategic Plan Record
  const planRes = await db.execute(sql`SELECT * FROM strategic_plans WHERE id = ${planId}`);
  const plan = planRes.rows[0] as any;
  console.log("\nPLAN SUMMARY:", plan?.plan_summary);
  console.log("PLAN STATUS:", plan?.status);
  console.log("PLAN ROOT BUNDLE ID:", plan?.root_bundle_id);

  // 3. Campaign Offering & Business Understanding
  const buRes = await db.execute(sql`SELECT * FROM business_understanding_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  console.log("\n=== BUSINESS UNDERSTANDING SNAPSHOT ===");
  console.log("BU Snap ID:", buRes.rows[0]?.id);
  console.log("BU Authority ID:", (buRes.rows[0]?.data as any)?.businessUnderstandingAuthorityId || (buRes.rows[0]?.data as any)?.id);

  // 4. Audience Snapshot
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const audSnap = audRes.rows[0] as any;
  console.log("\n=== AUDIENCE SNAPSHOT ===");
  console.log("Audience Snapshot ID:", audSnap?.id);
  const audData = typeof audSnap?.data === 'string' ? JSON.parse(audSnap?.data) : audSnap?.data;
  console.log("Audience Segments Count:", audData?.audienceSegments?.length);
  console.log("Audience Segments:", JSON.stringify(audData?.audienceSegments, null, 2));
  console.log("\nAudience Pain Registry Count:", audData?.painRegistry?.length);
  console.log("Audience Pain Registry:", JSON.stringify(audData?.painRegistry, null, 2));
  console.log("\nAudience Target Coverage:", JSON.stringify(audData?.targetCoverage, null, 2));
  console.log("\nAudience Strategic Lanes:", JSON.stringify(audData?.strategicLanes || audData?.lanes, null, 2));

  // 5. Differentiation Snapshot
  const diffRes = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const diffSnap = diffRes.rows[0] as any;
  console.log("\n=== DIFFERENTIATION SNAPSHOT ===");
  console.log("Diff Snapshot ID:", diffSnap?.id);
  const diffData = typeof diffSnap?.data === 'string' ? JSON.parse(diffSnap?.data) : diffSnap?.data;
  console.log("Diff Data:", JSON.stringify(diffData, null, 2));

  // 6. Positioning Snapshot
  const posRes = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const posSnap = posRes.rows[0] as any;
  console.log("\n=== POSITIONING SNAPSHOT ===");
  console.log("Pos Snapshot ID:", posSnap?.id);
  const posData = typeof posSnap?.data === 'string' ? JSON.parse(posSnap?.data) : posSnap?.data;
  console.log("Pos Data:", JSON.stringify(posData, null, 2));

  // 7. Mechanism Snapshot
  const mechRes = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const mechSnap = mechRes.rows[0] as any;
  console.log("\n=== MECHANISM SNAPSHOT ===");
  console.log("Mech Snapshot ID:", mechSnap?.id);
  const mechData = typeof mechSnap?.data === 'string' ? JSON.parse(mechSnap?.data) : mechSnap?.data;
  console.log("Mech Data:", JSON.stringify(mechData, null, 2));

  // 8. Offer Snapshot
  const offRes = await db.execute(sql`SELECT * FROM offer_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const offSnap = offRes.rows[0] as any;
  console.log("\n=== OFFER SNAPSHOT ===");
  console.log("Offer Snapshot ID:", offSnap?.id);
  const offData = typeof offSnap?.data === 'string' ? JSON.parse(offSnap?.data) : offSnap?.data;
  console.log("Offer Data:", JSON.stringify(offData, null, 2));

  // 9. Awareness Snapshot
  const awRes = await db.execute(sql`SELECT * FROM awareness_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const awSnap = awRes.rows[0] as any;
  console.log("\n=== AWARENESS SNAPSHOT ===");
  console.log("Awareness Snapshot ID:", awSnap?.id);
  const awData = typeof awSnap?.data === 'string' ? JSON.parse(awSnap?.data) : awSnap?.data;
  console.log("Awareness Data:", JSON.stringify(awData, null, 2));

  // 10. Funnel Snapshot
  const funRes = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const funSnap = funRes.rows[0] as any;
  console.log("\n=== FUNNEL SNAPSHOT ===");
  console.log("Funnel Snapshot ID:", funSnap?.id);
  const funData = typeof funSnap?.data === 'string' ? JSON.parse(funSnap?.data) : funSnap?.data;
  console.log("Funnel Data:", JSON.stringify(funData, null, 2));

  // 11. Persuasion Snapshot
  const persRes = await db.execute(sql`SELECT * FROM persuasion_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const persSnap = persRes.rows[0] as any;
  console.log("\n=== PERSUASION SNAPSHOT ===");
  console.log("Persuasion Snapshot ID:", persSnap?.id);
  const persData = typeof persSnap?.data === 'string' ? JSON.parse(persSnap?.data) : persSnap?.data;
  console.log("Persuasion Data:", JSON.stringify(persData, null, 2));

  // 12. Channel Selection Snapshot
  const chRes = await db.execute(sql`SELECT * FROM channel_selection_snapshots WHERE job_id = ${jobId} OR campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  const chSnap = chRes.rows[0] as any;
  console.log("\n=== CHANNEL SELECTION SNAPSHOT ===");
  console.log("Channel Snapshot ID:", chSnap?.id);
  const chData = typeof chSnap?.data === 'string' ? JSON.parse(chSnap?.data) : chSnap?.data;
  console.log("Channel Data:", JSON.stringify(chData, null, 2));

  process.exit(0);
}

main();
