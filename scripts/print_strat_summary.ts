import "dotenv/config";
import { db } from "../server/db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "plan_canonical_1787563986548";
  const [p] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId));
  const plan = JSON.parse(p.planJson);
  console.log("=== STRATEGY ===");
  console.log(plan.strategicSummary.strategy);
  console.log("=== TARGET AUDIENCE ===");
  console.log(plan.strategicSummary.targetAudience);
  console.log("=== RATIONALE ===");
  console.log(plan.strategicSummary.rationale);
}

main().catch(console.error);
