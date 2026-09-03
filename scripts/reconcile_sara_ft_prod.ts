import "dotenv/config";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { reconcileCompetitors } from "../server/competitive-intelligence/competitor-reconciler";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  console.log("=================================================");
  console.log("SARA-FT PRODUCTION COMPETITOR RECONCILIATION");
  console.log(`Account ID:  ${accountId}`);
  console.log(`Campaign ID: ${campaignId}`);
  console.log("=================================================\n");

  // Step 1: Baseline Downstream Counts (to prove delta = 0)
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

  // Step 2: Dry Run Execution
  console.log("--- 2. RUNNING RECONCILIATION DRY-RUN ---");
  const dryRunResult = await reconcileCompetitors({
    accountId,
    campaignId,
    dryRun: true,
  });

  console.log("Dry-Run Result Summary:");
  console.log(`- Total DB Rows Pre:        ${dryRunResult.preReconciliation.totalRows}`);
  console.log(`- Active Rows Pre:          ${dryRunResult.preReconciliation.activeRows}`);
  console.log(`- Unique Canonical Domains:  ${dryRunResult.preReconciliation.uniqueDomains}`);
  console.log(`- Duplicate Groups Found:   ${dryRunResult.preReconciliation.duplicateGroups}`);
  console.log(`- Duplicate Rows to Merge:  ${dryRunResult.preReconciliation.duplicateRows}`);
  console.log(`- Projected Active After:   ${dryRunResult.postReconciliation.activeCanonicalRows}`);
  console.log(`- Projected Inactive After: ${dryRunResult.postReconciliation.inactiveSupersededRows}`);

  console.log("\nDry-Run Duplicate Groups:");
  for (const g of dryRunResult.groups) {
    console.log(`  * [${g.normalizedDomain}] "${g.businessName}" | Survivor: ${g.survivorId} | Merging ${g.supersededIds.length} rows`);
  }

  // Step 3: Execute Live Transactional Reconciliation
  console.log("\n--- 3. EXECUTING LIVE TRANSACTIONAL REPAIR ---");
  const liveResult = await reconcileCompetitors({
    accountId,
    campaignId,
    dryRun: false,
  });

  console.log("Live Reconciliation Execution Completed!");
  console.log(`- Success:                  ${liveResult.success}`);
  console.log(`- Active Canonical Rows:    ${liveResult.postReconciliation.activeCanonicalRows}`);
  console.log(`- Inactive Superseded Rows: ${liveResult.postReconciliation.inactiveSupersededRows}`);
  console.log(`- Duplicate Active Groups:  ${liveResult.postReconciliation.duplicateActiveGroups}`);
  console.log(`- Reparented Sources:       ${liveResult.reparentedCounts.sources}`);
  console.log(`- Reparented Posts:         ${liveResult.reparentedCounts.posts}`);
  console.log(`- Reparented Comments:      ${liveResult.reparentedCounts.comments}`);
  console.log(`- Reparented Snapshots:     ${liveResult.reparentedCounts.snapshots}`);
  console.log(`- Consolidated Schedules:   ${liveResult.reparentedCounts.schedules}`);
  console.log(`- Reparented Briefs:        ${liveResult.reparentedCounts.briefs}`);

  console.log("\nOrphan Check (Pointing to Inactive Parents):");
  console.log(`- Orphan Sources:   ${liveResult.orphanCounts.sources}`);
  console.log(`- Orphan Posts:     ${liveResult.orphanCounts.posts}`);
  console.log(`- Orphan Comments:  ${liveResult.orphanCounts.comments}`);
  console.log(`- Orphan Snapshots: ${liveResult.orphanCounts.snapshots}`);
  console.log(`- Orphan Schedules: ${liveResult.orphanCounts.schedules}`);

  // Step 4: Settings Backend Readback Verification
  console.log("\n--- 4. SETTINGS BACKEND READBACK VERIFICATION ---");
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
  console.log("Canonical Active Competitors in Settings:");
  for (const c of settingsCompetitors) {
    console.log(`  * ${c.id} | Tier: ${c.tier} | Name: "${c.name}" | URL: ${c.websiteUrl}`);
  }

  // Step 5: Build Gate Simulation
  console.log("\n--- 5. STRATEGY BUILD GATE VERIFICATION ---");
  const gateActiveCount = settingsCompetitors.length;
  const gatePasses = gateActiveCount >= 10;
  console.log(`Build Gate Count: ${gateActiveCount} canonical active competitors (Threshold: >= 10)`);
  console.log(`Build Gate Status: ${gatePasses ? "PASS (Ready for strategy build)" : "FAIL"}`);

  // Step 6: Post-Reconciliation Downstream Counts Check
  console.log("\n--- 6. VERIFYING ZERO DOWNSTREAM POLLUTION ---");
  const [mvEvidencePost, audSnapPost, stratRootPost, stratPlanPost] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceEvidence).where(and(eq(schema.marketVoiceEvidence.accountId, accountId), eq(schema.marketVoiceEvidence.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.audienceSnapshots).where(and(eq(schema.audienceSnapshots.accountId, accountId), eq(schema.audienceSnapshots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategyRoots).where(and(eq(schema.strategyRoots.accountId, accountId), eq(schema.strategyRoots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategicPlans).where(and(eq(schema.strategicPlans.accountId, accountId), eq(schema.strategicPlans.campaignId, campaignId))),
  ]);

  console.log(`Downstream Counts Post-Repair:`);
  console.log(`- market_voice_evidence: Pre=${mvEvidencePre[0]?.count}, Post=${mvEvidencePost[0]?.count}, Delta=${mvEvidencePost[0]?.count - mvEvidencePre[0]?.count}`);
  console.log(`- audience_snapshots:    Pre=${audSnapPre[0]?.count}, Post=${audSnapPost[0]?.count}, Delta=${audSnapPost[0]?.count - audSnapPre[0]?.count}`);
  console.log(`- strategy_roots:        Pre=${stratRootPre[0]?.count}, Post=${stratRootPost[0]?.count}, Delta=${stratRootPost[0]?.count - stratRootPre[0]?.count}`);
  console.log(`- strategic_plans:       Pre=${stratPlanPre[0]?.count}, Post=${stratPlanPost[0]?.count}, Delta=${stratPlanPost[0]?.count - stratPlanPre[0]?.count}`);

  console.log("\n=================================================");
  console.log("SARA-FT RECONCILIATION VERIFICATION COMPLETE");
  console.log("=================================================");

  process.exit(0);
}

main().catch(err => {
  console.error("Reconciliation execution failed:", err);
  process.exit(1);
});
