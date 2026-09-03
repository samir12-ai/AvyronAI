import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, businessUnderstandingSnapshots, marketEvidence } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";
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

  // Collect all unique evidence IDs
  const allEvidenceIds: string[] = [];
  audienceSegments.forEach((seg: any) => {
    (seg.pains || []).forEach((p: any) => {
      if (Array.isArray(p.evidenceIds)) allEvidenceIds.push(...p.evidenceIds);
    });
  });
  const uniqueEvIds = [...new Set(allEvidenceIds)];

  // Fetch all evidence records from DB
  const evidenceRows = uniqueEvIds.length > 0
    ? await db.select().from(marketEvidence).where(inArray(marketEvidence.evidenceUid, uniqueEvIds))
    : [];

  console.log(`Fetched ${evidenceRows.length} market evidence records for ${uniqueEvIds.length} unique UIDs.`);

  // Map pains
  const painList: any[] = [];
  audienceSegments.forEach((seg: any, sIdx: number) => {
    (seg.pains || []).forEach((p: any, pIdx: number) => {
      const citedEvidence = evidenceRows.filter((r: any) => (p.evidenceIds || []).includes(r.evidenceUid));
      painList.push({
        painIndex: painList.length + 1,
        claimId: p.claimId || `seg_${sIdx + 1}_pain_${pIdx + 1}`,
        segmentId: seg.id,
        segmentName: seg.name,
        canonicalPain: p.claim,
        evidenceIds: p.evidenceIds || [],
        citedEvidence: citedEvidence.map((e: any) => ({
          evidenceUid: e.evidenceUid,
          quote: e.quote,
          sourceType: e.sourceType,
          competitorName: e.competitorName,
          sentiment: e.sentiment
        }))
      });
    });
  });

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_forensic_evidence_and_pains.json",
    JSON.stringify({ productTruthFacts, targetRoles, painList }, null, 2),
    "utf8"
  );
  console.log("Forensic evidence and pains written to scratch/sara_ft_forensic_evidence_and_pains.json");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
