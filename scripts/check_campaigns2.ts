import "dotenv/config";
import { db } from "../server/db";
import { users, growthCampaigns, campaignSelections } from "../shared/schema";

async function main() {
  const allUsers = await db.select().from(users);
  console.log("Users:", allUsers.map(u => ({ id: u.id, username: u.username, email: u.email, accountId: u.accountId, role: u.role })));

  const allGrowthCampaigns = await db.select().from(growthCampaigns);
  console.log("Growth Campaigns:", allGrowthCampaigns.map(c => ({ id: c.id, name: c.name, accountId: c.accountId, status: c.status })));

  const selections = await db.select().from(campaignSelections);
  console.log("Campaign Selections:", selections);

  process.exit(0);
}

main().catch(console.error);
