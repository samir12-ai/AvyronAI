import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots, audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import { buildAudiencePainRegistry, extractCanonicalSegmentPains } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { runLaneGrouper } from "../server/shared/lane-grouper";
import fs from "fs";

async function main() {
  const campaignId = "camp_mtewrp8kkom3";
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";
  const audSnapId = "f645648b-e27a-444c-a303-6e9904d79739"; // Newly created real production audience snapshot
  const jobId = `job_prod_aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 1. Resolve canonical Business Understanding Snapshot
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots)
    .where(eq(businessUnderstandingSnapshots.id, buSnapId))
    .limit(1);

  if (!buSnap) {
    throw new Error(`Business Understanding Snapshot ${buSnapId} not found!`);
  }

  const accountId = buSnap.accountId;
  const buData: any = buSnap.businessUnderstanding || {};
  const productTruthFacts = buData?.campaignOffering?.productTruthFacts || [];
  const campaignOfferingId = buData?.campaignOfferingId || "off_70677f8f-1";

  console.log(`=== RUNNING STRATEGIC QUALIFICATION & LANE FORMATION FOR SARA-FT ===`);
  console.log(`Campaign: ${campaignId} | Account: ${accountId} | Job: ${jobId}`);
  console.log(`Audience Snapshot: ${audSnapId}`);
  console.log(`Resolved BU Snapshot ${buSnapId} with ${productTruthFacts.length} ProductTruthFacts.`);

  // 2. Fetch the persisted real audience snapshot from DB
  const [persistedAudSnap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.id, audSnapId))
    .limit(1);

  if (!persistedAudSnap) {
    throw new Error(`Audience snapshot ${audSnapId} not found in DB!`);
  }

  const rawSegments = typeof persistedAudSnap.audienceSegments === "string"
    ? JSON.parse(persistedAudSnap.audienceSegments)
    : persistedAudSnap.audienceSegments;

  console.log(`\n=== AUDIENCE SEGMENTS & ATOMIC PAINS GENERATED ===`);
  rawSegments.forEach((seg: any, sIdx: number) => {
    console.log(`\nSegment ${sIdx + 1}: "${seg.name}" (${seg.estimatedPercentage}%)`);
    console.log(`  Role: ${seg.role}`);
    console.log(`  Definition: ${seg.segmentDefinition?.claim || seg.description}`);
    console.log(`  Pains (${(seg.pains || []).length}):`);
    (seg.pains || []).forEach((p: any) => {
      console.log(`    [${p.claimId}] "${p.claim}" (Evidence IDs: ${(p.evidenceIds || []).join(", ")})`);
    });
  });

  // 3. Build Neutral Pain Registry from production segments
  console.log(`\n=== BUILDING NEUTRAL PAIN REGISTRY ===`);
  const rawPains = extractCanonicalSegmentPains(rawSegments);
  const neutralRegistry = buildAudiencePainRegistry(
    rawPains,
    { accountId, audienceSnapshotId: audSnapId },
    rawSegments
  );
  console.log(`Neutral Registry items: ${neutralRegistry.length}`);

  // 4. Execute Canonical Strategic Pain Refinement (TA -> PA -> SPD)
  console.log(`\n=== RUNNING STRATEGIC PAIN REFINEMENT (TA -> PA -> SPD) ===`);
  const refinementResult = await refineAudiencePainRegistry(
    neutralRegistry,
    {
      accountId,
      campaignId,
      jobId,
      businessUnderstanding: buData,
      audienceSegments: rawSegments
    }
  );

  const items = refinementResult.registry;

  console.log(`\n=== REFINED PAIN REGISTRY VERDICTS (${items.length}) ===`);
  items.forEach((item: any, idx: number) => {
    console.log(`\nItem ${idx + 1}: [${item.painId}] "${item.canonical}"`);
    console.log(`  Classification: ${item.classification} | ProductFit: ${item.productFit} | Eligible: ${item.eligible}`);
    console.log(`  Allowed Uses: [${(item.allowedUses || []).join(", ")}]`);
    console.log(`  Target Assessment: ${item.strategicReasoning?.targetAssessmentDecision || "N/A"}`);
    console.log(`  Product Assessment: ${item.strategicReasoning?.productAssessmentFitType || "N/A"}`);
    console.log(`  SPD Reason: ${item.strategicReasoning?.spdReason || item.classificationReason || "N/A"}`);
  });

  // 5. Execute Canonical Lane Grouper
  console.log(`\n=== RUNNING REAL LANE GROUPER ===`);
  const lanes = await runLaneGrouper(
    rawSegments,
    items,
    {
      accountId,
      campaignId,
      jobId,
      campaignOfferingId
    }
  );

  console.log(`\n=== APPROVED LANES (${lanes.length}) ===`);
  lanes.forEach((lane, idx) => {
    console.log(`\nLane ${idx + 1}: [${lane.laneId}] "${lane.name}"`);
    console.log(`  Segment: ${lane.segmentName} (${lane.segmentId})`);
    console.log(`  Core Pains: ${(lane.corePainIds || []).join(", ")}`);
    console.log(`  Supporting Pains: ${(lane.supportingPainIds || []).join(", ")}`);
    console.log(`  Targeting Thesis: ${lane.targetingThesis}`);
  });

  const fullReport = {
    jobId,
    executionTimestamp: new Date().toISOString(),
    campaignId,
    accountId,
    buSnapId,
    newAudienceSnapshotId: audSnapId,
    audienceSegments: rawSegments,
    neutralRegistry,
    refinedRegistry: items,
    lanes
  };

  const outPath = fs.existsSync("./scratch") ? "./scratch/sara_ft_real_production_run_result.json" : "./sara_ft_real_production_run_result.json";
  try {
    fs.writeFileSync(outPath, JSON.stringify(fullReport, null, 2), "utf8");
    console.log(`\nFull production run results saved to ${outPath}`);
  } catch (err: any) {
    console.warn(`Could not save report file: ${err.message}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
