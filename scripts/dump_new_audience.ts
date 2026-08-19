import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const audRows = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  const a = audRows[0];
  console.log("=== NEW AUDIENCE SNAPSHOT ID:", a.id);
  console.log("Created At:", a.createdAt);
  console.log("Job ID:", a.jobId);
  console.log("Engine Version:", a.engineVersion);
  console.log("Status:", a.status);
  
  const segments = typeof a.audienceSegments === "string" ? JSON.parse(a.audienceSegments) : a.audienceSegments;
  console.log("\n--- AUDIENCE SEGMENTS (count=" + (segments?.length || 0) + ") ---");
  console.log(JSON.stringify(segments, null, 2));

  const targetCoverage = typeof a.targetCoverage === "string" ? JSON.parse(a.targetCoverage) : a.targetCoverage;
  console.log("\n--- TARGET COVERAGE ---");
  console.log(JSON.stringify(targetCoverage, null, 2));

  const pains = typeof a.audiencePains === "string" ? JSON.parse(a.audiencePains) : a.audiencePains;
  console.log("\n--- AUDIENCE PAINS (count=" + (pains?.length || 0) + ") ---");
  console.log(JSON.stringify(pains, null, 2));

  process.exit(0);
}

main().catch(console.error);
