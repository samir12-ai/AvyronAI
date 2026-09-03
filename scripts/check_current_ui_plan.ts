import "dotenv/config";
import { db } from "../server/db";
import { orchestratorJobs, strategicPlans } from "../shared/schema";
import { eq, desc, and } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  console.log("=== ORCHESTRATOR JOBS FOR CAMPAIGN ===");
  const jobs = await db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.campaignId, campaignId))
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(10);
  
  for (const j of jobs) {
    console.log(`Job ID: ${j.id} | Status: ${j.status} | Plan ID: ${j.planId} | Created: ${j.createdAt} | Completed: ${j.completedAt}`);
  }

  console.log("\n=== STRATEGIC PLANS FOR CAMPAIGN ===");
  const plans = await db
    .select()
    .from(strategicPlans)
    .where(eq(strategicPlans.campaignId, campaignId))
    .orderBy(desc(strategicPlans.createdAt))
    .limit(10);

  for (const p of plans) {
    const planJson = JSON.parse(p.planJson || "{}");
    const journeys = planJson.buyerConversionJourneys || planJson.buyerJourneys || [];
    const lanes = planJson.approvedLanes || [];
    console.log(`Plan ID: ${p.id} | Status: ${p.status} | Created: ${p.createdAt} | Lanes Count: ${lanes.length} | Journeys Count: ${journeys.length}`);
  }

  console.log("\n=== TESTING HTTP API DIRECTLY ===");
  try {
    const res = await fetch("http://localhost:5000/api/plans/active/campaign_1773576062201_6t0oxi", {
      headers: { "x-account-id": "a2d87878-a1e9-41ea-a8a5-90beff569673" }
    });
    const data = await res.json();
    console.log("HTTP /api/plans/active status:", res.status);
    console.log("HTTP /api/plans/active response planId:", data.plan?.id);
    console.log("HTTP /api/plans/active response job/runId:", data.runId);
    if (data.plan?.planJson) {
      const pJson = typeof data.plan.planJson === 'string' ? JSON.parse(data.plan.planJson) : data.plan.planJson;
      console.log("Plan JSON approvedLanes:", pJson.approvedLanes);
      console.log("Plan JSON buyerConversionJourneys length:", pJson.buyerConversionJourneys?.length);
    }
  } catch (err: any) {
    console.error("HTTP error:", err.message);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
