import 'dotenv/config';
import { db } from "../db";
import { runAudienceEngine } from "../audience-engine/engine";
import { runLaneGrouper } from "../shared/lane-grouper";
import { runPositioningEngine } from "../positioning-engine/engine";

async function run() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";

  console.log("=== RUNNING FOCUSED VALIDATION FOR CLAIM-LEVEL FIDELITY ===");

  console.log("\n1. Running Audience Engine...");
  const audienceResult = await runAudienceEngine(accountId, campaignId, undefined, "dummy_job_id");
  console.log(`\nAudience engine status: ${audienceResult.status}`);
  console.log(`Status message: ${audienceResult.statusMessage || "N/A"}`);
  
  if (audienceResult.status !== "COMPLETE" && audienceResult.status !== "PARTIAL") {
    console.log(`Audience Engine failed with status: ${audienceResult.status}`);
    console.log(`Target Coverage:`, audienceResult.targetCoverage);
    return;
  }
  const audienceSnapshotId = audienceResult.snapshotId || "dummy_aud_snapshot_for_testing";

  console.log(`\n2. Canonical Audience Segments (${audienceResult.audienceSegments.length} found):`);
  audienceResult.audienceSegments.forEach((s: any, idx: number) => {
    console.log(`\n--- Segment #${idx + 1}: ${s.name} ---`);
    console.log(`  Role: [${s.role}] (claimId: ${s.roleClaim?.claimId || 'N/A'}, evidenceIds: ${JSON.stringify(s.roleClaim?.evidenceIds || [])})`);
    console.log(`  Definition: "${s.segmentDefinition?.claim || s.description}" (evidenceIds: ${JSON.stringify(s.segmentDefinition?.evidenceIds || [])})`);
    console.log(`  Pains (${(s.pains || []).length}):`);
    (s.pains || []).forEach((p: any) => {
      console.log(`    - [${p.claimId}] "${p.claim}" -> evidence: ${JSON.stringify(p.evidenceIds)}`);
    });
    console.log(`  Desires (${(s.desires || []).length}):`);
    (s.desires || []).forEach((d: any) => {
      console.log(`    - [${d.claimId}] "${d.claim}" -> evidence: ${JSON.stringify(d.evidenceIds)}`);
    });
    console.log(`  Objections (${(s.objections || []).length}):`);
    (s.objections || []).forEach((o: any) => {
      console.log(`    - [${o.claimId}] "${o.claim}" -> evidence: ${JSON.stringify(o.evidenceIds)}`);
    });
    console.log(`  Motivations (${(s.motivations || []).length}):`);
    (s.motivations || []).forEach((m: any) => {
      console.log(`    - [${m.claimId}] "${m.claim}" -> evidence: ${JSON.stringify(m.evidenceIds)}`);
    });
    console.log(`  Outcomes (${(s.outcomes || []).length}):`);
    (s.outcomes || []).forEach((oc: any) => {
      console.log(`    - [${oc.claimId}] "${oc.claim}" -> evidence: ${JSON.stringify(oc.evidenceIds)}`);
    });
    console.log(`  All Grounding Refs: ${JSON.stringify(s.groundingRefs || [])}`);
  });

  console.log("\n3. Target Coverage Assessment:");
  console.log(`  Status: ${audienceResult.targetCoverage?.status}`);
  console.log(`  Supported Target Roles: ${JSON.stringify(audienceResult.targetCoverage?.supportedTargetRoles)}`);
  console.log(`  Unsupported Target Roles: ${JSON.stringify(audienceResult.targetCoverage?.unsupportedTargetRoles)}`);
  console.log(`  Evidence Gap: ${audienceResult.targetCoverage?.evidenceGap}`);
  console.log(`  Reason: ${audienceResult.targetCoverage?.reason || "None"}`);

  console.log("\n4. Running Lane Grouper...");
  const laneResult = await runLaneGrouper(
    audienceResult.audienceSegments || [],
    audienceResult.painMap || [],
    { accountId, campaignId }
  );
  console.log(`Lane Grouper status: ${laneResult ? "COMPLETE" : "FAILED"}`);

  console.log("\n5. Running Positioning Engine...");
  const posResult = await runPositioningEngine(accountId, campaignId, "dummy_mi_id", audienceSnapshotId, {}, "job123", undefined, audienceResult.painMap, laneResult.strategicLanes);
  console.log(`Positioning Engine status: ${posResult.status}`);
  console.log(`Positioning Message: ${posResult.statusMessage || "N/A"}`);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
