import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, growthCampaigns } from "../shared/schema";
import { eq, desc } from "drizzle-orm";
import { buildAudiencePainRegistry, selectPainsForUse } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { runLaneGrouper } from "../server/shared/strategic-lanes-grouper";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const [aud] = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  const [camp] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const anchor = camp?.productAnchor as any;
  const capLines: string[] = [
    `Product/Offering: ${anchor.name} (Type: ${anchor.type})`,
    `Key Attributes: ${anchor.keyAttributes.join("; ")}`,
    `Core Problem: ${anchor.coreProblemSolved}`,
    `Differentiator: ${anchor.differentiatingFeature}`
  ];
  const productCapabilities = capLines.join(" | ");

  const segments = typeof aud.audienceSegments === "string" ? JSON.parse(aud.audienceSegments) : aud.audienceSegments || [];
  const rawPains = typeof aud.audiencePains === "string" ? JSON.parse(aud.audiencePains) : aud.audiencePains || [];

  const deterministic = buildAudiencePainRegistry(rawPains, {
    accountId,
    audienceSnapshotId: aud.id,
  }, segments);

  console.log(`Deterministic registry count: ${deterministic.length}`);

  const refined = await refineAudiencePainRegistry(deterministic, {
    accountId,
    campaignId,
    productCapabilities,
    businessProfile: `Brand: MarketMindAI. Industry: Marketing Technology / AI Strategy SaaS.`,
    audienceSegments: segments,
    llmEnabled: true,
  });

  console.log(`Refined registry count: ${refined.registry.length}`);
  const corePains = selectPainsForUse(refined.registry, "positioning");
  const eligibleObjections = refined.registry.filter(p => p.classification === "OBJECTION" && p.eligible && p.productFit === "ELIGIBLE");
  let positioningPains = [...corePains, ...eligibleObjections];

  console.log(`\nCore pains for positioning count: ${corePains.length}`);
  corePains.forEach(p => console.log(` - Core Pain: [${p.painId}] "${p.canonicalPain || p.canonical}" (fit=${p.productFit}, eligible=${p.eligible})`));

  console.log(`\nEligible objections for positioning count: ${eligibleObjections.length}`);
  eligibleObjections.forEach(p => console.log(` - Objection: [${p.painId}] "${p.canonicalPain || p.canonical}"`));

  console.log(`\nTotal candidate positioning pains: ${positioningPains.length}`);

  refined.registry.forEach((p, i) => {
    console.log(`[#${i+1}] [${p.painId}] "${p.canonicalPain || p.canonical}" -> Fit: ${p.productFit}, Class: ${p.classification}, Eligible: ${p.eligible}`);
  });

  process.exit(0);
}

main().catch(console.error);
