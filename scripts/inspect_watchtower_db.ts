import "dotenv/config";
import { db } from "../server/db";
import { pipelineChangeEvents, ciCompetitors, ciSnapshots, miFetchJobs } from "../shared/schema";
import { desc, count, sql } from "drizzle-orm";

async function main() {
  console.log("=== INSPECTING WATCHTOWER / PIPELINE CHANGE EVENTS ===");

  // Group events by campaign
  const eventsByCamp = await db
    .select({
      campaignId: pipelineChangeEvents.campaignId,
      accountId: pipelineChangeEvents.accountId,
      count: count(pipelineChangeEvents.id),
    })
    .from(pipelineChangeEvents)
    .groupBy(pipelineChangeEvents.campaignId, pipelineChangeEvents.accountId);

  console.log("Pipeline Change Events by Campaign:", eventsByCamp);

  const sampleEvents = await db
    .select()
    .from(pipelineChangeEvents)
    .orderBy(desc(pipelineChangeEvents.createdAt))
    .limit(10);

  console.log(`Latest 10 Events across DB:`, sampleEvents.map(e => ({
    id: e.id,
    campaignId: e.campaignId,
    accountId: e.accountId,
    kind: e.kind,
    status: e.status,
    severity: e.severity,
    createdAt: e.createdAt,
  })));

  // Check Competitors
  const competitors = await db.select().from(ciCompetitors);
  console.log("Total Competitors in DB:", competitors.length);

  // Check CI Snapshots
  const snapshots = await db.select().from(ciSnapshots).limit(10);
  console.log("Total CI Snapshots in DB sample:", snapshots.length);

  // Check MI fetch jobs
  const jobs = await db.select().from(miFetchJobs).orderBy(desc(miFetchJobs.createdAt)).limit(10);
  console.log("Recent MI Fetch Jobs:", jobs.map(j => ({
    id: j.id,
    campaignId: j.campaignId,
    status: j.status,
    createdAt: j.createdAt,
    completedAt: j.completedAt,
    lastError: j.lastError,
  })));

  process.exit(0);
}

main().catch(console.error);
