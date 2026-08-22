import 'dotenv/config';
import { db } from "../db";
import { 
  campaignOfferings, 
  offeringInputEvidence, 
  businessUnderstandingSnapshots, 
  competitorUnderstandingSnapshots 
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { runDifferentiationEngine } from "../differentiation-engine/engine";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const jobId = "job_test_diff_loop";

  const [offeringRec] = await db.select().from(campaignOfferings)
    .where(eq(campaignOfferings.campaignId, campaignId))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  const [buSnap] = await db.select().from(businessUnderstandingSnapshots)
    .where(eq(businessUnderstandingSnapshots.campaignId, campaignId))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  const buData = buSnap?.businessUnderstanding as any;
  const productTruthFacts = buData?.campaignOffering?.productTruthFacts || [];

  const allCompSnaps = await db.select().from(competitorUnderstandingSnapshots)
    .where(eq(competitorUnderstandingSnapshots.campaignId, campaignId))
    .orderBy(desc(competitorUnderstandingSnapshots.createdAt));

  const latestByCompId = new Map<string, any>();
  for (const cs of allCompSnaps) {
    if (!latestByCompId.has(cs.competitorId) && (cs.competitorUnderstanding as any)?.capabilities?.length > 0) {
      latestByCompId.set(cs.competitorId, cs);
    }
  }

  const compSnaps = Array.from(latestByCompId.values());
  const competitorBaselines = compSnaps.map(cs => {
    const data = cs.competitorUnderstanding as any;
    return {
      competitorId: cs.competitorId,
      competitorName: cs.competitorName,
      websiteUrl: cs.websiteUrl,
      understandingAuthorityId: cs.id,
      capabilities: data?.capabilities || [],
      positioning: data?.positioning || [],
      mechanisms: data?.mechanisms || [],
      offers: data?.offers || [],
      targetRoles: data?.targetRoles || [],
      proof: data?.proof || []
    };
  });

  const corePain = {
    painId: "seg_3_pain_1",
    painStatement: "Scattered and incomplete data causes difficulty in identifying true buying signals and leads to poor targeting.",
    classification: "CORE_PURCHASE" as const
  };

  const result = await runDifferentiationEngine(
    {
      marketIntelligenceId: "mi_prod_acceptance",
      dominanceData: competitorBaselines.map(c => ({
        competitorId: c.competitorId,
        competitorName: c.competitorName,
        canonicalFacts: [
          ...c.capabilities.map((cap: any) => ({ fact: cap.statement, factType: "CAPABILITY", miAuthorityId: cap.competitorCapabilityFactId })),
          ...c.mechanisms.map((m: any) => ({ fact: m.statement, factType: "MECHANISM", miAuthorityId: m.competitorMechanismFactId })),
          ...c.positioning.map((p: any) => ({ fact: p.statement, factType: "POSITIONING", miAuthorityId: p.competitorPositioningFactId }))
        ]
      })),
      competitorBaselines,
      competitors: competitorBaselines
    } as any,
    {
      painRegistry: [corePain]
    } as any,
    {
      brandTruth: "Avyron AI - Continuous Market Mirror with specialized AI semantic Judges",
      productTruth: productTruthFacts
    } as any,
    {
      accountId,
      campaignId,
      jobId
    }
  );

  console.log("\nFinal Differentiation Result:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
