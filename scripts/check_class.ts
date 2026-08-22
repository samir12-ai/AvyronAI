import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, '3b2ca88a-1df9-4704-9bca-70e6579c2247'));
  const row = snapRows[0];
  const pains = typeof row.audiencePains === 'string' ? JSON.parse(row.audiencePains) : row.audiencePains;
  for (const p of pains) {
    console.log(`Pain: ${p.canonical}`);
    console.log(`Classification: ${p.classification}`);
    console.log(`Fit: ${p.fitType} | Eligible: ${p.eligible}`);
    console.log(`Target Covered: ${p.targetCovered}`);
    console.log(`Allowed Uses: ${p.allowedUses}`);
    console.log('---');
  }
}
main().catch(console.error).then(() => process.exit(0));
