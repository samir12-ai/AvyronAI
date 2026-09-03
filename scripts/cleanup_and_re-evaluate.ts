import "dotenv/config";
import { db } from "../server/db";
import {
  clarificationRequests,
  businessExecutionStates,
  performanceContexts,
  manualCampaignMetrics,
  ownedSourceSnapshots,
} from "@shared/schema";
import { eq, inArray, gt, and } from "drizzle-orm";
import { resolveAccountIdFromCampaign } from "../server/performance-loop/account-resolver";
import { evaluateAndPersistBusinessExecutionState } from "../server/performance-loop/execution-intelligence";
import { translatePerformanceToBll } from "../server/performance-loop/bll";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = await resolveAccountIdFromCampaign(campaignId);
  console.log("=== STEP 1: RESOLVED CANONICAL ACCOUNT:", accountId, "===");

  // 1. Delete test-contaminated manualCampaignMetrics (id 22, 23, 24, 25)
  const deletedMetrics = await db
    .delete(manualCampaignMetrics)
    .where(and(eq(manualCampaignMetrics.campaignId, campaignId), inArray(manualCampaignMetrics.id, [22, 23, 24, 25])))
    .returning();
  console.log("Deleted test manualCampaignMetrics rows:", deletedMetrics.length);

  // 2. Delete test-generated businessExecutionStates created after 12:50:00Z
  const cutoffTime = new Date("2026-08-24T12:50:00.000Z");
  const deletedStates = await db
    .delete(businessExecutionStates)
    .where(and(eq(businessExecutionStates.campaignId, campaignId), gt(businessExecutionStates.createdAt, cutoffTime)))
    .returning();
  console.log("Deleted test businessExecutionStates rows:", deletedStates.length);

  // 3. Delete test-generated clarificationRequests created after 12:50:00Z
  const deletedClarifications = await db
    .delete(clarificationRequests)
    .where(and(eq(clarificationRequests.campaignId, campaignId), gt(clarificationRequests.createdAt, cutoffTime)))
    .returning();
  console.log("Deleted test clarificationRequests rows:", deletedClarifications.length);

  // 4. Invalidate/Delete any ownedSourceSnapshots of type MANUAL_BUSINESS_TRUTH containing the 3-year 60-client fixture
  const deletedSnapshots = await db
    .delete(ownedSourceSnapshots)
    .where(
      and(
        eq(ownedSourceSnapshots.campaignId, campaignId),
        eq(ownedSourceSnapshots.sourceType, "MANUAL_BUSINESS_TRUTH"),
        gt(ownedSourceSnapshots.createdAt, cutoffTime)
      )
    )
    .returning();
  console.log("Deleted test ownedSourceSnapshots rows:", deletedSnapshots.length);

  // 5. Restore the REAL user answer to clarification requests for campaign
  const realUserAnswer = "No sales history. My business is new.";
  await db
    .update(clarificationRequests)
    .set({
      accountId,
      userAnswer: realUserAnswer,
      status: "ANSWERED",
      answeredAt: new Date("2026-08-24T12:38:55.000Z"),
    })
    .where(eq(clarificationRequests.campaignId, campaignId));
  console.log("Restored REAL user answer to clarification requests for campaign:", realUserAnswer);

  // 6. Insert clean user truth into manualCampaignMetrics for zero sales/new business
  await db.insert(manualCampaignMetrics).values({
    accountId,
    campaignId,
    spend: 0,
    revenue: 0,
    leads: 0,
    conversions: 0,
  });
  console.log("Inserted clean manualCampaignMetrics for new business (0 sales, 0 leads)");

  // 7. Re-evaluate BusinessExecutionState through clean production flow
  console.log("\n=== STEP 2: RE-EVALUATING BUSINESS EXECUTION STATE ===");
  const evalResult = await evaluateAndPersistBusinessExecutionState({
    accountId,
    campaignId,
    userAnswerContext: `Factual clarification answer for 'business_operating_history': "${realUserAnswer}"`,
  });

  console.log("\n=== CLEAN RE-EVALUATION RESULT ===");
  console.log("Dossier manualTruthFact:", evalResult.dossier.manualTruthFact);
  console.log("State ID:", evalResult.executionState.id);
  console.log("Mode:", evalResult.executionState.mode);
  console.log("Primary Bottleneck:", evalResult.executionState.primaryBottleneck);
  console.log("Confidence:", evalResult.executionState.confidence);
  console.log("Reasoning:", evalResult.executionState.reason);
  console.log("Pending Clarification Request:", evalResult.clarificationRequest);

  const presentation = translatePerformanceToBll(
    evalResult.executionState,
    evalResult.performanceContext,
    evalResult.clarificationRequest
  );
  console.log("\n=== PRESENTATION / BLL ===");
  console.log("State Badge Label:", presentation.stateBadgeLabel);
  console.log("Clarification Card Present:", presentation.clarificationCard ? "YES" : "NO (RESOLVED)");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
