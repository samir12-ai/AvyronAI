import 'dotenv/config';
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  const planRes = await db.execute(sql`SELECT * FROM strategic_plans WHERE id = '416b4e0f-3488-457e-9e63-ed344ff2e3df'`);
  const plan = planRes.rows[0] as any;
  const pJson = typeof plan.plan_json === 'string' ? JSON.parse(plan.plan_json) : plan.plan_json;

  console.log("=== PLAN JSON KEYS ===");
  console.log(Object.keys(pJson));

  if (pJson.strategicLanes) {
    console.log("\n=== STRATEGIC LANES IN PLAN ===");
    console.log(JSON.stringify(pJson.strategicLanes, null, 2));
  }

  if (pJson.businessRepresentation) {
    console.log("\n=== BUSINESS REPRESENTATION ===");
    console.log(JSON.stringify(pJson.businessRepresentation, null, 2));
  }

  process.exit(0);
}

main();
