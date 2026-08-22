import 'dotenv/config';
import { db } from "../db";
import { awarenessSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const [snap] = await db.select().from(awarenessSnapshots)
    .where(eq(awarenessSnapshots.campaignId, "campaign_1773576062201_6t0oxi"))
    .orderBy(desc(awarenessSnapshots.createdAt))
    .limit(1);

  console.log("Latest Awareness Snapshot:");
  console.log(`ID: ${snap?.id}`);
  console.log(`JobId: ${snap?.jobId}`);
  console.log(`Status: ${snap?.status}`);
  console.log(`StatusMessage: ${snap?.statusMessage}`);
  console.log(`PrimaryRoute: ${snap?.primaryRoute}`);
  console.log(`StructuralWarnings: ${snap?.structuralWarnings}`);
  console.log(`BoundaryCheck: ${snap?.boundaryCheck}`);
  process.exit(0);
}

main();
