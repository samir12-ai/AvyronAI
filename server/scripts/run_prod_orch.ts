import 'dotenv/config';
import { runOrchestrator } from "../orchestrator/index";
import { db } from "../db";
import { audienceSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

async function run() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  
  const jobId = `orch_${Date.now()}_audit`;
  console.log(`FRESH PRODUCTION JOB ID = ${jobId}`);
  
  const res = await runOrchestrator({
    accountId,
    campaignId,
    forceRefresh: true,
    preassignedJobId: jobId
  });

  console.log("\nOrchestrator Status:", res.status);

  // Fetch the latest AudienceSnapshot for this campaign
  const [snap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!snap) {
    console.log("No snapshot found after run.");
    process.exit(1);
  }

  let pains = typeof snap.audiencePains === "string" ? JSON.parse(snap.audiencePains) : snap.audiencePains;
  
  const corePains = pains.filter((p: any) => p.classification === "CORE" || p.classification === "CORE_PURCHASE");
  const directFitPains = pains.filter((p: any) => p.productFit === "DIRECT_FIT" || p.productFit === "ELIGIBLE");
  const strategicFitPains = pains.filter((p: any) => p.productFit === "STRATEGIC_FIT");
  const notFitPains = pains.filter((p: any) => p.productFit === "NOT_FIT");

  console.log(`\nTOTAL CANONICAL PAINS = ${pains.length}`);
  
  console.log(`\nDIRECT_FIT COUNT = ${directFitPains.length}`);
  console.log(`DIRECT_FIT PAINS:`);
  directFitPains.forEach((p: any) => {
    console.log(`- ${p.canonical} (Cov: ${p.coverageDecision} | Core: ${!!p.coreDecisionId})`);
  });

  console.log(`\nSTRATEGIC_FIT COUNT = ${strategicFitPains.length}`);
  console.log(`STRATEGIC_FIT PAINS:`);
  strategicFitPains.forEach((p: any) => {
    console.log(`- ${p.canonical} (Cov: ${p.coverageDecision} | Core: ${!!p.coreDecisionId})`);
  });

  console.log(`\nNOT_FIT COUNT = ${notFitPains.length}`);

  const enteredMateriality = pains.filter((p: any) => p.targetCovered !== false && p.productFit === 'DIRECT_FIT');
  console.log(`\nPAINS ENTERING MATERIALITY = ${enteredMateriality.length}`);
  enteredMateriality.forEach((p: any) => {
    console.log(`- ${p.canonical} (Cov: ${p.coverageDecision})`);
  });

  console.log(`\nCORE_PURCHASE COUNT = ${corePains.length}`);
  console.log(`CORE_PURCHASE PAINS:`);
  corePains.forEach((p: any) => {
    console.log(`- ${p.canonical}`);
  });

  const supportingPains = pains.filter((p: any) => p.classification === "SUPPORTING");
  console.log(`\nSUPPORTING COUNT = ${supportingPains.length}`);

  console.log(`\n\n--- TRACES ---`);

  console.log(`\n[ALL PAINS DUMP FOR TRACE]`);
  pains.forEach((p: any) => {
    console.log(`painId: ${p.painId}`);
    console.log(`canonicalPain: ${p.canonical}`);
    console.log(`coverageDecision: ${p.coverageDecision}`);
    console.log(`fitType: ${p.productFit}`);
    console.log(`enteredMateriality: ${p.targetCovered !== false && p.productFit === 'DIRECT_FIT' ? 'YES' : 'NO'}`);
    console.log(`MaterialityVerdict: ${p.coreDecisionId ? 'EVALUATED' : 'NOT_EVALUATED'}`);
    console.log(`finalClassification: ${p.classification}`);
    console.log('---');
  });

  process.exit(0);
}

run().catch(console.error);
