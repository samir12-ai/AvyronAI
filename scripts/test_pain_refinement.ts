import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, productAnchorRecords } from "../shared/schema";
import { eq, desc } from "drizzle-orm";
import { buildAudiencePainRegistry, refineAudiencePainRegistry } from "../server/shared/audience-pain-registry";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const [aud] = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  const [anchor] = await db
    .select()
    .from(productAnchorRecords)
    .where(eq(productAnchorRecords.campaignId, campaignId))
    .orderBy(desc(productAnchorRecords.createdAt))
    .limit(1);

  let productCapabilities: string | null = null;
  if (anchor) {
    const anchorForFit: any = anchor;
    const capLines: string[] = [];
    if (anchorForFit.sourceFacts && Array.isArray(anchorForFit.sourceFacts) && anchorForFit.sourceFacts.length > 0) {
      capLines.push(`Source Facts: ${anchorForFit.sourceFacts.join("; ")}`);
    }
    if (anchorForFit.keyAttributes && Array.isArray(anchorForFit.keyAttributes) && anchorForFit.keyAttributes.length > 0) {
      capLines.push(`Key Attributes: ${anchorForFit.keyAttributes.join("; ")}`);
    }
    if (!anchorForFit.problemSolved && anchorForFit.coreProblemSolved) {
      capLines.push(`Core Problem: ${anchorForFit.coreProblemSolved}`);
    }
    if (!anchorForFit.uniqueMechanism && !anchorForFit.strategicAdvantage && anchorForFit.differentiatingFeature) {
      capLines.push(`Differentiator: ${anchorForFit.differentiatingFeature}`);
    }
    productCapabilities = capLines.join(" | ");
  }

  const businessProfile = "Brand: MarketMindAI. Industry: Marketing Technology / AI Strategy SaaS.";

  console.log("Product Capabilities:", productCapabilities);
  console.log("Business Profile:", businessProfile);

  const segments = typeof aud.audienceSegments === "string" ? JSON.parse(aud.audienceSegments) : aud.audienceSegments || [];
  const rawPains = typeof aud.audiencePains === "string" ? JSON.parse(aud.audiencePains) : aud.audiencePains || [];
  const desires = typeof aud.desires === "string" ? JSON.parse(aud.desires) : aud.desires || [];
  const unresolvedNeeds = typeof aud.unresolvedNeeds === "string" ? JSON.parse(aud.unresolvedNeeds) : aud.unresolvedNeeds || [];

  const deterministic = buildAudiencePainRegistry(rawPains, desires, unresolvedNeeds, {
    campaignId,
    accountId,
    audienceSegments: segments,
  });

  console.log(`Deterministic registry items count: ${deterministic.length}`);

  const refined = await refineAudiencePainRegistry(deterministic, {
    accountId,
    campaignId,
    productCapabilities,
    businessProfile,
    audienceSegments: segments,
    llmEnabled: true,
  });

  console.log(`\nRefined registry count: ${refined.registry.length}`);
  console.log("Classifier used:", refined.classifierUsed);
  console.log("Judge rejections:", refined.judgeRejections);

  refined.registry.forEach((p, i) => {
    console.log(`\n[#${i+1}] ${p.painId}: "${p.canonicalPain}"`);
    console.log(` - Class: ${p.classification} | Eligible: ${p.eligible} | ProductFit: ${p.productFit}`);
    console.log(` - SourceRole: ${p.sourceRole} | AssignedRole: ${p.assignedRole} | Score: ${p.roleAlignmentScore}`);
    console.log(` - IneligibilityReason: ${p.ineligibilityReason}`);
  });

  process.exit(0);
}

main().catch(console.error);
