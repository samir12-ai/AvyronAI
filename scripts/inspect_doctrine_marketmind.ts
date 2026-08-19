import "dotenv/config";
import { resolveStrategicDoctrine } from "../server/shared/strategic-doctrine";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const doctrine = await resolveStrategicDoctrine(accountId, campaignId);
  console.log("=== RESOLVED DOCTRINE FOR MARKETMIND ===");
  console.log("Product Anchor:", JSON.stringify(doctrine?.productAnchor, null, 2));

  process.exit(0);
}

main().catch(console.error);
