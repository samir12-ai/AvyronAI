import "dotenv/config";
import { db } from "../server/db";
import {
  audienceSnapshots,
  positioningSnapshots
} from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.campaignId, campaignId)).orderBy(desc(audienceSnapshots.createdAt));
  const snap = snapRows[0];
  console.log("Audience Snapshot ID:", snap.id);
  console.log("Audience Candidate:");
  console.log(JSON.stringify(snap.audienceCandidate, null, 2));

  // Try to find the associated Product Fit / Positioning snapshot
  const posRows = await db.select().from(positioningSnapshots).where(eq(positioningSnapshots.campaignId, campaignId)).orderBy(desc(positioningSnapshots.createdAt));
  if (posRows.length > 0) {
    console.log("\nProduct Fit Data in Positioning:");
    console.log(JSON.stringify(posRows[0].productFitData, null, 2));
  }
}

main().catch(console.error).then(() => process.exit(0));
