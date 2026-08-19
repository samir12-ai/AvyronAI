import 'dotenv/config';
import { db } from "../db";
import {
  growthCampaigns,
  businessDataLayer,
  audienceSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { loadProductDNA } from "../shared/product-dna";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import {
  classifyPainRegistryWithLLM,
  judgePainClassifierOutput,
  refineAudiencePainRegistry
} from "../shared/pain-classifier";

async function main() {
  console.log("================================================================================");
  console.log("AVYRON — PRODUCT FIT FORENSIC AUDIT");
  console.log("================================================================================");

  // 1. Check real MarketMind and Validation campaign states
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const [camp] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);
  const [biz] = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId)).limit(1);
  const [snap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  console.log("Campaign State:", {
    id: camp?.id,
    name: camp?.name,
    hasProductAnchor: !!camp?.productAnchor,
    productAnchor: camp?.productAnchor
  });

  console.log("Business Data Layer:", {
    id: biz?.id,
    hasBizData: !!biz,
    targetAudienceSegment: biz?.targetAudienceSegment,
    targetDecisionMaker: biz?.targetDecisionMaker,
    coreOffer: biz?.coreOffer
  });

  console.log("Latest Audience Snapshot:", {
    id: snap?.id,
    engineVersion: snap?.engineVersion,
    createdAt: snap?.createdAt,
    targetCoverage: typeof snap?.targetCoverage === "string" ? JSON.parse(snap?.targetCoverage) : snap?.targetCoverage
  });

  const canonicalSegments = JSON.parse((snap?.audienceSegments as string) || "[]");
  console.log(`Audience Segments (${canonicalSegments.length}):`);
  canonicalSegments.forEach((s: any, idx: number) => {
    console.log(`\n--- Segment ${idx + 1}: "${s.name}" (Role: ${s.role}) ---`);
    console.log(`  Definition: "${s.segmentDefinition?.claim || s.segmentDefinition}"`);
    console.log(`  Role Claim:`, s.roleClaim);
    console.log(`  Role Evidence IDs:`, s.roleEvidenceIds);
    console.log(`  Pains (${s.pains?.length || 0}):`);
    (s.pains || []).forEach((p: any) => {
      console.log(`    - [${p.claimId}] "${p.claim}" (Evidence: ${JSON.stringify(p.evidenceIds)})`);
    });
  });

  console.log("\n================================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
