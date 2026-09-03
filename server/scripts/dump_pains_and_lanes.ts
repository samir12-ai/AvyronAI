import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const jobId = "orch_1787414511671_qhu3cm";
  const campaignId = "campaign_1773576062201_6t0oxi";

  // 1. Audience Pains & Target Coverage
  const audRes = await db.execute(sql`SELECT * FROM audience_snapshots WHERE id = 'f9f9cd63-7cbc-44d2-9161-81f9ff98a381'`);
  const aud = audRes.rows[0] as any;
  console.log("=== 1. AUDIENCE PAINS ===");
  const pains = JSON.parse(aud.audience_pains || "[]");
  console.log("Total pains:", pains.length);
  pains.forEach((p: any, idx: number) => {
    console.log(`[Pain ${idx + 1}] ID: ${p.painId || p.id} | Segment: ${p.segmentId || p.segment} | Text: "${p.pain || p.description || p.statement}" | Severity: ${p.severity} | Frequency: ${p.frequency}`);
  });

  console.log("\n=== 2. TARGET COVERAGE ===");
  const tc = typeof aud.target_coverage === 'string' ? JSON.parse(aud.target_coverage) : aud.target_coverage;
  console.log("Target Coverage Status:", tc?.status);
  console.log("Segment Evaluations:", JSON.stringify(tc?.segmentEvaluations, null, 2));

  // 2. Strategic Pain Decisions / Strategy Decisions table
  const decRes = await db.execute(sql`SELECT * FROM strategy_decisions WHERE job_id = ${jobId} OR campaign_id = ${campaignId}`);
  console.log("\n=== 3. STRATEGY DECISIONS TABLE ===");
  console.log("Decisions count:", decRes.rows.length);
  decRes.rows.forEach((d: any) => {
    console.log(`[Decision] Type: ${d.decision_type} | Category: ${d.decision_category} | Key: ${d.decision_key} | Content: ${d.content?.slice(0, 150)}`);
  });

  // 3. Strategy Root / Strategy Memory / Strategy Insights
  const insRes = await db.execute(sql`SELECT * FROM strategy_insights WHERE job_id = ${jobId} OR campaign_id = ${campaignId}`);
  console.log("\n=== 4. STRATEGY INSIGHTS TABLE ===");
  console.log("Insights count:", insRes.rows.length);
  insRes.rows.forEach((i: any) => {
    console.log(`[Insight] Type: ${i.insight_type} | Engine: ${i.engine_source} | Title: ${i.title}`);
  });

  // 4. Check Root Bundle from plan
  const planRes = await db.execute(sql`SELECT * FROM strategic_plans WHERE id = '416b4e0f-3488-457e-9e63-ed344ff2e3df'`);
  const plan = planRes.rows[0] as any;
  const rootBundleId = plan?.root_bundle_id;
  console.log("\n=== 5. ROOT BUNDLE ===");
  console.log("Root Bundle ID:", rootBundleId);
  
  process.exit(0);
}

main();
