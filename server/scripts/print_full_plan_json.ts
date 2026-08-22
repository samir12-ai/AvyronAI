import 'dotenv/config';
import { db } from "../db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "416b4e0f-3488-457e-9e63-ed344ff2e3df";
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  console.log(JSON.stringify(plan.planJson, null, 2));

  process.exit(0);
}

main();
