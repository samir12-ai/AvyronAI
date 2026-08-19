import "dotenv/config";
import { runOrchestrator } from "../server/orchestrator";

async function main() {
  console.log("=== Starting Real Live E2E Orchestrator Run for SFI Peptides ===");
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1786718877499_3jk4zv";

  const result = await runOrchestrator({
    accountId,
    campaignId,
    onProgress: (ev: any) => {
      console.log(`[E2E Progress] ${ev.engineId || ev.phase || "general"}: ${ev.status || ev.type || ""} ${ev.message || ""}`);
    },
  });

  console.log("\n=== E2E Run Complete ===");
  console.log("Job ID:", result.jobId);
  console.log("Status:", result.status);
  console.log("Plan ID:", result.planId);
  console.log("Completed Engines Count:", result.completedEngines?.length);
  console.log("Completed Engines List:", result.completedEngines?.join(", "));
  console.log("Failed Engine:", result.failedEngine);
  console.log("Block Reason:", result.blockReason);
  console.log("Duration (s):", (result.durationMs / 1000).toFixed(1));
}

main().catch((err) => {
  console.error("E2E Fatal Error:", err);
});
