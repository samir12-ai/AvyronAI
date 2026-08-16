import 'dotenv/config';
import { db } from '../server/db';
import { growthCampaigns } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [existing] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, "campaign_1786718877499_3jk4zv"));
  if (existing) {
    console.log("Campaign row already exists in growthCampaigns:", existing);
    return;
  }

  const [inserted] = await db.insert(growthCampaigns).values({
    id: "campaign_1786718877499_3jk4zv",
    name: "SFI Peptide Supplier Dubai",
    stage: "research",
    dayNumber: 1,
    totalDays: 90,
    budget: "1000",
    spent: "0",
    isActive: true,
    explorationBudgetPercent: 20,
    startedAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  console.log("Successfully created campaign row in growthCampaigns:", inserted);
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
