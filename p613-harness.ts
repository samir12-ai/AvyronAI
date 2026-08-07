import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runOrchestrator } from "./server/orchestrator";
import { runWatchtowerOrchestrator } from "./server/watchtower/orchestrator";
import { iterationGateInputs, manualCampaignMetrics, retentionGateInputs, manualRetentionMetrics } from "./shared/schema";
import { eq } from "drizzle-orm";

// Use MarketMindAI campaign now that data is migrated
const CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";
const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673"; 

async function main() {
  console.log("=".repeat(80));
  console.log(`Starting P-6.13 Validation Harness (VALIDATION_ONLY)`);
  console.log(`Target: Account ${ACCOUNT_ID} | Campaign ${CAMPAIGN_ID}`);
  console.log("=".repeat(80));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // 1. Snapshot existing production metrics to prevent destructive overwrites
  console.log("\n1. Snapshotting existing production data...");
  const originalIterationGate = await db.select().from(iterationGateInputs).where(eq(iterationGateInputs.campaignId, CAMPAIGN_ID));
  const originalManualCampaign = await db.select().from(manualCampaignMetrics).where(eq(manualCampaignMetrics.campaignId, CAMPAIGN_ID));
  const originalRetentionGate = await db.select().from(retentionGateInputs).where(eq(retentionGateInputs.campaignId, CAMPAIGN_ID));
  const originalManualRetention = await db.select().from(manualRetentionMetrics).where(eq(manualRetentionMetrics.campaignId, CAMPAIGN_ID));

  console.log(`   Snapshotted: IterationGate (${originalIterationGate.length}), ManualCampaign (${originalManualCampaign.length}), RetentionGate (${originalRetentionGate.length}), ManualRetention (${originalManualRetention.length})`);

  try {
    // 2. Clear out any gating rows blocking the test
    console.log("\n2. Clearing old validation rows...");
    await db.delete(iterationGateInputs).where(eq(iterationGateInputs.campaignId, CAMPAIGN_ID));
    await db.delete(manualCampaignMetrics).where(eq(manualCampaignMetrics.campaignId, CAMPAIGN_ID));
    await db.delete(retentionGateInputs).where(eq(retentionGateInputs.campaignId, CAMPAIGN_ID));
    await db.delete(manualRetentionMetrics).where(eq(manualRetentionMetrics.campaignId, CAMPAIGN_ID));

    // 3. Insert specific VALIDATION_ONLY inputs to unblock the iteration & retention engines
    console.log("\n3. Injecting VALIDATION_ONLY test data...");
    
    // Iteration Gate Input
    await db.insert(iterationGateInputs).values({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      primaryKpi: "roas",
      dataWindowDays: 14,
      status: "PENDING"
    });

    // Manual Campaign Metrics (Simulated Spend/Conversions for iteration)
    await db.insert(manualCampaignMetrics).values({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      spend: 2100,
      revenue: 5000,
      leads: 100,
      conversions: 200,
      impressions: 1000,
      clicks: 500
    });

    // Retention Gate Input
    await db.insert(retentionGateInputs).values({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      retentionGoal: "increase_ltv",
      businessModel: "subscription",
      reachableAudience: "existing_subscribers",
    });

    // Manual Retention Metrics (Simulated churn for retention)
    await db.insert(manualRetentionMetrics).values({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      totalCustomers: 1000,
      totalPurchases: 1500,
      returningCustomers: 300,
      averageOrderValue: 50,
      refundCount: 10
    });

    console.log("   Validation data injected successfully.");

    // 4. Run the Orchestrator Pipeline (15 engines)
    console.log("\n4. Starting Pipeline Orchestrator...");
    const result = await runOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      forceRefresh: true,
      onProgress: (event) => {
        console.log(`  [Orchestrator] ${event.engineId || "system"} — ${event.message || ""}`);
      },
    });

    console.log("================================================================================");
    console.log(`PIPELINE RESULT: ${result.status} (Duration: ${result.durationMs}ms)`);
    console.log("================================================================================\n");

    if (result.results && typeof result.results === 'object') {
      const resultsObj = result.results instanceof Map ? Object.fromEntries(result.results) : result.results;
      for (const [engineId, status] of Object.entries(resultsObj)) {
        console.log(`- ${engineId.padEnd(25)}: ${status}`);
      }
    }

    // 5. Run Watchtower Validation
    console.log("\n5. Starting Watchtower Validation...");
    await runWatchtowerOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      competitorId: "1ede2a4f-7d70-4a29-8599-0d14dbeab346",
      acquisitionId: "VALIDATION_ONLY",
      runId: "VALIDATION_ONLY",
      useCache: false
    });
    console.log("   Watchtower Validation Complete.");

    if (result.overallStatus === "COMPLETED" || result.overallStatus === "SUCCESS") {
       console.log("\nFULL INTELLIGENCE PIPELINE VERIFIED.");
    } else {
       console.log("\nPIPELINE VALIDATION INCOMPLETE");
    }

  } finally {
    // 6. Restore Data
    console.log("\n6. Cleaning up validation records & Restoring backups...");
    
    // Delete the validation ones
    await db.delete(iterationGateInputs).where(eq(iterationGateInputs.campaignId, CAMPAIGN_ID));
    await db.delete(manualCampaignMetrics).where(eq(manualCampaignMetrics.campaignId, CAMPAIGN_ID));
    await db.delete(retentionGateInputs).where(eq(retentionGateInputs.campaignId, CAMPAIGN_ID));
    await db.delete(manualRetentionMetrics).where(eq(manualRetentionMetrics.campaignId, CAMPAIGN_ID));
    console.log("   Deleted temporary validation rows.");

    // Re-insert originals (omitting the generated 'id' column)
    if (originalIterationGate.length > 0) {
      await db.insert(iterationGateInputs).values(originalIterationGate.map(({ id, ...rest }) => rest));
    }
    if (originalManualCampaign.length > 0) {
      await db.insert(manualCampaignMetrics).values(originalManualCampaign.map(({ id, ...rest }) => rest));
    }
    if (originalRetentionGate.length > 0) {
      await db.insert(retentionGateInputs).values(originalRetentionGate.map(({ id, ...rest }) => rest));
    }
    if (originalManualRetention.length > 0) {
      await db.insert(manualRetentionMetrics).values(originalManualRetention.map(({ id, ...rest }) => rest));
    }

    console.log("   Restored original production data. Verification complete.");
    await pool.end();
  }
}

main().catch(console.error);
