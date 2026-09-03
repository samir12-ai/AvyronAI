import "dotenv/config";
import { db } from "../server/db";
import * as schema from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { resolveCurrentBusinessUnderstandingOrThrow } from "../server/business-understanding/resolver";
import {
  loadMarketVoicePlannerContext,
  planMarketVoiceSearchIntents,
} from "../server/market-voice/search-planner";
import { executeMarketVoiceDiscoveryJob } from "../server/market-voice/discovery-engine";
import { executeMarketVoiceEvidencePhase } from "../server/market-voice/evidence-engine";
import { generateDiscoveryJobId } from "@shared/contracts/market-voice";

async function runFreshSaraFtMarketVoice() {
  console.log("==================================================================");
  console.log("  AVYRON FRESH SARA-FT POST-SPLIT MARKET VOICE ACQUISITION RUN");
  console.log("==================================================================\n");

  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";
  const offeringId = "off_70677f8f-1";

  // 1. Snapshot baseline counts
  console.log("1. Recording baseline downstream counts...");
  const [compCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.ciCompetitors).where(eq(schema.ciCompetitors.accountId, accountId));
  const [compSrcCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.competitorSources).where(eq(schema.competitorSources.accountId, accountId));
  const [audCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.audienceSnapshots).where(eq(schema.audienceSnapshots.accountId, accountId));
  const [stratCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.strategyRoots).where(eq(schema.strategyRoots.accountId, accountId));
  const [planCount] = await db.select({ count: sql<number>`count(*)` }).from(schema.strategicPlans).where(eq(schema.strategicPlans.accountId, accountId));
  const [evCountBefore] = await db.select({ count: sql<number>`count(*)` }).from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, accountId));

  console.log(`  ci_competitors: ${compCount.count}`);
  console.log(`  competitor_sources: ${compSrcCount.count}`);
  console.log(`  audience_snapshots: ${audCount.count}`);
  console.log(`  strategy_roots: ${stratCount.count}`);
  console.log(`  strategic_plans: ${planCount.count}`);
  console.log(`  market_voice_evidence: ${evCountBefore.count}\n`);

  // 2. Resolve canonical Business Understanding
  console.log("2. Resolving canonical Business Understanding authority...");
  const bu = await resolveCurrentBusinessUnderstandingOrThrow({
    accountId,
    campaignId,
    campaignOfferingId: offeringId,
  });
  console.log(`  BU Snapshot ID: ${bu.snapshotId}`);
  console.log(`  Canonical Offering: ${bu.campaignOfferingId} ("${bu.offeringName}")`);
  console.log(`  Category: ${bu.payload?.campaignOffering?.category}`);
  console.log(`  Target Geography: ${bu.payload?.targetUnderstanding?.geography}\n`);

  // 3. Load planner context
  console.log("3. Loading Market Voice Planner Context...");
  const plannerContext = await loadMarketVoicePlannerContext(campaignId, offeringId, accountId);

  // 4. Plan and Persist Search Plan (Phase 2)
  console.log("4. Planning and Persisting fresh Search Plan (Phase 2)...");
  const planResult = await planMarketVoiceSearchIntents(plannerContext);
  const freshJobId = planResult.job.id;
  console.log(`  Persisted Job ID: ${freshJobId} with status: ${planResult.job.status}`);
  console.log(`  Judge Overall Decision: ${planResult.judgeReport.overallDecision} (${planResult.judgeReport.summary})`);

  const persistedIntents = await db
    .select()
    .from(schema.marketVoiceSearchIntents)
    .where(eq(schema.marketVoiceSearchIntents.discoveryJobId, freshJobId));

  console.log(`\nApproved Search Intents for Job ${freshJobId}:`);
  for (const intent of persistedIntents) {
    console.log(`  [${intent.id}] [${intent.targetPlatform}] (${intent.intentCategory}) "${intent.query}" (Scope: ${intent.marketScope})`);
  }

  // 6. Execute Phase 3 Provider Execution
  console.log("\n6. Executing Phase 3 Provider Execution for fresh job...");
  const phase3Summary = await executeMarketVoiceDiscoveryJob(freshJobId, {
    accountId,
    concurrencyLimit: 3,
  });

  console.log(`\nPhase 3 Summary for ${freshJobId}:`);
  console.log(`  Job Status: ${phase3Summary.status}`);
  console.log(`  Total Intents: ${phase3Summary.totalIntents}`);
  console.log(`  Successful Intents: ${phase3Summary.successfulIntents}`);
  console.log(`  Failed Intents: ${phase3Summary.failedIntents}`);
  console.log(`  Unavailable Intents: ${phase3Summary.unavailableIntents}`);
  console.log(`  Total Results Persisted: ${phase3Summary.totalResultsPersisted}`);

  for (const t of phase3Summary.telemetry) {
    console.log(`  - Intent [${t.searchIntentId}] (${t.targetPlatform}): Status=${t.status} Results=${t.resultsPersisted} Runtime=${t.runtimeMs}ms Provider=${t.provider || "N/A"}`);
  }

  // 7. Execute Phase 4 on EXACT Fresh Job ID
  console.log("\n7. Executing Phase 4 on EXACT Fresh Job ID...");
  const phase4Summary = await executeMarketVoiceEvidencePhase({
    accountId,
    campaignId,
    campaignOfferingId: offeringId,
    discoveryJobId: freshJobId,
    maxResultsToProcess: 50,
  });

  console.log(`\nPhase 4 Acceptance Funnel for ${freshJobId}:`);
  console.log(`  Discovery Results Evaluated: ${phase4Summary.totalDiscoveryResults}`);
  console.log(`  Fetchable Destination Pages: ${phase4Summary.fetchableResults}`);
  console.log(`  Fetched Content Items: ${phase4Summary.fetchedContentItems}`);
  console.log(`  Customer Voice Candidates: ${phase4Summary.customerCandidates}`);
  console.log(`  Judge Approved Evidence: ${phase4Summary.judgeApproved}`);
  console.log(`  Rejected Candidates: ${phase4Summary.rejected}`);
  console.log(`  Insufficient Evidence: ${phase4Summary.insufficient}`);
  console.log(`  Canonical Evidence Persisted: ${phase4Summary.canonicalEvidencePersisted}`);
  console.log(`  Rejection Breakdown:`, phase4Summary.rejectionBreakdown);
  console.log(`  Fetch Failure Breakdown:`, phase4Summary.fetchFailureBreakdown);

  // 8. Inspect Persisted Evidence Rows
  const freshEvidence = await db
    .select()
    .from(schema.marketVoiceEvidence)
    .where(eq(schema.marketVoiceEvidence.discoveryJobId, freshJobId));

  console.log(`\nPersisted market_voice_evidence rows for fresh job (${freshEvidence.length}):`);
  for (const ev of freshEvidence) {
    console.log(`  - [${ev.id}] [${ev.platform}] (Scope: ${ev.marketScope}, Geo: ${ev.geography || "N/A"}, Lang: ${ev.language || "N/A"})`);
    console.log(`    URL: ${ev.sourceUrl}`);
    console.log(`    Verbatim: "${ev.verbatimText.slice(0, 120)}..."\n`);
  }

  // 9. Verify Safety Counts Delta
  console.log("9. Verifying downstream safety counts after run...");
  const [compCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.ciCompetitors).where(eq(schema.ciCompetitors.accountId, accountId));
  const [compSrcCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.competitorSources).where(eq(schema.competitorSources.accountId, accountId));
  const [audCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.audienceSnapshots).where(eq(schema.audienceSnapshots.accountId, accountId));
  const [stratCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.strategyRoots).where(eq(schema.strategyRoots.accountId, accountId));
  const [planCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.strategicPlans).where(eq(schema.strategicPlans.accountId, accountId));
  const [evCountAfter] = await db.select({ count: sql<number>`count(*)` }).from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, accountId));

  console.log(`  ci_competitors delta: ${Number(compCountAfter.count) - Number(compCount.count)} (Expected: 0)`);
  console.log(`  competitor_sources delta: ${Number(compSrcCountAfter.count) - Number(compSrcCount.count)} (Expected: 0)`);
  console.log(`  audience_snapshots delta: ${Number(audCountAfter.count) - Number(audCount.count)} (Expected: 0)`);
  console.log(`  strategy_roots delta: ${Number(stratCountAfter.count) - Number(stratCount.count)} (Expected: 0)`);
  console.log(`  strategic_plans delta: ${Number(planCountAfter.count) - Number(planCount.count)} (Expected: 0)`);
  console.log(`  market_voice_evidence delta: ${Number(evCountAfter.count) - Number(evCountBefore.count)} (New fresh evidence created: ${freshEvidence.length})\n`);

  // 10. Historical Job Isolation Check
  console.log("10. Historical Job Isolation Check:");
  const historicalJobs = ["djob_9124e86ba9ec0b93", "djob_62bd18eacfb40789"];
  for (const oldJobId of historicalJobs) {
    const oldEvRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.marketVoiceEvidence)
      .where(eq(schema.marketVoiceEvidence.discoveryJobId, oldJobId));
    console.log(`  Old Job ${oldJobId}: Evidence Rows = ${oldEvRows[0].count} (Preserved in DB)`);
  }

  process.exit(0);
}

runFreshSaraFtMarketVoice().catch((err) => {
  console.error("FATAL RUN ERROR:", err);
  process.exit(1);
});
