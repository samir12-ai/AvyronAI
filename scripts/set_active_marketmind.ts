import "dotenv/config";
import { db } from "../server/db";
import { campaignSelections } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const campaignName = "MarketMindAI Launch";

  await db
    .update(campaignSelections)
    .set({
      selectedCampaignId: campaignId,
      selectedCampaignName: campaignName,
      updatedAt: new Date(),
    })
    .where(eq(campaignSelections.accountId, accountId));

  console.log(`Successfully updated active campaign selection for ${accountId} to ${campaignName} (${campaignId})`);
  process.exit(0);
}

main().catch(console.error);
