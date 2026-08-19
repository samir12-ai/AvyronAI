import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const res = await db.execute(sql`SELECT * FROM business_data_layer WHERE campaign_id = ${campaignId} OR account_id = 'a2d87878-a1e9-41ea-a8a5-90beff569673' LIMIT 5`);
  console.log("=== BUSINESS DATA LAYER ROWS ===");
  console.log(JSON.stringify(res.rows, null, 2));

  process.exit(0);
}

main().catch(console.error);
