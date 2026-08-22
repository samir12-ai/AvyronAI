import "dotenv/config";
import { db } from "../server/db";
import {
  audienceSnapshots
} from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, '3b2ca88a-1df9-4704-9bca-70e6579c2247'));
  const row = snapRows[0];
  
  const segments = typeof row.audienceSegments === 'string' ? JSON.parse(row.audienceSegments) : row.audienceSegments;
  
  for (const seg of segments) {
    console.log(`\nSegment: ${seg.name}`);
    console.log(`Role: ${seg.role} (canonical: ${seg.canonicalRole})`);
    console.log(`Pains:`);
    seg.pains?.forEach((p: any) => {
      console.log(`- [${p.claimId}] ${p.claim || p.description}`);
    });
  }
}

main().catch(console.error).then(() => process.exit(0));
