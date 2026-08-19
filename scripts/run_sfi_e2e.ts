import "dotenv/config";
import { runOrchestrator } from "../server/orchestrator";
import { Pool } from "pg";
import * as fs from "fs";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  
  let accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  try {
    const bdl = await client.query("SELECT account_id FROM business_data_layer WHERE campaign_id = $1 LIMIT 1", [campaignId]);
    if (bdl.rows.length > 0 && bdl.rows[0].account_id) {
      accountId = bdl.rows[0].account_id;
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`[E2E] Starting fresh strategic run for campaign ${campaignId} (account ${accountId})...`);
  const t0 = Date.now();

  try {
    const result = await runOrchestrator({
      campaignId,
      accountId,
      forceRefresh: true,
    });

    console.log(`[E2E] Run finished in ${(Date.now() - t0) / 1000}s`);
    console.log("[E2E] Status:", result.status);
    console.log("[E2E] Job ID:", result.jobId);
    console.log("[E2E] System Verdict:", result.systemVerdict);
    console.log("[E2E] Execution Mode:", result.recommendedExecutionMode);

    if (result.plan) {
      console.log("\n=== SYNTHESIZED STRATEGY PLAN ===");
      console.log("Strategic Summary:", JSON.stringify(result.plan.strategicSummary, null, 2));
      console.log("Monthly Objective:", JSON.stringify(result.plan.monthlyObjective, null, 2));
      console.log("Content Distribution Rationale:", result.plan.contentDistribution?.rationale);
      console.log("Content Pillars:", JSON.stringify(result.plan.contentDistribution?.contentPillars, null, 2));
      console.log("Risk Triggers count:", result.plan.riskTriggers?.triggers?.length);

      fs.writeFileSync("scripts/sfi_new_plan.json", JSON.stringify(result.plan, null, 2));
      console.log("[E2E] Saved new plan to scripts/sfi_new_plan.json");
    }

    if (result.activeStrategyRoot) {
      console.log("\n=== ACTIVE STRATEGY ROOT ===");
      console.log("Brand Spine:", JSON.stringify(result.activeStrategyRoot.brandSpine, null, 2));
      console.log("Approved Lanes count:", (result.activeStrategyRoot.approvedLanes || []).length);
      fs.writeFileSync("scripts/sfi_new_root.json", JSON.stringify(result.activeStrategyRoot, null, 2));
    }

  } catch (err: any) {
    console.error("[E2E] Run failed:", err);
  }
}

main().catch(console.error);
