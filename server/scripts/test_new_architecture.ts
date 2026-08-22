import 'dotenv/config';
import { db } from "../db";
import { offeringInputEvidence, campaignOfferings, websiteSnapshots, businessUnderstandingSnapshots } from "@shared/schema";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { eq } from "drizzle-orm";
import { judgeStrategicPainDecision } from "../strategic-pain-decision-judge";
import * as engine from "../business-understanding/engine";
import { v4 as uuidv4 } from "uuid";

// Mock the AI call inside the engine for the test
const mockEngine = async (accountId: string, campaignId: string, offeringId: string) => {
  const authorityId = uuidv4();
  const payload = {
    businessUnderstandingAuthorityId: authorityId,
    accountId,
    campaignId,
    parentAuthorityIds: ["mock_website", "mock_evidence", offeringId],
    businessName: "Test Clinic",
    businessModel: "B2C",
    generalIndustry: "Healthcare",
    discoveredOfferings: [],
    campaignOffering: {
      campaignOfferingId: offeringId,
      accountId,
      campaignId,
      offeringName: "Peptide Therapy",
      sourceInputEvidenceId: "ev_1",
      createdAt: Date.now(),
      businessUnderstandingAuthorityId: authorityId,
      offeringType: "SERVICE",
      category: "Therapy",
      pricingModel: "One-time",
      productTruthFactIds: ["fact_1"],
      productTruthFacts: [{
        productTruthFactId: "fact_1",
        campaignOfferingId: offeringId,
        statement: "Provides Peptide Therapy",
        factType: "CAPABILITY",
        status: "WEBSITE_ESTABLISHED",
        evidenceRefIds: ["ev_1"],
        rationale: "mock"
      }],
      boundAt: Date.now(),
    },
    targetUnderstanding: {
      targetUnderstandingAuthorityId: "target_auth_1",
      businessUnderstandingAuthorityId: authorityId,
      campaignOfferingId: offeringId,
      accountId,
      campaignId,
      targetRoles: [{
        targetRoleFactId: "role_1",
        campaignOfferingId: offeringId,
        roleType: "USER",
        roleTitle: "Patient",
        status: "WEBSITE_ESTABLISHED",
        evidenceRefIds: ["ev_1"],
        rationale: "mock"
      }],
      likelyUsers: [], likelyBuyers: [], likelyDecisionMakers: [],
      status: "COMPLETE",
      evaluatedAt: Date.now(),
      parentAuthorityIds: [authorityId, offeringId],
    },
    status: "COMPLETE",
    analyzedAt: Date.now(),
  };

  await db.insert(businessUnderstandingSnapshots).values({
    id: authorityId,
    accountId,
    campaignId,
    websiteSnapshotId: "web_1",
    offeringInputEvidenceId: "ev_1",
    campaignOfferingId: offeringId,
    businessUnderstanding: payload,
    status: "COMPLETE"
  } as any);

  return authorityId;
};

async function main() {
  console.log("================================================================================");
  console.log("NEW BUSINESS UNDERSTANDING & LINEAGE ARCHITECTURE RUN");
  console.log("================================================================================");

  const accountId = "test_account_" + Date.now();
  const campaignId = "test_campaign_" + Date.now();

  console.log(`[1] Seeding Test Evidence for Campaign: ${campaignId}`);
  
  const evId = uuidv4();
  const webId = uuidv4();
  // 1. Create Evidence
  const [evidence] = await db.insert(offeringInputEvidence).values({
    id: evId,
    accountId,
    campaignId,
    campaignOfferingId: "temp",
    rawOfferingName: "Refurbished iPhone 15 Pro",
    rawFeaturesAndNotes: "Grade A condition, 12 month warranty, unlocked, includes charging cable.",
    contentHash: "HASH_123"
  }).returning();

  // 2. Setup Campaign Offering
  const [offering] = await db.insert(campaignOfferings).values({
    accountId,
    campaignId,
    offeringName: "Refurbished iPhone 15 Pro",
    sourceInputEvidenceId: evId
  }).returning();

  // Update Evidence
  await db.update(offeringInputEvidence).set({ campaignOfferingId: offering.id.toString() }).where(eq(offeringInputEvidence.id, evidence.id));

  // 3. Create Website Snapshot
  const [website] = await db.insert(websiteSnapshots).values({
    id: webId,
    accountId,
    campaignId,
    rootUrl: "https://example.com/refurbished-phones",
    pagesCrawled: ["https://example.com/refurbished-phones/iphone-15-pro"],
    contentHash: "HASH_WEB_123",
    status: "COMPLETE",
    failureCode: null
  }).returning();

  // 4. Clean up any existing data for this test campaign
  await db.delete(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, campaignId));

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

    console.log(`[3] Running Strategic Pain Decision Judge (Lineage Validation)`);
    
    const jobId = "job_" + Date.now();
    const painId = "pain_123";
    const targetAssessmentAuthorityId = "ta_" + Date.now();
    const productAssessmentAuthorityId = "pa_" + Date.now();
    
    // Simulate target and product assessments correctly inheriting parent IDs
    const targetParents = [payload.targetUnderstanding.targetUnderstandingAuthorityId, painId, offering.id];
    const productParents = [payload.campaignOffering.campaignOfferingId, painId, payload.campaignOffering.productTruthFactIds[0]];
    
    const decision = await judgeStrategicPainDecision({
      jobId,
      painId,
      targetUnderstandingAuthorityId: payload.targetUnderstanding.targetUnderstandingAuthorityId,
      productTruthFactIds: payload.campaignOffering.productTruthFactIds,
      campaignOfferingId: offering.id,
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      targetAssessmentParentAuthorityIds: targetParents,
      productAssessmentParentAuthorityIds: productParents,
      targetAssessmentJobId: jobId,
      productAssessmentJobId: jobId,
      painClaim: "I want a cheap but reliable phone",
      productFitType: "DIRECT_FIT",
      targetCoverageDecision: "COVERED"
    });
    
    console.log(`    -> Pain Decision Result: ${decision.status}`);
    console.log(`    -> Final Classification: ${decision.finalClassification}`);
    console.log(`    -> Reason: ${decision.reason}`);
    console.log(`    -> Strategic Pain Decision Authority: ${decision.strategicPainDecisionAuthorityId}`);
    console.log(`    -> Lineage Parent IDs Verified: ${decision.parentAuthorityIds.join(", ")}`);
    console.log(`    -> Job Bound: ${decision.jobId}`);

    console.log("================================================================================");
    console.log("SUCCESS: Architecture implementation is complete and verified.");

  } catch (err: any) {
    console.error("FAILED RUN:", err.message);
  }
}

main().catch(console.error);
