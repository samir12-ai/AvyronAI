import "dotenv/config";
import { db } from "../server/db";
import { growthCampaigns } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const [c] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  console.log("=== GROWTH CAMPAIGN ROW FOR MARKETMIND ===");
  console.log("ID:", c?.id);
  console.log("Name:", c?.name);
  console.log("Status:", c?.status);
  console.log("Objective:", c?.objective);
  console.log("Product Anchor:", JSON.stringify(c?.productAnchor, null, 2));

  process.exit(0);
}

main().catch(console.error);
