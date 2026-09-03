import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='strategic_plans'");
    console.log("strategic_plans cols:", cols.rows.map((c: any) => c.column_name).join(", "));

    const plan = await client.query(
      "SELECT id, plan_json FROM strategic_plans WHERE id=$1",
      ["9ba567fd-0ae1-4d69-91b1-0ab561ac5960"]
    );
    if (plan.rows[0]) {
      const p = JSON.parse(plan.rows[0].plan_json);
      console.log("\nStrategic Summary Growth Objective:", p.strategicSummary?.growthObjective);
      console.log("Strategic Summary Target Audience:", p.strategicSummary?.targetAudience);
      console.log("Strategic Summary Strategy:", p.strategicSummary?.strategy);
      console.log("\nMonthly Objective:", JSON.stringify(p.monthlyObjective, null, 2));
      console.log("\nKPI Structure:", JSON.stringify(p.kpiStructure, null, 2));
      
      if (p.buyerConversionJourneys) {
        console.log("\nBuyer Conversion Journeys count:", p.buyerConversionJourneys.length);
        for (const j of p.buyerConversionJourneys) {
          console.log(`\n--- Journey Lane: ${j.laneId} | Name: ${j.laneName || j.laneTitle || j.title} ---`);
          console.log(`Target Segment: ${j.targetSegment || j.segment}`);
          console.log(`Core Pain: ${j.corePain || j.primaryPain || j.pain}`);
          console.log(`Stages count: ${j.stages?.length}`);
          for (const st of (j.stages || [])) {
            console.log(`  Stage: ${st.stageName || st.name}`);
            console.log(`    Goal: ${st.goal}`);
            console.log(`    Core Message: ${st.coreMessage}`);
            console.log(`    Proof: ${JSON.stringify(st.proof)}`);
            console.log(`    CTA: ${st.cta}`);
            if (st.metrics || st.projections || st.prospects || st.traffic || st.conversion) {
              console.log(`    Metrics: ${JSON.stringify(st.metrics || st.projections || { prospects: st.prospects, ctr: st.ctr, conversion: st.conversion })}`);
            }
          }
        }
      }

      if (p.funnel) {
        console.log("\nTop-level funnel keys:", Object.keys(p.funnel));
        console.log("Funnel stages:", JSON.stringify(p.funnel.stages || p.funnel.stagesSummary || p.funnel, null, 2).substring(0, 1500));
      }

      if (p.persuasionStrategy) {
        console.log("\nPersuasion Strategy keys:", Object.keys(p.persuasionStrategy));
        console.log("Trust Strategy:", JSON.stringify(p.persuasionStrategy.trustStrategy, null, 2));
        console.log("Objections count:", p.persuasionStrategy.objectionHandling?.length || p.persuasionStrategy.objections?.length);
        console.log("Sample Objections:", JSON.stringify(p.persuasionStrategy.objectionHandling?.slice(0, 3) || p.persuasionStrategy.objections?.slice(0, 3), null, 2));
      }
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
