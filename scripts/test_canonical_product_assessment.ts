import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots, audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import { runTargetAssessmentForPain } from "../server/strategic-reasoning/target-assessment";
import { runProductAssessmentForPain } from "../server/strategic-reasoning/product-assessment";
import { judgeStrategicPainDecision } from "../server/strategic-pain-decision-judge";
import fs from "fs";

async function main() {
  const audSnapId = "5921969d-4b59-48e0-9373-a78d708683d8";
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";

  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, audSnapId)).limit(1);
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);

  const buData: any = buSnap?.businessUnderstanding || {};
  const productTruthFacts = buData?.campaignOffering?.productTruthFacts || [];
  const targetRoles = buData?.targetUnderstanding?.targetRoles || [];
  const audienceSegments = typeof audSnap.audienceSegments === "string" ? JSON.parse(audSnap.audienceSegments) : audSnap.audienceSegments;

  console.log(`Using ${productTruthFacts.length} canonical ProductTruthFacts from BU snapshot.`);

  const results: any[] = [];
  let pIdx = 0;

  for (const seg of audienceSegments) {
    for (const pain of seg.pains || []) {
      pIdx++;
      const painId = pain.claimId || `seg_${pIdx}_pain`;
      const canonicalPain = pain.claim;
      const citationCount = (pain.evidenceIds || []).length;

      console.log(`\nEvaluating Pain ${pIdx}: "${canonicalPain}"`);

      // 1. Target Assessment with Canonical Target Roles
      const ta = await runTargetAssessmentForPain({
        painId,
        segmentId: seg.id,
        canonicalPain,
        segmentContext: { name: seg.name, role: seg.role, segmentDefinition: seg.definition },
        targetUnderstandingAuthorityId: buData?.targetUnderstanding?.targetUnderstandingAuthorityId || "tu_sara_ft",
        canonicalTargetRoles: targetRoles,
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId,
        jobId: `job_canonical_audit_${Date.now()}`
      });

      // 2. Product Assessment with Canonical Product Truth Facts
      const pa = await runProductAssessmentForPain({
        painId,
        canonicalPain,
        campaignOfferingId: buData?.campaignOfferingId || "off_70677f8f-1",
        businessUnderstandingAuthorityId: buSnapId,
        productTruthFacts,
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId,
        jobId: `job_canonical_audit_${Date.now()}`
      });

      // 3. Strategic Pain Decision Judge
      const spd = await judgeStrategicPainDecision({
        jobId: `job_canonical_audit_${Date.now()}`,
        painId,
        targetUnderstandingAuthorityId: buData?.targetUnderstanding?.targetUnderstandingAuthorityId || "tu_sara_ft",
        productTruthFactIds: productTruthFacts.map((f: any) => f.productTruthFactId),
        campaignOfferingId: buData?.campaignOfferingId || "off_70677f8f-1",
        targetAssessmentAuthorityId: ta.targetAssessmentAuthorityId,
        productAssessmentAuthorityId: pa.productAssessmentAuthorityId,
        targetAssessmentParentAuthorityIds: ta.parentAuthorityIds,
        productAssessmentParentAuthorityIds: pa.parentAuthorityIds,
        targetAssessmentJobId: ta.jobId,
        productAssessmentJobId: pa.jobId,
        painClaim: canonicalPain,
        productFitType: pa.fitType,
        targetCoverageDecision: ta.decision,
        materialityContext: {
          citationCount,
          evidenceUids: pain.evidenceIds || [],
          sourceTypes: ["review", "google_serp", "reddit"]
        },
        accountId: audSnap.accountId,
        campaignId: audSnap.campaignId
      });

      console.log(`  Target Assessment: decision=${ta.decision} | reason=${ta.reason}`);
      console.log(`  Product Assessment: fitType=${pa.fitType} | reason=${pa.reason}`);
      console.log(`  SPD Judge: finalClassification=${spd.finalClassification} | reason=${spd.reason}`);

      results.push({
        painIndex: pIdx,
        painId,
        segmentId: seg.id,
        segmentName: seg.name,
        canonicalPain,
        citationCount,
        evidenceIds: pain.evidenceIds,
        targetAssessment: {
          decision: ta.decision,
          reason: ta.reason,
          authorityId: ta.targetAssessmentAuthorityId
        },
        productAssessment: {
          fitType: pa.fitType,
          reason: pa.reason,
          authorityId: pa.productAssessmentAuthorityId
        },
        spdDecision: {
          finalClassification: spd.finalClassification,
          reason: spd.reason,
          authorityId: spd.strategicPainDecisionAuthorityId
        }
      });
    }
  }

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/canonical_sara_ft_assessment_results.json",
    JSON.stringify(results, null, 2),
    "utf8"
  );
  console.log("\nCanonical assessment results saved to scratch/canonical_sara_ft_assessment_results.json");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
