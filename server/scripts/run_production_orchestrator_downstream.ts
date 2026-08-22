import 'dotenv/config';
import { db } from "../db";
import { 
  orchestratorJobs, 
  strategicPlans, 
  campaignOfferings,
  businessUnderstandingSnapshots,
  audienceSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  channelSelectionSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { runOrchestrator } from "../orchestrator/index";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("============================================================");
  console.log("STARTING REAL PRODUCTION ORCHESTRATOR DOWNSTREAM RUN");
  console.log("============================================================");
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`Account ID: ${accountId}`);

  const runResult = await runOrchestrator({
    accountId,
    campaignId,
    forceRefresh: true
  });

  console.log("\n============================================================");
  console.log("ORCHESTRATOR EXECUTION FINISHED");
  console.log("============================================================");
  console.log(`Overall Status: ${runResult.status}`);
  console.log(`Job ID: ${runResult.jobId}`);
  console.log(`Duration: ${runResult.durationMs}ms`);
  console.log(`Completed Engines: ${runResult.completedEngines.join(", ")}`);

  console.log("\n--- ENGINE STEP RESULTS ---");
  if (runResult.results instanceof Map) {
    for (const [engineId, stepResult] of runResult.results.entries()) {
      console.log(`Engine: ${engineId.padEnd(25)} | Status: ${stepResult.status.padEnd(15)} | Duration: ${stepResult.durationMs || 0}ms ${stepResult.blockReason ? `| BlockReason: ${stepResult.blockReason}` : ''}`);
    }
  }

  // Load created Strategic Plan
  const [plan] = await db.select().from(strategicPlans)
    .where(eq(strategicPlans.campaignId, campaignId))
    .orderBy(desc(strategicPlans.createdAt))
    .limit(1);

  if (plan) {
    console.log("\n============================================================");
    console.log("CANONICAL STRATEGIC PLAN GENERATED");
    console.log("============================================================");
    console.log(`Plan ID: ${plan.id}`);
    console.log(`Plan Status: ${plan.status}`);
    console.log(`Target Audience:`, JSON.stringify(plan.targetAudience, null, 2));
    console.log(`Core Strategy:`, JSON.stringify(plan.coreStrategy, null, 2));
    console.log(`Positioning:`, JSON.stringify(plan.positioning, null, 2));
    console.log(`Offer:`, JSON.stringify(plan.offer, null, 2));
    console.log(`Funnel:`, JSON.stringify(plan.funnel, null, 2));
    console.log(`Channels:`, JSON.stringify(plan.channels, null, 2));
  } else {
    console.log("\nNo Strategic Plan found in DB.");
  }

  process.exit(0);
}

main().catch(err => {
  console.error("FATAL in orchestrator downstream execution:", err);
  process.exit(1);
});
