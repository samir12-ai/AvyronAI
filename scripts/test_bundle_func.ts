import "dotenv/config";
import { buildCampaignEvidenceBundle } from "../server/competitive-intelligence/evidence-bundle";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  console.log("Calling buildCampaignEvidenceBundle...");
  const bundle = await buildCampaignEvidenceBundle(accountId, campaignId);
  console.log("SUCCESS! Bundle Counts:", bundle.counts);
}

main().catch(console.error);
