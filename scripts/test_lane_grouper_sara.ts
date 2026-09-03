import "dotenv/config";
import fs from "fs";
import { runLaneGrouper } from "../server/shared/lane-grouper";
import { db } from "../server/db";
import { audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const data = JSON.parse(fs.readFileSync("C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_restoration_trace.json", "utf8"));
  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, "5921969d-4b59-48e0-9373-a78d708683d8")).limit(1);
  const audienceSegments = typeof audSnap.audienceSegments === "string" ? JSON.parse(audSnap.audienceSegments) : audSnap.audienceSegments;

  const mockRegistry = data.traceTable.map((t: any, idx: number) => ({
    painId: `pain_${idx + 1}`,
    canonical: t.canonical,
    classification: t.finalClassification,
    eligible: t.finalEligible,
    productFit: "ELIGIBLE",
    allowedUses: t.finalAllowedUses,
    segmentIds: [audienceSegments[Math.min(idx, audienceSegments.length - 1)]?.id || "seg_1"],
    segmentId: audienceSegments[Math.min(idx, audienceSegments.length - 1)]?.id || "seg_1",
    lineage: { accountId: "acc_test", audienceSnapshotId: "aud_test" }
  }));

  console.log("Mock Registry:", mockRegistry.map((m: any) => ({ id: m.painId, class: m.classification, eligible: m.eligible })));

  const lanes = await runLaneGrouper(audienceSegments, mockRegistry as any, {
    accountId: "acc_test",
    campaignId: "camp_mtewrp8kkom3",
    jobId: "job_test",
  });
  console.log(`Lanes created: ${lanes.length}`);
  lanes.forEach((l, i) => {
    console.log(`[Lane ${i + 1}] ${l.title} (ID: ${l.laneId})`);
    console.log(`  Description: ${l.description}`);
    console.log(`  Primary Pain ID: ${l.primaryPainId}`);
    console.log(`  Core Pain IDs: ${l.corePainIds.join(", ")}`);
    console.log(`  Supporting Pain IDs: ${l.supportingPainIds.join(", ")}`);
    console.log(`  Segments: ${l.segmentIds.join(", ")}`);
    console.log(`  Messaging Direction: ${l.messagingDirection}`);
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
