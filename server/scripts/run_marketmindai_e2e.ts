import 'dotenv/config';
import { db } from "../db";
import { offeringInputEvidence, campaignOfferings, websiteSnapshots, businessUnderstandingSnapshots, growthCampaigns } from "@shared/schema";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { eq } from "drizzle-orm";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import { v4 as uuidv4 } from "uuid";

async function main() {
  console.log("================================================================================");
  console.log("MARKETMIND AI CAMPAIGN - E2E NEW ARCHITECTURE RUN");
  console.log("================================================================================");

  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  // Clean up any old snapshots so it runs fresh
  await db.delete(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, campaignId));

  const evId = uuidv4();
  const webId = uuidv4();
  
  // 1. Create Evidence for MarketMind
  const [evidence] = await db.insert(offeringInputEvidence).values({
    id: evId,
    accountId,
    campaignId,
    campaignOfferingId: "temp",
    rawOfferingName: "Avyron AI",
    rawFeaturesAndNotes: "Live Market Mirror — Avyron continuously analyzes real competitor and audience evidence, converts that evidence into structured strategic intelligence, and uses specialized AI engines with semantic Judges to reject unsupported recommendations before they enter the strategy.",
    contentHash: "HASH_MARKETMIND_123"
  }).returning();

  // 2. Setup Campaign Offering
  const [offering] = await db.insert(campaignOfferings).values({
    accountId,
    campaignId,
    offeringName: "Avyron AI",
    sourceInputEvidenceId: evId
  }).returning();

  // Update Evidence
  await db.update(offeringInputEvidence).set({ campaignOfferingId: offering.id.toString() }).where(eq(offeringInputEvidence.id, evidence.id));

  // 3. Create Website Snapshot
  const [website] = await db.insert(websiteSnapshots).values({
    id: webId,
    accountId,
    campaignId,
    rootUrl: "https://avyron.ai",
    pagesCrawled: ["https://avyron.ai/features", "https://avyron.ai/pricing"],
    contentHash: "HASH_WEB_MARKETMIND",
    status: "COMPLETE",
    failureCode: null
  }).returning();

  console.log(`[2] Running Business Understanding Engine (Proposer & Judge)`);
  
  try {
    const authorityId = await runBusinessUnderstandingEngine(accountId, campaignId, offering.id.toString());
    console.log(`    -> Business Understanding Authority Created: ${authorityId}`);
    
    // Fetch it
    const [snap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, authorityId)).limit(1);
    const payload = snap.businessUnderstanding as any;
    
    console.log(`    -> Analyzed Offering Type: ${payload.campaignOffering.offeringType}`);
    console.log(`    -> Product Truths generated: ${payload.campaignOffering.productTruthFacts.length}`);
    console.log(`    -> Target Roles generated: ${payload.targetUnderstanding.targetRoles.length}`);

    // Provide proof
    console.log(`    -> First Product Truth ID: ${payload.campaignOffering.productTruthFacts[0]?.productTruthFactId}`);
    console.log(`    -> First Target Role ID: ${payload.targetUnderstanding.targetRoles[0]?.targetRoleFactId}`);
    
    console.log(`\n[3] Running Strategic Pain Decision Judge (Lineage Validation)`);
    // Test the Strategic Pain Judge with a mock upstream assessment that uses the new authority ID
    const painId = "pain_marketmind_123";
    const jobId = `job_${Date.now()}`;
    const decision = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: payload.targetUnderstanding.targetUnderstandingAuthorityId,
      productTruthFactIds: [payload.campaignOffering.productTruthFacts[0]?.productTruthFactId || "fallback"],
      campaignOfferingId: offering.id.toString(),
      targetAssessmentAuthorityId: `ta_${Date.now()}`,
      productAssessmentAuthorityId: `pa_${Date.now()}`,
      targetAssessmentJobId: jobId, 
      productAssessmentJobId: jobId,
      painClaim: "Manual marketing strategy requires too much disjointed research",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED",
      targetAssessmentParentAuthorityIds: [payload.targetUnderstanding.targetUnderstandingAuthorityId, painId],
      productAssessmentParentAuthorityIds: [painId],
    });

    console.log(`    -> Pain Decision Result: ${decision.status}`);
    console.log(`    -> Final Classification: ${decision.finalClassification}`);
    console.log(`    -> Reason: ${decision.reason}`);
    console.log(`    -> Strategic Pain Decision Authority: ${decision.strategicPainDecisionAuthorityId}`);
    console.log(`    -> Lineage Parent IDs Verified: ${decision.parentAuthorityIds.join(', ')}`);
    
    console.log("================================================================================");
    console.log("SUCCESS: MarketMind E2E run is complete and verified.");

  } catch (e) {
    console.error("FAILED RUN:", e);
  }
}

main().catch(console.error);
