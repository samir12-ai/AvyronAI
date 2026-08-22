import 'dotenv/config';
import { db } from "../db";
import { 
  offeringInputEvidence, 
  campaignOfferings, 
  websiteSnapshots, 
  businessUnderstandingSnapshots, 
  audienceSnapshots, 
  strategicPainDecisions,
  targetAssessments,
  productAssessments
} from "@shared/schema";
import { runWebsiteCrawler } from "../business-understanding/crawler";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { runOrchestrator } from "../orchestrator/index";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { extractCanonicalSegmentPains } from "../shared/audience-pain-registry";

async function main() {
  console.log("================================================================================");
  console.log("MARKETMIND AI CAMPAIGN - REAL ORCHESTRATOR FRESH RUN");
  console.log("================================================================================");

  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi"; // MarketMind AI

  // Clean old snapshots for this run
  await db.delete(audienceSnapshots).where(eq(audienceSnapshots.campaignId, campaignId));
  await db.delete(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, campaignId));
  await db.delete(websiteSnapshots).where(eq(websiteSnapshots.campaignId, campaignId));
  await db.delete(campaignOfferings).where(eq(campaignOfferings.campaignId, campaignId));
  await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.campaignId, campaignId));
  await db.delete(strategicPainDecisions).where(eq(strategicPainDecisions.campaignId, campaignId));
  await db.delete(targetAssessments).where(eq(targetAssessments.campaignId, campaignId));
  await db.delete(productAssessments).where(eq(productAssessments.campaignId, campaignId));

  console.log(`[1] Seeding MarketMind through NEW SETUP ONLY`);
  const evId = uuidv4();
  const webId = uuidv4();
  
  await db.insert(offeringInputEvidence).values({
    id: evId,
    accountId,
    campaignId,
    campaignOfferingId: "temp",
    rawOfferingName: "Avyron AI",
    rawFeaturesAndNotes: "Live Market Mirror — Avyron continuously analyzes real competitor and audience evidence, converts that evidence into structured strategic intelligence, and uses specialized AI engines with semantic Judges to reject unsupported recommendations before they enter the strategy.",
    contentHash: "HASH_MARKETMIND_REAL"
  });

  const [offering] = await db.insert(campaignOfferings).values({
    accountId,
    campaignId,
    offeringName: "Avyron AI",
    sourceInputEvidenceId: evId
  }).returning();

  await db.update(offeringInputEvidence).set({ campaignOfferingId: offering.id.toString() }).where(eq(offeringInputEvidence.id, evId));

  await db.insert(websiteSnapshots).values({
    id: webId,
    accountId,
    campaignId,
    rootUrl: "https://avyron.ai",
    pagesCrawled: [],
    contentHash: "PENDING",
    status: "PENDING",
    failureCode: null
  });

  console.log(`[2] Executing REAL Website Ingestion Runtime`);
  const pagesCrawled = await runWebsiteCrawler(webId, "https://avyron.ai");
  console.log(`    -> Crawled ${pagesCrawled.length} pages. First evidenceId: ${pagesCrawled[0].businessEvidenceId}`);

  console.log(`[3] Running Business Understanding Engine (Proposer & Judge)`);
  const authorityId = await runBusinessUnderstandingEngine(accountId, campaignId, offering.id.toString());
  console.log(`    -> Business Understanding Authority Created: ${authorityId}`);

  console.log(`[4] Invoking the ACTUAL Avyron Orchestrator Path`);
  const orchResult = await runOrchestrator({
    accountId,
    campaignId,
    forceRefresh: true
  });
  const jobId = orchResult.jobId;
  console.log(`    -> Orchestrator Job ID: ${jobId}`);
  
  console.log(`\n[5] Fetching Lineage & Count Verification...`);
  
  // 1. Audience Pains
  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.campaignId, campaignId)).orderBy(desc(audienceSnapshots.createdAt)).limit(1);
  if (!audSnap) throw new Error("No audience snapshot found!");
  console.log(`    -> Audience Snapshot ID: ${audSnap.id}`);
  
  let audienceSegments = audSnap.audienceSegments as any;
  if (typeof audienceSegments === 'string') {
    try { audienceSegments = JSON.parse(audienceSegments); } catch(e) {}
  }
  const canonicalPains = extractCanonicalSegmentPains(audienceSegments || []);
  const canonicalPainCount = canonicalPains.length;
  console.log(`    -> Canonical Audience Pains: ${canonicalPainCount}`);

  // 2. Target Assessments for this job
  const jobTargetAssessments = await db.select().from(targetAssessments).where(eq(targetAssessments.jobId, jobId));
  const targetAssessmentCount = jobTargetAssessments.length;
  console.log(`    -> Final Target Assessments: ${targetAssessmentCount}`);

  // 3. Product Assessments for this job
  const jobProductAssessments = await db.select().from(productAssessments).where(eq(productAssessments.jobId, jobId));
  const productAssessmentCount = jobProductAssessments.length;
  console.log(`    -> Final Product Assessments: ${productAssessmentCount}`);

  // 4. Strategic Pain Decisions for this job
  const jobDecisions = await db.select().from(strategicPainDecisions).where(eq(strategicPainDecisions.jobId, jobId));
  const decisionCount = jobDecisions.length;
  console.log(`    -> Final Strategic Pain Decisions: ${decisionCount}`);

  const isOneToOne = (
    canonicalPainCount === targetAssessmentCount &&
    targetAssessmentCount === productAssessmentCount &&
    productAssessmentCount === decisionCount
  );

  let directFitCount = 0;
  let strategicFitCount = 0;
  let notFitCount = 0;
  let unknownFitCount = 0;

  for (const pa of jobProductAssessments) {
    if (pa.fitType === "DIRECT_FIT") directFitCount++;
    else if (pa.fitType === "STRATEGIC_FIT") strategicFitCount++;
    else if (pa.fitType === "NOT_FIT") notFitCount++;
    else unknownFitCount++;
  }

  let coreCount = 0;
  let supportingCount = 0;
  let excludeCount = 0;
  let incompleteCount = 0;

  for (const d of jobDecisions) {
    if (d.status === "INCOMPLETE") {
      incompleteCount++;
    } else if (d.finalClassification === "CORE_PURCHASE") {
      coreCount++;
    } else if (d.finalClassification === "SUPPORTING") {
      supportingCount++;
    } else if (d.finalClassification === "EXCLUDE" || d.finalClassification === "DROPPED") {
      excludeCount++;
    }
  }

  console.log(`\n============================================================`);
  console.log(`ALL CANONICAL PAINS ASSESSMENT BREAKDOWN`);
  console.log(`============================================================`);
  for (const cp of canonicalPains) {
    const ta = jobTargetAssessments.find(t => t.painId === cp.painId);
    const pa = jobProductAssessments.find(p => p.painId === cp.painId);
    const spd = jobDecisions.find(d => d.painId === cp.painId);
    const paPayload = pa?.payload as any;
    const spdPayload = spd?.payload as any;

    console.log(`\nPain: [${cp.painId}] "${cp.canonical}"`);
    console.log(`  Segment: "${cp.segmentName || 'N/A'}"`);
    console.log(`  Evidence UIDs (${cp.evidenceUids?.length || 0}): [${cp.evidenceUids?.map(e => `'${e}'`).join(', ')}]`);
    console.log(`  Factual Counts: citationCount=${cp.citationCount}, uniqueEvidenceCount=${cp.uniqueEvidenceCount}, uniqueSourceCount=${cp.uniqueSourceCount}, uniqueCompetitorCount=${cp.uniqueCompetitorCount}, occurrenceCount=${cp.occurrenceCount}`);
    console.log(`  Source Types: [${cp.sourceTypes?.map(s => `'${s}'`).join(', ')}]`);
    console.log(`  Target Assessment: decision=${ta?.decision} (ID: ${ta?.id})`);
    console.log(`  Product Assessment: fitType=${pa?.fitType} (ID: ${pa?.id}) | Rationale: ${paPayload?.reason}`);
    console.log(`  Product Truth Facts Cited: ${paPayload?.productTruthFactIds?.join(', ')}`);
    console.log(`  Strategic Pain Decision: decision=${spd?.finalClassification} (ID: ${spd?.id}) | Reason: ${spd?.reason}`);
  }

  // 5. Lineage Trace for One Real Pain
  const firstDecision = jobDecisions[0];
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, campaignId)).orderBy(desc(businessUnderstandingSnapshots.createdAt)).limit(1);
  const [wSnap] = await db.select().from(websiteSnapshots).where(eq(websiteSnapshots.campaignId, campaignId)).orderBy(desc(websiteSnapshots.createdAt)).limit(1);

  console.log(`\n============================================================`);
  console.log(`ONE COMPLETE PRODUCTION LINEAGE TRACE`);
  console.log(`============================================================`);
  if (firstDecision) {
    const payload = firstDecision.payload as any;
    console.log(`strategicPainDecisionId: ${firstDecision.id}`);
    console.log(`  -> painId: ${firstDecision.painId}`);
    console.log(`  -> finalClassification: ${firstDecision.finalClassification}`);
    console.log(`  -> status: ${firstDecision.status}`);
    console.log(`  -> reason: ${firstDecision.reason}`);
    console.log(`  -> targetAssessmentAuthorityId: ${firstDecision.targetAssessmentAuthorityId}`);
    console.log(`  -> productAssessmentAuthorityId: ${firstDecision.productAssessmentAuthorityId}`);
    console.log(`  -> targetUnderstandingAuthorityId: ${payload.targetUnderstandingAuthorityId}`);
    console.log(`  -> businessUnderstandingAuthorityId: ${buSnap?.id}`);
    console.log(`  -> campaignOfferingId: ${offering.id}`);
    console.log(`  -> offeringInputEvidenceId: ${evId}`);
    console.log(`  -> websiteSnapshotId: ${wSnap?.id}`);
    console.log(`  -> productTruthFactIds: ${payload.productTruthFactIds?.join(', ')}`);
    console.log(`  -> jobId: ${jobId}`);
  }

  console.log(`\n============================================================`);
  console.log(`FINAL REPORT METRICS`);
  console.log(`============================================================`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Audience Snapshot ID: ${audSnap.id}`);
  console.log(`Business Understanding Authority ID: ${authorityId}`);
  console.log(`Campaign Offering ID: ${offering.id}`);
  console.log(`\nCounts:`);
  console.log(`  Canonical Audience Pains: ${canonicalPainCount}`);
  console.log(`  Final Target Assessments: ${targetAssessmentCount}`);
  console.log(`  Final Product Assessments: ${productAssessmentCount}`);
  console.log(`  Final Strategic Pain Decisions: ${decisionCount}`);
  console.log(`  ONE-TO-ONE INVARIANT: ${isOneToOne ? 'PASS' : 'FAIL'}`);
  console.log(`\nProduct Fit Distribution:`);
  console.log(`  DIRECT_FIT: ${directFitCount}`);
  console.log(`  STRATEGIC_FIT: ${strategicFitCount}`);
  console.log(`  NOT_FIT: ${notFitCount}`);
  console.log(`  UNKNOWN: ${unknownFitCount}`);
  console.log(`\nStrategic Pain Decision Distribution:`);
  console.log(`  CORE_PURCHASE: ${coreCount}`);
  console.log(`  SUPPORTING: ${supportingCount}`);
  console.log(`  EXCLUDE: ${excludeCount}`);
  console.log(`  INCOMPLETE: ${incompleteCount}`);
}

main().catch(console.error);
