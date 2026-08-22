import 'dotenv/config';
import { db } from "../db";
import { 
  strategicPlans, 
  orchestratorJobs,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  channelSelectionSnapshots,
  businessUnderstandingSnapshots,
  audienceSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const planId = "416b4e0f-3488-457e-9e63-ed344ff2e3df";
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  console.log("=== PLAN RECORD ===");
  console.log(JSON.stringify(plan, null, 2));

  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, plan.jobId)).limit(1);
  console.log("\n=== JOB RECORD ===");
  console.log(`Job ID: ${job.id}`);
  console.log(`Status: ${job.status}`);

  process.exit(0);
}

main();
