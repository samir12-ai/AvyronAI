import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, miSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [aud] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, "5921969d-4b59-48e0-9373-a78d708683d8")).limit(1);
  console.log("Audience Snapshot:", { accountId: aud?.accountId, campaignId: aud?.campaignId, inputSnapshotId: aud?.inputSnapshotId });

  const miList = await db.select().from(miSnapshots).where(eq(miSnapshots.campaignId, aud?.campaignId || "camp_mtewrp8kkom3"));
  console.log("MI Snapshots count for campaign:", miList.length);
  miList.forEach(m => console.log({ id: m.id, accountId: m.accountId, status: m.status, createdAt: m.createdAt }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
