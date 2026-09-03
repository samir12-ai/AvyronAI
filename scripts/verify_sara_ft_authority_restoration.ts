import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, businessUnderstandingSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import { extractCanonicalSegmentPains, buildAudiencePainRegistry, attachTargetCoverageToPainRegistry } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { runLaneGrouper } from "../server/shared/lane-grouper";
import fs from "fs";

async function main() {
  const campaignId = "camp_mtewrp8kkom3";
  const audienceSnapshotId = "5921969d-4b59-48e0-9373-a78d708683d8";

  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, audienceSnapshotId)).limit(1);
  if (!audSnap) throw new Error("Audience snapshot not found");

  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, campaignId)).limit(1);

  const audienceSegments = typeof audSnap.audienceSegments === "string" ? JSON.parse(audSnap.audienceSegments) : audSnap.audienceSegments;
  const canonicalSegmentPains = extractCanonicalSegmentPains(audienceSegments);

  console.log(`Extracted ${canonicalSegmentPains.length} canonical segment pains from Audience snapshot.`);

  // 1. Initial Neutral Registry Construction
  const neutralRegistry = buildAudiencePainRegistry(
    canonicalSegmentPains,
    { accountId: audSnap.accountId, audienceSnapshotId: audSnap.id },
    audienceSegments
  );

  console.log("\n--- Initial Registry State ---");
  neutralRegistry.forEach((p, idx) => {
    console.log(`[Pain ${idx + 1}] "${p.canonical.slice(0, 60)}..."`);
    console.log(`  Classification: ${p.classification}`);
    console.log(`  ProductFit: ${p.productFit}`);
    console.log(`  Eligible: ${p.eligible}`);
    console.log(`  AllowedUses: [${p.allowedUses.join(", ")}]`);
    console.log(`  ClassifierVersion: ${p.classifierVersion}`);
  });

  // 2. Attach Target Coverage
  const attachedRegistry = attachTargetCoverageToPainRegistry(
    neutralRegistry,
    audSnap.targetCoverage as any || { status: "NOT_EVALUATED" },
    audienceSegments
  );

  // 3. Strategic Assessment Pipeline (Target Assessment -> Product Assessment -> Strategic Pain Decision Judge)
  const productCapabilities = "Sara-ft Modest Fashion: premium quality breathable modest dresses, contemporary tailoring, opaque lightweight fabrics, everyday work and event wear for modern women seeking modesty without compromising elegance.";

  const refined = await refineAudiencePainRegistry(attachedRegistry, {
    accountId: audSnap.accountId,
    campaignId: audSnap.campaignId,
    jobId: audSnap.jobId || "job_sara_ft_restoration_audit",
    businessUnderstanding: buSnap?.payload || null,
    productCapabilities,
    businessProfile: "Sara-ft Modest Fashion Dubai",
    audienceSegments,
    llmEnabled: true,
  });

  console.log(`\n--- Refined Final Pain Registry (${refined.registry.length} pains) ---`);
  const traceTable: any[] = [];

  for (let i = 0; i < refined.registry.length; i++) {
    const p = refined.registry[i];
    const initialP = neutralRegistry.find(np => np.painId === p.painId) || neutralRegistry[i];
    
    traceTable.push({
      painIndex: i + 1,
      canonical: p.canonical,
      initialClassification: initialP.classification,
      initialEligible: initialP.eligible,
      initialAllowedUses: initialP.allowedUses,
      targetCoverageDecision: p.coverageDecision || "COVERED",
      targetAssessmentId: p.targetAssessmentAuthorityId || "ta_*",
      productFitType: p.fitType || "UNKNOWN",
      productAssessmentId: p.productAssessmentAuthorityId || "pa_*",
      finalClassification: p.classification,
      finalEligible: p.eligible,
      finalAllowedUses: p.allowedUses,
      spdAuthorityId: p.strategicPainDecisionAuthorityId || "spd_*",
      spdReason: p.classificationReason,
    });

    console.log(`\n[Pain ${i + 1}] "${p.canonical}"`);
    console.log(`  Initial: class=${initialP.classification}, fit=${initialP.productFit}, eligible=${initialP.eligible}, allowedUses=[${initialP.allowedUses.join(", ")}]`);
    console.log(`  Target Assessment: decision=${p.coverageDecision}, id=${p.targetAssessmentAuthorityId}`);
    console.log(`  Product Assessment: fitType=${p.fitType}, fit=${p.productFit}, id=${p.productAssessmentAuthorityId}`);
    console.log(`  Strategic Pain Judge: finalClassification=${p.classification}, spdId=${p.strategicPainDecisionAuthorityId}`);
    console.log(`  Final Permissions: allowedUses=[${p.allowedUses.join(", ")}]`);
    console.log(`  Judge Reason: ${p.classificationReason}`);
  }

  // 4. Run Lane Grouper on Qualified Pains
  const approvedLanes = await runLaneGrouper(refined.registry, audienceSegments);
  console.log(`\n--- Strategic Lane Formation (${approvedLanes.length} lanes) ---`);
  approvedLanes.forEach((lane, lIdx) => {
    console.log(`\n[Lane ${lIdx + 1}] ${lane.name} (Code: ${lane.laneCode})`);
    console.log(`  Audience Segment: ${lane.targetSegmentName} (${lane.targetSegmentId})`);
    console.log(`  Core Pains:`);
    lane.corePains.forEach(cp => console.log(`    * [${cp.painId}] ${cp.canonical}`));
    if (lane.supportingPains && lane.supportingPains.length > 0) {
      console.log(`  Supporting Pains:`);
      lane.supportingPains.forEach(sp => console.log(`    * [${sp.painId}] ${sp.canonical}`));
    }
  });

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_restoration_trace.json",
    JSON.stringify({ traceTable, approvedLanes }, null, 2),
    "utf8"
  );
  console.log("\nSaved restoration trace to scratch/sara_ft_restoration_trace.json");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
