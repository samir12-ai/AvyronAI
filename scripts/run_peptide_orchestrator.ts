import 'dotenv/config';
import { runOrchestrator } from '../server/orchestrator/index';
import { db } from '../server/db';
import { growthCampaigns } from '../shared/schema';

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log(`[Script] Starting orchestrator run for campaign ${campaignId}...`);
  try {
    const result = await runOrchestrator({
      accountId,
      campaignId,
      forceRefresh: true,
    });
    console.log("=== ORCHESTRATOR RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Completed Engines: ${result.completedEngines.join(", ")}`);
    if (result.failedEngine) {
      console.log(`Failed Engine: ${result.failedEngine}`);
    }
    if (result.blockReason) {
      console.log(`Block Reason: ${result.blockReason}`);
    }
  } catch (err: any) {
    console.error("Orchestrator threw error:", err);
  }
}

main().then(() => process.exit(0));
