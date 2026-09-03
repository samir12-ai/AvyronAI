import "dotenv/config";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidateCanonicalCompetitors } from "../server/competitive-intelligence/competitor-quality-revalidator";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  console.log("=================================================");
  console.log("SARA-FT CANONICAL COMPETITOR QUALITY REVALIDATION");
  console.log(`Account ID:  ${accountId}`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log("=================================================\n");

  // Step 1: Baseline Downstream Counts
  console.log("--- 1. CAPTURING BASELINE DOWNSTREAM COUNTS ---");
  const [mvEvidencePre, audSnapPre, stratRootPre, stratPlanPre] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceEvidence).where(and(eq(schema.marketVoiceEvidence.accountId, accountId), eq(schema.marketVoiceEvidence.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.audienceSnapshots).where(and(eq(schema.audienceSnapshots.accountId, accountId), eq(schema.audienceSnapshots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategyRoots).where(and(eq(schema.strategyRoots.accountId, accountId), eq(schema.strategyRoots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategicPlans).where(and(eq(schema.strategicPlans.accountId, accountId), eq(schema.strategicPlans.campaignId, campaignId))),
  ]);

  console.log(`Baseline Downstream Counts:`);
  console.log(`- market_voice_evidence: ${mvEvidencePre[0]?.count}`);
  console.log(`- audience_snapshots:    ${audSnapPre[0]?.count}`);
  console.log(`- strategy_roots:        ${stratRootPre[0]?.count}`);
  console.log(`- strategic_plans:       ${stratPlanPre[0]?.count}\n`);

  // Step 2: Run Quality Revalidation Dry-Run
  console.log("--- 2. RUNNING QUALITY REVALIDATION DRY-RUN (ALL 33 ACTIVE) ---");
  const dryRunReport = await revalidateCanonicalCompetitors({
    accountId,
    campaignId,
    dryRun: true,
  });

  console.log("\n=================================================");
  console.log("DRY-RUN EVALUATION MATRIX (33 CANONICAL COMPETITORS)");
  console.log("=================================================");
  console.log(`Active Before:                           ${dryRunReport.activeBefore}`);
  console.log(`Keep Active (Direct / Relevant):         ${dryRunReport.keepActiveCount}`);
  console.log(`Keep As Benchmark:                       ${dryRunReport.keepAsBenchmarkCount}`);
  console.log(`Deactivate (Not Competitor / Platform):  ${dryRunReport.deactivatedNotCompetitorCount}`);
  console.log(`Deactivate (Insufficient Evidence):      ${dryRunReport.deactivatedInsufficientEvidenceCount}`);
  console.log(`Projected Active After:                  ${dryRunReport.activeAfter}\n`);

  console.log("Detailed Competitor Breakdown:");
  for (const c of dryRunReport.candidates) {
    console.log(`\n[${c.action}] ${c.name} (${c.domain})`);
    console.log(`  - Competitor ID:    ${c.competitorId}`);
    console.log(`  - Entity Role:      ${c.entityRole}`);
    console.log(`  - Role Reasoning:   ${c.entityRoleReasoning}`);
    console.log(`  - Classification:   ${c.relevanceClassification}`);
    console.log(`  - Relevance Reason: ${c.relevanceReason}`);
    console.log(`  - Judge Verdict:    ${c.judgeVerdict}`);
    console.log(`  - Judge Reason:     ${c.judgeFinalReason}`);
  }

  // Step 3: Execute Live Quality Revalidation
  console.log("\n--- 3. EXECUTING LIVE TRANSACTIONAL QUALITY REVALIDATION ---");
  const liveReport = await revalidateCanonicalCompetitors({
    accountId,
    campaignId,
    dryRun: false,
  });

  console.log("\nLive Revalidation Applied Successfully!");
  console.log(`- Active Before:   ${liveReport.activeBefore}`);
  console.log(`- Active After:    ${liveReport.activeAfter}`);
  console.log(`- Kept Active:     ${liveReport.keepActiveCount}`);
  console.log(`- Kept Benchmark:  ${liveReport.keepAsBenchmarkCount}`);
  console.log(`- Deactivated:     ${liveReport.deactivatedNotCompetitorCount + liveReport.deactivatedInsufficientEvidenceCount}`);

  // Step 4: Idempotency Test (Second Pass)
  console.log("\n--- 4. TESTING REVALIDATION IDEMPOTENCY (SECOND PASS) ---");
  const secondPassReport = await revalidateCanonicalCompetitors({
    accountId,
    campaignId,
    dryRun: false,
  });

  console.log(`Second Pass Active Before: ${secondPassReport.activeBefore}`);
  console.log(`Second Pass Active After:  ${secondPassReport.activeAfter}`);
  console.log(`State Changes in Pass 2:   ${secondPassReport.deactivatedNotCompetitorCount + secondPassReport.deactivatedInsufficientEvidenceCount === 0 ? "0 (100% IDEMPOTENT)" : "UNEXPECTED CHANGES"}`);

  // Step 5: Settings Backend Readback
  console.log("\n--- 5. SETTINGS BACKEND READBACK VERIFICATION ---");
  const settingsCompetitors = await db
    .select({
      id: schema.ciCompetitors.id,
      name: schema.ciCompetitors.name,
      websiteUrl: schema.ciCompetitors.websiteUrl,
      tier: schema.ciCompetitors.tier,
      isActive: schema.ciCompetitors.isActive,
    })
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId),
      eq(schema.ciCompetitors.isActive, true)
    ));

  console.log(`Settings Active Competitor Count: ${settingsCompetitors.length}`);
  for (const c of settingsCompetitors) {
    console.log(`  * ${c.id} | Tier: ${c.tier} | Name: "${c.name}" | URL: ${c.websiteUrl}`);
  }

  // Step 6: Build Gate Execution
  console.log("\n--- 6. STRATEGY BUILD GATE VERIFICATION ---");
  const gateActiveCount = settingsCompetitors.length;
  const gatePasses = gateActiveCount >= 10;
  console.log(`Build Gate Count: ${gateActiveCount} canonical active competitors (Threshold: >= 10)`);
  console.log(`Build Gate Status: ${gatePasses ? "PASS (Ready for strategy build)" : "FAIL (Additional discovery needed)"}`);

  // Step 7: Downstream Safety Counts Verification
  console.log("\n--- 7. VERIFYING ZERO DOWNSTREAM POLLUTION ---");
  const [mvEvidencePost, audSnapPost, stratRootPost, stratPlanPost] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceEvidence).where(and(eq(schema.marketVoiceEvidence.accountId, accountId), eq(schema.marketVoiceEvidence.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.audienceSnapshots).where(and(eq(schema.audienceSnapshots.accountId, accountId), eq(schema.audienceSnapshots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategyRoots).where(and(eq(schema.strategyRoots.accountId, accountId), eq(schema.strategyRoots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategicPlans).where(and(eq(schema.strategicPlans.accountId, accountId), eq(schema.strategicPlans.campaignId, campaignId))),
  ]);

  console.log(`Downstream Counts Post-Revalidation:`);
  console.log(`- market_voice_evidence: Pre=${mvEvidencePre[0]?.count}, Post=${mvEvidencePost[0]?.count}, Delta=${mvEvidencePost[0]?.count - mvEvidencePre[0]?.count}`);
  console.log(`- audience_snapshots:    Pre=${audSnapPre[0]?.count}, Post=${audSnapPost[0]?.count}, Delta=${audSnapPost[0]?.count - audSnapPre[0]?.count}`);
  console.log(`- strategy_roots:        Pre=${stratRootPre[0]?.count}, Post=${stratRootPost[0]?.count}, Delta=${stratRootPost[0]?.count - stratRootPre[0]?.count}`);
  console.log(`- strategic_plans:       Pre=${stratPlanPre[0]?.count}, Post=${stratPlanPost[0]?.count}, Delta=${stratPlanPost[0]?.count - stratPlanPre[0]?.count}`);

  console.log("\n=================================================");
  console.log("CANONICAL QUALITY REVALIDATION COMPLETED");
  console.log("=================================================");

  process.exit(0);
}

main().catch(err => {
  console.error("Quality revalidation failed:", err);
  process.exit(1);
});
