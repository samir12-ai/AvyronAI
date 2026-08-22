import 'dotenv/config';
import { db } from "../db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "416b4e0f-3488-457e-9e63-ed344ff2e3df";
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  console.log("=== TARGET AUDIENCE ===");
  console.log(plan.targetAudience);

  console.log("\n=== CORE STRATEGY ===");
  console.log(plan.coreStrategy);

  console.log("\n=== POSITIONING ===");
  console.log(plan.positioning);

  console.log("\n=== OFFER ===");
  console.log(plan.offer);

  console.log("\n=== FUNNEL ===");
  console.log(plan.funnel);

  console.log("\n=== CHANNELS ===");
  console.log(plan.channels);

  console.log("\n=== PERSUASION DRIVERS ===");
  console.log(plan.persuasionDrivers);

  console.log("\n=== STRATEGIC LANES ===");
  console.log(plan.strategicLanes);

  process.exit(0);
}

main();
