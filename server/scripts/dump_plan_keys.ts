import 'dotenv/config';
import { db } from "../db";
import { strategicPlans } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const planId = "416b4e0f-3488-457e-9e63-ed344ff2e3df";
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);

  for (const [k, v] of Object.entries(plan)) {
    if (v !== null && v !== undefined) {
      console.log(`\n--- ${k} ---`);
      if (typeof v === "object" || typeof v === "string") {
        const str = typeof v === "object" ? JSON.stringify(v, null, 2) : v;
        console.log(str.slice(0, 1000));
      } else {
        console.log(v);
      }
    }
  }

  process.exit(0);
}

main();
