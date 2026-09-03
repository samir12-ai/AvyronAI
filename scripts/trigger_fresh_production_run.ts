import "dotenv/config";
import { runOrchestrator } from "../server/orchestrator";
import { db } from "../server/db";
import { orchestratorJobs, strategicPlans } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log(`=== TRIGGERING FRESH PRODUCTION RUN ===`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`Account ID: ${accountId}`);

  const startTime = Date.now();

  const result = await runOrchestrator({
    campaignId,
    accountId,
    forceRefresh: true,
  });

  console.log(`\n=== ORCHESTRATOR RUN FINISHED in ${((Date.now() - startTime) / 1000).toFixed(1)}s ===`);
  console.log(`Status: ${result.status}`);
  console.log(`Job ID: ${result.jobId}`);
  console.log(`Plan ID: ${result.planId}`);
  if (result.error) console.error(`Error: ${result.error}`);

  // Fetch active plan
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, result.jobId!)).limit(1);
  console.log(`Persisted Job status:`, job?.status, `planId:`, job?.planId);

  process.exit(0);
}

main().catch(err => {
  console.error("PRODUCTION RUN ERROR:", err);
  process.exit(1);
});
