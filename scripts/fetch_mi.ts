import "dotenv/config";
import { db } from "../server/db";
import { miSnapshots } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const snaps = await db.select({ id: miSnapshots.id, createdAt: miSnapshots.createdAt, status: miSnapshots.status }).from(miSnapshots).where(eq(miSnapshots.campaignId, 'campaign_1773576062201_6t0oxi')).orderBy(desc(miSnapshots.createdAt)).limit(5);
  console.log(snaps);
}
main().catch(console.error).then(() => process.exit(0));
