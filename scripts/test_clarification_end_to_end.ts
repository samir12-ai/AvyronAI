import "dotenv/config";
import { db } from "../server/db";
import { clarificationRequests, businessExecutionStates, performanceContexts, businessDataLayer } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccountIdFromCampaign } from "../server/performance-loop/account-resolver";
import { submitClarificationAnswer, evaluateAndPersistBusinessExecutionState } from "../server/performance-loop/execution-intelligence";
import { translatePerformanceToBll } from "../server/performance-loop/bll";

async function main() {
  const campaignId = "camp_test_clarification_end_to_end";
  const accountId = "acc_test_clarification_end_to_end";
  console.log("=== STEP 1: TEST CAMPAIGN ID:", campaignId, "ACCOUNT:", accountId, "===");

  // Ensure test campaign exists in businessDataLayer
  const [existingBiz] = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId)).limit(1);
  if (!existingBiz) {
    await db.insert(businessDataLayer).values({
      campaignId,
      accountId,
      businessLocation: "Test City",
      businessType: "SERVICE",
      priceRange: "$100",
      targetAudienceAge: "25-34",
      targetAudienceSegment: "B2B SaaS",
      monthlyBudget: "$1000",
      funnelObjective: "LEADS",
      primaryConversionChannel: "WEBSITE",
    });
  }

  // 1. Ensure a PENDING clarification exists
  let [pendingReq] = await db
    .select()
    .from(clarificationRequests)
    .where(and(eq(clarificationRequests.campaignId, campaignId), eq(clarificationRequests.status, "PENDING")))
    .orderBy(desc(clarificationRequests.createdAt))
    .limit(1);

  if (!pendingReq) {
    console.log("No pending clarification found, evaluating state to generate one...");
    const evalRes = await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
    pendingReq = evalRes.clarificationRequest || undefined;
  }

  if (!pendingReq) {
    console.error("Could not find or create a pending clarification request.");
    process.exit(1);
  }

  console.log("\n=== STEP 2: PENDING CLARIFICATION FOUND ===");
  console.log("Request ID:", pendingReq.id);
  console.log("Missing Fact Type:", pendingReq.missingFactType);
  console.log("Question:", pendingReq.question);
  console.log("Status:", pendingReq.status);

  // 2. Submit user answer
  const userAnswer = "Our business has been operating for 3 years with 60+ active paying client contracts.";
  console.log("\n=== STEP 3: SUBMITTING USER ANSWER ===");
  console.log("User Answer:", userAnswer);

  const result = await submitClarificationAnswer({
    clarificationRequestId: pendingReq.id,
    accountId,
    userAnswer,
  });

  // 3. Verify Answer Persistence in DB
  const [updatedReq] = await db
    .select()
    .from(clarificationRequests)
    .where(eq(clarificationRequests.id, pendingReq.id))
    .limit(1);

  console.log("\n=== STEP 4: ANSWER PERSISTENCE VERIFICATION ===");
  console.log("Status in DB:", updatedReq.status);
  console.log("User Answer in DB:", updatedReq.userAnswer);
  console.log("Answered At:", updatedReq.answeredAt);

  // 4. Verify Re-Evaluation & New State Creation
  console.log("\n=== STEP 5: RE-EVALUATION RESULT ===");
  console.log("New BusinessExecutionState ID:", result.executionState.id);
  console.log("New Mode:", result.executionState.mode);
  console.log("New Bottleneck:", result.executionState.primaryBottleneck);
  console.log("New Confidence:", result.executionState.confidence);
  console.log("New Reason:", result.executionState.reason);
  console.log("New PerformanceContext ID:", result.performanceContext.id);
  console.log("Manual Truth Dossier Fact:", result.dossier.manualTruthFact);

  // 5. Verify API Read State
  const [activePending] = await db
    .select()
    .from(clarificationRequests)
    .where(and(eq(clarificationRequests.campaignId, campaignId), eq(clarificationRequests.status, "PENDING")))
    .orderBy(desc(clarificationRequests.createdAt))
    .limit(1);

  const presentation = translatePerformanceToBll(result.executionState, result.performanceContext, activePending || null);
  console.log("\n=== STEP 6: PRESENTATION & UI PAYLOAD ===");
  console.log("Old Answered Request ID:", pendingReq.id, "(Status: ANSWERED)");
  console.log("New Active Request ID:", activePending ? activePending.id : "NONE");
  console.log("New Missing Fact Type:", activePending ? activePending.missingFactType : "NONE");
  console.log("State Badge Label:", presentation.stateBadgeLabel);
  console.log("Pending Clarification Card in UI:", presentation.clarificationCard ? `EXISTS (New Question: ${activePending?.question})` : "NONE (RESOLVED)");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
