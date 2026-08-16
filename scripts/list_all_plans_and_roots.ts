import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  console.log("DB URL in env:", process.env.DATABASE_URL);
  
  const { db } = await import("../server/db");
  const { strategicPlans, strategyRoots, growthCampaigns } = await import("../shared/schema");
  const { desc } = await import("drizzle-orm");

  const campaigns = await db.select().from(growthCampaigns);
  console.log(`Campaigns count: ${campaigns.length}`);
  campaigns.forEach(c => {
    console.log(`- Campaign ID: ${c.id}, Name: ${c.name}, Business Type: ${c.businessType}`);
  });

  const roots = await db.select().from(strategyRoots).orderBy(desc(strategyRoots.createdAt));
  console.log(`\nStrategy Roots count: ${roots.length}`);
  roots.forEach((r, idx) => {
    console.log(`- Root ${idx + 1}: ID: ${r.id}, Campaign ID: ${r.campaignId}, Status: ${r.status}, Hash: ${r.rootHash}, Created At: ${r.createdAt}`);
  });

  const plans = await db.select().from(strategicPlans).orderBy(desc(strategicPlans.createdAt));
  console.log(`\nStrategic Plans count: ${plans.length}`);
  plans.forEach((p, idx) => {
    console.log(`- Plan ${idx + 1}: ID: ${p.id}, Campaign ID: ${p.campaignId}, Status: ${p.status}, Created At: ${p.createdAt}`);
  });
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
