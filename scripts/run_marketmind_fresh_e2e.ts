import "dotenv/config";
import { runOrchestrator } from "../server/orchestrator";
import { db } from "../server/db";
import {
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  funnelSnapshots,
  channelSelectionSnapshots,
  strategyRoots,
  strategicPlans,
  goalDecompositions,
  growthSimulations,
  systemControlVerdicts,
  orchestratorJobs
} from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log("================================================================================");
  console.log("  STARTING FRESH LIVE MARKETMIND E2E ORCHESTRATOR RUN                           ");
  console.log(`  Campaign: ${campaignId} | Account: ${accountId}`);
  console.log("================================================================================");

  const t0 = Date.now();

  try {
    const result = await runOrchestrator({
      campaignId,
      accountId,
      forceRefresh: true,
      onProgress: (ev: any) => {
        const time = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[+${time}s] [${ev.engineId || ev.phase || "orchestrator"}] ${ev.status || ev.type || ""} ${ev.message || ""}`);
      },
    });

    console.log(`\n================================================================================`);
    console.log(`  ORCHESTRATION FINISHED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  Job ID: ${result.jobId}`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Plan ID: ${result.planId}`);
    console.log(`  Completed Engines: ${result.completedEngines?.join(", ")}`);
    console.log(`  Failed Engine: ${result.failedEngine || "NONE"}`);
    console.log(`  Block Reason: ${result.blockReason || "NONE"}`);
    console.log(`  System Verdict: ${result.systemVerdict}`);
    console.log(`  Recommended Mode: ${result.recommendedExecutionMode}`);
    console.log("================================================================================");

  } catch (err: any) {
    console.error("Fresh E2E Orchestrator Run encountered fatal error:", err);
  }

  process.exit(0);
}

main().catch(console.error);
