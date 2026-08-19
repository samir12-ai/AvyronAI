import { db } from "./server/db";
import { businessDataLayer } from "./shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const bizData = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, "campaign_1786718877499_3jk4zv"));
  console.log("Business Data:");
  console.log(bizData);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
