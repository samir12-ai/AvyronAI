import "dotenv/config";
import { db } from "../server/db";
import {
  audienceSnapshots
} from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, '95037cde-89a9-42bc-8487-9750c4c458eb'));
  const row = snapRows[0];
  
  const segments = typeof row.audienceSegments === 'string' ? JSON.parse(row.audienceSegments) : row.audienceSegments;
  
  for (const seg of segments) {
    console.log(`\nSegment: ${seg.name}`);
    console.log(`Pains:`);
    seg.pains?.forEach((p: any) => {
      console.log(`- ${p.claim || p.description}`);
    });
  }
}

main().catch(console.error).then(() => process.exit(0));
