import "dotenv/config";
import { runOrchestrator } from "../server/orchestrator/index";
import { db } from "../server/db";
import {
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  orchestratorJobs,
  strategicPlans,
  businessDataLayer
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import * as fs from "fs";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("=================================================");
  console.log("STARTING REAL PRODUCTION ORCHESTRATOR EXECUTION");
  console.log(`Account ID: ${accountId}`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("=================================================");

  const startTime = Date.now();
  let result: any = null;
  let runError: any = null;

  try {
    result = await runOrchestrator({
      accountId,
      campaignId,
      forceRefresh: true,
      onProgress: (event) => {
        console.log(`[PROGRESS] Engine ${event.engineIndex}/${event.totalEngines} (${event.engineName}) -> Status: ${event.status} (${event.durationMs}ms)`);
        if (event.blockReason) {
          console.log(`   Block reason: ${event.blockReason}`);
        }
      }
    });
  } catch (err: any) {
    runError = err;
    console.error("ORCHESTRATOR THREW ERROR:", err);
  }

  const durationMs = Date.now() - startTime;
  console.log("\n=================================================");
  console.log(`ORCHESTRATOR FINISHED in ${durationMs}ms`);
  if (result) {
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Completed Engines (${result.completedEngines.length}):`, result.completedEngines.join(", "));
    if (result.failedEngine) console.log(`Failed Engine: ${result.failedEngine}`);
    if (result.blockReason) console.log(`Block Reason: ${result.blockReason}`);
  }
  console.log("=================================================\n");

  const jobId = result?.jobId;
  let jobRow: any = null;
  let miRow: any = null;
  let audRow: any = null;
  let diffRow: any = null;
  let posRow: any = null;
  let bizRow: any = null;

  if (jobId) {
    const [j] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId)).limit(1);
    jobRow = j;
  }

  const [b] = await db.select().from(businessDataLayer).where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId))).limit(1);
  bizRow = b;

  if (jobId) {
    const [m] = await db.select().from(miSnapshots).where(eq(miSnapshots.jobId, jobId)).orderBy(desc(miSnapshots.createdAt)).limit(1);
    miRow = m;
    const [a] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.jobId, jobId)).orderBy(desc(audienceSnapshots.createdAt)).limit(1);
    audRow = a;
    const [d] = await db.select().from(differentiationSnapshots).where(eq(differentiationSnapshots.jobId, jobId)).orderBy(desc(differentiationSnapshots.createdAt)).limit(1);
    diffRow = d;
    const [p] = await db.select().from(positioningSnapshots).where(eq(positioningSnapshots.jobId, jobId)).orderBy(desc(positioningSnapshots.createdAt)).limit(1);
    posRow = p;
  }

  const detailedDump = {
    executionSummary: {
      accountId,
      campaignId,
      jobId,
      durationMs,
      status: result?.status,
      completedEngines: result?.completedEngines,
      failedEngine: result?.failedEngine,
      blockReason: result?.blockReason,
      runError: runError ? (runError.stack || runError.message || String(runError)) : null,
    },
    jobRow,
    bizRow,
    miRow,
    audRow,
    diffRow,
    posRow,
    resultsMap: result?.results ? Array.from(result.results.entries()).map(([k, v]: [any, any]) => ({
      engineId: k,
      status: v.status,
      durationMs: v.durationMs,
      blockReason: v.blockReason,
      outputSummary: v.output ? {
        status: v.output.status,
        snapshotId: v.output.snapshotId,
        confidenceScore: v.output.confidenceScore ?? v.output.overallConfidence,
      } : null,
      outputFull: v.output,
    })) : null,
    ssc: result?.ssc,
  };

  fs.writeFileSync("production_e2e_run_output.json", JSON.stringify(detailedDump, null, 2));
  console.log("Detailed output saved to production_e2e_run_output.json");
  process.exit(result?.status === "COMPLETED" ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal in main:", err);
  process.exit(1);
});
