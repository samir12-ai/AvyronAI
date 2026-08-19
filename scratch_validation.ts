import { db } from "./server/db";
import { runAudienceEngine } from "./server/audience-engine/engine";
import { runLaneGrouper } from "./server/shared/lane-grouper";
import { runPositioningEngine } from "./server/positioning-engine/engine";

async function run() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1786718877499_3jk4zv";

  console.log("=== RUNNING FOCUSED VALIDATION ===");

  console.log("1. Running Audience Engine...");
  const audienceResult = await runAudienceEngine(accountId, campaignId, undefined, "test_job_123");
  console.log(`Audience engine status: ${audienceResult.status}`);
  if (audienceResult.status !== "SUCCESS") {
    console.log(audienceResult.statusMessage);
    return;
  }
  const audienceSnapshotId = "dummy_aud_snapshot_for_testing";

  console.log("\n2. Audience Segments Found:");
  audienceResult.audienceSegments.forEach(s => {
    console.log(` - [${s.role}] ${s.name}: ${s.description}`);
  });

  console.log("\n3. Pain Registry & Product Fit Decisions:");
  audienceResult.painMap.forEach(p => {
    console.log(` - ${p.canonical} | Role: ${audienceResult.audienceSegments.find(s => s.id === p.segmentIds[0])?.role || p.segmentIds[0]} | Fit: ${p.productFit} | Eligible: ${p.eligible}`);
  });

  console.log("\n4. Running Lane Grouper...");
  const laneResult = await runLaneGrouper(accountId, campaignId, "dummy_mi_id", audienceSnapshotId, audienceResult);
  console.log(`Lane Grouper status: ${laneResult.status}`);

  console.log("\n5. Running Positioning Engine...");
  const posResult = await runPositioningEngine(accountId, campaignId, "dummy_mi_id", audienceSnapshotId, {}, "job123", undefined, audienceResult.painMap, laneResult.strategicLanes);
  console.log(`Positioning Engine status: ${posResult.status}`);
  if (posResult.status === "SUCCESS") {
    console.log("\nPositioning Portfolio Selected:");
    console.log(JSON.stringify((posResult as any).selectedPainRoles, null, 2));
  } else {
    console.log(posResult.statusMessage);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
