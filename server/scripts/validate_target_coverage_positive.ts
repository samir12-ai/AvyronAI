import 'dotenv/config';
import { db } from "../db";
import {
  growthCampaigns,
  businessDataLayer,
  audienceSnapshots
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  extractBusinessTargetAuthority,
  resolveTargetRolesWithJudge,
  matchAudienceToTargetsWithJudge,
  evaluateTargetCoverage,
  type NormalizedTargetRole
} from "../audience-engine/target-coverage";
import type { AudienceSegment } from "../audience-engine/engine";

async function main() {
  console.log("================================================================================");
  console.log("AVYRON — TARGET COVERAGE POSITIVE-PATH RUNTIME ACCEPTANCE");
  console.log("================================================================================");

  const realCampaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  // ============================================================================
  // SECTION 1 & 7: AUDIENCE SNAPSHOT HISTORY & ROLE DISCREPANCY AUDIT
  // ============================================================================
  console.log("\n--- SECTION 7: AUDIENCE SNAPSHOT HISTORY & ROLE DISCREPANCY AUDIT ---");
  const snapshots = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, realCampaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(5);

  console.log(`Found ${snapshots.length} audience snapshots for campaign ${realCampaignId}:`);
  for (const s of snapshots) {
    const segs: AudienceSegment[] = JSON.parse((s.audienceSegments as string) || "[]");
    console.log(`\nSnapshot ID: ${s.id} | Timestamp: ${s.createdAt} | Target Coverage Status: ${s.targetCoverage ? (JSON.parse(typeof s.targetCoverage === "string" ? s.targetCoverage : JSON.stringify(s.targetCoverage))).status : "N/A"}`);
    segs.forEach((seg, idx) => {
      console.log(`  Segment ${idx + 1}: "${seg.name}" -> Role: [${seg.role}]`);
    });
  }

  // Pick the latest valid canonical audience segments for downstream matching
  const latestSnapshot = snapshots[0];
  const canonicalSegments: AudienceSegment[] = JSON.parse((latestSnapshot?.audienceSegments as string) || "[]");

  console.log(`\nUsing Latest Canonical Snapshot: ${latestSnapshot?.id} with ${canonicalSegments.length} canonical segments:`);
  canonicalSegments.forEach((seg, idx) => {
    console.log(`  [Segment ${idx + 1}] "${seg.name}"`);
    console.log(`    Role: [${seg.role}] (claimId: ${seg.roleClaimId}, evidenceIds: ${JSON.stringify(seg.roleEvidenceIds)})`);
    console.log(`    Definition: "${seg.segmentDefinition}"`);
    console.log(`    Pains (${seg.pains.length}): ${JSON.stringify(seg.pains.map(p => p.claim))}`);
  });

  // ============================================================================
  // SECTION 2: SETUP ISOLATED VALIDATION FIXTURE WITH PERSISTED TARGET AUTHORITY
  // ============================================================================
  console.log("\n--- SECTION 1 & 2: PERSISTING BUSINESS TARGET AUTHORITY TO DATABASE FIXTURE ---");
  const fixtureCampaignId = `campaign_test_tc_positive_${Date.now()}`;
  
  // Insert Campaign
  await db.insert(growthCampaigns).values({
    id: fixtureCampaignId,
    name: "E-Commerce Ad Automation B2B Campaign",
    stage: "testing",
    budget: 1000,
    isActive: true,
  });

  // Insert Business Data Layer (Product Context) with explicit target authority
  const rawTargetAudience = "E-commerce and creator marketers seeking AI tools to automate ad design and scheduling";
  const rawTargetDecisionMaker = "Marketing Lead and Growth Operator managing ad campaigns";

  await db.insert(businessDataLayer).values({
    campaignId: fixtureCampaignId,
    accountId,
    businessLocation: "Global",
    businessType: "B2B SaaS",
    coreOffer: "Automated Ad & Prospecting Workflow Engine",
    targetAudienceAge: "25-54",
    targetAudienceSegment: rawTargetAudience,
    targetDecisionMaker: rawTargetDecisionMaker,
    monthlyBudget: "$5,000",
    funnelObjective: "Lead Generation",
    primaryConversionChannel: "Web Demo",
    priceRange: "$200 - $1,000 / mo",
  });

  console.log(`Fixture Campaign created: ${fixtureCampaignId}`);
  console.log(`Persisted targetAudienceSegment: "${rawTargetAudience}"`);
  console.log(`Persisted targetDecisionMaker: "${rawTargetDecisionMaker}"`);

  // ============================================================================
  // SECTION 3: TARGET AUTHORITY INGESTION TRACE
  // ============================================================================
  console.log("\n--- SECTION 3: TARGET AUTHORITY INGESTION TRACE ---");
  const extractedSources = await extractBusinessTargetAuthority(fixtureCampaignId, accountId);
  console.log(`Extracted ${extractedSources.length} explicit business-authored target source items:`);
  extractedSources.forEach((s, idx) => {
    console.log(`  [Source ${idx + 1}] Field: ${s.field} | Business-Authored: YES`);
    console.log(`    Raw Value: "${s.text}"`);
  });

  // ============================================================================
  // SECTION 4 & 5: LLM TARGET RESOLVER & TARGET AUTHORITY JUDGE
  // ============================================================================
  console.log("\n--- SECTION 4 & 5: LLM TARGET RESOLVER & TARGET AUTHORITY JUDGE EXECUTION ---");
  const resolutionResult = await resolveTargetRolesWithJudge(extractedSources);
  console.log(`Target Authority Resolution Valid: ${resolutionResult.valid}`);
  if (!resolutionResult.valid) {
    console.error(`Resolution Rejections:`, resolutionResult.rejectionReasons);
    process.exit(1);
  }

  console.log(`Normalized Target Roles (${resolutionResult.targetRoles.length}):`);
  resolutionResult.targetRoles.forEach(t => {
    console.log(`\n  Target ID: ${t.targetId}`);
    console.log(`  Role Name: "${t.roleName}"`);
    console.log(`  Description: "${t.description}"`);
    console.log(`  Buyer Type: ${t.buyerType}`);
    console.log(`  Source Field: ${t.sourceField}`);
    console.log(`  Raw Source Text: "${t.rawSourceText}"`);
  });

  // ============================================================================
  // SECTION 13: POSITIVE SCENARIO — LIVE ROLE MATCHER & ROLE-MATCH JUDGE
  // ============================================================================
  console.log("\n--- SECTION 13: POSITIVE SCENARIO — LIVE ROLE MATCHER & ROLE-MATCH JUDGE ---");
  console.log(`Matching ${resolutionResult.targetRoles.length} explicit targets against ${canonicalSegments.length} canonical segments...`);

  const positiveMatchResult = await matchAudienceToTargetsWithJudge(
    resolutionResult.targetRoles,
    canonicalSegments
  );

  console.log(`Role-Match Judge Verdict: valid=${positiveMatchResult.valid}`);
  console.log(`Semantic Matches:`);
  positiveMatchResult.matches.forEach(m => {
    console.log(`\n  Target: "${m.roleName}" (ID: ${m.targetId})`);
    console.log(`  Match Type: ${m.matchType}`);
    console.log(`  Is Covered: ${m.isCovered}`);
    console.log(`  Matched Segments: ${JSON.stringify(m.matchedSegmentNames)}`);
    console.log(`  Matched Roles: ${JSON.stringify(m.matchedRoles)}`);
    console.log(`  Reasoning: "${m.reasoning}"`);
  });

  // ============================================================================
  // SECTION 13B: POSITIVE FULL SCENARIO (SINGLE TARGET MATCHING CANONICAL AUDIENCE)
  // ============================================================================
  console.log("\n--- SECTION 13B: POSITIVE FULL SCENARIO (SINGLE MATCHING TARGET) ---");
  const singleMatchingTarget: NormalizedTargetRole[] = [
    {
      targetId: "target_full_1",
      roleName: "E-commerce and creator marketers",
      description: "Marketers and creators who manage ad designs and seek AI workflow automation",
      buyerType: "PRACTITIONER",
      sourceField: "businessDataLayer.targetAudienceSegment",
      rawSourceText: "E-commerce and creator marketers seeking AI tools to automate ad design and scheduling"
    }
  ];

  const fullMatchResult = await matchAudienceToTargetsWithJudge(singleMatchingTarget, canonicalSegments);
  console.log(`Single Target Match Valid: ${fullMatchResult.valid}`);
  console.log(`Single Target Match Type: ${fullMatchResult.matches[0]?.matchType}`);
  console.log(`Single Target Is Covered: ${fullMatchResult.matches[0]?.isCovered}`);
  const isFull = fullMatchResult.matches.every(m => m.isCovered);
  console.log(`Final Coverage Status for Single Target: ${isFull ? "FULL" : "GAP"}`);

  // ============================================================================
  // SECTION 14: NEGATIVE BUYER/USER MISMATCH SCENARIO (CONTROLLED LIVE PROOF)
  // ============================================================================
  console.log("\n--- SECTION 14: NEGATIVE BUYER/USER MISMATCH SCENARIO (CONTROLLED LIVE PROOF) ---");
  const buyerTarget: NormalizedTargetRole[] = [
    {
      targetId: "buyer_target_1",
      roleName: "Chief Financial Officer / Procurement Director",
      description: "Executive with direct purchasing authority signing enterprise vendor contracts",
      buyerType: "ECONOMIC_BUYER",
      sourceField: "productDna.targetDecisionMaker",
      rawSourceText: "Chief Financial Officer / Procurement Director"
    }
  ];

  const consumerSegmentsOnly: AudienceSegment[] = canonicalSegments.filter(s => s.role === "END_CONSUMER");
  console.log(`Testing Economic Buyer target against ${consumerSegmentsOnly.length} END_CONSUMER complaint segments...`);

  const buyerUserMatchResult = await matchAudienceToTargetsWithJudge(buyerTarget, consumerSegmentsOnly);
  console.log(`Buyer/User Match Valid: ${buyerUserMatchResult.valid}`);
  console.log(`Match Output:`, buyerUserMatchResult.matches[0]);
  console.log(`Buyer/User Collapsed?: ${buyerUserMatchResult.matches[0]?.isCovered ? "YES (DEFECT)" : "NO (CORRECT)"}`);

  // ============================================================================
  // SECTION 15: NEGATIVE BROADER-ROLE SCENARIO (CONTROLLED LIVE PROOF)
  // ============================================================================
  console.log("\n--- SECTION 15: NEGATIVE BROADER-ROLE SCENARIO (CONTROLLED LIVE PROOF) ---");
  const narrowExecutiveTarget: NormalizedTargetRole[] = [
    {
      targetId: "exec_target_1",
      roleName: "Global VP of Enterprise Brand Strategy",
      description: "Senior executive directing global brand positioning across Fortune 500 companies",
      buyerType: "ECONOMIC_BUYER",
      sourceField: "productDna.targetDecisionMaker",
      rawSourceText: "Global VP of Enterprise Brand Strategy"
    }
  ];

  const practitionerSegmentsOnly: AudienceSegment[] = canonicalSegments.filter(s => s.role === "PRACTITIONER");
  console.log(`Testing Narrow Executive target against ${practitionerSegmentsOnly.length} generic PRACTITIONER segments...`);

  const broaderMatchResult = await matchAudienceToTargetsWithJudge(narrowExecutiveTarget, practitionerSegmentsOnly);
  console.log(`Broader Role Match Valid: ${broaderMatchResult.valid}`);
  console.log(`Match Output:`, broaderMatchResult.matches[0]);
  console.log(`Unwarranted Broadening Allowed?: ${broaderMatchResult.matches[0]?.isCovered ? "YES (DEFECT)" : "NO (CORRECT)"}`);

  // ============================================================================
  // SECTION 16: MISSING-AUTHORITY REGRESSION TEST ON REAL MARKETMIND
  // ============================================================================
  console.log("\n--- SECTION 16: MISSING-AUTHORITY REGRESSION TEST ON REAL MARKETMIND ---");
  const realMarketMindCoverage = await evaluateTargetCoverage(
    realCampaignId,
    accountId,
    canonicalSegments,
    "COMPLETE"
  );
  console.log(`Real MarketMind Target Coverage:`, realMarketMindCoverage);

  // ============================================================================
  // SECTION 12 & 13: END-TO-END EVALUATION ON FIXTURE CAMPAIGN
  // ============================================================================
  console.log("\n--- SECTION 12 & 13: FULL END-TO-END TARGET COVERAGE EVALUATION ON FIXTURE ---");
  const fixtureCoverageResult = await evaluateTargetCoverage(
    fixtureCampaignId,
    accountId,
    canonicalSegments,
    "COMPLETE"
  );
  console.log(`Fixture Campaign Final Target Coverage:`, fixtureCoverageResult);

  // Clean up fixture campaign
  try {
    await db.delete(businessDataLayer).where(eq(businessDataLayer.campaignId, fixtureCampaignId));
    await db.delete(growthCampaigns).where(eq(growthCampaigns.id, fixtureCampaignId));
    console.log(`\nFixture campaign ${fixtureCampaignId} cleaned up successfully.`);
  } catch (cleanErr) {
    console.warn("Cleanup warning:", cleanErr);
  }

  console.log("\n================================================================================");
  console.log("TARGET COVERAGE POSITIVE-PATH VALIDATION COMPLETE");
  console.log("================================================================================");
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
