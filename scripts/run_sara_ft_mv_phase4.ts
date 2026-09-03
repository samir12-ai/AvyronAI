import "dotenv/config";
import { db } from "../server/db";
import * as schema from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { executeMarketVoiceEvidencePhase } from "../server/market-voice/evidence-engine";

async function runSaraFtPhase4() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";
  const offeringId = "off_70677f8f-1";

  console.log("=== SARA-FT MARKET VOICE PHASE 4 EXECUTION ===");

  // Pre-run counts
  const [preResults, preEvidence, preAudience, preRoots, prePlans, preComps] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceDiscoveryResults).where(and(eq(schema.marketVoiceDiscoveryResults.accountId, accountId), eq(schema.marketVoiceDiscoveryResults.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceEvidence).where(and(eq(schema.marketVoiceEvidence.accountId, accountId), eq(schema.marketVoiceEvidence.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.audienceSnapshots).where(and(eq(schema.audienceSnapshots.accountId, accountId), eq(schema.audienceSnapshots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategyRoots).where(and(eq(schema.strategyRoots.accountId, accountId), eq(schema.strategyRoots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategicPlans).where(and(eq(schema.strategicPlans.accountId, accountId), eq(schema.strategicPlans.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, accountId), eq(schema.ciCompetitors.campaignId, campaignId), eq(schema.ciCompetitors.isActive, true))),
  ]);

  console.log(`Pre-Run Discovery Results: ${preResults[0]?.count}`);
  console.log(`Pre-Run Market Voice Evidence: ${preEvidence[0]?.count}`);
  console.log(`Pre-Run Active Competitors: ${preComps[0]?.count}`);
  console.log(`Pre-Run Audience Snapshots: ${preAudience[0]?.count}`);
  console.log(`Pre-Run Strategy Roots: ${preRoots[0]?.count}`);

  // Run Phase 4 Execution Pass 1
  console.log("\n>>> Executing Market Voice Phase 4 (Pass 1)...");
  const summary1 = await executeMarketVoiceEvidencePhase({
    accountId,
    campaignId,
    campaignOfferingId: offeringId,
    concurrencyLimit: 4,
    maxResultsToProcess: 100,
  });

  console.log("\n=== PASS 1 SUMMARY ===");
  console.log(`Total Discovery Results Evaluated: ${summary1.totalDiscoveryResults}`);
  console.log(`Fetchable Results: ${summary1.fetchableResults}`);
  console.log(`Fetched Content Items: ${summary1.fetchedContentItems}`);
  console.log(`Customer-Voice Candidates Evaluated: ${summary1.customerCandidates}`);
  console.log(`Judge Approved: ${summary1.judgeApproved}`);
  console.log(`Rejected: ${summary1.rejected}`);
  console.log(`Insufficient: ${summary1.insufficient}`);
  console.log(`Canonical Evidence Persisted: ${summary1.canonicalEvidencePersisted}`);
  console.log("Rejection Breakdown:", summary1.rejectionBreakdown);
  console.log("Fetch Failure Breakdown:", summary1.fetchFailureBreakdown);

  // Read persisted evidence
  const persistedRows = await db
    .select()
    .from(schema.marketVoiceEvidence)
    .where(and(
      eq(schema.marketVoiceEvidence.accountId, accountId),
      eq(schema.marketVoiceEvidence.campaignId, campaignId)
    ));

  console.log(`\n=== PERSISTED CANONICAL EVIDENCE ROWS (${persistedRows.length}) ===`);
  for (const row of persistedRows) {
    console.log(`- [${row.id}] (Scope: ${row.marketScope} / Source: ${row.sourceScope} / Platform: ${row.platform})`);
    console.log(`  Result ID: ${row.discoveryResultId}`);
    console.log(`  Source URL: ${row.externalUrl}`);
    console.log(`  Language: ${row.language} | Geography: ${row.geography || "N/A"}`);
    console.log(`  Verbatim Preview: "${row.verbatimText.slice(0, 120)}..."\n`);
  }

  // Run Phase 4 Execution Pass 2 (Idempotency Proof)
  console.log(">>> Executing Market Voice Phase 4 (Pass 2 - Idempotency Check)...");
  const summary2 = await executeMarketVoiceEvidencePhase({
    accountId,
    campaignId,
    campaignOfferingId: offeringId,
    concurrencyLimit: 4,
    maxResultsToProcess: 100,
  });

  console.log("\n=== PASS 2 IDEMPOTENCY ===");
  console.log(`Pass 2 Canonical Evidence Persisted (New Rows): ${summary2.canonicalEvidencePersisted}`);

  const postEvidence = await db.select({ count: sql<number>`count(*)::int` }).from(schema.marketVoiceEvidence).where(and(eq(schema.marketVoiceEvidence.accountId, accountId), eq(schema.marketVoiceEvidence.campaignId, campaignId)));
  console.log(`Total Evidence Rows After Pass 2: ${postEvidence[0]?.count}`);
  console.log(`Pass 2 Delta: ${postEvidence[0]?.count - persistedRows.length} (Expected: 0)`);

  // Downstream Delta Checks
  const [postAudience, postRoots, postPlans, postComps] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.audienceSnapshots).where(and(eq(schema.audienceSnapshots.accountId, accountId), eq(schema.audienceSnapshots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategyRoots).where(and(eq(schema.strategyRoots.accountId, accountId), eq(schema.strategyRoots.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.strategicPlans).where(and(eq(schema.strategicPlans.accountId, accountId), eq(schema.strategicPlans.campaignId, campaignId))),
    db.select({ count: sql<number>`count(*)::int` }).from(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, accountId), eq(schema.ciCompetitors.campaignId, campaignId), eq(schema.ciCompetitors.isActive, true))),
  ]);

  console.log("\n=== DOWNSTREAM SAFETY DELTAS ===");
  console.log(`ci_competitors active delta: ${postComps[0]?.count - preComps[0]?.count} (Expected: 0)`);
  console.log(`audience_snapshots delta: ${postAudience[0]?.count - preAudience[0]?.count} (Expected: 0)`);
  console.log(`strategy_roots delta: ${postRoots[0]?.count - preRoots[0]?.count} (Expected: 0)`);
  console.log(`strategic_plans delta: ${postPlans[0]?.count - prePlans[0]?.count} (Expected: 0)`);

  process.exit(0);
}

runSaraFtPhase4().catch((err) => {
  console.error(err);
  process.exit(1);
});
