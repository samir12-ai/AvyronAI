import "dotenv/config";
import { db } from "../server/db";
import { campaigns, accounts, users, campaignSelections } from "../shared/schema";

async function main() {
  const allAccounts = await db.select().from(accounts);
  console.log("Accounts:", allAccounts.map(a => ({ id: a.id, email: a.email, name: a.name })));

  const allUsers = await db.select().from(users);
  console.log("Users:", allUsers.map(u => ({ id: u.id, username: u.username, accountId: u.accountId })));

  const allCampaigns = await db.select().from(campaigns);
  console.log("Campaigns:", allCampaigns.map(c => ({ id: c.id, name: c.name, accountId: c.accountId, status: c.status })));

  const selections = await db.select().from(campaignSelections);
  console.log("Campaign Selections:", selections);

  process.exit(0);
}

main().catch(console.error);
