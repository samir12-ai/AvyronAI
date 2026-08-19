import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans, orchestratorJobs, strategyRoots, planDocuments, engineSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function phase0() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  console.log(`Resolving lineage for campaign: ${campaignId}`);

  const [activePlan] = await db
    .select()
    .from(strategicPlans)
    .where(eq(strategicPlans.campaignId, campaignId))
    .orderBy(desc(strategicPlans.version))
    .limit(1);

  if (!activePlan) {
    console.log("No active plan found.");
    return;
  }

  console.log(`Active Plan ID: ${activePlan.id}`);
  console.log(`Version: ${activePlan.version}`);
  console.log(`Status: ${activePlan.status}`);

  const [job] = await db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.planId, activePlan.id))
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(1);

  let runId = null;

  if (job) {
    console.log(`Source Orchestrator Job ID: ${job.id}`);
    runId = job.runId;
    console.log(`Source Run ID: ${job.runId}`);
    
    // Look up root from the job metadata or from the latest strategyRoot for this campaign/runId
    const metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
    console.log(`Job Engine Snapshots:`);
    if (metadata?.engineSnapshots) {
      Object.entries(metadata.engineSnapshots).forEach(([engine, snapId]) => {
        console.log(`  - ${engine}: ${snapId}`);
      });
    }
  }
  
  const [root] = await db
    .select()
    .from(strategyRoots)
    .where(eq(strategyRoots.runId, runId || "run_1786957802542_6xu0bv"))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);
    
  if (root) {
    console.log(`Active Strategy Root ID: ${root.id}`);
  } else {
    // try fallback by campaignId
    const [fbRoot] = await db.select().from(strategyRoots).where(eq(strategyRoots.campaignId, campaignId)).orderBy(desc(strategyRoots.createdAt)).limit(1);
    console.log(`Active Strategy Root ID (fallback): ${fbRoot?.id}`);
  }

  // Also query engineSnapshots for this runId/jobId
  const snaps = await db.select({ id: engineSnapshots.id, engine: engineSnapshots.engineName, status: engineSnapshots.status }).from(engineSnapshots).where(eq(engineSnapshots.campaignId, campaignId)).orderBy(desc(engineSnapshots.createdAt)).limit(20);
  console.log(`Recent Snapshots for campaign:`);
  snaps.forEach(s => console.log(`  ${s.engine}: ${s.id} (${s.status})`));
}

phase0().catch(console.error);
