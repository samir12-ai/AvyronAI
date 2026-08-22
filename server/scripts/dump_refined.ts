import 'dotenv/config';
import { db } from "../db";
import { audienceSnapshots, growthCampaigns } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { buildAudiencePainRegistry, extractCanonicalSegmentPains, attachTargetCoverageToPainRegistry } from "../shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../shared/pain-classifier";
import { loadProductDNA } from "../shared/product-dna";

async function run() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  const accountId = 'a2d87878-a1e9-41ea-a8a5-90beff569673';
  
  const [audSnap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!audSnap) {
    console.log("No audience snapshot found.");
    process.exit(1);
  }

  const productDna = await loadProductDNA(campaignId, accountId);
  const [campaign] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);
  
  const businessProfile = JSON.stringify({
    industry: productDna?.businessType || productDna?.productCategory || campaign?.name || 'General',
    coreOffer: productDna?.coreOffer || campaign?.name || 'Products/Services',
    targetAudience: productDna?.targetDecisionMaker || productDna?.targetAudienceSegment || 'Market audience',
    strategicAdvantage: productDna?.strategicAdvantage,
    uniqueMechanism: productDna?.uniqueMechanism,
    pricingModel: productDna?.pricingModel,
  });

  const pains = typeof audSnap.audiencePains === 'string' ? JSON.parse(audSnap.audiencePains) : audSnap.audiencePains;
  const segments = typeof audSnap.audienceSegments === 'string' ? JSON.parse(audSnap.audienceSegments) : audSnap.audienceSegments;
  const targetCoverage = typeof audSnap.targetCoverage === 'string' ? JSON.parse(audSnap.targetCoverage) : audSnap.targetCoverage;

  const rawRegistry = buildAudiencePainRegistry(extractCanonicalSegmentPains(segments), {
    includeDirectAudiencePains: pains,
  });

  const attachedRegistry = attachTargetCoverageToPainRegistry(
    rawRegistry,
    targetCoverage,
    audSnap.id,
    segments
  );

  const refined = await refineAudiencePainRegistry(attachedRegistry, {
    accountId,
    campaignId,
    businessProfile,
    audienceSegments: segments,
    llmEnabled: true
  });

  const registry = refined.registry;
  console.log(`\nTOTAL CANONICAL PAINS = ${registry.length}`);

  const directFitPains = registry.filter(p => p.productFit === "DIRECT_FIT");
  const strategicFitPains = registry.filter(p => p.productFit === "STRATEGIC_FIT");
  const notFitPains = registry.filter(p => p.productFit === "NOT_FIT");
  const unknownFitPains = registry.filter(p => p.productFit === "UNKNOWN" || !p.productFit);

  console.log(`\nDIRECT_FIT COUNT = ${directFitPains.length}`);
  console.log(`DIRECT_FIT PAINS:`);
  directFitPains.forEach(p => console.log(`- ${p.canonical} (ID: ${p.painId})`));

  console.log(`\nSTRATEGIC_FIT COUNT = ${strategicFitPains.length}`);
  console.log(`STRATEGIC_FIT PAINS:`);
  strategicFitPains.forEach(p => console.log(`- ${p.canonical} (ID: ${p.painId})`));

  console.log(`\nNOT_FIT COUNT = ${notFitPains.length}`);
  console.log(`NOT_FIT PAINS:`);
  notFitPains.forEach(p => console.log(`- ${p.canonical} (ID: ${p.painId})`));

  const enteredMateriality = registry.filter(p => p.coverageDecision !== "NOT_COVERED" && p.productFit === "DIRECT_FIT");
  console.log(`\nPAINS ENTERING MATERIALITY = ${enteredMateriality.length}`);
  enteredMateriality.forEach(p => console.log(`- ${p.canonical} (ID: ${p.painId} | Decision: ${p.coverageDecision})`));

  const corePurchasePains = registry.filter(p => p.classification === "CORE_PURCHASE");
  console.log(`\nCORE_PURCHASE COUNT = ${corePurchasePains.length}`);
  console.log(`CORE_PURCHASE PAINS:`);
  corePurchasePains.forEach(p => console.log(`- ${p.canonical} (ID: ${p.painId})`));

  const supportingPains = registry.filter(p => p.classification === "SUPPORTING");
  console.log(`\nSUPPORTING COUNT = ${supportingPains.length}`);

  console.log(`\n--- ALL PAINS DUMP ---`);
  registry.forEach(p => {
    console.log(`painId: ${p.painId}`);
    console.log(`canonicalPain: ${p.canonical}`);
    console.log(`coverageDecision: ${p.coverageDecision || 'NOT_COVERED'}`);
    console.log(`fitType: ${p.productFit || 'UNKNOWN'}`);
    console.log(`enteredMateriality: ${p.coverageDecision !== 'NOT_COVERED' && p.productFit === 'DIRECT_FIT' ? 'YES' : 'NO'}`);
    console.log(`MaterialityVerdict: ${p.coreDecisionId ? 'EVALUATED' : 'NOT_EVALUATED'}`);
    console.log(`finalClassification: ${p.classification || 'SUPPORTING'}`);
    console.log('---');
  });

  process.exit(0);
}

run().catch(console.error);
