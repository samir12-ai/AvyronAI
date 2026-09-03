import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, businessUnderstandingSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";

async function main() {
  const campaignId = "camp_mtewrp8kkom3";
  const audSnapId = "5921969d-4b59-48e0-9373-a78d708683d8";
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";

  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, audSnapId)).limit(1);
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);

  const buPayload = typeof buSnap?.payload === "string" ? JSON.parse(buSnap.payload) : buSnap?.payload;
  const audienceSegments = typeof audSnap?.audienceSegments === "string" ? JSON.parse(audSnap.audienceSegments) : audSnap?.audienceSegments;

  const out = {
    buSnapshot: {
      id: buSnap?.id,
      campaignId: buSnap?.campaignId,
      companyName: buPayload?.companyName || buPayload?.brandName || buPayload?.businessProfile?.companyName,
      businessProfile: buPayload?.businessProfile,
      coreOffer: buPayload?.coreOffer,
      valuePropositions: buPayload?.valuePropositions,
      targetAudience: buPayload?.targetAudience,
      competitiveAdvantages: buPayload?.competitiveAdvantages,
      brandDna: buPayload?.brandDna,
      productFacts: buPayload?.productFacts || buPayload?.productTruthFacts || buPayload?.facts,
      capabilities: buPayload?.capabilities,
      features: buPayload?.features,
      guarantees: buPayload?.guarantees,
      fullKeys: Object.keys(buPayload || {}),
      rawPayloadSample: buPayload
    },
    audienceSegments: audienceSegments.map((seg: any) => ({
      id: seg.id,
      name: seg.name,
      pains: seg.pains,
      desires: seg.desires,
      objections: seg.objections,
      evidenceIds: seg.evidenceIds
    }))
  };

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/canonical_sara_ft_bu_and_aud.json",
    JSON.stringify(out, null, 2),
    "utf8"
  );

  console.log("BU and Audience data dumped successfully.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
