import "dotenv/config";
import { db } from "../server/db";
import {
  audienceSnapshots
} from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, '3b2ca88a-1df9-4704-9bca-70e6579c2247'));
  const row = snapRows[0];
  console.log("Target Coverage:");
  console.log(JSON.stringify(row.targetCoverage, null, 2));
  console.log("\nAudience Segments:");
  const segments = typeof row.audienceSegments === 'string' ? JSON.parse(row.audienceSegments) : row.audienceSegments;
  console.log(JSON.stringify(segments.map((s: any) => ({id: s.id, name: s.name, role: s.role, canonicalRole: s.canonicalRole})), null, 2));
  console.log("\nInput Summary:");
  const summary = typeof row.inputSummary === 'string' ? JSON.parse(row.inputSummary) : row.inputSummary;
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error).then(() => process.exit(0));
