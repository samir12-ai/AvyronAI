import "dotenv/config";
import { db } from "../server/db";
import {
  audienceSnapshots,
  positioningSnapshots,
  systemControlVerdicts,
  orchestratorJobs
} from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const jobId = "orch_1787045639283_ga73ix";

  console.log("=== INSPECTING FRESH RUN OUTPUTS ===");
  console.log("Job ID:", jobId);

  // 1. Audience Snapshot
  const audRows = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (audRows[0]) {
    const a = audRows[0];
    console.log(`\n--- NEW AUDIENCE SNAPSHOT (${a.id}) ---`);
    console.log("Engine Version:", a.engineVersion);
    console.log("CreatedAt:", a.createdAt);
    console.log("Status:", a.status);
    console.log("Audience Segments:", typeof a.audienceSegments === "string" ? JSON.parse(a.audienceSegments) : a.audienceSegments);
    console.log("Target Coverage:", typeof a.targetCoverage === "string" ? JSON.parse(a.targetCoverage) : a.targetCoverage);
    console.log("Audience Pains (count=" + (Array.isArray(a.audiencePains) ? a.audiencePains.length : JSON.parse((a.audiencePains as string) || "[]").length) + "):");
    const pains = Array.isArray(a.audiencePains) ? a.audiencePains : JSON.parse((a.audiencePains as string) || "[]");
    console.log(JSON.stringify(pains.slice(0, 10), null, 2));
    console.log("Desires:", a.desires);
    console.log("Unresolved Needs:", a.unresolvedNeeds);
  }

  // 2. Positioning Snapshot
  const posRows = await db
    .select()
    .from(positioningSnapshots)
    .where(eq(positioningSnapshots.campaignId, campaignId))
    .orderBy(desc(positioningSnapshots.createdAt))
    .limit(1);

  if (posRows[0] && posRows[0].jobId === jobId) {
    console.log(`\n--- NEW POSITIONING SNAPSHOT (${posRows[0].id}) ---`);
    console.log("Territory:", posRows[0].territory);
  } else {
    console.log(`\n--- NO NEW POSITIONING SNAPSHOT (Positioning blocked before snapshot creation) ---`);
  }

  // 3. System Control Verdict
  const scRows = await db
    .select()
    .from(systemControlVerdicts)
    .where(eq(systemControlVerdicts.campaignId, campaignId))
    .orderBy(desc(systemControlVerdicts.createdAt))
    .limit(1);

  if (scRows[0]) {
    const sc = scRows[0];
    console.log(`\n--- NEW SYSTEM CONTROL VERDICT (${sc.id}) ---`);
    console.log("Verdict:", sc.verdict);
    console.log("Execution Mode:", sc.executionMode);
    console.log("CreatedAt:", sc.createdAt);
    console.log("Block Reasons:", typeof sc.blockReasons === "string" ? JSON.parse(sc.blockReasons) : sc.blockReasons);
    console.log("Structural Checks:", typeof sc.structuralChecks === "string" ? JSON.parse(sc.structuralChecks) : sc.structuralChecks);
  }

  process.exit(0);
}

main().catch(console.error);
